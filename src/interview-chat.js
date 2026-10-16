import { boundedJson } from "./bounded-body.js";
// "Interview me" in chat: the `interview` tool. When the person asks to be interviewed ("interview me", "ask me whatever you
// need", "review this doc and then ask me about the gaps"), the helper writes 3–20 questions itself and this shows them as a
// SYSTEM card inline in the task's chat, in the Get to know you look (design-sandbox src/interview-card.ts): a progress bar, one
// question at a time (pick one / pick several / yes-no / 1–5 / their own words, with an "Other" box), Back, Skip, Skip the rest,
// a review screen, then "Send answers".
// - Answers are saved here as the person goes (the Resident's own SQLite, table chat_interviews), so a reload or another device
//   picks up where they were. Nothing goes to the model until they send.
// - "Send answers" locks the card and returns ONE plain message ("Interview answers — <title>:\n1. <question>: <answer>…",
//   skipped questions marked "(skipped)"). The server posts it once to Primary in the interview's original task. The source
//   turn binds the answer to any waiting question and worker. Both the app and hosted Messages card use the same operation.
// - The tool returns at once and tells the model to end its turn and wait. Chat turns only: never background helpers (not in
//   HELPER_ALLOWED, and HELPER_DENIED names it), never scheduled runs.
// - Texting turn: after the reply goes out by text, the card follows as an iMessage live app card opening /c/<token> (kind
//   "interview" in D1 cards). If the live card can't be sent, a plain text with the link says what it is.
// API (index.js): GET /w/<slug>/api/res/<ch>/interviews/<id> → view · POST {op} → view (+ message and posted receipt for op "send").
//   ops: answer {q, answer: {pick|picks|other|text|scale}, step} · skip {q, step} · goto {step} · send
import { cardToken, cardUrl } from "./cards.js";
import { deliverCard } from "./ee/index.js";
import { helperName } from "./helper-name.js";

export const IV_MIN = 3, IV_MAX = 20;
export const LIM = { title: 80, intro: 400, purpose: 200, question: 300, help: 200, placeholder: 80, option: 100, options: 10, scaleLabel: 40, answer: 600, id: 40 };
export const KINDS = ["one", "many", "yesno", "text", "scale"];
export const SCALE_MAX = 5;
export const IV_PREFIX = "Interview answers — ";
const MSG_MAX = 19000;   // the message stays under the 20k chat limit

export const INTERVIEW_TOOL = { type: "function", function: { name: "interview",
  description: "Interview the person: shows a card in this chat that asks your questions one at a time (progress bar, Back, Skip, a review screen, then Send answers). Use it only when they ask to be interviewed or questioned (\"interview me\", \"ask me questions\", \"what do you need to know from me?\", \"review this and then ask me about the gaps\"); for one or two quick questions just ask in your reply. Write 3–20 specific questions yourself, one idea each, most important first. Prefer tappable choices (one, many, yesno, scale) with the likely answers as options, and use text where only their own words will do. It returns at once: end your turn with one short line. Their answers arrive as their next message, starting \"Interview answers —\".",
  parameters: { type: "object", properties: {
    title: { type: "string", description: "Short title shown on the card, e.g. \"Lisbon trip: open questions\"" },
    intro: { type: "string", description: "Optional: one or two sentences shown above the first question" },
    purpose: { type: "string", description: "What the answers are for, in plain words, e.g. \"so I can finish the trip doc\". Shown on the card." },
    questions: { type: "array", minItems: IV_MIN, maxItems: IV_MAX, description: "3 to 20 questions, most important first", items: { type: "object", properties: {
      id: { type: "string", description: "Short unique id, e.g. \"dates\"" },
      text: { type: "string", description: "The question, one idea, under 300 characters" },
      kind: { type: "string", enum: KINDS, description: "one = pick one option · many = pick any · yesno = Yes or No · text = their own words (up to 600 characters) · scale = 1 to 5" },
      options: { type: "array", items: { type: "string" }, description: "one / many: 2–10 likely answers. scale: optional [low end label, high end label]" },
      allow_other: { type: "boolean", description: "one / many / yesno: add an \"Other\" box for their own answer (default on for one and many)" },
      placeholder: { type: "string", description: "Hint text in the answer box" },
      help: { type: "string", description: "Optional short line under the question" },
    }, required: ["id", "text", "kind"] } },
  }, required: ["title", "purpose", "questions"] } } };

export function interviewInit(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS chat_interviews (id TEXT PRIMARY KEY, session TEXT, turn TEXT, at INTEGER NOT NULL, title TEXT NOT NULL, intro TEXT, purpose TEXT,
    questions TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '{}', step INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', sent_at INTEGER, message TEXT,
    via TEXT NOT NULL DEFAULT 'app', texted_at INTEGER, updated INTEGER NOT NULL)`);
  sql.exec("CREATE INDEX IF NOT EXISTS chat_interviews_session ON chat_interviews(session, at)");
  if (!sql.exec("PRAGMA table_info(chat_interviews)").toArray().some(c => c.name === "posted_at")) {
    sql.exec("ALTER TABLE chat_interviews ADD COLUMN posted_at INTEGER");
    sql.exec("UPDATE chat_interviews SET posted_at=sent_at WHERE status='sent'"); // old clients already posted these answers
  }
}

// ---- Plain words ----
const line = (s, max) => { const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t; };
// A long answer keeps its line breaks (up to 600 characters), minus control characters.
const para = (s, max) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max).trim();
const parse = (s, d) => { try { return JSON.parse(s || ""); } catch { return d; } };

// ---- The questions the helper wrote: checked and cleaned. → { iv } | { error } (the error goes back to the model as is) ----
export function checkInterview(a = {}) {
  const title = line(a.title, LIM.title), purpose = line(a.purpose, LIM.purpose), intro = line(a.intro, LIM.intro);
  if (!title) return { error: "error: title is required (a few words shown on the card)." };
  if (!purpose) return { error: "error: purpose is required: say in plain words what the answers are for (e.g. \"so I can finish the trip doc\")." };
  const qs = Array.isArray(a.questions) ? a.questions : null;
  if (!qs) return { error: `error: questions must be a list of ${IV_MIN} to ${IV_MAX} questions.` };
  if (qs.length < IV_MIN) return { error: `error: an interview needs at least ${IV_MIN} questions. For one or two quick questions, just ask them in your reply.` };
  if (qs.length > IV_MAX) return { error: `error: at most ${IV_MAX} questions (you sent ${qs.length}). Keep the ${IV_MAX} most important; ask the rest later if they still matter.` };
  const ids = new Set(), out = [];
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i] && typeof qs[i] === "object" ? qs[i] : {}, n = i + 1, text = line(q.text, LIM.question);
    if (!text) return { error: `error: question ${n} has no text.` };
    const kind = String(q.kind || "").trim().toLowerCase();
    if (!KINDS.includes(kind)) return { error: `error: question ${n} ("${text.slice(0, 60)}"): kind must be one, many, yesno, text or scale.` };
    let id = String(q.id ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, LIM.id) || `q${n}`;
    while (ids.has(id)) id = `${id.slice(0, LIM.id - 3)}-${n}`;
    ids.add(id);
    const o = { id, text, kind };
    const raw = Array.isArray(q.options) ? q.options.map((x) => line(x, LIM.option)).filter(Boolean) : [];
    if (kind === "one" || kind === "many") {
      const opts = [...new Set(raw)].filter((x) => !/^other\b[.…:]*$/i.test(x));   // "Other" is the box, not an option
      if (opts.length < 2) return { error: `error: question ${n} ("${text.slice(0, 60)}") is kind ${kind} but has fewer than 2 options. Add the likely answers as options, or use kind text.` };
      if (opts.length > LIM.options) return { error: `error: question ${n} has ${opts.length} options; at most ${LIM.options}. Keep the likeliest and leave allow_other on for the rest.` };
      o.options = opts; o.allow_other = q.allow_other !== false;
    } else if (kind === "yesno") { o.options = ["Yes", "No"]; o.allow_other = q.allow_other === true; }
    else if (kind === "scale") { const l = raw.slice(0, 2).map((x) => line(x, LIM.scaleLabel)); if (l.length === 2) o.options = l; }
    const ph = line(q.placeholder, LIM.placeholder), help = line(q.help, LIM.help);
    if (ph) o.placeholder = ph; if (help) o.help = help;
    out.push(o);
  }
  return { iv: { title, intro, purpose, questions: out } };
}

// ---- One answer, checked against its question. → { a } | { error } ----
export function checkAnswer(q, b = {}) {
  b = b && typeof b === "object" ? b : {};
  const other = q.allow_other ? para(b.other, LIM.answer).replace(/\n+/g, " ") : "";
  if (q.kind === "one" || q.kind === "yesno") {
    if (b.pick != null && q.options.includes(String(b.pick))) return { a: { pick: String(b.pick) } };
    if (other) return { a: { other } };
    return { error: "Pick one of the options." };
  }
  if (q.kind === "many") {
    const want = new Set(Array.isArray(b.picks) ? b.picks.map(String) : []), picks = q.options.filter((x) => want.has(x));
    if (!picks.length && !other) return { error: "Pick at least one." };
    return { a: { ...(picks.length ? { picks } : {}), ...(other ? { other } : {}) } };
  }
  if (q.kind === "scale") { const n = Math.round(Number(b.scale)); return n >= 1 && n <= SCALE_MAX ? { a: { scale: n } } : { error: `Pick 1 to ${SCALE_MAX}.` }; }
  const text = para(b.text, LIM.answer); return text ? { a: { text } } : { error: "Type an answer, or skip it." };
}
const has = (a) => !!a && !a.skipped && (a.pick != null || (a.picks || []).length > 0 || !!a.other || !!a.text || a.scale != null);
// The answer in plain words (the message, the review screen, the locked summary). Multi-line text answers join with " / ".
export function answerText(q, a) {
  if (!has(a)) return "(skipped)";
  if (q.kind === "scale") { const l = q.options || []; return `${a.scale} of ${SCALE_MAX}${l.length === 2 ? ` (1 = ${l[0]}, ${SCALE_MAX} = ${l[1]})` : ""}`; }
  if (q.kind === "text") return String(a.text).split(/\n+/).map((x) => x.trim()).filter(Boolean).join(" / ");
  const parts = [...(a.pick != null ? [a.pick] : []), ...(a.picks || []), ...(a.other ? [`Other: ${a.other}`] : [])];
  return parts.join("; ");
}
// The ONE message "Send answers" posts as the person's. "1. Which week works best? Late June" (a question that ends in "?"
// reads as question-and-answer), "1. Budget: $150–250" (a label gets a colon).
export function formatAnswers(iv) {
  const head = `${IV_PREFIX}${iv.title}:`, ans = iv.answers || {};
  let body = iv.questions.map((q, i) => { let t = answerText(q, ans[q.id]); if (t.length > 900) t = t.slice(0, 899) + "…"; const qt = q.text.replace(/[:\s]+$/, ""); return `${i + 1}. ${qt}${/[?!.…]$/.test(qt) ? " " : ": "}${t}`; }).join("\n");
  if (head.length + 1 + body.length > MSG_MAX) body = body.slice(0, MSG_MAX - head.length - 2) + "…";
  return `${head}\n${body}`;
}
export const answeredCount = (iv) => iv.questions.filter((q) => has((iv.answers || {})[q.id])).length;

// ---- Storage ----
export function ivRow(sql, id) { return sql.exec("SELECT * FROM chat_interviews WHERE id=?", String(id)).toArray()[0] || null; }
function ivOf(r) { return r && { id: r.id, session: r.session, turn: r.turn, at: Number(r.at), title: r.title, intro: r.intro || "", purpose: r.purpose || "", questions: parse(r.questions, []), answers: parse(r.answers, {}), step: Number(r.step) || 0, status: r.status, posted_at: r.posted_at ? Number(r.posted_at) : null, message: r.message || null, sent_at: r.sent_at ? Number(r.sent_at) : null, via: r.via, updated: Number(r.updated) }; }
// What the app and the card page render (plain JSON).
export function ivView(r, sql = null) {
  const iv = typeof r?.questions === "string" ? ivOf(r) : r; if (!iv) return null;
  let question = null;
  if (sql && !iv.posted_at) {
    try { question = sql.exec("SELECT status,answer_text FROM user_questions WHERE source_turn=? AND session=?", String(iv.turn), String(iv.session)).toArray()[0]; }
    catch (e) { if (!/no such table.*user_questions/i.test(String(e.message))) throw e; }
  }
  const terminal = question && question.status !== "pending" && !(question.status === "answered" && iv.status === "sent" && question.answer_text === iv.message);
  const closed = terminal ? { status: "closed", closed_reason: question.status === "answered" ? "answered_elsewhere" : question.status, closed_note: question.status === "answered" ? "Answered in chat" : "No longer needed" } : {};
  return { id: iv.id, session: iv.session, at: iv.at, title: iv.title, intro: iv.intro, purpose: iv.purpose, questions: iv.questions, answers: iv.answers,
    step: Math.min(iv.step, iv.questions.length), total: iv.questions.length, status: iv.status, posted: !!iv.posted_at, sent_at: iv.sent_at, answered: answeredCount(iv), updated: iv.updated, limits: { answer: LIM.answer }, ...closed };
}
// sessionDetail: each turn gets the interviews its helper showed (one query per task).
export function attachInterviews(sql, session, turns, live) {
  const rows = sql.exec("SELECT * FROM chat_interviews WHERE session=? ORDER BY at", String(session)).toArray(); if (!rows.length) return;
  const by = {}; for (const r of rows) (by[r.turn] ||= []).push(ivView(r, sql));
  for (const t of turns) if (by[t.id]) t.interviews = by[t.id];
  if (live && by[live.turn]) live.interviews = by[live.turn];
}

// ---- The tool (classic + pi engines both land here through Resident.localTool) ----
export async function interviewTool(R, a, ctx = {}) {
  if (ctx.kind === "helper") return "error: interview isn't available to a helper. Say in your report what you'd need to ask the person; the helper who started you asks them.";
  if (ctx.kind !== "chat" || !ctx.session) return "error: interview only works while you're talking with the person in a task, not in a scheduled run. Ask them in your report instead.";
  const c = checkInterview(a); if (c.error) return c.error;
  const iv = c.iv, id = crypto.randomUUID(), now = Date.now(), via = ctx.viaText ? "text" : "app";
  R.sql.exec("INSERT INTO chat_interviews (id,session,turn,at,title,intro,purpose,questions,answers,step,status,via,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, ctx.session, ctx.turn || null, now, iv.title, iv.intro, iv.purpose, JSON.stringify(iv.questions), "{}", 0, "open", via, now);
  R.sql.exec("UPDATE sessions SET waiting='interview' WHERE id=?", ctx.session);   // "Waiting on your answers" (cleared by their next message)
  ctx.line = "putting together a few questions"; ctx.emit?.({ t: "status", line: ctx.line });
  ctx.emit?.({ t: "interview", interview: ivView(ivRow(R.sql, id), R.sql) });
  const n = iv.questions.length;
  return `The interview "${iv.title}" (${n} questions) is now on the person's screen as a card in this chat${via === "text" ? ", and it goes to their phone as a card they can tap right after your reply" : ""}. They answer at their own pace and can skip any question. Their answers will arrive as their next message, starting "${IV_PREFIX}${iv.title}:". End your turn now with one short, friendly line (don't repeat or answer the questions yourself). When the answers arrive, act on them and say briefly what changed.`;
}

// ---- The person's taps. → view, or { error, status } ----
export async function interviewOp(R, id, b = {}, { post = "" } = {}) {
  const r = ivRow(R.sql, id); if (!r) return { error: "No such interview.", status: 404 };
  const iv = ivOf(r), n = iv.questions.length, op = String(b.op || "");
  const current = ivView(r, R.sql);
  if (current.status === "closed") return { error: "question_closed", status: 409, interview: current };
  if (iv.status !== "open") {
    if (op === "send" && post) return submitAnswers(R, r, iv);
    return { error: "already_sent", status: 409, interview: ivView(iv, R.sql) };
  }
  const stepOf = (x, d) => { const s = Number(x); return Number.isFinite(s) ? Math.max(0, Math.min(n, Math.round(s))) : d; };
  if (op === "answer" || op === "skip") {
    const q = iv.questions.find((x) => x.id === String(b.q)); if (!q) return { error: "No such question.", status: 400 };
    const i = iv.questions.indexOf(q);
    if (op === "answer") { const c = checkAnswer(q, b.answer); if (c.error) return { error: c.error, status: 400 }; iv.answers[q.id] = { ...c.a, at: Date.now() }; }
    else iv.answers[q.id] = { skipped: true, at: Date.now() };
    iv.step = stepOf(b.step, i + 1);
  } else if (op === "goto") iv.step = stepOf(b.step, iv.step);
  else if (op === "send") {
    const message = formatAnswers(iv), now = Date.now();
    R.sql.exec("UPDATE chat_interviews SET status='sent', sent_at=?, message=?, step=?, updated=? WHERE id=? AND status='open'", now, message, n, now, id);
    const view = ivView(ivRow(R.sql, id), R.sql);
    if (post) return submitAnswers(R, ivRow(R.sql, id), ivOf(ivRow(R.sql, id)));
    return { interview: view, message };
  } else return { error: "op must be answer, skip, goto or send", status: 400 };
  R.sql.exec("UPDATE chat_interviews SET answers=?, step=?, updated=? WHERE id=?", JSON.stringify(iv.answers), iv.step, Date.now(), id);
  return { interview: ivView(ivRow(R.sql, id), R.sql) };
}
// Sending from either UI is a server operation. The stored interview supplies the original task and turn.
async function submitAnswers(R, row, iv) {
  const message = row.message || formatAnswers(iv);
  if (row.posted_at) return { interview: ivView(row, R.sql), message, posted: true, duplicate: true };
  let result;
  try { result = await postAnswers(R, iv, message); }
  catch (e) { console.log("interview post", e.message); return { error: "Your answers could not be saved. Please try Send answers again.", status: 503, interview: ivView(row, R.sql) }; }
  if (!result?.ok) {
    const view = ivView(row, R.sql);
    return { error: view.status === "closed" ? "question_closed" : result?.error || "Your answers could not be saved.", status: result?.status || 409, interview: view };
  }
  R.sql.exec("UPDATE chat_interviews SET posted_at=? WHERE id=?", Date.now(), iv.id);
  return { interview: ivView(ivRow(R.sql, iv.id), R.sql), message, posted: true, ...(result.duplicate ? { duplicate: true } : {}) };
}
async function postAnswers(R, iv, message) {
  const tenant = R.get("tenant"), channel = R.get("channel"), channelId = R.get("channel_id");
  const source = await R.inputSource(tenant, channel, channelId, String(iv.turn));
  if (!source?.ok || String(source.session) !== String(iv.session)) return { error: source?.error || "This interview's task is no longer available.", status: source?.status || 410 };
  const tx = await R.env.DB.prepare("SELECT status FROM texting WHERE tenant_id=?").bind(tenant).first().catch(() => null);
  return R.inputReply(tenant, channel, channelId, iv.session, message, { source_turn: String(iv.turn), response_id: `interview:${iv.id}`, ...(source.input_request?.question_id ? { question_id: source.input_request.question_id } : {}) }, { viaText: tx?.status === "connected" && iv.via === "text", origin: { surface: "interview" } });
}

// ---- By text: the card follows the reply. ----
const pendingText = (sql, turn) => turn ? sql.exec("SELECT * FROM chat_interviews WHERE turn=? AND via='text' AND texted_at IS NULL ORDER BY at", String(turn)).toArray() : [];
// The reply is empty but an interview card is about to go out: no "snag" text first.
export const ivOnlyCard = (sql, r) => !String(r?.reply || "").trim() && !r?.error && pendingText(sql, r?.turn).length > 0;
export async function saveInterviewCard(env, { tenant, channel, id, title }) {
  const msgId = `interview:${id}`, token = await cardToken(env, tenant, channel, msgId);
  await env.DB.prepare("INSERT OR IGNORE INTO cards (token,tenant_id,channel,msg_id,body,say,sent_at,kind) VALUES (?,?,?,?,?,?,?,?)")
    .bind(token, tenant, channel, msgId, JSON.stringify({ interview: id }), String(title).slice(0, 200), Date.now(), "interview").run();
  return { token, url: cardUrl(env, token) };
}
export async function ivDeliverTexted(R, tenant, channel, r) {
  for (const row of pendingText(R.sql, r?.turn)) {
    R.sql.exec("UPDATE chat_interviews SET texted_at=? WHERE id=?", Date.now(), row.id);
    const iv = ivOf(row), n = iv.questions.length;
    const prof = await R.env.DB.prepare("SELECT helper_name FROM tenants WHERE id=?").bind(tenant).first().catch(() => null), helper = helperName(prof);
    const card = await saveInterviewCard(R.env, { tenant, channel, id: iv.id, title: iv.title });
    const sent = await deliverCard(R.env, tenant, { url: card.url, layout: { caption: iv.title, subcaption: `${n} questions · ${String(helper).slice(0, 40)}`, summary: iv.title },
      fallback: `${iv.title}: ${n} quick questions from ${helper}. Tap the link to answer them one at a time (skip any you like), then tap Send answers:\n${card.url}` });
    if (!sent?.ok) console.log("interview card not texted", sent?.reason || "");
  }
}

// ---- /w/<slug>/api/res/<ch>/interviews/<id> (index.js) ----
export async function interviewChatApi(req, env, t, m, { json, access, archive }) {
  const chans = await archive(env, t.id).channels(), slugOf = (c) => c.slug || c.name, ch = chans.find((c) => slugOf(c) === m[1]);
  if (!ch) return json({ error: "no such channel" }, 404);
  const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${t.id}:${slugOf(ch)}`)); await R.bind(t.id, slugOf(ch), String(ch.id));
  if (req.method === "GET") { const v = await R.interviewView(m[2]); return v ? json({ interview: v }) : json({ error: "No such interview." }, 404); }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (access?.mode === "read_only") return json({ error: "payment_required", message: access.message || "Your 1Helm plan isn't active, so 1Helm is read-only.", access }, 402);
  const b = await boundedJson(req); const d = await R.interviewOp(m[2], b, { post: b.op === "send" ? "app" : "" });
  return json(d, d.error ? d.status || 400 : 200);
}

// ---- /c/<token> with kind "interview" (cards.js): GET /data · POST /iv {op…} ----
export async function ivCardRoute(env, sub, c, helper, limited, b) {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
  const id = parse(c.body, {}).interview; if (!id) return json({ error: "not found" }, 404);
  const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${c.tenant_id}:${c.channel}`));
  if (sub === "/data") { const v = await R.interviewView(String(id)); return v ? json({ kind: "interview", interview: v, helper, sentAt: Number(c.sent_at) }) : json({ error: "not found" }, 404); }
  if (!b || typeof b !== "object") return json({ error: "bad request" }, 400);
  if (b.op === "send" && await limited()) return json({ error: "slow_down" }, 429);
  const d = await R.interviewOp(String(id), b, { post: b.op === "send" ? "card" : "" });
  return json(d, d.error ? d.status || 400 : 200);
}
