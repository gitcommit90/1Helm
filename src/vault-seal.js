// Sealing of saved key values (AES-GCM with the platform VAULT_KEY). Split out of sentinel.js so code that is not a Worker entrypoint can open a value.
// AES-GCM with the platform VAULT_KEY (32 bytes, base64). Values are stored encrypted; only this layer decrypts.
async function vaultKey(env) { return crypto.subtle.importKey("raw", Uint8Array.from(atob(env.VAULT_KEY), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt", "decrypt"]); }
export async function sealSecret(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await vaultKey(env), new TextEncoder().encode(plain)));
  return btoa(String.fromCharCode(...iv)) + "." + btoa(String.fromCharCode(...ct));
}
export async function openSecret(env, sealed) {
  const [iv, ct] = sealed.split(".").map((s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await vaultKey(env), ct));
}
