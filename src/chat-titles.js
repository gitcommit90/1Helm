// Session names are separate from activity-card labels. Only newly auto-created
// chats opt in; explicit names and existing conversations keep their titles.
export const CHAT_TITLE_PROMPT = `Summarize the chat into a concise 2-4 word title
Avoid emojis, quotes, or special formatting.`;

function words(value) {
  return typeof value === "string" ? value.normalize("NFC").replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D\u20E3]/gu, " ").replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").trim().split(/\s+/u).filter(Boolean) : [];
}
export function cleanChatTitle(value) {
  const parts = words(value), title = parts.join(" ");
  return parts.length >= 2 && parts.length <= 4 && title.length <= 80 ? title : null;
}
export function fallbackChatTitle(text) {
  const plain = String(text || "").replace(/^(?:(?:hey|hi|ok|okay|so)[,!. ]+|(?:can|could|would) you (?:please )?|please )+/i, "");
  const parts = words(plain).filter((part) => part.length <= 30).slice(0, 4);
  if (!parts.length) return "New chat";
  if (parts.length === 1) parts.push("chat");
  while (parts.join(" ").length > 80) parts.pop();
  const title = parts.join(" ");
  return title[0].toUpperCase() + title.slice(1);
}

export function newAutoChat(R, text = "") {
  const id = R.newSession(fallbackChatTitle(text));
  R.put(`chat_title_pending:${id}`, "1");
  return id;
}
// Claim synchronously, before the existing bounded label chore starts. If the
// object restarts during that best-effort chore, the concise placeholder survives
// and later turns do not repeatedly pay to rename the same chat.
export function claimChatTitle(R, session) {
  const key = `chat_title_pending:${session}`;
  if (!R.getRaw(key)) return null;
  R.sql.exec("DELETE FROM kv WHERE k=?", key);
  const row = R.session(session);
  if (!row || row.title_manual || session === R.getRaw("default_session") || R.textsSessions().includes(session)) return null;
  return { id: session, title: row.title, revision: Number(row.title_revision || 0) };
}
export function applyChatTitle(R, claim, title) {
  const clean = cleanChatTitle(title);
  if (!claim || !clean) return;
  R.sql.exec("UPDATE sessions SET title=?, title_revision=title_revision+1 WHERE id=? AND title_manual=0 AND title_revision=? AND title=? AND title<>?", clean, claim.id, claim.revision, claim.title, clean);
}
