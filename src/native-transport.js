// Platform-only broker: no agent programs, public route, computer link or tailnet listener.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import nacl from "tweetnacl";
import { sealSecret, openSecret } from "./sentinel.js";
import { installSnapshotRpc } from "./sqlite-snapshot.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (b) => btoa(String.fromCharCode(...b)),
  bytes = (s) => Uint8Array.from(atob(s), (x) => x.charCodeAt(0));
const RATE = Math.ceil(
  (0.0000025 + 0.25 * 0.00002 + 4 * 0.00000007) * 1e9 * 1.15,
); // basic, existing prepaid compute model
const bad = (error) => ({ ok: false, state: "error", error });
const equalTarget = (a, b) =>
  [
    "host",
    "port",
    "user",
    "route",
    "address",
    "peerId",
    "peerRoute",
    "tailnetEpoch",
  ].every((k) => (a[k] ?? null) === (b[k] ?? null));
// Authorization is separate from the known-host cache. Names are normalized at
// the trusted resolver entry; resolved addresses/peer identity still match exactly.
const trustScope = o => JSON.stringify([o.host, o.port, o.user, o.route]);
const trustView = s => ({ id:s.id, destination:s.host, address:s.address, port:s.port, username:s.user, route:s.route, fingerprint:s.fingerprint, created_at:s.created_at, ...(s.revoking ? {state:'revocation_pending'} : {}) });

export class NativeTransportState extends WorkerEntrypoint {
  async fetch(req) {
    if (req.method !== "POST" || new URL(req.url).pathname !== "/state")
      return new Response("not found", { status: 404 });
    if (Number(req.headers.get("content-length") || 0) > 256 * 1024)
      return new Response("too large", { status: 413 });
    const text = await req.text();
    if (text.length > 256 * 1024)
      return new Response("too large", { status: 413 });
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return new Response("invalid", { status: 400 });
    }
    const p = this.ctx.props,
      B = this.env.NATIVE_TRANSPORT.get(
        this.env.NATIVE_TRANSPORT.idFromString(p.id),
      ),
      ok = await B.saveTailState(p.epoch, p.incarnation, data);
    return Response.json({ ok }, { status: ok ? 200 : 409 });
  }
}
export class NativeTransport extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS native_kv(k TEXT PRIMARY KEY,v TEXT NOT NULL)",
    );
    if (ctx.container?.running && !this.snapshotMaintenance()) {
      ctx.container.monitor().catch(() => {});
      ctx.waitUntil(this.reconcileTailInvalidation().catch(() => {}));
      ctx.waitUntil(ctx.storage.setAlarm(Date.now() + 10e3));
    }
  }
  get(k, d = null) {
    const s = this.sql
      .exec("SELECT v FROM native_kv WHERE k=?", k)
      .toArray()[0]?.v;
    return s === undefined ? d : JSON.parse(s);
  }
  snapshotMaintenance() { return this.env?.ENV_NAME === "selfhost" && this.env?.BACKUP_MAINTENANCE === "1"; }
  async snapshotPrepare() {
    if (!this.snapshotMaintenance()) throw new Error("snapshot unavailable");
    if (this.inflight || this._rotation || this._starting || this._identity || this._disconnecting) throw new Error("object is busy; stop writes and retry backup");
    await this.stop();
  }
  put(k, v) {
    this.sql.exec(
      "INSERT INTO native_kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
      k,
      JSON.stringify(v),
    );
  }
  drop(k) {
    this.sql.exec("DELETE FROM native_kv WHERE k=?", k);
  }
  epoch() {
    return this.get("tail_epoch", 0);
  }
  owner(o) {
    if (this.snapshotMaintenance()) throw new Error("native transport unavailable during backup maintenance");
    if (
      !o?.tenant ||
      !o?.channel ||
      this.env.NATIVE_TRANSPORT.idFromName(
        `${o.tenant}:${o.channel}`,
      ).toString() !== this.ctx.id.toString()
    )
      throw new Error("Wrong channel computer");
    const own = { tenant: String(o.tenant), channel: String(o.channel) },
      prior = this.get("owner");
    if (prior && (prior.tenant !== own.tenant || prior.channel !== own.channel))
      throw new Error("Wrong channel computer");
    if (!prior) {
      this.put("owner", own);
      this.put("incarnation", crypto.randomUUID());
    }
    return own;
  }
  async sealed(value) {
    return sealSecret(
      this.env,
      JSON.stringify({ owner: this.get("owner"), value }),
    );
  }
  async unseal(value) {
    const x = JSON.parse(await openSecret(this.env, value)),
      o = this.get("owner");
    if (x.owner.tenant !== o?.tenant || x.owner.channel !== o?.channel)
      throw new Error("Wrong encrypted state owner");
    return x.value;
  }
  async identity(o) {
    this.owner(o);
    if (!this._identity)
      this._identity = this.makeIdentity().finally(() => {
        this._identity = null;
      });
    return this._identity;
  }
  async makeIdentity() {
    const generation = this.get("key_epoch", 0);
    let sealed = this.get("seed");
    if (!sealed) {
      const seed = crypto.getRandomValues(new Uint8Array(32));
      sealed = await this.sealed(b64(seed));
      if (generation !== this.get("key_epoch", 0))
        throw new Error("SSH identity changed during generation");
      this.put("seed", sealed);
      seed.fill(0);
    }
    const seed = bytes(await this.unseal(sealed)),
      pub = nacl.sign.keyPair.fromSeed(seed).publicKey;
    seed.fill(0);
    const name = new TextEncoder().encode("ssh-ed25519"),
      wire = new Uint8Array(8 + name.length + pub.length),
      dv = new DataView(wire.buffer);
    dv.setUint32(0, name.length);
    wire.set(name, 4);
    dv.setUint32(4 + name.length, pub.length);
    wire.set(pub, 8 + name.length);
    const key = {
      public_key: `ssh-ed25519 ${b64(wire)}`,
      fingerprint: `SHA256:${b64(new Uint8Array(await crypto.subtle.digest("SHA-256", wire))).replace(/=+$/, "")}`,
      algorithm: "Ed25519",
    };
    if (generation !== this.get("key_epoch", 0))
      throw new Error("SSH identity changed during generation");
    this.put("public_key", key);
    return { ok: true, key };
  }
  async rotateIdentity(o) {
    this.owner(o);
    if (this._rotation) return this._rotation;
    this._rotation = this.rotateIdentityInner(o).finally(() => { this._rotation = null; });
    return this._rotation;
  }
  async rotateIdentityInner(o) {
    this.owner(o);
    this.put("key_epoch", this.get("key_epoch", 0) + 1);
    this.put("trusted_servers", []);
    await this.closeAll(o);
    if (this._starting) await this._starting.catch(() => {});
    if (this._identity) await this._identity.catch(() => {});
    if (this.ctx.container.running) await this.stop();
    this.drop("seed");
    this.drop("public_key");
    return this.identity(o);
  }
  async permission(o, generation = null, requireTrusted = false) {
    let p;
    try {
      p = await this.env.DB.prepare(
        "SELECT ssh_mode,ssh_trusted,generation FROM direct_network_permissions WHERE tenant_id=?",
      )
        .bind(o.tenant)
        .first();
    } catch {}
    return (
      p?.ssh_mode === "ask" &&
      (!requireTrusted || p.ssh_trusted === 1) &&
      (generation === null || Number(p.generation) === Number(generation))
    );
  }
  async pay() {
    if (this.get("paid_until", 0) > Date.now() + 15e3) return;
    const o = this.get("owner"),
      L = this.env.LEDGER.get(this.env.LEDGER.idFromName(`tenant:${o.tenant}`)),
      id = `native-computer:${crypto.randomUUID()}`,
      nano = RATE * 60,
      r = await L.reserve(id, nano);
    if (!r.ok)
      throw new Error(
        r.reason === "day_limit"
          ? "Daily computer safety limit reached"
          : "Out of computer credits",
      );
    await L.settle(id, nano);
    this.put(
      "paid_until",
      Math.max(Date.now(), this.get("paid_until", 0)) + 60e3,
    );
  }
  async raw(op, data = {}) {
    const r = await this.ctx.container
      .getTcpPort(8787)
      .fetch("http://broker/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...this.get("owner"), ...data, op }),
        signal: AbortSignal.timeout(["exec", "sftp"].includes(op) ? 125e3 : 50e3),
      });
    if (!r.ok) throw new Error("Trusted transport unavailable");
    return r.json();
  }
  async start() {
    if (!this.ctx.container.running)
      this.ctx.container.start({ enableInternet: true });
    this.ctx.container.monitor().catch(() => {});
    let last = "no health response";
    const deadline = Date.now() + 30e3;
    while (Date.now() < deadline) {
      try {
        const r = await this.ctx.container
          .getTcpPort(8787)
          .fetch("http://broker/health", {signal: AbortSignal.timeout(2000)});
        if (r.ok) return;
        last = `health HTTP ${r.status}`;
      } catch (e) {
        last = String(e.message || e);
      }
      await sleep(250);
    }
    throw new Error(`Trusted transport did not start: ${last}`);
  }
  async ensure() {
    if (this._rotation) await this._rotation;
    if (this._disconnecting) await this._disconnecting;
    if (this._stopping) await this._stopping;
    await this.reconcileTailInvalidation();
    if (this._starting) return this._starting;
    this._starting = (async () => {
      const keyEpoch = this.get("key_epoch", 0), startEpoch = this.epoch();
      await this.pay();
      await this.identity(this.get("owner"));
      const epoch = this.epoch(),
        incarnation = this.get("incarnation");
      if (keyEpoch !== this.get("key_epoch",0) || startEpoch !== epoch) throw new Error("Computer identity changed during startup");
      await this.ctx.container.interceptOutboundHttp(
        "native-state.internal",
        this.ctx.exports.NativeTransportState({
          props: { id: this.ctx.id.toString(), epoch, incarnation },
        }),
      );
      await this.start();
      const r = await this.raw("configure", {
        seed: await this.unseal(this.get("seed")),
        state: this.get("tail_state")
          ? await this.unseal(this.get("tail_state"))
          : {},
        epoch,
        keyEpoch,
      });
      if (keyEpoch !== this.get("key_epoch",0) || epoch !== this.epoch() || incarnation !== this.get("incarnation")) throw new Error("Computer identity changed during startup");
      if (!r.ok)
        throw new Error(
          "Trusted computer incarnation changed; restart required",
        );
      this.put("broker_tail_epoch", epoch);
      this.put("last_activity", Date.now());
      await this.ctx.storage.setAlarm(Date.now() + 10e3);
    })().catch(async e => { await this.stop(); throw e; }).finally(() => {
      this._starting = null;
    });
    return this._starting;
  }
  async rpc(op, data = {}) {
    await this.ensure();
    this.put("last_activity", Date.now());
    return this.raw(op, data);
  }
  async saveTailState(epoch, incarnation, data) {
    if (this.snapshotMaintenance()) return false;
    if (
      epoch !== this.epoch() ||
      incarnation !== this.get("incarnation") ||
      data?.epoch !== epoch ||
      !this.get("tail_enabled", false)
    )
      return false;
    if (
      !data.state ||
      Array.isArray(data.state) ||
      typeof data.state !== "object" ||
      Object.values(data.state).some((v) => typeof v !== "string")
    )
      return false;
    const sealed = await this.sealed(data.state);
    if (
      epoch !== this.epoch() ||
      incarnation !== this.get("incarnation") ||
      !this.get("tail_enabled", false)
    )
      return false;
    this.put("tail_state", sealed);
    return true;
  }
  async saveTailStatus(r,epoch=this.epoch()) {
    if(epoch!==this.epoch()||!this.get("tail_enabled",false))return {state:"disconnected"};
    // The broker may be running for public SSH while its tsnet client has not
    // started. That is not logout: only platform-owned enrollment state decides
    // whether this computer was disconnected. Never promote cached membership.
    if(r.state === "disconnected") r = {state:"offline_reconnecting",error:"The native Tailscale client is not running. Verify the saved connection; do not enroll another device."};
    r = {...r,verified:r.state === "connected",checked_at:Date.now()};
    const out = { ...r };
    delete out.login_url;
    this.put("tail_status", out);
    if (r.login_url){
      const sealed=await this.sealed({
          url: r.login_url,
          expires: Date.now() + 10 * 60e3,
          epoch,
        });
      if(epoch!==this.epoch()||!this.get("tail_enabled",false))return {state:"disconnected"};
      this.put("login_url",sealed);
    }
    else if (r.state === "connected" || r.state === "disconnected")
      this.drop("login_url");
    return r;
  }
  async cachedTail() {
    let s = this.get("tail_enabled", false)
      ? {
          ...this.get("tail_status", {}),
          state: "offline_reconnecting",
          verified: false,
          next: "The computer is sleeping; the next native operation verifies membership again.",
        }
      : { state: "disconnected" };
    if (this.get("login_url")) {
      try {
        const l = await this.unseal(this.get("login_url"));
        if (l.epoch === this.epoch() && l.expires > Date.now())
          s = { state: "awaiting_user_approval", login_url: l.url };
        else this.drop("login_url");
      } catch {
        this.drop("login_url");
      }
    }
    return s;
  }
  async status(o) {
    this.owner(o);
    await this.reconcileTailInvalidation();
    const epoch=this.epoch();
    let client = {
        state: "sleeping",
        implementation: "Go SSH/SFTP + tsnet",
        version: "tailscale-1.104.1",
      },
      healthy = true;
    let sessions = [],
      tailscale = await this.cachedTail();
    if (this.ctx.container.running) {
      try {
        const r = await this.raw("status"),
          prior = this.get("sessions", []);
        if (r?.ok !== true) throw new Error("Transport status unavailable");
        client.state = "verified_ready";
        sessions = (r.sessions || []).filter(s=>prior.some(p=>p.id===s.id)).map((s) => ({
          ...prior.find((p) => p.id === s.id),
          ...s,
        }));
        tailscale = await this.saveTailStatus(
          r.tailscale || { state: "error" }, epoch,
        );
        sessions = sessions.filter(s=>this.get("sessions",[]).some(p=>p.id===s.id));
        this.put("sessions", sessions);
        await this.pruneTailSessions(o);
        sessions = this.get("sessions", []);
      } catch {
        healthy = false;
        client.state = "error";
        tailscale = { state: "error", error: "Trusted transport unavailable" };
      }
    } else this.put("sessions", []);
    return {
      ok: healthy,
      available: healthy,
      client,
      key: this.get("public_key"),
      trusted_servers: await this.trustedServers(o),
      sessions,
      tailscale,
      origin:
        "This channel's 1HC computer, using an isolated platform transport",
    };
  }
  // Dev ops only: no wake, RPC, key generation, or state changes. Never return
  // enrollment material, login links, profile names, node keys, or addresses.
  async enrollmentDiagnostic(o) {
    if (this.env.ENV_NAME !== "dev") throw new Error("Not available");
    const own = this.get("owner");
    if (!own || own.tenant !== o?.tenant || own.channel !== o?.channel) return { initialized: false };
    const out = { initialized: true, running: !!this.ctx.container.running,
      enabled: this.get("tail_enabled", false), state: this.get("tail_status", {}).state || null };
    if (!this.get("tail_state")) return { ...out, saved: false };
    const state = await this.unseal(this.get("tail_state"));
    const read = k => { try { return JSON.parse(new TextDecoder().decode(bytes(state[k]))); } catch { return null; } };
    const p = read("_daemon"), profiles = read("_profiles");
    return { ...out, saved: true, machine_key_present: !!state._machinekey,
      registered_marker: !!state._1hc_authenticated_enrollment,
      pending_present: !!state._1hc_pending_enrollment,
      legacy_present: !!p, legacy_node_key_present: !!p?.Config?.PrivateNodeKey,
      legacy_node_id_present: !!p?.Config?.NodeID,
      legacy_login_present: !!p?.Config?.UserProfile?.LoginName,
      profile_count: profiles && typeof profiles === "object" ? Object.keys(profiles).length : 0,
      current_profile_present: !!state["_current-profile"] };
  }
  async tailscaleStatus(o) {
    this.owner(o);
    if (!this.get("tail_enabled", false)) return { state: "disconnected" };
    const epoch = this.epoch();
    if(this._tailStatusRefresh?.epoch === epoch) return this._tailStatusRefresh.promise;
    const refresh = {epoch,promise:null};
    // Status is not Connect: after waiting for other work it must not turn
    // enrollment back on, or apply a delayed result from a disconnected epoch.
    refresh.promise=this.operation(async()=>{
      await this.reconcileTailInvalidation();
      if(epoch!==this.epoch() || !this.get("tail_enabled",false)) return {state:"disconnected"};
      // Status may continue a human-started flow or resume a saved member, but
      // must never use connect's fresh-key/login fallback after missing state.
      const hasSavedEnrollment=async()=>{
        try {
          const state=this.get("tail_state")?await this.unseal(this.get("tail_state")):null;
          if(!state?._machinekey)return false;
          if(state._1hc_authenticated_enrollment && new TextDecoder().decode(bytes(state._1hc_authenticated_enrollment)) === "authenticated")return true;
          const pending=state._1hc_pending_enrollment?JSON.parse(new TextDecoder().decode(bytes(state._1hc_pending_enrollment))):null;
          return !!pending?.Persist?.PrivateNodeKey;
        } catch {return false}
      };
      const missing=()=>({...bad("No saved Tailscale enrollment is available to verify. Inspect Computer connections; status did not start a new login."),verified:false});
      let saved=await hasSavedEnrollment();
      if(epoch!==this.epoch() || !this.get("tail_enabled",false)) return {state:"disconnected"};
      if(!saved)return missing();
      await this.ensure();
      saved=await hasSavedEnrollment();
      if(epoch!==this.epoch() || !this.get("tail_enabled",false)) return {state:"disconnected"};
      if(!saved)return missing();
      this.put("last_activity",Date.now());
      const r=await this.raw("tailscale_connect");
      return this.saveTailStatus(r,epoch);
    }).finally(()=>{if(this._tailStatusRefresh === refresh)this._tailStatusRefresh=null});
    this._tailStatusRefresh=refresh;
    return refresh.promise;
  }
  async tailscaleConnect(o) {
    this.owner(o);
    if(this._disconnecting)await this._disconnecting;
    return this.operation(() => this.tailscaleConnectInner(o));
  }
  async tailscaleConnectInner(o) {
    this.owner(o);
    await this.reconcileTailInvalidation();
    this.put("tail_enabled", true);
    const epoch = this.epoch(),
      r = await this.rpc("tailscale_connect");
    if (epoch !== this.epoch())
      return bad("Tailscale disconnected while joining");
    return this.saveTailStatus(r,epoch);
  }
  async tailscaleDisconnect(o) {
    this.owner(o);
    if(this._disconnecting)return this._disconnecting;
    this._disconnecting=this.operation(()=>this.tailscaleDisconnectInner(o)).finally(()=>{this._disconnecting=null});
    return this._disconnecting;
  }
  async tailscaleDisconnectInner(o) {
    this.owner(o);
    const savedState=this.get("tail_state"),savedSeed=this.get("seed");
    this.put("tail_disconnect_pending", this.epoch() + 1);
    this.put("tail_epoch", this.epoch() + 1);
    this.put("tail_enabled", false);
    this.put("trusted_servers", this.get("trusted_servers", []).filter(s => s.route !== "tailnet"));
    this.drop("tail_state");
    this.drop("login_url");
    this.put("tail_status", { state: "disconnected" });
    if (this._starting) await this._starting.catch(() => {});
    // Tombstone is durable before logout/destroy, and survives wipe and workspace restoration.
    let remoteLogout=false;
    try {
      if(!this.ctx.container.running&&savedState&&savedSeed){
        await this.pay();await this.start();
        const configured=await this.raw("configure",{seed:await this.unseal(savedSeed),state:await this.unseal(savedState),epoch:this.epoch(),keyEpoch:this.get("key_epoch",0)});
        if(configured.ok!==true)throw new Error("Logout transport unavailable");
      }
      if(this.ctx.container.running){const r=await this.closeRaw("tailscale_disconnect",{epoch:this.epoch()});remoteLogout=!!r.remote_logout_confirmed}
    } catch {
      if(this.ctx.container.running)await this.stop();
    }
    this.put("sessions",this.get("sessions",[]).filter(s=>s.route!=="tailnet"));
    this.put("broker_tail_epoch",this.epoch());
    this.drop("tail_disconnect_pending");
    if(this.ctx.container.running&&!this.get("sessions",[]).length)await this.stop();
    return {
      ok: true,
      state: "disconnected",
      remote_logout_confirmed:remoteLogout,
      note: "Local enrollment removed. Fresh interactive approval is required to rejoin. Manage the remote device record in Tailscale's admin console.",
    };
  }
  // A Worker may restart after the durable Disconnect tombstone but before the
  // broker receives it. Reconcile before status, use, wake, Connect and alarms;
  // preserve public SSH sessions when the broker acknowledges tail-only logout.
  async reconcileTailInvalidation() {
    if (this._disconnecting) return this._disconnecting;
    if (this._tailCleanup) return this._tailCleanup;
    const pending = this.get("tail_disconnect_pending"),
      staleDisabled = !this.get("tail_enabled",false) && this.epoch() > 0 && this.get("broker_tail_epoch") !== this.epoch();
    if (pending === null && !staleDisabled) return;
    this._tailCleanup = (async()=>{
      if (pending !== null && pending > this.epoch()) this.put("tail_epoch",pending);
      this.put("tail_enabled",false);
      this.drop("tail_state"); this.drop("login_url");
      this.put("tail_status",{state:"disconnected"});
      if (this.ctx.container.running) {
        try { await this.closeRaw("tailscale_disconnect",{epoch:this.epoch()}); }
        catch { await this.stop(); }
      }
      this.put("sessions",this.get("sessions",[]).filter(s=>s.route!=="tailnet"));
      this.put("broker_tail_epoch",this.epoch());
      this.drop("tail_disconnect_pending");
    })().finally(()=>{this._tailCleanup=null});
    return this._tailCleanup;
  }
  async prepareSsh(o) {
    this.owner(o);
    return this.operation(() => this.prepareSshInner(o));
  }
  async prepareSshInner(o) {
    const own = this.owner(o);
    if (!(await this.permission(own)))
      return bad("Outbound SSH is Deny; choose Ask each time or Allow trusted servers in Settings");
    if (o.route === "tailnet" && !this.get("tail_enabled", false))
      return bad("Connect this computer to Tailscale first");
    const keyEpoch = this.get("key_epoch", 0), trustVersion = this.get(`trust_rev:${trustScope(o)}`, 0);
    const r = await this.rpc("prepare", o);
    if (r.ok) {
      r.keyEpoch = keyEpoch;
      r.trustVersion = trustVersion;
      r.resolutionId = crypto.randomUUID();
      this.put(`resolution:${r.resolutionId}`, {
        ...r,
        expires: Date.now() + 10 * 60e3,
      });
    }
    return r;
  }
  async openSsh(o) {
    this.owner(o);
    return this.operation(() => this.openSshInner(o));
  }
  async openTrustedSsh(o) {
    this.owner(o);
    if (!(await this.permission(o, o.permissionGeneration, true))) return bad("Trusted-server permission is not enabled");
    const saved = this.get("trusted_servers", []).find(s => equalTarget(s,o) && s.keyEpoch === this.get("key_epoch",0));
    if (!saved) return {ok:false,state:"approval_required"};
    // No caller-supplied fingerprint can override remembered server identity.
    return this.operation(() => this.openSshInner({...o, trustedId:saved.id, fingerprint:saved.fingerprint, remember:false}));
  }
  async trustedServers(o) {
    this.owner(o);
    return [...this.get("trusted_servers",[]),...this.get("revoking_servers",[])].map(trustView);
  }
  async revokeTrust(o, id) {
    this.owner(o);
    const saved = [...this.get("trusted_servers", []),...this.get("revoking_servers",[])].find(s => s.id === id);
    if (!saved) return {ok:false,error:"No such trusted server."};
    // Durable tombstone precedes I/O: old pending/consumed grants cannot re-save
    // the trust or finish opening, including after a Worker restart.
    const key = `trust_rev:${trustScope(saved)}`;
    this.put(key, this.get(key,0)+1);
    this.put("trusted_servers", this.get("trusted_servers", []).filter(s => trustScope(s) !== trustScope(saved)));
    this.put("revoking_servers",[...this.get("revoking_servers",[]).filter(s=>s.id!==id),{...saved,revoking:true}]);
    const closed = [];
    for (const s of this.get("sessions", []).filter(s => trustScope(s.target || {host:s.destination,port:s.port,user:s.username,route:s.route}) === trustScope(saved))) {
      await this.closeSsh({...o,task:s.task,turn:s.turn},{session:s.id});
      closed.push(s.id);
    }
    this.put("revoking_servers",this.get("revoking_servers",[]).filter(s=>s.id!==id));
    return {ok:true,closed_sessions:closed,target:trustView(saved)};
  }
  async openSshInner(o) {
    const own = this.owner(o),
      now = Date.now();
    if (
      !o.requestId ||
      typeof o.requestId !== "string" ||
      o.requestId.length > 100 ||
      !o.task ||
      !o.turn ||
      !Number.isFinite(o.expires) ||
      o.expires <= now ||
      o.expires > now + 10 * 60e3 + 1000
    )
      return bad("SSH approval is missing or expired");
    const p = this.get(`resolution:${o.resolutionId}`);
    if (!p || p.expires < now || !equalTarget(p, o))
      return bad(
        "Approved destination changed or expired; request fresh approval",
      );
    const trustCurrent = () => (p.keyEpoch ?? 0) === this.get("key_epoch",0) &&
      (p.trustVersion ?? 0) === this.get(`trust_rev:${trustScope(o)}`,0) &&
      (!o.trustedId || this.get("trusted_servers",[]).some(s => s.id === o.trustedId && equalTarget(s,o) && s.fingerprint === o.fingerprint));
    if (!trustCurrent()) return bad("Server trust or computer identity changed; request fresh approval");
    if (
      o.route === "tailnet" &&
      (!this.get("tail_enabled", false) || o.tailnetEpoch !== this.epoch())
    )
      return bad("Tailscale enrollment changed; request fresh approval");
    if (!(await this.permission(own, o.permissionGeneration, !!(o.trustedId || o.remember))))
      return bad("SSH permission changed; request fresh approval");
    if (this.get(`used:${o.requestId}`))
      return bad("SSH approval was already consumed");
    this.put(`used:${o.requestId}`, o.expires);
    const sshEpoch = this.get("ssh_epoch", 0),
      taskEpoch = this.get(`task_epoch:${o.task}`, 0),
      tailEpoch = this.epoch(),
      hostId = `host:${JSON.stringify([o.route, o.host, o.port])}`,
      trusted = this.get(hostId),
      fingerprint = o.fingerprint || trusted || "";
    await this.ensure();
    if (
      o.expires <= Date.now() ||
      p.expires <= Date.now() ||
      sshEpoch !== this.get("ssh_epoch", 0) ||
      taskEpoch !== this.get(`task_epoch:${o.task}`, 0) ||
      (o.route === "tailnet" && tailEpoch !== this.epoch()) ||
      !(await this.permission(own, o.permissionGeneration, !!(o.trustedId || o.remember))) || !trustCurrent()
    )
      return bad("SSH approval expired or was cancelled before connecting");
    if (
      o.expires <= Date.now() ||
      sshEpoch !== this.get("ssh_epoch", 0) ||
      taskEpoch !== this.get(`task_epoch:${o.task}`, 0) ||
      (o.route === "tailnet" && tailEpoch !== this.epoch()) || !trustCurrent()
    )
      return bad("SSH approval expired or was cancelled before connecting");
    const r = await this.raw("open", { ...o, epoch: tailEpoch, fingerprint });
    if (
      !(await this.permission(own, o.permissionGeneration, !!(o.trustedId || o.remember))) || !trustCurrent() ||
      sshEpoch !== this.get("ssh_epoch", 0) ||
      taskEpoch !== this.get(`task_epoch:${o.task}`, 0) ||
      (o.route === "tailnet" && tailEpoch !== this.epoch())
    ) {
      if (r.session)
        await this.closeRaw("close", { session: r.session }).catch(() =>
          this.stop(),
        );
      return bad("SSH request was cancelled while connecting");
    }
    if (r.state === "host_key_confirmation_required") {
      this.put(`resolution:${o.resolutionId}`, {
        ...p,
        expires: Date.now() + 10 * 60e3,
      });
      const expected = o.trustedId ? fingerprint : trusted;
      r.changed = !!expected && r.fingerprint !== expected;
      r.previous_fingerprint = expected || null;
      return r;
    }
    if (r.session) {
      this.put(hostId, r.fingerprint);
      if (o.remember && r.fingerprint) {
        const prior = this.get("trusted_servers",[]).filter(s => !equalTarget(s,o));
        prior.push({...o,id:crypto.randomUUID(),fingerprint:r.fingerprint,keyEpoch:this.get("key_epoch",0),created_at:Date.now()});
        this.put("trusted_servers",prior);
        r.trust_saved = true;
      }
      const sessions = this.get("sessions", []);
      sessions.push({
        id: r.session,
        task: o.task,
        turn: o.turn,
        requestId: o.requestId,
        permissionGeneration: o.permissionGeneration,
        route: o.route,
        ...(o.route === "tailnet" ? {tailnetEpoch:tailEpoch} : {}),
        destination: o.host,
        port: o.port,
        username: o.user,
        target: {host:o.host,port:o.port,user:o.user,route:o.route},
        trustVersion: p.trustVersion ?? 0,
        state: "connected",
        expires_at: r.expires_at,
      });
      this.put("sessions", sessions);
    }
    return r;
  }
  async session(o, id) {
    this.owner(o);
    await this.reconcileTailInvalidation();
    const s = this.get("sessions", []).find((s) => s.id === id);
    if (
      !s ||
      s.task !== o.task ||
      s.turn !== o.turn ||
      s.expires_at <= Date.now()
    )
      return null;
    if (!(await this.permission(o, s.permissionGeneration))) {
      await this.closeAll(o);
      return null;
    }
    if (!this.get("sessions",[]).some(current=>current.id===id) || (s.target && s.trustVersion !== this.get(`trust_rev:${trustScope(s.target)}`,0))) return null;
    // Check after the await as Disconnect can interleave during permission I/O.
    if (s.route === "tailnet" && (!this.get("tail_enabled",false) || s.tailnetEpoch !== this.epoch())) {
      await this.closeSsh(o,{session:id});
      return null;
    }
    return s;
  }
  async pruneTailSessions(o) {
    for (const s of this.get("sessions",[]))
      if (s.route === "tailnet" && (!this.get("tail_enabled",false) || s.tailnetEpoch !== this.epoch()))
        await this.closeSsh({...o,task:s.task,turn:s.turn},{session:s.id});
  }
  async execSsh(o, a) {
    if (!(await this.session(o, a.session)))
      return bad(
        "No active approved session belongs to this task, or permission changed",
      );
    if (!this.ctx.container.running)
      return bad(
        "Session ended when the computer slept; use ssh_connect for a fresh connection",
      );
    this.put("last_activity", Date.now());
    this.inflight = (this.inflight || 0) + 1;
    try {
      return await this.raw("exec", { ...o, ...a, epoch:this.epoch() });
    } finally {
      this.inflight--;
      this.put("last_activity", Date.now());
    }
  }
  async sftpSsh(o, a) {
    if (!(await this.session(o, a.session)))
      return bad(
        "No active approved session belongs to this task, or permission changed",
      );
    if (!this.ctx.container.running)
      return bad("Session ended; use ssh_connect for a fresh connection");
    this.inflight = (this.inflight || 0) + 1;
    try {
      return await this.raw("sftp", { ...o, ...a, command: a.op, epoch:this.epoch() });
    } finally {
      this.inflight--;
      this.put("last_activity", Date.now());
    }
  }
  async closeSsh(o, a) {
    this.owner(o);
    const s = this.get("sessions", []).find((s) => s.id === a.session);
    if (s && (s.task !== o.task || s.turn !== o.turn))
      return bad("Session belongs to another task");
    if (this.ctx.container.running) {
      try {
        await this.closeRaw("close", { session: a.session });
      } catch {
        await this.stop();
      }
    }
    this.put(
      "sessions",
      this.get("sessions", []).filter((s) => s.id !== a.session),
    );
    return { ok: true, state: "closed" };
  }
  async closeAll(o) {
    this.owner(o);
    this.put("ssh_epoch", this.get("ssh_epoch", 0) + 1);
    if (this.ctx.container.running) {
      try {
        await this.closeRaw("close_all");
      } catch {
        await this.stop();
      }
    }
    this.put("sessions", []);
    return { ok: true, state: "closed" };
  }
  async cancelTask(o, a) {
    this.owner(o);
    this.put(`task_epoch:${a.task}`, this.get(`task_epoch:${a.task}`, 0) + 1);
    if (this.ctx.container.running) {
      try {
        await this.closeRaw("close_task", { task: a.task });
      } catch {
        await this.stop();
      }
    }
    this.put(
      "sessions",
      this.get("sessions", []).filter((s) => s.task !== a.task),
    );
    return { ok: true };
  }
  async wipe(o) {
    this.owner(o);
    if(this._rotation)await this._rotation;
    this._rotation=this.wipeInner(o).finally(()=>{this._rotation=null});
    return this._rotation;
  }
  async wipeInner(o) {
    this.owner(o);
    this.put("key_epoch", this.get("key_epoch", 0) + 1);
    this.put("trusted_servers", []);
    await this.tailscaleDisconnect(o);
    await this.closeAll(o);
    if (this._identity) await this._identity.catch(() => {});
    this.drop("seed");
    this.drop("public_key");
    this.put("incarnation", crypto.randomUUID());
    this.sql.exec(
      "DELETE FROM native_kv WHERE k LIKE 'host:%' OR k LIKE 'resolution:%'",
    );
    return { ok: true };
  }
  async stop() {
    if (this._stopping) return this._stopping;
    this._stopping = this.stopInner().finally(() => { this._stopping = null; });
    return this._stopping;
  }
  async operation(fn) {
    this.inflight = (this.inflight || 0) + 1;
    try { return await fn(); }
    finally {
      this.inflight--;
      if (!this.inflight && !this.get("sessions", []).length && this.ctx.container.running) await this.stop();
    }
  }
  async stopInner() {
    if (this.ctx.container.running) {
      try { await this.ctx.container.destroy(); }
      catch(e) { await this.ctx.storage.setAlarm(Date.now()+10e3);throw e; }
    }
    this.put("sessions", []);
    await this.ctx.storage.deleteAlarm();
    const left = this.get("paid_until", 0) - Date.now();
    this.put("paid_until", Date.now());
    if (left > 1000 && this.get("owner")) {
      const o = this.get("owner"),
        L = this.env.LEDGER.get(
          this.env.LEDGER.idFromName(`tenant:${o.tenant}`),
        );
      await L.grant(
        `native-computer-refund:${crypto.randomUUID()}`,
        Math.floor((RATE * left) / 1000),
        "computer_refund",
      );
    }
  }
  async closeRaw(op, data = {}) {
    const r = await this.raw(op, data);
    if (r?.ok !== true)
      throw new Error("Trusted transport did not acknowledge closure");
    return r;
  }
  async alarm() {
    if (this.snapshotMaintenance()) { await this.ctx.storage.setAlarm(Date.now() + 60e3); return; }
    await this.reconcileTailInvalidation();
    if (!this.ctx.container.running) {
      this.put("sessions", []);
      return;
    }
    const o = this.get("owner");
    if (!o) {
      await this.stop();
      return;
    }
    if (!(await this.permission(o))) await this.closeAll(o);
    const r = await this.raw("status").catch(() => null);
    if (!r) {
      await this.stop();
      return;
    }
    const prior = this.get("sessions", []);
    for (const s of prior) {
      if (!(await this.permission(o, s.permissionGeneration))) {
        await this.closeAll(o);
        return this.ctx.storage.setAlarm(Date.now() + 10e3);
      }
    }
    this.put(
      "sessions",
      (r.sessions || []).filter(s=>this.get("sessions",[]).some(p=>p.id===s.id)).map((s) => ({
        ...this.get("sessions",[]).find((p) => p.id === s.id),
        ...s,
      })),
    );
    await this.pruneTailSessions(o);
    if (
      r.tailscale?.state &&
      !["connected", "disconnected"].includes(r.tailscale.state)
    )
      for (const s of this.get("sessions", []).filter(
        (s) => s.route === "tailnet",
      ))
        await this.closeSsh(
          { ...o, task: s.task, turn: s.turn },
          { session: s.id },
        );
    if (
      !this.inflight &&
      !this.get("sessions", []).length &&
      Date.now() - this.get("last_activity", 0) > 60e3
    ) {
      await this.stop();
      return;
    }
    try {
      await this.pay();
    } catch {
      await this.stop();
      return;
    }
    this.sql.exec(
      "DELETE FROM native_kv WHERE k LIKE 'used:%' AND CAST(v AS INTEGER)<?",
      Date.now() - 3600e3,
    );
    await this.ctx.storage.setAlarm(Date.now() + 10e3);
  }
  async probe() {
    if (this.env.ENV_NAME !== "dev" || this.env.TEST_MODE !== "1")
      throw new Error("dev only");
    const result = {};
    try {
      try {
        await this.start();
      } catch (e) {
        result.start = {
          ok: false,
          error: String(e.message || e),
          running: this.ctx.container.running,
        };
        return result;
      }
      for (const stage of ["ssh", "derp", "control"]) {
        try {
          result[stage] = await (
            await this.ctx.container
              .getTcpPort(8787)
              .fetch(`http://broker/probe?stage=${stage}`)
          ).json();
        } catch (e) {
          result[stage] = {
            ok: false,
            error: String(e.message || e),
            running: this.ctx.container.running,
          };
        }
      }
      return result;
    } finally {
      if (this.ctx.container.running)
        try {
          await this.ctx.container.destroy();
        } catch (e) {
          result.teardown = { error: String(e.message || e) };
        }
    }
  }
}

// Enrollment and grants must never be resurrected from an older backup. Preserve
// the snapshot for recovery evidence, then require fresh enrollment after restore.
installSnapshotRpc(NativeTransport, "NativeTransport", self => !!self.ctx.container?.running || !!self.inflight ||
  ["_rotation", "_starting", "_identity", "_disconnecting", "_stopping", "_tailStatusRefresh", "_tailCleanup"].some(key => !!self[key]));
const restoreNativeSnapshot = NativeTransport.prototype.snapshotRestoreStep;
NativeTransport.prototype.snapshotRestoreStep = async function(key, name) {
  const result = await restoreNativeSnapshot.call(this, key, name);
  if (result.done) {
    this.sql.exec("DELETE FROM native_kv");
    this.put("key_epoch", Date.now());
    this.put("incarnation", crypto.randomUUID());
    await this.ctx.storage.deleteAlarm();
  }
  return result;
};
