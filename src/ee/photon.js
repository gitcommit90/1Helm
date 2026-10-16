// Per-person texting through each person's OWN free Photon project (BYOP). Runs inside the Worker: no Node sidecar.
// Outbound = gRPC-web over fetch to Photon's shared iMessage proxy (hand-encoded protobuf; the SDK needs Node gRPC).
// Inbound = Photon's signed webhook (HMAC-SHA256 of "v0:<ts>:<raw body>").
// Live-tested 10-01 on a free project: text, typing, polls, app cards, vCard contact, edits, effects all deliver.
// Free/Pro rules learned live: only registered phones can be messaged; the person must text first; until they've sent
// 3 texts we may send at most 10 ("New contact has sent 1 of 3 messages; replies are limited to 10…").
const DASH = "https://app.photon.codes", SPEC = "https://spectrum.photon.codes", IMSG = "https://imessage.spectrum.photon.codes";
const CLIENT_ID = "photon-cli";
const te = new TextEncoder(), td = new TextDecoder();
export const E164 = /^\+[1-9]\d{7,14}$/;

// ---- US numbers only (Captain 10-06: "No international texting") ----
// A valid NANP number (+1, area code and exchange start 2-9, no N11 area code) whose area code is in the US or a US territory.
// +1 also covers Canada and the Caribbean; those area codes are listed here and turned away like any other country.
export const US_ONLY = "Texting is available for US phone numbers only right now.";
export const BAD_PHONE = "That doesn't look like a US cell number. Try it with the area code, like (213) 555-0123.";
const NON_US_NANP = new Set(("204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 403 416 418 428 431 437 438 450 468 474 506 514 519 " +
  "548 579 581 584 587 600 604 613 622 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905 942 " +   // Canada
  "242 246 264 268 284 345 441 473 649 658 664 721 758 767 784 809 829 849 868 869 876").split(" "));                    // Caribbean, Bermuda
const NANP = /^([2-9][0-8]\d)([2-9]\d{2})\d{4}$/;
// → { phone: "+1XXXXXXXXXX" } | { error } (error is US_ONLY for another country, BAD_PHONE for anything that isn't a phone number).
export function checkPhone(raw) {
  const s = String(raw || "").trim().replace(/[\s().\-\u00a0]/g, "");
  if (!s) return { error: BAD_PHONE };
  if (!/^\+?\d+$/.test(s)) return { error: BAD_PHONE };
  let d;
  if (s.startsWith("+")) { if (!s.startsWith("+1")) return { error: US_ONLY }; d = s.slice(2); if (d.length !== 10) return { error: d.length > 10 ? US_ONLY : BAD_PHONE }; }
  else if (/^(00|011)/.test(s)) return { error: US_ONLY };                  // dialled with an international prefix
  else if (s.length === 11 && s[0] === "1") d = s.slice(1);
  else if (s.length === 10) d = s;
  else return { error: s.length > 11 ? US_ONLY : BAD_PHONE };
  const m = d.match(NANP);
  if (!m || m[1].endsWith("11") || m[2].endsWith("11")) return { error: BAD_PHONE };
  if (NON_US_NANP.has(m[1])) return { error: US_ONLY };
  return { phone: `+1${d}` };
}
export const normPhone = (raw) => checkPhone(raw).phone || "";
export const isUSPhone = (e164) => !!e164 && checkPhone(e164).phone === e164;

// ---- tiny protobuf writer (only what we send) ----
const varint = (n) => { const o = []; n = Number(n); while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
const key = (f, w) => varint((f << 3) | w);
const pbStr = (f, s) => { const b = te.encode(String(s)); return [...key(f, 2), ...varint(b.length), ...b]; };
const pbBytes = (f, b) => [...key(f, 2), ...varint(b.length), ...b];
const pbMsg = (f, arr) => [...key(f, 2), ...varint(arr.length), ...arr];
const pbBool = (f, v) => [...key(f, 0), v ? 1 : 0];
const frame = (arr) => { const u = new Uint8Array(5 + arr.length); new DataView(u.buffer).setUint32(1, arr.length); u.set(arr, 5); return u; };
// Pull every printable string field out of a response (ids like spc-msg-… and attachment guids).
function strings(buf) { return (td.decode(buf).match(/[\x20-\x7e]{6,}/g) || []); }

async function basicAuth(id, secret) { return "Basic " + btoa(`${id}:${secret}`); }

async function jfetch(url, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000), headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  return { r, body };
}

// ---- guided sign-up: Photon's device login (the same flow Photon's CLI uses) ----
export async function deviceStart() {
  const { r, body } = await jfetch(`${DASH}/api/auth/device/code`, { method: "POST", body: JSON.stringify({ client_id: CLIENT_ID, scope: "openid profile email" }) });
  if (!r.ok || !body.device_code) throw new Error(`Photon sign-in could not start (HTTP ${r.status}).`);
  return { device_code: body.device_code, user_code: body.user_code, url: body.verification_uri_complete || `${body.verification_uri}?user_code=${body.user_code}`, interval: Number(body.interval || 5), expires_at: Date.now() + 1000 * Number(body.expires_in || 1800) };
}
// One poll. Returns { pending } | { token } | { error }.
export async function devicePoll(device_code) {
  const { r, body } = await jfetch(`${DASH}/api/auth/device/token`, { method: "POST", body: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code, client_id: CLIENT_ID }) });
  if (r.status === 429) return { pending: true };
  if (r.status === 400) { const e = String(body.error || ""); if (e === "authorization_pending" || e === "slow_down") return { pending: true }; return { error: e || "rejected" }; }
  if (!r.ok) return { pending: true };
  const tok = String(body.access_token || body.data?.access_token || r.headers.get("set-auth-token") || "").replace(/^Bearer\s+/i, "");
  return tok ? { token: tok } : { error: "no token" };
}

const listOf = (b, k) => Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : Array.isArray(b?.data?.[k]) ? b.data[k] : Array.isArray(b?.[k]) ? b[k] : [];

// With a dashboard token: find-or-create the "1Helm" project and mint a fresh project secret.
export async function provisionProject(token, name = "1Helm") {
  const H = { authorization: `Bearer ${token}` };
  const listed = await jfetch(`${DASH}/api/projects`, { headers: H });
  if (!listed.r.ok) throw new Error(`Photon projects could not be read (HTTP ${listed.r.status}).`);
  let id = listOf(listed.body, "projects").find((p) => String(p.name || "").toLowerCase() === name.toLowerCase())?.id;
  if (!id) {
    const c = await jfetch(`${DASH}/api/projects`, { method: "POST", headers: H, body: JSON.stringify({ name, location: "United States", template: false, observability: false }) });
    id = c.body?.id || c.body?.data?.id; if (!c.r.ok || !id) throw new Error(`Photon project creation failed (HTTP ${c.r.status}).`);
  }
  const s = await jfetch(`${DASH}/api/projects/${encodeURIComponent(id)}/regenerate-secret`, { method: "POST", headers: H, body: "{}" });
  const secret = s.body?.projectSecret || s.body?.data?.projectSecret;
  if (!s.r.ok || !secret) throw new Error("Photon did not return the project secret.");
  return { project_id: String(id), project_secret: String(secret) };
}

// ---- project-credential calls ----
export async function registerPhone(pid, sec, phone) {
  if (!isUSPhone(phone)) throw new Error(US_ONLY);
  const A = { authorization: await basicAuth(pid, sec) };
  const list = await jfetch(`${SPEC}/projects/${pid}/users/`, { headers: A });
  if (list.r.status === 401) throw new Error("Photon rejected the project keys.");
  const have = listOf(list.body, "users").find((u) => u.phoneNumber === phone);
  if (have) return { user_id: have.id, assigned: have.assignedPhoneNumber };
  const c = await jfetch(`${SPEC}/projects/${pid}/users/`, { method: "POST", headers: A, body: JSON.stringify({ type: "shared", phoneNumber: phone }) });
  const u = c.body?.data || c.body;
  if (!c.r.ok || !u?.assignedPhoneNumber) throw new Error(c.body?.message ? `Photon: ${String(c.body.message).slice(0, 200)}` : `Photon could not add that number (HTTP ${c.r.status}).`);
  return { user_id: u.id, assigned: u.assignedPhoneNumber };
}
export async function registerWebhook(pid, sec, url) {
  const A = { authorization: await basicAuth(pid, sec) };
  const ls = await jfetch(`${SPEC}/projects/${pid}/webhooks/`, { headers: A });
  for (const w of listOf(ls.body, "webhooks")) if (w.webhookUrl === url && w.id) await fetch(`${SPEC}/projects/${pid}/webhooks/${w.id}`, { method: "DELETE", headers: A });
  const c = await jfetch(`${SPEC}/projects/${pid}/webhooks/`, { method: "POST", headers: A, body: JSON.stringify({ webhookUrl: url }) });
  const d = c.body?.data || c.body;
  if (!c.r.ok || !d?.signingSecret) throw new Error(`Photon webhook registration failed (HTTP ${c.r.status}).`);
  return { webhook_id: d.id, signing_secret: d.signingSecret };
}

// Short-lived (15 min) bearer for the iMessage proxy; cached per project in the caller's storage.
export async function imsgToken(pid, sec, cache) {
  const c = cache?.get?.(); if (c && c.exp > Date.now() + 60e3) return c.token;
  const { r, body } = await jfetch(`${SPEC}/projects/${pid}/imessage/tokens`, { method: "POST", headers: { authorization: await basicAuth(pid, sec) } });
  const tok = body?.data?.token; if (!r.ok || !tok) throw new Error(`Photon texting token failed (HTTP ${r.status}).`);
  cache?.set?.({ token: tok, exp: Date.now() + 1000 * Number(body.data.expiresIn || 900) });
  return tok;
}

class PhotonSendError extends Error { constructor(m, code) { super(m); this.code = code; } }
async function rpc(token, service, method, arr, { timeoutMs = 20000, idempotencyKey = crypto.randomUUID(), maxResponseBytes = null } = {}) {
  const r = await fetch(`${IMSG}/photon.imessage.v1.${service}/${method}`, { method: "POST", signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/grpc-web+proto", "x-grpc-web": "1", "x-idempotency-key": idempotencyKey }, body: frame(arr) });
  let buf;
  if (maxResponseBytes) {
    const reader = r.body?.getReader(), chunks = []; let size = 0;
    if (!reader) throw new Error("Photon returned no response body.");
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maxResponseBytes) throw new Error("Photon metadata response exceeded its limit."); chunks.push(part.value); } }
    catch (e) { await reader.cancel().catch(() => {}); throw e; }
    buf = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.byteLength; }
  } else buf = new Uint8Array(await r.arrayBuffer());
  let status = r.headers.get("grpc-status"), msg = decodeURIComponent(r.headers.get("grpc-message") || "");
  // grpc-web trailers may arrive in-body (flag 0x80) instead of headers.
  if (status == null) { const m = td.decode(buf).match(/grpc-status:\s*(\d+)[\s\S]*?(?:grpc-message:\s*([^\r\n]*))?/i); if (m) { status = m[1]; msg = decodeURIComponent(m[2] || ""); } }
  if (r.status !== 200 || (status && status !== "0")) throw new PhotonSendError(msg || `Photon HTTP ${r.status}`, status || String(r.status));
  return buf;
}
const chatGuid = (phone) => `any;-;${phone}`;
const msgId = (buf) => strings(buf).find((s) => /^spc-msg-[0-9a-f-]{36}$/.test(s)) || strings(buf).map((s) => s.match(/spc-msg-[0-9a-f-]{36}/)?.[0]).find(Boolean) || null;

export async function sendText(token, phone, text, { effect, clientMessageId, replyTo } = {}) {
  const target = replyTo ? tapbackTarget(replyTo) : null;
  const arr = [...pbStr(1, chatGuid(phone)), ...pbStr(2, String(text).slice(0, 8000)), ...(target ? pbMsg(3,[...pbStr(1,target.guid),...(target.partIndex!=null?[...key(2,0),...varint(target.partIndex)]:[])]) : []), ...(effect ? pbStr(5, effect) : []), ...(/^https?:\/\/\S+$/.test(String(text).trim()) ? pbBool(7, true) : []), ...(clientMessageId ? pbStr(100,clientMessageId) : [])];
  return msgId(await rpc(token, "MessageService", "SendTextMessage", arr, clientMessageId ? {idempotencyKey:clientMessageId} : {}));
}
export async function setTyping(token, phone, on = true) { await rpc(token, "ChatService", "SetTyping", [...pbStr(1, chatGuid(phone)), ...pbBool(2, on)]).catch(() => {}); }

// @photon-ai/advanced-imessage 2.3.0 poll_service.proto and poll_types.proto.
// The server supplies opaque option identifiers; labels never identify votes.
export function pollRequest(phone, question, choices, clientMessageId) {
  return [...pbStr(1, chatGuid(phone)), ...pbStr(2, question), ...choices.flatMap(s => pbStr(3, s)), ...pbStr(100, clientMessageId)];
}
export function pollResponse(b) {
  const poll = { pollMessageGuid: "", chatGuid: "", title: "", options: [] };
  pbWalk(b, (f, w, span) => {
    if (f !== 1 || w !== 2) return;
    pbWalk(b, (n, wire, value) => {
      if (wire !== 2) return;
      if ([1, 2, 3].includes(n)) poll[{1:"pollMessageGuid",2:"chatGuid",3:"title"}[n]] = td.decode(b.subarray(...value));
      if (n === 4) {
        const option = {};
        pbWalk(b, (k, kind, v) => { if (kind === 2 && [1,2].includes(k)) option[k === 1 ? "text" : "optionIdentifier"] = td.decode(b.subarray(...v)); }, ...value);
        poll.options.push(option);
      }
    }, ...span);
  });
  return poll;
}
export async function createPoll(token, phone, question, choices, { clientMessageId } = {}) {
  if (!clientMessageId || !String(question).trim() || !Array.isArray(choices) || choices.length < 2 || choices.some(s => !String(s).trim())) throw new PhotonSendError("A poll needs a title, at least two choices and a saved send identity.", "poll");
  const poll = pollResponse(dataFrame(await rpc(token, "PollService", "CreatePoll", pollRequest(phone, question, choices, clientMessageId), { idempotencyKey: clientMessageId })));
  const chat = poll.chatGuid.split(";"), ownChat = chat.length === 3 && chat[1] === "-" && chat[2] === phone && ["any","imessage"].includes(chat[0].toLowerCase());
  if (!poll.pollMessageGuid || !ownChat || poll.options.length !== choices.length || poll.options.some(o => !o.optionIdentifier || !o.text) || new Set(poll.options.map(o => o.optionIdentifier)).size !== poll.options.length) throw new PhotonSendError("Photon returned an incomplete poll identity. Retry with the same saved send identity.", "poll_identity");
  return poll;
}

// ---- iMessage app cards (mini apps) ----
// spectrum-ts's universal `app(url, { live })` renders through Spectrum's own Messages extension ("Spectrum - Message Apps",
// a one-time install in Messages for the live view). Same fixed identity as spectrum-ts 12.10.1 (src/remote/app.ts).
export const SPECTRUM_APP = { appName: "Spectrum", extensionBundleId: "codes.photon.Spectrum.MessagesExtension", teamId: "P8XT6232SL", appStoreId: 6777616651 };
// MiniAppLayout, fields in the SDK encoder's order (caption=5, subcaption=3, trailingCaption=6, trailingSubcaption=7, imageTitle=1,
// imageSubtitle=2, summary=8; no image: we never send one).
function miniAppLayout(l = {}) {
  const f = [["caption", 5], ["subcaption", 3], ["trailingCaption", 6], ["trailingSubcaption", 7], ["imageTitle", 1], ["imageSubtitle", 2], ["summary", 8]];
  return f.flatMap(([k, n]) => l[k] != null && l[k] !== "" ? pbStr(n, l[k]) : []);
}
// SendCustomizedMiniAppMessageRequest (photon.imessage.v1.MessageService), byte-identical to advanced-imessage's encoder for what
// spectrum-ts sends for app(url, { live }): chatGuid=1, teamId=2, extensionBundleId=3, appName=4, url=5, layout=6, appStoreId=7
// (int64), live=8 (always written: the client sends `live ?? false`). test/photon-app.test.mjs checks it against the SDK.
export function appRequest(phone, { url, layout, live = false, app = SPECTRUM_APP }) {
  return [...pbStr(1, chatGuid(phone)), ...pbStr(2, app.teamId), ...pbStr(3, app.extensionBundleId), ...pbStr(4, app.appName), ...pbStr(5, url),
    ...(layout ? pbMsg(6, miniAppLayout(layout)) : []), ...(app.appStoreId != null ? [...key(7, 0), ...varint(app.appStoreId)] : []), ...pbBool(8, !!live)];
}
// Send a tappable app card. live: true opens the page itself inside Messages (after the one-time Spectrum install).
// layout: { caption, subcaption, summary, trailingCaption, trailingSubcaption }; at least one of the captions.
export async function sendApp(token, phone, url, { layout, live = true } = {}) {
  if (!/^https?:\/\//.test(String(url))) throw new PhotonSendError("app card needs an absolute http(s) url", "url");
  return msgId(await rpc(token, "MessageService", "SendCustomizedMiniAppMessage", appRequest(phone, { url, layout, live })));
}

// ---- tapbacks: MessageService/SetReaction ----
// SetReactionRequest, byte-identical to advanced-imessage 2.2.0's encoder for what spectrum-ts 12.10.1 sends for
// message.react("👍") (the call the Captain's 10-01 phone test used): target=1 MessageTarget { chatGuid=1, messageGuid=2,
// targetPartIndex=3 (int32, only for an album item) }, reaction=2 MessageReaction { kind=1 (int32 enum, love=0 so omitted),
// emoji=2 (only for kind "emoji") }, isSet=3 (bool, omitted when false = remove). test/photon-react.test.mjs checks it against the SDK.
// A new tapback on the same message replaces the old one in Messages, exactly like a person changing theirs.
export const TAPBACKS = ["love", "like", "dislike", "laugh", "emphasize", "question"];
export function reactionRequest(phone, messageGuid, kind, { partIndex, set = true } = {}) {
  const k = TAPBACKS.indexOf(kind); if (k < 0) throw new PhotonSendError(`unknown tapback ${kind}`, "kind");
  const target = [...pbStr(1, chatGuid(phone)), ...pbStr(2, messageGuid), ...(partIndex != null ? [...key(3, 0), ...varint(partIndex)] : [])];
  return [...pbMsg(1, target), ...pbMsg(2, k ? [...key(1, 0), ...varint(k)] : []), ...(set ? pbBool(3, true) : [])];
}
// Webhook ids: a plain message is spc-msg-<uuid>; an album item is p:<n>/spc-msg-<uuid> (= the parent message, part n).
export function tapbackTarget(id) {
  const m = String(id || "").match(/^p:(\d+)\/(.+)$/);
  return m ? { guid: m[2], partIndex: Number(m[1]) } : { guid: String(id || ""), partIndex: undefined };
}
// Put a tapback (love | like | dislike | laugh | emphasize | question) on one of the person's messages (its webhook message.id).
export async function sendReaction(token, phone, messageId, kind) {
  const { guid, partIndex } = tapbackTarget(messageId);
  if (!guid) throw new PhotonSendError("tapback needs the message id", "target");
  return msgId(await rpc(token, "MessageService", "SetReaction", reactionRequest(phone, guid, kind, { partIndex })));
}

// A plain vCard contact card (nativeContactCard shows nothing on a free project: its profile is empty).
export function vcard({ name, phone, org = "1Helm", url }) {
  const n = String(name || "Helper").replace(/[\r\n;,]/g, " ");
  return ["BEGIN:VCARD", "VERSION:3.0", `N:;${n};;;`, `FN:${n}`, `ORG:${org}`, `TEL;TYPE=CELL:${phone}`, ...(url ? [`URL:${url}`] : []), `NOTE:Your 1Helm helper. Text anytime.`, "END:VCARD", ""].join("\r\n");
}
export async function sendContact(token, phone, card, fileName = "helper.vcf") {
  const up = await rpc(token, "AttachmentService", "UploadAttachment", [...pbStr(1, fileName), ...pbBytes(2, [...te.encode(card)])]);
  const guid = strings(up).map((s) => s.match(/spc-att-[0-9a-f-]{36}/)?.[0]).find(Boolean);
  if (!guid) throw new PhotonSendError("upload returned no attachment id", "upload");
  return msgId(await rpc(token, "MessageService", "SendAttachmentMessage", [...pbStr(1, chatGuid(phone)), ...pbMsg(2, [...pbStr(2, guid), ...pbStr(3, fileName)])]));
}

// advanced-imessage 2.3.0 attachment_service.proto and message_service.proto.
// Upload once, save the returned GUID, then retry sends with the same client ID.
export async function uploadFile(token, name, data) {
  if (!(data instanceof Uint8Array) || data.byteLength > 5 * 1024 * 1024) throw new PhotonSendError("Phone attachment exceeds the 5 MB limit.", "attachment_size");
  const filename = String(name || "attachment").replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 200);
  // Avoid spreading megabytes into function arguments or intermediate JS arrays.
  const header = new Uint8Array([...pbStr(1, filename), ...key(2, 2), ...varint(data.byteLength)]);
  const request = new Uint8Array(header.length + data.length); request.set(header); request.set(data, header.length);
  const response = await rpc(token, "AttachmentService", "UploadAttachment", request);
  const guid = strings(response).map(s => s.match(/spc-att-[0-9a-f-]{36}/)?.[0]).find(Boolean);
  if (!guid) throw new PhotonSendError("Upload returned no attachment identity.", "upload_identity");
  return guid;
}
export async function sendFile(token, phone, { guid, name, clientMessageId, replyTo }) {
  if (!guid || !clientMessageId) throw new PhotonSendError("A phone file needs saved upload and send identities.", "attachment_identity");
  const target = replyTo ? tapbackTarget(replyTo) : null;
  const request = [...pbStr(1, chatGuid(phone)), ...pbMsg(2, [...pbStr(2, guid), ...pbStr(3, name)]),
    ...(target ? pbMsg(3, [...pbStr(1, target.guid), ...(target.partIndex != null ? [...key(2, 0), ...varint(target.partIndex)] : [])]) : []), ...pbStr(100, clientMessageId)];
  return msgId(await rpc(token, "MessageService", "SendAttachmentMessage", request, { idempotencyKey: clientMessageId }));
}

// ---- inbound attachments: AttachmentService/DownloadAttachment (server-streaming) ----
// The webhook only names a file (id = the iMessage attachment GUID, name, mimeType, size); the bytes come from here.
// Request: DownloadAttachmentRequest { attachment_guid = 1 } (test/photon-download.test.mjs checks it against the SDK's encoder).
// Response: gRPC-web data frames, each a DownloadAttachmentResponse { header = 1 (DownloadHeader { attachment = 1 AttachmentInfo,
// companion = 2 }), primary_chunk = 2 bytes, companion_chunk = 3 bytes }, then a trailer frame (flag 0x80) with grpc-status.
// AttachmentInfo: guid=1, original_guid=2, file_name=3, mime_type=4, uti=5, total_bytes=6, is_outgoing=7, transfer_state=8, ...
// A Live Photo's MOV companion is skipped: only the primary file (the photo) is kept.
export const downloadRequest = (guid) => pbStr(1, guid);
function readVarint(b, p) { let v = 0, m = 1, c; do { if (p >= b.length) throw new Error("truncated varint"); c = b[p++]; v += (c & 127) * m; m *= 128; } while (c & 128); return [v, p]; }
// Walk one protobuf message: calls on(field, wire, value | [start, end]) for each field (length-delimited fields as offsets).
function pbWalk(b, on, s = 0, e = b.length) {
  let p = s;
  while (p < e) {
    let k; [k, p] = readVarint(b, p); const f = k >>> 3, w = k & 7;
    if (w === 0) { let v; [v, p] = readVarint(b, p); on(f, w, v); }
    else if (w === 2) { let n; [n, p] = readVarint(b, p); if (p + n > e) throw new Error("truncated field"); on(f, w, [p, p + n]); p += n; }
    else if (w === 1) p += 8; else if (w === 5) p += 4; else throw new Error(`bad wire type ${w}`);
  }
}
export function attachmentInfo(b, s = 0, e = b.length) {
  const o = {};
  pbWalk(b, (f, w, v) => {
    if (w === 2 && [1, 3, 4, 5].includes(f)) o[{ 1: "guid", 3: "fileName", 4: "mimeType", 5: "uti" }[f]] = td.decode(b.subarray(v[0], v[1]));
    else if (w === 0 && f === 6) o.totalBytes = v; else if (w === 0 && f === 8) o.transferState = v;
  }, s, e);
  return o;
}
// bytes: the file's size when Photon said it; partial: true when we only know it passed max while reading.
export class AttachmentTooBig extends Error { constructor(bytes, max, partial = false) { super(`attachment is ${partial ? "over " : ""}${bytes} bytes (max ${max})`); this.code = "too_big"; this.bytes = bytes; this.max = max; this.partial = partial; } }
// → { bytes: Uint8Array, mimeType, filename, size }. Aborts (AttachmentTooBig) as soon as the file is known to pass maxBytes.
export async function downloadAttachment(token, guid, { maxBytes = 50 * 1024 * 1024, timeoutMs = 120000 } = {}) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(new Error("download timed out")), timeoutMs);
  try {
    const r = await fetch(`${IMSG}/photon.imessage.v1.AttachmentService/DownloadAttachment`, { method: "POST", signal: ac.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/grpc-web+proto", "x-grpc-web": "1" }, body: frame(downloadRequest(guid)) });
    const hs = r.headers.get("grpc-status");
    if (r.status !== 200 || (hs && hs !== "0")) { await r.body?.cancel().catch(() => {}); throw new PhotonSendError(decodeURIComponent(r.headers.get("grpc-message") || "") || `Photon HTTP ${r.status}`, hs || String(r.status)); }
    let info = {}, out = null, n = 0, pend = new Uint8Array(0), status = null, msg = "", sawCompanion = false;
    const put = (b, s, e) => {
      const len = e - s;
      if (n + len > maxBytes) throw new AttachmentTooBig(n + len, maxBytes, true);
      if (!out || n + len > out.length) { const g = new Uint8Array(Math.min(maxBytes, Math.max(n + len, (out?.length || 0) * 2, 1 << 16))); if (out) g.set(out.subarray(0, n)); out = g; }
      out.set(b.subarray(s, e), n); n += len;
    };
    const onFrame = (flag, b) => {
      if (flag & 0x80) { const t = td.decode(b); status = t.match(/grpc-status:\s*(\d+)/i)?.[1] ?? status; msg = decodeURIComponent(t.match(/grpc-message:\s*([^\r\n]*)/i)?.[1] || ""); return; }
      pbWalk(b, (f, w, v) => {
        if (w !== 2) return;
        if (f === 1) pbWalk(b, (hf, hw, hv) => {
          if (hf === 1 && hw === 2) {
            info = attachmentInfo(b, hv[0], hv[1]);
            if (info.totalBytes > maxBytes) throw new AttachmentTooBig(info.totalBytes, maxBytes);
            if (info.totalBytes > 0 && !out) out = new Uint8Array(info.totalBytes);   // one buffer, filled in place
          }
        }, v[0], v[1]);
        else if (f === 2) put(b, v[0], v[1]);
        else if (f === 3) sawCompanion = true;
      });
    };
    const rd = r.body.getReader();
    try {
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        let buf = pend.length ? (() => { const c = new Uint8Array(pend.length + value.length); c.set(pend); c.set(value, pend.length); return c; })() : value, p = 0;
        while (buf.length - p >= 5) {
          const len = new DataView(buf.buffer, buf.byteOffset + p + 1, 4).getUint32(0);
          if (buf.length - p - 5 < len) break;
          onFrame(buf[p], buf.subarray(p + 5, p + 5 + len)); p += 5 + len;
        }
        pend = buf.slice(p);
        if (sawCompanion && n > 0) break;            // the photo is complete; don't pull the Live Photo video
      }
    } finally { rd.cancel().catch(() => {}); }
    if (status && status !== "0") throw new PhotonSendError(msg || `grpc-status ${status}`, status);
    if (!n && !(info.totalBytes === 0 && info.guid)) throw new PhotonSendError("download returned no bytes", "empty");
    const bytes = out ? (out.length === n ? out : out.subarray(0, n)) : new Uint8Array(0);
    return { bytes, size: n, guid: info.guid || "", uti: info.uti || "", mimeType: info.mimeType || "", filename: info.fileName || "", transferState: info.transferState };
  } finally { clearTimeout(timer); }
}

// "replies are limited to 10 until they respond" / "Target not allowed" right after setup = slow down, not a wrong number.
export const isNewContactLimit = (e) => /New contact has sent|replies are limited|Target not allowed/i.test(String(e?.message || e));

// ---- inbound webhook signature ----
export async function verifyWebhook(secret, ts, sig, raw) {
  if (!secret || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const k = await crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, te.encode(`v0:${ts}:${raw}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const want = `v0=${mac}`; if (want.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i); return d === 0;
}

// Six digits, never starting with 0 (so it can't lose a digit in autocorrect).
export const newCode = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

// Debug: printable strings from the last few messages in the person's chat (to see if their text reached Photon).
export async function recentInChat(token, phone) {
  const buf = await rpc(token, "MessageService", "ListChatMessages", [...pbStr(1, chatGuid(phone)), ...key(2, 0), ...varint(8)]);
  return strings(buf).filter((s) => !/^spc-|^any;|^\+1\d{10}$/.test(s)).slice(0, 40);
}

// Official advanced-imessage 2.3.0: GetMessageRequest.message_guid=2,
// response.message=1. Decode only identity and attachment metadata, never text.
export async function inspectMessageAttachments(token, phone, messageId) {
  if (!/^spc-msg-[0-9a-f-]{36}$/i.test(String(messageId))) throw new Error("Invalid message identity.");
  const b = dataFrame(await rpc(token, "MessageService", "GetMessage", pbStr(2, messageId), { timeoutMs: 12000, maxResponseBytes: 512 * 1024 }));
  const out = { id: "", fromMe: false, audio: false, senderMatches: false, chatMatches: false, attachments: [] };
  pbWalk(b, (f, w, span) => {
    if (f !== 1 || w !== 2) return;
    pbWalk(b, (n, wire, v) => {
      if (n === 1 && wire === 2) out.id = td.decode(b.subarray(...v)).slice(0, 256);
      else if (n === 21 && wire === 0) out.fromMe = !!v;
      else if (n === 40 && wire === 0) out.audio = !!v;
      else if (n === 20 && wire === 2) pbWalk(b, (k, kind, s) => { if (k === 1 && kind === 2) out.senderMatches = normPhone(td.decode(b.subarray(...s))) === phone; }, ...v);
      else if (n === 92 && wire === 2) { const parts = td.decode(b.subarray(...v)).split(";"); if (parts.length === 3 && parts[1] === "-" && parts[2] === phone && ["any", "imessage", "sms", "rcs"].includes(parts[0].toLowerCase())) out.chatMatches = true; }
      else if (n === 2 && wire === 2) pbWalk(b, (k, kind, s) => {
        if (k === 2 && kind === 2 && out.attachments.length < 20) {
          const a = attachmentInfo(b, ...s);
          out.attachments.push({ id: String(a.guid || "").slice(0, 256), name: String(a.fileName || "").slice(0, 256), mimeType: String(a.mimeType || "").slice(0, 160), uti: String(a.uti || "").slice(0, 160), size: a.totalBytes ?? null, transferState: a.transferState ?? null });
        }
      }, ...v);
    }, ...span);
  });
  if (out.id !== messageId || out.fromMe || !out.senderMatches || !out.chatMatches) return { ok: false, reason: "message_identity_not_verified" };
  return { ok: true, ...out };
}

// The official SDK resolves an attachment reference with GetAttachmentInfo
// before using the returned canonical info.guid. Never derive that GUID by
// changing prefixes or using original_guid (which names an edited predecessor).
export async function inspectAttachmentIdentity(token, attachmentId) {
  const b = dataFrame(await rpc(token, "AttachmentService", "GetAttachmentInfo", pbStr(1, attachmentId), { timeoutMs: 12000, maxResponseBytes: 64 * 1024 }));
  let info = null;
  pbWalk(b, (field, wire, span) => { if (field === 1 && wire === 2) info = attachmentInfo(b, ...span); });
  return info;
}

// ---- Which service the person's phone is on: iPhone = iMessage; Android = SMS/RCS fallback (Free includes "RCS and SMS fallback",
// photon.codes/pricing). Our chats are `any;-;<phone>`, so the line picks iMessage or SMS/RCS itself; what we send has to suit it.
// ChatService/GetChat { chat_guid = 1 } → { chat = 1 Chat { …, service = 6 (ChatServiceType), participants = 10 SingleServiceAddressInfo
//   { address = 1, service = 2, country = 3 } } }. Works once the chat exists (after their first text); NOT_FOUND before that.
// AddressService/GetIMessageAvailability { address = 1 } → { is_available = 1 }: Apple's live lookup; false = not on iMessage, or
//   Apple couldn't confirm. ChatServiceType: 0 unspecified, 1 iMessage, 2 SMS, 3 RCS (advanced-imessage 2.2.0;
//   test/texting-android.test.mjs checks both against its encoder).
export const SERVICES = { 1: "imessage", 2: "sms", 3: "rcs" };
export const getChatRequest = (phone) => pbStr(1, chatGuid(phone));
export const availabilityRequest = (phone) => pbStr(1, phone);
// The first gRPC-web data frame's payload (rpc returns the whole body: frames + trailer).
export function dataFrame(buf) {
  let p = 0;
  while (buf.length - p >= 5) {
    const flag = buf[p], len = new DataView(buf.buffer, buf.byteOffset + p + 1, 4).getUint32(0);
    if (!(flag & 0x80)) return buf.subarray(p + 5, Math.min(buf.length, p + 5 + len));
    p += 5 + len;
  }
  return new Uint8Array(0);
}
// GetChatResponse bytes → "imessage" | "sms" | "rcs" | null. The chat's own service wins; else the person's handle's service.
export function chatServiceOf(b, phone) {
  let svc = 0, part = 0;
  pbWalk(b, (f, w, v) => {
    if (f !== 1 || w !== 2) return;
    pbWalk(b, (cf, cw, cv) => {
      if (cf === 6 && cw === 0) svc = cv;
      else if (cf === 10 && cw === 2) {
        let a = "", s = 0;
        pbWalk(b, (pf, pw, pv) => { if (pf === 1 && pw === 2) a = td.decode(b.subarray(pv[0], pv[1])); else if (pf === 2 && pw === 0) s = pv; }, cv[0], cv[1]);
        if (!part && (!phone || a === phone)) part = s;
      }
    }, v[0], v[1]);
  });
  return SERVICES[svc] || SERVICES[part] || null;
}
export async function chatService(token, phone, { timeoutMs } = {}) {
  return chatServiceOf(dataFrame(await rpc(token, "ChatService", "GetChat", getChatRequest(phone), { timeoutMs })), phone);
}
export async function imessageAvailable(token, phone, { timeoutMs } = {}) {
  let ok = false;
  pbWalk(dataFrame(await rpc(token, "AddressService", "GetIMessageAvailability", availabilityRequest(phone), { timeoutMs })), (f, w, v) => { if (f === 1 && w === 0) ok = !!v; });
  return ok;
}
// → { service: "imessage" | "sms" | "rcs" | "not_imessage" | null, via: "chat" | "lookup" | null }. Never throws.
// "not_imessage" = Apple's lookup said no (could still be an iPhone with iMessage off). null = both lookups failed: unknown.
export async function phoneService(token, phone, { timeoutMs = 8000 } = {}) {
  try { const s = await chatService(token, phone, { timeoutMs }); if (s) return { service: s, via: "chat" }; } catch {}
  try { return { service: (await imessageAvailable(token, phone, { timeoutMs })) ? "imessage" : "not_imessage", via: "lookup" }; } catch { return { service: null, via: null }; }
}
// What a webhook's sender says, if Photon includes it (the docs show only { id, platform }; spectrum-ts's sender type has
// service "iMessage" | "SMS" | "RCS" | "unknown").
export const senderService = (sender) => ({ imessage: "imessage", sms: "sms", rcs: "rcs" })[String(sender?.service || "").toLowerCase()] || null;
