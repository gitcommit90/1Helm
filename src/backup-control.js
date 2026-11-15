import { boundedJson } from "./bounded-body.js";
import { snapshotStub, snapshotTargets } from "./backup-plan.js";
import { readSnapshotManifest } from "./sqlite-snapshot.js";
import { stPut } from "./storage.js";

const json = (value, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const backupIdOk = (value) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const targetId = (value) => `${value.kind}\0${value.name}`;
const sha = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((n) => n.toString(16).padStart(2, "0")).join("");
const keyFor = async (id, target) => `backup/${id}/${target.kind.toLowerCase()}/${await sha(target.name)}/manifest.json`;

async function tokenMatches(req, env) {
  const got = (req.headers.get("authorization") || "").match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] || "";
  const expected = String(env.BACKUP_TOKEN || "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(expected) || !got) return false;
  const a = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(got)));
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)));
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function ownerTenant(env) {
  return (await env.DB.prepare("SELECT id FROM tenants WHERE owner_user_id=(SELECT user_id FROM single_owner WHERE id=1) LIMIT 1").first())?.id || null;
}

async function readIndex(env, backupId, tenantId) {
  const key = `backup/${backupId}/index.json`, object = await env.WS.get(key);
  if (!object || object.size > 2 * 1024 * 1024) throw new Error("backup index missing or too large");
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("backup index too large");
  const index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (index?.format !== "onehelm-backup-v1" || index.backup_id !== backupId || index.tenant !== tenantId || !Array.isArray(index.objects)) throw new Error("invalid backup index");
  if (index.objects.length < 4 || index.objects.length > 10000) throw new Error("invalid backup target count");
  const seen = new Set();
  for (const target of index.objects) {
    const name = target?.name, kind = target?.kind;
    const belongs = (kind === "Archive" && name === `archive:${tenantId}`) ||
      (kind === "UsageLedger" && name === `tenant:${tenantId}`) ||
      (kind === "Computer" && (name === `computer:${tenantId}` || name === `prepjob:${tenantId}`)) ||
      (kind === "Resident" && typeof name === "string" && name.startsWith(`res:${tenantId}:`) && name.length > `res:${tenantId}:`.length) ||
      (kind === "ChannelComputer" && typeof name === "string" && name.startsWith(`cc:${tenantId}:`) && name.length > `cc:${tenantId}:`.length) ||
      (kind === "NativeTransport" && typeof name === "string" && name.startsWith(`${tenantId}:`) && name.length > `${tenantId}:`.length) ||
      (kind === "FilePrep" && typeof name === "string" && name.startsWith(`prep:t/${tenantId}/files/`) && name.length > `prep:t/${tenantId}/files/`.length);
    if (!belongs || seen.has(targetId(target)) || target.key !== await keyFor(backupId, target)) throw new Error("invalid backup target");
    seen.add(targetId(target));
  }
  for (const required of [`Archive\0archive:${tenantId}`, `UsageLedger\0tenant:${tenantId}`, `Computer\0computer:${tenantId}`, `Computer\0prepjob:${tenantId}`])
    if (!seen.has(required)) throw new Error("incomplete backup index");
  return index;
}

export const isBackupPath = (path) => path === "/api/backup/plan" || path === "/api/backup/object" || path === "/api/backup/finalize" || path === "/api/backup/restore-plan" || path === "/api/backup/restore-object";

export async function backupControl(req, env, path) {
  if (env.ENV_NAME !== "selfhost" || env.BACKUP_MAINTENANCE !== "1" || !(await tokenMatches(req, env))) return json({ error: "not found" }, 404);
  const tenantId = await ownerTenant(env);
  if (!tenantId) return json({ error: "owner workspace missing" }, 409);
  try {
    if (path === "/api/backup/plan" && req.method === "GET") {
      const requested = new URL(req.url).searchParams.get("id");
      if (requested && !backupIdOk(requested)) return json({ error: "invalid backup ID" }, 400);
      const backupId = requested || [...crypto.getRandomValues(new Uint8Array(16))].map((n) => n.toString(16).padStart(2, "0")).join("");
      return json({ backup_id: backupId, targets: await snapshotTargets(env, tenantId) });
    }
    if (path === "/api/backup/restore-plan" && req.method === "GET") {
      if (env.BACKUP_RESTORE_MODE !== "1") return json({ error: "restore mode disabled" }, 403);
      const backupId = new URL(req.url).searchParams.get("id");
      if (!backupIdOk(backupId)) return json({ error: "invalid backup ID" }, 400);
      const index = await readIndex(env, backupId, tenantId);
      return json({ backup_id: backupId, targets: index.objects.map(({ kind, name }) => ({ kind, name })) });
    }
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const body = await boundedJson(req, 1024 * 1024);
    if (!backupIdOk(body.backup_id)) return json({ error: "invalid backup ID" }, 400);
    if (path === "/api/backup/object") {
      const targets = await snapshotTargets(env, tenantId);
      const target = targets.find((item) => targetId(item) === targetId(body.target || {}));
      if (!target) return json({ error: "unknown backup target" }, 400);
      const key = await keyFor(body.backup_id, target);
      const prefix = key.slice(0, -"/manifest.json".length);
      const stub = snapshotStub(env, target);
      return json(await stub.snapshotBackupStep(prefix, target.name));
    }
    if (path === "/api/backup/finalize") {
      const targets = await snapshotTargets(env, tenantId);
      const submitted = Array.isArray(body.objects) ? body.objects : [];
      if (submitted.length !== targets.length) return json({ error: "backup target count mismatch" }, 400);
      const byId = new Map(submitted.map((item) => [targetId(item), item]));
      if (byId.size !== targets.length) return json({ error: "duplicate backup target" }, 400);
      const objects = [];
      for (const target of targets) {
        const item = byId.get(targetId(target)), key = await keyFor(body.backup_id, target);
        if (!item || item.key !== key) return json({ error: "backup target missing" }, 400);
        const manifest = await readSnapshotManifest(env.WS, key);
        if (manifest.identity?.kind !== target.kind || manifest.identity?.name !== target.name) return json({ error: "backup identity mismatch" }, 400);
        objects.push({ ...target, key });
      }
      const index = { format: "onehelm-backup-v1", backup_id: body.backup_id, tenant: tenantId, created: Date.now(), objects };
      const key = `backup/${body.backup_id}/index.json`;
      await stPut(env, key, JSON.stringify(index), { httpMetadata: { contentType: "application/json" } });
      return json({ ok: true, key, objects: objects.length });
    }
    if (path === "/api/backup/restore-object") {
      if (env.BACKUP_RESTORE_MODE !== "1") return json({ error: "restore mode disabled" }, 403);
      const index = await readIndex(env, body.backup_id, tenantId);
      const target = index.objects.find((item) => targetId(item) === targetId(body.target || {}));
      if (!target || target.key !== await keyFor(body.backup_id, target)) return json({ error: "unknown restore target" }, 400);
      return json(await snapshotStub(env, target).snapshotRestoreStep(target.key, target.name));
    }
    return json({ error: "not found" }, 404);
  } catch (error) {
    return json({ error: String(error?.message || error).slice(0, 180) }, 500);
  }
}
