// The Composio transport (10-06, composio-upgrade stage 2): ONE interface between 1Helm and Composio, with two backends.
//   search(want, ctx)              → { actions, plan, pitfalls, difficulty, connection, via } for one app (ctx.app)
//   describe(slugs, ctx)           → { SLUG: meta } (read-only or not, version, input names, slim inputs) for app_run's checks
//   execute(slug, args, version, ctx) → the action's data (throws Error on failure)
//   multiExecute(reads, ctx)       → [{ slug, ok, data | error }] in the same order (READS ONLY: the caller checked each one)
//   proxy(req, ctx)                → { status, data, binary? }: one raw call to the app's own API (stage 3, app_proxy; the caller checked
//                                     it: GET, or a write the person confirmed). Self-managed: not offered (throws, e.unsupported).
//   listConnections(opts) / connectLink(toolkit, callbackUrl) / removeConnection(id)
// Every 1Helm safety rule sits ABOVE this file and applies to both backends: the confirm card (confirm.js) for writes, account picking (default,
// notes, ask-first), unconnected apps refused before anything is sent, the retired googlesuper rule, permission levels, lean results and
// the work log, the spend guard (composio.js runAppTool / runGoogleTool, resident.js, ask-first.js, perms.js, worklog.js). The transport
// only moves requests; it never decides whether something may run.
// Hard rules here: Composio's own meta tools (search, multi-execute, manage connections, workbench / bash, instant tools…) are never
// runnable through execute() and never shown as actions; the session has the sandbox, connection management, proxy and instant tools off.
//
// Managed backend (now): 1Helm's Composio project (scoped key, REST v3.1, composio-api.js), user_id "1hc:<tenant>".
//   On the latest toolkit versions (env COMPOSIO_TOOLKIT_VERSION="latest", dev) it uses a Composio SESSION per 1Helm task: created on
//   the task's first app use, its id kept with the task in the Resident (ctx.store) and reused; a new task gets a new one. Search is the
//   session's COMPOSIO_SEARCH_TOOLS (plans, pitfalls, difficulty); execute is the session's execute; several reads at once are one
//   COMPOSIO_MULTI_EXECUTE_TOOL call. Sessions always run an action's latest version, which is the version app_actions listed through the
//   same session; a call that needs one exact version (1Helm's own Gmail / Calendar tools, OWN_VERSIONS) goes direct with that version.
//   On the pinned version (prod today) everything goes direct (GET /tools search, POST /tools/execute), since sessions can't pin.
//   A session that can't be made or used (permissions, Composio down) falls back to direct for search and reads; a write whose outcome is
//   unknown is never retried (stage 6: not by composio-api.js either, and a 429 that Composio gave up on isn't sent again by a fallback).
// Self-managed backend (part 2, MANAGED-AND-SELF-MANAGED.md): the person's own Composio account through Connect MCP with their token.
//   selfManagedTransport() below has the same contract over the MCP client in composio-self.js (COMPOSIO_SEARCH_TOOLS / MULTI_EXECUTE_TOOL /
//   MANAGE_CONNECTIONS / GET_TOOL_SCHEMAS); composio-self.js also owns the choice, the sign-in and the tokens. transportFor() picks the side.
import { composioRequest, latestVersion, versionQuery, toolVersion } from "./composio-api.js";
import { fileStoreFetch } from "./composio-files.js";
// Stage 6: composioRequest retries reads and never re-sends a write whose outcome is unknown (its rules: composio-api.js). Each call here says
// which it is (retry: "read" | "write"); a rate-limited or may-or-may-not-have-happened error is never re-sent by a fallback below.
const settled = (e) => e?.unknownOutcome || e?.rateLimited;
import { slimInputs, exampleOf, cleanWant, fileInputs } from "./composio-schema.js";
import { listManagedConnections, appConnectLink, appDisconnect, defaultsOf, notesOf, dropNotes, appName } from "./composio.js";   // a cycle on purpose: used only at call time
import { appsMode, mcpCaller, isEnded, selfApps, rememberApps, SELF_DEFAULT_APPS, LIST } from "./composio-self.js";

const uid = (tenantId) => `1hc:${tenantId}`;
// Composio's meta / helper tools: never an action the helper can see or run (BRIEF hard rule 4).
export const META_TOOLS = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MULTI_EXECUTE_TOOL", "COMPOSIO_EXECUTE_TOOL",
  "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_WAIT_FOR_CONNECTIONS", "COMPOSIO_REMOTE_WORKBENCH", "COMPOSIO_REMOTE_BASH_TOOL", "COMPOSIO_SUBMIT_FEEDBACK",
  "COMPOSIO_INITIATE_CONNECTION", "COMPOSIO_CHECK_ACTIVE_CONNECTION", "COMPOSIO_LIST_TOOLKITS", "COMPOSIO_GET_REQUIRED_PARAMETERS",
  "COMPOSIO_SEARCH_SKILLS", "COMPOSIO_USE_SKILL", "COMPOSIO_MANAGE_SKILL"]);   // Connect MCP's skill tools (10-06 tools/list): COMPOSIO_SEARCH_SKILLS would pass the composio_search rule below
// Anything in Composio's own "composio" toolkit is meta; the built-in composio_search toolkit (web/news search) is an ordinary app.
export const isMetaTool = (slug) => { const s = String(slug || "").toUpperCase(); return META_TOOLS.has(s) || (s.startsWith("COMPOSIO_") && !s.startsWith("COMPOSIO_SEARCH_")); };
export const isMetaToolkit = (slug) => String(slug || "").toLowerCase() === "composio";

// What app_run needs to know about one action: its app, read-only or not, the exact version, its input names (to catch renamed inputs).
export const metaOf = (t, app) => ({ slug: t.slug, app: (app || t.toolkit?.slug || "").toLowerCase(), readonly: (t.tags || []).includes("readOnlyHint"),
  destructive: (t.tags || []).includes("destructiveHint"), version: t.version || undefined, inputs: Object.keys(t.input_parameters?.properties || {}),
  open: !!t.input_parameters?.additionalProperties, schema: slimInputs(t.input_parameters), files: fileInputs(t.input_parameters) });
// One action as the helper sees it in app_actions.
export const actionView = (t) => {
  const e = exampleOf(t.input_parameters);
  return { action: t.slug, does: String(t.description || t.name || "").replace(/\s+/g, " ").slice(0, 300), read_only: (t.tags || []).includes("readOnlyHint"),
    inputs: slimInputs(t.input_parameters), ...(e ? { example: e } : {}) };
};

// Single-item actions before bulk / admin ones, unless the want asks for many.
const BULK = /(^|_)(BATCH|BULK|MULTI|MULTIPLE|MASS|IMPORT|EXPORT|ADMIN|ACL|PERMISSIONS?|SETTINGS?|WATCH|STOP_CHANNEL|DELEGATES?|DOMAINS?|CLEAR|EMPTY_TRASH|DELETE_ALL|ALL)(_|$)/;
export const wantsBulk = (want) => /\b(bulk|batch|many|several|multiple|all|every|each|lots|hundreds|dozens|mass|everything)\b/i.test(String(want || ""));
export function rankActions(slugs, want) {
  const bulkOk = wantsBulk(want);
  return [...slugs].map((s, i) => [s, i + (!bulkOk && BULK.test(s) ? 1000 : 0)]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
}

// Plans and pitfalls from Composio, kept short for the model. Composio writes them for its own agents, which have a remote workbench
// (COMPOSIO_REMOTE_WORKBENCH / COMPOSIO_REMOTE_BASH_TOOL: a sandbox to batch sends, checkpoint, stage uploads, reshape big results).
// The helper never has those (hard rule 4), so a line that names one is rewritten or dropped (noWorkbench): working on data it
// already has (parse, reshape, merge, shortlist, pad…) becomes "your computer (run_command)"; batching, checkpointing, staging or
// orchestrating through the workbench is dropped, as is a pitfall about the workbench itself. Asides "( … )" and "; …" clauses go
// on their own, so the rest of the step stays.
export const WORKBENCH_RE = /COMPOSIO_REMOTE_WORKBENCH|COMPOSIO_REMOTE_BASH(?:_TOOL)?|remote (?:workbench|bash(?: tool)?|sandbox)|\bworkbench\b/gi;
const hasWb = (s) => { WORKBENCH_RE.lastIndex = 0; const r = WORKBENCH_RE.test(s); WORKBENCH_RE.lastIndex = 0; return r; };
const DATA_WORK = /\b(pars|reshap|merg|shortlist|summari[sz]|locat|pad|normali[sz]|filter|export|prepar|sort|de-?dup|count|compar|transform|extract)/i;
const OURS = "your computer (run_command)";
// One clause: kept, rewritten to the computer, or null (dropped).
const wbClause = (c) => !hasWb(c) ? c : DATA_WORK.test(c) ? c.replace(WORKBENCH_RE, OURS) : null;
// "a; b; c" → the clauses that survive (the first one is the step itself: rewritten rather than dropped when it can be).
function wbClauses(text, keepFirst) {
  const parts = text.split(/;\s*/), out = [];
  parts.forEach((p, i) => { const tail = p.match(/[).\]]*$/)[0], body = p.slice(0, p.length - tail.length); const f = wbClause(body);
    if (f != null) out.push(f + tail); else if (i === 0 && keepFirst) out.push(null); else if (tail && out.length) out[out.length - 1] += tail; });
  return out.includes(null) ? null : out.join("; ");
}
export function noWorkbench(line) {
  let s = String(line || ""); if (!hasWb(s)) return s;
  if (/^\s*\[(COMPOSIO_REMOTE_\w+|[^\]]*workbench[^\]]*)\]/i.test(s)) return null;   // a pitfall about the workbench itself
  // asides: "(Optional: use the workbench for …)" goes; "(re-run smaller; if still offloaded, shortlist via the workbench)" keeps its first clause
  s = s.replace(/\s*\(((?:[^()]|\([^()]*\))*)\)/g, (m, inner) => { if (!hasWb(inner)) return m; const k = wbClauses(inner, false); return k && k.trim() ? `${m.match(/^\s*/)[0]}(${k})` : ""; });
  if (!hasWb(s)) return s.replace(/\s+([.,;])/g, "$1");
  const k = wbClauses(s, true);
  return k == null || hasWb(k) && !k.includes(OURS) ? null : k.replace(/\s+([.,;])/g, "$1");
}
const lines = (xs, n, len) => (Array.isArray(xs) ? xs : []).map((x) => String(typeof x === "string" ? x : x?.text || "").replace(/\s+/g, " ").trim()).map(noWorkbench).filter(Boolean).slice(0, n).map((x) => (x.length > len ? x.slice(0, len - 1) + "…" : x));

// ---- the Composio session store: one session per 1Helm task (ctx.store from the Resident, else this run's ctx) ----
// rec = { id, sig }: sig = which toolkits and accounts the session was made with; a change (an app connected mid-task) updates it.
const storeOf = (ctx = {}) => ctx.store || { get: () => ctx._composioSession || null, set: (r) => { ctx._composioSession = r; } };
const count = (ctx, kind, ms) => { const s = ctx?.stats; if (!s) return; s.calls = (s.calls || 0) + 1; s[kind] = (s[kind] || 0) + 1; s.ms = (s.ms || 0) + ms; };
async function req(env, ctx, kind, path, init) { const t0 = Date.now(); try { return await composioRequest(env, path, init); } finally { count(ctx, kind, Date.now() - t0); } }

// The session's config: the person's connected apps + built-in ones (ctx.toolkits), their live accounts pinned per app (ctx.accounts:
// { toolkit: [connected account ids] }, so the session uses exactly the accounts 1Helm picks between, on the auth config they were made
// with), multi-account on (1Helm passes the account on every call), sandbox / connection management / proxy / instant tools off.
// (proxy_execute off keeps any proxy tool away from a model on the session; 1Helm's own app_proxy calls the session's proxy_execute
// route, which it doesn't block: live check 10-06.)
export function sessionConfig(tenantId, ctx = {}) {
  const toolkits = [...new Set((ctx.toolkits || []).map((s) => String(s).toLowerCase()).filter((s) => s && !isMetaToolkit(s)))].sort();
  const pins = {}; for (const [k, ids] of Object.entries(ctx.accounts || {})) if (toolkits.includes(k) && ids?.length) pins[k] = [...ids].sort().slice(0, 10);
  return { user_id: uid(tenantId), toolkits: { enable: toolkits }, ...(Object.keys(pins).length ? { connected_accounts: pins } : {}),
    multi_account: { enable: true, max_accounts_per_toolkit: 10, require_explicit_selection: false },
    workbench: { enable: false }, manage_connections: { enable: false }, proxy_execute: { enable: false }, instant: false };
}
export const PROXY_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const sigOf = (cfg) => JSON.stringify([cfg.toolkits.enable, cfg.connected_accounts || {}]);
const SESSION_GONE = /not found|expired|deleted|invalid session|trs_/i;
const DESC_CACHE = new Map(), DESC_TTL = 600e3;

export function managedTransport(env, tenantId, ctx0 = {}) {
  const sessionsOn = () => latestVersion(env) && env.COMPOSIO_SESSIONS !== "off";
  // The task's session id: reused; made on first use; updated when the person's apps changed since.
  async function session(ctx, fresh = false) {
    const st = storeOf(ctx), cfg = sessionConfig(tenantId, ctx), sig = sigOf(cfg);
    let rec = fresh ? null : st.get();
    if (rec?.id && rec.sig === sig) return rec.id;
    if (rec?.id) {
      try {
        await req(env, ctx, "session_update", `/tool_router/session/${encodeURIComponent(rec.id)}`, { method: "PATCH", retry: "read", body: JSON.stringify({ toolkits: cfg.toolkits, connected_accounts: cfg.connected_accounts || {} }) });
        st.set({ id: rec.id, sig }); return rec.id;
      } catch (e) { if (!SESSION_GONE.test(e.message)) throw e; }
    }
    const d = await req(env, ctx, "session_create", "/tool_router/session", { method: "POST", retry: "read", body: JSON.stringify(cfg) });   // a spare session is harmless
    if (!d.session_id) throw new Error("Composio made no session.");
    // Belt and braces: the session must not offer the sandbox, connection management or instant tools.
    const bad = (d.tool_router_tools || []).filter((s) => /WORKBENCH|BASH|MANAGE_CONNECTIONS|WAIT_FOR_CONNECTIONS|INSTANT/i.test(s));
    if (bad.length) throw new Error(`Composio session has tools 1Helm never uses (${bad.join(", ")}).`);
    st.set({ id: d.session_id, sig }); return d.session_id;
  }
  // A session call; a session Composio no longer knows is made again once (a 404 for the session: nothing ran). retry: "read" | "write".
  async function inSession(ctx, kind, sub, body, retry = "write") {
    let id; try { id = await session(ctx); } catch (e) { if (!e.rateLimited) e.beforeRun = true; throw e; }   // no session: nothing was sent to the app
    try { return await req(env, ctx, kind, `/tool_router/session/${encodeURIComponent(id)}${sub}`, { method: "POST", retry, body: JSON.stringify(body) }); }
    catch (e) {
      if (settled(e) || !/HTTP 404|not found|expired/i.test(e.message) || /tool .* not found/i.test(e.message)) throw e;
      try { id = await session(ctx, true); } catch (e2) { if (!e2.rateLimited) e2.beforeRun = true; throw e2; }
      return await req(env, ctx, kind, `/tool_router/session/${encodeURIComponent(id)}${sub}`, { method: "POST", retry, body: JSON.stringify(body) });
    }
  }
  // Tool metadata (tags → read-only, version, full input schema) for a few slugs in one listing call, on this server's version.
  // Kept 10 minutes per isolate (public catalog data, the same for everyone), so a task's later searches don't ask again.
  async function describe(slugs, ctx = ctx0) {
    const want = [...new Set((slugs || []).map((s) => String(s || "").toUpperCase().replace(/[^A-Z0-9_]/g, "")).filter((s) => s && !isMetaTool(s)))];
    if (!want.length) return {};
    const out = {}, v = latestVersion(env) ? "L" : "P", now = Date.now();
    for (const s of want) { const c = DESC_CACHE.get(`${v}:${s}`); if (c && now - c.at < DESC_TTL) out[s] = c.t; }
    const miss = want.filter((s) => !out[s]);
    const keep = (t) => { if (t?.slug && !isMetaToolkit(t.toolkit?.slug)) { out[t.slug] = t; if (DESC_CACHE.size > 800) DESC_CACHE.clear(); DESC_CACHE.set(`${v}:${t.slug}`, { t, at: now }); } };
    if (miss.length === 1) keep(await req(env, ctx, "tools", `/tools/${miss[0]}${versionQuery(env, true)}`).catch(() => null));
    else if (miss.length) for (const t of (await req(env, ctx, "tools", `/tools?tool_slugs=${miss.join(",")}&limit=${Math.min(50, miss.length)}${versionQuery(env)}`).catch(() => ({}))).items || []) keep(t);
    return out;
  }
  // The legacy search: Composio's tool listing for one app with our own top-up ranking (small apps).
  async function directSearch(want, ctx) {
    const app = ctx.app;
    let list = (await req(env, ctx, "tools", `/tools?toolkit_slug=${app}&query=${encodeURIComponent(want)}&limit=8${versionQuery(env)}`)).items || [];
    if (list.length < 3) {
      const words = String(want).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2), all = (await req(env, ctx, "tools", `/tools?toolkit_slug=${app}&limit=100${versionQuery(env)}`)).items || [];
      const score = (t) => { const h = `${t.slug} ${t.name} ${t.description}`.toLowerCase(); return words.reduce((n, w) => n + (h.includes(w) ? 1 : 0), 0); };
      const seen = new Set(list.map((t) => t.slug)); list = [...list, ...all.filter((t) => !seen.has(t.slug)).map((t) => [score(t), t]).sort((x, y) => y[0] - x[0]).slice(0, 8 - list.length).map((x) => x[1])];
    }
    return list.filter((t) => !isMetaTool(t.slug));
  }
  return {
    kind: "managed",
    sessionsOn,
    describe,
    // Stage one file for an action's FileUploadable input (stage 4, composio-files.js): Composio's upload request (POST /files/upload/request
    // → an object-storage key + a presigned upload URL), then the bytes PUT straight to that URL (never through Composio's API, and never
    // with 1Helm's key). f = { toolkit, tool, name, mimetype, bytes, md5 } → { name, mimetype, s3key }. The URL is used once, here.
    async stageFile(f, ctx = ctx0) {
      const d = await req(env, ctx, "file_stage", "/files/upload/request", { method: "POST", retry: "read", body: JSON.stringify({ toolkit_slug: f.toolkit, tool_slug: f.tool, filename: f.name, mimetype: f.mimetype, md5: f.md5 }) });
      if (!d?.key) throw new Error("Composio gave no place to upload the file.");
      const url = d.new_presigned_url || d.newPresignedUrl;
      if (url) {
        if (!/^https:\/\//i.test(url)) throw new Error("Composio's upload address isn't https.");
        const headers = { "content-type": f.mimetype, ...(d.metadata?.storage_backend === "azure_blob_storage" ? { "x-ms-blob-type": "BlockBlob" } : {}) };
        const t0 = Date.now(); let r; try { r = await fileStoreFetch(url, { method: "PUT", body: f.bytes, headers, signal: AbortSignal.timeout(60000) }); } finally { count(ctx, "file_put", Date.now() - t0); }
        if (!r.ok) throw new Error(`Uploading the file to Composio failed (HTTP ${r.status}).`);
      }   // no URL: Composio already has these exact bytes (same md5)
      return { name: f.name, mimetype: f.mimetype, s3key: String(d.key) };
    },
    // want: the helper's plain words. Only a cleaned copy (no personal data) reaches Composio.
    async search(want, ctx = ctx0) {
      const app = String(ctx.app || "").toLowerCase(), name = ctx.appName || app;
      const q = cleanWant(want, [name, app]);
      const base = { app, query: q, plan: [], pitfalls: [], difficulty: "", via: "direct" };
      if (!sessionsOn()) { const tools = await directSearch(q, { ...ctx, app }); return { ...base, tools: rankActions(tools.map((t) => t.slug), want).map((s) => tools.find((t) => t.slug === s)) }; }
      let r;
      try {
        const useCase = new RegExp(`\\b${name.replace(/[^\w ]/g, "")}\\b`, "i").test(q) ? q : `${name}: ${q}`;
        r = await inSession(ctx, "search", "/search", { queries: [{ use_case: useCase.slice(0, 1000) }] }, "read");
      } catch (e) {
        if (e.rateLimited) throw e;   // the direct search shares the same limit
        console.log("composio session search fell back to direct:", String(e.message).slice(0, 160));
        const tools = await directSearch(q, { ...ctx, app }); return { ...base, tools: rankActions(tools.map((t) => t.slug), want).map((s) => tools.find((t) => t.slug === s)), fallback: true };
      }
      const res = (r.results || [])[0] || {}, inApp = (s) => String(s).toLowerCase().startsWith(`${app}_`) && !isMetaTool(s);
      const slugs = rankActions([...(res.primary_tool_slugs || []), ...(res.related_tool_slugs || [])].filter(inApp), want).slice(0, 8);
      // Full metadata (tags, version, schema) for the matches in one call; the search's own schema when the listing misses one.
      const meta = await describe(slugs, ctx);
      let tools = slugs.map((s) => meta[s] || (r.tool_schemas?.[s]?.input_schema ? { slug: s, description: r.tool_schemas[s].description, input_parameters: r.tool_schemas[s].input_schema, tags: [], toolkit: { slug: app } } : null)).filter(Boolean);
      if (tools.length < 3) {   // Composio's search found little in this app: top up from the app's own listing
        const more = await directSearch(q, { ...ctx, app }).catch(() => []), seen = new Set(tools.map((t) => t.slug));
        tools = [...tools, ...more.filter((t) => !seen.has(t.slug))].slice(0, 8);
      }
      const st = (r.toolkit_connection_statuses || []).find((x) => x.toolkit === app);
      return { ...base, via: "session", tools, plan: lines(res.recommended_plan_steps, 10, 320), pitfalls: lines(res.known_pitfalls, 8, 320),
        difficulty: String(res.difficulty || "").slice(0, 120), composio_connected: st ? !!st.has_active_connection : undefined };
    },
    // version: the version app_actions listed (sessions: the latest), or an exact one with ctx.exactVersion (1Helm's own tools).
    // ctx.account: the connected account id 1Helm picked (null for built-in apps). ctx.readonly: the caller checked it's a read.
    async execute(slug, args, version, ctx = ctx0) {
      slug = String(slug || "").toUpperCase();
      if (isMetaTool(slug)) throw new Error(`${slug} is one of Composio's own tools, which 1Helm never runs.`);
      if (sessionsOn() && !ctx.exactVersion) {
        if (ctx.readonly && ctx.batch) return ctx.batch.add({ slug, args, account: ctx.account || null }, ctx);
        let d;
        try { d = await inSession(ctx, "execute", "/execute", { tool_slug: slug, arguments: args || {}, ...(ctx.account ? { account: ctx.account } : {}) }, ctx.readonly ? "read" : "write"); }
        catch (e) {
          if (settled(e)) throw e;
          // No session could be made: nothing ran, so the call goes direct. A read the session refused (a permission) may go direct too;
          // a write whose outcome is unknown never runs twice.
          if (e.beforeRun) { console.log("composio session unavailable, running direct:", String(e.message).slice(0, 160)); return directExec(slug, args, version, ctx); }
          if (ctx.readonly && /HTTP 40[13]|didn't accept|access/i.test(e.message)) return directExec(slug, args, version, ctx);
          throw e;
        }
        if (d.error) throw new Error(String(d.error).slice(0, 300));
        return d.data?.response_data ?? d.data;
      }
      return directExec(slug, args, version, ctx);
    },
    // Several reads in one Composio call (COMPOSIO_MULTI_EXECUTE_TOOL). reads: [{ slug, args, account }]; at most 50.
    async multiExecute(reads, ctx = ctx0) {
      const list = (reads || []).slice(0, 50);
      for (const x of list) if (isMetaTool(x.slug)) throw new Error(`${x.slug} is one of Composio's own tools, which 1Helm never runs.`);
      if (!list.length) return [];
      if (!sessionsOn() || list.length === 1) return Promise.all(list.map((x) => directOrSession(x, ctx)));
      let d;
      try { d = await inSession(ctx, "multi_execute", "/execute_meta", { slug: "COMPOSIO_MULTI_EXECUTE_TOOL", arguments: { tools: list.map((x) => ({ tool_slug: x.slug, arguments: x.args || {}, ...(x.account ? { account: x.account } : {}) })), thought: "1Helm reads", current_step: "READING" } }, "read"); }
      catch (e) { if (e.rateLimited) throw e; console.log("composio multi-execute fell back to one by one:", String(e.message).slice(0, 160)); return Promise.all(list.map((x) => directOrSession(x, ctx))); }
      const rs = d.data?.results || [];
      return list.map((x, i) => {
        const r = rs.find((y) => y.index === i) || rs[i] || {};
        if (r.error || r.response?.successful === false) return { slug: x.slug, ok: false, error: String(r.error || r.response?.error || "the app said no").slice(0, 300) };
        const data = r.response?.data; return { slug: x.slug, ok: true, data: data?.response_data ?? data };
      });
    },
    // One call to the app's own API (stage 3, app_proxy). r = { toolkit, endpoint (relative to the app's API base, or an absolute URL on
    // its domain), method, query: { name: value | [values] }, body }. ctx.account: the connected account 1Helm picked; ctx.accounts[toolkit]:
    // that app's live accounts. → { status, data, binary? }: the upstream's own status (the caller words errors). Composio's session proxy
    // ignores any account choice (live check 10-06: 6 Gmail accounts, `account` / `connected_account_id` → always the first one), so the
    // session proxy is used only when the session holds just that one account for the app; with several (or sessions off) it's the direct
    // proxy with connected_account_id, so the call always runs as the account 1Helm picked. Sent once: never retried after it may have run.
    async proxy(r, ctx = ctx0) {
      const toolkit = String(r?.toolkit || "").toLowerCase(), method = String(r?.method || "GET").toUpperCase();
      if (!toolkit || isMetaToolkit(toolkit) || toolkit.startsWith("composio")) throw new Error("1Helm never calls Composio's own API through app_proxy.");
      if (!PROXY_METHODS.has(method)) throw new Error(`app_proxy can't send ${method}.`);
      const params = []; for (const [name, v] of Object.entries(r.query || {})) for (const x of (Array.isArray(v) ? v : [v])) if (x != null) params.push({ name: String(name), value: typeof x === "object" ? JSON.stringify(x) : String(x), type: "query" });
      const call = { endpoint: String(r.endpoint || ""), method, ...(params.length ? { parameters: params } : {}), ...(method !== "GET" && r.body != null ? { body: r.body } : {}) };
      const pinned = (ctx.accounts || {})[toolkit] || [], one = !ctx.account || (pinned.length === 1 && pinned[0] === ctx.account);
      const retry = method === "GET" ? "read" : "write";
      const direct = () => req(env, ctx, "proxy", "/tools/execute/proxy", { method: "POST", retry, body: JSON.stringify({ ...call, ...(ctx.account ? { connected_account_id: ctx.account } : {}) }) });
      let d;
      if (sessionsOn() && one) {
        try { d = await inSession(ctx, "proxy", "/proxy_execute", { toolkit_slug: toolkit, ...call }, retry); }
        catch (e) {
          if (settled(e)) throw e;
          if (e.beforeRun) { console.log("composio session unavailable, proxy direct:", String(e.message).slice(0, 160)); d = await direct(); }   // nothing was sent
          else if (method === "GET" && /HTTP 40[13]|didn't accept|access/i.test(e.message)) d = await direct();   // a read the session refused
          else throw e;
        }
      } else d = await direct();
      return { status: Number(d?.status) || 0, data: d?.data ?? null, ...(d?.binary_data ? { binary: { type: d.binary_data.content_type, size: d.binary_data.size } } : {}) };
    },
    listConnections: (opts) => listManagedConnections(env, tenantId, opts),
    connectLink: (toolkit, callbackUrl) => appConnectLink(env, tenantId, toolkit, callbackUrl),
    removeConnection: (id) => appDisconnect(env, tenantId, id),
  };
  async function directOrSession(x, ctx) {
    try { return { slug: x.slug, ok: true, data: await (sessionsOn() ? inSession(ctx, "execute", "/execute", { tool_slug: x.slug, arguments: x.args || {}, ...(x.account ? { account: x.account } : {}) }, "read").then((d) => { if (d.error) throw new Error(String(d.error)); return d.data?.response_data ?? d.data; }) : directExec(x.slug, x.args, undefined, { ...ctx, account: x.account, readonly: true })) }; }
    catch (e) { return { slug: x.slug, ok: false, error: String(e.message || e).slice(0, 300) }; }
  }
  // Direct execution with an exact version (none = this server's version: "latest" or the pinned one; v3.1 would otherwise run latest).
  async function directExec(slug, args, version, ctx) {
    const body = { user_id: uid(tenantId), arguments: args || {}, version: version || toolVersion(env) };
    if (ctx.account) body.connected_account_id = ctx.account;
    const d = await req(env, ctx, "execute", `/tools/execute/${slug}`, { method: "POST", retry: ctx.readonly ? "read" : "write", body: JSON.stringify(body) });
    if (!d.successful) throw new Error(String(d.error || "the app said no").slice(0, 300));
    return d.data?.response_data ?? d.data;
  }
}

// ---- several reads in one step → one multi-execute ----
// The Resident runs a model step's app_run calls so that each one passes every check on its own, in order (ask-first, permissions, the
// work log, read-only, account); a read that reaches execute() waits here instead of running, and flush() sends all of them as one
// COMPOSIO_MULTI_EXECUTE_TOOL call. Anything that arrives after the flush (or a write) runs on its own, as before.
export class ReadBatch {
  constructor(transport) { this.t = transport; this.items = []; this.closed = false; this.waiters = []; }
  // → a promise for this read's data; tells the Resident (onQueued) that the call is parked.
  add(x, ctx) {
    if (this.closed) return this.t.execute(x.slug, x.args, undefined, { ...ctx, batch: null });
    return new Promise((resolve, reject) => { this.items.push({ x, resolve, reject, ctx }); for (const w of this.waiters.splice(0)) w(); ctx.onQueued?.(); });
  }
  get size() { return this.items.length; }
  // The turn stopped: parked reads never run.
  cancel(why = "stopped") { this.closed = true; for (const it of this.items.splice(0)) it.reject(new Error(why)); }
  async flush() {
    if (this.closed) return; this.closed = true;
    const items = this.items.splice(0); if (!items.length) return;
    if (items.length === 1) { const it = items[0]; try { it.resolve(await this.t.execute(it.x.slug, it.x.args, undefined, { ...it.ctx, batch: null })); } catch (e) { it.reject(e); } return; }
    let rs; try { rs = await this.t.multiExecute(items.map((it) => it.x), items[0].ctx); } catch (e) { for (const it of items) it.reject(e); return; }
    items.forEach((it, i) => { const r = rs[i]; if (r?.ok) it.resolve(r.data); else it.reject(new Error(r?.error || "the app said no")); });
  }
}

// ---- Self-managed backend (part 2): the person's own Composio through Connect MCP ----
// mcp(toolName, args) → the tool's parsed result ({ data, error, successful }): composio-self.js mcpCall (streamable-HTTP JSON-RPC to
// connect.composio.dev/mcp with the person's token, re-initialize on 400/404, refresh-token rotation saved; only four tools, never the
// workbench / bash). catalog: a managed transport for PUBLIC tool metadata (tags → read-only or not, versions, schemas), which isn't per
// person; whatever it misses comes from the person's COMPOSIO_GET_TOOL_SCHEMAS (no tags there, so such an action counts as a write and
// needs the tap on a confirm card). env (optional): D1 for the toolkits to list, 1Helm's default-account picks, account notes, and app names.
// Same contract as the managed one; the 1Helm rules above apply unchanged.
// Not offered here (hide or explain, never fake): exact versions (Connect MCP runs the latest; 1Helm's own Gmail/Calendar tools run on it
// too), proxy (proxy() says so), triggers. Connections go through MANAGE_CONNECTIONS with toolkits: [{ name, action }] objects (the wrong
// shape made junk "initializing" connections in testing): always "list" before "add", and a remove is confirmed by listing again.
// Connect MCP lists connections per toolkit name only, so listConnections asks about the common toolkits plus every toolkit this workspace
// connected or used through 1Helm (composio-self.js selfApps).
const CONNECT_TOOLS_OK = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_MULTI_EXECUTE_TOOL", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_GET_TOOL_SCHEMAS"]);
const SLUG_RE = /^[a-z0-9_]{2,64}$/;
const LIVE_ST = /^active$/i, KEEP_ST = /^(active|expired|failed|inactive|disabled)$/i;   // initiated / initializing = an unfinished sign-in: left out
export function selfManagedTransport({ mcp, catalog, tenantId = "", env = null } = {}) {
  const call = async (tool, args, opts) => { if (!CONNECT_TOOLS_OK.has(tool)) throw new Error(`1Helm never calls ${tool}.`); return mcp(tool, args, opts); };
  const dataOf = (d) => d?.data ?? d ?? {};
  const sidOf = (ctx) => { const r = storeOf(ctx).get(); return r?.sig === "connect" ? r.id : null; };   // the task's Connect search session
  // read: the caller checked every action is read-only (stage 6: only then is a timeout / 5xx retried; see composio-self.js mcpCall).
  const multi = async (list, ctx = {}, read = false) => {
    const sid = sidOf(ctx);
    const d = dataOf(await call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: list.map((x) => ({ tool_slug: x.slug, arguments: x.args || {}, ...(x.account ? { account: x.account } : {}) })),
      sync_response_to_workbench: false, thought: "1Helm", current_step: "RUNNING", ...(sid ? { session_id: sid } : {}) }, { read }));
    const rs = d.results || [];
    return list.map((x, i) => { const r = rs.find((y) => y.index === i) || rs[i] || {}; if (r.error || r.response?.successful === false) return { slug: x.slug, ok: false, error: String(r.error || r.response?.error || "the app said no").slice(0, 300) }; const data = r.response?.data; return { slug: x.slug, ok: true, data: data?.response_data ?? data }; });
  };
  // Metadata: the public catalog first (tags matter: read-only or not), then the person's own schemas for anything it misses.
  async function describe(slugs, ctx = {}, schemas = null) {
    const want = [...new Set((slugs || []).map((s) => String(s || "").toUpperCase().replace(/[^A-Z0-9_]/g, "")).filter((s) => s && !isMetaTool(s)))];
    if (!want.length) return {};
    let out = {}; try { out = { ...(await catalog.describe(want, ctx)) }; } catch {}
    const miss = want.filter((s) => !out[s]);
    if (miss.length) {
      const byslug = (x) => { const o = {}; if (Array.isArray(x)) for (const t of x) o[String(t?.tool_slug || t?.slug || "").toUpperCase()] = t; else Object.assign(o, x || {}); return o; };
      let sch = byslug(schemas);
      const still = miss.filter((s) => !(sch[s]?.input_schema || sch[s]?.input_parameters));
      if (still.length) { try { const g = dataOf(await call("COMPOSIO_GET_TOOL_SCHEMAS", { tool_slugs: still })); sch = { ...sch, ...byslug(g.tool_schemas || g.schemas || g.tools || g.results) }; } catch (e) { if (isEnded(e)) throw e; } }
      for (const s of miss) { const x = sch[s], inp = x?.input_schema || x?.input_parameters; if (inp) out[s] = { slug: s, description: x.description || "", input_parameters: inp, tags: Array.isArray(x.tags) ? x.tags : [], toolkit: { slug: String(x.toolkit?.slug || x.toolkit || s.split("_")[0]).toLowerCase() } }; }
    }
    return out;
  }
  // Every account in the toolkits asked about, as listManagedConnections rows ({ id, app, name, status, email, label, default, memo? }).
  async function listConnections({ app = "", fresh = false, names = true } = {}) {
    app = String(app || "").toLowerCase();
    const c = tenantId && LIST.get(tenantId);
    if (!fresh && c && Date.now() - c.at < 15000) return app ? c.list.filter((x) => x.app === app) : c.list;
    const known = env && tenantId ? await selfApps(env, tenantId) : [];
    const ask = (xs) => call("COMPOSIO_MANAGE_CONNECTIONS", { toolkits: [...new Set(xs)].filter((s) => SLUG_RE.test(s)).slice(0, 60).map((name) => ({ name, action: "list" })) });
    let d;
    try { d = dataOf(await ask([...SELF_DEFAULT_APPS, ...known, ...(app ? [app] : [])])); }
    catch (e) { if (isEnded(e) || (!known.length && !app)) throw e; d = dataOf(await ask(SELF_DEFAULT_APPS)); }   // a toolkit Composio no longer knows: the common ones still list
    const [pref, memos] = env?.DB && tenantId ? await Promise.all([defaultsOf(env, tenantId), notesOf(env, tenantId)]) : [{}, {}];
    const out = [], n = {}, nameOf = new Map();
    for (const [tk, r] of Object.entries(d.results || {})) for (const a of r?.accounts || []) {
      if (!a?.id || !KEEP_ST.test(String(a.status || ""))) continue;
      if (!nameOf.has(tk)) nameOf.set(tk, names && env ? await appName(env, tk).catch(() => tk) : tk);
      n[tk] = (n[tk] || 0) + 1;
      const u = a.user_info || {}, email = String(u.email || u.username || u.login || u.name || a.alias || "").replace(/\s+/g, " ").trim().slice(0, 80);
      out.push({ id: String(a.id), app: tk, name: nameOf.get(tk), logo: `https://logos.composio.dev/api/${tk}`, status: LIVE_ST.test(String(a.status)) ? "connected" : "expired", email, label: email || `Account ${n[tk]}`,
        default: false, _def: !!a.is_default, since: a.created_at || "", via: "self", ...(memos[a.id] ? { memo: memos[a.id] } : {}) });
    }
    for (const tk of new Set(out.map((x) => x.app))) { const live = out.filter((x) => x.app === tk && x.status === "connected"); const def = live.find((x) => x.id === pref[tk]) || live.find((x) => x._def) || live[0]; if (def) def.default = true; }
    for (const x of out) delete x._def;
    const liveApps = [...new Set(out.filter((x) => x.status === "connected").map((x) => x.app))];
    if (env && tenantId && liveApps.some((s) => !known.includes(s))) await rememberApps(env, tenantId, liveApps);
    if (tenantId && !app) LIST.set(tenantId, { at: Date.now(), list: out });
    return app ? out.filter((x) => x.app === app) : out;
  }
  return {
    kind: "self",
    sessionsOn: () => true,
    describe: (slugs, ctx) => describe(slugs, ctx),
    async search(want, ctx = {}) {
      const app = String(ctx.app || "").toLowerCase(), name = ctx.appName || app, q = cleanWant(want, [name, app]);
      const st = storeOf(ctx), sid = sidOf(ctx);
      const useCase = new RegExp(`\\b${name.replace(/[^\w ]/g, "")}\\b`, "i").test(q) ? q : `${name}: ${q}`;
      const d = dataOf(await call("COMPOSIO_SEARCH_TOOLS", { queries: [{ use_case: useCase.slice(0, 1000) }], session: sid ? { id: sid } : { generate_id: true } }));
      if (d.session?.id && d.session.id !== sid) st.set({ id: String(d.session.id), sig: "connect" });
      const res = (d.results || [])[0] || {}, inApp = (s) => String(s).toLowerCase().startsWith(`${app}_`) && !isMetaTool(s);
      const slugs = rankActions([...(res.primary_tool_slugs || []), ...(res.related_tool_slugs || [])].filter(inApp), want).slice(0, 8);
      const meta = await describe(slugs, ctx, d.tool_schemas);
      const tools = slugs.map((s) => meta[s]).filter(Boolean);
      const sts = d.toolkit_connection_statuses || [], stt = sts.find((x) => x.toolkit === app);
      const live = sts.filter((x) => x.has_active_connection).map((x) => x.toolkit);
      if (env && tenantId && live.length) await rememberApps(env, tenantId, live);   // apps they connected in their own Composio dashboard
      return { app, query: q, via: "connect", tools, plan: lines(res.recommended_plan_steps, 10, 320), pitfalls: lines(res.known_pitfalls, 8, 320), difficulty: String(res.difficulty || "").slice(0, 120), composio_connected: stt ? !!stt.has_active_connection : undefined };
    },
    async execute(slug, args, version, ctx = {}) {
      slug = String(slug || "").toUpperCase();
      if (isMetaTool(slug)) throw new Error(`${slug} is one of Composio's own tools, which 1Helm never runs.`);
      if (ctx.readonly && ctx.batch) return ctx.batch.add({ slug, args, account: ctx.account || null }, ctx);
      const [r] = await multi([{ slug, args, account: ctx.account || null }], ctx, ctx.readonly === true);
      if (!r.ok) throw new Error(r.error); return r.data;
    },
    async multiExecute(reads, ctx = {}) { const list = (reads || []).slice(0, 50); for (const x of list) if (isMetaTool(x.slug)) throw new Error(`${x.slug} is one of Composio's own tools, which 1Helm never runs.`); return list.length ? multi(list, ctx, true) : []; },
    // Connect cards own connecting: MANAGE_CONNECTIONS is called here, under them, never as a model tool. Always "list" before "add".
    listConnections,
    // → { url, newtab } (Composio's own page, in a new tab: it can't send the person back here), or { already } when the toolkit already
    // has a live account in their Composio and they didn't ask for another one.
    async connectLink(toolkit, _callbackUrl, { another = false } = {}) {
      toolkit = String(toolkit || "").toLowerCase();
      if (!SLUG_RE.test(toolkit)) throw new Error("Which app?");
      const have = dataOf(await call("COMPOSIO_MANAGE_CONNECTIONS", { toolkits: [{ name: toolkit, action: "list" }] }));
      if (env && tenantId) await rememberApps(env, tenantId, [toolkit]);
      if (tenantId) LIST.delete(tenantId);
      if (!another && (have.results?.[toolkit]?.accounts || []).some((a) => LIVE_ST.test(String(a.status || "")))) return { already: true, app: toolkit };
      const d = dataOf(await call("COMPOSIO_MANAGE_CONNECTIONS", { toolkits: [{ name: toolkit, action: "add" }] }));
      const r = d.results?.[toolkit] || {}, pick = (o) => o && (o.redirect_url || o.redirectUrl || o.auth_url || o.connect_url || o.link || o.url);
      const url = pick(r) || pick((r.accounts || []).find((a) => pick(a))) || JSON.stringify(r).match(/https:\/\/[^"\s\\]+/)?.[0];
      if (!url || !/^https:\/\//.test(url)) throw new Error("Composio returned no sign-in link.");
      return { url, newtab: true };
    },
    // Delete it at Composio, then list again: done only when Composio no longer shows it.
    async removeConnection(id) {
      id = String(id || "");
      const a = (await listConnections({ fresh: true, names: false })).find((x) => x.id === id);
      if (!a) throw new Error("That account isn't yours.");
      try { await call("COMPOSIO_MANAGE_CONNECTIONS", { toolkits: [{ name: a.app, action: "remove", account_id: id }] }); }
      catch (e) { if (!e.unknownOutcome) throw e; }   // no answer: never sent again; the listing below says whether it went
      if (tenantId) LIST.delete(tenantId);
      if ((await listConnections({ app: a.app, fresh: true, names: false })).some((x) => x.id === id)) throw new Error("Composio still shows that account. Try again in a minute.");
      if (env?.DB && tenantId) { await env.DB.prepare("DELETE FROM app_default WHERE tenant_id=? AND account_id=?").bind(tenantId, id).run().catch(() => {}); await dropNotes(env, tenantId, [id]); }
      return { ok: true, confirmed: true };
    },
    // Connect MCP has no proxy outside Composio's sandbox (its proxy_execute is a workbench helper, and the workbench is never used: hard rule 4).
    async proxy() { throw Object.assign(new Error("Calling an app's own API (app_proxy) isn't available with a self-managed Composio account. Use app_actions and app_run."), { unsupported: true }); },
    tenantId,
  };
}

// The transport for one workspace: Managed or Self-managed, from the workspace's choice (composio-self.js appsMode). Resolved on first use
// (so callers stay synchronous); never falls back from one side to the other: a Self-managed workspace whose sign-in ended gets
// "Your Composio sign-in ended" (SignInEnded), not 1Helm's account.
export async function pickTransport(env, tenantId, ctx = {}) {
  if (tenantId && env?.DB && (await appsMode(env, tenantId)) === "self") return selfManagedTransport({ mcp: mcpCaller(env, tenantId), catalog: managedTransport(env, tenantId, ctx), tenantId, env });
  return managedTransport(env, tenantId, ctx);
}
export function transportFor(env, tenantId, ctx = {}) {
  let p = null; const pick = () => (p ||= pickTransport(env, tenantId, ctx));
  const lazy = (k) => async (...a) => { const t = await pick(); if (typeof t[k] !== "function") throw Object.assign(new Error(`${k} isn't available here.`), { unsupported: true }); return t[k](...a); };
  return { kind: "auto", mode: async () => (await pick()).kind, search: lazy("search"), describe: lazy("describe"), execute: lazy("execute"), multiExecute: lazy("multiExecute"), proxy: lazy("proxy"),
    listConnections: lazy("listConnections"), connectLink: lazy("connectLink"), removeConnection: lazy("removeConnection"),
    // Stage 4 files: only the managed side stages files; composio-files.js asks first and words the self-managed refusal itself.
    stageFile: lazy("stageFile"), canStageFiles: async () => typeof (await pick()).stageFile === "function" };
}
