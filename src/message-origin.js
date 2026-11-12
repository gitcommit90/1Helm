import { replyIn } from "./reply-to.js";

// Origin describes where a person supplied a message, separately from where
// Primary's answer will be delivered. Never consult today's phone settings.
const SURFACES = new Set(["app", "phone", "hosted_card", "interview"]);
const SERVICES = new Set(["imessage", "sms", "rcs"]);
const KINDS = new Set(["text", "voice", "poll_vote"]);
export function messageOrigin(value) {
  if (!value || !SURFACES.has(value.surface)) return null;
  return { surface: value.surface, ...(value.surface === "phone" && SERVICES.has(value.service) ? { service: value.service } : {}), ...(KINDS.has(value.kind) ? { kind: value.kind } : {}) };
}
export function phoneOrigin(service, kind = "text") {
  return messageOrigin({ surface: "phone", service: String(service || "").toLowerCase(), kind });
}
export function originLabel(value) {
  const o = messageOrigin(value);
  if (!o) return "Message origin unknown";
  if (o.surface === "app") return "1Helm app message";
  if (o.surface === "hosted_card") return "Hosted card response";
  if (o.surface === "interview") return "Interview response";
  const service = { imessage: "iMessage", sms: "SMS", rcs: "RCS" }[o.service];
  return `${o.kind === "voice" ? "Phone voice message" : o.kind === "poll_vote" ? "Native phone poll vote" : o.kind === "text" ? "Phone text message" : "Phone message"}${service ? ` via ${service}` : " (service unknown)"}`;
}
const parse = value => { try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return null; } };
// Existing msg-event input JSON holds metadata alongside the unchanged text.
export function originInput(input = {}) {
  const origin = messageOrigin(input.origin) || (input.via === "app" ? { surface: "app" } : input.photonMsg ? phoneOrigin() : null);
  const messages = Array.isArray(input.origin_messages) ? input.origin_messages.map(m => ({ text: String(m.text ?? ""), at: Number(m.at) || null, origin: messageOrigin(m.origin) })).filter(m => m.text.trim()) : null;
  const files = Array.isArray(input.origin_files) ? input.origin_files.map(f => ({ id: String(f.id || ""), origin: messageOrigin(f.origin) })).filter(f => f.id && f.origin) : null;
  return { ...(origin ? { origin } : {}), ...(messages?.length ? { origin_messages: messages } : {}), ...(files?.length ? { origin_files: files } : {}) };
}
// Interpret only unambiguous ISO dates or epoch milliseconds. Other provider
// timestamp formats remain unknown instead of guessing seconds versus millis.
export function messageTime(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1e12 && value <= 8640000000000000) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const at = Date.parse(value); return Number.isFinite(at) ? at : null;
}
function savedOrigin(sql, turn, event, data) {
  const explicit = messageOrigin(data.origin);
  if (explicit) return explicit;
  if (data.photonMsg) return phoneOrigin();
  if (Number(event.seq) === 1) {
    const receipt = sql.exec("SELECT response_id,opts_json FROM user_input_receipts WHERE turn=? ORDER BY created LIMIT 1", String(turn)).toArray()[0];
    if (receipt) {
      const o = parse(receipt.opts_json) || {}, known = messageOrigin(o.origin);
      if (known) return known;
      if (o.photonMsg || /^(?:text|poll):/.test(receipt.response_id)) return phoneOrigin(null, receipt.response_id.startsWith("poll:") ? "poll_vote" : "text");
      if (receipt.response_id.startsWith("card:")) return { surface: "hosted_card" };
      if (receipt.response_id.startsWith("interview:")) return { surface: "interview" };
      // viaText in an answer receipt controls delivery, not input origin.
      return event.via === "app" ? { surface: "app" } : null;
    }
  }
  // Older hosted cards and interviews also used textTurn without a receipt.
  // via=text alone therefore cannot prove that the person typed a phone text.
  return event.via === "app" ? { surface: "app" } : null;
}

// Live retains and source rewrites use the same persisted person-message rows.
// A handoff is app/worker data, never a line spoken by the person.
export function conversationMessages(sql, turn, { text = "", at, kind = "chat" } = {}) {
  let card, events = [];
  try {
    card = sql.exec("SELECT kind,hidden FROM cards WHERE id=?", String(turn)).toArray()[0];
    events = sql.exec("SELECT seq,type,text,at,via,input,reply FROM card_events WHERE card=? AND type IN ('msg','handoff') ORDER BY seq", String(turn)).toArray();
  } catch {}
  if (kind === "helper" || card?.kind === "helper") return [];
  if (events.length) return events.filter(e => e.type === "msg").flatMap(e => {
    const data = parse(e.input) || {};
    const origin = savedOrigin(sql, turn, e, data);
    const messages = originInput(data).origin_messages;
    const reference = replyIn(e.reply) || data.reply || (data.photon_target?.preview ? { text: data.photon_target.preview, role: null, id: data.photon_target.id } : null);
    return messages?.length ? messages.map(m => ({ ...m, at: m.at || Number(e.at), origin: m.origin || origin, reply: reference })) : [{ text: String(e.text || ""), at: Number(e.at), origin, reply: reference }];
  });
  return card?.kind === "handoff" ? [] : [{ text: String(text || ""), at, origin: null }];
}

// File sidecars use the original attachment event, including a voice recording.
// The content may contain other speakers, so origin never changes authorship.
export function fileMessageOrigin(sql, file) {
  if (!file?.turn || file.source !== "upload") return null;
  try {
    for (const e of sql.exec("SELECT seq,files,input,via FROM card_events WHERE card=? AND type='msg' ORDER BY seq", String(file.turn)).toArray()) {
      if (!(parse(e.files) || []).includes(String(file.id))) continue;
      const data = parse(e.input) || {};
      return messageOrigin(data.origin_files?.find(f => f.id === String(file.id))?.origin) || savedOrigin(sql, file.turn, e, data);
    }
  } catch {}
  return null;
}
