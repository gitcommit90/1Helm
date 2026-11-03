// The one rule for the address "Continue with Claude" opens: https on claude.ai, claude.com or anthropic.com, or a subdomain of them, with no user name, no password and no port other than 443.
// The app page (web/src/ee/byok-billing.ts, ccHostOk) holds the same rule as a second guard. Keep the two regular expressions and the case lists in their tests identical.
// The build check in src/ee/claude-engine/relay/check-authorize-url.mjs uses this same function on the address the pinned Claude Code CLI carries.
export const CC_SIGNIN_HOST = /^https:\/\/([a-z0-9-]+\.)*(claude\.ai|claude\.com|anthropic\.com)(:443)?(\/|\?|#|$)/i;
export const ccSignInUrlOk = (u) => typeof u === "string" && CC_SIGNIN_HOST.test(u) && (() => { try { return new URL(u).protocol === "https:"; } catch { return false; } })();
// The host only, for logs. The full address carries the sign-in state and is never logged.
export const ccUrlHost = (u) => { try { return new URL(String(u)).hostname.slice(0, 100); } catch { return "unparsable"; } };
// From the CLI's output, the sign-in link: the first https address whose path has oauth/authorize and that passes the rule. Else the first https address, which the server rule then rejects with a clear error.
export function pickSignInUrl(text) {
  const all = String(text ?? "").match(/https:\/\/\S+/g) || [];
  const link = all.find((u) => { let p = ""; try { p = new URL(u).pathname; } catch { return false; } return p.includes("oauth/authorize") && ccSignInUrlOk(u); });
  return link || all[0] || "";
}
