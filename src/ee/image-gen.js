// Image generation in a chat (server side). The behavior is described in the comments below.
//
// A task has an image mode: "on" (the person chose to make pictures; the helper gets image_generate and image_edit), "dismissed" (the person said don't ask
// again for this task) or null (not decided; after a No the helper may call offer_image_generation). The mode lives on the task (sessions.image_mode).
// Everything here is for accounts that are not on the Bring your own key plan (imageAllowed). Two saved jobs on the Models page decide the models:
//   image_gen     the picture model (OpenRouter's Image API through the dispatcher, adapter "image"), zero-data-retention endpoints, fallbacks allowed.
//   image_intent  a decision job that reads a message before it is sent and answers yes or no: does it ask for a picture an AI image generator would make.
// A picture is billed like every other call of 1Helm's models on a full plan: a hold on the Ledger first, then the cost OpenRouter reports (plus the usual 15 percent),
// never more than the hold.
import { dispatch } from "./model-dispatch.js";
import { plan } from "./model-plan.js";
import { modelSettingsEnv } from "./model-settings.js";
import { askDecider } from "./text-decision.js";
import { jobTimeoutFor } from "./limits-read.js";
import { DECIDER_IN_NANO } from "./decider.js";
import { createQuestion } from "../user-input.js";
import { stPut } from "../storage.js";
import { cleanMark, cleanZone, markWhere, marksNote } from "../zone-marks.js";

export const IMAGE_JOB = "image_gen", INTENT_JOB = "image_intent";
export const REF_CAP = 5;            // the most reference pictures one call sends, whatever the model takes
export const MAX_N = 3;              // the most pictures one request makes
export const MARKUP = 1.15;
export const HOLD_NANO = 30000000;   // the hold for one picture when the model's saved facts give none
export { IMAGE_TOOL_NAMES } from "./image-names.js";
import { IMAGE_TOOL_NAMES as _NAMES } from "./image-names.js";
export const OFFER_KIND = "image_offer";
export const MODES = ["on", "dismissed"];
const clip = (s, n) => String(s ?? "").slice(0, n);

// ---- who may use it ----
// Not on the Bring your own key plan (tenants.plan === "byok"), and that is the only rule. A full plan whose chat runs on the person's own AI services still has image
// generation: image calls always go through 1Helm's image_gen job and are paid from the plan's usage, like the "1Helm's models" entry of an own-key chain.
// image_ok at boot, the classifier route, the image mode route, the send body and the tools all ask this. Any failure to find out means no.
export async function imageAllowed(env, tenantId) {
  if (!env || !tenantId || !env.DB || env.ONEHELM_EE !== "1hc") return false;   // licensed: a public install never offers image generation
  try { const r = await env.DB.prepare("SELECT plan FROM tenants WHERE id=?").bind(String(tenantId)).first(); return !!r && r.plan !== "byok"; } catch { return false; }
}

// ---- the task's image mode ----
export function imageModeOf(sql, session) {
  try { const m = sql.exec("SELECT image_mode FROM sessions WHERE id=?", String(session)).toArray()[0]?.image_mode; return MODES.includes(m) ? m : null; } catch { return null; }
}
// → true when the task exists. mode: "on" | "dismissed" | null.
export function setImageMode(sql, session, mode) {
  if (mode !== null && !MODES.includes(mode)) return false;
  if (!sql.exec("SELECT 1 FROM sessions WHERE id=?", String(session)).toArray().length) return false;
  sql.exec("UPDATE sessions SET image_mode=? WHERE id=?", mode, String(session));
  return true;
}
// The person's answer to the image offer (the Yes / No / Don't ask again bar): "yes" turns the mode on, "dismiss" stops the offers for this task, "no" changes nothing.
export function offerAnswer(meta, text) {
  const a = String(meta?.action ?? "").toLowerCase(), t = String(text ?? "").trim().toLowerCase();
  const v = ["yes", "no", "dismiss"].includes(a) ? a : /^(yes|y|yeah|sure)\b/.test(t) ? "yes" : /don'?t ask|dismiss|never|stop asking/.test(t) ? "dismiss" : /^(no|n|nope)\b/.test(t) ? "no" : null;
  return v;
}
export function applyOfferAnswer(sql, session, meta, text) {
  const v = offerAnswer(meta, text);
  if (v === "yes") setImageMode(sql, session, "on"); else if (v === "dismiss") setImageMode(sql, session, "dismissed");
  return v;
}

// ---- the check before a message is sent (image_intent) ----
export const INTENT_QUESTIONS = {
  image: {
    type: "choice",
    instructions: "Is this message asking for an artifact that an AI image generator would make? Read message, which is what the person is about to send to an AI helper. Answer yes when it asks for a new picture, illustration, photo, logo, icon, poster, artwork or other image to be made, or asks to change an image that was made. Answer no for everything else, including writing, analysis, code, questions, searches, and requests about reading or describing a picture or file that already exists.",
    criteria: { yes: "The message asks for an image that an AI image generator would make or change.", no: "The message asks for anything else." },
  },
};
// One check. Holds a small amount on the Ledger, asks the saved decision job, settles at the reported cost, and never throws.
// → { choice: "yes"|"no"|null, ms, nano, charge, error }. Any failure, timeout or unclear answer gives choice null, which the caller reads as no.
// deps: { ask, timeoutFor } replace the model call and the timeout lookup, for tests.
export async function runImageIntent(env, { ledger, text, meta = {}, deps = {} } = {}) {
  const ask = deps.ask || askDecider, timeoutFor = deps.timeoutFor || jobTimeoutFor, t0 = Date.now();
  const out = { choice: null, ms: 0, nano: 0, charge: 0, error: null };
  let rid = null;
  try {
    const state = { message: clip(text, 3000) };
    const estimate = Math.ceil(Math.ceil((JSON.stringify(state).length + JSON.stringify(INTENT_QUESTIONS).length) / 3 + 300) * DECIDER_IN_NANO * MARKUP);
    rid = `imgint:${crypto.randomUUID()}`;
    const r = await ledger().reserve(rid, estimate);
    if (!r?.ok) { out.error = r?.reason === "day_limit" ? "day limit reached" : "out of credits"; rid = null; return out; }
    const x = await ask(env, state, INTENT_QUESTIONS, { job: INTENT_JOB, timeoutMs: await timeoutFor(env, INTENT_JOB), title: "1Helm image request check", meta: { ...meta, kind: "decider" }, priceInNano: DECIDER_IN_NANO });
    out.nano = Math.max(0, Number(x?.nano) || 0);
    if (x?.error) out.error = clip(x.error, 160);
    else { const c = x?.answers?.image?.choice; if (Object.hasOwn(INTENT_QUESTIONS.image.criteria, c)) out.choice = c; else out.error = "no valid answer"; }
  } catch (e) { out.error = clip(e?.message || e, 160); }
  finally {
    out.ms = Date.now() - t0;
    if (rid) { out.charge = Math.ceil(out.nano * MARKUP); try { await ledger().settle(rid, out.charge); } catch (e) { out.error = out.error || clip(`settle: ${e?.message || e}`, 160); } }
  }
  return out;
}
// The route's whole decision. allowed: imageAllowed for the account. mode: the task's image_mode (null for a new task). → { ask: boolean }, never throws.
export async function imageIntentAsk(env, { allowed, mode = null, text, ledger, meta = {}, deps = {} } = {}) {
  try {
    if (!allowed || mode) return { ask: false };
    const t = String(text ?? "").trim();
    if (t.length < 3) return { ask: false };
    const r = await runImageIntent(env, { ledger, text: t, meta, deps });
    return { ask: r.choice === "yes" };
  } catch { return { ask: false }; }
}

// ---- the tools ----
export const IMAGE_GENERATE_TOOL = { type: "function", function: { name: "image_generate", description: "Make 1 to 3 new pictures from a text prompt with the image model. The pictures are saved to the Library and shown in this chat. Each picture is paid for from the person's usage. To change a picture that already exists, use image_edit, which sends that picture again with the prompt.",
  parameters: { type: "object", properties: {
    prompt: { type: "string", description: "What the picture should show, in plain words." },
    n: { type: "integer", description: "How many different pictures to make, 1 to 3. The default is 1." },
    references: { type: "array", items: { type: "string" }, description: "Library file ids or names of pictures to send with the prompt as references, at most 5 in all. When left out, the pictures the person attached to this task are sent, newest first." },
    size: { type: "string", description: "Optional. An aspect ratio such as 16:9, or a resolution such as 1K or 2K, when the model takes one." } }, required: ["prompt"] } } };
export const IMAGE_EDIT_TOOL = { type: "function", function: { name: "image_edit", description: "Change a picture that already exists. The source picture is sent again, first, with the prompt, so the new picture is an edit of it. The new picture is saved to the Library and shown in this chat. Each picture is paid for from the person's usage.",
  parameters: { type: "object", properties: {
    prompt: { type: "string", description: "The change to make, in plain words." },
    source: { type: "string", description: "Library file id or name of the picture to change. When left out, the latest picture made in this task is used." },
    references: { type: "array", items: { type: "string" }, description: "Library file ids or names of more pictures to send after the source, at most 5 pictures in all." },
    n: { type: "integer", description: "How many different results to make, 1 to 3. The default is 1." },
    size: { type: "string", description: "Optional. An aspect ratio such as 16:9, or a resolution such as 1K or 2K, when the model takes one." } }, required: ["prompt"] } } };
export const OFFER_IMAGE_TOOL = { type: "function", function: { name: "offer_image_generation", description: "Ask the person whether to generate an image. It shows Yes, No and Don't ask again, and this turn ends until they answer. After Yes, image_generate and image_edit are available. Use it when the person seems to want a picture and image generation is not on in this task.",
  parameters: { type: "object", properties: {} } } };
const TOOL_DEFS = { image_generate: IMAGE_GENERATE_TOOL, image_edit: IMAGE_EDIT_TOOL, offer_image_generation: OFFER_IMAGE_TOOL };
// The tool names a task offers: image mode on gives the two picture tools, no decision yet gives the offer, dismissed or not allowed gives none.
export const imageToolNames = (allowed, mode) => !allowed ? [] : mode === "on" ? ["image_generate", "image_edit"] : mode === "dismissed" ? [] : ["offer_image_generation"];
export const imageToolDefs = (allowed, mode) => imageToolNames(allowed, mode).map((n) => TOOL_DEFS[n]);

// ---- the model and its limits, from the saved job ----
async function imagePlan(env) {
  const e = await modelSettingsEnv(env), settings = e.MODEL_SETTINGS, p = plan(settings, IMAGE_JOB, { level: "zdr" });
  const facts = (m) => settings?.catalog?.[m]?.image || {};
  const holds = p.steps.map((s) => Number(facts(s.model).nano)).filter((x) => x > 0), refs = p.steps.map((s) => Number(facts(s.model).refs)).filter((x) => Number.isFinite(x));
  return { env: Object.create(e, { BYOK: { value: null } }), steps: p.steps,   // 1Helm's own job, billed from the plan's usage, also on a turn that chats on the person's own key
    holdNano: holds.length ? Math.max(...holds) : HOLD_NANO, refCap: Math.min(REF_CAP, refs.length ? Math.max(...refs) : REF_CAP) };
}
const nanoOf = (j, settings, model) => {
  const c = Number(j?.usage?.cost);
  return Number.isFinite(c) && c >= 0 && j?.usage?.cost != null ? Math.round(c * 1e9) : Number(settings?.catalog?.[model]?.image?.nano) || HOLD_NANO;
};

// ---- reference pictures ----
const isImage = (r) => /^image\//.test(r?.mime || "");
const b64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const REF_BYTES_MAX = 6 * 1024 * 1024;
async function dataUrlOf(R, row) {
  if (row.bytes <= REF_BYTES_MAX) { const o = await R.env.WS.get(row.r2key); if (o) return `data:${row.mime};base64,${b64(new Uint8Array(await o.arrayBuffer()))}`; }
  return R.imageDataUrl ? await R.imageDataUrl(row) : null;   // a big original: the app's smaller view of it
}
// The Library picture a name or id points at, or null.
const pic = (R, s) => { const r = s ? R.libFile(String(s)) : null; return r && isImage(r) ? r : null; };
// The newest picture the helper made in this task.
export const latestMade = (sql, session) => sql.exec("SELECT * FROM files WHERE session=? AND source='image_gen' AND deleted=0 ORDER BY at DESC, rowid DESC LIMIT 1", String(session)).toArray()[0] || null;
// The pictures the person attached to this task, newest first.
// An annotated copy (a picture with the editor's marks drawn on it) is tagged "annotation". It goes only as the marked reference of the one send that carries it, never as an automatic reference later.
export const ANNOTATION_TAG = "annotation";
export const isAnnotation = (row) => { try { return JSON.parse(row?.tags || "[]").includes(ANNOTATION_TAG); } catch { return false; } };
const attached = (sql, session) => sql.exec("SELECT * FROM files WHERE session=? AND source='upload' AND deleted=0 AND pending=0 AND mime LIKE 'image/%' AND COALESCE(tags,'') NOT LIKE ? ORDER BY at DESC, rowid DESC LIMIT 20", String(session), `%"${ANNOTATION_TAG}"%`).toArray();
// The rows to send, in order, at most cap. The source (an edit) always goes first, then the annotated copy of it, then the named references, else the person's attached pictures newest first.
export function referenceRows(R, ctx, { source = null, references = null, cap = REF_CAP } = {}) {
  const out = [], seen = new Set(), add = (r) => { if (r && !seen.has(r.id) && out.length < cap) { seen.add(r.id); out.push(r); } };
  if (source) add(source);
  const edit = ctx.imageEdit;
  if (edit && source && edit.source === source.id) add(R.sql.exec("SELECT * FROM files WHERE id=? AND deleted=0", String(edit.marked)).toArray()[0]);
  const named = Array.isArray(references) ? references.map((x) => pic(R, x)).filter(Boolean) : null;
  if (named) named.forEach(add);
  else { for (const id of ctx.attachedIds || []) add(R.sql.exec("SELECT * FROM files WHERE id=? AND deleted=0", String(id)).toArray().find((r) => isImage(r) && !isAnnotation(r))); attached(R.sql, ctx.session).forEach(add); }
  return out;
}

// ---- generating ----
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const sizeFields = (size) => {
  const s = String(size ?? "").trim();
  return /^\d{1,2}(\.\d)?:\d{1,2}(\.\d)?$/.test(s) ? { aspect_ratio: s } : /^(512|768|1K|1\.5K|2K|4K)$/i.test(s) ? { resolution: s.toUpperCase() } : /^\d{3,5}x\d{3,5}$/i.test(s) ? { size: s.toLowerCase() } : {};
};
const cardOf = (id, n, status, files) => ({ kind: "image_gen", id, n, status, files });
const note = (R, ctx, id, n, status, files) => {
  const c = cardOf(id, n, status, files);
  (R._imageCards ||= new Map()).set(ctx.turn, c); if (R._imageCards.size > 20) R._imageCards.delete(R._imageCards.keys().next().value);
  ctx.emit?.({ t: "image_gen", card: c });
};

// Make n pictures. One call of the saved job for each picture (the saved models make one image per call), at most three at the same time.
// The hold is placed first and settled at the end; every picture is saved and shown as soon as it is made.
async function makePictures(R, ctx, { prompt, n, rows, size, label, description }) {
  const P = await imagePlan(R.env);
  if (!P.steps.length) return "error: no image model is set. It is set on the Models page as Image generation.";
  const tenant = R.get("tenant"), channel = R.get("channel"), id = crypto.randomUUID();
  const hold = Math.ceil(n * P.holdNano * MARKUP), rid = `img:${id}`;
  R.resOpen?.(rid, hold, ctx);
  let held; try { held = await R.ledger().reserve(rid, hold); } catch (e) { R.resClose?.(rid); return `error: the usage hold failed (${clip(e?.message || e, 120)}). Nothing was made.`; }
  if (!held?.ok) { R.resClose?.(rid); return held?.reason === "day_limit" ? "error: the person's daily spending limit is reached, so no picture was made." : "error: the person is out of credits, so no picture was made. Tell them to add credits."; }
  let spent = 0; const made = [], errors = [];
  try {
    note(R, ctx, id, n, "working", []);
    const refs = []; for (const r of rows) { const u = await dataUrlOf(R, r); if (u) refs.push(u); }
    const one = async (i) => {
      try {
        const res = await dispatch(P.env, IMAGE_JOB, { prompt, references: refs, ...sizeFields(size) }, { meta: { tenant, channel, kind: "image_gen" }, ...(ctx.ac?.signal ? { signal: ctx.ac.signal } : {}) });
        const j = await res.json(), d = j.data?.find((x) => x?.b64_json);
        spent += nanoOf(j, P.env.MODEL_SETTINGS, res.requested);
        const bytes = Uint8Array.from(atob(d.b64_json), (c) => c.charCodeAt(0)), mime = d.media_type && EXT[d.media_type] ? d.media_type : "image/png";
        const fid = crypto.randomUUID(), key = `t/${tenant}/files/${channel}/${fid}`, name = `${slug(prompt) || "image"}${n > 1 ? `-${i + 1}` : ""}.${EXT[mime]}`;
        try { await stPut(R.env, key, bytes, { httpMetadata: { contentType: mime }, customMetadata: { name } }, { check: true, size: bytes.byteLength }); }
        catch (e) { if (e?.code === "storage_full") throw new Error(e.toolNote || "storage is full"); throw e; }
        const f = R.addFileRow({ id: fid, name, mime, bytes: bytes.byteLength, r2key: key, source: "image_gen", session: ctx.session || null, turn: ctx.turn || null, synced: 0, description });
        ctx.emit?.({ t: "file", file: f }); R.recordShare(f, ctx.turn);
        made.push(f); note(R, ctx, id, n, "working", made.map((x) => x.id));
      } catch (e) { if (e?.cost) spent += Number(e.cost) || 0; errors.push(clip((e?.errors?.[0] || e?.message || e), 200)); }
    };
    const todo = [...Array(n).keys()]; await Promise.all([0, 1, 2].slice(0, n).map(async () => { while (todo.length) await one(todo.shift()); }));
  } finally {
    const charge = Math.ceil(spent * MARKUP);
    try { await R.ledger().settle(rid, charge); } catch (e) { console.log("image settle", clip(e?.message || e, 120)); }
    R.resClose?.(rid); ctx.extraCharge = (ctx.extraCharge || 0) + Math.min(charge, hold);
  }
  note(R, ctx, id, n, made.length ? "done" : "failed", made.map((x) => x.id));
  if (!made.length) return `error: no picture was made (${errors[0] || "unknown error"}). Nothing was charged for pictures that were not made.`;
  const list = made.map((f) => `file ${f.id} "${f.name}"`).join(", ");
  return `${label} ${made.length} of ${n} picture${n > 1 ? "s" : ""}: ${list}. ${made.length === 1 ? "It is" : "They are"} shown in the chat and saved in the Library. To change one, call image_edit with its file id. Say in one short line what ${made.length === 1 ? "it shows" : "they show"}.${errors.length ? ` ${errors.length} failed: ${errors[0]}.` : ""}`;
}

const nOf = (a) => Math.min(MAX_N, Math.max(1, Math.trunc(Number(a.n)) || 1));
// The three tools. ctx is the turn (tc). Returns the text the model reads.
export async function runImageTool(R, name, a, ctx) {
  if (ctx.kind !== "chat" || ctx.helper || !(await imageAllowed(R.env, R.get("tenant")))) return "error: image generation isn't available here.";
  const mode = imageModeOf(R.sql, ctx.session);
  if (name === "offer_image_generation") {
    if (mode === "on") return "error: image generation is already on in this task. Use image_generate or image_edit.";
    if (mode === "dismissed") return "error: the person chose not to be asked again in this task.";
    const q = createQuestion(R.sql, ctx, { question: "Do you want to generate an image?", kind: OFFER_KIND });
    if (q.error) return `error: ${q.error}`;
    ctx.inputRequest = q; ctx.orchestration ||= {}; ctx.orchestration.waitingInput = true;
    const out = JSON.stringify({ question_id: q.question_id, status: "waiting", instruction: "The question is shown with Yes, No and Don't ask again. Wait for the person's answer." });
    R.journalDelegation(ctx, "offer_image_generation", out);
    ctx.emit?.({ t: "user_input", input: q });
    return out;
  }
  if (mode !== "on") return "error: image generation is not on in this task. offer_image_generation asks the person whether to turn it on.";
  const prompt = clip(a.prompt, 4000).trim(); if (!prompt) return "error: prompt is required.";
  const P = await imagePlan(R.env), n = nOf(a);
  if (name === "image_generate") return makePictures(R, ctx, { prompt, n, rows: referenceRows(R, ctx, { references: a.references, cap: P.refCap }), size: a.size, label: "Made", description: prompt });
  // image_edit: the source goes first, always.
  const source = a.source ? pic(R, a.source) : (ctx.imageEdit?.source && pic(R, ctx.imageEdit.source)) || latestMade(R.sql, ctx.session);
  if (!source) return a.source ? `error: there's no picture "${clip(a.source, 80)}" in the Library.` : "error: there is no picture in this task to change yet. Use image_generate, or give a source.";
  return makePictures(R, ctx, { prompt, n, rows: referenceRows(R, ctx, { source, references: a.references, cap: P.refCap }), size: a.size, label: "Edited and made", description: `${prompt} (an edit of "${source.name}")` });
}

// ---- a message sent with image: true or with annotations ----
// opts.annotations = { source, marked, marks: [{ n, color, note }] } (checked by the route). Checks that both pictures exist in this channel, adds the marked picture to the
// message's files, and turns the marks into a note for the helper. → { opts } | { error, status }.
// imageOk: the account may use image generation. A send of marks on any other Zone file (a deck, a page, a document) or on a picture on a plan without
// image generation only describes the marks (zone-marks.js): no image mode and no image_edit. It makes no model call.
export function prepareImageSend(R, sessionId, opts = {}, imageOk = true) {
  const an = opts.annotations, zk = an?.zone?.kind;
  if (an && !(imageOk && (!zk || zk === "image"))) return prepareMarksSend(R, opts);
  setImageMode(R.sql, sessionId, "on");
  if (!an) return { opts };
  const get = (id) => R.sql.exec("SELECT * FROM files WHERE id=? AND deleted=0", String(id)).toArray()[0];
  const src = get(an.source), marked = get(an.marked);
  if (!src || !isImage(src)) return { error: "The picture to edit was not found in this channel.", status: 404 };
  if (!marked || !isImage(marked)) return { error: "The marked picture was not found in this channel.", status: 404 };
  const marks = (an.marks || []).slice(0, 20).map((m) => { const w = markWhere(m, an.zone); return `${Math.trunc(Number(m.n))} (${clip(m.color, 24)})${String(m.note ?? "").trim() ? `: ${clip(m.note, 500).trim()}` : ""}${w ? `${String(m.note ?? "").trim() ? "; " : ": "}${w}` : ""}`; });
  const text = `Edit request from the image editor. The picture to change is file ${src.id} "${src.name}". The picture that came with this message is a copy of it with numbered marks drawn on it (file ${marked.id}). Each mark is a place to change.${marks.length ? ` Marks, as number (color): note:\n${marks.join("\n")}` : ""}\nMake the change with image_edit; the source picture is sent first and the marked copy second.`;
  tagAnnotation(R, marked);
  const files = [...new Set([...(opts.files || []).map(String), String(marked.id)])].slice(0, 10);
  return { opts: { ...opts, files, note: clip(`${opts.note ? `${opts.note}\n\n` : ""}${text}`, 6000), imageEdit: { source: src.id, marked: marked.id, marks: an.marks || [], ...(an.zone ? { zone: an.zone } : {}) } } };
}
// The marked copy is tagged, so from now on it is not an automatic reference.
function tagAnnotation(R, marked) { try { const tags = JSON.parse(marked.tags || "[]"); if (!tags.includes(ANNOTATION_TAG)) R.sql.exec("UPDATE files SET tags=? WHERE id=?", JSON.stringify([...tags, ANNOTATION_TAG]), marked.id); } catch {} }
// Marks on a Zone file: both files must exist in this channel; the marked screenshot rides along; the marks become plain lines for the helper.
function prepareMarksSend(R, opts) {
  const an = opts.annotations, get = (id) => R.sql.exec("SELECT * FROM files WHERE id=? AND deleted=0", String(id)).toArray()[0];
  const src = get(an.source), marked = get(an.marked);
  if (!src) return { error: "The file that was marked was not found in this channel.", status: 404 };
  if (!marked || !isImage(marked)) return { error: "The marked picture was not found in this channel.", status: 404 };
  tagAnnotation(R, marked);
  const files = [...new Set([...(opts.files || []).map(String), String(marked.id)])].slice(0, 10);
  return { opts: { ...opts, files, note: clip(`${opts.note ? `${opts.note}\n\n` : ""}${marksNote(an, src, marked)}`, 6000), marksOut: { source: src.id, marked: marked.id, marks: an.marks || [], ...(an.zone ? { zone: an.zone } : {}) } } };
}
// A new task whose first message carries image_mode "dismissed" (the person chose Don't ask again before the task existed) starts dismissed. A task that already decided keeps its mode.
export function dismissOnSend(sql, sessionId) { if (imageModeOf(sql, sessionId) === null) setImageMode(sql, sessionId, "dismissed"); }
// The route's check of the annotations field. → the clean object, or null when it is not valid.
export function cleanAnnotations(x) {
  if (x == null) return undefined;
  const id = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
  if (typeof x !== "object" || Array.isArray(x) || !id(x.source) || !id(x.marked) || !Array.isArray(x.marks) || x.marks.length > 20) return null;
  const marks = [];
  for (const m of x.marks) { const c = cleanMark(m); if (!c) return null; marks.push(c); }
  const zone = cleanZone(x.zone); if (zone === null) return null;
  return { source: x.source, marked: x.marked, marks, ...(zone ? { zone } : {}) };
}
// The note every turn in image mode carries (facts only): what is on and the latest picture made.
export function imageModeNote(R, ctx) {
  if (ctx.imageMode !== "on") return "";
  const last = latestMade(R.sql, ctx.session);
  return `\n\n(Image mode is on in this task. image_generate makes new pictures and image_edit changes one, sending it again as the first reference. Each picture is paid for from the person's usage.${last ? ` The latest picture made here is file ${last.id} "${last.name}".` : ""})`;
}
