// The newest Android app version, for the app's "a new version is ready" prompt (web/src/app-update.ts): GET /w/<slug>/api/app-update/android
// answers { version } for a signed-in person, so the page reads it from its own address (1helm.com sends no CORS headers). The APK itself is
// served by the website Worker; its stable address names the current file in a Content-Disposition header ("1Helm-1.6.6.apk"), and a HEAD request
// reads that without downloading the file. Nothing else is passed on. Cached 5 minutes per isolate, and a failed read answers { version: null }.
export const APK_STABLE_URL = "https://1helm.com/download/1Helm-android.apk";
const TTL = 5 * 60 * 1000;
let cache = { at: 0, version: null };

/** "1.6.6" from `attachment; filename="1Helm-1.6.6.apk"`, or null. */
export function apkVersionFrom(disposition) {
  const m = /filename="?1Helm-(\d{1,6}(?:\.\d{1,6}){0,3})\.apk"?/.exec(String(disposition || ""));
  return m ? m[1] : null;
}

export async function latestAndroidVersion(fetchImpl = fetch, now = Date.now()) {
  if (cache.version && now - cache.at < TTL) return cache.version;
  let version = null;
  try {
    const r = await fetchImpl(APK_STABLE_URL, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(4000) });
    if (r.status === 200 && /android\.package-archive/.test(r.headers.get("content-type") || "")) version = apkVersionFrom(r.headers.get("content-disposition"));
  } catch { /* the page shows nothing */ }
  if (version) cache = { at: now, version };
  return version;
}
export const resetAppUpdateCache = () => { cache = { at: 0, version: null }; };

export async function appUpdateApi(req, sub) {
  if (sub !== "/api/app-update/android") return null;
  if (req.method !== "GET") return new Response(null, { status: 405 });
  return new Response(JSON.stringify({ version: await latestAndroidVersion() }), { headers: { "content-type": "application/json", "cache-control": "private, max-age=300" } });
}
