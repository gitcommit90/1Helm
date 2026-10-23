// The speech container: a pool of standard-4 containers, each holding Qwen3-ASR, Nemotron ASR and Nemotron diarization loaded (selfhost-speech.js has the client,
// speech-setup.js what is installed, speech-server-py.js the server inside).
//
// Why a class of its own and not a PrepContainer template: the prep class keeps one object per account, runs one job at a time by copying a file in and
// executing a command, and stops ten seconds after the last job. Speech needs the opposite: containers that several accounts share, keep three models in
// memory for ten minutes, and answer HTTP requests (many at once). It reuses everything else from job-template.js (the template build, the snapshot rules).
//
// Objects: "speech:coordinator" builds and keeps the snapshot template and the speaker numbers of live sessions, and never runs a request. "speech:0" to
// "speech:<cap - 1>" each own one container. The cap is the variable SPEECH_MAX_INSTANCES, because the durable_object scheduling policy has no max_instances
// (docs: "Enforce any per-application cap in application code"). Nothing is always on: a slot starts only when a call finds no ready slot, and stops
// SPEECH_IDLE_MS after its last request.
import { DurableObject } from "cloudflare:workers";
import { bounded, delay, templateVersion, templateUsable, readJson, buildTemplate, withCurlRetry } from "./job-template.js";
import { speechSetup, SPEECH_VERIFY, SPEECH_ROOT, SPEECH_INSTANCE, SPEECH_MAX_INFLIGHT } from "./speech-setup.js";

export { SPEECH_INSTANCE, SPEECH_MAX_INFLIGHT };
export const SPEECH_PORT = 8080;
export const SPEECH_IDLE_MS = 10 * 60e3;       // a container stops this long after its last request
export const SPEECH_BOOT_MS = 10 * 60e3;       // the longest a restore plus model load may take
export const SPEECH_ALARM_MS = 30e3;
export const SPEECH_TIMING = { templatePollMs: 5000, healthPollMs: 500 };   // a test shortens them
export const SPEECH_ENTRYPOINT = ["bash", `${SPEECH_ROOT}/start.sh`];
export const SPEECH_TAG = "speech-selfhost";
const SESSION_KEEP_MS = 12 * 3600e3;

export class SpeechContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sess (k TEXT PRIMARY KEY, v TEXT NOT NULL, t INTEGER NOT NULL)");
    this.inflight = 0; this.up = false; this._boot = null;
  }
  get(k) { return this.sql.exec("SELECT v FROM kv WHERE k=?", k).toArray()[0]?.v; }
  put(k, v) { this.sql.exec("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v)); }
  async version() { return templateVersion(this.ctx.container.images.base, speechSetup(), SPEECH_TAG); }
  coordinator() { return this.env.SPEECH_CONTAINER.get(this.env.SPEECH_CONTAINER.idFromName("speech:coordinator")); }

  // ---- coordinator: the template and the speaker numbers of live sessions ----
  async peekTemplate() {
    const saved = readJson(this.get("template"));
    return templateUsable(saved, await this.version()) ? saved : null;
  }
  async buildTemplate({ invalidate = null } = {}) {
    const run = async () => {
      this.put("builder", "1");
      const version = await this.version();
      const saved = readJson(this.get("template"));
      if (templateUsable(saved, version, { invalidate })) return saved;
      this.put("template", "null");
      this.put("build_wanted", String(Date.now()));
      await this.ctx.storage.setAlarm(Date.now() + 5 * 60e3).catch(() => {});
      const built = await buildTemplate(this.ctx.container, {
        version, name: `speech-${version.slice(0, 16)}`, label: "speech", instance: SPEECH_INSTANCE,
        steps: [{ script: withCurlRetry(speechSetup()), args: ["speech"] }], verify: { command: SPEECH_VERIFY, timeout: 120000 },
        setupMs: 900000, snapshotMs: 600000,
      });
      this.put("template", JSON.stringify(built)); this.put("build_wanted", ""); return built;
    };
    this._tq = (this._tq || Promise.resolve()).catch(() => {}).then(run); return this._tq;
  }
  async invalidateTemplate(id) {
    const run = () => { const saved = readJson(this.get("template")); if (saved?.handle?.id === id) this.put("template", "null"); };
    this._tq = (this._tq || Promise.resolve()).catch(() => {}).then(run); return this._tq;
  }
  // The speaker numbers returned for a session so far (speech-selfhost.js keeps later calls consistent with them).
  async sessionGet(key) { return readJson(this.sql.exec("SELECT v FROM sess WHERE k=?", String(key)).toArray()[0]?.v, null); }
  async sessionPut(key, turns) {
    this.sql.exec("DELETE FROM sess WHERE t<?", Date.now() - SESSION_KEEP_MS);
    this.sql.exec("INSERT INTO sess VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, t=excluded.t", String(key), JSON.stringify(turns), Date.now());
    return true;
  }
  async sessionDrop(key) { this.sql.exec("DELETE FROM sess WHERE k=?", String(key)); return true; }

  // ---- a slot: one container ----
  state() { return this.ctx.container.running ? (this.up ? "ready" : "warming") : (this._boot ? "warming" : "cold"); }
  async speechState() {
    if (this.get("builder") === "1") return { state: "cold", inflight: 0 };
    await this.recover();
    return { state: this.state(), inflight: this.inflight, booting: !!this._boot };
  }
  // A container that runs while this object does not know it is ready (the object was evicted or the Worker was deployed): ask the server, and when it does not
  // answer ready, start the wait-and-check that a start runs. So "warming" always means a start is in progress and will end in ready or in a stopped container.
  async recover() {
    if (!this.ctx.container.running || this.up || this._boot) return;
    if (await this.probe()) return;
    await this.warm();
  }
  async probe() {
    try { const j = await this.health(1500); if (j?.ready) { this.up = true; if (!this.get("last")) this.put("last", String(Date.now())); } } catch {}
    return this.up;
  }
  async health(ms = 3000) {
    const r = await bounded(this.ctx.container.getTcpPort(SPEECH_PORT).fetch("http://speech/health"), ms, "health timed out");
    return r.json();
  }
  // Starts the container in the background and returns at once.
  async warm() {
    if (this.get("builder") === "1") throw new Error("template object cannot run speech");
    if (this.state() === "ready") return { state: "ready" };
    if (!this._boot) {
      this.put("boot_at", String(Date.now())); this.put("last", String(Date.now()));
      this._boot = this.bootRun().catch((e) => this.bootFailed(e)).finally(() => { this._boot = null; });
    }
    await this.ctx.storage.setAlarm(Date.now() + SPEECH_ALARM_MS).catch(() => {});
    return { state: "warming" };
  }
  // A start that failed: the container is destroyed, and when the same template failed twice in a row it is thrown away so the next start builds a new one.
  async bootFailed(e) {
    this.put("boot_error", String(e?.message || e).slice(0, 300));
    const fails = Number(this.get("boot_fails") || 0) + 1; this.put("boot_fails", String(fails));
    if (this.ctx.container.running) await this.ctx.container.destroy("speech start failed").catch(() => {});
    this.down("start failed");
    if (fails >= 2 && this.get("snapshot_id")) { this.put("boot_fails", "0"); await this.coordinator().invalidateTemplate(this.get("snapshot_id")).catch(() => {}); }
  }
  async bootRun() {
    const c = this.ctx.container, t0 = Date.now();
    if (!c.running) {
      const version = await this.version(), co = this.coordinator();
      let template = null;
      try { template = await bounded(co.peekTemplate(), 5000, "template lookup timed out"); } catch {}
      if (!template) {
        // No usable template yet: one builder container makes it (a minute or more, once), and this slot restores from it when it exists.
        co.buildTemplate().catch(() => {});
        const until = Date.now() + 20 * 60e3;
        while (!template && Date.now() < until) { await delay(SPEECH_TIMING.templatePollMs); try { template = await bounded(co.peekTemplate(), 5000, "template lookup timed out"); } catch {} }
        if (!template) throw new Error("the speech template was not built in time");
      }
      const startAt = Date.now(); this.put("start_at", String(startAt)); this.put("port_ms", "");
      try { c.start({ containerSnapshot: template.handle, entrypoint: SPEECH_ENTRYPOINT, enableInternet: false, instance: SPEECH_INSTANCE }); }
      catch (e) { this.coordinator().invalidateTemplate(template.handle?.id).catch(() => {}); throw e; }
      this.put("start_call_ms", String(Date.now() - startAt)); this.put("snapshot_id", template.handle?.id || ""); this.put("run_from", String(Date.now()));
      c.monitor?.().then(() => this.down("exit"), (e) => this.down(String(e?.message || e)));
    }
    const until = t0 + SPEECH_BOOT_MS;
    let last = null;
    while (Date.now() < until) {
      if (!c.running) throw new Error("the speech container stopped while starting");
      try {
        last = await this.health(2500);
        if (!this.get("port_ms")) this.put("port_ms", String(Date.now() - Number(this.get("start_at") || t0)));   // the server answered: restore, container start and Python start are done
        if (last?.ready) { this.up = true; this.put("ready_at", String(Date.now())); this.put("boot_ms", String(Date.now() - t0)); this.put("boot_fails", "0"); this.put("boot_error", ""); return; }
        if (last?.errors && Object.keys(last.errors).length) throw new Error(`a speech model did not load (${JSON.stringify(last.errors).slice(0, 200)})`);
      } catch (e) { if (/did not load/.test(String(e?.message))) throw e; }
      await delay(SPEECH_TIMING.healthPollMs);
    }
    throw new Error("the speech container was not ready in time");
  }
  down(why) {
    this.up = false; this.put("stopped_at", String(Date.now())); this.put("down_reason", String(why).slice(0, 120));
    const from = Number(this.get("run_from") || 0); if (from) { this.put("run_s", String(Number(this.get("run_s") || 0) + (Date.now() - from) / 1000)); this.put("run_from", "0"); }
  }
  async stop(why = "speech stop") {
    if (this.ctx.container.running) await this.ctx.container.destroy(why).catch(() => {});
    this.down(why); return { state: "cold" };
  }
  // One HTTP request to the server in the container: { method, path, body } -> { state: "ok", status, body } or { state } when the container is not ready.
  async speechRequest({ method = "POST", path, body = null }) {
    if (this.get("builder") === "1") throw new Error("template object cannot run speech");
    if (typeof path !== "string" || !path.startsWith("/")) throw new Error("bad path");
    await this.recover();
    if (!this.up || !this.ctx.container.running) { this.up = false; if (!this._boot) await this.warm().catch(() => {}); return { state: this.state() }; }
    this.inflight++;
    try {
      const r = await bounded(this.ctx.container.getTcpPort(SPEECH_PORT).fetch(`http://speech${path}`, { method, ...(body ? { body } : {}) }), 20 * 60e3, "the speech request timed out");
      return { state: "ok", status: r.status, body: await r.text() };
    } catch (e) {
      if (!this.ctx.container.running) this.down("request failed");
      throw e;
    } finally {
      this.inflight--; this.put("last", String(Date.now()));
      if ((await this.ctx.storage.getAlarm?.()) == null) await this.ctx.storage.setAlarm(Date.now() + SPEECH_ALARM_MS).catch(() => {});
    }
  }
  async status() {
    const from = Number(this.get("run_from") || 0);
    return { state: this.state(), inflight: this.inflight, running: this.ctx.container.running, boot_ms: Number(this.get("boot_ms") || 0) || null, boot_error: this.get("boot_error") || null, snapshot_id: this.get("snapshot_id") || null,
      start_call_ms: Number(this.get("start_call_ms") || 0) || null, port_ms: Number(this.get("port_ms") || 0) || null, run_s: Number(this.get("run_s") || 0) + (from ? (Date.now() - from) / 1000 : 0), last: Number(this.get("last") || 0) };
  }
  async alarm() {
    const c = this.ctx.container;
    if (this.get("builder") === "1") {
      // A build that was asked for and has not produced a template (the object was evicted): start it again.
      if (this.get("build_wanted") && !(await this.peekTemplate())) this.buildTemplate().catch(() => {});
      return;
    }
    if (!c.running) { this.up = false; return; }
    if (this._boot || this.inflight > 0) { await this.ctx.storage.setAlarm(Date.now() + SPEECH_ALARM_MS); return; }
    if (!this.up) {
      // Running but not known to be ready: the object was evicted during a start. Check the server, or give up on a start that took too long.
      if (!(await this.probe())) {
        if (Date.now() - Number(this.get("boot_at") || 0) > SPEECH_BOOT_MS) { await this.stop("speech start took too long"); return; }
        await this.ctx.storage.setAlarm(Date.now() + SPEECH_ALARM_MS); return;
      }
    }
    const last = Number(this.get("last") || 0), idle = Number(this.env?.SPEECH_IDLE_MS) || SPEECH_IDLE_MS;
    if (Date.now() - last >= idle) { await this.stop("speech idle"); return; }
    await this.ctx.storage.setAlarm(Math.min(last + idle, Date.now() + SPEECH_ALARM_MS * 4));
  }
}
