// The phone apps (Android and iOS, Capacitor). An app sign-in (Composio) opens outside the app's web view, where there is no 1Helm session,
// so the server sends the sign-in back to /apps/return (src/native-return.js), a page that needs no session and reopens the app.
// "android" | "ios" inside a phone app, "" everywhere else (browsers and the Mac app keep the normal return address).
export function nativePlatform(win: any = window): "android" | "ios" | "" {
  try { const C = win.Capacitor; const p = String(C?.getPlatform?.()); return C?.isNativePlatform?.() && (p === "android" || p === "ios") ? p : ""; } catch { return ""; }
}
/** Opens an outside sign-in page. Android: the app's web view hands any outside address to the phone's browser. iOS: that only works for a tapped link,
 *  so the Capacitor Browser plugin (Safari sheet) opens it when it is there. */
export function openOutside(url: string, win: any = window): void {
  try { const B = win.Capacitor?.Plugins?.Browser; if (nativePlatform(win) === "ios" && typeof B?.open === "function") { B.open({ url }); return; } } catch { /* fall through */ }
  win.location.assign(url);
}
/** Closes the Safari sheet on iOS once the person is back in the app (Android has no sheet, and the call does nothing there). */
export function closeOutside(win: any = window): void {
  try { const B = win.Capacitor?.Plugins?.Browser; if (nativePlatform(win) === "ios" && typeof B?.close === "function") Promise.resolve(B.close()).catch(() => {}); } catch { /* nothing to close */ }
}
