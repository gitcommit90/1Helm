type Execute = (sql: string, ...params: unknown[]) => unknown;

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
