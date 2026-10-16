// BeeContainer: the Bee job container (src/bee.js beeJobOn, beeLiveOn) on the durable_object scheduling policy, which is what lets it
// start from a snapshot and pick its instance type. Used only where BEE_SNAPSHOTS is "on" (dev), and by the container benchmark
// on csbench: objects (dev benchmark objects). The shared Computer class keeps serving Bee everywhere else, unchanged.
//  - The template builder object ("dependencies:coordinator") runs only trivial steps. It never receives a Bee token, a tenant id,
//    an input path or R2 access, and a container that handled a job can never become a template (role guard below).
//  - A restore that fails starts a fresh container from the plain image and is marked "fresh_fallback".
//  - No max_instances exists under this policy, so this class keeps its own slot limit (BEE_SLOTS) in the coordinator object.
//  - Nothing here reads, writes or changes memory or Hindsight.
import { DurableObject } from "cloudflare:workers";
import { beeJobOn, beeJobAlarm, beeLiveOn, beeLiveStopOn } from "./bee.js";
import { bounded, templateVersion, templateUsable, readJson, buildTemplate, startFromTemplate, claimSlotIn, releaseSlotIn } from "../job-template.js";

export const BEE_SLOTS = 3;
export const BEE_INSTANCES = ["lite", "standard-1", "standard-2", "standard-3", "standard-4"];
export const BEE_DEFAULT_INSTANCE = "lite";
// The template's only step. The stock image has everything Bee jobs need, so this just makes the directory a job could use.
export const BEE_TEMPLATE_SETUP = "mkdir -p /opt/1hc-bee";
export const BEE_VERIFY = { command: "node -e 'process.exit(0)'" };
const COORDINATOR = "dependencies:coordinator";
// Image variants and the rule that picks one.
//   "base" is the stock node:22-bookworm image. "slim" is node:22-bookworm-slim.
//   RULE: the lite instance (2 GB disk, 256 MiB memory) always starts the slim image, and standard-1 and larger start base.
//   Evidence (dev, 2026-10-16, Worker d82dbb86): a plain start of the base image on lite failed with "internal error", the same start of
//   the slim image on lite worked. Cloudflare documents that the largest image equals the instance disk
//   (https://developers.cloudflare.com/changelog/post/2026-09-29-remove-disk-to-memory-ratio/).
//   Bee jobs need only bash, sleep, true and node with its built-in https and crypto modules (the job scripts pin their own CA text),
//   and all of those are in slim, so no package is added. A dev benchmark request may still force a variant with bench.image.
export const BEE_IMAGES = ["base", "slim"];
export const beeImageFor = (instance, forced) => BEE_IMAGES.includes(forced) ? forced : instance === "lite" ? "slim" : "base";
const imageKey = (c, variant) => variant === "slim" && c.images?.slim ? "slim" : "base";
// The container with images.base pointing at the chosen variant, so the shared template helpers (job-template.js) work on either image.
export function containerView(container, variant) {
  const key = imageKey(container, variant);
  if (key === "base") return container;
  return new Proxy(container, { get(t, p) { if (p === "images") return { ...t.images, base: t.images[key] }; const v = t[p]; return typeof v === "function" ? v.bind(t) : v; } });
}

// The instance type for a start: the per-request benchmark value when it is allowed, else the BEE_INSTANCE variable, else lite.
export function beeInstance(env, bench) {
  const pick = [bench?.instance, env?.BEE_INSTANCE].find((v) => BEE_INSTANCES.includes(v));
  return pick || BEE_DEFAULT_INSTANCE;
}
// Per-request benchmark options are honored only on dev with TEST_MODE, so a production request can never choose them.
export function benchOptions(env, input) {
  const b = input?.bench;
  if (!b || typeof b !== "object" || env?.ENV_NAME !== "dev" || String(env?.TEST_MODE) !== "1") return null;
  const out = {};
  if (BEE_INSTANCES.includes(b.instance)) out.instance = b.instance;
  if (b.snapshot === "bypass" || b.snapshot === "restore") out.snapshot = b.snapshot;
  if (BEE_IMAGES.includes(b.image)) out.image = b.image;
  if (typeof b.idle === "string" && /^(tail|queue|queue:\d{1,3})$/.test(b.idle)) out.idle = b.idle;
  return out;
}

export class BeeContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }
  get(k) { return this.sql.exec("SELECT v FROM kv WHERE k=?", k).toArray()[0]?.v; }
  put(k, v) { if (v == null) this.sql.exec("DELETE FROM kv WHERE k=?", k); else this.sql.exec("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v)); }
  async version(variant = "base") { return templateVersion(containerView(this.ctx.container, variant).images.base, BEE_TEMPLATE_SETUP, variant === "slim" && this.ctx.container.images.slim ? "bee-slim" : "bee"); }
  tkey(variant) { return variant === "slim" ? "template:slim" : "template"; }
  coordinator() { return this.env.BEE_CONTAINER.get(this.env.BEE_CONTAINER.idFromName(COORDINATOR)); }
  beeIdleValue() { return this.get("bee_idle") || this.env.BEE_IDLE; }
  opts() { return readJson(this.get("bee_opts"), {}) || {}; }
  guardJob() { if (this.get("builder") === "1") throw new Error("template object cannot run Bee jobs"); }

  // ---- slots (no max_instances under this policy) ----
  async claimSlot(id) { return claimSlotIn(this, id, { max: BEE_SLOTS }); }
  async releaseSlot(id) { releaseSlotIn(this, id); }
  async claim() { if (!(await this.coordinator().claimSlot(this.ctx.id.toString()))) throw new Error("bee container capacity reached; retry later"); }
  async release() { try { await this.coordinator().releaseSlot(this.ctx.id.toString()); } catch {} }

  // ---- jobs (same input and answer as Computer.beeJob) ----
  setOptions(input) {
    const o = benchOptions(this.env, input);
    if (o) { this.put("bee_opts", JSON.stringify(o)); if (o.idle) this.put("bee_idle", o.idle); }
  }
  async guarded(input, fn) {
    this.guardJob(); this.setOptions(input);
    await this.claim();
    try { return await fn(); }
    catch (error) { await this.ctx.container.destroy("bee startup failed").catch(() => {}); await this.release(); throw error; }
    finally { if (!this.ctx.container.running) await this.release(); }
  }
  async beeJob(input) { return this.guarded(input, () => beeJobOn(this, input)); }
  async beeLive(input) { return this.guarded(input, () => beeLiveOn(this, input)); }
  async beeLiveStop(run) { return beeLiveStopOn(this, run); }
  // One job with the start details a benchmark needs (all times epoch ms taken here). Same work as beeJob.
  async beeBenchJob(input) {
    const t_request = Date.now(); this._startInfo = null;
    const r = await this.beeJob(input);
    return { result: r, t_process_done: Date.now(), t_request, start: this._startInfo || null, source: this.get("bee_source") || null, snapshot_id: this.get("bee_snapshot_id") || null, instance: this.get("bee_instance") || null, image: this.get("bee_image") || null };
  }
  async alarm() { await beeJobAlarm(this); if (!this.ctx.container.running) await this.release(); }

  // Called by beeUp (bee.js) when the container is not running: restore the template, or start fresh. Marks the source.
  async beeStart() {
    const opts = this.opts(), instance = beeInstance(this.env, opts), control = opts.snapshot === "bypass", variant = imageKey(this.ctx.container, beeImageFor(instance, opts.image));
    const container = containerView(this.ctx.container, variant), version = await this.version(variant);
    const builder = this.coordinator();
    let template = null, fallback = null, failedId = null;
    if (!control) {
      try {
        template = await bounded(builder.peekDependencySnapshotFor(variant), 5000, "template lookup timed out");
        if (!template) { fallback = "template_missing"; this.ctx.waitUntil(builder.dependencySnapshotFor(variant).catch(() => {})); }
      } catch { fallback = "template_unavailable"; }
    }
    let r;
    try {
      r = await startFromTemplate(container, { template, version, instance, control, fallback, label: "bee", onRestoreFailed: (id) => { failedId = id; } });
    } catch (error) {
      // Both the restore and the fresh start failed, so the start itself is failing (for example the instance type cannot run this image).
      // The saved template is not the cause and stays valid. Say which start failed, with the platform's own words.
      throw new Error(`bee container start failed (${control ? "plain image" : "restore then plain image"}, instance ${instance}, image ${variant}): ${String(error?.message || error).slice(0, 300)}`);
    }
    // A restore that failed while a plain start then worked means that handle is bad. Only then is it invalidated.
    if (failedId) this.ctx.waitUntil(builder.invalidateDependencySnapshotFor(variant, failedId).catch(() => {}));
    this._startInfo = { t_start: r.start_called_at, t_ready: r.ready_at, fallback: r.fallback || null };
    this.put("bee_source", r.source); this.put("bee_snapshot_id", r.snapshot_id || ""); this.put("bee_instance", instance); this.put("bee_image", variant);
  }

  // ---- the template builder ----
  async peekDependencySnapshot() { return this.peekDependencySnapshotFor("base"); }
  async peekDependencySnapshotFor(variant) {
    const saved = readJson(this.get(this.tkey(variant)));
    return templateUsable(saved, await this.version(variant)) ? saved : null;
  }
  // The named builder accepts no token, tenant, path or input. The snapshot is captured before this object ever runs a job.
  async dependencySnapshot(args) { return this.dependencySnapshotFor("base", args); }
  async dependencySnapshotFor(variant, { invalidate = null } = {}) {
    const run = async () => {
      if (this.get("role") === "bee") throw new Error("job container cannot become a template");
      this.put("builder", "1");
      const version = await this.version(variant), key = this.tkey(variant), saved = readJson(this.get(key));
      if (templateUsable(saved, version, { invalidate })) return saved;
      this.put(key, "null");
      const made = await buildTemplate(containerView(this.ctx.container, variant), { version, name: `bee-deps-${version.slice(0, 16)}`, steps: [{ script: BEE_TEMPLATE_SETUP }], verify: BEE_VERIFY, label: "bee" });
      this.put(key, JSON.stringify(made)); return made;
    };
    this._templateQ = (this._templateQ || Promise.resolve()).catch(() => {}).then(run); return this._templateQ;
  }
  async invalidateDependencySnapshot(id) { return this.invalidateDependencySnapshotFor("base", id); }
  async invalidateDependencySnapshotFor(variant, id) {
    const run = () => { const key = this.tkey(variant), saved = readJson(this.get(key)); if (saved?.handle?.id === id) this.put(key, "null"); };
    this._templateQ = (this._templateQ || Promise.resolve()).catch(() => {}).then(run); return this._templateQ;
  }

  // ---- benchmark support (dev only callers) ----
  async beeBenchmarkStatus() { return { running: this.ctx.container.running, last: Number(this.get("bee_last") || 0), source: this.get("bee_source") || null, snapshot_id: this.get("bee_snapshot_id") || null, image: this.ctx.container.images.base, instance: this.get("bee_instance") || null }; }
  async beeBenchmarkReset() {
    const run = async () => { await this.ctx.container.destroy("bee benchmark reset"); this.put("bee_last", "0"); this.put("bee_opts", null); this.put("bee_idle", null); this.put("bee_source", null); this.put("bee_snapshot_id", null); this.put("bee_image", null); await this.release(); return { running: false }; };
    this._resetQ = (this._resetQ || Promise.resolve()).catch(() => {}).then(run); return this._resetQ;
  }
}
