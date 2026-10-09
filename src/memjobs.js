// Background memory jobs (Muse overhaul Stage 3, Captain 2026-10-06). Three jobs, each silent: they change memory only. They never
// message the person, never create tasks, never text, and call no tools: every model call here is one JSON-in/JSON-out step.
//   1. upkeep  (per channel, after activity, at most hourly): from the person's new turns, propose missing durable facts and
//      corrections → verify → retain into THIS channel's Hindsight bank (+ a ledger row), or mark the old record superseded.
//   2. people  (per channel, daily): keep Contacts current for the people the person talks about (relation, aliases, facts in
//      Muse's page sections). Contacts is the account-wide registry (people.js); facts learned here are tagged with this channel
//      and only this channel and General see them (the memory wall).
//   3. reflect (per account, nightly in the person's time zone, run by General): from the person's raw recent words across
//      channels, ONE pinned Notebook entry in General, "How to work with <first name>", replaced each night, ≤ 1,500 characters.
// Pattern from Muse (research/muse/supplement/background-jobs): every writing step is followed by a separate verify step with two
// lenses (refute: try to break each claim; evidence_grounded: every claim cites the person's exact words + date + turn), each step
// returns one fixed JSON shape with a no_change option, what the steps read is data and never instructions, cite or omit.
// Before the model verify, a plain code check drops any claim whose quote isn't really in the person's words (no model needed).
// Billing: every model call is reserved first and settled at usage.cost × 1.15 (like every model call); a refused reservation
// skips the run (never on credit). Own AI key: the call goes to their fast model; Hindsight work is metered like elsewhere.
import { openRouterChat, useOpenRouter, OR_RESERVE_PRICE } from "./model.js";
import { hsOn, recall as hsRecall, retain as hsRetain, forgetDocument } from "./hindsight.js";
import { METER as BYOK_METER } from "./byok-meter.js";
import { MJ_MARKUP, MAX_OUT, FIRST_LOOKBACK_MS, WINDOW, mjRoute, clip, one, rid, sameFact, parseJson, looksSecret, dayOf, hourOf, when, labelTurns, renderTurns, citeTurn, RUN, COMMON, verifyClaims, stepper, skippedRun } from "./memjobs-core.js";
import { people, peopleHost } from "./memjobs-people.js";
import { reflect, reflectHost } from "./memjobs-reflect.js";
export * from "./memjobs-core.js";
export { REFLECT_ID, REFLECT_MAX } from "./memjobs-reflect.js";
export { findContact, pnorm, SECTIONS, peoplePrompt } from "./memjobs-people.js";
export { assembleReflection, reflectPrompt } from "./memjobs-reflect.js";

export const JOBS = ["upkeep", "people", "reflect"];
export const UPKEEP_EVERY_MS = 3600e3, PEOPLE_EVERY_MS = 20 * 3600e3;

export function upkeepPrompt({ L, known, tz, now, first, channel }) {
  const sys = `${RUN("upkeep", first)}
This is memory upkeep for the #${channel} channel: it keeps what the person shares here (facts about them and their life, standing preferences, ongoing projects, firm decisions) accurately remembered.

Your job: read the new turns and propose what memory is MISSING, and what memory the person CORRECTED.
- Durable only: likely still true and useful weeks from now (who they are, where they live, family and work, standing preferences and dislikes, routines, ongoing projects and their key facts, dates that recur, firm decisions). Skip one-off task details, moods, small talk, questions, hypotheticals ("if I…", "maybe"), jokes, options still being weighed, and plans that aren't decided.
- Skip anything "Already in memory" holds, even reworded. Don't restate a memory with a small twist.
- A correction is when the person's new words contradict something in "Already in memory" (a changed date, a new address, a reversed preference). Give that memory's key (K1, K2…) in "replaces".
- Write each memory as one plain sentence in the third person, specific and self-contained (use names; no "he/she" without a name). Keep dates as the person gave them, with when they said it if it's relative ("next week, said Oct 6"); never invent a year or a detail the words don't give.
${COMMON}

Shape:
{"status":"changes" | "no_change","checked":"one line: what you looked at","claims":[{"kind":"fact" | "preference" | "correction","text":"the memory, one sentence","quote":"the person's exact words","turn":"T3","replaces":"K2 for a correction, else empty"}]}`;
  const k = known.length ? known.map((x) => `${x.key}. ${clip(one(x.text), 300)}`).join("\n") : "(nothing relevant found)";
  return [{ role: "system", content: sys }, { role: "user", content: `Now: ${when(now, tz)} (${tz}).\n\nAlready in memory (this channel):\n${k}\n\nNew turns in #${channel}:\n${renderTurns(L, tz)}` }];
}

// ---------- the run frame: gates, the log row, cost ----------
// host (residentHost below, or a fake in tests): tz(), now(), tenant, channel, general, first(), access(), memoryOn(), chat(job, step,
// messages, run) → {text, cost_nano, model} | {skipped}, turnsSince(cursor, limit) / crossTurns(since, limit), cursor(job) /
// setCursor(job, at), log(row) and the job-specific writers. The frame never throws: an error is logged as status "error".
const RUNNERS = { upkeep, people, reflect };
export async function runJob(host, job, o = {}) {
  if (!RUNNERS[job]) return { status: "skipped", why: `no job "${job}"` };
  // The cron asks General every hour once there's been activity; the reflection itself runs only at night (3-5 AM in the person's
  // time zone) and once a day. Not night yet = nothing to log.
  if (job === "reflect" && o.nightly) {
    const h = hourOf(host.now(), host.tz()), last = host.cursor("reflect");
    if (h < 3 || h > 5 || (last && dayOf(last, host.tz()) === dayOf(host.now(), host.tz()))) return { status: "waiting", why: "not night in the person's time zone yet, or already reflected today", logged: false };
  }
  const run = { id: rid(job), job, trigger: o.trigger || "cron", started_at: host.now(), cost_nano: 0, models: new Set(), steps: [], changes: [] };
  let out;
  try {
    const acc = await host.access();
    if (acc?.mode !== "full") out = { status: "skipped", why: `account is ${acc?.status || "read-only"}` };
    else if (job === "upkeep" && !host.memoryOn()) out = { status: "skipped", why: "memory is off in this channel" };
    else if (job === "reflect" && !host.general) out = { status: "skipped", why: "the nightly reflection runs in General only" };
    else out = await RUNNERS[job](host, run, o);
  } catch (e) { out = { status: "error", error: clip(e?.message || e, 300) }; }
  const row = { id: run.id, tenant: host.tenant, channel: host.channel, job, trigger: run.trigger, started_at: run.started_at, ms: host.now() - run.started_at,
    status: out.status, why: out.why || null, more: !!out.more, window_from: out.from ?? null, window_to: out.to ?? null, turns: out.turns ?? 0, proposed: out.proposed ?? 0, verified: out.verified ?? 0,
    applied: run.changes.length, changes: run.changes, steps: run.steps, models: [...run.models].join(", "), cost_nano: run.cost_nano, error: out.error || null };
  try { await host.log(row); } catch (e) { row.log_error = clip(e?.message || e, 200); }
  return row;
}

// ---------- 1. memory upkeep ----------
async function upkeep(host, run, o) {
  const now = host.now(), tz = host.tz();
  const cur = o.since != null ? o.since : (host.cursor("upkeep") ?? now - FIRST_LOOKBACK_MS);
  const turns = await host.turnsSince(cur, WINDOW.upkeep.turns);
  const L = labelTurns(turns, { chars: WINDOW.upkeep.chars });
  if (!L.length) { return { status: "no_change", why: "no new turns from the person", from: cur, to: cur, turns: 0 }; }
  const to = L.at(-1).at, base = { from: cur, to, turns: L.length, more: turns.length >= WINDOW.upkeep.turns || L.length < turns.length };
  // What memory already holds about this window: Hindsight (this channel's bank) + this channel's saved facts.
  // forget.js: something the person asked to forget is never shown to the model as "already in memory" either.
  const known = (await host.known(L.map((t) => t.user).join(" \n").slice(0, 1800))).filter((k) => !host.forgotten?.(k.text));
  known.forEach((k, i) => { k.key = `K${i + 1}`; });
  const ask = stepper(host, run);
  const w = await ask("upkeep", "write", upkeepPrompt({ L, known, tz, now, first: await host.first(), channel: host.channel }));
  if (w.skipped) return skippedRun(w.skipped, base);
  const j = parseJson(w.text);
  if (!j) throw new Error("upkeep: the write step's reply wasn't JSON");
  const raw = j.status === "no_change" || !Array.isArray(j.claims) ? [] : j.claims.slice(0, 12);
  // Code check first (cite or omit; no secrets; the shape), then the model verify.
  const dropped = [], cand = [];
  raw.forEach((c, i) => {
    const text = clip(one(c?.text), 400), quote = one(c?.quote), kind = ["fact", "preference", "correction"].includes(c?.kind) ? c.kind : "fact";
    // forget.js: a claim about something the person asked to forget is dropped, and its text is never logged.
    if (host.forgotten?.(text) || host.forgotten?.(quote)) { dropped.push({ why: "matches something the person asked to forget" }); return; }
    const t = text && quote ? citeTurn(L, c?.turn, quote) : null;
    if (!text) return; if (!t) { dropped.push({ text, why: "quote not in the person's words" }); return; }
    if (looksSecret(text) || looksSecret(quote)) { dropped.push({ why: "looks like a secret" }); return; }   // its text isn't logged
    const rep = kind === "correction" ? known.find((k) => k.key === String(c?.replaces || "").trim().toUpperCase()) : null;
    cand.push({ id: `c${i + 1}`, kind: rep ? "correction" : kind === "correction" ? "fact" : kind, text, quote, turn: t, replaces: rep || null,
      show: `${rep ? `(correction of: "${clip(one(rep.text), 200)}") ` : ""}${text}`, cites: [{ turn: t.label, quote }] });
  });
  if (!cand.length) { run.steps.push({ step: "check", dropped }); return { status: "no_change", why: raw.length ? "nothing survived the quote check" : clip(j.checked || "nothing durable", 200), ...base, proposed: raw.length }; }
  const v = await verifyClaims(ask, tz, "upkeep", cand, L, "", { first: await host.first() });
  if (v.skipped) return skippedRun(v.skipped, { ...base, proposed: raw.length });
  run.steps.push({ step: "check", dropped, verdicts: v.results });
  let ok = cand.filter((c) => v.pass.has(c.id));
  // Skip what Hindsight already holds (another search per claim catches what the window search missed).
  const fresh = [];
  for (const c of ok) {
    if (c.kind !== "correction" && (known.some((k) => sameFact(k.text, c.text)) || (await host.held(c.text)))) { run.steps.push({ step: "skip", text: c.text, why: "already in memory" }); continue; }
    if (fresh.some((f) => sameFact(f.text, c.text))) continue;
    fresh.push(c);
  }
  for (const c of fresh) {
    const r = await host.retainFact({ run: run.id, text: c.text, quote: c.quote, turn: c.turn, kind: c.kind, replaces: c.replaces });
    // Out of credits for Hindsight: stop here and keep the cursor, so the next run picks the rest up (what landed is then "already held").
    if (r?.skipped) { run.steps.push({ step: "retain", skipped: r.skipped }); return skippedRun(r.skipped, { ...base, proposed: raw.length, verified: ok.length }); }
    run.changes.push({ op: c.replaces ? "supersede" : "retain", text: c.text, quote: c.quote, turn: c.turn.id, at: c.turn.at, ...(c.replaces ? { replaced: clip(c.replaces.text, 200) } : {}), id: r?.id || null });
  }
  host.setCursor("upkeep", to);
  return { status: run.changes.length ? "changed" : "no_change", ...(run.changes.length ? {} : { why: ok.length ? "everything verified was already in memory" : "nothing passed verify" }), ...base, proposed: raw.length, verified: ok.length };
}

// ---------- the Resident adapter ----------
// res: the channel's Resident. Everything a job reads or writes goes through here, so the memory wall holds by construction:
// upkeep writes only res.hsBankId() (this channel's bank) and this channel's ledger; people writes Contacts tagged with this channel;
// reflect (General only) reads other channels' turns through their Residents and writes General's Notebook.
export const residentHost = (res, skipperSlug = "main") => ({
  tenant: res.get("tenant"), channel: res.get("channel"), general: res.get("channel") === skipperSlug,
  now: () => Date.now(), tz: () => res.tz(),
  memoryOn: () => res.memoryMode() !== "off",
  forgotten: (text) => res.forgottenNow(text),   // forget.js: this channel's "forgotten" list (hashed keywords)
  access: () => res.accessNow(),
  async first() { if (this._first !== undefined) return this._first; try { this._first = (await res.env.DB.prepare("SELECT first_name FROM tenants WHERE id=?").bind(res.get("tenant")).first())?.first_name || ""; } catch { this._first = ""; } return this._first; },
  cursor: (job) => { const v = res.get(`mj_cur_${job}`); return v ? Number(v) : null; },
  setCursor: (job, at) => res.put(`mj_cur_${job}`, String(at)),
  turnsSince: async (since, limit) => res.memjobTurns(since, limit),
  // One model call: reserved first at the price ceiling, settled at usage.cost × 1.15. Own AI key: their fast model, nothing to settle.
  async chat(job, step, messages, run) {
    if (!useOpenRouter(res.env)) return { skipped: "no chore model available" };
    await res.byokRefresh(60e3);
    const env = res.env, byok = !!env.BYOK, chars = messages.reduce((n, m) => n + String(m.content || "").length, 0);
    const reserve = byok ? 0 : Math.ceil((Math.ceil(chars / 3) * OR_RESERVE_PRICE.in + MAX_OUT * OR_RESERVE_PRICE.out) * MJ_MARKUP), id = `mj-${job}-${step}:${crypto.randomUUID()}`, L = res.ledger();
    if (!byok) { const r = await L.reserve(id, reserve); if (!r?.ok) return { skipped: r?.reason || "out_of_credits" }; }
    const route = mjRoute(env, job, step);
    let j;
    try { const resp = await openRouterChat(env, { messages, max_tokens: MAX_OUT, temperature: 0, ...(route.json ? { response_format: { type: "json_object" } } : {}) }, null, route, { tenant: res.get("tenant"), channel: res.get("channel"), kind: `memjob-${job}-${step}` }); j = await resp.json(); }
    catch (e) { if (!byok) await L.settle(id, 0).catch(() => {}); throw e; }
    const cost = byok ? 0 : Math.ceil(Number(j?.usage?.cost || 0) * 1e9), charge = Math.ceil(cost * MJ_MARKUP);
    if (!byok) await L.settle(id, charge).catch((e) => console.log("memjob settle", e.message));
    return { text: String(j?.choices?.[0]?.message?.content ?? ""), cost_nano: charge, model: j?.model || route.model };
  },
  // Memory this channel already holds that's close to the window: its Hindsight bank (when on) + its saved facts in the ledger.
  async known(q) {
    const out = [];
    if (hsOn(res.env)) { try { const h = await res.byokHold("hs-recall", BYOK_METER.hs_recall); if (h) { let r; try { r = await hsRecall(res.env, res.hsBankId(), q, { maxTokens: 1500 }); } catch (e) { await h.done(0); throw e; } await h.done();
      for (const x of r.results.slice(0, 15)) out.push({ src: "hs", id: x.id, doc: x.document_id || null, text: String(x.text || "") }); } } catch (e) { console.log("memjob known", e.message); } }
    for (const r of res.sql.exec("SELECT id, text FROM mem_rows WHERE kind IN ('fact','notebook','memory') AND superseded_by IS NULL ORDER BY at DESC LIMIT 25").toArray()) if (!out.some((k) => sameFact(k.text, r.text))) out.push({ src: "ledger", id: r.id, text: r.text });
    return out.slice(0, 30);
  },
  async held(text) {
    if (!hsOn(res.env)) return false;
    try { const h = await res.byokHold("hs-recall", BYOK_METER.hs_recall); if (!h) return false; let r; try { r = await hsRecall(res.env, res.hsBankId(), text, { maxTokens: 600 }); } catch (e) { await h.done(0); throw e; } await h.done();
      return r.results.slice(0, 5).some((x) => sameFact(x.text, text)); } catch { return false; }
  },
  // A verified fact: a ledger row (u:<run>:<n>, in the source task's session so deleting that chat deletes it), its evidence, and
  // the same fact retained into this channel's Hindsight bank as document fact-<row id>. A correction marks the old ledger row
  // superseded; an old Hindsight fact this job wrote itself is deleted (Hindsight's own memories from the chat stay; the newer
  // dated fact wins at recall).
  async retainFact({ run, text, quote, turn, kind, replaces }) {
    const n = (this._n = (this._n || 0) + 1), id = `u:${run.slice(3)}:${n}`;
    if (hsOn(res.env)) {
      const h = await res.byokHold("hs-retain", text.length * BYOK_METER.hs_retain_char); if (!h) return { skipped: "out of credits (Hindsight retain)" };
      try { await res.hsBank(); await hsRetain(res.env, res.hsBankId(), [{ content: text, at: turn.at, context: `memory upkeep in #${res.get("channel")}: from what the person said${kind === "correction" ? " (a correction)" : ""}`, document_id: `fact-${id}`, metadata: { kind: "fact", source: "upkeep", run, turn: turn.id, quote: quote.slice(0, 300) } }]); await h.done(); }
      catch (e) { await h.done(0); throw e; }
    }
    res.mem.put({ id, at: turn.at, kind: "fact", author: "upkeep", source: `memory upkeep · task ${String(turn.session || "").slice(0, 8)}`, session: turn.session || null, text });
    res.memjobCite(id, { job: "upkeep", run, kind, quote, turn: turn.id, session: turn.session, at: turn.at, replaces: replaces ? { src: replaces.src, id: replaces.id, text: String(replaces.text).slice(0, 300) } : null });
    if (replaces?.src === "ledger") res.mem.supersede(replaces.id, id);
    if (replaces?.src === "hs" && String(replaces.doc || "").startsWith("fact-u:")) { try { await forgetDocument(res.env, res.hsBankId(), replaces.doc); res.mem.supersede(replaces.doc.slice(5), id); } catch (e) { console.log("memjob forget", e.message); } }
    res.ctx.waitUntil?.(res.mem.embedMissing(50).catch(() => {}));
    return { id };
  },
  ...peopleHost(res),
  ...reflectHost(res),
  log: (row) => logRun(res.env, row),
});

// ---------- the per-run log (dev D1 memjob_runs; migrations_036_memjobs.sql) and the schedule state ----------
let ensured = false;
export async function ensureTables(env) {
  if (ensured) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS memjob_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, channel TEXT NOT NULL, job TEXT NOT NULL, trigger TEXT NOT NULL, started_at INTEGER NOT NULL, ms INTEGER, status TEXT NOT NULL, why TEXT, window_from INTEGER, window_to INTEGER, turns INTEGER NOT NULL DEFAULT 0, proposed INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, applied INTEGER NOT NULL DEFAULT 0, changes TEXT NOT NULL DEFAULT '[]', steps TEXT NOT NULL DEFAULT '[]', models TEXT, cost_nano INTEGER NOT NULL DEFAULT 0, error TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS memjob_runs_t ON memjob_runs(tenant_id, started_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS memjob_state (tenant_id TEXT NOT NULL, channel TEXT NOT NULL, last_activity INTEGER NOT NULL DEFAULT 0, upkeep_at INTEGER NOT NULL DEFAULT 0, people_at INTEGER NOT NULL DEFAULT 0, reflect_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, channel))"),
  ]);
  ensured = true;
}
export async function logRun(env, r) {
  await ensureTables(env);
  await env.DB.prepare("INSERT INTO memjob_runs (id,tenant_id,channel,job,trigger,started_at,ms,status,why,window_from,window_to,turns,proposed,verified,applied,changes,steps,models,cost_nano,error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(r.id, r.tenant, r.channel, r.job, r.trigger, r.started_at, r.ms, r.status, r.why, r.window_from, r.window_to, r.turns, r.proposed, r.verified, r.applied, JSON.stringify(r.changes).slice(0, 60000), JSON.stringify(r.steps).slice(0, 20000), r.models || null, r.cost_nano, r.error).run();
  // The schedule: a job that ran (any outcome but an error or a skip) moves its clock, so the cron doesn't pick it again at once.
  // A window cut short (more turns waiting) moves the clock only to its last turn, so the next hour picks up the rest.
  if (r.status === "changed" || r.status === "no_change") {
    const col = r.job === "upkeep" ? "upkeep_at" : r.job === "people" ? "people_at" : "reflect_at";
    await env.DB.prepare(`INSERT INTO memjob_state (tenant_id, channel, ${col}) VALUES (?,?,?) ON CONFLICT(tenant_id, channel) DO UPDATE SET ${col}=excluded.${col}`).bind(r.tenant, r.channel, r.more && r.window_to ? r.window_to : r.started_at).run();
  }
}
// After a chat turn (throttled by the caller): this channel had activity, so the jobs are due again.
export async function noteActivity(env, tenant, channel, at = Date.now()) {
  await ensureTables(env);
  await env.DB.prepare("INSERT INTO memjob_state (tenant_id, channel, last_activity) VALUES (?,?,?) ON CONFLICT(tenant_id, channel) DO UPDATE SET last_activity=excluded.last_activity").bind(tenant, channel, at).run();
}

// ---------- the cron (17 * * * *): which jobs are due ----------
// upkeep: channels with activity since their last upkeep, at most hourly. people: activity since the last people run, at most
// every 20 h. reflect: accounts with activity since the last reflection, run by General, which itself checks it's night (3-5 AM)
// in the person's time zone and that it hasn't reflected today. Capped per hour so a burst never fans out without limit.
export const CRON_CAP = { upkeep: 60, people: 30, reflect: 30 };
export async function memjobsCron(env, { residentOf, now = Date.now() } = {}) {
  await ensureTables(env);
  const q = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results || [];
  const up = await q("SELECT s.tenant_id, s.channel FROM memjob_state s JOIN tenants t ON t.id=s.tenant_id WHERE t.status='active' AND s.last_activity > s.upkeep_at AND s.upkeep_at < ? ORDER BY s.upkeep_at LIMIT ?", now - UPKEEP_EVERY_MS + 120e3, CRON_CAP.upkeep);
  const pe = await q("SELECT s.tenant_id, s.channel FROM memjob_state s JOIN tenants t ON t.id=s.tenant_id WHERE t.status='active' AND s.last_activity > s.people_at AND s.people_at < ? ORDER BY s.people_at LIMIT ?", now - PEOPLE_EVERY_MS, CRON_CAP.people);
  const re = await q("SELECT s.tenant_id, MAX(s.last_activity) act, COALESCE((SELECT g.reflect_at FROM memjob_state g WHERE g.tenant_id=s.tenant_id AND g.channel='main'), 0) refl FROM memjob_state s JOIN tenants t ON t.id=s.tenant_id WHERE t.status='active' GROUP BY s.tenant_id HAVING act > refl AND refl < ? LIMIT ?", now - 20 * 3600e3, CRON_CAP.reflect);
  const out = { upkeep: 0, people: 0, reflect: 0, errors: 0 };
  const go = async (k, tid, ch, o) => { try { const r = await residentOf(tid, ch).memjobRun(k, o); if (r && r.status !== "skipped") out[k]++; } catch (e) { out.errors++; console.log("memjob cron", k, e.message); } };
  const todo = [...up.map((r) => ["upkeep", r.tenant_id, r.channel, { trigger: "cron" }]), ...pe.map((r) => ["people", r.tenant_id, r.channel, { trigger: "cron" }]),
    ...re.map((r) => ["reflect", r.tenant_id, "main", { trigger: "cron", nightly: true }])];
  // A few at a time (each run is a couple of short model calls), so a busy hour stays well inside the cron's time.
  await Promise.all(Array.from({ length: 6 }, async () => { for (let x; (x = todo.shift());) await go(...x); }));
  return out;
}
