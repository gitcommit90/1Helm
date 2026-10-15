import { boundedJson } from "./bounded-body.js";
// "Get to know you": an optional interview the person can do after onboarding. A TASK in General ("Get to know you", ~3 min),
// created once per person (at the end of onboarding, or on the next app boot for accounts made before this existed), never
// again after they finish it, tick it or remove it. Opening it shows one easy question at a time (pick one / pick several /
// yes-no, a short optional "other" field where it helps). Each question belongs to one Notebook section; each answer becomes
// plain-words Notebook rows (Archive memory_items, author "human", src "interview"), so the helper reads them like anything the
// person wrote in the Notebook. Deterministic: a fixed question list and fixed sentences. No model call, nothing invented,
// nothing leaves 1Helm. Progress lives in D1 (interviews, migrations_020_interview.sql) so they can stop and pick up later.
// The task is never marked done here: the person ticks it themselves (the Captain's done rule).
import { APP_OPTIONS, NONE, optionsView, getAppsUsed, setAppsUsed } from "./ee/index.js";
import { hsNoteNotify } from "./hindsight-writers.js";   // HS_WRITERS: the interview's Notebook rows reach the channel's bank like any note
export const IV_TITLE = "Get to know you";
export const IV_PREVIEW = "~3 min, all optional. A few quick taps so your helper knows you.";
export const IV_SRC = "interview";
export const SEC_NAMES = { about: "About you", how: "How you like things", people: "People", places: "Accounts & places", now: "Right now" };
// How long each free-text answer can be (the app's field uses the same number: questionView sends it as text.max).
// Short fields (a name, a city) stay one line; the rest grow as they type. Every limit keeps the longest Notebook row it can
// write well under what the helper reads per row (700 chars, resident.js).
export const TEXT_MAX = { name: 100, home: 160, household: 300, days: 300, food: 600, help: 600 };
const SHORT_MAX = 120;   // what onboarding / the network gave (city, region, first name)

// ---- Plain-words helpers ----
// One clean line, at most max chars. Over the limit (only a hand-made request: the field stops at max) it's cut at the last
// word boundary and ends with "…", never mid-word.
export function clean(s, max = SHORT_MAX) {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max), sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut.slice(0, max - 1)).replace(/[\s.,;:!?(\-–—]+$/, "")}…`;
}
const bare = (s, max) => clean(s, max).replace(/[.!?;,:\s]+$/, "");
// A row's last word gets a full stop, unless it already ends in "…" (a clipped answer).
const dot = (s) => /…$/.test(s) ? s : `${s}.`;
const andJoin = (a) => a.length <= 1 ? (a[0] || "") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
export function tzName(tz) {
  if (!tz) return "";
  try { const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName"); if (p?.value && !/^GMT/.test(p.value)) return p.value; } catch {}
  return tz.replace(/_/g, " ");
}
// "Portland, Oregon" (US) or "Lyon, France" (elsewhere); "" when the network gave no city.
export function placeOf(k = {}) {
  const city = clean(k.city); if (!city) return "";
  const region = clean(k.region), country = clean(k.country);
  return [city, region && region !== city ? region : "", country && country !== "US" ? (k.countryName || country) : ""].filter(Boolean).join(", ");
}

// ---- The questions. kind: "one" (pick one) | "many" (pick several). opts: [value, label]. text: an optional short field
// (show: "always" or the option value that reveals it). none: a "many" option that clears the others ("Just me").
// def(known): the pick to start on (from onboarding, never saved until they tap Next). rows(answer, known): the Notebook rows.
// Sensitive categories (health, money beyond preference style, religion, politics) are deliberately absent.
export const QUESTIONS = [
  { id: "name", sec: "about",
    ask: (k) => k.first ? `Should your helper call you ${clean(k.first)}?` : "What should your helper call you?",
    sub: () => "Your helper uses it now and then, not in every message.",
    kind: "one", opts: (k) => k.first ? [["yes", `Yes, ${clean(k.first)}`], ["other", "Something else"]] : [],
    text: (k) => ({ label: "Name you like", placeholder: "e.g. Jo", show: k.first ? "other" : "always" }),
    rows: (a, k) => { const n = a.text && (a.pick === "other" || !k.first) ? bare(a.text, TEXT_MAX.name) : a.pick === "yes" ? clean(k.first) : ""; return n ? [dot(`Likes to be called ${n}`)] : []; } },
  { id: "home", sec: "about",
    ask: (k) => placeOf(k) ? `Is ${placeOf(k)} home?` : "Where's home?",
    sub: (k) => k.tz ? `Your device says ${tzName(k.tz)}, so times are shown that way.` : "A city or area is plenty.",
    kind: "one", opts: (k) => placeOf(k) ? [["yes", "Yes"], ["other", "Somewhere else"]] : [],
    text: (k) => ({ label: "City or area", placeholder: "e.g. Austin, TX", show: placeOf(k) ? "other" : "always" }),
    rows: (a, k) => {
      const nm = tzName(k.tz), tz = k.tz ? (nm === k.tz.replace(/_/g, " ") ? ` Time zone: ${nm}.` : ` ${nm} (${k.tz}).`) : "";
      if (a.pick === "yes" && placeOf(k)) return [`Lives in or near ${placeOf(k)}.${tz}`];
      const t = bare(a.text, TEXT_MAX.home); return t ? [`${dot(`Lives in or near ${t}`)}${a.pick === "other" ? "" : tz}`] : [];
    } },
  { id: "household", sec: "people",
    ask: () => "Who's at home with you?", sub: () => "Pick any that fit. Names are optional.",
    kind: "many", none: "alone",
    opts: () => [["alone", "Just me"], ["partner", "Partner or spouse"], ["kids", "Kids"], ["parents", "Parents"], ["roommates", "Roommates"], ["pets", "Pets"]],
    text: () => ({ label: "Names, if you'd like", placeholder: "e.g. Sam (partner), Maya (8), Biscuit the dog", show: "always" }),
    rows: (a) => {
      const p = a.picks || [], who = { partner: "a partner", kids: "kids", parents: "parents", roommates: "roommates" };
      const list = p.filter((x) => who[x]).map((x) => who[x]);
      let s = list.length ? `Lives with ${andJoin(list)}` : p.includes("alone") ? "Lives alone" : "";
      if (p.includes("pets")) s = s ? `${s}, plus pets` : "Has pets";
      const out = s ? [`${s}.`] : []; const t = bare(a.text, TEXT_MAX.household); if (t) out.push(dot(`At home: ${t}`)); return out;
    } },
  { id: "days", sec: "about",
    ask: () => "What fills most of your days?", sub: () => "Helps your helper pick good times and good examples.",
    kind: "one", opts: () => [["job", "Working a job"], ["business", "Running my own business"], ["school", "School or studying"], ["home", "Taking care of home and family"], ["retired", "Retired"], ["mix", "A mix of things"]],
    text: () => ({ label: "What do you do? (optional)", placeholder: "e.g. nurse, teacher, software", show: "always" }),
    rows: (a) => {
      const base = { job: "Works a job", business: "Runs their own business", school: "Is studying", home: "Spends most days taking care of home and family", retired: "Is retired", mix: "Has a mix of things going on most days" }[a.pick] || "";
      const t = bare(a.text, TEXT_MAX.days); return base ? [dot(`${base}${t ? `: ${t}` : ""}`)] : t ? [dot(`What they do: ${t}`)] : [];
    } },
  { id: "hours", sec: "about",
    ask: () => "When are you usually busy?", sub: () => "With work or your regular commitments.",
    kind: "one", opts: () => [["nine", "Weekdays, roughly 9 to 5"], ["early", "Early mornings"], ["late", "Evenings or nights"], ["shifts", "Shifts that change"], ["loose", "No fixed schedule"]],
    rows: (a) => { const r = { nine: "Usually busy on weekdays, roughly 9 to 5.", early: "Usually busy early in the morning.", late: "Usually busy in the evenings or at night.", shifts: "Works shifts that change from week to week.", loose: "Doesn't keep a fixed schedule." }[a.pick]; return r ? [r] : []; } },
  { id: "busydays", sec: "about",
    ask: () => "Which days are usually busiest?", sub: () => "Pick any.",
    kind: "many", opts: () => [["Monday", "Mon"], ["Tuesday", "Tue"], ["Wednesday", "Wed"], ["Thursday", "Thu"], ["Friday", "Fri"], ["Saturday", "Sat"], ["Sunday", "Sun"]],
    rows: (a) => (a.picks || []).length ? [`Busiest days: ${andJoin(a.picks)}.`] : [] },
  { id: "length", sec: "how",
    ask: () => "How long should answers usually be?", sub: () => "You can always ask for more or less in a task.",
    kind: "one", def: (k) => Number(k.tone) === 0 && k.tone != null ? "short" : "",
    opts: () => [["short", "Short, the important part first"], ["some", "A bit of detail"], ["full", "Thorough, walk me through it"]],
    rows: (a) => { const r = { short: "Prefers short answers, the important part first.", some: "Likes answers with a bit of detail.", full: "Likes thorough answers that walk through things step by step." }[a.pick]; return r ? [r] : []; } },
  { id: "tone", sec: "how",
    ask: () => "What tone feels right?",
    kind: "one", def: (k) => Number(k.tone) === 1 ? "casual" : "",
    opts: () => [["casual", "Friendly and casual"], ["warm", "Warm but to the point"], ["pro", "Professional"]],
    rows: (a) => { const r = { casual: "Likes a friendly, casual tone.", warm: "Likes a warm tone that gets to the point.", pro: "Prefers a professional tone." }[a.pick]; return r ? [r] : []; } },
  { id: "emoji", sec: "how",
    ask: () => "Emoji in replies?",
    kind: "one", opts: () => [["yes", "Sure"], ["few", "Now and then"], ["no", "No thanks"]],
    rows: (a) => { const r = { yes: "Emoji in replies are fine.", few: "Emoji now and then, not a lot.", no: "No emoji in replies." }[a.pick]; return r ? [r] : []; } },
  { id: "unclear", sec: "how",
    ask: () => "When something's unclear, should your helper…",
    kind: "one", opts: () => [["ask", "Ask me a quick question"], ["guess", "Make a sensible guess and tell me"]],
    rows: (a) => { const r = { ask: "When something's unclear, ask a quick question first.", guess: "When something's unclear, make a sensible guess and say what was assumed." }[a.pick]; return r ? [r] : []; } },
  { id: "food", sec: "how",
    ask: () => "Any food preferences?", sub: () => "For recipes, restaurants and grocery lists.",
    kind: "many", none: "none",
    opts: () => [["none", "No restrictions"], ["vegetarian", "Vegetarian"], ["vegan", "Vegan"], ["pescatarian", "Pescatarian"], ["gluten", "Gluten-free"], ["dairy", "Dairy-free"], ["lowcarb", "Low-carb"]],
    text: () => ({ label: "Anything else? (optional)", placeholder: "e.g. no mushrooms, loves Thai", show: "always" }),
    rows: (a) => {
      const p = a.picks || [], L = { vegetarian: "vegetarian", vegan: "vegan", pescatarian: "pescatarian", gluten: "gluten-free", dairy: "dairy-free", lowcarb: "low-carb" };
      const list = p.filter((x) => L[x]).map((x) => L[x]);
      const out = list.length ? [`Food: ${andJoin(list)}.`] : p.includes("none") ? ["No food restrictions."] : [];
      const t = bare(a.text, TEXT_MAX.food); if (t) out.push(dot(`Food notes: ${t}`)); return out;
    } },
  { id: "seat", sec: "how",
    ask: () => "On a flight, which seat?",
    kind: "one", opts: () => [["window", "Window"], ["aisle", "Aisle"], ["any", "Don't mind"]],
    rows: (a) => { const r = { window: "Prefers a window seat on flights.", aisle: "Prefers an aisle seat on flights.", any: "Doesn't mind window or aisle on flights." }[a.pick]; return r ? [r] : []; } },
  { id: "budget", sec: "how",
    ask: () => "When there are options at different prices, you usually want…",
    kind: "one", opts: () => [["cheap", "The cheapest that does the job"], ["value", "The best value for the money"], ["best", "To pay more for the best"]],
    rows: (a) => { const r = { cheap: "Usually wants the cheapest option that does the job.", value: "Usually wants the best value for the money.", best: "Happy to pay more for the best option." }[a.pick]; return r ? [r] : []; } },
  // Devices only: the apps (Gmail, Outlook, Google Calendar used to be here) are the next question, a structured list (apps-used.js).
  { id: "tools", sec: "places",
    ask: () => "Which devices do you use?", sub: () => "So instructions and links match your phone and computer.",
    kind: "many", opts: () => [["iPhone", "iPhone"], ["an Android phone", "Android phone"], ["an iPad", "iPad"], ["a Mac", "Mac"], ["a Windows PC", "Windows PC"], ["a Chromebook", "Chromebook"]],
    rows: (a) => (a.picks || []).length ? [`Uses ${andJoin(a.picks.map((x) => x === "iPhone" ? "an iPhone" : x))}.`] : [] },
  // "Do you use any of these apps?" (Captain 10-08): 0–N apps, or "None of these". Not Notebook rows: the answer is the account's
  // apps list (apps-used.js), which the helper sees with each app's connection status.
  { id: "apps", sec: "places", look: "apps",
    ask: () => "Do you use any of these apps?", sub: () => "Pick any. Your helper won't connect anything now; it just knows to offer when one comes up.",
    kind: "many", none: NONE, opts: () => [...APP_OPTIONS.map((o) => [o.k, o.n]), [NONE, "None of these"]],
    rows: () => [] },
  { id: "help", sec: "now",
    ask: () => "What would you like help with first?", sub: () => "Pick as many as you like.",
    kind: "many", opts: () => [["errands", "Errands and to-dos"], ["email", "Email"], ["calendar", "Calendar and scheduling"], ["shopping", "Shopping and deals"], ["research", "Research"], ["reminders", "Reminders"], ["travel", "Travel plans"], ["bills", "Bills and paperwork"], ["family", "Family logistics"]],
    text: () => ({ label: "Something else? (optional)", placeholder: "e.g. planning a move", show: "always" }),
    rows: (a, k, q) => {
      const L = Object.fromEntries(q.opts(k)), list = (a.picks || []).filter((x) => L[x]).map((x) => lc(L[x]));
      const out = list.length ? [`Wants help with ${andJoin(list)}.`] : []; const t = bare(a.text, TEXT_MAX.help); if (t) out.push(dot(`${list.length ? "Also wants" : "Wants"} help with: ${t}`)); return out;
    } },
];
// Keep stored question positions stable for interviews already in progress and
// old open clients. Reply style is chosen in onboarding and stays in helper_tone;
// don't ask length/tone again. Existing answers/Notebook rows are left intact.
export const ACTIVE_QUESTIONS = QUESTIONS.filter((q) => !["length", "tone"].includes(q.id));
export const TOTAL = ACTIVE_QUESTIONS.length;
const STORED_TOTAL = QUESTIONS.length;
const visibleStep = (step) => ACTIVE_QUESTIONS.filter((q) => QUESTIONS.indexOf(q) < Math.min(Number(step) || 0, STORED_TOTAL)).length;
const previousStep = (step) => {
  const before = ACTIVE_QUESTIONS.map((q) => QUESTIONS.indexOf(q)).filter((i) => i < step);
  return before.at(-1) ?? 0;
};
const byId = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));

// What the app shows for one question (plain JSON: no functions).
export function questionView(q, known = {}) {
  const t = q.text ? { ...q.text(known), max: TEXT_MAX[q.id] || SHORT_MAX } : null;
  return { id: q.id, sec: q.sec, secName: SEC_NAMES[q.sec], ask: q.ask(known), sub: q.sub ? q.sub(known) : "", kind: q.kind, none: q.none || "",
    opts: q.opts(known).map(([v, label]) => ({ v, label })), text: t, def: q.def ? q.def(known) || "" : "",
    ...(q.look === "apps" ? { look: "apps", apps: optionsView() } : {}) };
}
// An answer, checked against the question: only offered options, one clean line of text within its limit, nothing else.
export function normalizeAnswer(q, b = {}, known = {}) {
  const ok = new Set(q.opts(known).map((o) => o[0]));
  const a = {};
  if (q.kind === "one" && b.pick != null && ok.has(String(b.pick))) a.pick = String(b.pick);
  if (q.kind === "many" && Array.isArray(b.picks)) { let p = [...new Set(b.picks.map(String).filter((x) => ok.has(x)))]; if (q.none && p.includes(q.none) && p.length > 1) p = p.filter((x) => x !== q.none); if (p.length) a.picks = p; }
  const t = q.text ? clean(b.text, TEXT_MAX[q.id] || SHORT_MAX) : "", tv = q.text ? q.text(known) : null;
  if (t && tv && (tv.show === "always" || tv.show === a.pick)) a.text = t;
  return a;
}
export function rowsFor(qid, answer, known = {}) { const q = byId[qid]; return q ? q.rows(answer || {}, known, q).filter(Boolean) : []; }

// ---- Storage (D1 interviews) and the task (General's Resident) ----
const archiveOf = (env, tid) => env.ARCHIVE.get(env.ARCHIVE.idFromName(`archive:${tid}`));
const residentOf = (env, tid) => env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tid}:main`));
const parse = (s, d) => { try { return JSON.parse(s || ""); } catch { return d; } };
export async function rowOf(env, tid) { return env.DB.prepare("SELECT * FROM interviews WHERE tenant_id=?").bind(tid).first(); }
async function mainChannel(env, tid) { return (await archiveOf(env, tid).channels()).find((c) => (c.slug || c.name) === "main") || null; }

// Create the task once per person. A row in interviews means it was offered (open, finished, ticked or removed): never again.
// The claim (INSERT OR IGNORE) makes two boots at once create one task, not two.
export async function interviewEnsure(env, t, tz = "") {
  const have = await rowOf(env, t.id); if (have) return have;
  const at = Date.now();
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO interviews (tenant_id,status,step,answers,known,created_at,updated_at) VALUES (?,'creating',0,'{}','{}',?,?)").bind(t.id, at, at).run();
  if (!claim?.meta?.changes) {   // another boot is creating it right now: wait for its task (a couple of seconds at most)
    let r = await rowOf(env, t.id); for (let i = 0; i < 15 && r?.status === "creating"; i++) { await new Promise((z) => setTimeout(z, 150)); r = await rowOf(env, t.id); }
    return r;
  }
  try {
    const ch = await mainChannel(env, t.id); if (!ch) throw new Error("no General channel yet");
    const R = residentOf(env, t.id); await R.bind(t.id, "main", String(ch.id), tz || undefined);
    const s = await R.createSession(IV_TITLE, "", IV_PREVIEW);
    await env.DB.prepare("UPDATE interviews SET session_id=?, status='open', updated_at=? WHERE tenant_id=?").bind(s.id, Date.now(), t.id).run();
  } catch (e) { console.log("interview ensure", e?.message); await env.DB.prepare("DELETE FROM interviews WHERE tenant_id=? AND status='creating'").bind(t.id).run(); return null; }
  return rowOf(env, t.id);
}
// For boot: just enough for the app to know which task is the interview.
export const bootView = (row) => row && row.status === "open" && row.session_id ? { session: row.session_id, step: visibleStep(row.step), total: TOTAL } : null;

// The whole state the app renders: every question (so Back/Next need no round trip), answers so far, rows still in the Notebook.
async function stateOf(env, t, row) {
  if (!row || row.status !== "open") return { status: row ? row.status : "none" };
  const known = parse(row.known, {}), answers = parse(row.answers, {});
  // Rows the person has since deleted in the Notebook drop out of the summary (the answer itself is kept).
  let live = null;
  try { const ch = await mainChannel(env, t.id); if (ch) live = new Set(((await archiveOf(env, t.id).channel(ch.id, 1)).memory || []).filter((m) => m.status !== "superseded").map((m) => String(m.id))); } catch {}
  for (const a of Object.values(answers)) if (live && Array.isArray(a.rows)) a.rows = a.rows.filter((r) => live.has(String(r.id)));
  // The apps question starts on the account's list (the helper may have set it before they got here).
  const questions = ACTIVE_QUESTIONS.map((q) => questionView(q, known)), aq = questions.find((q) => q.look === "apps");
  if (aq && !answers.apps?.picks) { const u = await getAppsUsed(env, t.id).catch(() => null); if (u?.answered) aq.defPicks = u.apps.length ? u.apps.filter((k) => APP_OPTIONS.some((o) => o.k === k)) : u.none ? [NONE] : []; }
  return { status: "open", session: row.session_id, step: visibleStep(row.step), total: TOTAL, finished: !!row.finished_at, known: { first: known.first || "", place: placeOf(known), tz: known.tz || "", tzName: tzName(known.tz) },
    questions, answers, secNames: SEC_NAMES };
}
async function save(env, tid, o) {
  await env.DB.prepare("UPDATE interviews SET step=?, answers=?, finished_at=COALESCE(finished_at, ?), updated_at=? WHERE tenant_id=?")
    .bind(o.step, JSON.stringify(o.answers), o.step >= STORED_TOTAL ? Date.now() : null, Date.now(), tid).run();
}

// /w/<slug>/api/interview  GET ?tz=  → state.  POST {op}: answer {q, pick|picks, text} · skip {q} · back · rest (skip the rest)
// · again (go through it again; answers replace their old rows) · remove (the task goes; never offered again).
export async function interviewApi(req, env, t, url, { json, cf = {}, look = false } = {}) {
  let row = await rowOf(env, t.id);
  if (req.method === "GET") {
    // What onboarding and the network already know: the name they gave, the city Cloudflare sees, their device's time zone.
    // Kept from the first look, so a later VPN doesn't change the question under them.
    if (row && row.status === "open" && row.known === "{}" && !look) {   // look: a dev ops "view as" never records what it sees
      const tn = await env.DB.prepare("SELECT first_name, helper_tone FROM tenants WHERE id=?").bind(t.id).first().catch(() => null);
      // A device on plain UTC usually just hasn't been set; the network's guess is better then.
      let tz = String(url.searchParams.get("tz") || "").slice(0, 64); if ((!tz || /^(Etc\/)?UTC$/.test(tz)) && cf.timezone) tz = String(cf.timezone).slice(0, 64);
      const k = { first: clean(tn?.first_name ?? t.first_name ?? "", 40), tone: tn?.helper_tone ?? t.helper_tone ?? null, city: clean(cf.city), region: clean(cf.region), country: clean(cf.country), tz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz) ? tz : "" };
      await env.DB.prepare("UPDATE interviews SET known=? WHERE tenant_id=?").bind(JSON.stringify(k), t.id).run(); row = await rowOf(env, t.id);
    }
    return json(await stateOf(env, t, row));
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!row || row.status !== "open") return json({ error: "There's no Get to know you task right now.", status: row ? row.status : "none" }, 404);
  const b = await boundedJson(req), known = parse(row.known, {}), answers = parse(row.answers, {});
  let step = Math.min(Number(row.step) || 0, STORED_TOTAL);
  const ch = await mainChannel(env, t.id); if (!ch) return json({ error: "no General channel" }, 404);
  const A = archiveOf(env, t.id);
  if (b.op === "answer" || b.op === "skip") {
    const q = byId[b.q]; if (!q) return json({ error: "no such question" }, 400);
    const i = QUESTIONS.indexOf(q), prev = answers[q.id] || {};
    if (b.op === "answer") {
      const a = normalizeAnswer(q, b, known), texts = rowsFor(q.id, a, known);
      // A new answer replaces the rows this question wrote before (going back and changing it never doubles up).
      for (const r of prev.rows || []) { await A.noteDelete(ch.id, r.id).catch(() => {}); await hsNoteNotify(env, t.id, "main", ch.id, r.id); }
      const rows = [];
      for (const text of texts) { const n = await A.noteAdd(ch.id, q.sec, text, "human", { src: IV_SRC, q: q.id }); rows.push({ id: String(n.id), sec: q.sec, text: n.content }); await hsNoteNotify(env, t.id, "main", ch.id, n.id); }
      answers[q.id] = { ...a, rows, at: Date.now() };
      // The apps question: the account's apps list (apps-used.js). Apps the helper added outside these options stay on it.
      if (q.look === "apps") { const cur = await getAppsUsed(env, t.id); const extra = cur.apps.filter((k) => !APP_OPTIONS.some((o) => o.k === k));
        await setAppsUsed(env, t.id, { apps: [...(a.picks || []).filter((k) => k !== NONE), ...extra], extras: cur.names, none: (a.picks || []).includes(NONE) }, "interview"); }
    } else answers[q.id] = { ...prev, skipped: !prev.rows?.length, at: Date.now() };   // a skip keeps anything said before
    step = i + 1;
  } else if (b.op === "back") step = previousStep(step);
  else if (b.op === "rest") step = STORED_TOTAL;
  else if (b.op === "again") step = 0;
  else if (b.op === "remove") {
    await residentOf(env, t.id).removeSession(row.session_id).catch((e) => console.log("interview remove", e?.message));
    await env.DB.prepare("UPDATE interviews SET status='removed', updated_at=? WHERE tenant_id=?").bind(Date.now(), t.id).run();
    return json({ status: "removed" });
  } else return json({ error: "op must be answer, skip, back, rest, again or remove" }, 400);
  await save(env, t.id, { step, answers });
  return json(await stateOf(env, t, await rowOf(env, t.id)));
}
