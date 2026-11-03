// node test/byok-cc-host.test.mjs: which addresses "Continue with Claude" (src/ee/byok-billing.ts ccHostOk) will open. Only https on Anthropic's own domains passes.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { pathToFileURL } from "node:url";
const out = join(mkdtempSync(join(tmpdir(), "bykcch-")), "byok-billing.mjs");
await build({ entryPoints: [new URL("../src/ee/byok-billing.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
globalThis.document = { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; }, createElement() { return { setAttribute() {}, classList: { add() {} } }; }, body: {} };
globalThis.history = { replaceState() {} }; globalThis.window = { addEventListener() {} };
globalThis.location = { search: "", pathname: "/v3/", hash: "", href: "http://x/v3/", origin: "http://x" };
const { ccHostOk } = await import(pathToFileURL(out).href);
for (const u of ["https://claude.com/cai/oauth/authorize?code=true&state=abc", "https://platform.claude.com/oauth/authorize?code=true", "https://claude.ai/oauth/authorize?code=true", "https://console.anthropic.com/oauth/authorize", "https://anthropic.com", "https://claude.com"]) assert.ok(ccHostOk(u), `accepts ${u}`);
for (const u of ["http://claude.com/cai/oauth/authorize", "https://claude.com.evil.io/x", "https://evilclaude.com/x", "https://claude.com@evil.io/x", "https://evil.io/claude.com/", "https://evil.io/?https://claude.com/", "https://claude.co/x", "ftp://claude.ai/x", "", "https://claude.com:8443/x"]) assert.ok(!ccHostOk(u), `rejects ${u}`);
console.log("  ok the Claude sign-in address rule accepts Anthropic's https domains and rejects lookalikes and http");
