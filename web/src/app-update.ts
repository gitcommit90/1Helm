// "A new version of the app is ready" for the Android app (the APK from 1helm.com, not the Play Store, so nothing else tells the person).
// The prompt lives here in the web page, so an app that is already installed gets it without a new APK:
// - The installed version comes from Capacitor's App plugin (App.getInfo().version is the APK's versionName). The plugin is in
//   1.6.5 and later, and the user agent only says "1HelmMobile" with no number, so getInfo is the one source. Without it nothing shows.
// - The newest version comes from the Worker (GET <api>/app-update/android, which reads the file name the download address serves).
// - Newer than installed and not dismissed: one toast with Download (opens the APK address in the system browser, so Android's
//   installer takes over, not the web view) and a dismiss button. A dismissal (or Download) is remembered for that version in
//   localStorage; a newer version shows the prompt again. It shows once per launch.
// The logic takes a window-like object and a store, so test/app-update.test.mjs drives it with fakes. Nothing runs on web, iOS or Mac.

export const APK_URL = "https://1helm.com/download/1Helm-android.apk";
export const DISMISS_KEY = "1h.apkUpdate.dismissed";

/** "1.6.10" gives [1, 6, 10]; "1.6.5-dev" gives [1, 6, 5]; null for anything that is not 1 to 4 dot-separated numbers. */
export function parseVersion(v: unknown): number[] | null {
  // A build suffix ("1.6.5-dev", the dev app's versionName) is the same numeric version.
  const s = String(v ?? "").trim().replace(/^(\d[\d.]*)-[0-9A-Za-z.+-]+$/, "$1");
  if (!/^\d{1,6}(\.\d{1,6}){0,3}$/.test(s)) return null;
  return s.split(".").map(Number);
}

/** -1, 0 or 1 like a sort compare; null when either side is not a version. Missing parts count as 0 (1.6 equals 1.6.0). */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

/** Show the prompt only for a version newer than the installed one and newer than the last one the person dismissed. */
export function shouldPrompt(installed: unknown, latest: unknown, dismissed?: unknown): boolean {
  if (compareVersions(latest, installed) !== 1) return false;
  return !dismissed || parseVersion(dismissed) === null || compareVersions(latest, dismissed) === 1;
}

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export function readDismissed(store: Store | null | undefined): string {
  try { return store?.getItem(DISMISS_KEY) || ""; } catch { return ""; }
}
/** Remembers the newest dismissed version (an older one never replaces a newer one). */
export function saveDismissed(store: Store | null | undefined, version: string) {
  try { if (compareVersions(version, readDismissed(store)) !== -1) store?.setItem(DISMISS_KEY, version); } catch { /* a private window asks again next launch */ }
}

/** The Android app's own version, or "" outside the Android app (web, iOS, Mac) or when a plugin it needs is missing. */
export async function installedVersion(win: any): Promise<string> {
  try {
    const C = win?.Capacitor;
    if (!C?.isNativePlatform?.() || C.getPlatform?.() !== "android") return "";
    if (typeof C.Plugins?.Browser?.open !== "function" || typeof C.Plugins?.App?.getInfo !== "function") return "";
    const info = await C.Plugins.App.getInfo();
    return parseVersion(info?.version) ? String(info.version).trim() : "";   // kept as the app says it, suffix included; the compare ignores the suffix
  } catch { return ""; }
}

export type UpdateDeps = {
  api: string;
  win: any;
  store?: Store | null;
  fetchJson?: (url: string) => Promise<any>;
  /** Puts the prompt on screen. gone() records a dismissal; the caller runs it for the dismiss button, a swipe and Download. */
  show: (version: string, gone: () => void) => void;
};

const getJson = async (u: string) => { const r = await fetch(u, { credentials: "same-origin" }); return r.ok ? r.json() : null; };

/** One check: true when the prompt was shown. Never throws. */
export async function checkForUpdate(d: UpdateDeps): Promise<boolean> {
  try {
    const have = await installedVersion(d.win);
    if (!have) return false;
    const j = await (d.fetchJson || getJson)(`${d.api}/app-update/android`);
    const latest = String(j?.version || "").trim();
    if (!parseVersion(latest) || !shouldPrompt(have, latest, readDismissed(d.store))) return false;
    d.show(latest, () => saveDismissed(d.store, latest));
    return true;
  } catch { return false; }
}

/** Opens the APK in the system browser (a Chrome tab), where the download and Android's installer work. */
export function openDownload(win: any) {
  try { return Promise.resolve(win.Capacitor.Plugins.Browser.open({ url: APK_URL })).catch(() => {}); } catch { return Promise.resolve(); }
}

/** Checks once at launch. */
export function initAppUpdate(d: UpdateDeps) { return checkForUpdate(d); }
