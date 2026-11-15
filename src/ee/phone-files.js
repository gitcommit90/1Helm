// Produced Library files accompany replies to a phone conversation. No public
// share link is created. Recovery only drains explicitly queued reply files.
import { deliverFile, deliverText } from './texting.js';
import { photonAnswerOptions, recordPhotonReplySource } from './photon-replies.js';

const MAX_FILE = 5 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024, MAX_FILES = 20;
export function phoneFilesInit(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS phone_file_sends (id TEXT PRIMARY KEY,session TEXT NOT NULL,turn TEXT NOT NULL,file TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,due INTEGER NOT NULL,tries INTEGER NOT NULL DEFAULT 0,guid TEXT,result TEXT,reason TEXT,UNIQUE(turn,file))");
}
export function phoneFilesNext(sql) { return sql.exec("SELECT MIN(due) t FROM phone_file_sends WHERE state IN ('pending','fallback')").toArray()[0]?.t ?? null; }
function bound(R, card) {
  return R.textsSessions().includes(card.session) || R.sql.exec("SELECT 1 FROM card_events WHERE card=? AND type='msg' AND via='text' LIMIT 1", card.id).toArray().length > 0
    || R.sql.exec("SELECT 1 FROM user_input_receipts WHERE turn=? AND json_extract(opts_json,'$.viaText')=1 LIMIT 1", card.id).toArray().length > 0;
}
function current(R, row, p) {
  const queued = R.sql.exec("SELECT state FROM phone_file_sends WHERE id=?", row.id).toArray()[0];
  const card = R.sql.exec("SELECT id,session,status,opened FROM cards WHERE id=?", row.turn).toArray()[0], session = R.session(row.session);
  if (!queued || !['pending','fallback'].includes(queued.state) || !session || session.done || !card || card.session !== row.session || ['stopped','failed','interrupted'].includes(card.status)
    || Number(card.opened) <= Number(R.get(`phone_files_cutoff:${row.session}`) || 0) || R.get('tenant') !== p.tenant || R.get('channel') !== p.channel || !bound(R, card) || [...(R.active?.values() || [])].some(t => t.turn === row.turn && t.abort === 'hard')) return false;
  if (!p.file) return true; // One private Library link for overflow files.
  const f = R.libFile(p.file);
  return !!(f && f.session === row.session && f.turn === row.turn && (f.source === 'helper' || Number(f.version || 1) > 1) && f.r2key === p.key && Number(f.version || 1) === p.version && Number(f.bytes) === p.bytes);
}
export function queuePhoneFiles(R, turn) {
  if (!turn) return;
  const card = R.sql.exec("SELECT id,session,status,opened FROM cards WHERE id=?", turn).toArray()[0];
  if (!card || !bound(R, card) || !R.session(card.session) || R.session(card.session).done || Number(card.opened) <= Number(R.get(`phone_files_cutoff:${card.session}`) || 0) || ['stopped','failed','interrupted'].includes(card.status) || [...(R.active?.values() || [])].some(t => t.turn === turn && t.abort === 'hard')) return;
  // An edited upload keeps its source='upload'; version > 1 distinguishes
  // the new output from an incoming upload whose initial turn is this card.
  const files = R.sql.exec("SELECT * FROM files WHERE turn=? AND session=? AND (source='helper' OR version>1) AND deleted=0 AND pending=0 ORDER BY at,id LIMIT ?", turn, card.session, MAX_FILES + 1).toArray();
  let total = 0;
  for (const f of files.slice(0, MAX_FILES)) {
    total += Number(f.bytes) || 0;
    const p = { tenant: R.get('tenant'), channel: R.get('channel'), file: f.id, key: f.r2key, version: Number(f.version || 1), name: f.name, bytes: Number(f.bytes) || 0, clientMessageId: crypto.randomUUID(), fallbackId: crypto.randomUUID(), replyTo: photonAnswerOptions(R, turn).replyTo };
    const reason = p.bytes > MAX_FILE || total > MAX_TOTAL ? 'size_limit' : null;
    R.sql.exec("INSERT OR IGNORE INTO phone_file_sends(id,session,turn,file,payload,state,due,reason) VALUES(?,?,?,?,?,?,?,?)", crypto.randomUUID(), card.session, turn, f.id, JSON.stringify(p), reason ? 'fallback' : 'pending', Date.now() + 30000, reason);
  }
  if (files.length > MAX_FILES) {
    const p = { tenant: R.get('tenant'), channel: R.get('channel'), name: 'Additional files', fallbackId: crypto.randomUUID() };
    R.sql.exec("INSERT OR IGNORE INTO phone_file_sends(id,session,turn,file,payload,state,due,reason) VALUES(?,?,?,?,?,'fallback',?,'count_limit')", crypto.randomUUID(), card.session, turn, '*', JSON.stringify(p), Date.now() + 30000);
  }
  if (files.length) R.ctx.waitUntil?.(R.arm());
}
async function sendOne(R, row) {
  const p = JSON.parse(row.payload), valid = () => current(R, row, p);
  if (!valid()) { R.sql.exec("UPDATE phone_file_sends SET state='cancelled' WHERE id=?", row.id); return; }
  const tries = Number(row.tries) + 1;
  R.sql.exec("UPDATE phone_file_sends SET tries=?,due=? WHERE id=?", tries, Date.now() + 30000, row.id);
  await R.arm(); // The retry is durable before any external request.
  try {
    if (row.state === 'pending') {
      let data;
      if (!row.guid) {
        const object = await R.env.WS.get(p.key);
        if (!valid()) return;
        if (!object || object.size !== p.bytes || object.size > MAX_FILE) throw Object.assign(new Error('The saved file bytes are unavailable.'), { code: 'file_unavailable' });
        data = new Uint8Array(await object.arrayBuffer());
      }
      const sent = await deliverFile(R.env, p.tenant, { name: p.name, data, guid: row.guid, clientMessageId: p.clientMessageId }, {
        replyTo: p.replyTo, current: valid, uploaded: guid => { if (valid()) R.sql.exec("UPDATE phone_file_sends SET guid=? WHERE id=?", guid, row.id); }
      });
      if (!valid()) return;
      if (sent.ok && !sent.id) throw Object.assign(new Error('Photon did not return a message receipt.'), { code: 'delivery_unconfirmed' });
      if (sent.ok) {
        R.sql.exec("UPDATE phone_file_sends SET state='sent',result=? WHERE id=?", sent.id || null, row.id);
        recordPhotonReplySource(R, row.turn, sent); return;
      }
      if (sent.reason === 'cancelled') return;
      if (sent.reason === 'not_connected') throw Object.assign(new Error('Phone is not connected.'), { code: 'not_connected' });
      R.sql.exec("UPDATE phone_file_sends SET state='fallback',reason=?,tries=0 WHERE id=?", sent.reason, row.id);
      row.state = 'fallback'; row.reason = sent.reason;
    }
    if (!valid()) return;
    const tenant = await R.env.DB.prepare('SELECT slug FROM tenants WHERE id=?').bind(p.tenant).first();
    if (!valid() || !tenant?.slug) return;
    const base = `https://${R.env.GATEWAY_HOST || R.env.APP_HOST}/w/${encodeURIComponent(tenant.slug)}`;
    const url = p.file ? `${base}/app#/${encodeURIComponent(p.channel)}/s/${encodeURIComponent(row.session)}` : `${base}/app#/${encodeURIComponent(p.channel)}/library`;
    const why = { size_limit: 'The file exceeds the phone attachment limit.', count_limit: 'The remaining files are available in your Library.', not_imessage: 'File delivery is unavailable for this phone service.', file_unavailable: 'The attachment bytes could not be read.', provider_rejected: 'Photon rejected the attachment.', delivery_unconfirmed: 'Photon did not confirm attachment delivery.' }[row.reason] || 'The attachment could not be sent.';
    const name = String(p.name).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 200);
    const sent = await deliverText(R.env, p.tenant, `${name}: ${why}\nOpen ${p.file ? 'the attached file in its 1Helm task' : 'your 1Helm Library'} (sign in if asked):\n${url}`, { clientMessageId: p.fallbackId, replyTo: p.replyTo, current: valid });
    if (!valid()) return;
    if (!sent.ok || !sent.id) throw Object.assign(new Error('Fallback delivery was not confirmed.'), { code: sent.reason || 'delivery_unconfirmed' });
    R.sql.exec("UPDATE phone_file_sends SET state='linked',result=? WHERE id=?", sent.id || null, row.id);
    recordPhotonReplySource(R, row.turn, sent);
  } catch (e) {
    if (!valid()) return;
    const permanent = ['3','7','9','12','attachment_size','file_unavailable'].includes(String(e.code));
    const reason = e.code === 'file_unavailable' ? 'file_unavailable' : permanent ? 'provider_rejected' : 'delivery_unconfirmed';
    if (row.state === 'pending' && (permanent || tries >= 3)) R.sql.exec("UPDATE phone_file_sends SET state='fallback',reason=?,tries=0,due=? WHERE id=?", reason, Date.now() + 1000, row.id);
    else R.sql.exec("UPDATE phone_file_sends SET state=?,reason=?,due=? WHERE id=?", tries >= 3 ? 'failed' : row.state, row.reason || reason, Date.now() + 30000, row.id);
    console.log('phone file delivery', row.turn, row.file, String(e.code || 'request_failed').slice(0, 60));
  }
}
export async function deliverPhoneFiles(R, turn = null) {
  R._phoneFileRuns ||= new Map();
  const rows = R.sql.exec("SELECT * FROM phone_file_sends WHERE state IN ('pending','fallback')" + (turn ? ' AND turn=?' : ' AND due<=?') + ' ORDER BY due,id LIMIT 21', turn || Date.now()).toArray();
  for (const row of rows) {
    const old = R._phoneFileRuns.get(row.id); if (old) { await old.promise; continue; }
    const promise = sendOne(R, row).finally(() => R._phoneFileRuns.delete(row.id));
    R._phoneFileRuns.set(row.id, { session: row.session, promise }); await promise;
  }
  // Nothing sent, nothing changed: re-arming would drop the alarm handler's backstop wake-up (resume.js armBackstop) while later steps still run.
  if (rows.length) await R.arm();
}
export async function dropPhoneFiles(R, session = null) {
  const sessions = session == null ? R.sql.exec('SELECT id FROM sessions').toArray().map(x => x.id) : [String(session)];
  for (const sid of sessions) R.put(`phone_files_cutoff:${sid}`, String(Date.now()));
  R.sql.exec("UPDATE phone_file_sends SET state='cancelled'" + (session == null ? '' : ' WHERE session=?'), ...(session == null ? [] : [String(session)]));
  await Promise.allSettled([...(R._phoneFileRuns?.values() || [])].filter(x => session == null || x.session === session).map(x => x.promise));
  R.sql.exec('DELETE FROM phone_file_sends' + (session == null ? '' : ' WHERE session=?'), ...(session == null ? [] : [String(session)]));
}
