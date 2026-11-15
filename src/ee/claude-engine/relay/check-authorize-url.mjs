// Build check: node check-authorize-url.mjs <claude binary>. Fails (exit 1) unless the binary has at least one CLAUDE_AI_AUTHORIZE_URL value and every value is https on the domains the app accepts.
// It reads the file as text and never runs it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The rule from src/ee/claude-signin-url.js, written here again because the image build only sees this folder. test/claude-signin-url.test.mjs fails when the two differ.
export const CC_SIGNIN_HOST = /^https:\/\/([a-z0-9-]+\.)*(claude\.ai|claude\.com|anthropic\.com)(:443)?(\/|\?|#|$)/i;
const ccSignInUrlOk = (u) => CC_SIGNIN_HOST.test(u);
export const authorizeUrls = (text) => [...String(text).matchAll(/CLAUDE_AI_AUTHORIZE_URL\s*:\s*"([^"]*)"/g)].map((m) => m[1]);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const urls = authorizeUrls(readFileSync(process.argv[2]).toString("latin1"));
  const bad = urls.filter((u) => !ccSignInUrlOk(u));
  console.log(`CLAUDE_AI_AUTHORIZE_URL values: ${urls.join(" ") || "(none)"}`);
  if (!urls.length || bad.length) { console.error(`FAIL: ${urls.length ? `not allowed: ${bad.join(" ")}` : "no CLAUDE_AI_AUTHORIZE_URL found"}`); process.exit(1); }
  console.log("ok");
}
