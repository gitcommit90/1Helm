// DCR is OAuth with dynamic client registration, not an API-key form. It does
// not need a pre-created Composio-managed OAuth app or customer client secrets.
export const isOAuthScheme = (mode) => ["OAUTH1", "OAUTH2", "DCR_OAUTH"].includes(mode);
export const keyScheme = (schemes) => schemes.find((m) => m !== "NO_AUTH" && !isOAuthScheme(m));
export function connectAuth(schemes = [], managed = []) {
  if (managed.length) return { scheme: managed[0], managed: true };
  if (schemes.includes("DCR_OAUTH")) return { scheme: "DCR_OAUTH", managed: false };
  const scheme = keyScheme(schemes);
  return scheme ? { scheme, managed: false } : null;
}
