// Session names are separate from activity-card labels. Only newly auto-created
// chats opt in; explicit names and existing conversations keep their titles.
// The name comes from one small model call (the "chat_title" job on the Models page) that starts when the
// chat's first message is sent, in parallel with the turn.
import { dispatch, plannedMaxOutput, plannedHoldNano, backgroundReserve } from "./ee/index.js";
import { useOpenRouter } from "./model.js";
import { BILL_LABELLER, LABEL_MARKUP } from "./label-billing.js";

export const CHAT_TITLE_JOB = "chat_title";
export const CHAT_TITLE_KIND = "chat-title";
export const CHAT_TITLE_INSTRUCTION = "Title this in up to 5 words";
export const CHAT_TITLE_TAIL = "Reply with the title only.";
export const CHAT_TITLE_TEXT_MAX = 4000;   // characters of the first message sent to the model

function words(value) {
  return typeof value === "string" ? value.normalize("NFC").replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D\u20E3]/gu, " ").replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").trim().split(/\s+/u).filter(Boolean) : [];
}
// A model's answer as a chat name: first line, no emojis, markdown marks, surrounding quotes, "Title:" label or final period.
// One to five words and at most 80 characters. A longer answer is cut to its first five words, and a joining word or punctuation
// left at the end by the cut is dropped. An empty answer gives null (the placeholder name stays).
export function cleanChatTitle(value) {
  const line = String(value ?? "").split("</think>").pop().normalize("NFC").replace(/[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D\u20E3]/gu, "")
    .split(/\r?\n/).map((x) => x.trim()).find(Boolean) || "";
  const title = line.replace(/[*`#~]+/g, "").replace(/^[\s>\-"'\u201C\u201D\u2018\u2019\u00AB\u00BB]+/u, "").replace(/^(?:chat )?title\s*:\s*/i, "")
    .replace(/[\s"'\u201C\u201D\u2018\u2019\u00AB\u00BB]*[.\u3002]*[\s"'\u201C\u201D\u2018\u2019\u00AB\u00BB]*$/u, "").replace(/\s+/g, " ").trim();
  const parts = title ? title.split(" ") : [];
  let out = parts.slice(0, 5).join(" ");
  if (parts.length > 5) for (let prev = ""; prev !== out;) { prev = out; out = out.replace(/[\s,:;\u2013\u2014-]+$/u, "").replace(/\s(?:and|or|of|for|the|a|to|in|on|with)$/i, ""); }
  return out && out.length <= 80 ? out : null;
}
// The placeholder name keeps the person's characters as typed (apostrophes, symbols, emojis with their joiners and
// modifiers). Words split on whitespace only, so a word is never cut inside an emoji.
const charCount = (word) => { try { return [...new Intl.Segmenter().segment(word)].length; } catch { return [...word].length; } };
export function fallbackChatTitle(text) {
  const plain = String(text || "").normalize("NFC").replace(/^\s+/, "").replace(/^(?:(?:hey|hi|ok|okay|so)[,!. ]+|(?:can|could|would) you (?:please )?|please )+/i, "");
  const parts = plain.split(/\s+/u).filter((part) => part && charCount(part) <= 30).slice(0, 4);
  while (parts.length && !(parts[parts.length - 1] = parts[parts.length - 1].replace(/[.,;:!?]+$/u, ""))) parts.pop();
  if (!parts.length) return "New chat";
  if (parts.length === 1 && !/\.\p{L}/u.test(parts[0])) parts.push("chat");   // a lone plain word gets "chat"; a file name stays as typed
  while (parts.join(" ").length > 80) parts.pop();
  const title = parts.join(" "), first = String.fromCodePoint(title.codePointAt(0));
  return first.toUpperCase() + title.slice(first.length);
}

// titleText: the words of the person's first message ("" for a file-only message: the placeholder, the file name, stays). Only a chat with words is
// marked pending, and the mark holds that text until startChatTitle claims it.
// memo: the message is only voice memos, so the placeholder is "Voice memo" and the mark waits for the transcript (memoTitleText).
export function newAutoChat(R, text = "", titleText = text, memo = false) {
  memo = memo && !words(titleText).length;
  const id = R.newSession(memo ? "Voice memo" : fallbackChatTitle(text));
  if (memo) R.put(`chat_title_pending:${id}`, JSON.stringify({ memo: true, text: "" }));
  else if (words(titleText).length) R.put(`chat_title_pending:${id}`, JSON.stringify({ text: String(titleText).slice(0, CHAT_TITLE_TEXT_MAX) }));
  return id;
}
// Claim synchronously, before the model call starts. If the object restarts during the call, the placeholder survives
// and later messages never pay again to name the same chat. Returns null for a chat that isn't pending (a mark from before the
// instant title existed holds no text and is dropped).
// A memo mark is claimed only when the transcript text (memoText) is given; before that it stays.
export function claimChatTitle(R, session, memoText = "") {
  const key = `chat_title_pending:${session}`, raw = R.getRaw(key);
  if (!raw) return null;
  let text = "", memo = false; try { const j = JSON.parse(raw); text = typeof j?.text === "string" ? j.text : ""; memo = !!j?.memo; } catch {}
  if (memo && !memoText.trim()) return null;
  R.sql.exec("DELETE FROM kv WHERE k=?", key);
  if (memo) text = memoText.slice(0, CHAT_TITLE_TEXT_MAX);
  if (!text.trim()) return null;
  const row = R.session(session);
  if (!row || row.title_manual || session === R.getRaw("default_session") || R.textsSessions().includes(session)) return null;
  return { id: session, title: row.title, revision: Number(row.title_revision || 0), text };
}
// The words of memo transcripts (transcriptMd: "# Transcript of" and "##" headings, "[m:ss] Speaker 1: " marks), in order.
export const memoTitleText = (mds) => mds.map((md) => String(md || "").split("\n").filter((l) => !l.startsWith("#")).join(" ").replace(/\[\d+(?::\d{2})+\] (?:Speaker \d+: )?/g, "")).join(" ").replace(/\s+/g, " ").trim().slice(0, CHAT_TITLE_TEXT_MAX);
export function applyChatTitle(R, claim, title) {
  const clean = cleanChatTitle(title);
  if (!claim || !clean) return;
  R.sql.exec("UPDATE sessions SET title=?, title_revision=title_revision+1 WHERE id=? AND title_manual=0 AND title_revision=? AND title=? AND title<>?", clean, claim.id, claim.revision, claim.title, clean);
  R.tsTouch?.(claim.id);   // task search follows the new title
}
// What the model is sent: the person's message, then the instruction.
export const chatTitleRequest = (text, maxTokens = undefined) => ({ messages: [{ role: "user", content: `${String(text).slice(0, CHAT_TITLE_TEXT_MAX)}\n\n${CHAT_TITLE_INSTRUCTION}\n${CHAT_TITLE_TAIL}` }], ...(maxTokens ? { max_tokens: maxTokens } : {}) });
const answerOf = (r) => r?.choices?.[0]?.message?.content;
// One call of the chat_title job, billed to the person like the task summaries job. Never throws: any failure leaves the placeholder.
export async function nameChat({ env, ledger = null, meta = {}, claim, bill = BILL_LABELLER, signal } = {}) {
  if (!claim || !useOpenRouter(env)) return null;
  const request = chatTitleRequest(claim.text, await plannedMaxOutput(env, CHAT_TITLE_JOB).catch(() => null) ?? undefined);
  const rid = `title:${crypto.randomUUID()}`, billed = !!(bill && ledger && !(env?.BYOK && !env.BYOK.choresOnPlan));   // own AI key: their model, nothing to bill (Use my services now with no Background jobs: 1Helm's model, billed)
  if (billed) { try { const r = await ledger.reserve(rid, backgroundReserve(request, 1, await plannedHoldNano(env, CHAT_TITLE_JOB).catch(() => 0))); if (!r?.ok) return null; } catch { return null; } }
  let answer = null, charge = 0;
  try {
    const r = await dispatch(env, CHAT_TITLE_JOB, { ...request, stream: false }, { meta: { ...meta, kind: CHAT_TITLE_KIND }, signal });
    if (r instanceof Response && !r.ok) throw new Error(`chat title provider HTTP ${r.status}`);
    const j = r instanceof Response ? await r.json() : r;
    charge = Math.ceil(Math.ceil(Number(j?.usage?.cost || 0) * 1e9) * LABEL_MARKUP);
    answer = answerOf(j);
  } catch (e) { console.log("chat title failed", String(e?.message || e).slice(0, 160)); }
  if (billed) { try { await ledger.settle(rid, charge); } catch (e) { console.log("chat title settle", e.message); } }
  return typeof answer === "string" ? answer : null;
}
// Called when the first message of a new chat is sent, next to starting the turn. Claims the pending mark and starts the model call without
// waiting for it; the turn never waits. The answer replaces the placeholder only while the name is still the one the chat started with.
export function startChatTitle(R, session, memoText = "") {
  const claim = claimChatTitle(R, session, memoText);
  if (!claim) return null;
  let ledger = null; try { ledger = R.ledger(); } catch {}
  const run = nameChat({ env: R.env, ledger, meta: { tenant: R.get("tenant"), channel: R.get("channel") }, claim })
    .then((answer) => { if (answer) applyChatTitle(R, claim, answer); })
    .catch((e) => console.log("chat title", String(e?.message || e).slice(0, 160)));
  R.ctx?.waitUntil?.(run);
  return run;
}
