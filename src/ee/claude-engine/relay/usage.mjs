// Plan usage for the signed-in Claude account, read INSIDE the container with the CLI's own token: GET https://api.anthropic.com/api/oauth/usage.
// The token is read from the CLI's login file, goes only to api.anthropic.com, and is never printed or returned. Prints one JSON line:
//   {"ok":true,"data":{"five_hour":{...},"seven_day":{...}}}   or   {"ok":false,"status":401,"why":"http_401"}
// Request shape from rerouted (https://github.com/gitcommit90/rerouted, src/lib/quota.js, MIT).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const pick = (w) => (w && typeof w === "object" ? { utilization: w.utilization, resets_at: w.resets_at } : null);

export async function readUsage({ credPath, version = "2.1.0", fetchImpl = fetch } = {}) {
  let token = "";
  try { token = JSON.parse(await readFile(credPath, "utf8"))?.claudeAiOauth?.accessToken || ""; } catch {}
  if (!token) return { ok: false, status: 0, why: "no_token" };
  let r;
  try {
    r = await fetchImpl(USAGE_URL, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(12e3), headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "anthropic-beta": "oauth-2025-04-20", "User-Agent": `claude-code/${version}` } });
  } catch (e) { return { ok: false, status: 0, why: e?.name === "TimeoutError" ? "timeout" : "network" }; }
  if (!r.ok) return { ok: false, status: r.status, why: `http_${r.status}` };
  let j; try { j = JSON.parse((await r.text()).slice(0, 256 * 1024)); } catch { return { ok: false, status: r.status, why: "none" }; }
  return { ok: true, data: { five_hour: pick(j.five_hour), seven_day: pick(j.seven_day || j.seven_day_oauth_apps), subscription_type: typeof j.subscription_type === "string" ? j.subscription_type : undefined } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const home = process.env.HOME || "/home/node";
  process.stdout.write(JSON.stringify(await readUsage({ credPath: path.join(home, ".claude", ".credentials.json"), version: process.env.CLAUDE_CODE_VERSION || undefined })) + "\n");
}
