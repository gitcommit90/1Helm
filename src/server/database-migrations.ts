type Execute = (sql: string, ...params: unknown[]) => unknown;
type AddColumn = (table: string, name: string, ddl: string) => void;

/** Remove legacy recursive file indexes without touching uploads or attachments. */
export function cleanupLegacyWorkspaceArtifacts(run: Execute): void {
  run(`DELETE FROM artifacts
    WHERE kind='file'
      AND NOT EXISTS (
        SELECT 1 FROM attachments at
        JOIN messages m ON m.id=at.message_id
        WHERE m.channel_id=artifacts.channel_id
          AND at.workspace_path=artifacts.path
      )`);
}

/** Add durable follow-up provenance with fail-closed defaults for old rows. */
export function migrateFollowupAuthorization(addColumn: AddColumn, execute: Execute): void {
  addColumn("agent_turns", "host_authorized_computer_ids", "host_authorized_computer_ids TEXT NOT NULL DEFAULT '[]'");
  addColumn("agent_followups", "host_authorized", "host_authorized INTEGER NOT NULL DEFAULT 0 CHECK (host_authorized IN (0,1))");
  addColumn("agent_followups", "host_authorized_computer_ids", "host_authorized_computer_ids TEXT NOT NULL DEFAULT '[]'");
  addColumn("agent_followups", "source_followup_id", "source_followup_id INTEGER REFERENCES agent_followups(id) ON DELETE SET NULL");
  execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_followups_single_successor ON agent_followups(source_followup_id) WHERE source_followup_id IS NOT NULL");
}

export function migrateRuntimeContinuation(addColumn: AddColumn): void {
  addColumn("agent_turns", "continuation_disposition", "continuation_disposition TEXT NOT NULL DEFAULT 'none' CHECK (continuation_disposition IN ('none','completed','continued','blocked'))");
  addColumn("agent_turns", "continuation_evidence", "continuation_evidence TEXT NOT NULL DEFAULT ''");
  addColumn("agent_turns", "continuation_followup_id", "continuation_followup_id INTEGER");
  addColumn("agent_followups", "completion_disposition", "completion_disposition TEXT NOT NULL DEFAULT 'none' CHECK (completion_disposition IN ('none','completed','continued','blocked'))");
  addColumn("agent_followups", "completion_evidence", "completion_evidence TEXT NOT NULL DEFAULT ''");
  addColumn("agent_followups", "disposition_turn_id", "disposition_turn_id INTEGER REFERENCES agent_turns(id) ON DELETE SET NULL");
}


export function migrateThreadUx(addColumn: AddColumn, execute: Execute): void {
  addColumn("agent_turns", "retry_of_turn_id", "retry_of_turn_id INTEGER REFERENCES agent_turns(id) ON DELETE SET NULL");
  addColumn("agent_turns", "handoff_confirmation", "handoff_confirmation INTEGER NOT NULL DEFAULT 0");
  execute(`CREATE TABLE IF NOT EXISTS thread_handoffs (
    id INTEGER PRIMARY KEY, source_thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    destination_thread_id INTEGER NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,
    source_root_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    destination_root_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    packet TEXT NOT NULL, model TEXT NOT NULL, provider_id INTEGER,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS message_retries (
    idempotency_key TEXT PRIMARY KEY, original_turn_id INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    retry_trigger_id INTEGER REFERENCES messages(id) ON DELETE CASCADE, retry_turn_id INTEGER REFERENCES agent_turns(id) ON DELETE SET NULL,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_message_retries_original ON message_retries(original_turn_id,created);`);
}

/** Add browser Push API subscriptions and a per-device durable delivery queue. */
export function migrateWebPush(execute: (sql: string) => void): void {
  execute(`
    CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_push_user ON web_push_subscriptions(user_id,id);
    CREATE TABLE IF NOT EXISTS web_push_outbox (
      id INTEGER PRIMARY KEY,
      subscription_id INTEGER NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
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
      UNIQUE(subscription_id,message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_web_push_outbox_due ON web_push_outbox(state,next_attempt,id);
  `);
}
