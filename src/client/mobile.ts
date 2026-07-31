import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { SecureStorage, KeychainAccess } from "@aparajita/capacitor-secure-storage";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

const SESSION_KEY = "session";
const SERVER_PREFIX = "1helm_mobile_";
const OPENROUTER_CALLBACK_PREFIX = "onehelm://openrouter";

type StoredSession = { server: string; token: string };
type InstanceGateway = {
  getServer: () => Promise<{ origin: string }>;
  selectServer: (options: { origin: string }) => Promise<{ origin: string }>;
  clearServer: () => Promise<void>;
};
const instanceGateway = registerPlugin<InstanceGateway>("InstanceGateway");

const native = Capacitor.isNativePlatform();
let serverOrigin = "";
let launchFinishQueued = false;
let viewportInstalled = false;

/** Keep the reserved native status surface visually joined to the app header. */
export async function syncNativeStatusSurface(): Promise<void> {
  if (!native) return;
  const surface = getComputedStyle(document.documentElement).getPropertyValue("--c-surface").trim() || "#111318";
  const statusStyle = document.documentElement.classList.contains("light") ? Style.Light : Style.Dark;
  await Promise.allSettled([
    StatusBar.setBackgroundColor({ color: surface }),
    StatusBar.setStyle({ style: statusStyle }),
  ]);
}

export const isNativeMobile = (): boolean => native;
export const mobilePlatform = (): string => native ? Capacitor.getPlatform() : "web";
export const getServerOrigin = (): string => serverOrigin;

/** Track the truly visible viewport (browser chrome + keyboard), and let an
 * upward conversation scroll dismiss composition like a native messenger. */
export function installMobileViewportBehavior(): void {
  if (viewportInstalled) return;
  viewportInstalled = true;
  const update = (): void => {
    const viewport = window.visualViewport;
    const height = Math.max(320, viewport?.height || window.innerHeight);
    const keyboard = Math.max(0, window.innerHeight - height - (viewport?.offsetTop || 0));
    document.documentElement.style.setProperty("--app-viewport-height", `${height}px`);
    document.documentElement.style.setProperty("--app-keyboard-height", `${keyboard}px`);
    document.documentElement.classList.toggle("keyboard-visible", keyboard > 120);
    window.dispatchEvent(new CustomEvent("1helm:viewport", { detail: { height, keyboard } }));
  };
  // Opening the keyboard resizes the visual viewport, which reflows tall
  // conversations and fires scroll events that are NOT user gestures. Blurring
  // on those made the keyboard close itself immediately after opening. Only a
  // deliberate upward finger drag may dismiss composition, and never during
  // the settle window right after focus/keyboard-resize.
  let settleUntil = 0;
  const markSettle = (): void => { settleUntil = Date.now() + 700; };
  window.visualViewport?.addEventListener("resize", () => { markSettle(); update(); }, { passive: true });
  window.visualViewport?.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", () => { markSettle(); update(); }, { passive: true });
  document.addEventListener("focusin", (event) => {
    if ((event.target as HTMLElement | null)?.closest?.(".composer-wrap")) markSettle();
  }, true);
  update();
  let touchActive = false;
  let touchStartY = 0;
  let touchDraggedUp = false;
  document.addEventListener("touchstart", (event) => {
    touchActive = true;
    touchDraggedUp = false;
    touchStartY = event.touches[0]?.clientY ?? 0;
  }, { passive: true, capture: true });
  document.addEventListener("touchmove", (event) => {
    // Finger moving down the screen = content scrolling up (toward history).
    const y = event.touches[0]?.clientY ?? 0;
    if (y - touchStartY > 12) touchDraggedUp = true;
  }, { passive: true, capture: true });
  document.addEventListener("touchend", () => {
    // Momentum scrolling continues after touchend; keep the gesture flag
    // briefly so an intentional fling still dismisses, then reset.
    setTimeout(() => { touchActive = false; touchDraggedUp = false; }, 400);
  }, { passive: true, capture: true });
  const lastTop = new WeakMap<HTMLElement, number>();
  document.addEventListener("scroll", (event) => {
    if (!matchMedia("(max-width: 767px)").matches) return;
    const target = event.target as HTMLElement | null;
    if (!target?.matches?.("#msgs,#threadmsgs,#channelview,[data-cowork-chat-stream]")) return;
    const previous = lastTop.get(target) ?? target.scrollTop;
    const scrolledUp = target.scrollTop < previous - 2;
    lastTop.set(target, target.scrollTop);
    // Layout/keyboard-induced scrolls and programmatic stick-to-bottom must
    // never steal the keyboard: require a real upward touch drag, outside the
    // focus/resize settle window.
    if (Date.now() < settleUntil) return;
    if (!touchActive || !touchDraggedUp || !scrolledUp) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active?.closest?.(".composer-wrap")) return;
    active.blur();
    if (native) void Keyboard.hide().catch(() => undefined);
  }, true);
}

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
  return serverOrigin;
}

export async function forgetMobileServer(): Promise<void> {
  if (!native) return;
  await removeSecureSession();
  await instanceGateway.clearServer();
  serverOrigin = "";
}

export function apiUrl(path: string): string {
  if (!native || !path.startsWith("/")) return path;
  if (!serverOrigin || location.origin !== serverOrigin) throw new Error("The selected 1Helm instance is unavailable.");
  return path;
}

export function serverAssetUrl(path: string): string {
  return path;
}

export function serverWebSocketUrl(path: string): string {
  const target = new URL(location.origin);
  if (native && (!serverOrigin || location.origin !== serverOrigin)) throw new Error("The selected 1Helm instance is unavailable.");
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  target.pathname = path.split("?")[0] || "/";
  target.search = path.includes("?") ? path.slice(path.indexOf("?")) : "";
  return target.toString();
}

export async function initializeMobileRuntime(): Promise<string> {
  installMobileViewportBehavior();
  if (!native) return localStorage.getItem("ctrl.token") || "";
  const platform = mobilePlatform();
  document.documentElement.dataset.nativeMobile = platform;
  const selected = await instanceGateway.getServer().catch(() => ({ origin: "" }));
  serverOrigin = normalizeServerOrigin(selected.origin || location.origin);
  if (serverOrigin !== location.origin) throw new Error("The native bridge is restricted to the selected 1Helm origin.");

  await SecureStorage.setKeyPrefix(SERVER_PREFIX);
  if (mobilePlatform() === "ios") {
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
  }

  await Promise.allSettled([
    StatusBar.setOverlaysWebView({ overlay: platform !== "ios" }),
    Keyboard.setResizeMode({ mode: KeyboardResize.Native }),
  ]);
  await syncNativeStatusSurface();
  window.addEventListener("themechange", () => { void syncNativeStatusSurface(); });

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
