// Cache headers for static files requested with ?v=<version>.
// A file may be cached for a year only when the version in the URL is the version this Worker was built with. While a deploy rolls out,
// the previous Worker version can still answer a request for the new URL (e.g. app.js?v=247) with its own older file. That response must not
// be cached under the new URL, so a mismatch gets no-store. Responses without ?v= are returned unchanged.
export const ONBOARD_STATIC_CSS_V = "3";   // /onboard-static/style.css (linked by onboarding.js)
export const ONBOARD_STATIC_JS_V = "2";    // /onboard-static/app.js (linked by onboarding.js)
export const ONBOARD_APPS_JS_V = "9";      // /onboard/v1/apps.js (imported by app-assets/onboard/v1/app.js)

// The version this Worker expects for a path, or null when the path has no version source (any ?v= on it is then never cached).
export function expectedAssetVersion(path, v) {
  if (path.startsWith("/app-static/")) return v.APP_V;
  if (path === "/onboard/v1/apps.js") return ONBOARD_APPS_JS_V;
  if (path.startsWith("/onboard/v1/") || path === "/onboard/kit.js" || path === "/onboard/kit.css") return v.ONBOARD_V;
  if (path === "/onboard-static/style.css") return ONBOARD_STATIC_CSS_V;
  if (path === "/onboard-static/app.js") return ONBOARD_STATIC_JS_V;
  if (/^\/1helm-dev-icon[^/]*\.png$/.test(path)) return v.DEV_ICON_V;
  return null;
}

export function versionedAsset(url, r, v) {
  const q = url.searchParams.get("v");
  if (r.status !== 200 || !q) return r;
  const h = new Headers(r.headers);
  h.set("cache-control", q === expectedAssetVersion(url.pathname, v) ? "public, max-age=31536000, immutable" : "no-store");
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

// Every /w/<slug>/api response tells the open app which build this Worker serves (x-app-v), so a tab running older code can reload itself.
export function withAppV(url, r, v) {
  if (!/^\/w\/[^/]+\/api\//.test(url.pathname) || r.status === 101) return r;
  const h = new Headers(r.headers); h.set("x-app-v", String(v.APP_V));
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}
