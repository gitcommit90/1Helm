// node --import ./test/stubs/register.mjs test/settings-defaults.test.mjs
// The Captain's settings defaults ("default to everything, protections get turned on"), one place that checks each one for an
// account that never set anything.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Resident } from '../src/resident.js'; // initialize the existing module cycle in production order
import { Ledger } from '../src/index.js';
import { permsApi } from '../src/perms.js';
import { CHECKIN_DEFAULTS, loadCheckins } from '../src/agent-checkins.js';
import { DEFAULT_PREFS, getPrefs } from '../src/notify.js';
import { sshPermission } from '../src/native-network.js';
const db = new DatabaseSync(':memory:');
for (const file of ['fixtures/migrations/migrations_028_permissions.sql', 'fixtures/migrations/migrations_048_direct_network.sql', 'fixtures/migrations/migrations_050_ssh_trusted.sql', 'fixtures/migrations/migrations_051_agent_checkins.sql', 'fixtures/migrations/migrations_065_checkin_enabled.sql']) db.exec(readFileSync(new URL('./' + file, import.meta.url), 'utf8'));
for (const file of ['db/migrations/0018_027_notif_reports.sql', 'db/migrations/0039_047_meetings.sql']) db.exec(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
const DB = { prepare(q) { const stmt = db.prepare(q); let args = []; const st = { bind(...a) { args = a; return st; }, async first() { return stmt.get(...args) || null; }, async all() { return { results: stmt.all(...args) }; }, async run() { return stmt.run(...args); } }; return st; } };
const env = { DB };
// 1. Pause to check spending: off.
const sql = { exec(q, ...a) { if (!a.length && q.split(';').filter(x => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows, one: () => rows[0] }; } };
const ledger = new Ledger({ storage: { sql, transactionSync: f => f() } }, {});
assert.equal(ledger.spendPreferences().enabled, false, 'Pause to check spending is off by default');
// 2. Show estimated costs: off (the tenants column default).
const mig = readFileSync(new URL('../db/migrations/0033_041_show_costs.sql', import.meta.url), 'utf8');
assert.match(mig, /show_costs INTEGER NOT NULL DEFAULT 0/);
// 3. Permission level: Standard.
const perms = await (await permsApi(new Request('https://selfhost.example/api/permissions'), env, { id: 'new' }, { channels: async () => [] })).json();
assert.equal(perms.level, 'standard');
// 4. Agent check-ins: off; on means 50 tool calls before the first update and 20 within 60 seconds.
assert.deepEqual(await loadCheckins(env, 'new'), { enabled: false, silent: 50, fast: 20 });
assert.deepEqual(CHECKIN_DEFAULTS, { enabled: false, silent: 50, fast: 20 });
assert.deepEqual(perms.agent_checkins, CHECKIN_DEFAULTS);
// 5. Direct network protocols: Deny.
assert.equal(perms.direct_protocols.ssh, 'deny'); assert.equal((await sshPermission(env, 'new')).mode, 'deny');
// 6. Notifications: every switch on when the account has no saved choice; a saved choice stays.
assert.deepEqual(await getPrefs(env, 'new'), { needs: true, finished: true, sound: true, needs_text: true, meetings: true });
assert.deepEqual(DEFAULT_PREFS, { needs: true, finished: true, sound: true, needs_text: true, meetings: true });
db.prepare('INSERT INTO notif_prefs (tenant_id,needs,finished,sound,needs_text,meetings,updated_at) VALUES (?,?,?,?,?,?,?)').run('chose', 0, 1, 1, 1, 0, 1);
assert.deepEqual(await getPrefs(env, 'chose'), { needs: false, finished: true, sound: true, needs_text: true, meetings: false });
console.log('PASS settings defaults for an account that never set anything');
