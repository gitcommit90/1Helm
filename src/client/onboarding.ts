import { api, getToken, setToken, type Provider } from "./api.ts";
import { h, clear, icon, helmMark, providerMark } from "./dom.ts";
import { startChatGPTOAuth, startOpenRouterOAuth } from "./settings.ts";

type WizardOptions = {
  resume: boolean;
  resumeStep?: number;
  onDone: () => Promise<void>;
};

type ProviderChoice = { provider: Provider; models: string[]; model: string };
const steps = ["Owner", "AI brain", "Access", "Workspace"];

function setBusy(button: HTMLButtonElement, busy: boolean, label?: string): void {
  if (!button.dataset.label) button.dataset.label = button.textContent || "";
  button.disabled = busy;
  button.textContent = busy ? label || "Working…" : button.dataset.label;
}

export function openOnboarding(root: HTMLElement, opts: WizardOptions): void {
  let step = opts.resume ? opts.resumeStep || 1 : 0;
  let providers: Provider[] = [];
  let choice: ProviderChoice | null = null;
  let terminalsEnabled = true;

  const shell = h("div", { class: "wizard-shell h-full" });
  const stage = h("div", { class: "mx-auto flex min-h-full w-full max-w-[620px] items-start px-4 py-8 sm:items-center sm:px-6" });
  const panel = h("section", { class: "w-full" });
  stage.append(panel); shell.append(stage); clear(root); root.append(shell);

  const refreshProviders = async (): Promise<void> => {
    if (getToken()) providers = (await api<{ providers: Provider[] }>("/api/providers")).providers;
  };

  const setChoice = async (provider: Provider): Promise<void> => {
    let models: string[] = [];
    try { models = (await api<{ models: string[] }>(`/api/providers/${provider.id}/models`)).models; }
    catch { /* The UI will show the provider and ask user to retry models. */ }
    const preferred = provider.kind === "openrouter"
      ? models.find((model) => /:free$/i.test(model)) || models[0] || ""
      : models[0] || "";
    choice = { provider, models, model: preferred };
  };

  const brand = (): HTMLElement => h("div", { class: "mb-8 flex items-center justify-between" },
    h("div", { class: "flex items-center gap-3" },
      h("span", { class: "logo-plate h-9 w-9 rounded-xl" }, h("img", { class: "logo-asset", src: "/brand/1helm.png", alt: "1Helm" })),
      h("div", {}, h("div", { class: "font-display text-sm font-bold tracking-[-0.03em] text-fg" }, "1Helm"), h("div", { class: "text-[10px] font-semibold uppercase tracking-[0.16em] text-muted" }, "Private control plane"))),
    h("div", { class: "rounded-full border border-line bg-raised px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted" }, `Step ${step + 1} / ${steps.length}`));

  const progress = (): HTMLElement => h("div", { class: "mb-8" },
    h("div", { class: "mb-2 flex justify-between text-[11px] uppercase tracking-[0.14em] text-muted" }, ...steps.map((label, index) => h("span", { class: index === step ? "text-fg" : "" }, label))),
    h("div", { class: "wizard-progress" }, h("span", { style: `width:${((step + 1) / steps.length) * 100}%` })));

  const render = async (): Promise<void> => {
    clear(panel);
    if (step === 0) panel.append(accountStep());
    else if (step === 1) { await refreshProviders(); panel.append(brainStep()); }
    else if (step === 2) panel.append(accessStep());
    else panel.append(workspaceStep());
    shell.scrollTo({ top: 0, behavior: "smooth" });
  };

  const layout = (title: string, subtitle: string, body: HTMLElement, footer?: HTMLElement): HTMLElement =>
    h("div", { class: "wizard-panel overflow-hidden" },
      h("div", { class: "px-6 pt-6 sm:px-8 sm:pt-8" }, brand(), progress()),
      h("div", { class: "px-6 pb-2 sm:px-8" }, h("h2", { class: "text-[1.65rem] font-semibold tracking-tight text-fg" }, title), h("p", { class: "mt-2 max-w-xl text-sm leading-6 text-muted" }, subtitle)),
      h("div", { class: "space-y-5 px-6 py-6 sm:px-8" }, body), footer || null);

  const footer = (back: (() => void) | null, next: (() => void), label: string, disabled = false): HTMLElement => {
    const nextButton = h("button", { class: "btn-primary min-w-28 px-4 py-2", disabled, onclick: next }, label) as HTMLButtonElement;
    return h("div", { class: "flex items-center justify-between border-t border-line px-6 py-4 sm:px-8" },
      back ? h("button", { class: "btn-ghost px-2", onclick: back }, "Back") : h("span"), nextButton);
  };

  const field = (label: string, input: HTMLElement, help?: string): HTMLElement => h("label", { class: "block" }, h("span", { class: "wizard-label" }, label), input, help ? h("span", { class: "wizard-help" }, help) : null);

  const accountStep = (): HTMLElement => {
    const username = h("input", { class: "field", placeholder: "ada", autocomplete: "username" }) as HTMLInputElement;
    const display = h("input", { class: "field", placeholder: "Ada Lovelace", autocomplete: "name" }) as HTMLInputElement;
    const password = h("input", { class: "field", type: "password", placeholder: "At least 4 characters", autocomplete: "new-password" }) as HTMLInputElement;
    const status = h("div");
    const submit = async (): Promise<void> => {
      const button = panel.querySelector("button.btn-primary") as HTMLButtonElement;
      status.textContent = ""; setBusy(button, true, "Creating owner…");
      try {
        const result = await api<{ token: string }>("/api/auth/register", { body: { username: username.value, display: display.value, password: password.value } });
        setToken(result.token); step = 1; await render();
      } catch (error) { status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message)); setBusy(button, false); }
    };
    password.addEventListener("keydown", (event) => { if (event.key === "Enter") void submit(); });
    queueMicrotask(() => username.focus());
    return layout("Create the owner account", "This account owns this workspace. Add people later if you need them.",
      h("div", { class: "space-y-4" }, field("Username", username, "Lowercase letters, numbers, dots, dashes, and underscores."), field("Your name", display, "How people and agents will address you."), field("Password", password), status),
      footer(null, () => { void submit(); }, "Continue"));
  };

  const brainStep = (): HTMLElement => {
    const status = h("div");
    const name = h("input", { class: "field", placeholder: "OpenAI, local gateway, work account" }) as HTMLInputElement;
    const baseUrl = h("input", { class: "field", placeholder: "https://api.openai.com/v1" }) as HTMLInputElement;
    const apiKey = h("input", { class: "field", type: "password", placeholder: "Paste your API key" }) as HTMLInputElement;
    const modelSelect = h("select", { class: "field", disabled: true }, h("option", { value: "" }, "Test the connection to load models")) as HTMLSelectElement;
    const useCustom = h("button", { class: "btn-primary w-full py-2", disabled: true }, "Use this provider") as HTMLButtonElement;
    let testedModels: string[] = [];
    let continueButton: HTMLButtonElement | undefined;
    const syncContinue = (): void => { if (continueButton) continueButton.disabled = !choice?.provider || !choice.model; };

    const renderChoice = (): void => {
      const selected = choice?.provider.id;
      clear(modelSelect);
      const models = choice?.models || [];
      if (!models.length) modelSelect.append(h("option", { value: "" }, "No models available — test again"));
      for (const model of models) modelSelect.append(h("option", { value: model, selected: model === choice?.model }, model));
      modelSelect.disabled = !models.length;
      modelSelect.onchange = () => { if (choice) { choice.model = modelSelect.value; syncContinue(); } };
      useCustom.disabled = !choice || !choice.model;
      syncContinue();
      if (choice) {
        status.replaceChildren(h("div", { class: "wizard-status-ok" }, `Using ${choice.provider.name} · ${choice.model || "choose a model"}`));
      }
      providerChoices.replaceChildren(
        ...providers.map((provider) => h("button", { class: `wizard-choice flex items-center justify-between gap-3 ${provider.id === selected ? "is-active" : ""}`, onclick: () => { void selectExisting(provider); } },
          h("div", { class: "min-w-0" }, h("div", { class: "flex items-center gap-2.5" }, h("span", { class: "wizard-provider-mark" }, providerMark(provider.kind, 18)), h("span", { class: "truncate font-semibold text-fg" }, provider.name)), h("div", { class: "mt-1 truncate text-xs text-muted" }, provider.kind === "chatgpt" ? "Login with ChatGPT" : provider.base_url)),
          provider.id === selected ? h("span", { class: "text-ok" }, icon("check", 18)) : h("span", { class: "text-muted" }, "Select"))));
    };

    const selectExisting = async (provider: Provider): Promise<void> => {
      status.replaceChildren(h("div", { class: "wizard-status-warn" }, "Loading available models…"));
      try { await setChoice(provider); renderChoice(); if (!choice?.models.length) status.replaceChildren(h("div", { class: "wizard-status-err" }, "This provider did not return any models. Check the connection in Settings or select another provider.")); }
      catch (error) { status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message)); }
    };

    const testCustom = async (button: HTMLButtonElement): Promise<void> => {
      status.textContent = ""; setBusy(button, true, "Testing connection…");
      try {
        testedModels = (await api<{ models: string[] }>("/api/providers/fetch-models", { body: { base_url: baseUrl.value.trim(), api_key: apiKey.value } })).models;
        if (!testedModels.length) throw new Error("The provider responded, but did not return any models.");
        clear(modelSelect);
        modelSelect.disabled = false;
        modelSelect.append(...testedModels.map((model) => h("option", { value: model }, model)));
        useCustom.disabled = false;
        status.replaceChildren(h("div", { class: "wizard-status-ok" }, `${testedModels.length} models found. Choose the one Skipper should start with.`));
      } catch (error) { status.replaceChildren(h("div", { class: "wizard-status-err" }, `Could not load models: ${(error as Error).message}`)); }
      finally { setBusy(button, false); }
    };

    const saveCustom = async (): Promise<void> => {
      setBusy(useCustom, true, "Saving provider…");
      try {
        const result = await api<{ provider: Provider }>("/api/providers", { body: { name: name.value.trim() || "My provider", base_url: baseUrl.value.trim(), api_key: apiKey.value } });
        providers.push(result.provider);
        choice = { provider: result.provider, models: testedModels, model: modelSelect.value };
        renderChoice();
      } catch (error) { status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message)); }
      finally { setBusy(useCustom, false); }
    };

    const connectOpenRouter = async (button: HTMLButtonElement): Promise<void> => {
      setBusy(button, true, "Opening OpenRouter…");
      try { await startOpenRouterOAuth(); } catch (error) { status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message)); setBusy(button, false); }
    };
    const connectChatGPT = async (button: HTMLButtonElement): Promise<void> => {
      setBusy(button, true, "Waiting for ChatGPT…");
      try { await startChatGPTOAuth(); await refreshProviders(); renderChoice(); }
      catch (error) { status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message)); }
      finally { setBusy(button, false); }
    };

    const providerChoices = h("div", { class: "space-y-2" });
    const testButton = h("button", { class: "btn-subtle w-full py-2", onclick: (event: Event) => { void testCustom(event.currentTarget as HTMLButtonElement); } }, "Test connection & load models") as HTMLButtonElement;
    useCustom.onclick = () => { void saveCustom(); };
    const openRouter = h("button", { class: "wizard-choice flex items-center gap-3", onclick: (event: Event) => { void connectOpenRouter(event.currentTarget as HTMLButtonElement); } }, h("span", { class: "wizard-provider-mark" }, providerMark("openrouter", 20)), h("div", {}, h("div", { class: "font-semibold text-fg" }, "OpenRouter"), h("div", { class: "text-sm leading-5 text-muted" }, "Connect once. Start Skipper on a free model."))) as HTMLButtonElement;
    const chatgpt = h("button", { class: "wizard-choice flex items-center gap-3", onclick: (event: Event) => { void connectChatGPT(event.currentTarget as HTMLButtonElement); } }, h("span", { class: "wizard-provider-mark" }, providerMark("chatgpt", 20)), h("div", {}, h("div", { class: "font-semibold text-fg" }, "ChatGPT"), h("div", { class: "text-sm leading-5 text-muted" }, "Use your Login with ChatGPT account."))) as HTMLButtonElement;

    const next = async (): Promise<void> => {
      if (!choice?.provider || !choice.model) return;
      step = 2; await render();
    };
    const body = h("div", { class: "space-y-6" },
      providers.length ? h("div", {}, h("div", { class: "mb-2 text-sm font-semibold text-fg" }, "Connected providers"), providerChoices) : null,
      h("div", { class: "grid gap-2 sm:grid-cols-2" }, openRouter, chatgpt),
      location.protocol === "http:" && location.hostname !== "localhost" ? h("div", { class: "wizard-status-warn" }, "OpenRouter needs HTTPS or localhost. On this HTTP address, use an API key or ChatGPT until you add HTTPS.") : null,
      h("div", { class: "border-t border-line pt-6" }, h("div", { class: "mb-1 text-sm font-semibold text-fg" }, "Or connect any OpenAI-compatible endpoint"), h("p", { class: "mb-4 text-sm text-muted" }, "We test it before saving anything, then you choose exactly which model Skipper starts on."),
        h("div", { class: "space-y-4" }, field("Connection name", name), field("Base URL", baseUrl, "Usually ends in /v1."), field("API key", apiKey), testButton, field("Starter model", modelSelect, "You can change Skipper’s model later in Settings."), useCustom)),
      status);
    const brainFooter = footer(() => { step = 0; void render(); }, () => { void next(); }, "Continue", true);
    continueButton = brainFooter.querySelector("button.btn-primary") as HTMLButtonElement;
    queueMicrotask(renderChoice);
    return layout("Connect an AI brain", "Choose where Skipper gets its model. The connection stays on this machine and can be changed later.", body, brainFooter);
  };

  const accessStep = (): HTMLElement => {
    const choiceButton = (enabled: boolean, label: string, copy: string): HTMLElement => h("button", { class: `wizard-choice ${terminalsEnabled === enabled ? "is-active" : ""}`, onclick: () => { terminalsEnabled = enabled; void render(); } },
      h("div", { class: "flex items-start gap-3" }, h("span", { class: "wizard-provider-mark h-10 w-10 text-muted" }, enabled ? icon("terminal", 19) : icon("x", 19)), h("div", {}, h("div", { class: "font-semibold text-fg" }, label), h("p", { class: "mt-1 text-sm leading-5 text-muted" }, copy))));
    return layout("Do you want terminal access?", "Most people can leave this off. This only controls whether the Terminals button appears in your sidebar.",
      h("div", { class: "space-y-3" }, choiceButton(true, "Enable terminals", "Keep a persistent shell to this machine inside 1Helm."), choiceButton(false, "Keep the workspace focused", "Hide terminals and use chat only for now.")),
      footer(() => { step = 1; void render(); }, () => { step = 3; void render(); }, "Continue"));
  };

  const workspaceStep = (): HTMLElement => {
    const name = h("input", { class: "field text-lg", value: "My Workspace", autocomplete: "organization" }) as HTMLInputElement;
    const status = h("div");
    const finish = async (): Promise<void> => {
      const button = panel.querySelector("button.btn-primary") as HTMLButtonElement;
      setBusy(button, true, "Starting workspace…");
      try {
        await api("/api/setup/complete", { body: { name: name.value.trim() || "My Workspace", terminals_enabled: terminalsEnabled, provider_id: choice?.provider.id, model: choice?.model } });
        clear(panel); panel.append(h("div", { class: "wizard-panel px-8 py-12 text-center" }, h("div", { class: "logo-plate mx-auto grid h-14 w-14 place-items-center rounded-2xl" }, h("img", { class: "logo-asset", src: "/brand/1helm.png", alt: "1Helm" })), h("h2", { class: "mt-5 font-display text-2xl font-semibold tracking-[-0.03em] text-fg" }, "Your workspace is ready."), h("p", { class: "mx-auto mt-3 max-w-sm text-sm leading-6 text-muted" }, "Skipper is setting up your home base in #main.")));
        setTimeout(() => { void opts.onDone(); }, 700);
      } catch (error) { status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message)); setBusy(button, false); }
    };
    name.addEventListener("keydown", (event) => { if (event.key === "Enter") void finish(); });
    queueMicrotask(() => { name.focus(); name.select(); });
    return layout("Name this workspace", "This appears in the sidebar and is how Skipper greets you.",
      h("div", { class: "space-y-4" }, field("Workspace name", name, "You can rename it later."), choice ? h("div", { class: "wizard-status-ok" }, `Skipper will begin with ${choice.provider.name} · ${choice.model}.`) : null, status),
      footer(() => { step = 2; void render(); }, () => { void finish(); }, "Create workspace"));
  };

  void render();
}
