type Avatar = (name: string, kind: "user" | "bot" | "system", size?: number, avatarValue?: string) => HTMLElement;
type SettingsUi = { avatar: Avatar; reloadProviders: () => Promise<void>; renderApp: () => void };

let ui: SettingsUi | null = null;
export function setSettingsUi(value: SettingsUi): void { ui = value; }
export function configureSettingsUi(): SettingsUi {
  return {
    avatar: (...args) => ui!.avatar(...args),
    reloadProviders: async () => { if (ui) await ui.reloadProviders(); },
    renderApp: () => ui?.renderApp(),
  };
}
