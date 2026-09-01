import { api } from "./api.ts";
import { clear, h, icon } from "./dom.ts";

export type ChannelSearchResult = {
  message_id: number;
  thread_root_id: number;
  thread_title: string;
  author: string;
  created_at: string;
  text: string;
};

const plainSnippet = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 240);
const resultDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

/** Small, enter-to-search channel transcript surface. Search stays scoped to
 * messages; selecting a hit opens its thread without trying to scroll to the
 * exact matching message. */
export function openChannelSearch(anchor: HTMLElement, channelId: number, onOpenThread: (rootId: number) => void): void {
  document.querySelector<HTMLElement>("[data-channel-search-popover]")?.remove();
  const panel = h("section", { class: "fixed z-[80] flex max-h-[min(32rem,70vh)] w-[min(34rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl", dataset: { channelSearchPopover: "" } });
  const input = h("input", { class: "field h-10 min-w-0 flex-1 bg-panel text-sm", type: "search", placeholder: "Search this channel", "aria-label": "Search this channel", autocomplete: "off", maxlength: 500 }) as HTMLInputElement;
  const results = h("div", { class: "min-h-20 overflow-y-auto p-2" }, h("p", { class: "px-2 py-5 text-center text-xs text-muted" }, "Type what you remember, then press Enter."));
  const status = h("span", { class: "shrink-0 text-[11px] text-faint", "aria-live": "polite" }, "On Enter");
  const close = (): void => { panel.remove(); document.removeEventListener("pointerdown", outside); };
  const outside = (event: PointerEvent): void => { if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) close(); };
  const search = async (): Promise<void> => {
    const query = input.value.trim();
    if (!query) { input.focus(); return; }
    input.disabled = true; status.textContent = "Searching…";
    results.replaceChildren(h("p", { class: "px-2 py-5 text-center text-xs text-muted" }, "Searching this channel…"));
    try {
      const found = await api<{ results: ChannelSearchResult[] }>(`/api/channels/${channelId}/search?q=${encodeURIComponent(query)}`);
      clear(results);
      status.textContent = `${found.results.length} result${found.results.length === 1 ? "" : "s"}`;
      if (!found.results.length) results.append(h("p", { class: "px-2 py-8 text-center text-sm text-muted" }, "No matching conversations."));
      for (const item of found.results) {
        results.append(h("button", {
          type: "button",
          class: "block w-full rounded-lg px-3 py-2.5 text-left hover:bg-hover focus:bg-hover focus:outline-none",
          onclick: () => { close(); onOpenThread(Number(item.thread_root_id)); },
        },
        h("div", { class: "flex items-center gap-2" },
          h("span", { class: "min-w-0 flex-1 truncate text-xs font-semibold text-fg" }, item.thread_title || `Conversation ${item.thread_root_id}`),
          h("span", { class: "shrink-0 text-[10px] text-faint" }, resultDate(item.created_at))),
        h("p", { class: "mt-1 line-clamp-2 text-xs leading-5 text-muted" }, plainSnippet(item.text)),
        h("p", { class: "mt-1 truncate text-[10px] text-faint" }, item.author)));
      }
    } catch (error) {
      status.textContent = "Search failed";
      results.replaceChildren(h("p", { class: "px-2 py-6 text-center text-sm text-danger" }, (error as Error).message));
    } finally { input.disabled = false; input.focus(); }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void search(); }
    else if (event.key === "Escape") { event.preventDefault(); close(); }
  });
  panel.append(h("header", { class: "flex items-center gap-2 border-b border-line p-2" }, h("span", { class: "pl-1 text-muted" }, icon("search", 17)), input, status, h("button", { class: "grid h-8 w-8 place-items-center rounded text-muted hover:bg-hover hover:text-fg", "aria-label": "Close search", onclick: close }, icon("x", 15))), results);
  document.body.append(panel);
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(544, window.innerWidth - 8);
  const left = Math.max(4, Math.min(window.innerWidth - width - 4, rect.right - width));
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.min(window.innerHeight - panel.offsetHeight - 4, rect.bottom + 6)}px`;
  setTimeout(() => document.addEventListener("pointerdown", outside), 0);
  input.focus();
}
