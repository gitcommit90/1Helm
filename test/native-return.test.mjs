// node --import ./test/stubs/register.mjs test/native-return.test.mjs
// A Composio app sign-in started inside a phone app opens in the phone's browser, which has no session. The server then gives Composio the
// return address /apps/return (no sign-in needed, one fixed target), and a browser connect keeps /apps/done. Source checks cover index.js
// and custom-mcp.js, which cannot be loaded whole here.
import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
import { nativeReturnPage, nativeConnectPlatform, NATIVE_RETURN_PATH, NATIVE_APP_ADDRESS } from "../src/native-return.js";
let n = 0; const ok = (name) => { n++; console.log(`ok ${n} - ${name}`); };
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");   // the public edition has no dev sign-in lock (env-access.js), so that part of the private test is left out

// 1. the page: needs nothing, shows one line and a button, and goes only to the fixed app address.
const res = nativeReturnPage(), html = await res.text();
assert.equal(res.status, 200); assert.match(res.headers.get("content-type"), /text\/html/); assert.equal(res.headers.get("cache-control"), "no-store");
assert.equal(res.headers.get("referrer-policy"), "no-referrer");
assert.match(html, /Go back to the 1Helm app/); assert.match(html, /<a id="go" href="onehelm:\/\/openrouter">/); assert.equal(NATIVE_APP_ADDRESS, "onehelm://openrouter");
assert.match(html, /location\.href="onehelm:\/\/openrouter"/);
ok("the return page opens the app at once and has a button for the same address");

// 2. no open redirect and no account data: the page never reads the query, a cookie, or any request value.
assert.doesNotMatch(html, /location\.(search|hash)|URLSearchParams|document\.cookie|document\.referrer/);
const other = nativeReturnPage(new Request("https://x.test/apps/return?url=https://evil.test&to=//evil.test&app=gmail"));
assert.equal(await other.text(), html);
assert.equal(nativeReturnPage.length, 0);
const targets = [...html.matchAll(/(?:href=|location\.href=)"?([a-z]+:[^"\s>]+)/g)].map((m) => m[1]); assert.deepEqual([...new Set(targets)], ["onehelm://openrouter"]);
ok("the page ignores the query string and only ever points at onehelm://openrouter");

// 3. no sign-in needed.
assert.match(src("index.js"), /if \(p === "\/apps\/return" && \(req\.method === "GET" \|\| req\.method === "HEAD"\)\) return nativeReturnPage\(\);/);
const idx = src("index.js"); assert.ok(idx.indexOf('p === "/apps/return"') < idx.indexOf("if (p.startsWith(\"/w/\")") || idx.indexOf('p === "/apps/return"') < idx.indexOf('const t = await tenantOf'), "answered before any session lookup");
ok("/apps/return is open without a session");

// 4. the native flag picks the new return address; no flag keeps /apps/done exactly as before.
assert.equal(nativeConnectPlatform("android"), "android"); assert.equal(nativeConnectPlatform("ios"), "ios");
for (const v of [undefined, null, "", true, "mac", "ANDROID", "android ", { x: 1 }]) assert.equal(nativeConnectPlatform(v), "");
assert.match(idx, /const callback = nativeConnectPlatform\(b\.native\) \? `\$\{origin\}\$\{NATIVE_RETURN_PATH\}` : `\$\{origin\}\/w\/\$\{t\.slug\}\/apps\/done\?app=\$\{app\}&from=\$\{from\}\$\{from === "offer" \? offerCallbackQuery\(b\) : ""\}`;/);
assert.match(idx, /connectLink\(app, callback, \{ another: b\.another === true \}\)/);
assert.match(idx, /if \(app === "composio"\) return json\(\{ url: `\/w\/\$\{t\.slug\}\/composio\/connect\?back=\$\{encodeURIComponent\(`\/w\/\$\{t\.slug\}\/apps\/done\?app=composio/);
ok("native picks /apps/return, no flag keeps /apps/done (offer query included)");

// 5. custom MCP: a native sign-in returns to /apps/return and is finished by the signed-in app; the browser callback is unchanged.
const cm = src("ee/custom-mcp.js");
assert.match(cm, /callback_url: ctx\.native \? `\$\{ctx\.origin\}\/apps\/return` : `\$\{ctx\.origin\}\/w\/\$\{ctx\.slug\}\/custom-mcp\/callback\?state=\$\{state\}`/);
assert.match(cm, /\(authorize\|finish\|refresh\|key\)/); assert.match(cm, /if \(action === "finish"\) return J\(await finishNativeAuthorize\(env, ctx, id\)\);/);
assert.match(cm, /np === "android" \|\| np === "ios"/);
assert.match(cm, /AND tenant_id=\? AND user_id=\? AND used_at IS NULL AND expires_at>\?/);
ok("custom MCP sign-ins follow the same rule and are finished from inside the app");
console.log(`# ${n} passed`);
