// The return address for an app sign-in (Composio) that a phone app (Android or iOS) started. The sign-in opens in the phone's own
// browser, which has no 1Helm session, so the usual return address (/w/<slug>/apps/done, which needs one) only showed the onboarding page.
// This page needs no session. It shows nothing about the account and takes no address to go to: the only place it can send the person
// is the fixed app address below, which the Android app (an intent filter on MainActivity) and the iOS app (URL scheme "onehelm") register.
export const NATIVE_RETURN_PATH = "/apps/return";
export const NATIVE_APP_ADDRESS = "onehelm://openrouter";
export const nativeConnectPlatform = (v) => (v === "android" || v === "ios" ? v : "");

export function nativeReturnPage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><link rel="icon" type="image/png" href="/1helm-icon-64.png"><title>Back to 1Helm</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f3f2ef;color:#1c1b19;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}@media(prefers-color-scheme:dark){body{background:#1c1b19;color:#f3f2ef}}p{margin:0 0 16px}a{display:inline-block;padding:12px 20px;border-radius:10px;background:#1c1b19;color:#fff;text-decoration:none}@media(prefers-color-scheme:dark){a{background:#f3f2ef;color:#1c1b19}}</style></head>
<body><main><p>Go back to the 1Helm app</p><a id="go" href="${NATIVE_APP_ADDRESS}">Open 1Helm</a></main>
<script>try{location.href=${JSON.stringify(NATIVE_APP_ADDRESS)}}catch(e){}</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } });
}
