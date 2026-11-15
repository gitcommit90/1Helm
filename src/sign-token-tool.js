// The sign_token tool (optional; every saved key is also a real variable on the computer, so a script can sign by itself). It reads the saved key from the
// vault now (so deleting the key stops signing at once), puts the real value of any $NAME in header and claims, signs with sign-token.js, and writes the token to
// a file on the computer (/tmp/1hc-tokens, mode 600, never saved into a layer). The token is not returned in the result: a token holds its claims in base64, and 1Helm
// hides every saved value from the model in every form, so a token carrying a saved Key ID or Issuer ID would come back with those parts replaced and no longer work.
// The helper uses the file in a command: -H "Authorization: Bearer $(cat <path>)". The work log gets one row for each signing: the key's name, the algorithm, the
// site and when the token expires, never the key or the token.
import { openSecret } from "./vault-seal.js";
import { signJwt, refNames, substituteRefs } from "./sign-token.js";

export const TOKEN_DIR = "/tmp/1hc-tokens";
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export async function signToolRun(R, a = {}, ctx = {}) {
  const name = String(a.key ?? a.secret ?? "").trim().toUpperCase();
  if (!name) return "error: key is required: the variable name of the saved key that holds the private key. If it isn't saved yet, call request_secret.";
  const tenant = R.get("tenant"), get = (n) => R.env.DB.prepare("SELECT name, hosts, sealed FROM vault WHERE tenant_id=? AND name=?").bind(tenant, n).first().catch(() => null);
  const row = await get(name);
  if (!row) return `error: there is no saved key named ${name} (it may have been deleted). Call request_secret to ask the person for it.`;
  let value; try { value = await openSecret(R.env, row.sealed); } catch { return `error: ${name} couldn't be opened. Ask the person to save it again.`; }
  // $NAME references in the header and claims: each is read from the vault now.
  const values = new Map(), refs = [...refNames(a.header ?? {}), ...refNames(a.claims ?? {})];
  for (const n of refs) {
    const r = n === name ? row : await get(n);
    if (!r) return `error: header or claims use $${n}, but there is no saved key with that name. Call request_secret to ask the person for it, or write the value yourself if it is not a secret.`;
    try { values.set(n, n === name ? value : await openSecret(R.env, r.sealed)); } catch { return `error: $${n} couldn't be opened. Ask the person to save it again.`; }
  }
  const r = await signJwt({ alg: a.alg, value, hosts: row.hosts, audience_host: a.audience_host, header: substituteRefs(a.header ?? {}, values), claims: substituteRefs(a.claims ?? {}, values) });
  value = null; values.clear();
  if (r.error) return `error: ${r.error}`;
  const path = `${TOKEN_DIR}/${name}-${crypto.randomUUID().slice(0, 8)}.jwt`;
  try {
    const w = await R.computer().exec(`umask 077; mkdir -p ${TOKEN_DIR} && printf '%s' ${q(r.token)} > ${path}`, { save: "none" });
    if (w?.code) return `error: the token was made but couldn't be written to the computer (${String(w.out || "").slice(0, 120)}). Try again.`;
  } catch (e) { return `error: the token was made but couldn't be written to the computer (${String(e.message || e).slice(0, 120)}). Try again.`; }
  try {
    R.sql.exec("INSERT INTO work_log (at,channel,session,turn,tool,family,app,account,query,terms,args,status,count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      Date.now(), R.get?.("channel") ?? null, ctx.session ?? null, ctx.turn ?? null, "sign_token", "sign", null, "",
      `Signed a ${r.alg} token with ${name}${r.host ? ` for ${r.host}` : ""}, expires ${new Date(r.exp * 1000).toISOString()}`, `sign token ${name} ${r.host || ""}`.trim(), JSON.stringify({ key: name, alg: r.alg, audience_host: r.host || null, exp: r.exp }), "ok", 1);
  } catch (e) { console.log("sign_token work log", e.message); }
  const mins = Math.max(1, Math.round((r.exp * 1000 - Date.now()) / 60000));
  return `Signed. The ${r.alg} token is in the file ${path} on your computer, valid about ${mins} minutes${r.defaulted ? " (exp was set for you)" : ""}. In a command use it as Authorization: Bearer $(cat ${path}). It isn't shown here; the private key is never shown.`;
}
