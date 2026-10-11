// Native computer connections. State comes from the trusted network controller;
// this UI never derives membership from a login URL or an approval decision.
export const NETWORK_SEC = "computer-network";
type NetworkState = {
  available: boolean; permission: "deny" | "ask" | "trusted"; error?: string;
  client?: { state: "verified_ready" | "sleeping" | "error" | "unverified"; implementation?: string; version?: string };
  key: null | { public_key: string; fingerprint: string };
  sessions: { id: string; destination?: string; port?: number; username?: string; route?: string; state?: string }[];
  trusted_servers?: { id: string; destination: string; address: string; port: number; username: string; route: string; fingerprint: string; created_at: number; state?: string }[];
  tailscale: { state: string; login_url?: string; device_name?: string; dns_name?: string; device_id?: string; addresses?: string[]; error?: string };
};
type Deps = {
  api: (path: string, body?: any, options?: { signal?: AbortSignal }) => Promise<any>;
  channels: () => { slug: string; name: string }[];
  current: () => string; render: () => void; note: (title: string, body: string) => void;
  ask: (options: { title: string; body: string; confirm: string; danger?: boolean }) => Promise<boolean>;
  esc: (s: any) => string;
};
let D: Deps;
let shown = false, lastActiveChannel = "";
const N: { channel: string; value: NetworkState | null; busy: string; error: string; request: number; at: number; slow: boolean } = { channel: "", value: null, busy: "", error: "", request: 0, at: 0, slow: false };
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let statusRequest: AbortController | null = null;
let approvalWindow: Window | null = null, popupBlocked = false, feedbackAtTailnet = false;
let disconnectResult: { confirmed: boolean; note: string } | null = null;
const W = { active: false, checking: false, attempts: 0, last: 0, until: 0, pausedAt: 0, epoch: 0, message: "", timer: undefined as ReturnType<typeof setTimeout> | undefined };
const foreground = () => document.visibilityState !== "hidden" && (typeof document.hasFocus !== "function" || document.hasFocus());
function watchClock() {
  const now = Date.now();
  if (!foreground()) { if (!W.pausedAt) W.pausedAt = now; }
  else if (W.pausedAt) { W.until += now - W.pausedAt; W.pausedAt = 0; }
}
function stopWatch(message = "") { ++W.epoch; W.active = false; W.checking = false; clearTimeout(W.timer); W.message = message; }
function invalidate() { ++N.request; statusRequest?.abort(); statusRequest = null; clearTimeout(slowTimer); stopWatch(); N.busy = ""; N.slow = false; approvalWindow?.close(); approvalWindow = null; }
const busyLabels: Record<string, string> = { status: "Loading computer connections…", key: "Creating SSH public key…", rotate_key: "Rotating SSH key…", terminate: "Ending SSH session…", revoke_trust: "Revoking server trust…", tailscale_connect: "Starting Tailscale login…", tailscale_disconnect: "Disconnecting Tailscale…" };
function begin(op: string) {
  invalidate(); N.busy = op; N.error = "";
  feedbackAtTailnet = !!N.value && (op === "status" || op.startsWith("tailscale_"));
  const generation = N.request;
  slowTimer = setTimeout(() => { if (generation === N.request) { N.slow = true; D.render(); } }, 8000);
  return generation;
}
// A timed-out mutation may still finish server-side. Never retry it automatically.
async function bounded(path: string, body?: any) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = body ? null : new AbortController();
  if (controller) statusRequest = controller;
  try { return await Promise.race([D.api(path, body, controller ? { signal: controller.signal } : undefined), new Promise((_, reject) => { timer = setTimeout(() => {
    reject(new Error(body ? "This update is taking longer than expected and may still finish. Use Check connection before trying the action again." : `The computer didn't return its connection status within 25 seconds. ${N.value ? "The last known status is shown. Use Check connection below" : "Use Refresh status"} to try again. A status timeout does not mean Tailscale is disconnected.`));
    controller?.abort();
  }, body ? 90000 : 25000); })]); }
  finally { clearTimeout(timer); if (statusRequest === controller) statusRequest = null; }
}
let listening = false;
export function networkInit(deps: Deps) {
  D = deps;
  if (!listening && typeof window.addEventListener === "function") {
    listening = true;
    const resume = () => {
      if (!W.active || !shown) return;
      clearTimeout(W.timer); watchClock();
      if (foreground()) scheduleWatch(0);
    };
    window.addEventListener("focus", resume); window.addEventListener("blur", resume); document.addEventListener("visibilitychange", resume);
  }
}
// Entering Settings refreshes once. Ordinary repaints never schedule another request.
export function networkVisible(visible: boolean) {
  if (!visible && shown) invalidate();
  if (D && visible && (!shown || D.current() !== lastActiveChannel)) {
    invalidate();
    disconnectResult = null;
    lastActiveChannel = D.current(); N.channel = lastActiveChannel; N.value = null; N.error = ""; N.at = 0;
  }
  shown = visible;
}
const endpoint = () => `/res/${encodeURIComponent(N.channel)}/network`;
async function load(repaint = true) {
  if (!D || N.busy) return;
  const generation = begin("status"), path = endpoint();
  // The first render already contains the loading state. Do not recursively repaint
  // Settings while its initial page or mobile slide is being constructed.
  if (repaint) D.render();
  try {
    const value = await bounded(path);
    if (generation !== N.request) return;
    if (value?.error && typeof value.available !== "boolean") throw new Error(value.error);
    if (!value || typeof value.available !== "boolean" || !value.tailscale) throw new Error("The computer's connection status is unavailable. Try again.");
    N.value = value; N.at = Date.now();
  } catch (error: any) { if (generation === N.request) N.error = deliveryError(error)
    ? N.value ? "Couldn't reach 1HC to check the connection. The last known status is shown. Use Check connection below to retry; don’t disconnect or start a new login just to refresh." : "Couldn't reach 1HC to load computer connections. Check your network and try Refresh status."
    : error.message || "Couldn't check this computer."; }
  finally { if (generation === N.request) { clearTimeout(slowTimer); N.busy = ""; N.slow = false; D.render(); } }
}
const labels: Record<string, string> = { disconnected: "Disconnected", awaiting_user_approval: "Awaiting your approval", joining: "Joining", connected: "Connected", offline: "Offline / reconnecting", expired: "Expired or revoked", error: "Connection error" };
const pending = () => ["awaiting_user_approval", "joining", "offline"].includes(N.value?.tailscale.state || "");
const deliveryError = (error: any) => /Failed to fetch|NetworkError|Load failed/i.test(error?.message || "");
function startWatch(delay = 8000, message = "Approve in the Tailscale tab, then return here. We’ll check your connection automatically.") {
  stopWatch(); W.active = true; W.attempts = 0; W.last = 0; W.until = Date.now() + 120000; W.pausedAt = 0; feedbackAtTailnet = true;
  W.message = message;
  scheduleWatch(delay); D.render();
}
function scheduleWatch(delay: number) {
  clearTimeout(W.timer);
  if (!W.active || !shown) return;
  watchClock();
  if (W.checking || !foreground()) return;
  if (Date.now() >= W.until || W.attempts >= 3) { stopWatch("Automatic checks finished. If you’ve approved, use Check connection below to verify."); D.render(); return; }
  W.timer = setTimeout(() => void checkWatch(), Math.max(delay, W.last + 8000 - Date.now()));
}
async function checkWatch() {
  if (!W.active || W.checking || !shown || !foreground() || N.busy) return;
  if (Date.now() >= W.until || W.attempts >= 3) { stopWatch("Automatic checks finished. Use Check connection below to verify."); D.render(); return; }
  const epoch = W.epoch, request = N.request;
  W.checking = true; ++W.attempts; W.last = Date.now(); W.message = "Checking your Tailscale approval…"; D.render();
  try {
    // GET verifies pending membership through the trusted controller; it never starts
    // a new enrollment. Only three sequential checks, only in this foreground view.
    const value = await bounded(endpoint());
    if (epoch !== W.epoch || request !== N.request) return;
    if (!value || typeof value.available !== "boolean" || !value.tailscale) throw new Error(value?.error || "Couldn't verify the connection.");
    N.value = value; N.at = Date.now(); N.error = "";
    if (value.tailscale.state === "connected") { stopWatch(); popupBlocked = false; return; }
    if (!pending() || value.error || value.tailscale.error) { stopWatch(); return; }
    W.message = "Approval isn’t confirmed yet. We’ll check again while this page is open.";
  } catch (error: any) {
    if (epoch === W.epoch && request === N.request) {
      N.error = deliveryError(error) ? "Couldn't reach 1HC to verify the connection. Enrollment may have completed; no new login is being started." : error?.message || "Couldn't verify the connection. Use Check connection below to retry.";
      if (deliveryError(error) && W.attempts < 3 && Date.now() < W.until) W.message = "We’ll retry the status check shortly. You can also check again below.";
      else stopWatch();
    }
  } finally {
    if (request === N.request) { W.checking = false; D.render(); if (epoch === W.epoch) scheduleWatch(8000); }
  }
}
function loginUrl(value?: string) {
  try { const u = new URL(value || ""); return u.protocol === "https:" && u.hostname === "login.tailscale.com" && !u.username && !u.password ? u.href : ""; } catch { return ""; }
}
export function networkHtml() {
  if (!D) return "";
  const e = (value: unknown) => D.esc(String(value ?? "")), channels = D.channels();
  if (!N.channel || !channels.some(c => c.slug === N.channel)) N.channel = D.current() || channels[0]?.slug || "main";
  if (!N.value && !N.busy && !N.error) void load(false);
  const channel = channels.find(c => c.slug === N.channel), v = N.value;
  const button = (op: string, label: string, disabled = false, extra = "") => `<button type="button" class="sa blue" data-netop="${op}"${extra}${N.busy || (W.checking && op === "status") || disabled ? " disabled" : ""}>${e(N.busy === op ? (op === "status" ? "Checking…" : busyLabels[op] || "Working…") : label)}</button>`;
  const loading = N.busy ? `<div class="netloading"><div class="netprogress" role="progressbar" aria-label="${e(busyLabels[N.busy] || "Updating computer connections")}"><i></i></div><div role="status" aria-live="polite"><b>${e(busyLabels[N.busy] || "Updating computer connections…")}</b><p>${N.slow ? "Still loading — this is taking longer than usual. You can leave this page; it won’t interrupt your agent." : N.busy === "status" ? "Checking this computer’s SSH and Tailscale status. This can take a moment." : "Waiting for this computer to confirm the change. You can leave this page."}</p>${N.busy === "status" ? '<button type="button" class="sa blue" data-netop="cancel_status">Stop waiting</button>' : ""}</div></div>` : "";
  const head = `<h2>Computer connections</h2><p class="slead">SSH and Tailscale run from this agent's 1HC computer, not your Mac or phone.</p>
    <div class="sc netbox" aria-busy="${!!N.busy}"><label class="netchannel"><span>Channel computer</span><select data-netchannel aria-label="Channel computer"${N.busy && N.busy !== "status" ? " disabled" : ""}>${channels.map(c => `<option value="${e(c.slug)}"${c.slug === N.channel ? " selected" : ""}>#${e(c.name)}</option>`).join("")}</select></label>
    <div class="netactions">${button("status", "Refresh status")}<span class="sfine">${!N.busy && N.at ? `Checked ${e(new Date(N.at).toLocaleTimeString())}` : ""}</span></div></div>${!v || (N.busy && N.busy !== "status" && !N.busy.startsWith("tailscale_")) ? loading : ""}`;
  const error = N.error ? `<p class="neterror" role="alert">${e(N.error)}</p>` : "";
  if (!v) return `${head}${error}`;
  const ts = v.tailscale, url = ts.state === "awaiting_user_approval" && N.busy !== "tailscale_disconnect" ? loginUrl(ts.login_url) : "";
  const key = v.key;
  const clientLabels: Record<string, string> = { verified_ready: "Trusted SSH client verified", sleeping: "Trusted SSH client sleeping — wakes on demand", error: "Trusted SSH client unavailable", unverified: "Trusted SSH client not yet verified" };
  return `${head}${!feedbackAtTailnet ? error : ""}<div class="network-settings">
    ${!v.available ? `<p class="neterror" role="status">${e(v.error || "The trusted SSH transport is unavailable. No SSH connection can open.")}</p>` : ""}
    <p class="sfine" data-netclient role="status">${e(clientLabels[v.client?.state || "unverified"] || clientLabels.unverified)}${v.client?.implementation ? ` · ${e(v.client.implementation)}` : ""}${v.client?.version ? ` ${e(v.client.version)}` : ""}. A verified client does not mean a server connection is approved or authenticated.</p>
    <h3>Outbound SSH · ${v.permission === "trusted" ? "Allow trusted servers" : v.permission === "ask" ? "Ask each time" : "Deny"}</h3>
    <p class="sfine">${v.permission === "trusted" ? "This computer can reconnect to the exact servers you explicitly trust. New destinations and changed server identities still need approval." : v.permission === "ask" ? "Each new connection needs your approval. One approval permits remote commands and SFTP within one session; a reconnect needs another approval." : "SSH is blocked. To request connections, choose Ask each time or Allow trusted servers in Settings → Permissions → Direct network protocols."}</p>
    <h3>Trusted SSH servers for #${e(channel?.name || N.channel)}</h3><div class="sc netbox">${v.trusted_servers?.length ? v.trusted_servers.map(s => `<div class="netsession" data-nettrusted="${e(s.id)}"><div><b>${e(s.username)}@${e(s.destination)}:${e(s.port)}</b><span>${e(s.route === "tailnet" ? "Tailscale network" : "Public internet")} · Pinned address: ${e(s.address)}</span><span>Server fingerprint: ${e(s.fingerprint)}</span>${s.state === "revocation_pending" ? '<span role="status">Trust revoked. Session termination needs retry.</span>' : ""}</div>${button("revoke_trust", s.state === "revocation_pending" ? "Retry closing sessions" : "Revoke & close sessions", false, ` data-nettrust="${e(s.id)}"`)}</div>`).join("") : `<p>No trusted servers yet. With Allow trusted servers enabled, choose Approve &amp; trust server on its connection request.</p>`}</div>
    <p class="sfine">Saved trust applies only to this channel computer, destination, pinned address, port, username, route and verified host key.${v.permission !== "trusted" ? " Saved entries do not bypass the current SSH permission." : ""} Revoking ends matching sessions and cancels pending connections.</p>
    <h3>SSH identity for #${e(channel?.name || N.channel)}</h3><div class="sc netbox">
    ${key ? `<label class="netlabel">Public key<textarea readonly rows="3" aria-label="SSH public key">${e(key.public_key)}</textarea></label><p class="netfingerprint"><b>Fingerprint</b><code>${e(key.fingerprint)}</code></p><div class="netactions">${button("copy_key", "Copy public key")}${button("copy_fingerprint", "Copy fingerprint")}${button("rotate_key", "Rotate key", !v.available)}</div>` : `<p>This computer has no SSH identity yet. Create its own persistent Ed25519 key before connecting.</p>${button("key", "Create SSH public key", !v.available)}`}
    </div><p class="sfine">Install this public key in the intended server account's <code>~/.ssh/authorized_keys</code>. Share the server address and username with the agent. Never paste a password or private key into chat. Removing the public key from the server prevents future authentication; use End session below to stop an existing connection.</p>
    <h3>SSH sessions</h3><div class="sc netbox">${v.sessions?.length ? v.sessions.map(s => `<div class="netsession"><div><b>${e(s.username || "")}@${e(s.destination || "Server")}:${e(s.port || 22)}</b><span>${e(s.route === "tailnet" ? "Tailscale network" : "Public internet")} · ${e(s.state || "active")}</span></div>${button("terminate", "End session", false, ` data-netsession="${e(s.id)}"`)}</div>`).join("") : `<p>No active managed SSH sessions.</p>`}</div>
    <p class="sfine">A session uses the remote account's permissions and network access. It does not provide command-by-command approval or sandbox the remote server. First-use server fingerprints need confirmation; changed host keys block access until explicitly resolved.</p>
    <h3>Tailscale</h3><div class="sc netbox nettail"><b role="status">${N.error ? "Last known status: " : ""}${e(labels[ts.state] || "Unknown state — check connection")}</b>
    ${N.busy === "status" || N.busy.startsWith("tailscale_") ? loading : ""}${feedbackAtTailnet ? error : ""}
    ${disconnectResult && ts.state === "disconnected" ? `<div role="status" class="${disconnectResult.confirmed ? "sfine" : "neterror"}"><p>Local connection removed. ${disconnectResult.confirmed ? "Tailscale logout was confirmed." : "Tailscale logout was not confirmed. Remove or revoke the device in Tailscale’s admin console if you need to ensure remote revocation."}</p>${disconnectResult.note ? `<p>${e(disconnectResult.note)}</p>` : ""}</div>` : ""}
    ${W.checking ? `<div class="netprogress" role="progressbar" aria-label="Checking Tailscale approval"><i></i></div>` : ""}
    ${W.message ? `<p class="sfine" role="status" aria-live="polite">${e(W.message)}</p>` : ""}
    ${ts.device_name ? `<p class="netwrap">Device: ${e(ts.device_name)}</p>` : ""}${ts.dns_name ? `<p class="netwrap">Tailscale DNS: ${e(ts.dns_name)}</p>` : ""}${ts.device_id ? `<p class="netwrap">Device ID: ${e(ts.device_id)}</p>` : ""}${ts.addresses?.length ? `<p class="netwrap">Address: ${ts.addresses.map(e).join(", ")}</p>` : ""}
    ${ts.error ? `<p class="neterror" role="alert">${e(ts.error)}</p>` : ""}
    ${url ? `<p>Open Tailscale to approve enrolling <b>this channel's 1HC computer</b>. Creating this link has not connected it.</p>${popupBlocked ? `<p class="sfine" role="status">Your browser didn’t open the approval tab. Use the button below.</p>` : ""}<a class="sa blue netlogin" data-netapprove href="${e(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open Tailscale approval ↗</a><p class="sfine">Return here after approval. We’ll verify the connection; you can also check it below.</p>` : ""}
    ${ts.state === "awaiting_user_approval" && !url && N.busy !== "tailscale_disconnect" ? `<p class="sfine">The approval link is not available yet. Use Check connection below to retrieve the current status. Don’t disconnect or start another login just to refresh it.</p>` : ""}
    <div class="netactions">${["disconnected", "expired", "error"].includes(ts.state) ? button("tailscale_connect", "Connect Tailscale", !v.available) : ""}${button("status", W.checking ? "Checking…" : "Check connection")}${ts.state !== "disconnected" ? button("tailscale_disconnect", "Disconnect") : ""}</div></div>
    <p class="sfine">A public server needs a reachable address and username. A private tailnet server also needs this computer enrolled in your tailnet. Tailscale membership never grants SSH permission or access to other private services. Existing tailnet rules still apply.</p>
    <p class="sfine">Disconnect ends tailnet sessions and removes this computer's local enrollment. It does not delete the device record in Tailscale's admin console; remove that record there if you no longer want it. Rejoining requires fresh human approval and may create a separate device record.</p></div>`;
}
export function networkChange(target: HTMLElement) {
  if (!target.matches("[data-netchannel]") || (N.busy && N.busy !== "status")) return false;
  invalidate();
  disconnectResult = null;
  N.channel = (target as HTMLSelectElement).value; N.value = null; N.at = 0; N.error = ""; void load(); return true;
}
export function networkClick(target: HTMLElement) {
  if (target.closest<HTMLElement>("[data-netapprove]")?.dataset.netapprove !== undefined && D) {
    // Let the anchor's native new-tab action finish before repainting its DOM.
    const request = N.request;
    setTimeout(() => { if (shown && request === N.request && !N.busy) startWatch(); }, 0);
    return false;
  }
  const el = target.closest<HTMLElement>("[data-netop]"); if (!el || !D) return false;
  const op = el.dataset.netop!;
  if (op === "cancel_status" && N.busy === "status") { invalidate(); N.error = `Stopped waiting for status. ${N.value ? "The last known status is shown. Use Check connection below" : "Use Refresh status"} to try again.`; D.render(); return true; }
  if (N.busy || (el as HTMLButtonElement).disabled) return true;
  if (op === "status") { void load(); return true; }
  if (op === "copy_key" || op === "copy_fingerprint") {
    const fingerprint = op === "copy_fingerprint";
    if (N.value?.key) Promise.resolve().then(() => navigator.clipboard.writeText(fingerprint ? N.value!.key!.fingerprint : N.value!.key!.public_key))
      .then(() => D.note(fingerprint ? "Fingerprint copied" : "Public key copied", fingerprint ? "Use this to identify this computer's SSH public key." : "Install it in the intended server account's ~/.ssh/authorized_keys."))
      .catch(() => D.note("Couldn't copy", `Select the ${fingerprint ? "fingerprint" : "public key"} and copy it manually.`));
    return true;
  }
  void (async () => {
    // Capture the channel before any modal; switching the selected computer cannot redirect an action.
    const path = endpoint(), channel = N.channel, request = N.request, session_id = el.dataset.netsession, trust_id = el.dataset.nettrust;
    if (op === "revoke_trust") {
      const server = N.value?.trusted_servers?.find(s => s.id === trust_id);
      if (!server || !await D.ask({ title: "Revoke this server's SSH trust?", body: `This removes saved access to ${server.username}@${server.destination}:${server.port} for this channel computer, closes matching sessions and cancels pending connections. The next connection will require approval.`, confirm: "Revoke & close sessions", danger: true })) return;
    }
    if (op === "rotate_key" && !await D.ask({ title: "Rotate this computer's SSH key?", body: "This closes this computer's managed SSH sessions and replaces its private key. Install the replacement public key on each server before reconnecting. Remove the old public key from each server's authorized_keys; rotation does not remove it for you.", confirm: "Rotate key", danger: true })) return;
    if (op === "tailscale_disconnect" && !await D.ask({ title: "Disconnect this computer from Tailscale?", body: "This ends tailnet sessions, cancels pending tailnet work and removes local enrollment. It does not delete the device record in Tailscale's admin console; remove it there separately if needed. Connecting again requires fresh human approval and may create a separate device record.", confirm: "Disconnect", danger: true })) return;
    if (N.busy || channel !== N.channel || request !== N.request) return;
    const generation = begin(op);
    // Open synchronously inside Connect's user gesture, then navigate only after
    // the trusted API supplies a validated login URL. GET/repaint never opens tabs.
    if (op === "tailscale_connect") {
      disconnectResult = null;
      try { approvalWindow = typeof window.open === "function" ? window.open("about:blank", "_blank") : null; if (approvalWindow) { approvalWindow.opener = null; approvalWindow.document.title = "Opening Tailscale approval"; approvalWindow.document.body.textContent = "Preparing Tailscale approval for your 1HC computer…"; } } catch { approvalWindow = null; }
      popupBlocked = !approvalWindow;
    }
    D.render(); let directTailnet = false, reconcile = false;
    try {
      const r = await bounded(path, { op, ...(session_id ? { session_id } : {}), ...(op === "revoke_trust" ? { trust_id } : {}), ...(op === "rotate_key" ? { confirm: true } : {}) });
      if (generation !== N.request) return;
      if (r?.error) throw new Error(r.error);
      if (op === "tailscale_disconnect" && r?.state === "disconnected") disconnectResult = { confirmed: r.remote_logout_confirmed === true, note: typeof r.note === "string" ? r.note : "" };
      if (op === "tailscale_connect" && r?.state && N.value) {
        N.value = { ...N.value, tailscale: r }; directTailnet = true;
        const url = r.state === "awaiting_user_approval" ? loginUrl(r.login_url) : "";
        if (url && approvalWindow && !approvalWindow.closed) { approvalWindow.location.replace(url); approvalWindow = null; }
        else { approvalWindow?.close(); approvalWindow = null; }
      }
    }
    catch (error: any) { if (generation === N.request) { reconcile = op === "tailscale_connect" && deliveryError(error); N.error = reconcile ? "1HC didn’t receive the login result. We’ll check the actual connection without starting another login." : error.message || "Couldn't update this computer's connection."; } }
    finally { if (generation === N.request) { clearTimeout(slowTimer); N.busy = ""; N.slow = false; if (N.error) { approvalWindow?.close(); approvalWindow = null; D.render(); if (reconcile) startWatch(0, "Checking whether the login request completed. No new login will be started."); } else if (directTailnet) { D.render(); if (pending()) startWatch(); } else { approvalWindow?.close(); approvalWindow = null; await load(); } } }
  })();
  return true;
}
