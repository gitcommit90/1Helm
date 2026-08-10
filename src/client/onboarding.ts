import { api, getToken, setToken, type ChannelComputerPrepare, type ChannelRuntime, type RoutingState } from "./api.ts";
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
  const shell = h("div", { class: "wizard-shell h-full overflow-hidden" });
  const stage = h("div", { class: "mx-auto flex h-full min-h-0 w-full max-w-[1120px] items-center px-3 py-3 sm:px-5 sm:py-5" });
  const panel = h("section", { class: "flex h-full min-h-0 w-full items-center" });
  stage.append(panel); shell.append(stage); clear(root); root.append(shell);

  const brand = (): HTMLElement => h("div", { class: "mb-4 flex items-center justify-between" },
    h("div", { class: "flex items-center gap-3" },
      h("span", { class: "logo-plate h-9 w-9 rounded-md" }, h("img", { class: "logo-asset", src: "/brand/1helm-sailboat.png", alt: "1Helm" })),
      h("div", {}, h("div", { class: "text-sm font-semibold tracking-[-0.01em] text-fg" }, "1Helm"), h("div", { class: "eyebrow mt-0.5 text-[9px] text-muted" }, "Native agent workspace"))),
    h("div", { class: "chip px-2 py-1" }, `Step ${step + 1} / ${steps.length}`));

  const progress = (): HTMLElement => h("div", { class: "mb-4" },
    h("div", { class: "mb-2.5 flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-faint" }, ...steps.map((label, index) => h("span", { class: index === step ? "text-accent" : index < step ? "text-muted" : "" }, label))),
    h("div", { class: "wizard-progress" }, h("span", { style: `width:${((step + 1) / steps.length) * 100}%` })));

  const layout = (title: string, subtitle: string, body: HTMLElement, footer?: HTMLElement): HTMLElement =>
    h("div", { class: "wizard-panel flex max-h-full w-full flex-col overflow-hidden" },
      h("div", { class: "px-5 pt-4 sm:px-7 sm:pt-5" }, brand(), progress()),
      h("div", { class: "px-5 pb-1 sm:px-7" }, h("h2", { class: "font-display text-[clamp(1.55rem,3.2vh,2rem)] leading-[1.12] text-fg" }, title), h("p", { class: "mt-1.5 max-w-3xl text-sm leading-5 text-muted" }, subtitle)),
      h("div", { class: "min-h-0 flex-1 space-y-3 overflow-hidden px-5 py-3 sm:px-7" }, body), footer || null);

  const footer = (back: (() => void) | null, next: (() => void), label: string, disabled = false): HTMLElement => {
    const nextButton = h("button", { class: "btn-primary min-w-28 px-4 py-2", disabled, onclick: next }, label) as HTMLButtonElement;
    return h("div", { class: "flex shrink-0 items-center justify-between border-t border-line px-5 py-3 sm:px-7" },
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
        await setToken(result.token); step = 1; await render();
      } catch (error) { status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message)); setBusy(button, false); }
    };
    password.addEventListener("keydown", (event) => { if (event.key === "Enter") void submit(); });
    queueMicrotask(() => username.focus());
    const joinTeam = h("button", { class: "btn-subtle", onclick: () => { void joinExistingTeam(); } }, "Join team?");
    return layout("Create the Captain account", "The first account is the Captain: owner and final authority for this workspace. Add people later.",
      h("div", { class: "grid gap-3 sm:grid-cols-3" }, field("Username", username, "Lowercase letters, numbers, dots, dashes, and underscores."), field("Your name", display, "How people and agents will address you."), field("Password", password), h("div", { class: "sm:col-span-3" }, status)),
      h("div", { class: "flex shrink-0 items-center justify-between border-t border-line px-5 py-3 sm:px-7" }, joinTeam, h("button", { class: "btn-primary min-w-28 px-4 py-2", onclick: () => { void submit(); } }, "Continue")));
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
      h("div", { class: "space-y-3" },
        h("div", { class: "rounded-lg border border-accent/25 bg-accent-soft px-3 py-2 text-sm leading-5 text-fg" }, "Choose every provider you use. You can connect multiple accounts from the same provider."),
        picker, connectionStatus),
      providersFooter);
  };

  const workspaceStep = (): HTMLElement => {
    const name = h("input", { class: "field text-lg", value: "My Workspace", autocomplete: "organization" }) as HTMLInputElement;
    const collaborate = h("input", { type: "checkbox", class: "accent-accent" }) as HTMLInputElement;
    const slug = h("input", { class: "field", placeholder: "your-team", autocomplete: "off", disabled: true }) as HTMLInputElement;
    const slugStatus = h("p", { class: "min-h-5 text-xs text-muted" }, "Your Mac remains the only server. When it is offline, this address is offline.");
    let availabilityTimer: ReturnType<typeof setTimeout> | null = null;
    collaborate.onchange = () => { slug.disabled = !collaborate.checked; if (collaborate.checked) slug.focus(); };
    slug.oninput = () => {
      slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48);
      if (availabilityTimer) clearTimeout(availabilityTimer);
      if (!slug.value) { slugStatus.textContent = "Choose the unique address your team will use."; return; }
      slugStatus.textContent = "Checking address…";
      availabilityTimer = setTimeout(() => { void api<{ available: boolean; hostname: string; reason: string }>(`/api/collaboration/slug?slug=${encodeURIComponent(slug.value)}`).then((result) => {
        slugStatus.textContent = result.available ? `${result.hostname} is available.` : result.reason === "taken" ? `${result.hostname} is already taken.` : "Use 3–48 lowercase letters, numbers, or hyphens.";
        slugStatus.className = `min-h-5 text-xs ${result.available ? "text-ok" : "text-danger"}`;
      }).catch((error) => { slugStatus.textContent = (error as Error).message; slugStatus.className = "min-h-5 text-xs text-danger"; }); }, 350);
    };
    const status = h("div");
    const runtimeMount = h("div");

    const completeWorkspace = async (button: HTMLButtonElement): Promise<void> => {
      setBusy(button, true, "Creating workspace…");
      try {
        if (collaborate.checked) {
          if (!slug.value) throw new Error("Choose a workspace address before enabling collaboration.");
          setBusy(button, true, "Provisioning team address…");
          await api("/api/collaboration/claim", { body: { slug: slug.value, workspace_name: name.value.trim() || "My Workspace" } });
        }
        await api("/api/setup/complete", { body: { name: name.value.trim() || "My Workspace", terminals_enabled: true } });
        sessionStorage.setItem("1helm.justOnboarded", "1");
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
        if (!result.runtime.ready) throw new Error("The private channel-computer runtime did not pass its health check.");
        clear(runtimeMount);
        await completeWorkspace(panel.querySelector("button.btn-primary") as HTMLButtonElement);
      } catch (error) {
        status.replaceChildren(h("div", { class: "wizard-status-err" }, (error as Error).message));
        setBusy(button, false);
      }
    };

    const paintPrepareProgress = (prepare: ChannelComputerPrepare): void => {
      const width = Math.max(4, Math.min(100, Number(prepare.progress) || 0));
      status.replaceChildren(h("div", { class: "card border-accent/30 p-4" },
        h("div", { class: "font-semibold text-fg" }, "Preparing private computers"),
        h("p", { class: "mt-2 text-sm leading-6 text-muted" }, "One-time setup for this host. 1Helm loads the sealed Linux computer image now so every later channel starts quickly."),
        h("div", { class: "wizard-progress mt-4" }, h("span", { style: `width:${width}%` })),
        h("p", { class: "mt-3 text-sm leading-6 text-fg" }, prepare.step || "Working…"),
        prepare.error ? h("p", { class: "mt-2 text-sm text-danger" }, prepare.error) : null,
        h("p", { class: "mt-2 text-xs text-muted" }, "This is local image import, not a live package download. Channel creation will not pay this cost again.")));
    };

    const prepareOciComputers = async (button: HTMLButtonElement): Promise<void> => {
      setBusy(button, true, "Preparing private computers…");
      status.textContent = "";
      try {
        const started = await api<{ prepare: ChannelComputerPrepare; runtime: ChannelRuntime }>("/api/channel-computers/runtime/prepare", { body: {} });
        paintPrepareProgress(started.prepare);
        const deadline = Date.now() + 35 * 60_000;
        while (Date.now() < deadline) {
          const snapshot = await api<{ prepare: ChannelComputerPrepare; runtime: ChannelRuntime }>("/api/channel-computers/runtime/prepare");
          paintPrepareProgress(snapshot.prepare);
          if (snapshot.prepare.status === "complete" || snapshot.runtime.ready) {
            clear(runtimeMount);
            await completeWorkspace(button);
            return;
          }
          if (snapshot.prepare.status === "failed") {
            throw new Error(snapshot.prepare.error || snapshot.runtime.error || "Private computer setup failed.");
          }
          await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
        }
        throw new Error("Private computer setup timed out. Check host DNS and package mirrors, then retry.");
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
        // Poll while the server is still probing; never treat status "checking"
        // as a hard installer failure.
        let runtime: ChannelRuntime | null = null;
        const deadline = Date.now() + 45_000;
        while (Date.now() < deadline) {
          const snapshot = await api<{ runtime: ChannelRuntime }>("/api/channel-computers/runtime");
          runtime = snapshot.runtime;
          if (runtime.status !== "checking") break;
          status.replaceChildren(h("div", { class: "wizard-status-info text-sm text-muted" }, "Checking private-computer runtime…"));
          setBusy(button, true, "Checking runtime…");
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        if (!runtime) throw new Error("Could not load channel-computer runtime status.");
        if (runtime.backend === "oci") {
          if (!runtime.supported) {
            setBusy(button, false);
            status.replaceChildren(h("div", { class: "wizard-status-err" }, "Private channel computers require a supported Linux or Windows x64 host."));
            return;
          }
          if (runtime.status === "checking" || (!runtime.engine_ready && !runtime.error)) {
            // Still probing or empty pending snapshot — do not blame the installer.
            setBusy(button, false);
            status.replaceChildren(h("div", { class: "wizard-status-err" }, "Still checking the private-computer runtime. Wait a moment and retry."));
            return;
          }
          if (!runtime.engine_ready) {
            setBusy(button, false);
            const instruction = "The OCI runtime is not ready. Rerun the verified 1Helm Linux host installer, then retry.";
            status.replaceChildren(h("div", { class: "wizard-status-err" }, runtime.error ? `${instruction} ${runtime.error}` : instruction));
            return;
          }
          if (!runtime.image_ready || !runtime.ready) {
            await prepareOciComputers(button);
            return;
          }
          await completeWorkspace(button);
          return;
        }
        if (!runtime.ready) {
          setBusy(button, false);
          if (runtime.backend === "apple") {
            showRuntimeApproval(runtime);
            runtimeMount.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } else {
            status.replaceChildren(h("div", { class: "wizard-status-err" }, "The development channel-computer backend is not ready."));
          }
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
      h("div", { class: "grid items-start gap-3 sm:grid-cols-[minmax(240px,.7fr)_1.3fr]" },
        h("div", { class: "space-y-3" }, field("Workspace name", name, "This appears in the sidebar. You can rename it later."),
        h("label", { class: "flex items-start gap-2 rounded-lg border border-line p-3" }, collaborate, h("span", {}, h("span", { class: "block text-sm font-semibold text-fg" }, "Collaborate"), h("span", { class: "mt-1 block text-xs leading-5 text-muted" }, "Give this 1Helm host a private 1helm.com address so teammates can reach its headless web app from anywhere."))),
          field("Team address", slug, "Your permanent reserved address, even when Collaborate is switched off."), slugStatus),
        h("div", {}, runtimeMount, status)),
      footer(() => { step = 1; void render(); }, () => { void prepare(); }, "Create workspace"));
  };

  const render = async (): Promise<void> => {
    clear(panel);
    if (step === 0) panel.append(accountStep());
    else if (step === 1) panel.append(providersStep());
    else panel.append(workspaceStep());
  };

  if (!getToken() && step > 0) step = 0;
  void render();
}

async function joinExistingTeam(): Promise<void> {
  const raw = window.prompt("Enter the team address, for example acme.1helm.com");
  if (raw == null) return;
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?\.1helm\.com$/.test(host)) {
    window.alert("Enter a workspace address ending in .1helm.com.");
    return;
  }
  location.assign(`https://${host}`);
}
