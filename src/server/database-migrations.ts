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
