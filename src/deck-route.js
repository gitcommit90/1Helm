// Which tool builds a deck (Captain, 2026-10-24: "Default the decks to HTML unless a person names a specific tool or chooses one before").
// For a request to make slides, a deck or a presentation, in this order:
//   1. The person names a tool in the request (or earlier in this task): Google Slides, PowerPoint, Keynote, Canva, an HTML or PDF deck. It is used.
//      Google Slides connected -> the helper builds it in Google Slides itself (skill google-slides; a background helper can't run app actions,
//      so start_helper refuses a Google Slides deck job). Not connected -> the Google Slides Connect card, once per task, and the helper waits;
//      Not now (or connection suggestions off) -> the HTML deck, and the channel's `deck_tool` becomes html (declineSlides), so later
//      unnamed decks stay HTML with no card until a message names Google Slides again.
//   2. No tool named now, but one was named before in this channel: that earlier choice is used. It is the channel's kv key `deck_tool`
//      (google, pptx or html), written whenever a message names a deck tool, so naming a tool again replaces it. A task's own earlier messages
//      count too, newest first.
//   3. Neither: the HTML deck (artifacts skill, presentation reference). No Connect card, and no Slides note even when Google Slides is connected.
// The route is a one-line note in the message (like integration-hint.js, never saved) and the start_helper gate (resident.js helperTool).
import { enabled as eeEnabled, statusFor, offerRow, offersFlag } from "./ee/index.js";   // the licensed seam: Google Slides needs connected apps, which only the 1HC service has

const DECK = /\b(?:decks?|slides?|slideshows?|presentations?|power ?points?|pptx?|keynote)\b/i;
const GOOGLE = /\bgoogle ?(?:slides?|presentations?|decks?)\b|\bg-?slides?\b|slides\.google|docs\.google\.com\/presentation/i;
const PPTX = /\b(?:power ?points?|pptx?)\b/i;
const HTML = /\b(?:keynote|html (?:decks?|slides?|presentations?)|pdf (?:decks?|slides|presentations?)|(?:decks?|slides?|presentations?) (?:as|in|with|using|from) (?:an? )?(?:html|pdf|keynote))\b/i;
const NEEDS_DECK = /\b(?:canva|prezi)\b/i;   // these name a tool for anything, so they only count next to a deck word
export const SLIDES_APP = "googleslides";
export const DECK_KEY = "deck_tool";

// One message → "google" | "pptx" | "html" (a named tool that the HTML pipeline stands in for) | null (names no deck tool).
export function deckTool(text) {
  const t = String(text || "");
  if (GOOGLE.test(t)) return "google";
  if (PPTX.test(t)) return "pptx";
  if (HTML.test(t) || (NEEDS_DECK.test(t) && DECK.test(t))) return "html";
  return null;
}
export const isDeckJob = (text) => DECK.test(String(text || ""));
export const namesGoogleSlides = (text) => GOOGLE.test(String(text || ""));

// words: the person's own messages, newest first. remembered: the channel's earlier choice (or null).
// → { tool: "google" | "pptx" | "html", named: bool (named in these words) } or null when the words aren't about a deck.
// The newest message that names a tool decides, so "actually in Google Slides" after "a PowerPoint" is Google Slides.
export function deckAsk(words = [], remembered = null) {
  const ws = words.map((w) => String(w || "")).filter(Boolean);
  if (!ws.some((w) => DECK.test(w) || deckTool(w))) return null;
  for (const w of ws) { const t = deckTool(w); if (t) return { tool: t, named: true }; }
  return { tool: remembered || "html", named: false };
}

// s: { status: "connected" | "expired" | "not connected", offer: null | "pending" | "dismissed" | "connected", off: connection suggestions turned off }
// → { route: "slides" | "card" | "wait" | "html" | "pptx", tool, named } or null when the words aren't about a deck.
export function deckPlan(words, remembered, s = {}) {
  const a = deckAsk(words, remembered); if (!a) return null;
  if (a.tool === "pptx") return { route: "pptx", ...a };
  if (a.tool === "html") return { route: "html", ...a };
  if (s.status === "connected") return { route: "slides", ...a };
  if (s.offer === "dismissed" || s.off) return { route: "html", ...a };
  if (s.offer === "pending") return { route: "wait", ...a };
  return { route: "card", ...a };
}

// The channel's remembered choice (the Resident's kv; one Resident is one channel, so it is per channel). Written whenever the person's message
// names a deck tool, and only then.
export function rememberedTool(res) {
  try { const v = res.sql.exec("SELECT v FROM kv WHERE k=?", DECK_KEY).toArray()[0]?.v; return v === "google" || v === "pptx" || v === "html" ? v : null; } catch { return null; }
}
export function rememberDeckTool(res, text) {
  const t = deckTool(text); if (!t) return;
  try { res.sql.exec("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", DECK_KEY, t); } catch {}
}

// Declining the Google Slides Connect card (connect-offer.js offerAct) sets the channel's choice to html, so later unnamed deck requests build the HTML
// deck with no card. Only a message that names Google Slides again (rememberDeckTool) sets it back to google. Captain, 2026-10-25.
export function declineSlides(res) {
  try { if (rememberedTool(res) === "google") res.sql.exec("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", DECK_KEY, "html"); } catch {}
}

// This workspace's Google Slides state: connection and the Connect card of this task.
export async function slidesState(res, session) {
  let conns = []; try { conns = await res.conns(); } catch {}
  const st = statusFor(SLIDES_APP, conns);
  let off = false; try { off = (await offersFlag(res.env, res.get("tenant"))) === "off"; } catch {}
  let offer = null; try { offer = session ? offerRow(res.sql, session, SLIDES_APP)?.status || null : null; } catch {}
  return { status: st.status, offer, off };
}

// The person's words for a new message: it, then their earlier messages in this task (newest first).
export function messageWords(res, session, text, turn = "") {
  const out = [String(text || "")];
  if (session) { try { for (const r of res.sql.exec("SELECT user_text FROM turns WHERE session=? AND kind='chat' AND id<>? ORDER BY at DESC LIMIT 8", session, turn || "").toArray()) if (r.user_text) out.push(String(r.user_text)); } catch {} }
  return out;
}

// Only a Google Slides choice needs the connection state, so a message about anything else (or an HTML or PowerPoint deck) reads nothing more.
// Apps off (no COMPOSIO_KEY, or a public install where connected apps are not enabled): Google Slides can't be used, so a Google choice builds the HTML deck.
const appsOn = (env) => !!env?.COMPOSIO_KEY && eeEnabled(env);
async function planFor(res, session, words) {
  const a = deckAsk(words, rememberedTool(res)); if (!a) return null;
  if (a.tool !== "google") return deckPlan(words, a.tool, {});
  if (!appsOn(res?.env)) return { route: "html", ...a };
  return deckPlan(words, "google", await slidesState(res, session));
}

const LINES = {
  slides: "(Slides request. Google Slides is connected, so build the deck in Google Slides yourself in this turn: read_skill google-slides, not the artifacts skill's deck pages, and don't start a helper for it (helpers can't use apps).)",
  card: "(Slides request. The person asked for Google Slides (now or earlier in this channel), and it isn't connected yet (a connected Gmail or other Google app doesn't cover it). Call offer_connect with app googleslides and a one-line why, then end your turn and wait for the person. Don't build an HTML deck and don't start a helper. If they tap Not now or say no, build the built-in deck from the artifacts skill's presentation reference.)",
  wait: "(Slides request. The Connect card for Google Slides is on screen. If they connected it, build the deck in Google Slides yourself (read_skill google-slides). If they declined or asked for something else, build the built-in deck from the artifacts skill's presentation reference.)",
  pptx: "(Slides request. The person chose PowerPoint earlier in this channel, so build the deck from the artifacts skill's presentation reference and add --pptx to make_deck.sh.)",
};
export async function slidesLine(res, session, text, turn = "") {
  rememberDeckTool(res, text);   // before the plan, so naming a tool now already counts
  const p = await planFor(res, session, messageWords(res, session, text, turn));
  return p && (p.named && p.route === "pptx" ? "" : LINES[p.route]) || "";
}

// start_helper: a deck job on the Google Slides route isn't started (a helper can't run app actions), and neither is one that waits for the Connect
// card. An HTML or PowerPoint deck may go to a helper. → the refusal text, or null.
export async function slidesGate(res, tc, job, words) {
  if (!appsOn(res?.env) || !isDeckJob(job)) return null;
  const p = await planFor(res, tc?.session, words);
  if (p?.route === "slides") return "error: Google Slides is connected, so this deck is built in Google Slides, by you, not a helper (helpers can't use apps). Read the google-slides skill and build it now. If you need research first, start a helper for the research only, without the deck in its job.";
  if (p?.route === "card") return "error: Google Slides isn't connected yet. Call offer_connect with app googleslides first and wait for the person. Only if they decline does the built-in deck apply.";
  return null;
}

// A Google Slides write that asked for pictures but whose replies hold no createImage (Captain, 2026-10-24: GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE with
// `![alt](url)` in markdown_text answered ok, the helper said "Photos are now next to the text", and the slides held hyperlinked text, not pictures).
// x: the app_run input { app, action, arguments }; out: the action's result text. → out, with a plain line added when pictures were asked for and not made.
const IMG_TAG = /!\[[^\]]*\]\(\s*https?:\/\/[^)\s]+/g;
export function imageAsked(args = {}) {
  const md = typeof args.markdown_text === "string" ? (args.markdown_text.match(IMG_TAG) || []).length : 0;
  const raw = Array.isArray(args.requests) ? args.requests.filter((r) => r && typeof r === "object" && "createImage" in r).length : 0;
  return { md, raw };
}
export function slidesImageNote(x, out) {
  const act = String(x?.action || "").toUpperCase(), text = String(out ?? "");
  if (act !== "GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE" && act !== "GOOGLESLIDES_CREATE_SLIDES_MARKDOWN") return text;
  if (/^(error|NOT |ASK FIRST|WAITING FOR CONFIRM)/.test(text)) return text;
  let args = x?.arguments || {}; if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
  if (typeof args.requests === "string") { try { args = { ...args, requests: JSON.parse(args.requests) }; } catch {} }
  const { md, raw } = imageAsked(args), asked = md + raw;
  if (!asked) return text;
  if (act === "GOOGLESLIDES_CREATE_SLIDES_MARKDOWN") return `${text}\n[1Helm check] ${asked} picture${asked === 1 ? "" : "s"} asked for in the markdown, and this action's result doesn't say whether they were made. Don't tell the person pictures are in until you've read the slides back (GOOGLESLIDES_PRESENTATIONS_GET with fields slides(objectId,pageElements(objectId,image))). Markdown image tags can end up as text links, so add any missing picture with a raw createImage request in GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE.`;
  const made = (text.match(/"createImage"\s*:/g) || []).length;
  if (made >= asked) return text;
  return `${text}\n[1Helm check] ${asked} picture${asked === 1 ? "" : "s"} asked for, ${made} made: the replies hold ${made ? `only ${made} createImage` : "no createImage"}, so ${made ? "the rest were" : "the pictures were"} NOT added${md ? " and any image tags in the markdown became plain text or links" : ""}. Don't tell the person pictures are in. Add each one with a raw createImage request (GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE with requests, not markdown_text), then read the slides back with GOOGLESLIDES_PRESENTATIONS_GET.`;
}
