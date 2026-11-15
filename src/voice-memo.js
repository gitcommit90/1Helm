// Voice memos: the composer's mic button, held down, records a memo and attaches it as "Voice memo N.wav" (web/src/voicememo.ts).
// Two small pieces live here.
//  1. The account choice "Send voice memos on": "release" (the message is sent as soon as the memo is uploaded) or "manually" (the memo
//     stays in the composer). Kept per account in D1 tenant_flags k='voice_memo_send' (no migration). No row = never chosen (the app asks once).
//  2. How the model reads memos: they are the person's spoken message, in order Voice memo 1, 2, ... (attachParts, attachmentNote, sidecarParts).
export const FLAG = "voice_memo_send";
export const CHOICES = ["release", "manually"];
export const MEMO_NAME = /^Voice memo (\d{1,4})(?: \(\d+\))?\.(?:wav|m4a|mp3|webm|ogg|mp4)$/i;

export const voiceMemoNum = (name) => { const m = MEMO_NAME.exec(String(name || "")); return m ? Number(m[1]) : null; };
export const isVoiceMemo = (f) => voiceMemoNum(f?.name) !== null;

// The files in the order the model reads them: the voice memos sorted by their number, placed in the slots the memos held, so every other
// file keeps its place. Files without memos come back unchanged.
export function orderVoiceMemos(files) {
  const list = Array.isArray(files) ? files : [];
  const memos = list.filter(isVoiceMemo); if (memos.length < 2) return list.slice();
  const sorted = memos.map((f, i) => ({ f, i })).sort((a, b) => voiceMemoNum(a.f.name) - voiceMemoNum(b.f.name) || a.i - b.i).map((x) => x.f);
  let k = 0; return list.map((f) => (isVoiceMemo(f) ? sorted[k++] : f));
}

// The sentence the attachment note adds when voice memos are attached ("" when there are none).
export function voiceMemoNote(files) {
  const memos = orderVoiceMemos(files).filter(isVoiceMemo); if (!memos.length) return "";
  const names = memos.map((f) => `"${f.name}"`).join(", ");
  return ` ${memos.length === 1 ? `"${memos[0].name}" is a voice memo: it is the person's spoken message, so read its transcript as what they said to you.` : `${names} are voice memos: together they are the person's spoken message, given in that order, so read their transcripts one after the other as one message.`}`;
}

export async function voiceMemoChoice(env, tenantId) {
  try { const v = (await env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k=?").bind(String(tenantId), FLAG).first())?.v; return CHOICES.includes(v) ? v : null; } catch { return null; }
}
export async function setVoiceMemoChoice(env, tenantId, choice, at = Date.now()) {
  if (!CHOICES.includes(choice)) throw new Error("bad choice");
  await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id,k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at").bind(String(tenantId), FLAG, choice, at).run();
  return choice;
}
