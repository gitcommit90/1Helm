// The hosts Sentinel intercepts on a channel computer: the sites the account's saved keys are for, and 1Helm's own hosts.
// A key site "*.example.com" matches example.com and every subdomain (sentinel-swap.js hostMatch), so it becomes two targets.
// A container holds 128 intercept entries and a hostname uses two, so at most 64 hostnames fit; computer.internal (HTTP) and a few
// 1Helm hosts take some, and KEY_TARGET_MAX is what is left for key sites.
export const KEY_TARGET_MAX = 56;
export function interceptTargets(rows, env = {}) {
  const own = [env.GATEWAY_HOST, env.APP_HOST].map((h) => String(h || "").toLowerCase().replace(/:\d+$/, "")).filter(Boolean);
  const keys = [];
  for (const r of rows || []) {
    let hosts = []; try { hosts = JSON.parse(r.hosts); } catch {}
    for (const h of Array.isArray(hosts) ? hosts : []) {
      const p = String(h).trim().toLowerCase();
      if (!/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/.test(p)) continue;   // never a bare "*": that would intercept everything
      keys.push(p); if (p.startsWith("*.")) keys.push(p.slice(2));
    }
  }
  const uniq = [...new Set(keys)];
  return { targets: [...new Set([...own, ...uniq.slice(0, KEY_TARGET_MAX)])], dropped: uniq.slice(KEY_TARGET_MAX) };
}
