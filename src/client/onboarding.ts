import { api, getToken, setToken, type Provider } from "./api.ts";
import { h, clear, icon } from "./dom.ts";
import { startChatGPTOAuth, startOpenRouterOAuth } from "./settings.ts";

type WizardOptions = {
  resume: boolean;
  resumeStep?: number;
  onDone: (channelId?: number) => Promise<void>;
};

const steps = ["Account", "AI brain", "Terminals", "Workspace"];

export function openOnboarding(root: HTMLElement, opts: WizardOptions): void {
  let step = opts.resume ? opts.resumeStep || 1 : 0;
  let providers: Provider[] = [];
  let terminalsEnabled = true;
  const shell = h("div", { class: "grid h-full place-items-center bg-bg p-6" });
  const card = h("div", { class: "w-full max-w-[520px]" });
  shell.append(card);
  clear(root); root.append(shell);

  const refreshProviders = async (): Promise<void> => {
    if (!getToken()) return;
    providers = (await api<{ providers: Provider[] }>("/api/providers")).providers;
  };

  const brand = (): HTMLElement => h("div", { class: "mb-6 flex items-center justify-center gap-2.5" },
    h("div", { class: "grid h-11 w-11 place-items-center rounded-xl bg-accent font-mono text-2xl text-accent-fg shadow-lg" }, "1"),
    h("h1", { class: "text-2xl font-bold text-fg" }, "1Helm"));

  const progress = (): HTMLElement => h("div", { class: "mb-5 flex items-center gap-2" },
    ...steps.map((label, index) => h("div", { class: "flex min-w-0 flex-1 items-center gap-1.5" },
      h("span", { class: `grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${index < step ? "bg-ok text-white" : index === step ? "bg-accent text-accent-fg" : "bg-raised text-muted ring-1 ring-line"}` }, index < step ? icon("check", 12) : String(index + 1)),
      h("span", { class: `truncate text-[11px] font-medium ${index === step ? "text-fg" : "text-muted"}` }, label))));

  const draw = async (): Promise<void> => {
    clear(card);
    card.append(brand(), progress());
    if (step === 0) card.append(accountStep());
    else if (step === 1) {
      await refreshProviders();
      card.append(brainStep());
    } else if (step === 2) card.append(terminalStep());
    else card.append(workspaceStep());
  };

  const accountStep = (): HTMLElement => {
    const username = h("input", { class: "field", placeholder: "username", autocomplete: "username" }) as HTMLInputElement;
    const display = h("input", { class: "field", placeholder: "your name (optional)", autocomplete: "name" }) as HTMLInputElement;
    const password = h("input", { class: "field", type: "password", placeholder: "password (at least 4 characters)", autocomplete: "new-password" }) as HTMLInputElement;
    const error = h("p", { class: "min-h-5 text-sm text-danger" });
    const submit = async (): Promise<void> => {
      error.textContent = "";
      try {
        const r = await api<{ token: string }>("/api/auth/register", { body: { username: username.value, display: display.value, password: password.value } });
        setToken(r.token);
        step = 1;
        await draw();
      } catch (e) { error.textContent = (e as Error).message; }
    };
    password.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void submit(); });
    queueMicrotask(() => username.focus());
    return h("div", { class: "card space-y-4 p-7 shadow-xl" },
      h("div", {}, h("h2", { class: "text-lg font-semibold text-fg" }, "Create your workspace owner account"), h("p", { class: "mt-1 text-sm text-muted" }, "This account administers your self-hosted 1Helm workspace.")),
      h("div", { class: "space-y-3" }, username, display, password), error,
      h("button", { class: "btn-primary w-full py-2", onclick: () => { void submit(); } }, "Continue", icon("arrow-right", 16)));
  };

  const brainStep = (): HTMLElement => {
    const status = h("p", { class: "min-h-5 text-sm text-muted" });
    const providerList = h("div", { class: "space-y-2" }, ...providers.map((p) => h("div", { class: "flex items-center justify-between rounded-lg border border-line bg-raised px-3 py-2" },
      h("div", {}, h("div", { class: "text-sm font-semibold text-fg" }, p.name), h("div", { class: "text-xs text-muted" }, p.kind === "chatgpt" ? "Login with ChatGPT" : p.base_url)),
      h("span", { class: "chip border-ok/40 text-ok" }, "Connected"))));
    const name = h("input", { class: "field", placeholder: "Provider name (e.g. OpenAI, work gateway)", value: "My provider" }) as HTMLInputElement;
    const baseUrl = h("input", { class: "field", placeholder: "Base URL, e.g. https://api.openai.com/v1" }) as HTMLInputElement;
    const key = h("input", { class: "field", type: "password", placeholder: "API key" }) as HTMLInputElement;
    const addCustom = async (): Promise<void> => {
      status.textContent = "Connecting…";
      try {
        await api("/api/providers", { body: { name: name.value, base_url: baseUrl.value, api_key: key.value } });
        await refreshProviders();
        await draw();
      } catch (e) { status.textContent = (e as Error).message; }
    };
    const connectOpenRouter = async (): Promise<void> => {
      status.textContent = "Redirecting to OpenRouter…";
      try { await startOpenRouterOAuth(); }
      catch (e) { status.textContent = (e as Error).message; }
    };
    const connectChatGPT = async (): Promise<void> => {
      try {
        await startChatGPTOAuth();
        await refreshProviders();
        await draw();
      } catch (e) { status.textContent = (e as Error).message; }
    };
    return h("div", { class: "card space-y-4 p-7 shadow-xl" },
      h("div", {}, h("h2", { class: "text-lg font-semibold text-fg" }, "Connect an AI brain"), h("p", { class: "mt-1 text-sm text-muted" }, "1Helm uses your own provider account. You can change models and providers later in Settings.")),
      providers.length ? providerList : h("p", { class: "rounded-lg border border-line bg-raised px-3 py-2 text-sm text-muted" }, "Connect one provider to power @skipper."),
      h("div", { class: "rounded-lg border border-line p-3" },
        h("div", { class: "mb-2 text-sm font-semibold text-fg" }, "Use an API key"),
        h("div", { class: "space-y-2" }, name, baseUrl, key),
        h("button", { class: "btn-primary mt-3 w-full text-sm", onclick: () => { void addCustom(); } }, "Connect provider")),
      h("div", { class: "grid grid-cols-2 gap-2" },
        h("button", { class: "btn-subtle justify-center text-sm", onclick: () => { void connectOpenRouter(); } }, "Connect OpenRouter"),
        h("button", { class: "btn-subtle justify-center text-sm", onclick: () => { void connectChatGPT(); } }, "Connect ChatGPT")),
      location.protocol === "http:" && location.hostname !== "localhost"
        ? h("p", { class: "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300" }, "OpenRouter sign-in needs HTTPS or localhost. Use an API key or ChatGPT on this HTTP address, or add HTTPS first.")
        : null,
      status,
      h("div", { class: "flex justify-between border-t border-line pt-4" },
        h("button", { class: "btn-subtle text-sm", onclick: () => { step = 0; void draw(); }, disabled: opts.resume }, "Back"),
        h("button", { class: "btn-primary text-sm", onclick: () => { if (providers.length) { step = 2; void draw(); } else status.textContent = "Connect a provider before continuing."; } }, "Continue", icon("arrow-right", 16))));
  };

  const terminalStep = (): HTMLElement => {
    const select = (enabled: boolean, label: string, copy: string): HTMLElement => h("button", {
      class: `w-full rounded-xl border p-4 text-left transition ${terminalsEnabled === enabled ? "border-accent bg-accent-soft ring-1 ring-accent/40" : "border-line bg-raised hover:bg-hover"}`,
      onclick: () => { terminalsEnabled = enabled; void draw(); },
    }, h("div", { class: "flex items-center gap-3" }, h("span", { class: `grid h-9 w-9 place-items-center rounded-lg ${enabled ? "bg-accent text-accent-fg" : "bg-muted/20 text-muted"}` }, enabled ? icon("terminal") : icon("x")),
      h("div", {}, h("div", { class: "font-semibold text-fg" }, label), h("div", { class: "mt-0.5 text-sm text-muted" }, copy))));
    return h("div", { class: "card space-y-4 p-7 shadow-xl" },
      h("div", {}, h("h2", { class: "text-lg font-semibold text-fg" }, "Want terminal access?"), h("p", { class: "mt-1 text-sm text-muted" }, "Most people will not need it. Turn it on if you want a live terminal inside 1Helm.")),
      h("div", { class: "space-y-2" }, select(true, "Yes, enable terminals", "Show the Terminals button in the workspace sidebar."), select(false, "No, keep it simple", "Hide terminals for now. You can enable them later.")),
      h("div", { class: "flex justify-between border-t border-line pt-4" }, h("button", { class: "btn-subtle text-sm", onclick: () => { step = 1; void draw(); } }, "Back"), h("button", { class: "btn-primary text-sm", onclick: () => { step = 3; void draw(); } }, "Continue", icon("arrow-right", 16))));
  };

  const workspaceStep = (): HTMLElement => {
    const name = h("input", { class: "field text-lg", placeholder: "e.g. Alex's 1Helm", value: "My Workspace", autocomplete: "organization" }) as HTMLInputElement;
    const status = h("p", { class: "min-h-5 text-sm text-danger" });
    const finish = async (): Promise<void> => {
      status.textContent = "";
      try {
        await api("/api/setup/complete", { body: { name: name.value.trim() || "My Workspace", terminals_enabled: terminalsEnabled } });
        clear(card);
        card.append(brand(), h("div", { class: "card space-y-3 p-7 text-center shadow-xl" }, h("div", { class: "mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent" }, icon("check", 24)), h("h2", { class: "text-lg font-bold text-fg" }, "Your workspace is ready"), h("p", { class: "text-sm text-muted" }, "Skipper is getting your home base ready…")));
        setTimeout(() => { void opts.onDone(); }, 800);
      } catch (e) { status.textContent = (e as Error).message; }
    };
    name.addEventListener("keydown", (event) => { if (event.key === "Enter") void finish(); });
    queueMicrotask(() => { name.focus(); name.select(); });
    return h("div", { class: "card space-y-4 p-7 shadow-xl" },
      h("div", {}, h("h2", { class: "text-lg font-semibold text-fg" }, "What should we call this workspace?"), h("p", { class: "mt-1 text-sm text-muted" }, "This name appears in your 1Helm sidebar and Skipper's welcome.")),
      name, status,
      h("div", { class: "flex justify-between border-t border-line pt-4" }, h("button", { class: "btn-subtle text-sm", onclick: () => { step = 2; void draw(); } }, "Back"), h("button", { class: "btn-primary text-sm", onclick: () => { void finish(); } }, "Create workspace", icon("arrow-right", 16))));
  };

  void draw();
}
