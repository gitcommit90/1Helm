type Provider = {
  id: string; type: string; name: string; accountAlias?: string | null; email?: string | null; profileName?: string | null;
  models: Array<{ id: string; name?: string; enabled?: boolean }>; modelAutoRefresh?: boolean; modelAutoRefreshFree?: boolean; modelAutoRefreshError?: string;
};
type DiscoveredModel = { id: string; name?: string; free?: boolean };
type H = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, unknown>, ...children: any[]) => HTMLElementTagNameMap[K];
type Dependencies = {
  routingAction: <T extends Record<string, unknown> = Record<string, unknown>>(action: string, payload?: unknown) => Promise<T>;
  add: (parent: ParentNode, ...children: any[]) => void; clear: (node: Node) => void; h: H; icon: (name: string) => Node;
};

export function createProviderModelRefresh({ routingAction, add, clear, h, icon }: Dependencies) {
const accountName = (account: Provider): string => account.email || account.profileName || account.name || account.accountAlias || account.type;
const statusLine = (): HTMLParagraphElement => h("p", { class: "min-h-5 text-xs leading-5 text-muted" });
const empty = (title: string, copy: string): HTMLElement => h("div", { class: "routing-empty" }, h("div", { class: "font-display text-xl text-fg" }, title), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, copy));

async function openModelRefresh(account: Provider, refresh: () => Promise<void>): Promise<void> {
  const modal = h("div", { class: "modal-overlay fixed inset-0 z-[70] grid place-items-end bg-black/60 sm:place-items-center sm:p-6" });
  const body = h("div", { class: "routing-model-refresh-body min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" }, h("p", { class: "py-6 text-center text-sm text-muted" }, "Asking the provider for its current model catalog…"));
  const status = statusLine(), actions = h("div", { class: "flex shrink-0 justify-end gap-2" }), close = (): void => modal.remove();
  modal.onclick = (event: MouseEvent) => { if (event.target === modal) close(); };
  const panel = h("section", { class: "card mobile-sheet flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-b-none p-5 sm:rounded-xl sm:p-6", dataset: { modelRefresh: account.id } },
    h("div", { class: "mb-4 flex items-start justify-between gap-4" },
      h("div", {}, h("div", { class: "eyebrow text-accent" }, "Preview only"), h("h2", { class: "font-display mt-1 text-2xl text-fg" }, `Refresh ${accountName(account)} models`), h("p", { class: "mt-1 text-sm leading-6 text-muted" }, "Choose what this account should offer. Nothing changes until you confirm.")),
      h("button", { class: "btn-ghost", onclick: close }, icon("x"))), body,
    h("footer", { class: "mt-3 flex shrink-0 items-center justify-between gap-3 border-t border-line pt-3", dataset: { modelRefreshFooter: "" } }, status, actions));
  modal.append(panel); document.body.append(modal);
  type PreviewResult = { ok: boolean; previewToken?: string; models?: DiscoveredModel[]; error?: string };
  const result = await routingAction<PreviewResult>("app:preview-provider-models", { providerId: account.id }).catch((error: Error): PreviewResult => ({ ok: false, error: error.message }));
  if (!modal.isConnected) return; clear(body);
  if (!result.ok || !result.previewToken || !result.models?.length) {
    body.append(empty("Automatic discovery is unavailable", result.error || "Add an exact model ID manually from this account's expanded controls."));
    actions.append(h("button", { class: "btn-subtle min-h-10 text-xs", onclick: close }, "Back to manual model ID")); return;
  }
  const models = result.models, previouslyEnabled = new Set((account.models || []).filter((model) => model.enabled !== false).map((model) => model.id));
  const selected = new Set(models.filter((model) => previouslyEnabled.has(model.id)).map((model) => model.id));
  const list = h("div", { class: "routing-telemetry-list routing-model-catalog", dataset: { discoveredModels: "" } }), search = h("input", { type: "search", class: "input w-full", placeholder: "Search models by name or ID…", "aria-label": "Search discovered models", dataset: { modelSearch: "" } }) as HTMLInputElement;
  const override = h("input", { type: "checkbox", checked: false, class: "accent-accent", dataset: { overrideModels: "" } }) as HTMLInputElement;
  let freeOnly = false; const hasFreeMetadata = account.type === "openrouter" && models.some((model) => model.free !== undefined);
  const visibleModels = (): DiscoveredModel[] => models.filter((item) => (!freeOnly || item.free === true) && (!search.value.trim() || `${item.name || ""} ${item.id}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
  const redraw = (): void => {
    clear(list);
    for (const model of visibleModels()) {
      const input = h("input", { type: "checkbox", checked: selected.has(model.id), class: "accent-accent", dataset: { discoveredModel: model.id } }) as HTMLInputElement;
      input.onchange = () => { if (input.checked) selected.add(model.id); else selected.delete(model.id); };
      list.append(h("label", { class: "routing-model-row px-3" }, h("span", { class: "min-w-0 flex-1" }, h("span", { class: "block truncate text-sm font-semibold text-fg" }, model.name || model.id), h("span", { class: "block truncate font-mono text-[10px] text-faint" }, model.id)), model.free === true ? h("span", { class: "chip text-[10px] text-ok" }, "Free") : null, input));
    }
    if (!list.childElementCount) list.append(h("p", { class: "p-5 text-center text-sm text-muted" }, search.value.trim() ? "No models match this search." : "No free models were reported in this catalog."));
  }; search.oninput = redraw;
  const selectVisible = (enabled: boolean): void => { for (const model of visibleModels()) enabled ? selected.add(model.id) : selected.delete(model.id); redraw(); };
  const filters = h("div", { class: "flex flex-wrap items-center gap-2" },
    h("button", { class: "btn-ghost text-xs", dataset: { discoveredAll: "on" }, onclick: () => selectVisible(true) }, "Select all"),
    h("button", { class: "btn-ghost text-xs", dataset: { discoveredAll: "off" }, onclick: () => selectVisible(false) }, "Select none"),
    hasFreeMetadata ? h("button", { class: "btn-subtle ml-auto text-xs", dataset: { freeOnly: "" }, onclick: (event: Event) => { freeOnly = !freeOnly; (event.currentTarget as HTMLElement).classList.toggle("border-accent", freeOnly); (event.currentTarget as HTMLElement).textContent = freeOnly ? "Showing free only" : "Free only"; redraw(); } }, "Free only") : account.type === "openrouter" ? h("span", { class: "ml-auto text-xs text-muted" }, "Free pricing metadata unavailable") : null);
  const confirm = h("button", { class: "btn-primary min-h-10 text-xs", dataset: { confirmModels: "" }, onclick: async () => {
    confirm.disabled = true; status.textContent = "Applying the confirmed model selection…";
    const applied = await routingAction<{ ok: boolean; error?: string }>("app:apply-provider-models", { providerId: account.id, previewToken: result.previewToken, modelIds: [...selected], override: override.checked }).catch((error: Error) => ({ ok: false, error: error.message }));
    if (!applied.ok) { confirm.disabled = false; status.textContent = applied.error || "The model selection could not be applied."; return; }
    close(); await refresh();
  } }, "Confirm model selection") as HTMLButtonElement;
  redraw(); add(body, search, filters, list,
    h("label", { class: "flex items-start gap-2 rounded-lg border border-line p-3 text-xs text-muted" }, override, h("span", {}, h("strong", { class: "block text-fg" }, "Override?"), "Replace this account with exactly the checked models. Every other model becomes inactive.")),
    h("p", { class: "text-xs leading-5 text-muted" }, `${models.length} models discovered. With Override on, only checked models remain active.`));
  add(actions, h("button", { class: "btn-ghost text-xs", onclick: close }, "Cancel"), confirm);
}

function modelAutoRefreshControls(account: Provider, refresh: () => Promise<void>): HTMLElement {
  const all = h("input", { type: "checkbox", checked: account.modelAutoRefresh === true, class: "accent-accent", dataset: { modelAutoRefresh: "all" } }) as HTMLInputElement;
  const free = h("input", { type: "checkbox", checked: account.modelAutoRefreshFree === true, class: "accent-accent", dataset: { modelAutoRefresh: "free" } }) as HTMLInputElement;
  const syncDisabled = (): void => { all.disabled = free.checked; free.disabled = all.checked; };
  const setMode = async (mode: "all" | "free", input: HTMLInputElement): Promise<void> => {
    all.disabled = true; free.disabled = true;
    const result = await routingAction<{ ok: boolean }>("app:set-provider-model-auto-refresh", { providerId: account.id, mode: input.checked ? mode : "off" }).catch(() => ({ ok: false }));
    if (!result.ok) input.checked = !input.checked;
    await refresh();
  };
  all.onchange = () => { void setMode("all", all); }; free.onchange = () => { void setMode("free", free); }; syncDisabled();
  const copy = account.modelAutoRefreshError ? h("p", { class: "text-[10px] text-danger", dataset: { modelAutoRefreshError: "" } }, account.modelAutoRefreshError) : null;
  return h("div", { class: "mt-3 space-y-2 rounded-lg border border-line p-3", dataset: { modelAutoRefreshControls: "" } },
    h("label", { class: "flex items-center gap-2 text-xs text-muted" }, all, "Auto-refresh model list every 24 hours"),
    account.type === "openrouter" ? h("label", { class: "flex items-center gap-2 text-xs text-muted" }, free, "Auto-refresh free models every 24 hours") : null, copy);
}

return { openModelRefresh, modelAutoRefreshControls };
}
