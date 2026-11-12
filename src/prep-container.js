import { DurableObject } from "cloudflare:workers";
import { prepJobOn, prepJobAlarm, PREP_SETUP } from "./sidecar.js";
import { embedSetup, EMBED_INSTANCE } from "./selfhost-models.js";
import { bounded, ready, runSetup, withCurlRetry, templateVersion, templateUsable, readJson, buildTemplate, startFromTemplate, claimSlotIn, releaseSlotIn } from "./job-template.js";

// The shared helpers live in job-template.js. These names stay exported from here for existing callers and tests.
export { bounded, ready };
export const TEMPLATE_SETUP = withCurlRetry(PREP_SETUP);
export const setup = (container, op) => runSetup(container, TEMPLATE_SETUP, [op], { label: "prep" });
const VERIFY_NODE = 'node -e \'require("/opt/1hc-prep/node_modules/@firecrawl/anydoc");require("/opt/1hc-prep/node_modules/@firecrawl/pdf-inspector")\'';
const VERIFY_ENV = { INDRA_OCR_MODEL_DIR: "/opt/1hc-prep/models", HF_HUB_OFFLINE: "1", PYTHONDONTWRITEBYTECODE: "1" };
// Template variants. "full" is the one prep uses (md and ocr dependencies). "md" holds only the npm packages and exists for
// the restore size probe. Its version differs from the full one, so the two never mix.
export const TEMPLATE_VARIANTS = {
  full: { key: "template", tag: "", ops: ["md", "ocr"], verify: { command: `${VERIFY_NODE} && /opt/1hc-prep/venv/bin/python -c 'import indra_ocr, onnxruntime, cv2, pypdfium2'`, env: VERIFY_ENV }, namePrefix: "prep-deps-" },
  md: { key: "template_md", tag: "md-only", ops: ["md"], verify: { command: VERIFY_NODE }, namePrefix: "prep-deps-md-" },
  // The self-hosted embedding model (selfhost-models.js): its own Python environment and pinned weights, built and restored on its own instance size.
  // It has its own setup script, so the "full" template's version (the image digest plus PREP_SETUP) is not changed by it.
  embed: { key: "template_embed", tag: "embed-selfhost", ops: ["embed"], script: () => embedSetup(), instance: EMBED_INSTANCE, verify: { command: "/opt/1hc-prep/venv-embed/bin/python -c 'import onnxruntime, tokenizers, numpy' && test -f /opt/1hc-prep/embed-models/model_quantized.onnx_data" }, namePrefix: "prep-deps-embed-" },
};
const variantOf = v => TEMPLATE_VARIANTS[v] || TEMPLATE_VARIANTS.full;

// Only this class uses the new scheduling policy. The shared Computer class
// continues to serve Bee, Live and self hosting with its existing policy.
export class PrepContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }
  get(k) { return this.sql.exec("SELECT v FROM kv WHERE k=?", k).toArray()[0]?.v; }
  put(k, v) { this.sql.exec("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v)); }
  async version() { return this.versionFor("full"); }
  async versionFor(variant = "full") { const v = variantOf(variant); return templateVersion(this.ctx.container.images.base, v.script ? v.script() : PREP_SETUP, v.tag); }
  async prepJob(input) { if (this.get("builder") === "1") throw new Error("template object cannot process files"); return prepJobOn(this, input); }
  coordinator() { return this.env.PREP_CONTAINER.get(this.env.PREP_CONTAINER.idFromName("dependencies:coordinator")); }
  // No cap: every account's prep object can start its own container. The leases only record which objects are up.
  async claimSlot(id) { return claimSlotIn(this, id, { max: Infinity }); }
  async releaseSlot(id) { releaseSlotIn(this, id); }
  async prepRelease() { await this.coordinator().releaseSlot(this.ctx.id.toString()); }
  async peekDependencySnapshot() { return this.peekDependencySnapshotFor("full"); }
  async peekDependencySnapshotFor(variant = "full") {
    const version = await this.versionFor(variant);
    const saved = readJson(this.get(variantOf(variant).key));
    return templateUsable(saved, version) ? saved : null;
  }
  async alarm() { return prepJobAlarm(this); }
  async prepBenchmarkStatus() { return { running: this.ctx.container.running, last: Number(this.get("prep_last") || 0), source: this.get("prep_source") || null, image: this.ctx.container.images.base, stopped_at: Number(this.get("prep_stopped_at") || 0) || null, idle: this.get("prep_idle") || null }; }
  async prepBenchmarkReset() {
    const run = async () => { await this.ctx.container.destroy("prep benchmark reset"); this.put("prep_last", "0"); this.put("prep_stopped_at", String(Date.now())); await this.prepRelease(); return { running: false }; };
    this._prepQ = (this._prepQ || Promise.resolve()).catch(() => {}).then(run); return this._prepQ;
  }
  // The named builder accepts no file path, input bytes or tenant identity.
  // Every snapshot is captured before this container ever handles a file.
  async dependencySnapshot({ invalidate = null } = {}) { return this.dependencySnapshotFor("full", { invalidate }); }
  async dependencySnapshotFor(variant = "full", { invalidate = null } = {}) {
    const v = variantOf(variant);
    const run = async () => {
      if (this.get("role") === "prep") throw new Error("job container cannot become a template");
      this.put("builder", "1");
      const version = await this.versionFor(variant);
      const saved = readJson(this.get(v.key));
      if (templateUsable(saved, version, { invalidate })) return saved;
      this.put(v.key, "null");
      const built = await buildTemplate(this.ctx.container, {
        version, name: `${v.namePrefix}${version.slice(0, 16)}`, label: "prep",
        steps: v.ops.map(op => ({ script: v.script ? withCurlRetry(v.script()) : TEMPLATE_SETUP, args: [op] })), verify: v.verify, ...(v.instance ? { instance: v.instance } : {}),
      });
      this.put(v.key, JSON.stringify(built)); return built;
    };
    this._templateQ = (this._templateQ || Promise.resolve()).catch(() => {}).then(run);
    return this._templateQ;
  }
  async prepStart({ snapshot = "restore", template: requested = "full" } = {}) {
    const variant = requested === "md" ? "md" : requested === "embed" ? "embed" : "full", version = await this.versionFor(variant);
    if (this.get("builder") === "1") throw new Error("template object cannot process files");
    if (!(await this.coordinator().claimSlot(this.ctx.id.toString()))) throw new Error("prep container capacity reached; retry later");
    try {
      if (this.ctx.container.running && this.get("prep_version") === version) return { source: this.get("prep_source"), warm: true, version, image: this.ctx.container.images.base, snapshot_id: this.get("prep_snapshot_id") || null };
      if (this.ctx.container.running) await this.ctx.container.destroy("prep dependency version changed");
      let template, fallback = null;
      if (snapshot !== "bypass") {
        const builder = this.coordinator();
        try {
          template = await bounded(variant === "full" ? builder.peekDependencySnapshot() : builder.peekDependencySnapshotFor(variant), 5000, "template lookup timed out");
          if (!template) { fallback = "template_missing"; this.ctx.waitUntil((variant === "full" ? builder.dependencySnapshot() : builder.dependencySnapshotFor(variant)).catch(() => {})); }
        } catch { fallback = "template_unavailable"; }
      }
      const started = await startFromTemplate(this.ctx.container, {
        template, version, control: snapshot === "bypass", fallback, label: "prep", ...(variantOf(variant).instance ? { instance: variantOf(variant).instance } : {}),
        // Invalidate the exact failed handle, without touching a replacement
        // another requester may have created. Rebuild before a later request.
        onRestoreFailed: id => { const builder = this.coordinator(); this.ctx.waitUntil((variant === "full" ? builder.invalidateDependencySnapshot(id) : builder.invalidateDependencySnapshotFor(variant, id)).catch(() => {})); },
      });
      this.put("prep_source", started.source); this.put("prep_snapshot_id", started.snapshot_id || "");
      this.put("prep_version", version);
      return { source: started.source, warm: false, version, fallback: started.fallback, image: this.ctx.container.images.base, snapshot_id: started.snapshot_id, start_called_at: started.start_called_at, ready_at: started.ready_at };
    } catch (error) {
      await this.ctx.container.destroy("prep startup failed").catch(() => {});
      await this.prepRelease();
      throw error;
    }
  }
  async invalidateDependencySnapshot(id) { return this.invalidateDependencySnapshotFor("full", id); }
  async invalidateDependencySnapshotFor(variant, id) {
    const key = variantOf(variant).key;
    const run = () => { const saved = readJson(this.get(key)); if (saved?.handle?.id === id) this.put(key, "null"); };
    this._templateQ = (this._templateQ || Promise.resolve()).catch(() => {}).then(run); return this._templateQ;
  }
}
