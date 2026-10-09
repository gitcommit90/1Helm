// Replying to a message (the app's Reply on a chat bubble, like iMessage): the person picks one earlier message of the task and
// types; their message carries { id, role, text } (role "agent" = one of the helper's replies, "user" = one of their own messages;
// id = the reply's card / turn id or the person's message id; text = a short plain excerpt). It's stored on the message's card
// event (card_events.reply), so the transcript, the history and a resumed turn keep it, and the model reads one compact line with
// that message. Model-agnostic plain text, inside the person's message (never the system prompt), so the cached prefix stays as it was.

const MAX = 240;   // excerpt characters the model reads (the full message stays in the task's history)
const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const ell = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// What the app sent → a clean ref, or null when there's nothing to quote. The id is optional (a reply still streaming may not have one).
export function replyRef(x) {
  if (!x || typeof x !== "object") return null;
  const text = ell(one(x.text).replace(/"/g, "'"), MAX);
  if (!text) return null;
  const id = typeof x.id === "string" || typeof x.id === "number" ? String(x.id).slice(0, 64) : null;
  return { id: id || null, role: x.role === "user" ? "user" : "agent", text };
}
// Stored as JSON on the card event; parsed back for the views. Anything unreadable is no reply.
export const replyOut = (x) => { const r = replyRef(x); return r ? JSON.stringify(r) : null; };
export const replyIn = (s) => { if (!s) return null; try { return replyRef(JSON.parse(s)); } catch { return null; } };

// The line the model reads, just before what the person wrote.
export function replyLine(x) {
  const r = replyRef(x); if (!r) return "";
  return r.role === "user" ? `(Replying to their own earlier message: "${r.text}")` : `(Replying to your earlier message: "${r.text}")`;
}
// The person's words with the line in front ("" ref → the words unchanged).
export const withReply = (text, x) => { const l = replyLine(x); return l ? `${l}\n${String(text ?? "")}` : String(text ?? ""); };
