import { api, type Channel, type Message, type User } from "./api.ts";
import { S, type AppChannelView as ChannelView } from "./state.ts";

type SettingsTab = "admin" | "agents" | "skills" | "connections" | "notifications" | "feedback" | "audit" | "domains" | "providers" | "computers" | "members";

let settingsModule: Promise<typeof import("./settings.ts")> | null = null;
let routingModule: Promise<typeof import("./routing.ts")> | null = null;
let terminalModule: Promise<typeof import("./term.ts")> | null = null;
let coworkModule: Promise<typeof import("./cowork.ts")> | null = null;
let latestRoutingActivity: unknown;
const stagedCoworkPaths = new Map<number, string>();
const loadedStylesheets = new Map<string, Promise<void>>();

function loadStylesheetOnce(href: string): Promise<void> {
  const existing = loadedStylesheets.get(href);
  if (existing) return existing;
  const loaded = new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error(`Unable to load ${href}`)), { once: true });
    document.head.append(link);
  });
  loadedStylesheets.set(href, loaded);
  return loaded;
}

const settings = () => settingsModule ||= import("./settings.ts");
const routing = () => routingModule ||= import("./routing.ts");
export const terminal = () => terminalModule ||= Promise.all([
  import("./term.ts"),
  loadStylesheetOnce("/xterm.css"),
]).then(([module]) => module);
const cowork = () => coworkModule ||= import("./cowork.ts");

export async function finishOpenRouterOAuthLazy(): Promise<{ connected: boolean }> {
  if (!new URLSearchParams(location.search).has("code")) return { connected: false };
  return (await settings()).finishOpenRouterOAuth();
}

export async function openSettingsLazy(tab: SettingsTab): Promise<void> {
  const [{ channels, users, computers }, module] = await Promise.all([
    Promise.all([
      api<{ channels: Channel[] }>("/api/channels?summary=1"),
      api<{ users: User[] }>("/api/users"),
      api<{ computers: unknown[] }>("/api/computers").catch(() => ({ computers: [] })),
    ]).then(([channelResult, userResult, computerResult]) => ({ channels: channelResult.channels, users: userResult.users, computers: computerResult.computers })),
    settings(),
  ]);
  S.channels = channels; S.users = users; S.computers = computers as typeof S.computers;
  module.openSettings(tab);
}

export function refreshOpenSkillsSettingsLazy(): void {
  if (!document.querySelector("[data-settings-overlay]")) return;
  void settings().then((module) => module.refreshOpenSkillsSettings());
}

export function pushRoutingActivityLazy(activity: unknown): void {
  latestRoutingActivity = activity;
  if (routingModule) void routingModule.then((module) => module.pushRoutingActivity(activity));
}

export async function openRoutingPopoverLazy(event: MouseEvent): Promise<void> {
  const module = await routing();
  if (latestRoutingActivity !== undefined) module.pushRoutingActivity(latestRoutingActivity);
  await module.openRoutingPopover(event);
}

export async function openOnboardingLazy(root: HTMLElement, opts: { resume: boolean; resumeStep?: number; onDone: () => Promise<void> }): Promise<void> {
  (await import("./onboarding.ts")).openOnboarding(root, opts);
}

export function stageCoworkPathLazy(channelId: number, path: string): void {
  stagedCoworkPaths.set(channelId, path);
  if (coworkModule) void coworkModule.then((module) => module.stageCoworkPath(channelId, path));
}

export function setActiveCoworkChannelLazy(channelId: number | null): void {
  if (coworkModule) void coworkModule.then((module) => module.setActiveCoworkChannel(channelId));
}

export async function renderCoworkLazy(
  container: HTMLElement,
  channelId: number,
  channel: Channel,
  me: User,
  onOpenThread: (root: Message) => void,
  preserveExisting: boolean,
): Promise<void> {
  const [module] = await Promise.all([cowork(), loadStylesheetOnce("/excalidraw/index.css")]);
  const staged = stagedCoworkPaths.get(channelId);
  if (staged) { module.stageCoworkPath(channelId, staged); stagedCoworkPaths.delete(channelId); }
  module.setActiveCoworkChannel(channelId);
  module.renderCowork(container, channelId, channel, me, onOpenThread, preserveExisting);
}

export function lazySurfacePlaceholder(label: string, view?: ChannelView): HTMLElement {
  const element = document.createElement("div");
  element.className = "grid h-full min-h-48 place-items-center text-sm text-muted";
  if (view) element.dataset.lazyView = view;
  element.textContent = `Opening ${label}…`;
  return element;
}
