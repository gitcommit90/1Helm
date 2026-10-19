// Better Design as a design source (Captain 2026-10-19). Better Design keeps the inputs of MCP tool calls for 180 days and keeps a
// pseudonymous copy it may train on (its privacy policy), so its use follows the account's AI privacy level (privacy.js):
//   Unrestricted accounts          on, unless the person turned it off.
//   No Training and ZDR accounts   off, unless the person turned it on (Settings -> Advanced).
// Effective value = the person's explicit choice if they ever set one, otherwise (privacy level is "unrestricted"). The choice is kept in
// D1 tenant_flags k='better_design' = 'on' | 'off' (no row = never chosen; no migration, the table is the account's small key/value store).
// Inspo, Magic UI, React Bits and Canvas UI are not affected. Everything that can reach Better Design asks this one function:
//   * the design brief 1Helm appends to a task's first .html write (design-brief.js passes skip: ["better-design"] to the brief Worker)
//   * design_mcp.py on the channel computer (Resident.execComputerToolInner sets DESIGN_MCP_BETTER_DESIGN=off for a command that names it)
//   * the prompt text: the better_design flag in promptFlags/docFlags (prompt/index.js, the artifacts skill and the helper line)
import { normalizePrivacy } from "./privacy.js";

export const FLAG = "better_design";
export const SKIP_SOURCE = "better-design";   // the value the design_brief tool's `skip` input takes

// choice: "on" | "off" | anything else (never chosen). level: the stored AI privacy level (an unknown value reads as "zdr").
export function effectiveBetterDesign(level, choice) {
  if (choice === "on") return true;
  if (choice === "off") return false;
  return normalizePrivacy(level) === "unrestricted";
}

// One D1 read: { choice: "on" | "off" | null, level, on }. No tenant, no DB or a failed read -> the strictest answer (off).
export async function betterDesignState(env, tenantId) {
  if (!tenantId || !env?.DB) return { choice: null, level: "zdr", on: false };
  try {
    const r = await env.DB.prepare("SELECT ai_privacy, (SELECT v FROM tenant_flags WHERE tenant_id=? AND k=?) AS choice FROM tenants WHERE id=?").bind(String(tenantId), FLAG, String(tenantId)).first();
    const choice = r?.choice === "on" || r?.choice === "off" ? r.choice : null, level = normalizePrivacy(r?.ai_privacy);
    return { choice, level, on: effectiveBetterDesign(level, choice) };
  } catch (e) { console.log("better-design: read failed, using off", String(e?.message || e).slice(0, 120)); return { choice: null, level: "zdr", on: false }; }
}
export const betterDesignOn = async (env, tenantId) => (await betterDesignState(env, tenantId)).on;

// The stored choice for the app (boot and GET /api/account): { choice, on }. The app recomputes `on` from choice and the privacy level when
// the person changes their AI privacy level, so the switch follows it without a reload.
export const betterDesignView = (t, choice) => { const c = choice === "on" || choice === "off" ? choice : null; return { choice: c, on: effectiveBetterDesign(t?.ai_privacy, c) }; };
export async function betterDesignChoice(env, tenantId) {
  try { const v = (await env.DB.prepare("SELECT v FROM tenant_flags WHERE tenant_id=? AND k=?").bind(String(tenantId), FLAG).first())?.v; return v === "on" || v === "off" ? v : null; } catch { return null; }
}
export async function setBetterDesign(env, tenantId, on, at = Date.now()) {
  await env.DB.prepare("INSERT INTO tenant_flags (tenant_id,k,v,updated_at) VALUES (?,?,?,?) ON CONFLICT(tenant_id,k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at").bind(String(tenantId), FLAG, on ? "on" : "off", at).run();
  return on ? "on" : "off";
}
