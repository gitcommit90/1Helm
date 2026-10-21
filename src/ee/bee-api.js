// The Bee data API, called straight from the Worker (no container). Bee documents a public production endpoint,
// https://api.developer.bee.amazon.dev, with a public certificate (Bee developer docs, "Public endpoint"), so Workers fetch
// reaches it. (The private-CA host app-api-developer.ce.bee.amazon.dev, which needed a container with the CA pinned, is no longer used.)
// The dev Worker's GET /v1/me to that host answered 200 in 390 ms on 2026-10-21.
//   - One fetch helper (beeOnce) with a timeout. Error mapping: a 401 comes back as status 401 (the callers say "reconnect"), a 429 or 5xx
//     and a network error or timeout (status 0 with a short error) are retried by the call kinds below, then returned for the caller to back off.
//   - The token is opened at the call and only ever sent to API_ROOT in the Authorization header. It is never logged, returned or put in an
//     error (a fetch error that happens to contain it is redacted), and never in the helper's context.
//   - Call kinds, each with the retry rules the container scripts had: beeData (one request, 3 tries), beeSyncJob (GET only, syncCore),
//     beeFactsJob (fact writes only, writeCore), beeLiveRun (one Live notes chunk, liveCore, with the SSE stream).
//   - Tests stub fetch (deps.fetch or globalThis.fetch) and deps.sleep.
export const API_ROOT = "https://api.developer.bee.amazon.dev";
export const SYNC_KILL_MS = 120e3;   // the longest one sync run may take (calls after it answer status 0)
export const SYNC_RETRY_MAX_MS = 10e3;   // a 429/5xx is tried again in the run only when Bee's Retry-After is at most this
const REQ_TIMEOUT_MS = 20e3, LIVE_REQ_TIMEOUT_MS = 8e3, STREAM_CONNECT_MS = 15e3;
export const LIVE_LATE_MS = 30e3, LIVE_HOLD_MS = 30e3, LIVE_HOLD_MAX_MS = 5 * 60e3;
export const LIVE_SAFETY_MS = 15e3, LIVE_MIN_GAP_MS = 5e3, LIVE_STREAM_IDLE_MS = 75e3, LIVE_STREAM_RETRY_MAX_MS = 60e3;
export const LIVE_STREAM_TYPES = ["new-utterance", "new-conversation", "update-conversation", "update-conversation-summary", "delete-conversation"];
export const LIVE_STREAM_PATH = `/v1/stream?types=${LIVE_STREAM_TYPES.join(",")}`;
// Live notes reads exactly the conversation list and one conversation; the stream path is opened only by openBeeStream.
export const LIVE_ALLOW = /^\/v1\/conversations(\?limit=\d{1,2}|\/\d{1,15})$/;
export const PATH_RE = /^\/v1\/[A-Za-z0-9_\-/]*(\?[A-Za-z0-9_=&%.\-]*)?$/;
const now = () => Date.now();
// Test seams only: tests replace sleep so a retry does not wait for real, and set tap(kind, input) to see each sync or fact-write run's input (never the token).
export const beeTiming = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), tap: null };
const defaultSleep = (ms) => beeTiming.sleep(ms);
// Retry-After (seconds or an HTTP date) → ms, or null.
export const retryAfter = (v) => { if (v == null || v === "") return null; const s = Number(v); if (Number.isFinite(s) && s >= 0) return Math.round(s * 1000); const t = Date.parse(String(v)); return Number.isFinite(t) ? Math.max(0, t - now()) : null; };
const errText = (e, token) => { let m = e?.name === "TimeoutError" ? "timeout" : String(e?.cause?.code || e?.message || e); if (token && token.length > 6) m = m.split(token).join("[token]"); return m.slice(0, 120); };
// ONE request. → {status, body (text), retry_ms (on 429/5xx, from Retry-After, else null)} | {status: 0, error}.
export async function beeOnce(token, method, path, { body = null, timeoutMs = REQ_TIMEOUT_MS, deps = {} } = {}) {
  const f = deps.fetch || ((...a) => fetch(...a));
  try {
    const res = await f(API_ROOT + path, { method, signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: "Bearer " + token, accept: "application/json", ...(body != null ? { "content-type": "application/json" } : {}) }, ...(body != null ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text(), o = { status: res.status, body: text };
    if (res.status === 429 || res.status >= 500) o.retry_ms = retryAfter(res.headers?.get?.("retry-after"));
    return o;
  } catch (e) { return { status: 0, error: errText(e, token) }; }
}

// ---- the sync run (syncCore) ----
// syncCore is the same code that ran in the container, now a function: it runs here with get(path) → {status, body|error, retry_ms?}, and in
// the tests against a fake Bee. Input {cursor, ids, max}:
//   GET /v1/changes[?cursor=]. Bee's raw answer lists changed ids ({conversations:[id], facts:[id], …, since, until, next_cursor},
//   CLI commands/sync); the CLI's `changed --json` (and SPEC §5 / bee-data-shapes.json "changed") has meta{} and full objects.
//   Both are read. A cursor Bee refuses (4xx other than 401/429: cursor_too_old / invalid_cursor) → once more without one (≈ 24 h),
//   plus, when j.cursor_at is given, the catch-up walk below from that time.
//   Catch-up (the CLI's fallback full crawl, bee-cli commands/sync): j.catchup = ms → GET /v1/conversations?limit=50 page by page
//   from that time (the same walk as only:"list"), the FINISHED conversations only → catchup {from, items [{id, start_time}],
//   complete, pages} (or {from, status, error} when the walk failed). The DO queues the ones it hasn't ingested.
//   Rate limits: after a 429 no other call is made this run (each answers {status: 429, error: "not tried"}); any 429/5xx is
//   reported as slow {status, retry_ms} so the DO waits at least that long before the next run.
//   Then GET /v1/conversations/{id} (4 at a time) for each changed id + the retry ids, at most `max`; the rest come back in `more`.
//   Any 401 → {status: 401} at once. Facts / todos / dailies / journals are only counted (facts are step 4).
//   Facts (§7, step 4): j.facts "all" lists every fact (GET /v1/facts?confirmed=true|false&limit=50, every page); "changed" lists
//   them only when the change feed names any. j.only "facts" lists them and nothing else (/_ops/bee?facts=count, read-only).
//   → facts {status, list [{id, text, tags, confirmed, created_at}], complete}: complete = every page of both lists was read.
export async function syncCore(j, get0) {
  var slow = null;
  var get = async function (p) {
    if (slow && slow.status === 429) return { status: 429, error: "not tried: Bee asked to wait" };
    var r = await get0(p);
    if (r && (r.status === 429 || r.status >= 500)) { var w = typeof r.retry_ms === "number" && r.retry_ms >= 0 ? r.retry_ms : null;
      slow = { status: slow && slow.status === 429 ? 429 : r.status, retry_ms: slow && slow.retry_ms != null ? (w == null ? slow.retry_ms : Math.max(slow.retry_ms, w)) : w }; }
    return r;
  };
  var res = await (async function () {
  var listFacts = async function () {
    var all = [], seen = {}, complete = true, confs = ["true", "false"];
    for (var k = 0; k < confs.length && complete; k++) {
      var cur = null;
      for (var pg = 0; ; pg++) {
        if (pg >= 40) { complete = false; break; }
        var g = await get("/v1/facts?confirmed=" + confs[k] + "&limit=50" + (cur ? "&cursor=" + encodeURIComponent(cur) : ""));
        if (g.status === 401) return { status: 401 };
        if (g.status !== 200) { complete = false; break; }
        var b = null; try { b = JSON.parse(g.body); } catch (e) {}
        if (!b || !Array.isArray(b.facts)) { complete = false; break; }
        for (var f of b.facts) if (f && typeof f.id === "number" && f.id > 0 && typeof f.text === "string" && !seen[f.id]) { seen[f.id] = 1;
          all.push({ id: f.id, text: f.text, tags: Array.isArray(f.tags) ? f.tags.filter(function (t) { return typeof t === "string"; }) : null, confirmed: typeof f.confirmed === "boolean" ? f.confirmed : confs[k] === "true", created_at: typeof f.created_at === "number" ? f.created_at : null }); }
        cur = typeof b.next_cursor === "string" && b.next_cursor ? b.next_cursor : null;
        if (!cur || !b.facts.length) break;
      }
    }
    return { status: 200, list: all, complete: complete };
  };
  if (j.only === "facts") { var lf = await listFacts(); return lf.status === 401 ? { status: 401 } : { status: 200, facts: lf }; }
  var ids = [], inline = {}, convs = [];
  var add = function (id) { if (typeof id === "number" && id > 0 && Number.isSafeInteger(id) && ids.indexOf(id) < 0) ids.push(id); };
  var one = async function (id) {
    if (inline[id]) return { id: id, status: 200, conv: inline[id] };
    var g = await get("/v1/conversations/" + id), b = null;
    if (g.status !== 200) return { id: id, status: g.status, error: g.error || String(g.body || "").slice(0, 120) };
    try { b = JSON.parse(g.body); } catch (e) {}
    var conv = b && typeof b.conversation === "object" && b.conversation ? b.conversation : b;
    if (!conv || conv.id !== id) return { id: id, status: 0, error: "unreadable conversation" };
    if (!conv.timezone && b && typeof b.timezone === "string") conv.timezone = b.timezone;
    return { id: id, status: 200, conv: conv };
  };
  var getAll = async function (take) {
    for (var i = 0; i < take.length; i += 4) {
      var part = await Promise.all(take.slice(i, i + 4).map(one));
      for (var p of part) { if (p.status === 401) return false; convs.push(p); }
    }
    return true;
  };
  var ms = function (v) { return typeof v === "number" && isFinite(v) ? (v > 1e12 ? v : v * 1000) : null; };
  // Backfill (§6) pre-count: list calls only. GET /v1/conversations?limit=50[&cursor=] page by page; every conversation that started
  // at or after j.from. Bee lists newest first: a page wholly older than j.from ends the walk (if a page comes oldest first, every
  // page is read instead). → list {items [{id, start_time, end_time, state, updated_at}], complete, pages}.
  var walk = async function (from) {
    var items = [], cur = null, complete = true, pages = 0;
    for (;;) {
      if (pages >= 400) { complete = false; break; }
      var g = await get("/v1/conversations?limit=50" + (cur ? "&cursor=" + encodeURIComponent(cur) : "")); pages++;
      if (g.status === 401) return { status: 401 };
      if (g.status !== 200) return { status: g.status, error: g.error || String(g.body || "").slice(0, 160) };
      var b = null; try { b = JSON.parse(g.body); } catch (e) {}
      if (!b || !Array.isArray(b.conversations)) return { status: 0, error: "Bee's conversation list was unreadable" };
      var older = 0, list = b.conversations, desc = list.length > 1 && ms(list[0].start_time) >= ms(list[list.length - 1].start_time);
      for (var c of list) { var st = ms(c && c.start_time); if (!c || typeof c.id !== "number") continue;
        if (st != null && st < from) { older++; continue; }
        items.push({ id: c.id, start_time: st, end_time: ms(c.end_time), state: typeof c.state === "string" ? c.state : null, updated_at: typeof c.updated_at === "number" ? c.updated_at : null }); }
      cur = typeof b.next_cursor === "string" && b.next_cursor ? b.next_cursor : null;
      if (!cur || !list.length || (from && older && (desc || list.length === 1) && older === list.length)) break;
    }
    return { status: 200, list: { items: items, complete: complete, pages: pages } };
  };
  if (j.only === "list") return walk(Number(j.from) || 0);
  // Backfill run: the full conversations for j.ids (4 at a time), nothing else.
  if (j.only === "convs") { for (var x of (j.ids || []).slice(0, 100)) add(x); if (!(await getAll(ids))) return { status: 401 }; return { status: 200, convs: convs, more: [] }; }
  var path = function (c) { return "/v1/changes" + (c ? "?cursor=" + encodeURIComponent(c) : ""); };
  var reset = false, r = await get(path(j.cursor));
  if (j.cursor && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429) { reset = true; r = await get(path(null)); }
  if (r.status !== 200) return { status: r.status, reset: reset, error: r.error || String(r.body || "").slice(0, 200) };
  // The catch-up walk (asked for, or the cursor was just refused): finished conversations since that time, ids + start only.
  var cfrom = typeof j.catchup === "number" ? j.catchup : reset && typeof j.cursor_at === "number" ? j.cursor_at : null, catchup = null;
  if (cfrom != null) { var wk = await walk(Math.max(0, cfrom));
    if (wk.status === 401) return { status: 401, reset: reset };
    catchup = wk.status === 200 ? { from: cfrom, complete: wk.list.complete, pages: wk.list.pages, items: wk.list.items.filter(function (c) { return c.end_time != null || c.state === "COMPLETED"; }).map(function (c) { return { id: c.id, start_time: c.start_time }; }) }
      : { from: cfrom, status: wk.status, error: wk.error || null }; }
  var ch; try { ch = JSON.parse(r.body); } catch (e) { ch = null; }
  if (!ch || typeof ch !== "object") return { status: 0, reset: reset, error: "Bee's changes answer was unreadable" };
  var meta = ch.meta && typeof ch.meta === "object" ? ch.meta : ch, list = Array.isArray(ch.conversations) ? ch.conversations : [];
  for (var c of list) { var id = typeof c === "number" ? c : c && c.id; add(id); if (c && typeof c === "object" && Array.isArray(c.transcriptions)) inline[id] = c; }
  for (var x of (j.ids || [])) add(x);
  var max = Math.max(1, Math.min(100, j.max || 25)), take = ids.slice(0, max), more = ids.slice(max);
  if (!(await getAll(take))) return { status: 401, reset: reset };
  var n = function (k) { return Array.isArray(ch[k]) ? ch[k].length : 0; }, facts = null;
  if (j.facts === "all" || (j.facts === "changed" && n("facts") > 0)) { facts = await listFacts(); if (facts.status === 401) return { status: 401, reset: reset }; }
  return { status: 200, reset: reset, convs: convs, more: more, facts: facts, ...(catchup ? { catchup: catchup } : {}), changes: { next_cursor: typeof meta.next_cursor === "string" ? meta.next_cursor : null,
    since: typeof meta.since === "number" ? meta.since : null, until: typeof meta.until === "number" ? meta.until : null, updated: meta.updated === true,
    timezone: typeof meta.timezone === "string" ? meta.timezone : null, conversations: list.length, facts: n("facts"), todos: n("todos"), dailies: n("dailies"), journals: n("journals") } };
  })();
  if (slow && res && typeof res === "object") res.slow = slow;
  return res;
}
// The transport of a sync run: GET only, /v1/ paths only. A network error is tried again (3 tries, 1 s then 2 s). A 429/5xx is tried again
// only when Bee's Retry-After is at most SYNC_RETRY_MAX_MS (after exactly that wait); otherwise it comes back with retry_ms and the BeeSync DO
// waits (5 min or more, at least Retry-After).
export function syncGetter(token, deps = {}, deadline = Infinity) {
  const sleep = deps.sleep || defaultSleep;
  return async (path) => {
    if (typeof path !== "string" || !/^\/v1\//.test(path)) return { status: 0, error: "bad path" };
    for (let n = 1; ; n++) {
      if (now() > deadline) return { status: 0, error: "the run took too long" };
      const r = await beeOnce(token, "GET", path, { deps });
      if (r.status === 0) { if (n < 3) { await sleep(1000 * 2 ** (n - 1)); continue; } return r; }
      if (r.status >= 500 || r.status === 429) { const w = r.retry_ms; if (w != null && w <= SYNC_RETRY_MAX_MS && n < 3) { await sleep(w); continue; } return { status: r.status, body: r.body, retry_ms: w }; }
      return r;
    }
  };
}
// Worker side of one sync run: → the syncCore answer + { ms } (status 0 = never reached Bee). `token` is used here and nowhere else.
export async function beeSyncJob(env, tenantId, token, { cursor = null, ids = [], max = 25, facts = null, only = null, from = null, catchup = null, cursor_at = null } = {}, deps = {}) {
  const t0 = now(), j = { cursor, ids, max, ...(facts ? { facts } : {}), ...(only ? { only } : {}), ...(from != null ? { from } : {}), ...(catchup != null ? { catchup } : {}), ...(cursor_at != null ? { cursor_at } : {}) };
  beeTiming.tap?.("sync", j);
  let r; try { r = await syncCore(j, syncGetter(token, deps, t0 + SYNC_KILL_MS)); } catch (e) { r = { status: 0, error: errText(e, token) }; }
  return { ...r, ms: now() - t0 };
}

// ---- fact writes (writeCore): the ONLY writes Bee gets ----
// Input {ops: [{op: "put", id, body: {text, tags, confirmed}} | {op: "delete", id} | {op: "post", body: {text}}]} (at most 20). Allowed:
// PUT /v1/facts/<id>, DELETE /v1/facts/<id>, POST /v1/facts, nothing else.
// HARD (SPEC §7): every PUT carries the fact's existing tags. A text-only PUT made Bee re-tag the fact with junk categories, so a PUT
// without a tags array first reads the fact (GET /v1/facts/<id>) and sends its tags; if that read fails, nothing is written.
export async function writeCore(j, req) {
  var out = [], ops = Array.isArray(j.ops) ? j.ops.slice(0, 20) : [];
  var okId = function (x) { return typeof x === "number" && Number.isSafeInteger(x) && x > 0; };
  for (var o of ops) {
    var id = o && o.id, b = (o && o.body) || {}, method = null, path = null, body = null;
    if (o && o.op === "put" && okId(id) && typeof b.text === "string" && b.text.trim() && typeof b.confirmed === "boolean") {
      var tags = Array.isArray(b.tags) && b.tags.every(function (t) { return typeof t === "string"; }) ? b.tags : null;
      if (!tags) {
        var g = await req("GET", "/v1/facts/" + id, null), cur = null;
        if (g.status === 401) return { status: 401, results: out };
        try { cur = JSON.parse(g.body); cur = cur && (cur.fact || cur); } catch (e) {}
        if (g.status !== 200 || !cur || !Array.isArray(cur.tags)) { out.push({ op: "put", id: id, status: g.status === 404 ? 404 : 0, error: "couldn't read the fact's tags" }); continue; }
        tags = cur.tags;
      }
      method = "PUT"; path = "/v1/facts/" + id; body = { text: b.text, tags: tags, confirmed: b.confirmed };
    }
    else if (o && o.op === "delete" && okId(id)) { method = "DELETE"; path = "/v1/facts/" + id; }
    else if (o && o.op === "post" && typeof b.text === "string" && b.text.trim()) { method = "POST"; path = "/v1/facts"; body = { text: b.text }; }
    else { out.push({ op: o && o.op, id: okId(id) ? id : null, status: 0, error: "not allowed" }); continue; }
    var r = await req(method, path, body);
    if (r.status === 401) return { status: 401, results: out };
    var d = null; try { d = r.body ? JSON.parse(r.body) : null; } catch (e) {}
    var f = d && typeof d === "object" ? (d.fact || d) : null;
    out.push({ op: o.op, id: okId(id) ? id : null, status: r.status, sent_tags: body && body.tags ? body.tags : null,
      fact: f && typeof f.id === "number" ? { id: f.id, text: typeof f.text === "string" ? f.text : null, tags: Array.isArray(f.tags) ? f.tags : null, confirmed: typeof f.confirmed === "boolean" ? f.confirmed : null } : null,
      error: r.status >= 200 && r.status < 300 ? null : (r.error || String(r.body || "").slice(0, 160)) });
  }
  return { status: 200, results: out };
}
// The transport of fact writes: only GET /v1/facts/<id> (for tags), PUT and DELETE /v1/facts/<id> and POST /v1/facts. 429/5xx/network are
// retried (3 tries, 1 s then 2 s) for GET/PUT/DELETE; a POST is never sent twice.
const WRITE_ALLOW = { GET: /^\/v1\/facts\/\d+$/, PUT: /^\/v1\/facts\/\d+$/, DELETE: /^\/v1\/facts\/\d+$/, POST: /^\/v1\/facts$/ };
export function writeRequester(token, deps = {}) {
  const sleep = deps.sleep || defaultSleep;
  return async (method, path, body) => {
    if (!WRITE_ALLOW[method] || !WRITE_ALLOW[method].test(path)) return { status: 0, error: "not allowed" };
    const tries = method === "POST" ? 1 : 3;
    for (let n = 1; ; n++) {
      const r = await beeOnce(token, method, path, { body, deps });
      if ((r.status === 0 || r.status === 429 || r.status >= 500) && n < tries) { await sleep(1000 * 2 ** (n - 1)); continue; }
      return r.status === 0 ? r : { status: r.status, body: r.body };
    }
  };
}
// Worker side of fact writes: → {status, results[]} + {ms}.
export async function beeFactsJob(env, tenantId, token, ops, deps = {}) {
  beeTiming.tap?.("facts", { ops });
  const t0 = now(); let r; try { r = await writeCore({ ops }, writeRequester(token, deps)); } catch (e) { r = { status: 0, error: errText(e, token) }; }
  return { ...r, ms: now() - t0 };
}
// Worker side: one Bee data API call for this workspace → { status, json, ms } (status 0 = never reached Bee). 3 tries on 429/5xx/network, 1 s then 2 s.
// (env and tenantId are unused now that no container is named after the tenant; callers keep the same arguments.)
export async function beeData(env, tenantId, token, method, path, body, deps = {}) {
  if (!PATH_RE.test(path)) throw new Error("not a Bee API path");
  const sleep = deps.sleep || defaultSleep, t0 = now(); let r;
  for (let n = 1; ; n++) {
    r = await beeOnce(token, method, path, { body: body ?? null, deps });
    if ((r.status === 0 || r.status === 429 || r.status >= 500) && n < 3) { await sleep(1000 * 2 ** (n - 1)); continue; }
    break;
  }
  let json = null; try { json = r.body ? JSON.parse(r.body) : null; } catch {}
  return { status: Number(r.status) || 0, json, ms: now() - t0, ...(r.error ? { error: r.error } : {}) };
}

// ---- Live notes (SPEC §9.2-9.3): the polling chunk ----
// liveCore is the same code that ran in the container job. One chunk = at most max_ms (3 min): every `every` ms (5 s) it reads each followed
// conversation, and every `list_every` ms (30 s) GET /v1/conversations?limit=10 to find CAPTURING ones (a new conversation Bee starts
// mid-session is followed too). Each round emits ONE line {t:"poll", v, n, convs:[{id,state}], utts:[{c,id,at,sp,tx,rt}], errs, hold_until?, held?}
// to the LiveNotes DO (livePush); its answer {go:false} ends the chunk. 401 → {t:"auth"} and the chunk ends.
// The transcript read is GET /v1/conversations/{id}, filtered here, exactly like the official CLI's `conversations transcript
// --since` (bee-cli resources/conversations: it GETs the conversation and filters the utterances itself). Bee has no
// /v1/conversations/{id}/transcript route (DOCS-REVIEW 2026-10-07). Late lines: an utterance can arrive after a newer one, so the
// filter is spoken_at >= (newest seen − LIVE_LATE_MS); ids already seen are dropped (and the LiveNotes DO's UNIQUE(n, conv, uid)
// drops the re-reads of a new chunk).
// Rate limits (none documented): a 429/5xx → no more calls this round, and none until Retry-After (clamped to 1 s…5 min) or, without
// one, LIVE_HOLD_MS (30 s). While held, each round is only a heartbeat line {held: true, hold_until} (keeps the watchdog quiet); the
// LiveNotes DO hands hold_until to the next chunk. j.probe: one round, no text out (/_ops/bee?live=probe, dev): shapes, counts, lag.
// The SSE feed (2026-10-08, DOCS-REVIEW finding 1; docs.bee.computer/docs/realtime, bee-cli commands/stream): with j.stream and an
// openStream(onEvent, onState) the chunk also holds GET /v1/stream?types=… (LIVE_STREAM_PATH, the only stream path allowed) for its
// own lifetime. Bee's frames are "event: <type>\ndata: <json>\n\n" (":" lines are pings; a "connected" event first):
//   new-utterance {utterance{text,speaker}, conversation_uuid} · new-conversation {conversation{id,uuid,state:"processing",title}}
//   update-conversation {conversation{id,state:"processed",title,short_summary}} · update-conversation-summary {conversation_id,
//   short_summary} · delete-conversation {conversation{id,title}}. Delivery is at-most-once and Bee documents no resume (no Last-Event-ID or
//   since: realtime.md says events that occur while disconnected are not received), so events are only HINTS:
//   - any event for us wakes the loop: the next round (the same full GET, still the source of truth) runs at once, or LIVE_MIN_GAP_MS
//     (5 s) after the last one if that was sooner, so a quiet stretch costs no reads and talking costs no more than before; new-conversation (and an utterance whose conversation_uuid a new-conversation mapped) follows
//     that conversation at once;
//   - while the stream is open the GETs fall back to a safety round every LIVE_SAFETY_MS (15 s), so a dropped event costs at most
//     that; while it's closed (error, Bee ended it, idle LIVE_STREAM_IDLE_MS) the chunk polls every 5 s as before and reconnects
//     (Retry-After, else 5 s doubling to 60 s); 401/403/404 → no stream for the rest of the chunk (the GETs carry on);
//   - update-conversation with a finished state on one still CAPTURING here → a GET right away; the GET says whether it ended.
//     update-conversation-summary → hints.summary [ids] (Bee's summary is in: the LiveNotes DO asks BeeSync for a re-read).
//   No event text leaves the chunk (only ids, states and counts).
// SSE framing: sseFeed(state, chunk, onEvent). state {buf, ev, data}. Bounded: a frame over 256 KB → throws.
export function sseFeed(S, chunk, onEv) {
  S.buf = (S.buf || "") + chunk; if (!S.data) S.data = [];
  if (S.buf.length > 262144) { S.buf = ""; S.ev = null; S.data = []; throw new Error("event too big"); }
  var i;
  while ((i = S.buf.indexOf("\n")) >= 0) {
    var l = S.buf.slice(0, i).replace(/\r$/, ""); S.buf = S.buf.slice(i + 1);
    if (l === "") { if (S.data.length) { var d = null; try { d = JSON.parse(S.data.join("\n")); } catch (e) {} try { onEv(S.ev || null, d); } catch (e) {} } S.ev = null; S.data = []; continue; }
    if (l[0] === ":") continue;
    var k = l.indexOf(":"), f = k < 0 ? l : l.slice(0, k), v = k < 0 ? "" : l.slice(k + 1).replace(/^ /, "");
    if (f === "event") S.ev = v; else if (f === "data") S.data.push(v);
  }
}
export async function liveCore(j, get, emit, alive, sleep, openStream) {
  var every = Math.max(1000, j.every || 5000), listEvery = Math.max(every, j.list_every || 30000), since0 = Number(j.since) || 0;
  var LATE = LIVE_LATE_MS, HOLD = LIVE_HOLD_MS, HOLD_MAX = LIVE_HOLD_MAX_MS, SAFETY = Math.max(every, j.safety_every || LIVE_SAFETY_MS), GAP = Math.max(500, j.min_gap || LIVE_MIN_GAP_MS), RETRY_MAX = LIVE_STREAM_RETRY_MAX_MS;
  var follow = {}, order = [], lastList = -1e15, n = 0, hold = Number(j.hold_until) || 0;
  var addF = function (id, st) { if (typeof id !== "number" || !(id > 0) || follow[id]) return; follow[id] = { state: st || "CAPTURING", at: Number((j.cursors || {})[id]) || since0, seen: {}, done: false }; order.push(id); };
  // ---- the stream (hints only) ----
  var SX = { on: !!(j.stream && typeof openStream === "function"), st: "off", h: null, retry_at: 0, fails: 0, opens: 0, why: null, ev: {}, uuids: {}, hot: false, summary: [], keys: {}, states: {} };
  var wakeR = null;
  var wake = function () { SX.hot = true; if (wakeR) { var r = wakeR; wakeR = null; r(); } };
  var nap = function (ms) { if (SX.hot) return Promise.resolve(); return Promise.race([sleep(ms), new Promise(function (r) { wakeR = r; })]); };
  var kind = function (ev, d) { if (ev) return ev; if (!d || typeof d !== "object") return null; if (d.utterance) return "new-utterance"; if (d.conversation) return d.conversation.uuid ? "new-conversation" : "update-conversation"; if (d.conversation_id != null && "short_summary" in d) return "update-conversation-summary"; return null; };
  var onEv = function (ev0, d) {
    var ev = kind(ev0, d); if (!ev) return; SX.ev[ev] = (SX.ev[ev] || 0) + 1;
    if (j.probe) { var ks = Object.keys(d || {}).sort(); if (d && d.conversation) ks = ks.concat(Object.keys(d.conversation).sort().map(function (x) { return "conversation." + x; })); if (d && d.utterance) ks = ks.concat(Object.keys(d.utterance).sort().map(function (x) { return "utterance." + x; })); SX.keys[ev] = ks; if (d && d.conversation && typeof d.conversation.state === "string") SX.states[ev + ":" + d.conversation.state] = 1; return; }
    if (ev === "connected") return;
    var c = d && d.conversation && typeof d.conversation === "object" ? d.conversation : null, id = c && typeof c.id === "number" ? c.id : d && typeof d.conversation_id === "number" ? d.conversation_id : null;
    if (ev === "new-conversation") { if (id) { if (typeof c.uuid === "string") SX.uuids[c.uuid] = id; addF(id, "CAPTURING"); } wake(); return; }
    if (ev === "new-utterance") { var mid = d && typeof d.conversation_uuid === "string" ? SX.uuids[d.conversation_uuid] : null; if (mid) addF(mid, "CAPTURING"); wake(); return; }
    if (!id || !follow[id]) return;   // not one of ours
    if (ev === "update-conversation-summary") { if (SX.summary.indexOf(id) < 0) SX.summary.push(id); return; }
    if (!follow[id].done) wake();      // update / delete of one we still follow: read it now
  };
  var openS = function () {
    if (!SX.on || SX.st === "open" || SX.st === "opening" || SX.st === "dead" || Date.now() < SX.retry_at || Date.now() < hold) return;
    SX.st = "opening"; SX.opens++;
    var mine = {};
    try { SX.h = openStream(function (ev, d) { if (SX.cur === mine) onEv(ev, d); }, function (st, info) {
      if (SX.cur !== mine) return;
      if (st === "open") { SX.st = "open"; SX.fails = 0; SX.why = null; return; }
      SX.h = null; SX.cur = null; var code = info && info.status;
      if (code === 401 || code === 403 || code === 404) { SX.st = "dead"; SX.why = code; }
      else { SX.fails++; SX.st = "closed"; SX.why = code || (info && info.error) || st; var w = info && info.retry_ms != null && isFinite(Number(info.retry_ms)) ? Math.max(1000, Math.min(HOLD_MAX, Number(info.retry_ms))) : Math.min(RETRY_MAX, 5000 * Math.pow(2, SX.fails - 1)); SX.retry_at = Date.now() + w; }
      wake();   // back to 5 s polling now
    }); SX.cur = mine; } catch (e) { SX.st = "closed"; SX.fails++; SX.why = String(e && e.message || e).slice(0, 60); SX.retry_at = Date.now() + RETRY_MAX; }
  };
  var closeS = function () { var h = SX.h; SX.h = null; SX.cur = null; if (SX.st !== "dead") SX.st = "off"; try { h && h.close(); } catch (e) {} };
  (j.convs || []).forEach(function (id) { addF(Number(id)); });
  var ms = function (v) { return typeof v === "number" && isFinite(v) ? (v > 1e12 ? v : v * 1000) : null; };
  var flat = function (conv) { var out = []; (Array.isArray(conv && conv.transcriptions) ? conv.transcriptions : []).forEach(function (t) { (Array.isArray(t && t.utterances) ? t.utterances : []).forEach(function (u) { out.push(u); }); }); return out; };
  var shape = function (u, c) { var at = ms(u && u.spoken_at); return at == null || typeof u.text !== "string" || !u.text.trim() ? null : { c: c, id: typeof u.id === "number" ? u.id : null, at: at, sp: typeof u.speaker === "string" ? u.speaker : null, tx: u.text, rt: u.realtime === false ? 0 : 1 }; };
  var busy = function (r) { return r.status === 429 || r.status >= 500; };
  var holdFor = function (r) { var w = Number(r.retry_ms); w = r.retry_ms != null && isFinite(w) && w >= 0 ? Math.min(HOLD_MAX, Math.max(1000, w)) : HOLD; hold = Math.max(hold, Date.now() + w); return w; };
  var once = async function () {
    var out = { t: "poll", n: n, convs: [], utts: [], errs: [] }, now = Date.now();
    if (now < hold) { out.held = true; out.hold_until = hold; return out; }
    if (now - lastList >= listEvery) { lastList = now;
      var g = await get("/v1/conversations?limit=10");
      if (g.status === 401) return { t: "auth" };
      if (g.status === 200) { var b = null; try { b = JSON.parse(g.body); } catch (e) {}
        var list = b && Array.isArray(b.conversations) ? b.conversations : [];
        for (var c of list) { if (!c || typeof c.id !== "number") continue; var live = c.state === "CAPTURING" || (c.end_time == null && c.state !== "COMPLETED");
          if (live) addF(c.id, "CAPTURING"); if (follow[c.id] && !follow[c.id].done) follow[c.id].state = live ? "CAPTURING" : (typeof c.state === "string" ? c.state : "COMPLETED"); }
        if (j.probe) out.list = list.slice(0, 10).map(function (c) { return { id: c.id, state: c.state, start_time: c.start_time, end_time: c.end_time, updated_at: c.updated_at, utterances_count: c.utterances_count, keys: Object.keys(c || {}).sort() }; });
      } else { var e1 = { what: "list", status: g.status, error: g.error || null }; if (busy(g)) { e1.wait_ms = holdFor(g); out.errs.push(e1); out.hold_until = hold; n++; return out; } out.errs.push(e1); }
    }
    for (var id of order) { var f = follow[id]; if (f.done) continue;
      var utts = null, st = null;
      var g2 = await get("/v1/conversations/" + id);
      if (g2.status === 401) return { t: "auth" };
      if (g2.status === 404) { f.done = true; st = "GONE"; }
      else if (g2.status === 200) { var cb = null; try { cb = JSON.parse(g2.body); } catch (e) {} var conv = cb && typeof cb.conversation === "object" && cb.conversation ? cb.conversation : cb;
        if (conv && conv.id === id) { var from = f.at - LATE; utts = flat(conv).filter(function (u) { var a = ms(u && u.spoken_at); return a != null && a >= from; }); st = conv.state === "CAPTURING" || conv.end_time == null ? "CAPTURING" : (conv.state || "COMPLETED");
          if (j.probe) out.probe_conv = { keys: Object.keys(conv).sort(), state: conv.state, end_time: conv.end_time, transcriptions: (conv.transcriptions || []).map(function (t) { return { realtime: t.realtime, utterances: (t.utterances || []).length }; }) }; } }
      else { var e2 = { what: "conversation", id: id, status: g2.status, error: g2.error || null }; if (busy(g2)) { e2.wait_ms = holdFor(g2); out.errs.push(e2); out.hold_until = hold; break; } out.errs.push(e2); }
      if (st) f.state = st;
      var mx = 0;
      for (var u of utts || []) { var x = shape(u, id); if (!x) continue; var k = x.id != null ? "i" + x.id : "t" + x.at + ":" + x.tx.slice(0, 40); if (f.seen[k]) continue; f.seen[k] = 1; out.utts.push(x); if (x.at > mx) mx = x.at; }
      if (mx) f.at = Math.max(f.at, mx);
      if (f.state !== "CAPTURING") f.done = true;
      out.convs.push({ id: id, state: f.state });
    }
    n++; return out;
  };
  var hints = function (o) {
    if (!SX.on || o.t !== "poll") return o;
    o.stream = SX.st; var k = Object.keys(SX.ev); if (k.length) { o.ev = SX.ev; SX.ev = {}; }
    if (SX.summary.length) { o.hints = { summary: SX.summary }; SX.summary = []; }
    return o;
  };
  if (j.probe && SX.on) {   // /_ops/bee?live=probe: hold the stream a few seconds too; event types, keys and states only
    openS(); var o0; try { o0 = await once(); } catch (e) { o0 = { t: "poll", errs: [{ what: "job", error: String(e && e.message || e).slice(0, 120) }] }; }
    var until = Date.now() + Math.min(30000, Math.max(1000, j.probe_stream_ms || 10000));
    while (Date.now() < until && SX.st !== "dead") { SX.hot = false; await nap(until - Date.now()); }
    o0.stream_probe = { state: SX.st, why: SX.why, opens: SX.opens, events: SX.ev, keys: SX.keys, states: Object.keys(SX.states) }; closeS(); return o0;
  }
  try {
    for (;;) {
      if (!alive()) return { t: "end", why: "time" };
      openS(); SX.hot = false;
      var o; try { o = await once(); } catch (e) { o = { t: "poll", n: n, convs: [], utts: [], errs: [{ what: "job", error: String(e && e.message || e).slice(0, 120) }] }; }
      if (j.probe) return o;
      emit(hints(o)); if (o.t === "auth") return { t: "end", why: "auth" };
      if (SX.st !== "open") { await sleep(every); continue; }
      var t1 = Date.now(); await nap(SAFETY);   // the stream is open: a round when an event says so (≥ GAP apart), else every SAFETY
      if (SX.hot && SX.st === "open") { var w = GAP - (Date.now() - t1); if (w > 0) await sleep(w); }
    }
  } finally { closeS(); }
}
// The transport of a Live notes chunk: GET only and only LIVE_ALLOW paths. 429/5xx are never retried here (liveCore holds); a network
// error is tried once more after 0.5 s. 8 s per request.
export function liveGetter(token, deps = {}) {
  const sleep = deps.sleep || defaultSleep;
  return async (path) => {
    if (typeof path !== "string" || !LIVE_ALLOW.test(path)) return { status: 0, error: "bad path" };
    for (let n = 1; ; n++) {
      const r = await beeOnce(token, "GET", path, { timeoutMs: LIVE_REQ_TIMEOUT_MS, deps });
      if (r.status === 0 && n < 2) { await sleep(500 * n); continue; }
      return r.status === 0 ? r : { status: r.status, body: r.body, ...(r.status === 429 || r.status >= 500 ? { retry_ms: r.retry_ms } : {}) };
    }
  };
}
// The stream: exactly GET LIVE_STREAM_PATH (nothing else can be opened as a stream; liveGetter can't reach /v1/stream), Accept text/event-stream.
// Bounded: it lives inside the chunk (liveCore closes it when it returns), the connect has 15 s, an open stream silent for LIVE_STREAM_IDLE_MS
// is dropped (liveCore reconnects), and one frame over 256 KB drops it. → openStream(onEv, onSt) for liveCore: onSt("open"|"closed"|"error", info).
export function beeStreamOpener(token, deps = {}) {
  const f = deps.fetch || ((...a) => fetch(...a));
  return (onEv, onSt) => {
    const ac = new AbortController(); let fin = false, opened = false, idle = null;
    const connect = setTimeout(() => ac.abort(new Error("timeout")), STREAM_CONNECT_MS);
    const end = (st, info) => { if (fin) return; fin = true; clearTimeout(idle); clearTimeout(connect); try { ac.abort(); } catch {} onSt(st, info || {}); };
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => ac.abort(new Error("idle")), LIVE_STREAM_IDLE_MS); };
    (async () => {
      try {
        const res = await f(API_ROOT + LIVE_STREAM_PATH, { method: "GET", signal: ac.signal, headers: { authorization: "Bearer " + token, accept: "text/event-stream", "cache-control": "no-cache" } });
        clearTimeout(connect);
        if (fin) { try { await res.body?.cancel(); } catch {} return; }
        if (res.status !== 200) { try { await res.body?.cancel(); } catch {} return end("error", { status: res.status, retry_ms: retryAfter(res.headers?.get?.("retry-after")) }); }
        opened = true; onSt("open", {}); bump();
        const reader = res.body.getReader(), dec = new TextDecoder(), S = {};
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          bump(); sseFeed(S, dec.decode(value, { stream: true }), onEv);
        }
        end("closed", {});
      } catch (e) { end(opened ? "closed" : "error", { error: errText(e, token).slice(0, 80) }); }
    })();
    return { close: () => { fin = true; clearTimeout(idle); clearTimeout(connect); try { ac.abort(); } catch {} } };
  };
}
// One Live notes chunk, run in the calling Durable Object (LiveNotes). Every emitted round goes to push(m) in order; push answers {go}, and
// go:false (or ctl.stop()) ends the chunk. When the chunk ends on its own it pushes {t:"end", why, ms} last (not after ctl.stop()). A Durable Object with a pending fetch or open response stream is not evicted (up to 15 min per
// operation, Cloudflare Durable Object lifecycle docs), and a chunk is at most 15 min (max_ms), so the 3 minute chunks are inside the limits.
// If the object restarts anyway (a deploy), the stream and the chunk are gone with it: LiveNotes' watchdog starts the next chunk from the
// saved lines (cursors), and the full GETs read what the stream could not deliver, so no line is lost.
// → {ok, ms, why, lines}. `input` is liveCore's input plus {run, token}; the token is never put in anything that leaves.
export async function beeLiveRun(input, push, ctl = {}, deps = {}) {
  const { run: _run, ln: _ln, token, ...job } = input || {}, t0 = now(), max = Math.min(15 * 60e3, Number(job.max_ms) || 180e3);
  beeTiming.tap?.("live", { run: _run, ...job });
  const L = { stopped: false, replaced: false, lines: 0, why: "ended" };
  let wakeStop = null; const stopP = new Promise((r) => { wakeStop = r; });
  const stop = (why) => { if (!L.stopped) { L.stopped = true; if (why) L.why = why; wakeStop(); } };
  ctl.stop = () => { L.replaced = true; stop("stopped"); };   // the person stopped, or a new chunk replaces this one: it says nothing more
  const sleep = (ms) => Promise.race([(deps.sleep || defaultSleep)(ms), stopP]);
  let chain = Promise.resolve();
  const emit = (m) => { chain = chain.then(async () => { if (L.stopped) return; L.lines++; let r; try { r = await push(m); } catch (e) { r = { go: false, error: String(e?.message || e).slice(0, 120) }; } if (!r?.go) stop(r?.error ? "push failed" : "stopped"); }); };
  let end; try { end = await liveCore(job, liveGetter(token, deps), emit, () => !L.stopped && now() - t0 < max, sleep, beeStreamOpener(token, deps)); }
  catch (e) { end = { t: "end", why: "error", error: errText(e, token) }; }
  await chain;
  if (end?.t === "end" && !L.stopped) L.why = end.why || L.why;
  const ms = now() - t0;
  if (!L.replaced) { try { await push({ t: "end", why: L.why, ms }); } catch {} }   // LiveNotes settles the chunk and starts the next one at once
  return { ok: true, ms, why: L.why, lines: L.lines };
}
// /_ops/bee?live=probe (dev, read-only): ONE round of the chunk with the stream held a few seconds. The shapes only (no transcript text).
export async function beeLiveProbe(env, tenantId, token, deps = {}) {
  const job = { since: now() - 10 * 60e3, every: 1000, list_every: 1000, max_ms: 60e3, stream: true, probe_stream_ms: 10e3, probe: true }, t0 = now();
  let o; try { o = await liveCore(job, liveGetter(token, deps), () => {}, () => now() - t0 < 60e3, deps.sleep || defaultSleep, beeStreamOpener(token, deps)); }
  catch (e) { o = { t: "end", why: "error", error: errText(e, token) }; }
  if (o && Array.isArray(o.utts)) { const u = o.utts, mx = u.reduce((m, x) => Math.max(m, x.at), 0); o.utts = { count: u.length, realtime: u.filter((x) => x.rt).length, speakers: [...new Set(u.map((x) => x.sp))].length, newest_lag_ms: mx ? now() - mx : null }; }
  return o;
}
