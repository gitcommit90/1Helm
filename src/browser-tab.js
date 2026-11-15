// One browser tab per task. Each task (session) gets its own tab in the channel's Chrome; the key below names it to the channel
// computer and the browser service. The profile (logins, cookies) stays shared. See image/opt/1hc-browser/server.mjs.
const KEY = /^[A-Za-z0-9_-]{1,64}$/;
// A session id is a UUID, so it is its own key. Anything else is shortened to a stable safe key.
export function tabKeyFor(session) {
  const s = String(session ?? ""); if (!s) return "";
  if (KEY.test(s)) return s;
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `s_${h.toString(36)}${s.length.toString(36)}`;
}
// The key for a tool call's context: its task, else the workflow run or the turn it belongs to, so no caller falls back to the shared front tab.
export function tabKeyOf(tc) {
  if (!tc) return "";
  if (tc.session) return tabKeyFor(tc.session);
  if (tc.workflow_id != null && tc.workflow_id !== "") return tabKeyFor(`wf-${tc.workflow_id}`);
  if (tc.turn) return tabKeyFor(`turn-${tc.turn}`);
  return "";
}
