type SearchUiDeps = {
  api: <T>(path: string) => Promise<T>;
  clear: (element: Element) => void;
  h: any;
  icon: (name: string, size?: number) => SVGElement;
  md: (source: string) => string;
};
let ui: SearchUiDeps;
export function configureChannelSearchUi(value: SearchUiDeps): void { ui = value; }
const api = <T>(path: string): Promise<T> => ui.api<T>(path);
const clear = (element: Element): void => ui.clear(element);
const h = (tag: string, attrs?: Record<string, unknown>, ...children: any[]): HTMLElement => ui.h(tag, attrs, ...children);
const icon = (name: string, size?: number): SVGElement => ui.icon(name, size);
const md = (source: string): string => ui.md(source);

export type ChannelSearchResult = {
  message_id: number;
  thread_root_id: number;
  thread_title: string;
  author: string;
  created_at: string;
  text: string;
  match_type: "exact" | "keyword" | "semantic";
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Highlight the literal phrase when present; for a semantic-only hit, bold
 * query words that are actually visible in the rendered result. Never inject
 * markup into Markdown source—render safely first, then wrap text nodes. */
function highlightRenderedMatch(container: HTMLElement, query: string): void {
  const visible = (container.textContent || "").toLocaleLowerCase();
  const phrase = query.trim();
  const terms = visible.includes(phrase.toLocaleLowerCase())
    ? [phrase]
    : [...new Set(phrase.match(/[\p{L}\p{N}_-]+/gu) || [])]
      .filter((term) => term.length > 1 && visible.includes(term.toLocaleLowerCase()))
      .sort((left, right) => right.length - left.length);
  if (!terms.length) return;
  const matcher = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "giu");
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.data;
    matcher.lastIndex = 0;
    if (!matcher.test(text)) continue;
    matcher.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(matcher)) {
      const at = match.index || 0;
      if (at > cursor) fragment.append(text.slice(cursor, at));
      fragment.append(h("mark", { class: "rounded-sm bg-accent-soft px-0.5 font-bold text-fg" }, match[0]));
      cursor = at + match[0].length;
    }
    if (cursor < text.length) fragment.append(text.slice(cursor));
    node.replaceWith(fragment);
  }
}
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
          h("span", { class: `shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${item.match_type === "exact" ? "bg-accent-soft text-accent" : "bg-panel text-faint"}` }, item.match_type === "exact" ? "Exact" : item.match_type === "keyword" ? "Keyword" : "Semantic"),
          h("span", { class: "shrink-0 text-[10px] text-faint" }, resultDate(item.created_at))),
        (() => {
          const snippet = h("div", { class: "md channel-search-snippet mt-1 max-h-24 overflow-hidden text-xs leading-5 text-muted", html: md(item.text) });
          highlightRenderedMatch(snippet, query);
          return snippet;
        })(),
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
