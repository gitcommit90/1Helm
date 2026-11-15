#!/usr/bin/env node
// Drive the maintenance-only backup API one Durable Object per request.
// D1 export and the metadata-preserving R2 copy remain separate steps.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function snapshotObjects({ action, host, token, backupId, fetcher = fetch, onPlan = () => {} }) {
  const base = new URL(host);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("Use the installation's HTTPS origin only.");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || "")) throw new Error("The recovery file has no valid BACKUP_TOKEN.");
  const request = async (path, body) => {
    const response = await fetcher(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: {
      authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Backup API ${response.status}: ${String(result.error || "request failed").slice(0, 160)}`);
    return result;
  };
  if (action === "backup") {
    if (backupId && !/^[a-f0-9]{32}$/.test(backupId)) throw new Error("Provide a valid 32-character backup ID to resume.");
    const plan = await request(backupId ? `/api/backup/plan?id=${backupId}` : "/api/backup/plan");
    if (!/^[a-f0-9]{32}$/.test(plan.backup_id) || !Array.isArray(plan.targets)) throw new Error("Invalid backup plan.");
    onPlan(plan.backup_id);
    const objects = [];
    for (const target of plan.targets) {
      let result;
      do { result = await request("/api/backup/object", { backup_id: plan.backup_id, target }); } while (!result.done);
      objects.push(result);
    }
    const done = await request("/api/backup/finalize", { backup_id: plan.backup_id, objects });
    return { backup_id: plan.backup_id, index_key: done.key, objects: done.objects };
  }
  if (action === "restore") {
    if (!/^[a-f0-9]{32}$/.test(backupId || "")) throw new Error("Provide the backup's 32-character ID.");
    const plan = await request(`/api/backup/restore-plan?id=${backupId}`);
    if (!Array.isArray(plan.targets) || !plan.targets.length) throw new Error("Invalid restore plan.");
    for (const target of plan.targets) {
      let result;
      do { result = await request("/api/backup/restore-object", { backup_id: backupId, target }); } while (!result.done);
    }
    return { backup_id: backupId, restored_objects: plan.targets.length };
  }
  throw new Error("Use backup or restore.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [action, host, recoveryFile, backupId] = process.argv.slice(2);
  try {
    if (!recoveryFile) throw new Error("Usage: snapshot-objects.mjs <backup|restore> <https://host/> <recovery.json> [backup-id]");
    const { BACKUP_TOKEN: token } = JSON.parse(readFileSync(recoveryFile, "utf8"));
    console.log(JSON.stringify(await snapshotObjects({ action, host, token, backupId,
      onPlan: (id) => console.error(`Backup ID: ${id} (use this ID to resume an interrupted backup)`) })));
  } catch (error) { console.error(String(error?.message || error)); process.exitCode = 1; }
}
