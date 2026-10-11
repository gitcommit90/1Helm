// PayPal is S2S OAuth: its client credentials belong to the customer's auth
// config, NOT to a shared project config or the hosted account-entry form.
// Only this secure, human-operated page accepts them. No agent/chat/vault copy.
import { composioRequest, isUnknownOutcome } from './composio-api.js';
import { appsMode } from './composio-self.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEADERS = { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' };
const failed = "PayPal couldn't be connected. Check that the Client ID and Client Secret belong to the selected environment.";
const unknown = "This connection attempt hasn't been confirmed. Check Connected apps before starting another attempt. Your credentials have not been resubmitted.";
export function paypalSetupUrl(callbackUrl) {
  const u = new URL(callbackUrl);
  if (u.protocol !== 'https:' || !/^\/w\/[a-z0-9-]+\/apps\/done$/.test(u.pathname)) throw new Error("PayPal can't be connected from this page.");
  u.pathname = u.pathname.replace(/\/done$/, '/paypal/setup');
  return u.href;
}
export function paypalSetupPage(t, action, id = '', message = '', status = 200) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect PayPal · 1Helm</title><style>body{font:16px/1.5 system-ui;background:#f3f2ef;color:#20201e;margin:0;padding:24px}main{max-width:460px;margin:5vh auto;background:white;padding:28px;border-radius:20px}label{display:block;margin-top:18px;font-weight:600}input,select,button{box-sizing:border-box;font:inherit;width:100%;padding:12px;margin-top:6px;border:1px solid #aaa;border-radius:8px}button{margin:24px 0;background:#242822;color:white;cursor:pointer}p{color:#555}a{color:inherit}.error{color:#9b2020}</style></head><body><main><h1>Connect PayPal</h1>${message ? `<p role="alert" class="error">${esc(message)}</p>` : ''}${id ? `<p>Use the Client ID and Client Secret from your PayPal developer app. Live and Sandbox credentials are different.</p><form method="post" action="${esc(action)}" autocomplete="off"><input type="hidden" name="operation" value="${esc(id)}"><label for="region">Environment</label><select id="region" name="region" required><option value="" selected disabled>Choose Live or Sandbox</option><option value="live">Live</option><option value="sandbox">Sandbox (test account)</option></select><label for="client_id">Client ID</label><input id="client_id" name="client_id" type="password" required maxlength="2048" autocomplete="off" spellcheck="false"><label for="client_secret">Client Secret</label><input id="client_secret" name="client_secret" type="password" required maxlength="2048" autocomplete="new-password" spellcheck="false"><p>1Helm securely passes these credentials to Composio to connect only your account. They aren't added to chat or shared with your helper.</p><button type="submit">Continue to connect</button></form>` : ''}<a href="/w/${esc(t.slug)}/app?settings=accounts">Back to Connected apps</a></main></body></html>`;
  return new Response(body, { status, headers: HEADERS });
}
const html = paypalSetupPage;
async function ensure(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS paypal_setup (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'new', config_id TEXT, account_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)").run();
}
const update = (env, tid, id, state) => env.DB.prepare('UPDATE paypal_setup SET state=?,updated_at=? WHERE tenant_id=? AND id=?').bind(state, Date.now(), tid, id).run();

export async function paypalSetupRoute(req, env, t) {
  const u = new URL(req.url), action = u.pathname + u.search;
  if (req.method !== 'GET' && req.method !== 'POST') return html(t, action, '', 'Method not allowed.', 405);
  if (u.protocol !== 'https:' || req.headers.get('sec-fetch-site') === 'cross-site' || (req.method === 'POST' && req.headers.get('origin') !== u.origin)) return html(t, action, '', 'Open this page from your own 1Helm account.', 403);
  if (await appsMode(env, t.id) !== 'managed') return html(t, action, '', 'Connect PayPal through your own Composio account in Self-managed mode.', 409);
  await ensure(env);
  if (req.method === 'GET') {
    await env.DB.prepare("DELETE FROM paypal_setup WHERE tenant_id=? AND state='new' AND created_at<?").bind(t.id, Date.now() - 20 * 60e3).run();
    const id = crypto.randomUUID(), now = Date.now();
    await env.DB.prepare('INSERT INTO paypal_setup (id,tenant_id,created_at,updated_at) VALUES (?,?,?,?)').bind(id, t.id, now, now).run();
    return html(t, action, id);
  }
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers.get('content-type') || '')) return html(t, action, '', 'Use the secure connection form.', 415);
  // Stream bound, not merely Content-Length (which can be absent or dishonest).
  const reader = req.body?.getReader(); if (!reader) return html(t, action, '', 'Complete the connection form.', 400);
  const chunks = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16000) { await reader.cancel(); return html(t, action, '', 'The submitted credentials are too long.', 413); } chunks.push(value); }
  const data = new URLSearchParams(await new Blob(chunks).text()), id = data.get('operation') || '';
  const valid = (s) => typeof s === 'string' && s.length > 0 && s.length <= 2048 && !/\s/.test(s);
  const client_id = data.get('client_id'), client_secret = data.get('client_secret'), region = data.get('region');
  if (!valid(client_id) || !valid(client_secret) || !['live', 'sandbox'].includes(region)) return html(t, action, '', 'Enter both credentials and choose Live or Sandbox. Go back and reopen Add key to try again.', 400);
  const claimed = await env.DB.prepare("UPDATE paypal_setup SET state='creating',updated_at=? WHERE id=? AND tenant_id=? AND state='new' AND created_at>?").bind(Date.now(), id, t.id, Date.now() - 20 * 60e3).run();
  if (!claimed.meta?.changes) return html(t, action, '', 'This form has expired or was already submitted. Check Connected apps before opening another form.', 409);
  let phase = 'creating';
  try {
    const d = await composioRequest(env, '/auth_configs', { method: 'POST', body: JSON.stringify({ toolkit: { slug: 'paypal' }, auth_config: { name: `1helm-paypal-${id}`, type: 'use_custom_auth', authScheme: 'S2S_OAUTH2', credentials: { client_id, client_secret, region } } }) });
    phase = 'created';
    const configId = d.auth_config?.id;
    if (!configId) { await update(env, t.id, id, 'unknown'); return html(t, action, '', unknown, 502); }
    await env.DB.prepare("UPDATE paypal_setup SET config_id=?,state='linking',updated_at=? WHERE id=? AND tenant_id=?").bind(configId, Date.now(), id, t.id).run();
    const callback = new URL(u); callback.pathname = `/w/${t.slug}/apps/done`; callback.searchParams.set('app', 'paypal');
    phase = 'linking';
    const link = await composioRequest(env, '/connected_accounts/link', { method: 'POST', body: JSON.stringify({ auth_config_id: configId, user_id: `1hc:${t.id}`, callback_url: callback.href }) });
    phase = 'linked';
    const dest = new URL(link.redirect_url);
    if (dest.protocol !== 'https:' || dest.hostname !== 'connect.composio.dev') throw new Error('Unexpected link');
    await env.DB.prepare("UPDATE paypal_setup SET account_id=?,state='linked',updated_at=? WHERE id=? AND tenant_id=?").bind(link.connected_account_id || null, Date.now(), id, t.id).run();
    return new Response(null, { status: 303, headers: { location: dest.href, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  } catch (e) {
    // Provider errors may echo client credentials; never log or render them.
    const uncertain = isUnknownOutcome(e) || phase === 'created' || phase === 'linked';
    await update(env, t.id, id, uncertain ? 'unknown' : 'failed').catch(() => {});
    // Only our new, unused config can be removed. A lost link response may have
    // created an account, so unknown outcomes are reconciled on removal instead.
    if (!uncertain) await cleanupPaypal(env, t.id, { operation: id }).catch(() => {});
    return html(t, action, '', uncertain ? unknown : failed, 502);
  }
}

// Dedicated config ownership is recorded before any account-link request. Never
// reuse or delete a toolkit-wide config, and never assume a lost response failed.
export async function cleanupPaypal(env, tenantId, { accountId = '', configId = '', operation = '', all = false } = {}) {
  if (!env.DB) return 0;
  let rows;
  try { rows = (await env.DB.prepare("SELECT * FROM paypal_setup WHERE tenant_id=? AND state<>'deleted'").bind(tenantId).all()).results || []; }
  catch (e) { if (/no such table/i.test(e.message)) return 0; throw new Error('PayPal connection cleanup is unavailable.'); }
  rows = rows.filter((r) => all || (accountId && r.account_id === accountId) || (configId && r.config_id === configId) || (operation && r.id === operation));
  let count = 0;
  try {
    for (const row of rows) {
      let id = row.config_id;
      if (!id && ['creating', 'unknown'].includes(row.state)) {
        // Config creation can succeed even when its response was lost. Recover
        // only the exact random operation name; a human label is never ownership.
        let cursor = '', found = [];
        for (let page = 0; page < 20; page++) {
          const d = await composioRequest(env, `/auth_configs?toolkit_slug=paypal&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
          found.push(...(d.items || []).filter((a) => a.name === `1helm-paypal-${row.id}` && a.toolkit?.slug === 'paypal'));
          cursor = d.next_cursor || ''; if (!cursor) break;
        }
        if (cursor || found.length !== 1) throw new Error('Unresolved config creation');
        id = found[0].id;
        await env.DB.prepare('UPDATE paypal_setup SET config_id=?,updated_at=? WHERE tenant_id=? AND id=?').bind(id, Date.now(), tenantId, row.id).run();
      }
      if (!id) continue;
      // A config with any remaining account (including an unexpected foreign
      // account) must not be deleted. account disconnect/deletion removes first.
      let cursor = '';
      for (let page = 0; page < 20; page++) {
        const d = await composioRequest(env, `/connected_accounts?auth_config_ids=${encodeURIComponent(id)}&account_type=ALL&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        if ((d.items || []).some((a) => !['DELETED', 'REMOVED'].includes(String(a.status || '').toUpperCase()))) throw new Error('Config still in use');
        cursor = d.next_cursor || ''; if (!cursor) break;
      }
      if (cursor) throw new Error('Incomplete account listing');
      const d = await composioRequest(env, `/auth_configs/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch((e) => { if (e.httpStatus === 404) return { success: true }; throw e; });
      if (d.success !== true) throw new Error('Deletion not confirmed');
      await update(env, tenantId, row.id, 'deleted'); count++;
    }
    return count;
  } catch { throw new Error('PayPal connection cleanup is not confirmed yet. Please try again later.'); }
}
