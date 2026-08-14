type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") element.className = value;
    else if (key === "html") element.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in element) (element as any)[key] = value;
    else element.setAttribute(key, String(value));
  }
  for (const child of children.flat()) if (child != null && child !== false) element.append(child as Node | string);
  return element;
}

export function appModal(title: string, body: string | HTMLElement, buttons: { label: string; primary?: boolean; danger?: boolean; onClick: () => void }[]): HTMLElement {
  const overlay = h("div", { class: "modal-overlay fixed inset-0 z-50 grid place-items-end bg-black/55 p-0 sm:place-items-center sm:p-6", role: "dialog", "aria-modal": "true", "aria-label": title, onclick: (e: MouseEvent) => { if (e.target === overlay) overlay.remove(); } },
    h("section", { class: "card mobile-sheet w-full max-w-md overflow-hidden rounded-b-none shadow-2xl sm:rounded-xl" },
      h("div", { class: "flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6" },
        h("h2", { class: "font-display text-[1.4rem] leading-tight text-fg" }, title),
        h("button", { class: "grid h-11 w-11 place-items-center rounded text-muted hover:bg-hover sm:h-8 sm:w-8", "aria-label": "Close", onclick: () => overlay.remove() }, "×")),
      h("div", { class: "p-4 sm:p-6" }, typeof body === "string" ? h("p", { class: "text-sm leading-6 text-muted" }, body) : body),
      h("div", { class: "flex items-center justify-end gap-2 border-t border-line px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6" },
        ...buttons.map((btn) => h("button", {
          class: btn.primary ? "btn-primary min-h-11 px-4 text-sm sm:min-h-0" : btn.danger ? "btn-danger min-h-11 px-4 text-sm sm:min-h-0" : "btn-ghost min-h-11 px-4 text-sm sm:min-h-0",
          onclick: () => { btn.onClick(); overlay.remove(); },
        }, btn.label)))));
  document.body.append(overlay);
  return overlay;
}

export function appAlert(message: string): Promise<void> {
  return new Promise((resolve) => { appModal("Notice", message, [{ label: "OK", primary: true, onClick: resolve }]); });
}

export function appConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    appModal("Confirm", message, [
      { label: "Cancel", onClick: () => resolve(false) },
      { label: "Confirm", primary: true, onClick: () => resolve(true) },
    ]);
  });
}

export function appPrompt(message: string | Node, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", { class: "field", value: defaultValue, autocomplete: "off" }) as HTMLInputElement;
    const body = typeof message === "string"
      ? h("p", { class: "text-sm leading-6 text-muted", html: message.replace(/\*\*([^*]+)\*\*/g, "<strong class=\"font-semibold text-fg\">$1</strong>").replace(/\n/g, "<br>") })
      : message;
    appModal("Input", h("div", { class: "space-y-3" }, body, input), [
      { label: "Cancel", onClick: () => resolve(null) },
      { label: "OK", primary: true, onClick: () => resolve(input.value) },
    ]);
    input.focus(); input.select();
  });
}
