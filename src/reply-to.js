// Replying to a message (the app's Reply on a chat bubble, like iMessage): the person picks one earlier message of the task and
// types; their message carries { id, role, text } (role "agent" = one of the helper's replies, "user" = one of their own messages;
// id = the reply's card / turn id or the person's message id; text = a short plain excerpt). It's stored on the message's card
// event (card_events.reply), so the transcript, the history and a resumed turn keep it, and the model reads one compact line with
// that message. Model-agnostic plain text, inside the person's message (never the system prompt), so the cached prefix stays as it was.

const MAX = 240;   // excerpt characters the model reads (the full message stays in the task's history)
const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const ell = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// A canvas selection (Zone A): the Library file the person has open next to the chat and the element they selected in it. It rides in
// the same ref as a bubble reply, as an optional "zone" object. Every field is cleaned; anything unusable is no zone.
const label1 = (s, n) => ell(one(s).replace(/"/g, "'"), n);
const posInt = (x) => { const n = Number(x); return Number.isInteger(n) && n >= 1 && n <= 99999 ? n : null; };
export function zoneRef(z) {
  if (!z || typeof z !== "object") return null;
  const file = typeof z.file === "string" && /^[0-9a-f-]{36}$/i.test(z.file) ? z.file.toLowerCase() : null; if (!file) return null;
  const kind = z.kind === "deck" || z.kind === "report" || z.kind === "doc" ? z.kind : z.kind === "page" ? "page" : null; if (!kind) return null;
  const slot = typeof z.slot === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(z.slot) ? z.slot : null;
  const sel = typeof z.sel === "string" && /^\d{1,4}(\/\d{1,4}){0,40}$/.test(z.sel) ? z.sel : null;
  return { file, name: label1(z.name, 200), kind, slide: posInt(z.slide), of: posInt(z.of), slot, sel, label: label1(z.label, 60), text: label1(z.text, 400) };
}
const zoneLabel = (z) => [z.slide ? (z.kind === "doc" ? `Page ${z.slide}` : `Slide ${z.slide}`) : z.kind === "report" ? "Report" : "", z.label || z.slot || (z.sel ? "Element" : "")].filter(Boolean).join(", ") || z.name || "Selection";
// What the app sent → a clean ref, or null when there's nothing to quote. The id is optional (a reply still streaming may not have one).
// A selection-only message has role "zone" (its text is a short label); a reply to a bubble that also has a selection keeps the bubble's
// role and text and carries "zone" as well.
export function replyRef(x) {
  if (!x || typeof x !== "object") return null;
  const zone = zoneRef(x.zone);
  let text = ell(one(x.text).replace(/"/g, "'"), MAX);
  if (!text && !zone) return null;
  const id = typeof x.id === "string" || typeof x.id === "number" ? String(x.id).slice(0, 64) : null;
  if (!text) text = ell(zoneLabel(zone), MAX);
  const role = x.role === "user" ? "user" : x.role === "zone" && zone ? "zone" : "agent";
  return { id: id || null, role, text, ...(zone ? { zone } : {}) };
}
// Stored as JSON on the card event; parsed back for the views. Anything unreadable is no reply.
export const replyOut = (x) => { const r = replyRef(x); return r ? JSON.stringify(r) : null; };
export const replyIn = (s) => { if (!s) return null; try { return replyRef(JSON.parse(s)); } catch { return null; } };

// The sentence the model reads about a selection: what the person has selected, nothing about how to work.
export function zoneSentence(z) {
  const kind = z.kind === "deck" ? "deck" : z.kind === "report" ? "report" : z.kind === "doc" ? "document" : "page";
  const where = z.slide ? (kind === "report" || kind === "document" ? `page ${z.slide}${z.of ? ` of ${z.of}` : ""}` : `slide ${z.slide}${z.of ? ` of ${z.of}` : ""}`) : "";
  if (kind === "document" && z.text) return `(The person has this selected in the canvas: a paragraph${where ? ` on ${where}` : ""} of the document "${z.name}" (Library file ${z.file}), now reading "${z.text}". Their message is about it.)`;
  const what = z.slot ? `the ${z.label || z.slot} (data-slot "${z.slot}")` : z.sel ? `the ${z.label ? `${z.label} ` : "element "}at path ${z.sel}` : z.label ? `the ${z.label}` : kind === "report" ? (z.text ? "a passage" : "") : kind === "document" ? "" : where ? "the whole slide" : "the whole page";
  const target = [where, what].filter(Boolean).join(", ");
  return `(The person has this selected in the canvas: ${target} of the ${kind} "${z.name}" (Library file ${z.file})${z.text ? `, now reading "${z.text}"` : ""}. Their message is about it.)`;
}
// The line(s) the model reads, just before what the person wrote.
export function replyLine(x) {
  const r = replyRef(x); if (!r) return "";
  const z = r.zone ? zoneSentence(r.zone) : "";
  if (r.role === "zone") return z;
  const b = r.role === "user" ? `(Replying to their own earlier message: "${r.text}")` : `(Replying to your earlier message: "${r.text}")`;
  return z ? `${b}\n${z}` : b;
}
// The person's words with the line in front ("" ref → the words unchanged).
export const withReply = (text, x) => { const l = replyLine(x); return l ? `${l}\n${String(text ?? "")}` : String(text ?? ""); };
