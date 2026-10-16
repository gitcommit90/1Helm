// Shared dependency template helpers for job containers on the durable_object scheduling policy (PrepContainer, BeeContainer).
// A template is a snapshot of a container's root filesystem after its dependencies were installed. Rules kept here for every family:
//  - the builder (buildTemplate) runs only setup scripts the caller passes in. It never receives tenant files, tokens or R2 access;
//  - a container that handled a job must never become a template (callers check their own role before calling buildTemplate);
//  - package caches and /tmp are removed before capture;
//  - a missing, stale, expired or unrestorable template falls back to a fresh container started from the plain image.
// No Hindsight or memory behavior lives here.
export const ENTRYPOINT = ["bash", "-c", "trap 'exit 0' TERM INT; while true; do sleep 3600 & wait $!; done"];
export const TEMPLATE_MAX_AGE_MS = 29 * 86400000;   // Cloudflare keeps a snapshot 30 days after its last restore; rebuild one day early
export const SLOT_TTL_MS = 10 * 60000;
export const DEFAULT_INSTANCE = "standard-1";
export const CLEANUP_COMMAND = "rm -rf /root/.npm /root/.cache /tmp/*";
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const sha = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, "0")).join("");
// Same script with bounded retries on every curl download (builders only, where a registry rate limit must not fail a build).
export const withCurlRetry = script => script.replaceAll("curl -fsSL", "curl --retry 3 --retry-delay 2 --retry-max-time 30 -fsSL");
export async function bounded(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}
// Wait until the container answers `exec true`. Rejects when monitor() fails first, or after `timeout` ms.
export async function ready(container, timeout = 60000, label = "prep") {
  const deadline = Date.now() + timeout;
  let failed;
  container.monitor?.().catch(error => { failed = error; });
  while (Date.now() < deadline) {
    if (failed) throw failed;
    try { if ((await bounded(container.exec(["true"], { stderr: "combined" }).then(p => p.output()), Math.max(1, deadline - Date.now()), `${label} startup timed out`)).exitCode === 0) return; } catch {}
    await delay(250);
  }
  throw new Error(`the ${label} container didn't start`);
}
// Run one setup script in the container ("bash -c <script> _ <args>"). Killed after 300 s.
export async function runSetup(container, script, args = [], { label = "prep" } = {}) {
  const p = await container.exec(["bash", "-c", script, "_", ...args], { stderr: "combined" });
  const timer = setTimeout(() => { try { p.kill(9); } catch {} }, 300000);
  try { const out = await bounded(p.output(), 305000, `${label} setup timed out`); if (out.exitCode !== 0) throw new Error(`${label} dependency setup failed`); }
  finally { clearTimeout(timer); }
}
// The template version: the image digest plus the full setup script (and an optional variant tag).
// Without a tag the value equals the original prep version, so saved prep templates stay valid.
export const templateVersion = (image, setup, tag = "") => sha(image + "\n" + (tag ? tag + "\n" : "") + setup);
// A saved template { version, image, handle, created } is usable when its version matches, it has a handle id, it is not the
// invalidated handle, and it is younger than TEMPLATE_MAX_AGE_MS.
export function templateUsable(saved, version, { invalidate = null, now = Date.now() } = {}) {
  return !!(saved && saved.version === version && saved.handle?.id && saved.handle.id !== invalidate && now - saved.created < TEMPLATE_MAX_AGE_MS);
}
export const readJson = (text, fallback = null) => { try { return JSON.parse(text || "null") ?? fallback; } catch { return fallback; } };
// Build a template in the given container: start from the plain image, run the steps, verify, clean, snapshot, and always destroy.
//   steps: [{ script, args }]   verify: { command, env } | null   name: snapshot name
// Returns the saved record { version, image, handle, created }. The caller stores it.
export async function buildTemplate(container, { version, name, steps, verify = null, cleanup = CLEANUP_COMMAND, instance = DEFAULT_INSTANCE, label = "prep", destroyReason = "dependency snapshot ready" }) {
  if (container.running) await container.destroy("replace dependency template");
  container.start({ image: container.images.base, instance, entrypoint: ENTRYPOINT, enableInternet: true });
  try {
    await ready(container, 60000, label);
    for (const s of steps) await runSetup(container, s.script, s.args || [], { label });
    if (verify) {
      const v = await bounded(container.exec(["bash", "-c", verify.command], { stderr: "combined", ...(verify.env ? { env: verify.env } : {}) }).then(p => p.output()), 30000, "dependency verification timed out");
      if (v.exitCode !== 0) throw new Error("dependency snapshot verification failed");
    }
    // Package caches are unnecessary for restores and can contain download URLs.
    const clean = await bounded(container.exec(["bash", "-c", cleanup], { stderr: "combined" }).then(p => p.output()), 30000, "dependency cleanup timed out");
    if (clean.exitCode !== 0) throw new Error("dependency snapshot cleanup failed");
    const handle = await bounded(container.snapshotContainer({ name }), 60000, "dependency snapshot timed out");
    if (!handle?.id || !Number.isFinite(handle.size) || handle.size > 20e9) throw new Error("invalid dependency snapshot handle");
    return { version, image: container.images.base, handle, created: Date.now() };
  } finally { await container.destroy(destroyReason); }
}
// Start a job container from a template when it is valid for this version and image, otherwise from the plain image.
// Returns { source: "snapshot" | "fresh_fallback" | "control", snapshot_id, fallback, restoreFailedId, start_called_at, ready_at }.
//   fallback: a reason string the caller already knows (template_missing, template_unavailable) is passed in and kept; restore_failed is set here.
//   onRestoreFailed(handleId): called after a failed restore so the caller can invalidate that exact handle.
// A restore that throws (start, readiness or monitor failure) destroys the container and starts fresh.
export async function startFromTemplate(container, { template = null, version, instance = DEFAULT_INSTANCE, control = false, fallback = null, onRestoreFailed = null, label = "prep" }) {
  const base = { entrypoint: ENTRYPOINT, enableInternet: true, instance };
  const out = { source: null, snapshot_id: null, fallback, restoreFailedId: null, start_called_at: null, ready_at: null };
  const fresh = async () => {
    out.start_called_at = Date.now();
    container.start({ image: container.images.base, ...base });
    await ready(container, 60000, label); out.ready_at = Date.now();
    out.source = control ? "control" : "fresh_fallback"; out.snapshot_id = null;
  };
  if (!control && template?.version === version && template.image === container.images.base && template.handle?.id) {
    try {
      out.start_called_at = Date.now();
      container.start({ containerSnapshot: template.handle, ...base });
      await ready(container, 60000, label); out.ready_at = Date.now();
      out.source = "snapshot"; out.snapshot_id = template.handle.id;
    } catch {
      out.fallback = "restore_failed"; out.restoreFailedId = template.handle.id;
      if (container.running) await container.destroy(`${label} snapshot restore failed`);
      if (onRestoreFailed) onRestoreFailed(template.handle.id);
      await fresh();
    }
  } else await fresh();
  return out;
}
// Slot leases kept in a {get, put} key-value store (the coordinator object). At most `max` live leases, each expiring after `ttl` ms.
export function claimSlotIn(store, id, { max = 2, ttl = SLOT_TTL_MS, now = Date.now() } = {}) {
  let slots = readJson(store.get("slots"), {}); if (typeof slots !== "object" || Array.isArray(slots)) slots = {};
  slots = Object.fromEntries(Object.entries(slots).filter(([, expiry]) => expiry > now));
  if (!slots[id] && Object.keys(slots).length >= max) return false;
  slots[id] = now + ttl; store.put("slots", JSON.stringify(slots)); return true;
}
export function releaseSlotIn(store, id) {
  let slots = readJson(store.get("slots"), {}); if (typeof slots !== "object" || Array.isArray(slots)) slots = {};
  delete slots[id]; store.put("slots", JSON.stringify(slots));
}
