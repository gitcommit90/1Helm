// Deleting a chat, a channel, or the account (the Captain, 10-06: "delete = delete. It really really really means delete.").
// The server does the deleting (proto src/deletion.js); this module asks, calls it, and tells the app what's gone.
//   Chat:    the ⋯ menu on a task row (side panel, phone drawer), the task header, the phone's About sheet → ask() → POST
//            /res/<ch>/sessions/<id>/delete.
//   Channel: the ⋯ menu on the channel header (desktop) or the phone's About sheet → ask() with the channel's name typed →
//            POST /channels/<ch>/delete {confirm}. General has no Delete.
//   Account: Settings → General → Delete account → ask() with "delete my account" typed → POST /account/delete {confirm} → signed
//            out (the server clears the cookie) → the 1Helm home page.
// The server checks the typed confirmation too; this UI is never the only guard.
import { ask, tell } from "./dialog";

export type DelDeps = {
  api: (path: string, body?: any) => Promise<any>;
  note: (title: string, sub: string) => void;
  /** a chat by channel slug + session id (server sessions only), for its title */
  chat: (slug: string, sid: string) => { title: string; jobs: number } | null;
  /** a channel's display name */
  channelName: (slug: string) => string | null;
  chatGone: (slug: string, sid: string) => void;
  channelGone: (slug: string) => void;
  closeSheet?: () => void;
  /** Stop (stop.ts): a working chat's ⋯ menu offers "Stop" first */
  working?: (slug: string, sid: string) => boolean;
  stop?: (slug: string, sid: string) => void;
};
let D: DelDeps | null = null;

export const CHAT_TITLE = "Delete this chat?";
export const CHAT_BODY = "It's permanently deleted, including its messages, files made in it, and what it added to memory. This can't be undone.";
export const ACCOUNT_WORDS = "delete my account";
const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const svg = (d: string, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const MORE = svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>');
export const TRASH = svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 15);
const STOPSQ = `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>`;

// ---- markup the app drops in ----
/** The ⋯ button on a task row (inside its <a>; clicks never open the task). */
export const rowMore = (slug: string, sid: any, title: string) => `<span class="rmore" role="button" tabindex="0" data-rowmenu="${esc(slug)}|${esc(sid)}" aria-haspopup="menu" aria-label="More for ${esc(title)}" title="More">${MORE}</span>`;
/** Delete in the task header (desktop). */
export const headDelete = (slug: string, sid: any) => `<button class="hdel" data-delchat="${esc(slug)}|${esc(sid)}" title="Delete this chat" aria-label="Delete this chat">${TRASH}</button>`;
/** The ⋯ on the channel header (desktop side panel). General has none. */
export const channelMore = (slug: string, name: string) => slug === "main" ? "" : `<button class="chmore" data-chmenu="${esc(slug)}" aria-haspopup="menu" aria-label="More for ${esc(name)}" title="Channel options">${MORE}</button>`;
/** Rows for the phone's About sheet: delete the open chat, delete the channel. */
export const sheetRows = (slug: string, sid: any | null) => (sid != null ? `<button class="srow delrow" data-delchat="${esc(slug)}|${esc(sid)}">${TRASH}<span>Delete this chat</span></button>` : "")
  + (slug === "main" ? "" : `<button class="srow delrow" data-delch="${esc(slug)}">${TRASH}<span>Delete channel</span></button>`);

// ---- the three deletions ----
export async function deleteChat(slug: string, sid: string) {
  if (!D) return; const c = D.chat(slug, sid); if (!c) return;
  const ok = await ask({ title: CHAT_TITLE, body: CHAT_BODY + (c.jobs ? ` Its scheduled ${c.jobs === 1 ? "job is" : `jobs (${c.jobs}) are`} deleted too.` : ""), confirm: "Delete", danger: true });
  if (!ok) return;
  D.closeSheet?.();
  try {
    const r = await D.api(`/res/${slug}/sessions/${sid}/delete`, {});
    if (r?.error) throw new Error(r.error);
    D.chatGone(slug, sid);
    D.note("Chat deleted", r.kept?.length ? `Kept ${r.kept.length === 1 ? `“${r.kept[0]}”` : `${r.kept.length} files`}: also used in another chat.` : c.title);
  } catch { await tell({ title: "Couldn't delete the chat", body: "Nothing was lost. Try again in a minute." }); }
}
export async function deleteChannel(slug: string) {
  if (!D || slug === "main") return; const name = D.channelName(slug); if (!name) return;
  const ok = await ask({ title: `Delete ${name}?`, body: "The channel and everything in it is permanently deleted: its chats, files, Notebook, scheduled jobs, its computer, and what it remembers. This can't be undone.",
    type: { match: name, label: `Type “${name}” to confirm` }, confirm: "Delete channel", danger: true });
  if (!ok) return;
  D.closeSheet?.();
  try {
    const r = await D.api(`/channels/${slug}/delete`, { confirm: name });
    if (r?.error) throw new Error(r.error);
    D.channelGone(slug); D.note("Channel deleted", `${name} and everything in it are gone.`);
  } catch { await tell({ title: "Couldn't finish deleting the channel", body: "It's already hidden, and deleting keeps going on its own in the next few minutes." }); }
}
export async function deleteAccount() {
  if (!D) return;
  const ok = await ask({ title: "Delete your account?", body: "Everything is permanently deleted: every channel and chat, your files, Notebook and memory, contacts, saved logins and keys, connected apps and texting. Your plan is canceled now. This can't be undone.",
    type: { match: ACCOUNT_WORDS, label: `Type “${ACCOUNT_WORDS}” to confirm` }, confirm: "Delete account", danger: true });
  if (!ok) return;
  document.body.classList.add("deleting-acct");
  let r: any = null; try { r = await D.api("/account/delete", { confirm: ACCOUNT_WORDS }); } catch {}
  if (r?.ok) { location.replace(r.redirect || "/"); return; }
  document.body.classList.remove("deleting-acct");
  await tell({ title: "Deleting didn't finish", body: "You're signed out, and deleting keeps going on its own in the next few minutes." });
  location.replace("/");
}

// ---- a tiny menu (row ⋯ / channel ⋯) ----
function closeMenu() { document.getElementById("delmenu")?.remove(); }
function openMenu(at: HTMLElement, items: [string, string, () => void][]) {
  closeMenu();
  const m = document.createElement("div"); m.id = "delmenu"; m.className = "delmenu"; m.setAttribute("role", "menu");
  m.innerHTML = items.map(([label, icon], i) => `<button type="button" role="menuitem" class="delmi bad" data-mi="${i}">${icon}<span>${esc(label)}</span></button>`).join("");
  document.body.appendChild(m);
  const r = at.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  m.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  m.addEventListener("click", (e) => { e.stopPropagation(); const b = (e.target as HTMLElement).closest<HTMLElement>("[data-mi]"); if (!b) return; closeMenu(); items[+b.dataset.mi!][2](); });
  m.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
}

export function delInit(deps: DelDeps) {
  D = deps;
  const act = (t: HTMLElement, e: Event) => {
    const rm = t.closest<HTMLElement>("[data-rowmenu]");
    if (rm) { e.preventDefault(); e.stopImmediatePropagation(); const [slug, sid] = rm.dataset.rowmenu!.split("|"); openMenu(rm, [...(D?.working?.(slug, sid) && D?.stop ? [["Stop", STOPSQ, () => D!.stop!(slug, sid)] as [string, string, () => void]] : []), ["Delete chat", TRASH, () => void deleteChat(slug, sid)]]); return true; }
    const cm = t.closest<HTMLElement>("[data-chmenu]");
    if (cm) { e.preventDefault(); e.stopImmediatePropagation(); const slug = cm.dataset.chmenu!; openMenu(cm, [["Delete channel", TRASH, () => void deleteChannel(slug)]]); return true; }
    const dc = t.closest<HTMLElement>("[data-delchat]");
    if (dc) { e.preventDefault(); e.stopImmediatePropagation(); const [slug, sid] = dc.dataset.delchat!.split("|"); void deleteChat(slug, sid); return true; }
    const dh = t.closest<HTMLElement>("[data-delch]");
    if (dh) { e.preventDefault(); e.stopImmediatePropagation(); void deleteChannel(dh.dataset.delch!); return true; }
    if (t.closest("[data-delacct]")) { e.preventDefault(); e.stopImmediatePropagation(); void deleteAccount(); return true; }
    return false;
  };
  window.addEventListener("click", (e) => { const t = e.target as HTMLElement; if (!t.closest?.("#delmenu")) closeMenu(); act(t, e); }, true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("delmenu")) { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(); return; }
    if (e.key !== "Enter" && e.key !== " ") return; const t = e.target as HTMLElement;
    if (t.closest?.("[data-rowmenu]")) act(t, e);
  }, true);
  window.addEventListener("resize", closeMenu); window.addEventListener("hashchange", closeMenu);
}
