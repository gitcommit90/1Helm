// node test/app-update.test.mjs: the Worker side of the Android "new version" prompt (src/app-update.js): the version comes from the
// download address's Content-Disposition file name, only a real APK answer counts, it is cached, and a failure answers null.
import assert from "node:assert";
import { apkVersionFrom, latestAndroidVersion, resetAppUpdateCache, appUpdateApi } from "../src/app-update.js";

assert.equal(apkVersionFrom('attachment; filename="1Helm-1.6.6.apk"'), "1.6.6");
assert.equal(apkVersionFrom('attachment; filename="1Helm-1.6.10.apk"'), "1.6.10");
assert.equal(apkVersionFrom('attachment; filename="1Helm-1.6.6-mac.dmg"'), null);
assert.equal(apkVersionFrom('attachment; filename="evil.apk"'), null);
assert.equal(apkVersionFrom(null), null);

let calls = 0, last;
const ok = (cd, status = 200, type = "application/vnd.android.package-archive") => async (u, init) => { calls++; last = { u, init }; return new Response(null, { status, headers: { "content-type": type, "content-disposition": cd } }); };
resetAppUpdateCache();
assert.equal(await latestAndroidVersion(ok('attachment; filename="1Helm-1.6.6.apk"'), 1000), "1.6.6");
assert.equal(last.u, "https://1helm.com/download/1Helm-android.apk"); assert.equal(last.init.method, "HEAD");
assert.equal(await latestAndroidVersion(ok('attachment; filename="1Helm-9.9.9.apk"'), 1000 + 60e3), "1.6.6", "cached inside 5 minutes");
assert.equal(calls, 1);
assert.equal(await latestAndroidVersion(ok('attachment; filename="1Helm-1.6.7.apk"'), 1000 + 6 * 60e3), "1.6.7", "re-read after 5 minutes");

resetAppUpdateCache();
assert.equal(await latestAndroidVersion(ok('attachment; filename="1Helm-1.6.6.apk"', 302), 0), null, "a redirect is not an answer");
assert.equal(await latestAndroidVersion(ok('attachment; filename="1Helm-1.6.6.apk"', 200, "text/html"), 0), null, "the download page is not an APK");
assert.equal(await latestAndroidVersion(async () => { throw new Error("offline"); }, 0), null);

assert.equal(await appUpdateApi(new Request("https://x/y"), "/api/other"), null);
assert.equal((await appUpdateApi(new Request("https://x/y", { method: "POST" }), "/api/app-update/android")).status, 405);
console.log("app-update: all ok");
