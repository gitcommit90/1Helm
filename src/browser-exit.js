// Browser exit node: the optional setting that sends a channel computer's browser traffic out through one exit node on the person's
// own Tailscale network, so websites see the person's home connection instead of a Cloudflare datacenter address.
// Facts that live here (pure functions, no I/O) so the Settings status line, the browser tool result and the tests agree:
//   setting          "on" | "off". A plain switch. When on it applies to the computer's browser always, whoever drives it.
//   tailscale        "connected" | "not_connected" (a saved, working enrollment of this computer; sleeping counts as connected).
//   exit node        the one device the person picked (id and name). The setting cannot be turned on without one.
// When the setting is on and the exit node cannot carry the traffic, the browser fails with an error. It never falls back to the
// computer's own internet connection.
export const EXIT_SETTINGS_LINK = "#settings/computer-network";
export const EXIT_SETTING_NAME = "Browser exit node";
// How long a health answer from the exit node is shown as current before the status line says it is checked at the next browser use.
export const EXIT_CHECK_FRESH_MS = 10 * 60e3;

// The stored setting (NativeTransport kv "browser_exit"), cleaned.
export function cleanExitSetting(v) {
  const o = v && typeof v === "object" ? v : {};
  const id = typeof o.node_id === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(o.node_id) ? o.node_id : "";
  const name = typeof o.node_name === "string" ? o.node_name.replace(/[^\w .-]/g, "").slice(0, 64) : "";
  return { enabled: o.enabled === true && !!id, node_id: id, node_name: id ? name : "" };
}

// tailEnabled: the platform holds an enrollment for this computer. status: the last known Tailscale status ({ state }).
// An asleep or reconnecting client is still enrolled and wakes on demand, so only a missing, expired or failed enrollment is "not connected".
export function tailscaleFact(tailEnabled, status) {
  if (!tailEnabled) return "not_connected";
  const s = status?.state;
  return s === "disconnected" || s === "expired_revoked" || s === "expired" || s === "error" ? "not_connected" : "connected";
}

// check: the last health answer { ok, reason, at } from the broker, or null when none is known.
export function exitView({ tailEnabled = false, tailStatus = null, setting = null, check = null, now = Date.now() } = {}) {
  const s = cleanExitSetting(setting), tailscale = tailscaleFact(tailEnabled, tailStatus), node = s.node_id ? { id: s.node_id, name: s.node_name || s.node_id } : null;
  const base = { setting: s.enabled ? "on" : "off", tailscale, exit_node: node, can_enable: tailscale === "connected" };
  if (!s.enabled) {
    return { ...base, state: "off", line: tailscale === "connected"
      ? (node ? `Off. The browser uses this computer's own connection. Last choice: ${node.name}.` : "Off. The browser uses this computer's own connection.")
      : "Off. Connect Tailscale first to send browser traffic through one of your own devices." };
  }
  if (tailscale !== "connected") return { ...base, state: "unreachable", reason: "Tailscale is not connected on this computer.", line: "On, but Tailscale is not connected. The browser cannot load pages until you reconnect Tailscale or turn this off. Nothing goes out directly." };
  if (check && now - Number(check.at || 0) < EXIT_CHECK_FRESH_MS) {
    if (check.ok) return { ...base, state: "ready", line: `On. Browser traffic leaves through ${node.name}.` };
    let reason = String(check.reason || "The exit node is unavailable.").slice(0, 200); if (!/[.!?]$/.test(reason)) reason += ".";
    return { ...base, state: "unreachable", reason, line: `On, but ${reason.replace(/^The /, "the ")} The browser cannot load pages until it is back or you turn this off. Nothing goes out directly.` };
  }
  return { ...base, state: "unknown", line: `On. Browser traffic leaves through ${node.name}. The exit node is checked when the browser next loads a page.` };
}

// Whether the setting may be turned on: Tailscale connected and one exit node chosen.
export function exitEnableProblem({ tailEnabled, tailStatus, nodeId }) {
  if (tailscaleFact(tailEnabled, tailStatus) !== "connected") return "Connect Tailscale on this computer first.";
  if (!nodeId) return "Choose one of your exit nodes first.";
  return "";
}
