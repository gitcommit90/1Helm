import { api, getToken, setToken, type ChannelRuntime, type RoutingState } from "./api.ts";
import { clear, h } from "./dom.ts";
import { onboardingProviderPicker } from "./routing.ts";

type WizardOptions = {
  resume: boolean;
  resumeStep?: number;
  onDone: () => Promise<void>;
};

const steps = ["Captain", "Providers", "Workspace"];

function setBusy(button: HTMLButtonElement, busy: boolean, label?: string): void {
  if (!button.dataset.label) button.dataset.label = button.textContent || "";
  button.disabled = busy;
  button.textContent = busy ? label || "Working…" : button.dataset.label;
}

export function openOnboarding(root: HTMLElement, opts: WizardOptions): void {
  let step = opts.resume ? Math.min(Math.max(opts.resumeStep || 1, 1), steps.length - 1) : 0;
  const shell = h("div", { class: "wizard-shell h-full" });
  const stage = h("div", { class: "mx-auto flex min-h-full w-full max-w-[680px] items-start px-4 py-8 sm:items-center sm:px-6" });
  const panel = h("section", { class: "w-full" });
  stage.append(panel); shell.append(stage); clear(root); root.append(shell);

  const brand = (): HTMLElement => h("div", { class: "mb-8 flex items-center justify-between" },
    h("div", { class: "flex items-center gap-3" },
      h("span", { class: "logo-plate h-9 w-9 rounded-md" }, h("img", { class: "logo-asset", src: "/brand/1helm.png", alt: "1Helm" })),
      h("div", {}, h("div", { class: "text-sm font-semibold tracking-[-0.01em] text-fg" }, "1Helm"), h("div", { class: "eyebrow mt-0.5 text-[9px] text-muted" }, "Native agent workspace"))),
    h("div", { class: "chip px-2 py-1" }, `Step ${step + 1} / ${steps.length}`));

  const progress = (): HTMLElement => h("div", { class: "mb-8" },
    h("div", { class: "mb-2.5 flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-faint" }, ...steps.map((label, index) => h("span", { class: index === step ? "text-accent" : index < step ? "text-muted" : "" }, label))),
    h("div", { class: "wizard-progress" }, h("span", { style: `width:${((step + 1) / steps.length) * 100}%` })));

  const layout = (title: string, subtitle: string, body: HTMLElement, footer?: HTMLElement): HTMLElement =>
    h("div", { class: "wizard-panel overflow-hidden" },
      h("div", { class: "px-6 pt-6 sm:px-8 sm:pt-8" }, brand(), progress()),
      h("div", { class: "px-6 pb-2 sm:px-8" }, h("h2", { class: "font-display text-[2rem] leading-[1.12] text-fg" }, title), h("p", { class: "mt-2.5 max-w-xl text-sm leading-6 text-muted" }, subtitle)),
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
      status.textContent = ""; setBusy(button, true, "Creating Captain…");
      try {
        const result = await api<{ token: string }>("/api/auth/register", { body: { username: username.value, display: display.value, password: password.value } });
        setToken(result.token); step = 1; await render();
      } catch (error) { status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message)); setBusy(button, false); }
    };
    password.addEventListener("keydown", (event) => { if (event.key === "Enter") void submit(); });
    queueMicrotask(() => username.focus());
    return layout("Create the Captain account", "The first account is the Captain: owner and final authority for this workspace. Add people later.",
      h("div", { class: "space-y-4" }, field("Username", username, "Lowercase letters, numbers, dots, dashes, and underscores."), field("Your name", display, "How people and agents will address you."), field("Password", password), status),
      footer(null, () => { void submit(); }, "Continue"));
  };

  const providersStep = (): HTMLElement => {
    const connectionStatus = h("div");
    let continueButton: HTMLButtonElement | null = null;
    const picker = onboardingProviderPicker((state: RoutingState, ready: boolean) => {
      if (continueButton) continueButton.disabled = !ready;
      const connected = (state.providers || []).filter((provider) => provider.enabled !== false);
      connectionStatus.replaceChildren(ready
        ? h("div", { class: "wizard-status-ok" }, `${connected.length} connected account${connected.length === 1 ? "" : "s"}. Every enabled model is available to the workspace.`)
        : h("div", { class: "wizard-status-warn" }, "Connect at least one account or key with an enabled model to continue."));
    });
    const providersFooter = footer(() => { step = 0; void render(); }, () => { step = 2; void render(); }, "Continue", true);
    continueButton = providersFooter.querySelector("button.btn-primary") as HTMLButtonElement;
    return layout("Connect the providers you use", "Add one or several accounts or keys. 1Helm pools what you connect and makes enabled models available to Skipper and every resident. There is no single AI brain.",
      h("div", { class: "space-y-4" },
        h("div", { class: "rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-sm leading-6 text-fg" }, "Do you have any of the following providers? Choose each one you use. You can connect multiple accounts from the same provider, too."),
        picker, connectionStatus),
      providersFooter);
  };

  const workspaceStep = (): HTMLElement => {
    const name = h("input", { class: "field text-lg", value: "My Workspace", autocomplete: "organization" }) as HTMLInputElement;
    const status = h("div");
    const runtimeMount = h("div");

    const completeWorkspace = async (button: HTMLButtonElement): Promise<void> => {
      setBusy(button, true, "Creating workspace…");
      try {
        await api("/api/setup/complete", { body: { name: name.value.trim() || "My Workspace", terminals_enabled: true } });
        await opts.onDone();
      } catch (error) {
        status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message));
        setBusy(button, false);
      }
    };

    const activateRuntime = async (button: HTMLButtonElement): Promise<void> => {
      setBusy(button, true, "Starting private computers…");
      try {
        const result = await api<{ runtime: ChannelRuntime }>("/api/channel-computers/runtime/start", { body: {} });
        if (!result.runtime.ready) throw new Error("Apple's runtime started but did not pass its health check.");
        clear(runtimeMount);
        await completeWorkspace(panel.querySelector("button.btn-primary") as HTMLButtonElement);
      } catch (error) {
        status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message));
        setBusy(button, false);
      }
    };

    const showRuntimeApproval = (runtime: ChannelRuntime): void => {
      clear(runtimeMount);
      const runtimeStatus = h("div");
      if (!runtime.supported) {
        runtimeMount.append(h("div", { class: "wizard-status-err" }, "Private channel computers require Apple Silicon and macOS 26 or newer."));
        return;
      }
      const action = h("button", { class: "btn-primary mt-3 w-full py-2 sm:w-auto" }, runtime.cli ? "Approve and finish workspace" : "Install verified Apple runtime") as HTMLButtonElement;
      action.onclick = async () => {
        if (runtime.cli) { await activateRuntime(action); return; }
        setBusy(action, true, "Verifying Apple installer…");
        try {
          await api("/api/channel-computers/runtime/install", { body: {} });
          runtimeStatus.replaceChildren(h("div", { class: "wizard-status-warn" }, "macOS Installer is open. Approve it once, then return here."));
          action.dataset.label = "I approved it — finish workspace";
          action.textContent = action.dataset.label;
          action.disabled = false;
          action.onclick = () => { void activateRuntime(action); };
        } catch (error) {
          runtimeStatus.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message));
          setBusy(action, false);
        }
      };
      runtimeMount.append(h("div", { class: "card border-accent/30 p-4" },
        h("div", { class: "font-semibold text-fg" }, "One-time Mac approval"),
        h("p", { class: "mt-2 text-sm leading-6 text-muted" }, "1Helm uses Apple's signed container runtime to give every ordinary channel its own persistent private Linux computer. Approve the verified installer once; Skipper handles provisioning, resources, sleep, wake, repair, and updates from then on."),
        action, runtimeStatus));
    };

    const prepare = async (): Promise<void> => {
      const button = panel.querySelector("button.btn-primary") as HTMLButtonElement;
      setBusy(button, true, "Preparing workspace…");
      status.textContent = "";
      try {
        const { runtime } = await api<{ runtime: ChannelRuntime }>("/api/channel-computers/runtime");
        if (runtime.backend === "apple" && !runtime.ready) {
          setBusy(button, false);
          showRuntimeApproval(runtime);
          runtimeMount.scrollIntoView({ behavior: "smooth", block: "nearest" });
          return;
        }
        await completeWorkspace(button);
      } catch (error) {
        status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message));
        setBusy(button, false);
      }
    };

    name.addEventListener("keydown", (event) => { if (event.key === "Enter") void prepare(); });
    queueMicrotask(() => { name.focus(); name.select(); });
    return layout("Name this workspace", "Skipper will prepare the workspace and automatically manage a private Linux computer for every ordinary channel.",
      h("div", { class: "space-y-4" }, field("Workspace name", name, "This appears in the sidebar. You can rename it later."), runtimeMount, status),
      footer(() => { step = 1; void render(); }, () => { void prepare(); }, "Create workspace"));
  };

  const render = async (): Promise<void> => {
    clear(panel);
    if (step === 0) panel.append(accountStep());
    else if (step === 1) panel.append(providersStep());
    else panel.append(workspaceStep());
    shell.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!getToken() && step > 0) step = 0;
  void render();
}
