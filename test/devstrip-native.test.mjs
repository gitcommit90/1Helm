// node --import ./test/stubs/register.mjs test/devstrip-native.test.mjs
// The yellow DEV strip (src/index.js fetch): on dev it is prepended to every HTML page for browsers, but not inside the native iOS/Android
// app (user agent with the token 1HelmMobile), so dev in the app looks exactly like Live. Live never gets it.
import assert from "node:assert";
// node has no HTMLRewriter: a small stand-in that does what the strip needs (prepend HTML inside <body>).
globalThis.HTMLRewriter = class {
  on(sel, h) { this.sel = sel; this.h = h; return this; }
  transform(res) {
    const { h } = this;
    const body = new ReadableStream({ async start(c) {
      const html = await res.text(); let add = "";
      h.element({ prepend: (s) => { add = s + add; } });
      c.enqueue(new TextEncoder().encode(html.replace(/<body[^>]*>/i, (m) => m + add))); c.close();
    } });
    return new Response(body, { status: res.status, headers: res.headers });
  }
};
const { default: worker } = await import("../src/index.js");
const DB = { prepare: () => { const o = { bind: () => o, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return o; } };
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const page = async (env, ua) => {
  const r = await worker.fetch(new Request("https://dev.example.com/onboard", { headers: { "user-agent": ua } }), { DB, ...env }, { waitUntil() {} });
  assert.match(r.headers.get("content-type") || "", /text\/html/); const t = await r.text(); assert.match(t, /<body/i); return t;
};
const strip = /id="devstrip"|DEV · test data/;
assert.match(await page({ ENV_NAME: "dev" }, SAFARI), strip, "dev + mobile Safari: strip present");
assert.match(await page({ ENV_NAME: "dev" }, DESKTOP), strip, "dev + desktop browser: strip present");
assert.match(await page({ ENV_NAME: "dev" }, "1HelmMobileX " + SAFARI), strip, "a word that only starts with 1HelmMobile is not the app");
assert.doesNotMatch(await page({ ENV_NAME: "dev" }, SAFARI + " 1HelmMobile"), strip, "dev + native app (UA ending in 1HelmMobile): no strip");
assert.doesNotMatch(await page({ ENV_NAME: "live" }, SAFARI), strip, "Live + browser: no strip");
assert.doesNotMatch(await page({ ENV_NAME: "live" }, SAFARI + " 1HelmMobile"), strip, "Live + native app: no strip");
console.log("PASS devstrip: dev browsers (mobile Safari, desktop) get the DEV strip; the native app (1HelmMobile token) and Live do not");
