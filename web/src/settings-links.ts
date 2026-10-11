// Explicit assistant links, never inferred from words in an answer. Opening a
// destination only navigates; its controls keep their normal save/approval paths.
export const SETTINGS_DESTINATIONS = {
  general: { section: "general", label: "General" },
  usage: { section: "general", label: "Usage", focus: ".susage" },
  appearance: { section: "general", label: "Appearance", focus: "[data-settings-appearance]" },
  costs: { section: "general", label: "Show estimated costs", focus: "[data-costrow]" },
  account: { section: "account", label: "Your account" },
  accounts: { section: "accounts", label: "Connected accounts" },
  "computer-network": { section: "computer-network", label: "Computer connections" },
  wallet: { section: "wallet", label: "Wallet" },
  keys: { section: "keys", label: "Passwords & keys" },
  perm: { section: "perm", label: "Permissions" },
  checkins: { section: "perm", label: "Agent check-ins", focus: "#pm-checkins" },
  device: { section: "device", label: "Location & mic" },
  texting: { section: "texting", label: "Texting" },
  ambient: { section: "ambient", label: "Ambient" },
  notif: { section: "notif", label: "Notifications" },
  advanced: { section: "advanced", label: "Advanced" },   // = CMCP_SEC in custom-mcp.ts (literal here: no import cycle)
  aipriv: { section: "aipriv", label: "AI data privacy" },
  byok: { section: "byok", label: "Use my own AI key" },
  help: { section: "help", label: "Help & support" },
  shortcuts: { section: "shortcuts", label: "Keyboard shortcuts" },
  legal: { section: "legal", label: "Legal" },
} as const;
export type SettingsDestination = keyof typeof SETTINGS_DESTINATIONS;
export function settingsDestination(value: string): SettingsDestination | null {
  return Object.hasOwn(SETTINGS_DESTINATIONS, value) ? value as SettingsDestination : null;
}
export function settingsLinkDestination(href: string): SettingsDestination | null {
  return href.startsWith("#settings/") ? settingsDestination(href.slice(10)) : null;
}
export function settingsLinkHtml(href: string): string | null {
  const id = settingsLinkDestination(href); if (!id) return null;
  // Every interpolated value comes from the static allowlist, including the label.
  const label = SETTINGS_DESTINATIONS[id].label.replace(/&/g, "&amp;");
  return `<button type="button" class="settings-link" data-settings-link="${id}" aria-label="Open in Settings: ${label}" title="${label}">Open in Settings <span aria-hidden="true">↗</span></button>`;
}
export function settingsTarget(id: SettingsDestination, mobile: boolean) {
  const destination = SETTINGS_DESTINATIONS[id];
  return { ...destination, section: id === "usage" && mobile ? "" : destination.section };
}
