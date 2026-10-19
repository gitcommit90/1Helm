// node --import ./test/stubs/register.mjs …  → "cloudflare:workers" resolves to the stub above, and .md files import as text
// (like wrangler's "Text" module rule for **/*.md: the default export is the file's contents), and so do skill scripts
// (src/skills/<slug>/scripts/**, wrangler's Text rule for **/skills/*/scripts/*), whatever their extension. A .wasm import is a compiled
// WebAssembly.Module, like wrangler's default CompiledWasm rule (src/vendor/anydoc/anydoc.wasm, sidecar-convert.js).
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url";
export async function resolve(s, c, next) { return s === "cloudflare:workers" ? { url: ${JSON.stringify(new URL("./cloudflare-workers.mjs", import.meta.url).href)}, shortCircuit: true } : next(s, c); }
export async function load(url, c, next) { if (url.startsWith("file:") && url.endsWith(".wasm")) return { format: "module", source: "import { readFileSync } from 'node:fs'; export default new WebAssembly.Module(readFileSync(" + JSON.stringify(fileURLToPath(url)) + "));", shortCircuit: true };
  return url.startsWith("file:") && (url.endsWith(".md") || /\\/skills\\/[^/]+\\/scripts\\//.test(url)) ? { format: "module", source: "export default " + JSON.stringify(readFileSync(fileURLToPath(url), "utf8")) + ";", shortCircuit: true } : next(url, c); }`));

// Unit tests must not call the network. Any fetch to these hosts throws unless the test installed its own globalThis.fetch stub
// (a stub replaces this guard, so tests that stub fetch are unaffected). Set ALLOW_TEST_NETWORK=1 to turn the guard off by hand.
const BLOCKED_HOSTS = /(^|\.)(openrouter\.ai|api\.cloudflare\.com|gateway\.ai\.cloudflare\.com|mcp\.1helm\.com)$/i;   // mcp.1helm.com: the design tools (src/design-tools.js) read it at every turn start
if (!process.env.ALLOW_TEST_NETWORK && typeof globalThis.fetch === "function" && !globalThis.fetch.__noNetworkGuard) {
  const realFetch = globalThis.fetch;
  const guarded = function (input, init) {
    let host = "";
    try { host = new URL(typeof input === "string" ? input : input?.url ?? String(input)).hostname; } catch {}
    if (BLOCKED_HOSTS.test(host)) throw new Error("unit tests must not call the network: fetch to " + host + ". Stub globalThis.fetch in the test.");
    return realFetch.call(this, input, init);
  };
  guarded.__noNetworkGuard = true;
  globalThis.fetch = guarded;
}
