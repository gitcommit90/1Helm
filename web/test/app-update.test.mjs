// node test/app-update.test.mjs: the Android "new version is ready" prompt (src/app-update.ts): version compare, once per version, and
// that nothing shows on web, iOS or Mac or when the app is up to date.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const out = join(mkdtempSync(join(tmpdir(), "au-")), "app-update.mjs");
await build({ entryPoints: [new URL("../src/app-update.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
const M = await import(out);

// compare
assert.equal(M.compareVersions("1.6.5", "1.6.6"), -1); assert.equal(M.compareVersions("1.6.6", "1.6.5"), 1); assert.equal(M.compareVersions("1.6.6", "1.6.6"), 0);
assert.equal(M.compareVersions("1.6.10", "1.6.9"), 1, "numbers, not text"); assert.equal(M.compareVersions("1.10.0", "1.9.9"), 1); assert.equal(M.compareVersions("2.0", "1.99.99"), 1);
assert.equal(M.compareVersions("1.6", "1.6.0"), 0); assert.equal(M.compareVersions("beta", "1.6.6"), null); assert.equal(M.compareVersions("", "1.6.6"), null); assert.equal(M.compareVersions(null, undefined), null);

// the dev app's versionName has a suffix: same numeric version
assert.equal(M.compareVersions("1.6.5-dev", "1.6.6"), -1); assert.equal(M.compareVersions("1.6.5-dev", "1.6.5"), 0); assert.equal(M.shouldPrompt("1.6.5-dev", "1.6.6"), true); assert.equal(M.shouldPrompt("1.6.6-dev", "1.6.6"), false);
assert.equal(M.parseVersion("-dev"), null); assert.equal(M.parseVersion("1.6.5-"), null); assert.equal(M.parseVersion("1.6.5 dev"), null);
assert.equal(await M.installedVersion({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { Browser: { open() {} }, App: { getInfo: async () => ({ version: "1.6.5-dev" }) } } } }), "1.6.5-dev");
// shouldPrompt: newer than installed and than the dismissed one
assert.equal(M.shouldPrompt("1.6.5", "1.6.6"), true); assert.equal(M.shouldPrompt("1.6.6", "1.6.6"), false); assert.equal(M.shouldPrompt("1.6.7", "1.6.6"), false);
assert.equal(M.shouldPrompt("1.6.5", "1.6.6", "1.6.6"), false, "dismissed this version"); assert.equal(M.shouldPrompt("1.6.5", "1.6.7", "1.6.6"), true, "a newer one shows again");
assert.equal(M.shouldPrompt("1.6.5", "1.6.6", "junk"), true); assert.equal(M.shouldPrompt("1.6.5", "garbage"), false); assert.equal(M.shouldPrompt("", "1.6.6"), false);

// the store
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const st = mem(); M.saveDismissed(st, "1.6.7"); M.saveDismissed(st, "1.6.6"); assert.equal(M.readDismissed(st), "1.6.7", "an older dismissal never replaces a newer one");
assert.equal(M.readDismissed({ getItem() { throw new Error("blocked"); } }), ""); M.saveDismissed({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }, "1.6.6");
assert.equal(M.readDismissed(null), "");

// installed version: only the Android app with both plugins
const cap = (platform, version = "1.6.5", plugins = {}) => ({ Capacitor: { isNativePlatform: () => platform !== "web", getPlatform: () => platform, Plugins: { Browser: { open: async () => {} }, App: { getInfo: async () => ({ version }) }, ...plugins } } });
assert.equal(await M.installedVersion(cap("android")), "1.6.5");
assert.equal(await M.installedVersion(cap("ios")), ""); assert.equal(await M.installedVersion(cap("web")), ""); assert.equal(await M.installedVersion({}), ""); assert.equal(await M.installedVersion(undefined), "");
assert.equal(await M.installedVersion(cap("android", "1.6.5", { App: undefined })), "", "no App plugin: no prompt, no guess");
assert.equal(await M.installedVersion(cap("android", "1.6.5", { Browser: undefined })), "");
assert.equal(await M.installedVersion(cap("android", "junk")), ""); assert.equal(await M.installedVersion(cap("android", "1.6.5", { App: { getInfo: async () => { throw new Error("x"); } } })), "");

// the whole check
const run = async (win, latest, store = mem(), extra = {}) => { const shown = []; const r = await M.checkForUpdate({ api: "/w/a/api", win, store, fetchJson: async (u) => { shown.urls = (shown.urls || []).concat(u); if (latest instanceof Error) throw latest; return latest; }, show: (v, gone) => shown.push({ v, gone }), ...extra }); return { r, shown, store }; };
let o = await run(cap("android"), { version: "1.6.6" });
assert.equal(o.r, true); assert.equal(o.shown[0].v, "1.6.6"); assert.deepEqual(o.shown.urls, ["/w/a/api/app-update/android"]);
o.shown[0].gone(); assert.equal(M.readDismissed(o.store), "1.6.6");
let again = await run(cap("android"), { version: "1.6.6" }, o.store); assert.equal(again.r, false, "dismissed: once per version");
again = await run(cap("android"), { version: "1.6.7" }, o.store); assert.equal(again.r, true, "a newer version asks again"); assert.equal(again.shown[0].v, "1.6.7");
assert.equal((await run(cap("android", "1.6.6"), { version: "1.6.6" })).r, false, "up to date");
assert.equal((await run(cap("android", "1.7.0"), { version: "1.6.6" })).r, false, "ahead of the download");
for (const p of ["web", "ios"]) { const x = await run(cap(p), { version: "9.9.9" }); assert.equal(x.r, false, p); assert.equal(x.shown.urls, undefined, `${p}: not even a request`); }
assert.equal((await run(cap("android"), { version: null })).r, false); assert.equal((await run(cap("android"), null)).r, false); assert.equal((await run(cap("android"), new Error("offline"))).r, false);
assert.equal((await run(cap("android"), { version: "<img src=x onerror=1>" })).r, false, "only a version is ever drawn");

// Download opens the APK address through the Browser plugin
const opened = []; await M.openDownload({ Capacitor: { Plugins: { Browser: { open: async (a) => { opened.push(a.url); } } } } });
assert.deepEqual(opened, ["https://1helm.com/download/1Helm-android.apk"]); await M.openDownload({});
console.log("app-update: all ok");
