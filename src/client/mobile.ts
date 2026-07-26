import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { SecureStorage, KeychainAccess } from "@aparajita/capacitor-secure-storage";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

const SESSION_KEY = "session";
const SERVER_KEY = "1helm.mobile.server";
const SERVER_PREFIX = "1helm_mobile_";
const OPENROUTER_CALLBACK_PREFIX = "onehelm://openrouter";

type StoredSession = { server: string; token: string };

const native = Capacitor.isNativePlatform();
let serverOrigin = "";
let launchFinishQueued = false;

export const isNativeMobile = (): boolean => native;
export const mobilePlatform = (): string => native ? Capacitor.getPlatform() : "web";
export const getServerOrigin = (): string => serverOrigin;

/** Reveal the first real native screen only after the WebView has painted it. */
export function finishNativeLaunch(): void {
  if (!native || launchFinishQueued) return;
  launchFinishQueued = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    void SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => undefined);
  }));
}

export function normalizeServerOrigin(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("Enter your 1Helm server address.");
  let parsed: URL;
  try { parsed = new URL(raw.includes("://") ? raw : `https://${raw}`); }
  catch { throw new Error("Enter a valid server address, such as https://helm.example.com."); }
  if (parsed.protocol !== "https:") throw new Error("The mobile app connects only to HTTPS 1Helm servers.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Use only the server address, without credentials, a query, or a fragment.");
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname && pathname !== "/") throw new Error("Use the root server address without an extra path.");
  return parsed.origin;
}

export function setMobileServer(value: string): string {
  if (!native) return location.origin;
  serverOrigin = normalizeServerOrigin(value);
  localStorage.setItem(SERVER_KEY, serverOrigin);
  return serverOrigin;
}

export async function forgetMobileServer(): Promise<void> {
  if (!native) return;
  await removeSecureSession();
  serverOrigin = "";
  localStorage.removeItem(SERVER_KEY);
}

export function apiUrl(path: string): string {
  if (!native || !path.startsWith("/")) return path;
  if (!serverOrigin) throw new Error("Choose a 1Helm server before connecting.");
  return `${serverOrigin}${path}`;
}

export function serverAssetUrl(path: string): string {
  if (!native || !path.startsWith("/")) return path;
  return serverOrigin ? `${serverOrigin}${path}` : path;
}

export function serverWebSocketUrl(path: string): string {
  if (!native) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}${path}`;
  }
  if (!serverOrigin) throw new Error("Choose a 1Helm server before connecting.");
  const target = new URL(serverOrigin);
  target.protocol = "wss:";
  target.pathname = path.split("?")[0] || "/";
  target.search = path.includes("?") ? path.slice(path.indexOf("?")) : "";
  return target.toString();
}

export async function initializeMobileRuntime(): Promise<string> {
  if (!native) return localStorage.getItem("ctrl.token") || "";
  document.documentElement.dataset.nativeMobile = mobilePlatform();
  serverOrigin = localStorage.getItem(SERVER_KEY) || "";
  try { if (serverOrigin) serverOrigin = normalizeServerOrigin(serverOrigin); }
  catch { serverOrigin = ""; localStorage.removeItem(SERVER_KEY); }

  await SecureStorage.setKeyPrefix(SERVER_PREFIX);
  if (mobilePlatform() === "ios") {
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
  }

  await Promise.allSettled([
    StatusBar.setStyle({ style: Style.Default }),
    StatusBar.setOverlaysWebView({ overlay: true }),
    Keyboard.setResizeMode({ mode: KeyboardResize.Native }),
  ]);

  await App.addListener("appUrlOpen", ({ url }) => {
    const code = nativeCallbackCode(url);
    if (!code) return;
    void Browser.close().catch(() => undefined);
    location.assign(`/?code=${encodeURIComponent(code)}`);
  });
  const launchUrl = await App.getLaunchUrl().catch(() => undefined);
  const launchCode = nativeCallbackCode(launchUrl?.url || "");
  if (launchCode) history.replaceState({}, "", `/?code=${encodeURIComponent(launchCode)}`);

  installExternalLinkHandling();
  const stored = await SecureStorage.get(SESSION_KEY).catch(() => null);
  if (!stored || typeof stored !== "object") return "";
  const session = stored as StoredSession;
  if (!session.token || !session.server || session.server !== serverOrigin) return "";
  return session.token;
}

export async function persistSecureSession(token: string): Promise<void> {
  if (!native) { localStorage.setItem("ctrl.token", token); return; }
  if (!serverOrigin) throw new Error("Choose a 1Helm server before signing in.");
  await SecureStorage.set(SESSION_KEY, { server: serverOrigin, token }, true, false, KeychainAccess.whenUnlockedThisDeviceOnly);
}

export async function removeSecureSession(): Promise<void> {
  if (!native) { localStorage.removeItem("ctrl.token"); return; }
  await SecureStorage.remove(SESSION_KEY).catch(() => false);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!native) { window.open(url, "_blank", "noopener,noreferrer"); return; }
  await Browser.open({ url, presentationStyle: "fullscreen", toolbarColor: "#15171c" });
}

function installExternalLinkHandling(): void {
  document.addEventListener("click", (event) => {
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    let destination: URL;
    try { destination = new URL(anchor.href); } catch { return; }
    if (!/^https?:$/.test(destination.protocol) || destination.origin === location.origin) return;
    event.preventDefault();
    void openExternalUrl(destination.toString());
  }, true);
}

function nativeCallbackCode(value: string): string {
  try {
    const callback = new URL(value);
    if (`${callback.protocol}//${callback.host}` !== OPENROUTER_CALLBACK_PREFIX) return "";
    return callback.searchParams.get("code") || "";
  }
  catch { return ""; }
}
