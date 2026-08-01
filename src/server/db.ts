import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_SKILLS } from "./builtin-skills.ts";

export const UNIVERSAL_RESIDENT_SKILL_SLUGS = [
  "outcome-ownership", "blocker-resolution", "skipper-escalation", "capability-discovery",
  "durable-memory", "workspace-artifacts", "quality-verification",
] as const;

export const DATA_DIR = process.env.CTRL_DATA_DIR || join(process.cwd(), "data");
export const UPLOAD_DIR = join(DATA_DIR, "uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "ctrl-pane.db"));
db.function("sha256", { deterministic: true }, (value: unknown) => createHash("sha256").update(String(value ?? "")).digest("hex"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
  display TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'channel',
  topic TEXT NOT NULL DEFAULT '', created_by INTEGER, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members (channel_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (channel_id, user_id));
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL, parent_id INTEGER,
  user_id INTEGER, bot_id INTEGER, body TEXT NOT NULL DEFAULT '',
  reply_count INTEGER NOT NULL DEFAULT 0, last_reply INTEGER, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL, name TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'openai', created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chatgpt_sessions (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER);
CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '',
  provider_id INTEGER, model TEXT NOT NULL DEFAULT '', prompt TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS computers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bot_channels (bot_id INTEGER NOT NULL, channel_id INTEGER NOT NULL, PRIMARY KEY (bot_id, channel_id));
CREATE TABLE IF NOT EXISTS bot_computers (bot_id INTEGER NOT NULL, computer_id INTEGER NOT NULL, PRIMARY KEY (bot_id, computer_id));
  CREATE TABLE IF NOT EXISTS model_prefs (bot_id INTEGER NOT NULL, scope TEXT NOT NULL, scope_id TEXT NOT NULL, model TEXT NOT NULL, PRIMARY KEY (bot_id, scope, scope_id));
CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL DEFAULT 'My Workspace',
  terminals_enabled INTEGER NOT NULL DEFAULT 1, setup_complete INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_channel ON messages(channel_id, parent_id, id);
`);

export type Row = Record<string, unknown>;

export function q(sql: string, ...params: unknown[]): Row[] {
  return db.prepare(sql).all(...(params as never[])) as Row[];
}
export function q1(sql: string, ...params: unknown[]): Row | undefined {
  return db.prepare(sql).get(...(params as never[])) as Row | undefined;
}
export function run(sql: string, ...params: unknown[]): { lastInsertRowid: number; changes: number } {
  const r = db.prepare(sql).run(...(params as never[]));
  return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
}

/** Workspace names are capped by Unicode code points, never UTF-16 code units. */
export function normalizeWorkspaceName(value: unknown): string {
  return Array.from(String(value ?? "").trim()).slice(0, 100).join("").trim();
}

/** Personal #main is Skipper's protected authority channel. It deliberately
 * has no resident agent and can never host a resident as a thread guest. */
export function isMainChannel(channelId: number): boolean {
  return Boolean(q1(`SELECT 1 FROM channels WHERE id=? AND kind='channel' AND name='main'
    AND personal_main_owner_id IS NOT NULL AND status<>'deleted'`, channelId));
}

/** Synchronous transaction helper. Never await inside fn. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return salt.toString("hex") + ":" + hash.toString("hex");
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(pw, Buffer.from(saltHex, "hex"), 32);
  return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}
export const newToken = (): string => randomBytes(24).toString("hex");
export const now = (): number => Date.now();

const addColumn = (table: string, name: string, ddl: string): void => {
  const columns = q(`PRAGMA table_info(${table})`).map((column) => String(column.name));
  if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
};

const hostLabel = (url: string): string => { try { return new URL(url).host; } catch { return url || "provider"; } };
const providerKind = (url: string): string => /openrouter\.ai/i.test(url) ? "openrouter" : "openai";

/** Additive migrations keep the legacy bot runtime usable while agents become canonical. */
export function migrate(): void {
  addColumn("bots", "provider_id", "provider_id INTEGER");
  addColumn("channels", "purpose", "purpose TEXT NOT NULL DEFAULT ''");
  addColumn("channels", "status", "status TEXT NOT NULL DEFAULT 'active'");
  addColumn("channels", "slug", "slug TEXT NOT NULL DEFAULT ''");
  addColumn("channels", "personal_main_owner_id", "personal_main_owner_id INTEGER");
  addColumn("workspace", "default_provider_id", "default_provider_id INTEGER");
  addColumn("workspace", "default_model", "default_model TEXT NOT NULL DEFAULT ''");
  addColumn("workspace", "photo_mime", "photo_mime TEXT NOT NULL DEFAULT ''");
  addColumn("workspace", "theme", "theme TEXT NOT NULL DEFAULT 'graphite'");
  addColumn("attachments", "workspace_path", "workspace_path TEXT NOT NULL DEFAULT ''");
  db.exec(`
  CREATE TABLE IF NOT EXISTS agent_turns (
    id INTEGER PRIMARY KEY,
    bot_id INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    trigger_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    thread_root_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('queued','running','waiting','completed','failed','stopped','cancelled')),
    writer_generation INTEGER NOT NULL DEFAULT 0,
    fresh INTEGER NOT NULL DEFAULT 0,
    escalation_id INTEGER REFERENCES escalations(id) ON DELETE SET NULL,
    host_authorized INTEGER NOT NULL DEFAULT 0,
    queued_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    error TEXT NOT NULL DEFAULT '',
    final_body_hash TEXT NOT NULL DEFAULT '',
    UNIQUE (bot_id, channel_id, thread_root_id, trigger_id)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_turns_lane ON agent_turns(bot_id,channel_id,thread_root_id,state,queued_at,id);
  CREATE INDEX IF NOT EXISTS idx_agent_turns_agent_state ON agent_turns(agent_id,state);
  CREATE TABLE IF NOT EXISTS transcript_memory_index (
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    memory_id TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    indexed_at INTEGER NOT NULL,
    PRIMARY KEY (agent_id,message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_transcript_memory_message ON transcript_memory_index(message_id);
  CREATE TABLE IF NOT EXISTS user_routing_endpoints (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    port INTEGER NOT NULL UNIQUE,
    internal_key TEXT NOT NULL UNIQUE,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_model_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_routing_keys (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_routing_keys_owner ON user_routing_keys(user_id,created DESC);
  CREATE TABLE IF NOT EXISTS routing_usage_events (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    status INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    detail TEXT NOT NULL DEFAULT '{}',
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_routing_usage_user_created ON routing_usage_events(user_id,created DESC);
  `);
  addColumn("agent_turns", "final_body_hash", "final_body_hash TEXT NOT NULL DEFAULT ''");
  addColumn("agent_turns", "requested_model", "requested_model TEXT NOT NULL DEFAULT ''");
  addColumn("agent_turns", "requested_provider_id", "requested_provider_id INTEGER");
  addColumn("agent_turns", "model_source", "model_source TEXT NOT NULL DEFAULT ''");
  addColumn("agent_turns", "request_user_id", "request_user_id INTEGER");
  addColumn("workspace", "installation_id", "installation_id TEXT NOT NULL DEFAULT ''");
  addColumn("workspace", "collaboration_enabled", "collaboration_enabled INTEGER NOT NULL DEFAULT 0");
  addColumn("workspace", "collaboration_slug", "collaboration_slug TEXT NOT NULL DEFAULT ''");
  addColumn("workspace", "collaboration_hostname", "collaboration_hostname TEXT NOT NULL DEFAULT ''");
  addColumn("workspace", "collaboration_status", "collaboration_status TEXT NOT NULL DEFAULT 'off'");
  addColumn("workspace", "collaboration_error", "collaboration_error TEXT NOT NULL DEFAULT ''");
  addColumn("workspace", "accept_new_requests", "accept_new_requests INTEGER NOT NULL DEFAULT 1");
  addColumn("users", "email", "email TEXT NOT NULL DEFAULT ''");
  addColumn("messages", "system_message", "system_message INTEGER NOT NULL DEFAULT 0");

  // A prerelease branch used bot-scoped skill/improvement schemas under the
  // same table names. Preserve those rows and migrate them into the canonical
  // durable-agent schema instead of failing startup on an existing workspace.
  const tableColumns = (table: string): string[] => q(`PRAGMA table_info(${table})`).map((column) => String(column.name));
  if (tableColumns("skills").length && !tableColumns("skills").includes("status") && !tableColumns("skills_legacy_v1").length) db.exec("ALTER TABLE skills RENAME TO skills_legacy_v1");
  if (tableColumns("agent_improvements").length && !tableColumns("agent_improvements").includes("agent_id") && !tableColumns("agent_improvements_legacy_v1").length) db.exec("ALTER TABLE agent_improvements RENAME TO agent_improvements_legacy_v1");

  db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY,
    bot_id INTEGER UNIQUE REFERENCES bots(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('skipper','channel')),
    name TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('provisioning','ready','working','waiting','paused','archived','deleted')),
    provider_inherited INTEGER NOT NULL DEFAULT 1,
    created INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_skipper_singleton ON agents(kind) WHERE kind='skipper' AND status<>'deleted';
  CREATE TABLE IF NOT EXISTS agent_channels (
    agent_id INTEGER NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
    bound_at INTEGER NOT NULL,
    PRIMARY KEY (agent_id, channel_id)
  );
  CREATE TABLE IF NOT EXISTS agent_profiles (
    agent_id INTEGER PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    workspace_ref TEXT NOT NULL DEFAULT '',
    memory_namespace TEXT NOT NULL DEFAULT '',
    capability_policy TEXT NOT NULL DEFAULT '{}',
    updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_capabilities (
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    capability TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    granted_by INTEGER,
    created INTEGER NOT NULL,
    PRIMARY KEY (agent_id, capability)
  );
  CREATE TABLE IF NOT EXISTS channel_workspaces (
    channel_id INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    root_ref TEXT NOT NULL UNIQUE,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY,
    root_message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting','resolved','failed','archived')),
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    opened_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS thread_summaries (
    id INTEGER PRIMARY KEY,
    thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memory_items (
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('summary','decision','fact','preference','artifact_ref')),
    content TEXT NOT NULL,
    source_message_id INTEGER,
    author_type TEXT NOT NULL CHECK (author_type IN ('human','agent','skipper','system')),
    scope TEXT NOT NULL CHECK (scope IN ('thread','channel','workspace')),
    status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded')),
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_channel ON memory_items(channel_id, status, created DESC);
  CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'file',
    created_by TEXT NOT NULL DEFAULT 'agent',
    size INTEGER NOT NULL DEFAULT 0,
    modified INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL,
    UNIQUE(channel_id, path)
  );
  CREATE TABLE IF NOT EXISTS tool_actions (
    id INTEGER PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL,
    tool TEXT NOT NULL,
    input_summary TEXT NOT NULL DEFAULT '',
    result_summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_actions_thread ON tool_actions(thread_id, created DESC);
  CREATE TABLE IF NOT EXISTS escalations (
    id INTEGER PRIMARY KEY,
    thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    from_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','failed')),
    resolved_by INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channel_activity (
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL,
    action_id INTEGER REFERENCES tool_actions(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'complete',
    actor_type TEXT NOT NULL DEFAULT 'system',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    instructions TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'shipped',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_skills (
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    provisioned_by INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    permanent INTEGER NOT NULL DEFAULT 1,
    created INTEGER NOT NULL,
    PRIMARY KEY (agent_id, skill_id)
  );
  CREATE TABLE IF NOT EXISTS skill_proposals (
    id INTEGER PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
    thread_id INTEGER REFERENCES threads(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','declined')),
    resulting_skill_id INTEGER REFERENCES skills(id) ON DELETE SET NULL,
    created INTEGER NOT NULL,
    reviewed INTEGER
  );
  CREATE TABLE IF NOT EXISTS skill_catalog_state (
    source TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT '',
    refreshed_at INTEGER NOT NULL DEFAULT 0,
    skill_count INTEGER NOT NULL DEFAULT 0,
    index_sha256 TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS skill_catalog_installs (
    identifier TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    trust_level TEXT NOT NULL,
    repo TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    revision TEXT NOT NULL DEFAULT '',
    content_sha256 TEXT NOT NULL DEFAULT '',
    scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','blocked')),
    scan_findings TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','installed','quarantined','removed')),
    skill_id INTEGER REFERENCES skills(id) ON DELETE SET NULL,
    installed_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS photon_channel_mappings (
    channel_id INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    allowed_users TEXT NOT NULL DEFAULT '[]',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS photon_messages (
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    body TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_photon_external ON photon_messages(external_id) WHERE external_id<>'';
  CREATE INDEX IF NOT EXISTS idx_photon_channel_time ON photon_messages(channel_id,received_at DESC);
  CREATE TABLE IF NOT EXISTS photon_conversations (
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    space_id TEXT NOT NULL,
    root_message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    started INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    closed INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_photon_conversation_active
    ON photon_conversations(channel_id,sender) WHERE active=1;
  CREATE INDEX IF NOT EXISTS idx_photon_conversation_history
    ON photon_conversations(channel_id,sender,started DESC);
  INSERT INTO photon_conversations
    (channel_id,sender,space_id,root_message_id,thread_id,active,started,updated)
  SELECT pm.channel_id,pm.sender,pm.space_id,COALESCE(m.parent_id,m.id),t.id,1,m.created,pm.received_at
  FROM photon_messages pm
  JOIN messages m ON m.id=pm.message_id AND m.channel_id=pm.channel_id
  JOIN threads t ON t.root_message_id=COALESCE(m.parent_id,m.id) AND t.channel_id=pm.channel_id
  WHERE pm.direction='inbound'
    AND lower(trim(pm.body))<>'/new'
    AND NOT EXISTS (
      SELECT 1 FROM photon_conversations pc
      WHERE pc.channel_id=pm.channel_id AND pc.sender=pm.sender
    )
    AND NOT EXISTS (
      SELECT 1 FROM photon_messages newer
      WHERE newer.channel_id=pm.channel_id AND newer.sender=pm.sender AND newer.direction='inbound'
        AND (newer.received_at>pm.received_at OR (newer.received_at=pm.received_at AND newer.id>pm.id))
    );
  CREATE TABLE IF NOT EXISTS connector_deliveries (
    id INTEGER PRIMARY KEY,
    connector TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    destination TEXT NOT NULL,
    body TEXT NOT NULL,
    source_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','attempting','delivered','failed','uncertain')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    external_id TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_connector_deliveries_state ON connector_deliveries(connector,state,created,id);
  CREATE TABLE IF NOT EXISTS feedback_reports (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    comment TEXT NOT NULL,
    diagnostics TEXT NOT NULL DEFAULT '{}',
    send_diagnostics INTEGER NOT NULL DEFAULT 1 CHECK (send_diagnostics IN (0,1)),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','delivered','failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    remote_id TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_reports_state ON feedback_reports(state,created,id);
  CREATE TABLE IF NOT EXISTS feedback_attachments (
    id INTEGER PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES feedback_reports(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_templates (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    purpose_hint TEXT NOT NULL,
    instructions TEXT NOT NULL,
    skill_slugs TEXT NOT NULL DEFAULT '[]',
    icon TEXT NOT NULL DEFAULT 'helm',
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS agent_improvements (
    id INTEGER PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    instruction TEXT NOT NULL DEFAULT '',
    source_message_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    sequence INTEGER PRIMARY KEY,
    source_table TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    channel_id INTEGER,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created INTEGER NOT NULL,
    previous_hash TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE
  );
  CREATE INDEX IF NOT EXISTS idx_audit_channel_sequence ON audit_events(channel_id,sequence);
  CREATE TABLE IF NOT EXISTS agent_workflows (
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 60 AND 31536000),
    next_run INTEGER NOT NULL,
    last_run INTEGER,
    last_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    run_count INTEGER NOT NULL DEFAULT 0,
    max_runs INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','complete','failed')),
    last_error TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_workflows_due ON agent_workflows(status,next_run);
  CREATE TABLE IF NOT EXISTS improvement_checkpoints (
    agent_id INTEGER PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    last_message_id INTEGER NOT NULL DEFAULT 0,
    last_run INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS thread_agent_guests (
    thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    invited_by INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
    created INTEGER NOT NULL,
    PRIMARY KEY (thread_id, agent_id)
  );
  CREATE TABLE IF NOT EXISTS workspace_domains (
    id INTEGER PRIMARY KEY,
    hostname TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL DEFAULT 'cloudflare' CHECK (provider='cloudflare'),
    status TEXT NOT NULL DEFAULT 'connecting' CHECK (status IN ('connecting','active','error')),
    tunnel_id TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    verified INTEGER,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS access_requests (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    display TEXT NOT NULL DEFAULT '',
    request_token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','claimed')),
    requested_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    claimed_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_pending_email
    ON access_requests(lower(email)) WHERE status IN ('pending','approved');
  CREATE TRIGGER IF NOT EXISTS trg_agent_channel_ordinary
  BEFORE INSERT ON agent_channels
  WHEN (SELECT kind FROM channels WHERE id=NEW.channel_id) <> 'channel'
  BEGIN SELECT RAISE(ABORT, 'resident agents bind only to ordinary channels'); END;
  CREATE TRIGGER IF NOT EXISTS trg_agent_channel_no_skipper
  BEFORE INSERT ON agent_channels
  WHEN (SELECT kind FROM agents WHERE id=NEW.agent_id) = 'skipper'
  BEGIN SELECT RAISE(ABORT, 'skipper is workspace-level'); END;
  CREATE TRIGGER IF NOT EXISTS trg_agent_channel_immutable
  BEFORE UPDATE ON agent_channels
  BEGIN SELECT RAISE(ABORT, 'agent-channel binding is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS trg_agent_channel_compat
  AFTER INSERT ON agent_channels
  BEGIN
    INSERT OR IGNORE INTO bot_channels (bot_id, channel_id)
    SELECT bot_id, NEW.channel_id FROM agents WHERE id=NEW.agent_id AND bot_id IS NOT NULL;
  END;
  `);
  // Photon is a private Captain ↔ Skipper inbox. Legacy channel mappings are
  // retained only long enough to migrate conversation history; they are no
  // longer a user-facing routing primitive.
  addColumn("messages", "photon_conversation_id", "photon_conversation_id INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_photon_conversation ON messages(photon_conversation_id,id)");
  const photonMain = q1(`SELECT c.id FROM channels c JOIN users u ON u.id=c.personal_main_owner_id
    WHERE c.kind='channel' AND c.name='main' AND c.status<>'deleted' AND u.is_admin=1
    ORDER BY c.id LIMIT 1`);
  if (photonMain?.id) {
    for (const sender of q("SELECT sender FROM photon_conversations WHERE active=1 GROUP BY sender HAVING COUNT(*)>1")) {
      const keep = q1("SELECT id FROM photon_conversations WHERE sender=? AND active=1 ORDER BY updated DESC,id DESC LIMIT 1", sender.sender);
      run("UPDATE photon_conversations SET active=0,closed=COALESCE(closed,updated) WHERE sender=? AND active=1 AND id<>?", sender.sender, keep?.id || 0);
    }
    for (const conversation of q("SELECT id,channel_id,root_message_id,thread_id FROM photon_conversations ORDER BY id")) {
      try {
        tx(() => {
          run("UPDATE messages SET channel_id=?,photon_conversation_id=? WHERE id=? OR parent_id=?", photonMain.id, conversation.id, conversation.root_message_id, conversation.root_message_id);
          run("UPDATE threads SET channel_id=? WHERE id=?", photonMain.id, conversation.thread_id);
          run("UPDATE agent_turns SET channel_id=? WHERE thread_root_id=?", photonMain.id, conversation.root_message_id);
          run("UPDATE memory_items SET channel_id=? WHERE thread_id=?", photonMain.id, conversation.thread_id);
          run("UPDATE channel_activity SET channel_id=? WHERE thread_id=?", photonMain.id, conversation.thread_id);
        });
      } catch {
        // Historical installations may have an in-flight agent_turn whose
        // trigger id uniqueness prevents rebinding. Keep the conversation in
        // its original world until the normal recovery pass settles the turn.
      }
    }
    run(`UPDATE photon_conversations SET channel_id=? WHERE NOT EXISTS (
      SELECT 1 FROM messages m WHERE m.id=photon_conversations.root_message_id AND m.channel_id<>?)`, photonMain.id, photonMain.id);
    run(`UPDATE photon_messages SET channel_id=(SELECT channel_id FROM photon_conversations pc
      WHERE pc.id=(SELECT photon_conversation_id FROM messages m WHERE m.id=photon_messages.message_id))
      WHERE message_id IS NOT NULL AND EXISTS (SELECT 1 FROM messages m WHERE m.id=photon_messages.message_id AND m.photon_conversation_id IS NOT NULL)`);
  }
  // The table survives only as a schema-compatibility tombstone. Photon no
  // longer has channel mappings: credentials identify one Captain and every
  // accepted turn goes directly to that Captain's Skipper Texts inbox.
  run("DELETE FROM photon_channel_mappings");
  db.exec("DROP INDEX IF EXISTS idx_photon_conversation_active");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_photon_conversation_active ON photon_conversations(sender) WHERE active=1");
  addColumn("agents", "provider_inherited", "provider_inherited INTEGER NOT NULL DEFAULT 1");
  addColumn("agents", "template_slug", "template_slug TEXT NOT NULL DEFAULT 'general'");
  addColumn("model_prefs", "provider_id", "provider_id INTEGER");
  db.exec(`
  CREATE TABLE IF NOT EXISTS agent_progress (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('thinking','tool','status')),
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','complete','failed')),
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_progress_message ON agent_progress(message_id, id);
  CREATE TABLE IF NOT EXISTS thread_mention_preferences (
    thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL,
    PRIMARY KEY (thread_id, user_id)
  );
  -- Per-user client layout (docked terminal open, preferred computer, etc.)
  CREATE TABLE IF NOT EXISTS user_ui_state (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '{}',
    updated INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  CREATE TABLE IF NOT EXISTS mobile_push_registrations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
    token TEXT NOT NULL,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    UNIQUE(platform,token)
  );
  CREATE INDEX IF NOT EXISTS idx_mobile_push_user ON mobile_push_registrations(user_id,platform);
  CREATE TABLE IF NOT EXISTS mobile_push_outbox (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    UNIQUE(user_id,message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_mobile_push_outbox_due ON mobile_push_outbox(state,next_attempt,id);
  `);
  // Per-thread rough model usage (sum of provider-reported prompt/completion tokens).
  addColumn("threads", "input_tokens", "input_tokens INTEGER NOT NULL DEFAULT 0");
  addColumn("threads", "output_tokens", "output_tokens INTEGER NOT NULL DEFAULT 0");
  addColumn("threads", "stopped_followup_pending", "stopped_followup_pending INTEGER NOT NULL DEFAULT 0");
  addColumn("messages", "stopped_followup", "stopped_followup INTEGER NOT NULL DEFAULT 0");
  addColumn("channel_activity", "action_id", "action_id INTEGER REFERENCES tool_actions(id) ON DELETE SET NULL");
  addColumn("channel_activity", "updated", "updated INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_activity_action ON channel_activity(action_id) WHERE action_id IS NOT NULL");
  addColumn("skills", "provenance_url", "provenance_url TEXT NOT NULL DEFAULT ''");
  addColumn("skills", "provenance_identifier", "provenance_identifier TEXT NOT NULL DEFAULT ''");
  addColumn("skills", "provenance_revision", "provenance_revision TEXT NOT NULL DEFAULT ''");
  addColumn("skills", "content_sha256", "content_sha256 TEXT NOT NULL DEFAULT ''");
  addColumn("skills", "trust_level", "trust_level TEXT NOT NULL DEFAULT 'workspace'");
  addColumn("skills", "scan_status", "scan_status TEXT NOT NULL DEFAULT 'clean'");
  addColumn("skills", "installed_at", "installed_at INTEGER NOT NULL DEFAULT 0");
  addColumn("users", "description", "description TEXT NOT NULL DEFAULT ''");
  addColumn("users", "job_title", "job_title TEXT NOT NULL DEFAULT ''");
  addColumn("users", "avatar", "avatar TEXT NOT NULL DEFAULT ''");
  addColumn("users", "tour_complete", "tour_complete INTEGER NOT NULL DEFAULT 0");
  // Existing workspaces are already onboarded; only the newly registered
  // Captain in a not-yet-complete workspace should receive the landing tour.
  if (q1("SELECT setup_complete FROM workspace WHERE id=1")?.setup_complete) run("UPDATE users SET tour_complete=1");

  // Structured agent interviews are first-class message metadata. They are
  // not parsed out of Markdown, so choices remain stable across model changes.
  db.exec(`
  CREATE TABLE IF NOT EXISTS agent_questions (
    id INTEGER PRIMARY KEY,
    message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','answered','cancelled')),
    created INTEGER NOT NULL,
    answered INTEGER
  );
  `);

  // Durable agent re-entry: models cannot promise "I'll update later" without this.
  db.exec(`
  CREATE TABLE IF NOT EXISTS agent_followups (
    id INTEGER PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    bot_id INTEGER NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    root_message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    due_at INTEGER NOT NULL,
    reason TEXT NOT NULL,
    check_hint TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 48,
    last_error TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_followups_due ON agent_followups(status, due_at);
  CREATE INDEX IF NOT EXISTS idx_followups_thread ON agent_followups(thread_id, status);
  CREATE TABLE IF NOT EXISTS channel_computers (
    channel_id INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    backend TEXT NOT NULL CHECK (backend IN ('apple','oci','native','mock')),
    machine_id TEXT NOT NULL UNIQUE,
    image TEXT NOT NULL DEFAULT '',
    desired_state TEXT NOT NULL DEFAULT 'auto' CHECK (desired_state IN ('auto','running','stopped','deleted')),
    observed_state TEXT NOT NULL DEFAULT 'unknown',
    cpus INTEGER NOT NULL,
    memory_bytes INTEGER NOT NULL,
    disk_bytes INTEGER NOT NULL DEFAULT 0,
    home_mount TEXT NOT NULL DEFAULT 'none' CHECK (home_mount='none'),
    provision_status TEXT NOT NULL DEFAULT 'pending' CHECK (provision_status IN ('pending','provisioning','ready','repairing','error','deleted')),
    maintenance_state TEXT NOT NULL DEFAULT 'idle',
    host_revision INTEGER NOT NULL DEFAULT 0,
    synced_host_revision INTEGER NOT NULL DEFAULT 0,
    guest_revision INTEGER NOT NULL DEFAULT 0,
    pressure_json TEXT NOT NULL DEFAULT '{}',
    low_pressure_streak INTEGER NOT NULL DEFAULT 0,
    last_update INTEGER NOT NULL DEFAULT 0,
    last_update_attempt INTEGER NOT NULL DEFAULT 0,
    last_health INTEGER NOT NULL DEFAULT 0,
    last_used INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_channel_computers_state ON channel_computers(desired_state, observed_state, provision_status);
  CREATE TRIGGER IF NOT EXISTS trg_channel_computer_ordinary
  BEFORE INSERT ON channel_computers
  WHEN (SELECT kind FROM channels WHERE id=NEW.channel_id) <> 'channel'
  BEGIN SELECT RAISE(ABORT, 'computers belong only to agent channels'); END;
  CREATE TABLE IF NOT EXISTS channel_computer_obligations (
    channel_id INTEGER NOT NULL REFERENCES channel_computers(channel_id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'resident' CHECK (mode IN ('resident','wakeable')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','satisfied','cancelled')),
    details TEXT NOT NULL DEFAULT '',
    due_at INTEGER,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    PRIMARY KEY (channel_id, kind, ref)
  );
  CREATE INDEX IF NOT EXISTS idx_computer_obligations_active ON channel_computer_obligations(channel_id, status, mode, due_at);
  CREATE TABLE IF NOT EXISTS channel_workspace_changes (
    channel_id INTEGER NOT NULL REFERENCES channel_computers(channel_id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert','delete','full')),
    created INTEGER NOT NULL,
    PRIMARY KEY (channel_id, relative_path)
  );
  `);
  // Append-only cryptographic continuity for the operational surfaces that
  // matter when reconstructing delegated work. SQLite triggers ensure events
  // are chained even when a future code path writes the source table directly.
  db.exec(`
  CREATE TRIGGER IF NOT EXISTS audit_channel_activity_insert AFTER INSERT ON channel_activity BEGIN
    INSERT INTO audit_events (source_table,source_id,channel_id,event_type,payload,created,previous_hash,hash)
    SELECT 'channel_activity',NEW.id,NEW.channel_id,'activity:' || NEW.kind,
      json_object('thread_id',NEW.thread_id,'summary',NEW.summary,'status',NEW.status,'actor_type',NEW.actor_type),NEW.created,
      COALESCE((SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1),''),
      sha256(COALESCE((SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1),'') || '|channel_activity|' || NEW.id || '|' || NEW.channel_id || '|activity:' || NEW.kind || '|' || json_object('thread_id',NEW.thread_id,'summary',NEW.summary,'status',NEW.status,'actor_type',NEW.actor_type) || '|' || NEW.created);
  END;
  CREATE TRIGGER IF NOT EXISTS audit_tool_action_insert AFTER INSERT ON tool_actions BEGIN
    INSERT INTO audit_events (source_table,source_id,channel_id,event_type,payload,created,previous_hash,hash)
    SELECT 'tool_actions',NEW.id,(SELECT channel_id FROM threads WHERE id=NEW.thread_id),'tool:' || NEW.tool,
      json_object('agent_id',NEW.agent_id,'thread_id',NEW.thread_id,'input_summary',NEW.input_summary,'status',NEW.status),NEW.created,
      COALESCE((SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1),''),
      sha256(COALESCE((SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1),'') || '|tool_actions|' || NEW.id || '|' || COALESCE((SELECT channel_id FROM threads WHERE id=NEW.thread_id),'') || '|tool:' || NEW.tool || '|' || json_object('agent_id',NEW.agent_id,'thread_id',NEW.thread_id,'input_summary',NEW.input_summary,'status',NEW.status) || '|' || NEW.created);
  END;
  CREATE TRIGGER IF NOT EXISTS audit_tool_action_update AFTER UPDATE OF status,result_summary ON tool_actions
    WHEN OLD.status<>NEW.status OR OLD.result_summary<>NEW.result_summary BEGIN
    INSERT INTO audit_events (source_table,source_id,channel_id,event_type,payload,created,previous_hash,hash)
    SELECT 'tool_actions',NEW.id,(SELECT channel_id FROM threads WHERE id=NEW.thread_id),'tool-result:' || NEW.tool,
      json_object('agent_id',NEW.agent_id,'thread_id',NEW.thread_id,'result_summary',NEW.result_summary,'status',NEW.status),CAST(unixepoch('subsec')*1000 AS INTEGER),
      COALESCE((SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1),''),
      sha256(COALESCE((SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1),'') || '|tool_actions|' || NEW.id || '|' || COALESCE((SELECT channel_id FROM threads WHERE id=NEW.thread_id),'') || '|tool-result:' || NEW.tool || '|' || json_object('agent_id',NEW.agent_id,'thread_id',NEW.thread_id,'result_summary',NEW.result_summary,'status',NEW.status) || '|' || CAST(unixepoch('subsec')*1000 AS INTEGER));
  END;
  CREATE TRIGGER IF NOT EXISTS audit_skill_install AFTER INSERT ON skill_catalog_installs BEGIN
    INSERT INTO audit_events (source_table,source_id,channel_id,event_type,payload,created,previous_hash,hash)
    SELECT 'skill_catalog_installs',NEW.rowid,NULL,'skill-install:' || NEW.status,
      json_object('identifier',NEW.identifier,'source',NEW.source,'trust_level',NEW.trust_level,'revision',NEW.revision,'content_sha256',NEW.content_sha256,'scan_status',NEW.scan_status,'scan_findings',NEW.scan_findings),NEW.installed_at,
      COALESCE((SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1),''),
      sha256(COALESCE((SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1),'') || '|skill_catalog_installs|' || NEW.rowid || '||skill-install:' || NEW.status || '|' || json_object('identifier',NEW.identifier,'source',NEW.source,'trust_level',NEW.trust_level,'revision',NEW.revision,'content_sha256',NEW.content_sha256,'scan_status',NEW.scan_status,'scan_findings',NEW.scan_findings) || '|' || NEW.installed_at);
  END;
  `);
  addColumn("channel_computers", "low_pressure_streak", "low_pressure_streak INTEGER NOT NULL DEFAULT 0");
  addColumn("channel_computers", "last_update", "last_update INTEGER NOT NULL DEFAULT 0");
  addColumn("channel_computers", "last_update_attempt", "last_update_attempt INTEGER NOT NULL DEFAULT 0");

  tx(() => {
    let installationId = String(q1("SELECT installation_id FROM workspace WHERE id=1")?.installation_id || "");
    if (!/^[a-f0-9]{16}$/.test(installationId)) {
      installationId = randomBytes(8).toString("hex");
      run("UPDATE workspace SET installation_id=? WHERE id=1", installationId);
    }
    if (tableColumns("skills_legacy_v1").length) {
      for (const skill of q("SELECT * FROM skills_legacy_v1")) run(`INSERT OR IGNORE INTO skills (id,slug,name,description,category,instructions,source,status,created,updated)
        VALUES (?,?,?,?,?,?,?,'active',?,?)`, skill.id, skill.slug, skill.name, skill.description, skill.category || "general", skill.instructions, skill.source || "migrated", skill.created, skill.updated);
    }
    run("UPDATE channels SET purpose=topic WHERE purpose='' AND topic<>''");
    const captain = q1("SELECT id FROM users WHERE is_admin=1 ORDER BY id LIMIT 1");
    const legacyMain = captain?.id
      ? q1(`SELECT id FROM channels WHERE kind='channel' AND name='main'
        AND (personal_main_owner_id=? OR personal_main_owner_id IS NULL)
        ORDER BY personal_main_owner_id IS NULL,id LIMIT 1`, captain.id)
      : q1("SELECT id FROM channels WHERE kind='channel' AND name='main' ORDER BY id LIMIT 1");
    if (captain?.id && legacyMain?.id) {
      run("UPDATE channels SET personal_main_owner_id=?,created_by=COALESCE(created_by,?) WHERE id=?", captain.id, captain.id, legacyMain.id);
      run("DELETE FROM members WHERE channel_id=? AND user_id<>?", legacyMain.id, captain.id);
      run("INSERT OR IGNORE INTO members (channel_id,user_id) VALUES (?,?)", legacyMain.id, captain.id);
    }
    for (const user of q(`SELECT id,username FROM users u WHERE NOT EXISTS (
      SELECT 1 FROM channels c WHERE c.personal_main_owner_id=u.id AND c.status<>'deleted') ORDER BY id`)) {
      const stem = String(user.username || `member-${user.id}`).toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `member-${user.id}`;
      let slug = Number(user.id) === Number(captain?.id) && !q1("SELECT 1 FROM channels WHERE slug='main' AND status<>'deleted'")
        ? "main"
        : `main-${stem}`.slice(0, 64);
      for (let suffix = 2; q1("SELECT 1 FROM channels WHERE slug=? AND status<>'deleted'", slug); suffix++) {
        slug = `main-${stem}`.slice(0, Math.max(1, 63 - String(suffix).length)) + `-${suffix}`;
      }
      const id = run(`INSERT INTO channels (name,slug,kind,topic,purpose,status,created_by,personal_main_owner_id,created)
        VALUES ('main',?,'channel','Your private home base with @skipper','Private coordination with Skipper','active',?,?,?)`, slug, user.id, user.id, now()).lastInsertRowid;
      run("INSERT OR IGNORE INTO members (channel_id,user_id) VALUES (?,?)", id, user.id);
    }
    const usedSlugs = new Set<string>();
    for (const channel of q("SELECT id, name, slug FROM channels ORDER BY id")) {
      let base = String(channel.slug || channel.name || `channel-${channel.id}`).trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || `channel-${channel.id}`;
      let slug = base;
      for (let suffix = 2; usedSlugs.has(slug); suffix++) slug = `${base.slice(0, 55 - String(suffix).length)}-${suffix}`;
      usedSlugs.add(slug);
      if (slug !== channel.slug) run("UPDATE channels SET slug=? WHERE id=?", slug, channel.id);
    }
    for (const bot of q("SELECT id, base_url, api_key FROM bots WHERE (provider_id IS NULL OR provider_id=0) AND base_url<>''")) {
      const base = String(bot.base_url), key = String(bot.api_key);
      const existing = q1("SELECT id FROM providers WHERE base_url=? AND api_key=?", base, key);
      const providerId = existing ? Number(existing.id)
        : run("INSERT INTO providers (name, base_url, api_key, kind, created) VALUES (?,?,?,?,?)", hostLabel(base), base, key, providerKind(base), now()).lastInsertRowid;
      run("UPDATE bots SET provider_id=? WHERE id=?", providerId, bot.id);
    }

    const main = q1(`SELECT c.id FROM channels c LEFT JOIN users u ON u.id=c.personal_main_owner_id
      WHERE c.kind='channel' AND c.name='main' ORDER BY u.is_admin DESC,c.id LIMIT 1`);
    run(`UPDATE bots SET avatar='color:#4F6D7A' WHERE avatar='' AND id IN (
      SELECT bot_id FROM agents WHERE kind='skipper' AND status<>'deleted')`);
    const migrationColors = ["#C8552F", "#2166B8", "#2E7D4F", "#8A6B7C", "#A67C52", "#4F6D7A", "#7A6A4F", "#64748B"];
    for (const resident of q(`SELECT b.id FROM bots b JOIN agents a ON a.bot_id=b.id
      WHERE a.kind='channel' AND a.status<>'deleted' AND b.avatar='' ORDER BY b.id`)) {
      run("UPDATE bots SET avatar=? WHERE id=?", `color:${migrationColors[Number(resident.id) % migrationColors.length]}`, resident.id);
    }
    if (main && !q1("SELECT 1 FROM agents WHERE kind='skipper' AND status<>'deleted'")) {
      let skipperBot = q1(`SELECT b.* FROM bots b JOIN bot_channels bc ON bc.bot_id=b.id
        WHERE bc.channel_id=? AND lower(b.name)='skipper' ORDER BY b.id LIMIT 1`, main.id);
      if (!skipperBot) {
        const workspace = q1("SELECT default_provider_id, default_model FROM workspace WHERE id=1");
        const botId = run("INSERT INTO bots (name, provider_id, model, prompt, avatar, base_url, api_key, created) VALUES ('skipper',?,?,?,'','','',?)",
          workspace?.default_provider_id ?? null, String(workspace?.default_model || ""), "Workspace-wide chief of staff and root operator.", now()).lastInsertRowid;
        run("INSERT OR IGNORE INTO bot_channels (bot_id, channel_id) VALUES (?,?)", botId, main.id);
        skipperBot = q1("SELECT * FROM bots WHERE id=?", botId)!;
      }
      run("INSERT INTO agents (bot_id, kind, name, display_name, status, created) VALUES (?,'skipper','skipper','Skipper','ready',?)", skipperBot.id, skipperBot.created || now());
    }

    for (const channel of q(`SELECT * FROM channels c WHERE c.kind='channel' AND c.name<>'main' AND c.personal_main_owner_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM agent_channels ac WHERE ac.channel_id=c.id) ORDER BY c.id`)) {
      let runtime = q1(`SELECT b.* FROM bots b JOIN bot_channels bc ON bc.bot_id=b.id
        WHERE bc.channel_id=? AND lower(b.name)<>'skipper' ORDER BY b.id LIMIT 1`, channel.id);
      let agent = runtime ? q1("SELECT * FROM agents WHERE bot_id=? AND kind='channel' AND status<>'deleted'", runtime.id) : undefined;
      const bound = agent ? q1("SELECT channel_id FROM agent_channels WHERE agent_id=?", agent.id) : undefined;
      if (runtime && bound) {
        const base = `${String(channel.name)}-agent`.slice(0, 56) || "channel-agent";
        let name = base;
        for (let suffix = 2; q1("SELECT 1 FROM bots WHERE lower(name)=lower(?)", name); suffix++) name = `${base}-${suffix}`;
        const model = String(q1("SELECT model FROM model_prefs WHERE bot_id=? AND scope='channel' AND scope_id=?", runtime.id, String(channel.id))?.model
          || q1("SELECT model FROM model_prefs WHERE bot_id=? AND scope='global' AND scope_id=''", runtime.id)?.model || runtime.model || "");
        const clonedId = run("INSERT INTO bots (name, provider_id, model, prompt, avatar, base_url, api_key, created) VALUES (?,?,?,?,?,?,?,?)",
          name, runtime.provider_id ?? null, model, runtime.prompt || "", runtime.avatar || "", runtime.base_url || "", runtime.api_key || "", now()).lastInsertRowid;
        runtime = q1("SELECT * FROM bots WHERE id=?", clonedId)!;
        agent = undefined;
      }
      if (!runtime) {
        const workspace = q1("SELECT default_provider_id, default_model FROM workspace WHERE id=1");
        const providerId = workspace?.default_provider_id ?? q1("SELECT id FROM providers ORDER BY id LIMIT 1")?.id ?? null;
        const name = `${String(channel.name)}-agent`.slice(0, 64);
        const botId = run("INSERT INTO bots (name, provider_id, model, prompt, avatar, base_url, api_key, created) VALUES (?,?,?,?,?,'','',?)",
          name, providerId, String(workspace?.default_model || ""), "You are this channel's resident specialist.", "", now()).lastInsertRowid;
        runtime = q1("SELECT * FROM bots WHERE id=?", botId)!;
      }
      const agentId = agent ? Number(agent.id) : run("INSERT INTO agents (bot_id, kind, name, display_name, status, created) VALUES (?,'channel',?,?, 'ready', ?)", runtime.id, runtime.name, runtime.name, runtime.created || now()).lastInsertRowid;
      run("INSERT INTO agent_channels (agent_id, channel_id, bound_at) VALUES (?,?,?)", agentId, channel.id, now());
    }

    // Ordinary channels gain a durable computer control-plane row. The OCI
    // architecture is intentionally a clean start: old runtime records are
    // neither converted nor imported here.
    const platformBackend = process.platform === "darwin" ? "apple" : "oci";
    const configuredBackend = String(process.env.HELM_CHANNEL_COMPUTER_BACKEND || platformBackend);
    const backend = ["apple", "oci", "native", "mock"].includes(configuredBackend) ? configuredBackend : platformBackend;
    const image = String(process.env.HELM_CHANNEL_MACHINE_IMAGE || "local/1helm-channel-machine:0.0.34");
    for (const channel of q(`SELECT c.id FROM channels c JOIN agent_channels ac ON ac.channel_id=c.id
      WHERE c.kind='channel' AND c.status<>'deleted'`)) {
      const channelId = Number(channel.id);
      run(`INSERT OR IGNORE INTO channel_computers
        (channel_id,backend,machine_id,image,desired_state,observed_state,cpus,memory_bytes,home_mount,provision_status,last_used,created,updated)
        VALUES (?,?,?,?,?,'unknown',2,2147483648,'none','pending',?,?,?)`,
      channelId, backend, `1helm-${installationId}-channel-${channelId}`, image,
      String(q1("SELECT status FROM channels WHERE id=?", channelId)?.status) === "archived" ? "stopped" : "auto",
      now(), now(), now());
      run("INSERT OR IGNORE INTO channel_workspace_changes (channel_id,relative_path,operation,created) VALUES (?,'*','full',?)", channelId, now());
    }
    run("DELETE FROM bot_computers WHERE bot_id IN (SELECT bot_id FROM agents WHERE kind='channel')");

    for (const unbound of q("SELECT id FROM agents WHERE kind='channel' AND NOT EXISTS (SELECT 1 FROM agent_channels WHERE agent_id=agents.id)")) {
      run("DELETE FROM agent_profiles WHERE agent_id=?", unbound.id);
      run("DELETE FROM agent_capabilities WHERE agent_id=?", unbound.id);
      run("DELETE FROM agents WHERE id=?", unbound.id);
    }
    // Native channels contain only workspace-wide Skipper plus their one
    // canonical resident. Preserve legacy bot records, but remove their old
    // channel memberships so they can never become ambient third agents.
    run(`DELETE FROM bot_channels WHERE channel_id IN (SELECT id FROM channels WHERE kind='channel')
      AND NOT EXISTS (
        SELECT 1 FROM agents a LEFT JOIN agent_channels ac ON ac.agent_id=a.id
        WHERE a.bot_id=bot_channels.bot_id AND a.status<>'deleted'
          AND (a.kind='skipper' OR (a.kind='channel' AND ac.channel_id=bot_channels.channel_id))
      )`);
    for (const channel of q("SELECT id FROM channels WHERE kind='channel' AND status<>'deleted'")) {
      const skipperBot = q1("SELECT bot_id FROM agents WHERE kind='skipper' AND status<>'deleted' LIMIT 1");
      const residentBot = q1("SELECT a.bot_id FROM agents a JOIN agent_channels ac ON ac.agent_id=a.id WHERE ac.channel_id=? AND a.kind='channel' AND a.status<>'deleted'", channel.id);
      if (skipperBot?.bot_id) run("INSERT OR IGNORE INTO bot_channels (bot_id,channel_id) VALUES (?,?)", skipperBot.bot_id, channel.id);
      if (residentBot?.bot_id) run("INSERT OR IGNORE INTO bot_channels (bot_id,channel_id) VALUES (?,?)", residentBot.bot_id, channel.id);
    }
    for (const agent of q("SELECT * FROM agents WHERE NOT EXISTS (SELECT 1 FROM agent_profiles WHERE agent_profiles.agent_id=agents.id)")) {
      const binding = q1("SELECT channel_id FROM agent_channels WHERE agent_id=?", agent.id);
      const purpose = binding ? String(q1("SELECT purpose FROM channels WHERE id=?", binding.channel_id)?.purpose || "") : "Workspace-wide chief of staff";
      const instructions = String(q1("SELECT prompt FROM bots WHERE id=?", agent.bot_id)?.prompt || "");
      run("INSERT INTO agent_profiles (agent_id, purpose, instructions, workspace_ref, memory_namespace, capability_policy, updated) VALUES (?,?,?,?,?,'{}',?)",
        agent.id, purpose, instructions, binding ? `channels/${binding.channel_id}` : "skipper", binding ? `channel:${binding.channel_id}` : "workspace", now());
      for (const capability of String(agent.kind) === "skipper" ? ["shell", "files", "memory", "cross_channel", "host"] : ["shell", "files", "memory", "escalate"]) {
        run("INSERT OR IGNORE INTO agent_capabilities (agent_id, capability, created) VALUES (?,?,?)", agent.id, capability, now());
      }
      if (binding) run("INSERT OR IGNORE INTO channel_workspaces (channel_id, root_ref, created) VALUES (?,?,?)", binding.channel_id, `channels/${binding.channel_id}`, now());
    }

    const shippedSkills = [
      ...BUILTIN_SKILLS.map((entry) => [entry.slug, entry.name, entry.description, entry.category, entry.instructions]),
      ["image-generation", "Image Generation", "Create images automatically whenever a healthy ChatGPT subscription account is connected.", "media", "Use when Image Generation is active through a connected ChatGPT account. When asked to generate or illustrate: write a precise visual prompt, call the ChatGPT-backed image tool, save the result into the channel workspace, and attach it to the message so the human sees the image in chat — never only a host path. Do not invent credentials. If generation fails, report the concrete provider error and call Skipper directly only if host/provider setup is broken."],
    ];
    for (const skill of shippedSkills) run(`INSERT INTO skills (slug,name,description,category,instructions,source,status,created,updated)
      VALUES (?,?,?,?,?,'shipped','active',?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,instructions=excluded.instructions,updated=excluded.updated`, ...skill, now(), now());
    // Superseded prerelease prompt snippets stay in history but no longer
    // appear as active arsenal entries. Their complete operational successors
    // above are installed for every resident.
    run("UPDATE skills SET status='retired',updated=? WHERE slug IN ('home-ops','inbox-triage')", now());

    const templates = [
      ["general", "Blank slate", "A capable resident operator that specializes around this channel over time.", "Own and coordinate this area of work.", "Learn the user's vocabulary, standards, preferences, tools, and proven procedures. Own requested outcomes and compound that knowledge over the lifetime of the channel.", '["outcome-ownership","blocker-resolution","skipper-escalation","capability-discovery","durable-memory","workspace-artifacts","quality-verification"]', "helm", 0],
      ["project", "Project partner", "Plans, builds, tracks decisions, and improves with the project.", "Plan and deliver a project from idea through verified outcomes.", "Keep a current view of goals, milestones, risks, decisions, obligations, and artifacts without imposing ceremony.", '["outcome-ownership","project-planning","durable-obligations","durable-memory","workspace-artifacts","quality-verification"]', "sliders", 10],
      ["research", "Research partner", "Investigates a subject and builds durable, sourced understanding.", "Research this subject and turn evidence into useful decisions.", "Track open questions, source quality, findings, changing conclusions, and reusable evidence.", '["outcome-ownership","research","browser-operations","durable-memory","workspace-artifacts","quality-verification"]', "search", 20],
      ["home", "Home operator", "Runs household systems, recurring life administration, and approachable self-hosting.", "Help run a household area, its routines, services, obligations, and information.", "Assume no self-hosting expertise. Explain options plainly, learn the household's preferences, and carry accepted work through deployment and verification.", '["outcome-ownership","personal-operations","durable-obligations","self-hosting-guide","durable-memory","quality-verification"]', "home", 30],
      ["inbox", "Inbox partner", "Triages correspondence and turns it into drafts, decisions, and durable follow-through.", "Triage incoming messages and carry the resulting work to completion.", "Learn the user's priorities and voice. Use brokered access, create drafts autonomously, and preserve human judgment for consequential sending or deletion.", '["outcome-ownership","email-operations","message-operations","durable-obligations","durable-memory","quality-verification"]', "mail", 40],
    ];
    for (const template of templates) run(`INSERT INTO agent_templates (slug,name,description,purpose_hint,instructions,skill_slugs,icon,sort_order,status)
      VALUES (?,?,?,?,?,?,?,?,'active') ON CONFLICT(slug) DO UPDATE SET name=excluded.name,description=excluded.description,purpose_hint=excluded.purpose_hint,instructions=excluded.instructions,skill_slugs=excluded.skill_slugs,icon=excluded.icon,sort_order=excluded.sort_order`, ...template);

    const skipper = q1("SELECT id FROM agents WHERE kind='skipper' AND status<>'deleted' LIMIT 1");
    if (skipper) for (const skill of q("SELECT id,slug FROM skills WHERE status='active'")) {
      if (String(skill.slug) === "image-generation") continue; // gated: only when ChatGPT OAuth + Providers toggle
      run("INSERT OR IGNORE INTO agent_skills (agent_id,skill_id,provisioned_by,reason,permanent,created) VALUES (?,?,?,'Skipper has the full workspace skill arsenal.',1,?)", skipper.id, skill.id, skipper.id, now());
    }
    for (const agent of q(`SELECT a.id,a.template_slug,p.purpose,ac.channel_id FROM agents a
      LEFT JOIN agent_profiles p ON p.agent_id=a.id LEFT JOIN agent_channels ac ON ac.agent_id=a.id
      WHERE a.kind='channel' AND a.status<>'deleted'`)) {
      const profilePath = join(DATA_DIR, "channels", String(agent.channel_id || ""), "profile", "agent.json");
      if (existsSync(profilePath)) {
        try {
          const profile = JSON.parse(readFileSync(profilePath, "utf8")) as { template?: unknown };
          const templateSlug = String(profile.template || "").trim();
          if (templateSlug && q1("SELECT 1 FROM agent_templates WHERE slug=? AND status='active'", templateSlug)) {
            agent.template_slug = templateSlug;
            run("UPDATE agents SET template_slug=? WHERE id=?", templateSlug, agent.id);
          }
        } catch { /* malformed legacy profile falls back to the general template */ }
      }
      const template = q1("SELECT skill_slugs FROM agent_templates WHERE slug=? AND status='active'", agent.template_slug || "general")
        || q1("SELECT skill_slugs FROM agent_templates WHERE slug='general'");
      let templateSkills: string[] = [];
      try {
        const parsed = JSON.parse(String(template?.skill_slugs || "[]"));
        if (Array.isArray(parsed)) templateSkills = parsed.map(String);
      } catch { /* invalid legacy template metadata falls back to the universal core */ }
      const wanted = new Set([...UNIVERSAL_RESIDENT_SKILL_SLUGS, ...templateSkills]);
      // Remove only historical automatic grants. Explicit Captain/Skipper,
      // catalog, and resident-created grants remain durable.
      for (const assignment of q(`SELECT ask.skill_id,s.slug FROM agent_skills ask JOIN skills s ON s.id=ask.skill_id
        WHERE ask.agent_id=? AND s.source='shipped' AND s.slug<>'image-generation'
          AND (ask.reason='Part of the safe built-in resident arsenal.'
            OR ask.reason LIKE 'Built-in arsenal for the %; full procedures are available on demand.')`, agent.id)) {
        if (!wanted.has(String(assignment.slug))) run("DELETE FROM agent_skills WHERE agent_id=? AND skill_id=?", agent.id, assignment.skill_id);
      }
      for (const slug of wanted) {
        const skill = q1("SELECT id FROM skills WHERE slug=?", slug);
        if (skill) run("INSERT OR IGNORE INTO agent_skills (agent_id,skill_id,provisioned_by,reason,permanent,created) VALUES (?,?,?,'Built-in arsenal for the resident template; full procedures are available on demand.',1,?)", agent.id, skill.id, skipper?.id ?? null, now());
      }
    }
    if (tableColumns("bot_skills").length && tableColumns("skills_legacy_v1").length) {
      for (const assignment of q(`SELECT a.id agent_id,s.slug,bs.reason,provisioner.id provisioned_by,bs.created
        FROM bot_skills bs JOIN agents a ON a.bot_id=bs.bot_id JOIN skills_legacy_v1 s ON s.id=bs.skill_id
        LEFT JOIN agents provisioner ON provisioner.bot_id=bs.provisioned_by_bot_id`)) {
        const skill = q1("SELECT id FROM skills WHERE slug=?", assignment.slug);
        if (skill) run("INSERT OR IGNORE INTO agent_skills (agent_id,skill_id,provisioned_by,reason,permanent,created) VALUES (?,?,?,?,1,?)", assignment.agent_id, skill.id, assignment.provisioned_by ?? null, assignment.reason || "Migrated permanent skill.", assignment.created || now());
      }
    }
    if (tableColumns("agent_improvements_legacy_v1").length) {
      for (const improvement of q(`SELECT legacy.*,a.id agent_id,ac.channel_id FROM agent_improvements_legacy_v1 legacy
        JOIN agents a ON a.bot_id=legacy.bot_id LEFT JOIN agent_channels ac ON ac.agent_id=a.id WHERE legacy.active=1`)) {
        run(`INSERT INTO agent_improvements (agent_id,channel_id,kind,summary,instruction,status,created)
          SELECT ?,?,?,?,?, 'active',? WHERE NOT EXISTS (SELECT 1 FROM agent_improvements WHERE agent_id=? AND instruction=?)`, improvement.agent_id, improvement.channel_id ?? null, improvement.kind, "Migrated Skipper improvement.", improvement.instruction, improvement.created, improvement.agent_id, improvement.instruction);
      }
    }
  });
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_slug ON channels(slug) WHERE status<>'deleted';");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_personal_main_owner ON channels(personal_main_owner_id) WHERE personal_main_owner_id IS NOT NULL AND status<>'deleted';");
  const currentWorkspaceName = normalizeWorkspaceName(q1("SELECT name FROM workspace WHERE id=1")?.name) || "My Workspace";
  run("UPDATE workspace SET name=? WHERE id=1 AND name<>?", currentWorkspaceName, currentWorkspaceName);
  db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_workspace_name_insert
  BEFORE INSERT ON workspace
  WHEN length(NEW.name)<1 OR length(NEW.name)>100 OR NEW.name<>trim(NEW.name)
  BEGIN SELECT RAISE(ABORT, 'workspace name must contain 1 to 100 Unicode code points'); END;
  CREATE TRIGGER IF NOT EXISTS trg_workspace_name_update
  BEFORE UPDATE OF name ON workspace
  WHEN length(NEW.name)<1 OR length(NEW.name)>100 OR NEW.name<>trim(NEW.name)
  BEGIN SELECT RAISE(ABORT, 'workspace name must contain 1 to 100 Unicode code points'); END;
  `);
  // Defense in depth for the authority channel: clean any historical bad
  // bindings, then reject both new active rows and reactivation through UPDATE.
  run(`UPDATE thread_agent_guests SET status='removed' WHERE status='active' AND EXISTS (
    SELECT 1 FROM threads t JOIN channels c ON c.id=t.channel_id
    WHERE t.id=thread_agent_guests.thread_id AND c.kind='channel' AND c.name='main'
      AND c.personal_main_owner_id IS NOT NULL AND c.status<>'deleted')`);
  db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_thread_guest_no_personal_main_insert
  BEFORE INSERT ON thread_agent_guests
  WHEN NEW.status='active' AND EXISTS (
    SELECT 1 FROM threads t JOIN channels c ON c.id=t.channel_id
    WHERE t.id=NEW.thread_id AND c.kind='channel' AND c.name='main'
      AND c.personal_main_owner_id IS NOT NULL AND c.status<>'deleted')
  BEGIN SELECT RAISE(ABORT, 'resident agents cannot enter #main'); END;
  CREATE TRIGGER IF NOT EXISTS trg_thread_guest_no_personal_main_update
  BEFORE UPDATE OF status,thread_id ON thread_agent_guests
  WHEN NEW.status='active' AND EXISTS (
    SELECT 1 FROM threads t JOIN channels c ON c.id=t.channel_id
    WHERE t.id=NEW.thread_id AND c.kind='channel' AND c.name='main'
      AND c.personal_main_owner_id IS NOT NULL AND c.status<>'deleted')
  BEGIN SELECT RAISE(ABORT, 'resident agents cannot enter #main'); END;
  `);
}
migrate();

/** Reset agent run state stranded by a crash and remove empty placeholder turn messages. */
export function recoverInterruptedRuns(): void {
  run("UPDATE agents SET status='ready' WHERE status='working'");
  run(`UPDATE escalations SET status='failed', resolved_by=NULL WHERE status='resolved' AND EXISTS (
    SELECT 1 FROM threads t JOIN messages m ON m.parent_id=t.root_message_id
    JOIN agents a ON a.bot_id=m.bot_id AND a.kind='skipper'
    WHERE t.id=escalations.thread_id AND trim(m.body) IN ('','thinking…','_Working…_'))`);
  run("UPDATE escalations SET status='failed', resolved_by=NULL WHERE status='open'");
  const interruptedAt = now();
  // A turn that had acquired its lease may already have produced external side
  // effects, so never replay it blindly. Queued turns have not started and stay
  // queued for bootstrap to drain from their durable trigger rows.
  run(`UPDATE messages SET body='_This turn was interrupted by a server restart. Please retry._'
    WHERE id IN (SELECT message_id FROM agent_turns WHERE state='running')
      AND body IN ('','_Working…_')`);
  run(`UPDATE agent_turns SET state='failed',finished_at=?,error='server restart interrupted a running turn',
    final_body_hash=sha256(COALESCE((SELECT body FROM messages WHERE messages.id=agent_turns.message_id),''))
    WHERE state='running'`, interruptedAt);
  run(`UPDATE threads SET status='failed', updated_at=? WHERE id IN (
    SELECT thread_id FROM tool_actions WHERE status='running'
    UNION SELECT t.id FROM threads t JOIN agent_turns at ON at.thread_root_id=t.root_message_id
      WHERE at.state='failed' AND at.error='server restart interrupted a running turn'
    UNION SELECT t.id FROM threads t JOIN messages m ON m.parent_id=t.root_message_id
      WHERE m.bot_id IS NOT NULL AND trim(m.body) IN ('','thinking…','_Working…_')
        AND NOT EXISTS (SELECT 1 FROM agent_turns at WHERE at.message_id=m.id AND at.state='queued'))`, interruptedAt);
  run(`UPDATE messages SET body='_This turn was interrupted by a server restart. Please retry._'
    WHERE body IN ('','_Working…_') AND bot_id IS NOT NULL AND parent_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM agent_turns at WHERE at.message_id=messages.id AND at.state='queued')`);
  // Progress rows stay on the finished bot message. Client "Working…" is driven by
  // any agent_progress.status='running' — if a crash/restart lands after the final
  // body is written but before the bulk complete UPDATE, the UI stays stuck forever
  // even though agents are ready and the reply body is real. Always clear those.
  run(`UPDATE agent_progress SET status='complete', updated=? WHERE status='running'
    AND NOT EXISTS (SELECT 1 FROM agent_turns at WHERE at.message_id=agent_progress.message_id AND at.state='queued')`, interruptedAt);
  // Early native builds copied raw transcript snippets into Memory under the
  // summary kind. Session recaps belong to threads; they are not knowledge.
  run("DELETE FROM memory_items WHERE kind='summary' AND author_type='system'");
  run("DELETE FROM tool_actions WHERE status='running'");
}

/** Ensure a new workspace has its configuration row and #main home channel. */
export function seed(): void {
  if (!q1("SELECT id FROM workspace WHERE id=1")) {
    run("INSERT INTO workspace (id, name, terminals_enabled, setup_complete, created) VALUES (1,'My Workspace',1,0,?)", now());
  }
  if (!q1("SELECT id FROM channels WHERE kind='channel' LIMIT 1")) {
    run("INSERT INTO channels (name, slug, kind, topic, purpose, status, created) VALUES ('main','main','channel','Your home base with @skipper','Workspace-wide coordination with Skipper','active',?)", now());
  }
  const installationId = String(q1("SELECT installation_id FROM workspace WHERE id=1")?.installation_id || "");
  if (!/^[a-f0-9]{16}$/.test(installationId)) run("UPDATE workspace SET installation_id=? WHERE id=1", randomBytes(8).toString("hex"));
  recoverInterruptedRuns();
}
