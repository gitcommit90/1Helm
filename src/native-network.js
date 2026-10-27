// Native SSH control plane. No HTTP route or computer.internal endpoint exposes
// grants, broker RPC, private keys, or tailnet sockets to the agent computer.
// Approval state belongs to Resident SQL; encrypted identity/enrollment belong to
// the isolated NativeTransport DO. HTTP Always Approve is deliberately not read.
export const SSH_PERMS = new Set(['ssh', 'ssh_hostkey']);
export const SSH_TTL = 10 * 60e3;
export const SSH_OPENING_TIMEOUT = 180e3; // broker start (30s) + bounded RPC (120s), with margin
export const nativeAvailable = (env) => env.NATIVE_NETWORK === 'on' && !!env.NATIVE_TRANSPORT;
export const nativeSameOrigin = req => req.headers.get('origin') === new URL(req.url).origin && req.headers.get('sec-fetch-site') !== 'cross-site';
export const nativeBroker = (env, tenant, channel) => env.NATIVE_TRANSPORT.get(env.NATIVE_TRANSPORT.idFromName(`${tenant}:${channel}`));
export async function sshPermission(env, tenant) {
  try {
    const r = await env.DB.prepare('SELECT ssh_mode,ssh_trusted,generation FROM direct_network_permissions WHERE tenant_id=?').bind(tenant).first();
    return { mode: r?.ssh_mode === 'ask' ? (r.ssh_trusted === 1 ? 'trusted' : 'ask') : 'deny', generation: Number(r?.generation || 0) };
  } catch { return { mode: 'deny', generation: 0 }; }
}
export async function setSshPermission(env, tenant, mode, channels) {
  if (!['deny', 'ask', 'trusted'].includes(mode)) return { error: 'Outbound SSH must be deny, ask or trusted.' };
  const update = await env.DB.prepare("INSERT INTO direct_network_permissions (tenant_id,ssh_mode,ssh_trusted,generation,updated_at) VALUES (?,?,?,1,?) ON CONFLICT(tenant_id) DO UPDATE SET ssh_mode=excluded.ssh_mode,ssh_trusted=excluded.ssh_trusted,generation=direct_network_permissions.generation+1,updated_at=excluded.updated_at WHERE direct_network_permissions.ssh_mode<>excluded.ssh_mode OR direct_network_permissions.ssh_trusted<>excluded.ssh_trusted OR excluded.ssh_mode='deny'").bind(tenant, mode === 'deny' ? 'deny' : 'ask', mode === 'trusted' ? 1 : 0, Date.now()).run();
  if (mode !== 'deny' && update.meta?.changes === 0) return { ok: true };
  // Every change invalidates outstanding grants; Deny additionally closes sessions.
  const failures = [];
  for (const c of await channels()) {
    const channel = c.slug || c.name;
    try {
      const R = env.RESIDENT.get(env.RESIDENT.idFromName(`res:${tenant}:${channel}`));
      // Archive rows can predate the first Resident use (fresh General/imports).
      // Bind authoritative account/channel data without starting a computer.
      await R.bind(tenant, channel, String(c.id ?? ''));
      await R.nativeInvalidate(mode === 'deny' ? 'SSH permission changed to Deny' : 'SSH permission changed', mode === 'deny');
    }
    catch { failures.push(channel); }
  }
  return { ok: !failures.length, ...(failures.length ? { error: 'Permission saved. Some computers have not acknowledged termination; retry Deny.', pending_channels: failures } : {}) };
}

export function nativeInit(sql) {
  try { sql.exec('ALTER TABLE approvals ADD COLUMN ssh_data TEXT'); } catch {}
  sql.exec(`CREATE TABLE IF NOT EXISTS native_sessions (id TEXT PRIMARY KEY, task TEXT NOT NULL, turn TEXT NOT NULL, request_id TEXT NOT NULL, route TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active');`);
  try { sql.exec('ALTER TABLE native_sessions ADD COLUMN helper INTEGER'); } catch {}
}
// A card's outcome goes to the worker that raised it, or else to Primary (resident.js cardHandoff). Residents without it hand the task back directly.
const handBack = (res, task, turn, input, opts) => res.cardHandoff ? res.cardHandoff(task, turn, input, opts) : opts?.helperOnly ? null : res.handoff(task, input);
const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const owner = (res) => ({ tenant: res.get('tenant'), channel: res.get('channel') });
const touchTask = (res, task) => { if (task) res.sql.exec('UPDATE sessions SET updated=MAX(COALESCE(updated,0)+1,?) WHERE id=?', Date.now(), task); };
// Projection only: approval consumption and the real persisted handoff card are
// the source of progress. Never invent a model turn or replay an SSH grant.
export function nativeApprovalProgress(res, a, now = Date.now()) {
  if (!SSH_PERMS.has(a?.perm)) return null;
  const d = parse(a.ssh_data);
  if (a.status === 'consumed') return now - Number(a.decided_at || a.at) < SSH_OPENING_TIMEOUT
    ? { phase: 'connecting', line: 'opening the approved SSH connection' }
    : { phase: 'failed', error: 'Connection setup was interrupted or timed out. Check Computer connections and request a fresh connection.' };
  if (a.status !== 'approved') return null;
  if (d.resume_error) return { phase: 'failed', error: d.resume_error };
  if (!d.resume_card) return { phase: 'complete' }; // historical receipt, not a claim that it is still running
  let card;
  try { card = res.sql.exec('SELECT status,closed FROM cards WHERE id=? AND session=?',d.resume_card,d.task).toArray()[0]; } catch {}
  if (card?.closed || ['complete','completed','stopped','failed','error'].includes(card?.status)) return { phase: ['stopped','failed','error'].includes(card.status) ? 'failed' : 'complete', ...(['stopped','failed','error'].includes(card.status) ? {error:'The resumed task stopped or failed. Check its latest reply before continuing.'} : {}) };
  const live = res.liveTurn?.(d.task);
  if (live && !live.finished && live.turn === d.resume_card) return { phase: 'running' };
  // A real persisted queue/resume journal is not a lost continuation merely
  // because another task turn has taken more than three minutes.
  let journal;
  try { journal=res.sql.exec("SELECT status FROM turn_runs WHERE card=? AND session=?",d.resume_card,d.task).toArray()[0]; } catch {}
  if(card && ['queued','working','resuming'].includes(card.status) && (journal || res.sessQ?.has(d.task))) return {phase:'resuming',line:'resuming after SSH approval'};
  if (now - Number(d.resume_at || a.decided_at || a.at) >= SSH_OPENING_TIMEOUT) return { phase:'failed',error:'SSH was approved, but the task has not resumed. Check its status or send a follow-up.' };
  return { phase:'resuming',line:'resuming after SSH approval' };
}
export function nativeApprovalReceipt(res,a) {
  const p=nativeApprovalProgress(res,a);
  return {...res.approvalView(a),turn:a.turn,...(p?{native_progress:p.phase,...(p.error?{native_progress_error:p.error}:{})}:{})};
}
const safeError = () => ({ ok: false, state: 'error', error: 'The trusted network transport could not complete this operation. Check connection status and retry.' });
const closedAck = r => { if (r?.ok !== true || r?.error) throw new Error('Session termination not acknowledged; retry termination.'); return r; };
const unavailable = () => ({ ok: false, available: false, state: 'unavailable', error: 'Native SSH and Tailscale are unavailable on this deployment. No connection was opened.' });
export const COMPUTER_NETWORK_LINK = '#settings/computer-network';
// The result of an SSH request that cannot start yet. The person gets the steps for exactly what is missing and a link to Settings, Computer connections.
// Nothing here opens a connection, and the next request checks the state again before any SSH attempt.
export const setupNeeded = (missing, steps, extra = {}, worker = false) => ({ ok: false, state: 'setup_needed', missing, settings_link: COMPUTER_NETWORK_LINK, settings_page: 'Settings, Computer connections', steps, ...extra,
  next: worker
    ? 'SSH cannot start yet. Call request_input with these steps in plain words and the settings_link page (Settings, Computer connections), so the person sees them in the task, without any other SSH attempt, probe or workaround. You continue in this same session when they say it is done, and then call ssh_connect again; it checks the state first.'
    : 'SSH cannot start yet. Show the person a card in the chat that links to settings_link and lists these steps in plain words, then end the turn without any other SSH attempt, probe or workaround. When the person says it is done, call ssh_connect again; it checks the state first.' });
export function tailnetSetupSteps(tailscale = {}, key = null) {
  const steps = [], state = tailscale.state || 'disconnected', name = tailscale.device_name;
  if (state === 'awaiting_user_approval' || state === 'joining') steps.push(`Open Settings, Computer connections, approve ${name ? `the device ${name}` : 'this computer'} in Tailscale, then press Check connection.`);
  else if (state === 'expired' || state === 'error') steps.push('Open Settings, Computer connections, and join this computer to your tailnet again, then press Check connection.');
  else steps.push('Open Settings, Computer connections, press Connect to Tailscale, approve this computer in Tailscale, then press Check connection.');
  if (key?.public_key) steps.push(`Add this computer's public key to the server account's authorized_keys file: ${key.public_key}`);
  return steps;
}
const safeText = (s) => typeof s === 'string' ? s.replace(/https:\/\/login\.tailscale\.com\/[^\s"'<>]+/g, '[login link in Settings]').slice(0, 1000) : undefined;
const publicKey = (r) => { const k = r?.key || r; return k?.public_key && k?.fingerprint ? { public_key: k.public_key, fingerprint: k.fingerprint } : null; };
const identityView = (r) => ({ ok: r?.ok !== false, key: publicKey(r), ...(r?.error ? { error: safeText(r.error) } : {}) });
const publicTailnet = (r = {}, includeLoginUrl = false) => {
  const state = r.state === 'offline_reconnecting' ? 'offline' : r.state === 'expired_revoked' ? 'expired' : r.state || 'disconnected';
  const out = { state, ...(r.device_name ? { device_name: r.device_name } : {}), ...(r.dns_name ? { dns_name: r.dns_name } : {}), ...(r.device_id ? { device_id: r.device_id } : {}), ...(Array.isArray(r.addresses) ? { addresses: r.addresses } : {}), ...(r.error ? { error: safeText(r.error) } : {}) };
  if(typeof r.verified === 'boolean')out.verified=r.verified;
  if(Number.isFinite(r.checked_at))out.checked_at=r.checked_at;
  if (includeLoginUrl && r.login_url) { try { const u = new URL(r.login_url); if (u.protocol === 'https:' && u.hostname === 'login.tailscale.com' && !u.username && !u.password) out.login_url = u.href; } catch {} }
  return out;
};
export function sshApprovalView(a) {
  const d = parse(a.ssh_data), hostkey = a.perm === 'ssh_hostkey';
  return { perm: a.perm, name: hostkey ? 'Verify SSH host key' : 'Outbound SSH', always: null,
    what: a.what, ask: hostkey ? 'Trust this SSH server key and connect?' : 'Open this SSH session?',
    ssh: { channel: d.channel, task: d.task, destination: d.host, port: d.port, username: d.user, route: d.route, request_id: d.requestId, fingerprint: d.fingerprint || null, remember_allowed: d.rememberAllowed === true, remember_requested: d.remember === true, trust_saved: d.trust_saved === true },
    action: { title: hostkey ? 'Verify SSH server identity' : 'Approve one SSH session',
      lines: [['Computer', d.channel], ['Server', `${d.user}@${d.host}:${d.port}`], ['Pinned address', d.address || 'Unavailable'], ['Route', d.route === 'tailnet' ? 'Tailscale network' : 'Public internet'], ...(d.previous_fingerprint ? [['Previous fingerprint', d.previous_fingerprint]] : []), ...(d.fingerprint ? [['Server fingerprint', d.fingerprint]] : [])],
      note: d.failure || (hostkey ? `${d.changed ? 'WARNING: this server key changed. Confirm the replacement through a separate trusted channel. ' : 'Compare this fingerprint with the server owner before trusting it. '}Approving permits remote commands and SFTP within one session.`
        : 'SSH runs from this agent’s 1HC computer through a trusted platform transport. Approval permits remote commands and SFTP, not just one command.') + (d.remember ? ' You chose to remember this exact server, account, port, route, address and verified key for future connections from this computer.' : d.rememberAllowed ? ' Approve once, or explicitly remember this verified server for future connections from this computer.' : ' Reconnecting requires another approval.') } };
}
export function sshApprovalStatus(a) {
  if (a.status === 'pending' && Date.now() > parse(a.ssh_data).expires) return 'expired';
  return a.status === 'pending' ? 'pending' : a.status === 'denied' ? 'deny' : a.status === 'approved' ? 'once' : a.status;
}
const objectSchema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const tool = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: objectSchema(properties, required) } });
export const NATIVE_TOOLS = [
  tool('native_network', 'Inspect native SSH/Tailscale state or manage this computer identity/enrollment. Call status before claiming connected OR not signed in; unchecked, sleeping or timed-out state is unknown, not disconnected. Read the native-network skill. Login links stay in Settings, never chat.', { operation: { type: 'string', enum: ['status','key','tailscale_status','tailscale_connect','tailscale_disconnect'] } }, ['operation']),
  tool('ssh_connect', 'Open a managed SSH session. Deny blocks requests; Ask each time requires human approval. Allow trusted servers reconnects only an explicitly remembered matching server; new or changed targets require a native card. Connected returns session_id; awaiting approval means end this turn, do not retry (a worker pauses until the person decides and resumes in the same session). Commands/SFTP share the session. SSH originates from this 1HC computer through its trusted transport. The computer\'s shell cannot reach tailnet addresses or port 22, so run_command, curl, ssh clients and libraries cannot replace this tool. If the tailnet is not joined or approved, the result is setup_needed with steps for the person.', { host: str('Server hostname or IP, no URL'), port: { type: 'integer', minimum: 1, maximum: 65535 }, username: str('Remote account username'), route: { type: 'string', enum: ['public','tailnet'] } }, ['host','username','route']),
  tool('ssh_session', 'Run commands or SFTP inside an existing approved SSH session belonging to this task, or close it. No forwarding or reconnect. For a closed/lost session call ssh_connect; the actual SSH setting and remembered server identity determine whether approval is required.', { session_id: str('Approved managed session ID'), operation: { type: 'string', enum: ['exec','sftp','close'] }, command: str('Remote shell command for exec'), sftp_operation: { type: 'string', enum: ['list','read','write','mkdir','remove','rename','stat'] }, path: str('Remote SFTP path'), destination: str('New remote path for rename'), data: str('Content for SFTP write, at most 1 MiB per chunk'), encoding: { type: 'string', enum: ['utf8','base64'] }, offset: { type: 'integer', minimum: 0, description: 'Byte offset for chunked reads/writes. Write without offset truncates; explicit offset preserves other bytes unless truncate is true.' }, length: { type: 'integer', minimum: 1, maximum: 1048576, description: 'Maximum bytes returned by a read chunk' }, truncate: { type: 'boolean', description: 'Explicitly truncate destination before writing this chunk' } }, ['session_id','operation']),
];
export const NATIVE_TOOL_NAMES = new Set(NATIVE_TOOLS.map(t => t.function.name));

export function nativeExpire(res) {
  for (const a of res.sql.exec("SELECT id,ssh_data FROM approvals WHERE perm IN ('ssh','ssh_hostkey') AND status='pending'").toArray()) {
    const d = parse(a.ssh_data);
    if (d.expires <= Date.now()) { res.sql.exec("UPDATE approvals SET status='expired',decided_at=? WHERE id=? AND status='pending'", Date.now(), a.id); touchTask(res, d.task);
      handBack(res, d.task, d.turn, { text: `(Platform event: the SSH request to ${d.user}@${d.host} expired before the person decided. No connection was opened. Call ssh_connect again for a fresh request, or say in your done response that SSH did not happen.)`, from: { type: 'ssh', id: a.id, title: 'SSH request expired' } }, { helperOnly: true }); }
  }
}
function addRequest(res, d, tc, perm = 'ssh', silent = false) {
  const now = Date.now();
  res.sql.exec('INSERT INTO approvals (at,host,method,path,bytes,keys,turn,session,perm,what,ssh_data) VALUES (?,?,?,?,?,?,?,?,?,?,?)', now, d.host, 'SSH', '', 0, '[]', d.turn, d.task, perm, `${d.user}@${d.host}:${d.port}`, JSON.stringify(d));
  const a = res.sql.exec('SELECT * FROM approvals WHERE id=last_insert_rowid()').one();
  touchTask(res, d.task);
  if (!silent) {
    tc?.emit?.({ t: 'approval', approval: res.approvalView(a) });
    for (const live of res.active?.values() || []) if (live !== tc && live.session === d.task && !live.finished) live.emit?.({ t: 'approval', approval: res.approvalView(a) });
  }
  return a;
}
export async function nativeTool(res, name, a, tc) {
  if (!nativeAvailable(res.env)) return unavailable();
  if (!tc?.turn || !tc.session || !res.session(tc.session) || tc.abort === 'hard') return { ok: false, error: 'A current task and initiating run are required.' };
  const own = owner(res), broker = nativeBroker(res.env, own.tenant, own.channel);
  try {
    const guard = await res.computer().nativeGuardStatus();
    if (!guard.guarded) return { ok: false, state: 'unavailable', error: 'This computer is still using an older unrestricted network configuration. Its current work must finish and the computer must restart with Sentinel before native SSH can be used.' };
    if (name === 'native_network') {
      if (a.operation === 'status' || a.operation === 'tailscale_status') return await res.nativeStatus(false);
      if (a.operation === 'key') return identityView(await broker.identity(own));
      if (a.operation === 'tailscale_connect') {
        const r = await broker.tailscaleConnect(own);
        // Enrollment URLs are transient user-facing state, never a model/tool result.
        return { ok: r.ok !== false, state: r.state, error: safeText(r.error), next: 'Open Settings → Connected accounts → Computer connections to approve this 1HC computer joining your tailnet. A Tailscale management API connection does not join it.' };
      }
      if (a.operation === 'tailscale_disconnect') return await res.nativeAct({ op: 'tailscale_disconnect' });
      return { ok: false, error: 'Unknown native network operation.' };
    }
    const permission = await sshPermission(res.env, own.tenant);
    const worker = !!tc.helper?.dynamic_routing;
    if (permission.mode === 'deny') return setupNeeded(['ssh_permission'], ['Open Settings, Permissions, Direct network protocols, and set Outbound SSH to Ask each time or Allow trusted servers.'], { state: 'denied', error: 'Outbound SSH is Deny. No connection was opened.' }, worker);
    if (name === 'ssh_connect' && ['tailnet'].includes(a.route)) {
      // Check the current state before any connection attempt, so a missing tailnet membership is reported at once.
      const st = await res.nativeStatus(false), ts = st.tailscale || {};
      if (['disconnected','awaiting_user_approval','joining','expired'].includes(ts.state || 'disconnected')) {
        let key = st.key; if (!key) { try { key = publicKey(await broker.identity(own)); } catch {} }
        return setupNeeded(['tailscale'], tailnetSetupSteps(ts, key), { tailscale: { state: ts.state || 'disconnected', ...(ts.device_name ? { device_name: ts.device_name } : {}) }, key: key || null }, worker);
      }
    }
    if (name === 'ssh_connect') {
      nativeExpire(res);
      const host = String(a.host || '').trim().toLowerCase().replace(/\.$/, ''), user = String(a.username || '').trim(), port = a.port == null ? 22 : Number(a.port), route = a.route;
      if (!host || host.length > 253 || /[\s/@?#\\]/.test(host) || !/^[a-zA-Z0-9_.-]{1,64}$/.test(user) || !Number.isInteger(port) || port < 1 || port > 65535 || !['public','tailnet'].includes(route)) return { ok: false, error: 'Supply a hostname/IP, valid username, port 1–65535, and public or tailnet route. URLs and proxy commands are unsupported.' };
      // Repeated calls in the same initiating run re-use one pending card only.
      const pending = res.sql.exec("SELECT * FROM approvals WHERE perm IN ('ssh','ssh_hostkey') AND status='pending' AND turn=? AND session=?", tc.turn, tc.session).toArray().find(x => { const d = parse(x.ssh_data); return d.host === host && d.user === user && d.port === port && d.route === route; });
      if (pending) return { ok: false, state: 'awaiting_approval', approval_id: pending.id, next: worker ? 'The native approval card is waiting in the person\'s task. Your worker pauses until they decide, and approval resumes this same worker.' : 'The native approval card is waiting. End this turn; approval resumes this task.' };
      const pinned = await broker.prepareSsh({ ...own, host, port, user, route });
      if (pinned.ok === false || pinned.error) return pinned;
      const d = { ...pinned, ...own, host, port, user, route, task: tc.session, turn: tc.turn, ...(tc.helper?.id != null ? { helper: tc.helper.id } : {}), requestId: crypto.randomUUID(), expires: Date.now() + SSH_TTL, permissionGeneration: permission.generation, rememberAllowed: permission.mode === 'trusted' };
      // Recheck cancellation and generation after the resolver await.
      const after = await sshPermission(res.env, own.tenant);
      if (tc.abort === 'hard' || !res.session(tc.session) || after.mode === 'deny' || after.generation !== permission.generation) return { ok: false, state: 'cancelled', error: 'Task or SSH permission changed while preparing the request.' };
      if (permission.mode === 'trusted') {
        // Persist before I/O so Stop/restart/orphan cleanup covers automatic opens
        // exactly as it covers human-approved ones. This is not a human card.
        const auto = {...d,auto:true}, card = addRequest(res,auto,null,'ssh',true);
        res.sql.exec("UPDATE approvals SET status='consumed',decision='trusted',decided_at=? WHERE id=?",Date.now(),card.id);
        let result; try { result=await broker.openTrustedSsh(auto); } catch {result=safeError();}
        if (result.state !== 'approval_required') return await completeSsh(res,card,auto,result);
        if (res.sql.exec('SELECT status FROM approvals WHERE id=?',card.id).one()?.status !== 'consumed' || tc.abort === 'hard' || !res.session(tc.session)) return {ok:false,state:'cancelled',error:'Task or trust changed while connecting.'};
        res.sql.exec("UPDATE approvals SET status='pending',decision=NULL,decided_at=NULL,ssh_data=? WHERE id=?",JSON.stringify(d),card.id);
        tc.emit?.({t:'approval',approval:res.approvalView({...card,ssh_data:JSON.stringify(d)})});
        return {ok:false,state:'awaiting_approval',approval_id:card.id,next:worker ? 'This server is not remembered. Your worker pauses until the person decides; they can approve once or explicitly trust it in the native card, and approval resumes this same worker.' : 'This server is not remembered. End this turn; the person can approve once or explicitly trust it in the native card.'};
      }
      const card = addRequest(res, d, tc);
      return { ok: false, state: 'awaiting_approval', approval_id: card.id, next: worker ? 'The person must approve the native card shown in their task. Your worker pauses until they decide, and approval resumes this same worker. The computer can sleep while waiting.' : 'End this turn. The person must approve the native card; approval resumes this task. The computer can sleep while waiting.' };
    }
    if (name === 'ssh_session') {
      const s = res.sql.exec("SELECT * FROM native_sessions WHERE id=? AND task=? AND status='active'", String(a.session_id || ''), tc.session).toArray()[0];
      if (!s) return { ok: false, error: 'No active approved SSH session belongs to this task. Use ssh_connect for a fresh connection.' };
      const auth = { ...own, task: s.task, turn: s.turn, permissionGeneration: permission.generation };
      if (a.operation === 'close') { const r = closedAck(await broker.closeSsh(auth, { session: s.id })); res.sql.exec("UPDATE native_sessions SET status='closed' WHERE id=?", s.id); return r; }
      if (a.operation === 'exec') return await broker.execSsh(auth, { session: s.id, command: String(a.command || '') });
      if (a.operation === 'sftp') return await broker.sftpSsh(auth, { session: s.id, op: a.sftp_operation, path: a.path, destination: a.destination, data: a.data, encoding: a.encoding || 'utf8', offset: a.offset, length: a.length, truncate: a.truncate });
    }
    return { ok: false, error: 'Unknown SSH operation.' };
  } catch { return safeError(); }
}

export async function decideSsh(res, a, decision) {
  if (!['once','deny','trust'].includes(decision)) return { error: 'SSH approvals accept once, trust or deny.' };
  nativeExpire(res);
  const current = res.sql.exec('SELECT * FROM approvals WHERE id=?', a.id).one();
  if (current.status !== 'pending') return { error: `Request is ${current.status}.`, status: current.status };
  if (decision === 'deny') { res.sql.exec("UPDATE approvals SET status='denied',decision='deny',decided_at=? WHERE id=? AND status='pending'", Date.now(), a.id); touchTask(res, current.session); handBack(res, current.session, current.turn, { text: `(Platform event: the person denied SSH to ${parse(current.ssh_data).user}@${parse(current.ssh_data).host}. No connection was opened. Do not try another way to reach that server. Say in your done response that the person declined.)`, from: { type: 'ssh', id: a.id, title: 'SSH denied' } }, { helperOnly: true }); return { ok: true, approval: res.approvalView({ ...current, status: 'denied', decision: 'deny' }) }; }
  if (!nativeAvailable(res.env)) return unavailable();
  const d = parse(current.ssh_data), own = owner(res), p = await sshPermission(res.env, own.tenant);
  if (!(await res.computer().nativeGuardStatus()).guarded) return { error: 'This computer must restart with Sentinel before connecting.' };
  if (decision === 'trust' && (p.mode !== 'trusted' || d.rememberAllowed !== true)) return {error:'Remembering a server requires Allow trusted servers and a current request.'};
  if (p.mode === 'deny' || p.generation !== d.permissionGeneration || d.tenant !== own.tenant || d.channel !== own.channel || !res.session(d.task) || d.task !== current.session || d.turn !== current.turn || Date.now() >= d.expires) {
    const status = Date.now() >= d.expires ? 'expired' : 'cancelled';
    res.sql.exec("UPDATE approvals SET status=?,decision='deny',decided_at=? WHERE id=? AND status='pending'", status, Date.now(), a.id);
    touchTask(res, current.session);
    handBack(res, current.session, current.turn, { text: `(Platform event: the SSH request to ${d.user}@${d.host} is no longer valid (${status}). No connection was opened. Call ssh_connect again for a fresh request, or say in your done response that SSH did not happen.)`, from: { type: 'ssh', id: a.id, title: 'SSH request ended' } }, { helperOnly: true });
    return { error: 'Request is no longer valid. Create a new request.', status };
  }
  // Re-read after await, then consume synchronously before any network operation.
  // DO input gates cannot interleave inside these SQL calls; retries never re-open.
  if (res.sql.exec('SELECT status FROM approvals WHERE id=?', a.id).one().status !== 'pending') return { error: 'Request already decided.' };
  res.sql.exec("UPDATE approvals SET status='consumed',decision='once',decided_at=? WHERE id=? AND status='pending'", Date.now(), a.id);
  touchTask(res, current.session);
  const broker = nativeBroker(res.env, own.tenant, own.channel);
  d.remember = decision === 'trust' || d.remember === true;
  let r; try { r = await broker.openSsh(d); } catch { r = safeError(); }
  return await completeSsh(res,current,d,r);
}

async function completeSsh(res,current,d,r) {
  const a=current, own=owner(res), broker=nativeBroker(res.env,own.tenant,own.channel);
  // A concurrent stop/Deny may have invalidated the request while opening.
  const valid = res.sql.exec('SELECT status FROM approvals WHERE id=?', a.id).one()?.status === 'consumed' && !!res.session(d.task);
  if (!valid) { if (r.session || r.session_id) closedAck(await broker.closeSsh(d, { session: r.session || r.session_id })); return { error: 'Request cancelled while connecting.' }; }
  if (r.state === 'host_key_confirmation_required' || r.error === 'host_key_confirmation_required') {
    const next = { ...d, auto:false, requestId: crypto.randomUUID(), expires: Date.now() + SSH_TTL, fingerprint: r.fingerprint, previous_fingerprint: r.previous_fingerprint, changed: !!r.changed };
    if (!next.fingerprint) {
      res.sql.exec("UPDATE approvals SET status='failed',ssh_data=? WHERE id=?", JSON.stringify({ ...d, failure: 'Server supplied no verifiable fingerprint. Connection blocked.' }), a.id); touchTask(res, current.session);
      return { error: 'Server supplied no verifiable fingerprint. Connection blocked.' };
    }
    res.sql.exec("UPDATE approvals SET status='host_key_required' WHERE id=?", a.id);
    const card = addRequest(res, next, null, 'ssh_hostkey');
    return { ok: true, state: 'host_key_confirmation_required', approval: res.approvalView(card) };
  }
  if (r.ok === false || r.error || !(r.session || r.session_id)) {
    res.sql.exec("UPDATE approvals SET status='failed',ssh_data=? WHERE id=?", JSON.stringify({ ...d, failure: safeText(r.error) || 'SSH did not open. Use ssh_connect for a fresh connection.' }), a.id);
    touchTask(res, current.session);
    return { ok: false, state: r.state || 'error', error: r.error || 'SSH did not open. Use ssh_connect for a fresh connection.' };
  }
  const session = r.session || r.session_id;
  res.sql.exec('INSERT INTO native_sessions (id,task,turn,request_id,route,created,helper) VALUES (?,?,?,?,?,?,?)', session, d.task, d.turn, d.requestId, d.route, Date.now(), d.helper ?? null);
  res.sql.exec("UPDATE approvals SET status='approved' WHERE id=?", a.id);
  touchTask(res, current.session);
  d.trust_saved = r.trust_saved === true;
  if (d.auto) return {ok:true,state:'connected',session_id:session,authorization:'trusted_server'};
  let handoff, resume_error;
  try { handoff=handBack(res, d.task, d.turn, { text: `(Platform event: the person approved SSH to ${d.user}@${d.host}:${d.port} through ${d.route}. The verified session is ${session}. Use ssh_session with this session_id for commands/SFTP. ${d.trust_saved ? 'This verified server was explicitly remembered; future matching ssh_connect requests can reconnect while Allow trusted servers is enabled.' : 'This was a one-session approval.'} Inspect actual results before claiming readiness.)`, from: { type: 'ssh', id: a.id, title: 'SSH session approved' } }); }
  catch { resume_error='SSH was approved, but the task could not resume. Check Computer connections and send a follow-up if needed.'; }
  if(['gone','full'].includes(handoff?.mode))resume_error='SSH was approved, but the task could not accept the continuation. Check its status before continuing.';
  const resumed={...d,...(handoff?.card?.id?{resume_card:handoff.card.id,resume_at:Date.now()}:{}),...(resume_error?{resume_error}:{})};
  res.sql.exec('UPDATE approvals SET ssh_data=? WHERE id=?',JSON.stringify(resumed),a.id);touchTask(res,d.task);
  return { ok: true, state: 'connected', session_id: session, approval: nativeApprovalReceipt(res,{ ...current, ssh_data:JSON.stringify(resumed), status: 'approved', decision: 'once' }) };
}

export const nativeMix = (Resident) => Object.assign(Resident.prototype, {
  nativeProgress(task) {
    for(const a of this.sql.exec("SELECT * FROM approvals WHERE session=? AND perm IN ('ssh','ssh_hostkey') AND status IN ('consumed','approved') ORDER BY id DESC LIMIT 20",task).toArray()) {
      const p=nativeApprovalProgress(this,a);if(p&&['connecting','resuming'].includes(p.phase))return {...p,approval_id:a.id};
    }
    return null;
  },
  nativeApprovalHistory(task) {
    return this.sql.exec("SELECT * FROM approvals WHERE session=? AND perm IN ('ssh','ssh_hostkey') AND status<>'pending' ORDER BY id DESC LIMIT 20",task).toArray().reverse().filter(a=>!parse(a.ssh_data).auto).map(a=>nativeApprovalReceipt(this,a));
  },
  async nativeStatus(includeLoginUrl = true) {
    nativeExpire(this);
    const own = owner(this), p = await sshPermission(this.env, own.tenant);
    if (!nativeAvailable(this.env)) return { ...unavailable(), permission: p.mode, key: null, sessions: [], tailscale: { state: 'disconnected' } };
    try {
      const [r, guard] = await Promise.all([nativeBroker(this.env, own.tenant, own.channel).status(own), this.computer().nativeGuardStatus()]);
      if (['awaiting_user_approval','joining','offline','offline_reconnecting'].includes(r.tailscale?.state)) {
        // Explicit UI/tool refresh verifies membership once through the trusted
        // client, including after it slept waiting for a human. No polling loop.
        r.tailscale = await nativeBroker(this.env, own.tenant, own.channel).tailscaleStatus(own);
      }
      // A setup interrupted after consume cannot be replayed. A finite stale
      // deadline avoids racing a live bounded handshake; close an orphan without
      // issuing any new connect call or silently resuming a task from a GET.
      const errors = [];
      for (const a of this.sql.exec("SELECT * FROM approvals WHERE perm IN ('ssh','ssh_hostkey') AND status IN ('consumed','failed') AND decided_at<?", Date.now() - SSH_OPENING_TIMEOUT).toArray()) {
        const d = parse(a.ssh_data), failure = 'Interrupted during SSH connection setup. Use ssh_connect for a fresh connection.';
        if (a.status === 'failed' && !d.closure_pending) continue;
        this.sql.exec("UPDATE approvals SET status='failed',ssh_data=? WHERE id=? AND status='consumed'", JSON.stringify({ ...d, failure }), a.id);
        this.sql.exec('UPDATE approvals SET ssh_data=? WHERE id=?', JSON.stringify({ ...d, failure, closure_pending: true }), a.id);
        touchTask(this, d.task);
        for (const s of r.sessions || []) if (s.requestId === d.requestId && s.task === d.task && s.turn === d.turn) {
          closedAck(await nativeBroker(this.env, own.tenant, own.channel).closeSsh({ ...own, task: d.task, turn: d.turn }, { session: s.id }));
          s.state = 'closed';
        }
        this.sql.exec('UPDATE approvals SET ssh_data=? WHERE id=?', JSON.stringify({ ...d, failure, closure_pending: false }), a.id);
        errors.push({ approval_id: a.id, error: failure });
      }
      const tailscale = publicTailnet(r.tailscale, includeLoginUrl);
      const available = guard.guarded && r.available !== false && r.ok !== false;
      const sessions = (r.sessions || []).map(s => ({ id: s.id, destination: s.destination || s.host, port: s.port, username: s.username || s.user, route: s.route, state: s.state, expires_at: s.expires_at, idle_timeout_ms: s.idle_timeout_ms }));
      const client = { state: ['verified_ready','sleeping','error'].includes(r.client?.state) ? r.client.state : 'unverified', ...(r.client?.implementation ? { implementation: safeText(r.client.implementation) } : {}), ...(r.client?.version ? { version: safeText(r.client.version) } : {}) };
      const trusted_servers = (r.trusted_servers || []).map(s=>({id:s.id,destination:s.destination,address:s.address,port:s.port,username:s.username,route:s.route,fingerprint:s.fingerprint,created_at:s.created_at,...(s.state==='revocation_pending'?{state:s.state}:{})}));
      return { ok: r.ok !== false, available, permission: p.mode, client, key: publicKey(r.key), sessions, trusted_servers, tailscale, ...(r.error ? { error: safeText(r.error) } : {}),
        ...(!guard.guarded ? { error: 'The previous computer instance must restart with Sentinel before native SSH is ready.' } : {}), ...(errors.length ? { setup_errors: errors } : {}) };
    } catch { return { ...safeError(), available: false, permission: p.mode, key: null, sessions: [], tailscale: { state: 'error' } }; }
  },
  async nativeAct(a = {}) {
    if (!nativeAvailable(this.env) && !(this.env.NATIVE_TRANSPORT && ['terminate','tailscale_disconnect'].includes(a.op))) return unavailable();
    const own = owner(this), b = nativeBroker(this.env, own.tenant, own.channel);
    try {
      if (a.op === 'key') return identityView(await b.identity(own));
      if (a.op === 'rotate_key') { if (a.confirm !== true) return { error: 'Confirm rotation: install the replacement public key on your servers. Existing managed sessions will close.' }; await this.nativeInvalidate('SSH identity rotated', true); return identityView(await b.rotateIdentity(own)); }
      if (a.op === 'tailscale_connect') { const r = await b.tailscaleConnect(own); return { ok: r.ok !== false, ...publicTailnet(r, true) }; }
      if (a.op === 'tailscale_disconnect') { await this.nativeCancel(null, 'Tailscale disconnected', 'tailnet'); return await b.tailscaleDisconnect(own); }
      if (a.op === 'revoke_trust') {
        const saved = (await b.trustedServers(own)).find(s=>s.id === a.trust_id);
        if (!saved) return {ok:false,error:'No such trusted server.'};
        const cancelMatching = () => { for (const row of this.sql.exec("SELECT * FROM approvals WHERE perm IN ('ssh','ssh_hostkey') AND status IN ('pending','consumed')").toArray()) {
          const d=parse(row.ssh_data);
          if (d.host === saved.destination && d.port === saved.port && d.user === saved.username && d.route === saved.route) {
            this.sql.exec("UPDATE approvals SET status='cancelled',decision='deny',decided_at=? WHERE id=?",Date.now(),row.id);touchTask(this,d.task);
          }
        } };
        cancelMatching();
        const result=closedAck(await b.revokeTrust(own,a.trust_id));
        cancelMatching();
        for (const id of result.closed_sessions || []) this.sql.exec("UPDATE native_sessions SET status='closed' WHERE id=?",id);
        return {ok:true,closed_sessions:result.closed_sessions || []};
      }
      if (a.op === 'terminate') { const session = String(a.session_id || ''); const s = this.sql.exec('SELECT * FROM native_sessions WHERE id=?', session).toArray()[0]; if (!s) return { error: 'No such managed session.' }; const r = closedAck(await b.closeSsh({ ...own, task: s.task, turn: s.turn }, { session })); this.sql.exec("UPDATE native_sessions SET status='closed' WHERE id=?", session); return r; }
      return { error: 'Unknown network operation.' };
    } catch { return safeError(); }
  },
  // A worker's SSH sessions end with the worker (approved, failed or stopped).
  async nativeCloseHelper(helper) {
    const rows = this.sql.exec("SELECT * FROM native_sessions WHERE status='active' AND helper=?", Number(helper)).toArray();
    if (this.env.NATIVE_TRANSPORT) { const own = owner(this), b = nativeBroker(this.env, own.tenant, own.channel); for (const s of rows) closedAck(await b.closeSsh({ ...own, task: s.task, turn: s.turn }, { session: s.id })); }
    for (const s of rows) this.sql.exec("UPDATE native_sessions SET status='closed' WHERE id=?", s.id);
    return { ok: true, closed: rows.length };
  },
  async nativeCancel(task = null, reason = 'Task stopped', route = null) {
    const rows = this.sql.exec("SELECT * FROM approvals WHERE perm IN ('ssh','ssh_hostkey') AND status IN ('pending','consumed')").toArray();
    for (const a of rows) { const d = parse(a.ssh_data); if ((!task || d.task === task) && (!route || d.route === route)) { this.sql.exec("UPDATE approvals SET status='cancelled',decision='deny',decided_at=? WHERE id=?", Date.now(), a.id); touchTask(this, d.task); } }
    const sessions = this.sql.exec("SELECT * FROM native_sessions WHERE status='active'").toArray().filter(s => (!task || s.task === task) && (!route || s.route === route));
    if (this.env.NATIVE_TRANSPORT) {
      const own = owner(this), b = nativeBroker(this.env, own.tenant, own.channel);
      // Also cancels a concurrently opening transport that has not returned its id.
      if (task) closedAck(await b.cancelTask(own, { task }));
      else if (!route) closedAck(await b.closeAll(own));
      for (const s of sessions) closedAck(await b.closeSsh({ ...own, task: s.task, turn: s.turn }, { session: s.id }));
    }
    for (const s of sessions) this.sql.exec("UPDATE native_sessions SET status='closed' WHERE id=?", s.id);
    return { ok: true, reason };
  },
  async nativeInvalidate(reason, close = true) {
    if (close) return await this.nativeCancel(null, reason);
    for (const a of this.sql.exec("SELECT session FROM approvals WHERE perm IN ('ssh','ssh_hostkey') AND status IN ('pending','consumed')").toArray()) touchTask(this, a.session);
    this.sql.exec("UPDATE approvals SET status='cancelled',decision='deny',decided_at=? WHERE perm IN ('ssh','ssh_hostkey') AND status IN ('pending','consumed')", Date.now());
    return { ok: true };
  },
});
