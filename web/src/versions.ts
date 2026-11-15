// Versions of a Library file (the file viewer's and the Library row's "Versions" button). Lists the kept versions (the current one, the one
// before it, and the person's original upload when it is a different one) with a preview, the date and the size, and puts one back with a
// short confirm. The server does the swap (POST /files/<id>/restore, the same one share_file's restore uses); the version it replaces is kept,
// so a restore can be undone by restoring again. The caller refreshes every card, the Library and an open viewer from the file it gets back.
import { ask, dialogOpen } from "./dialog";

export type KeptVersion = { which: "current" | "previous" | "original"; version?: number; bytes: number | null; at: number | null; mime?: string; you?: boolean };
export type VersionsFile = { id: string; name: string; mime: string; version?: number; bytes: number; at: number; [k: string]: any };
export type VersionsOpts = {
  api: string; slug: string; id: string; name: string;
  /** The current file's URL (with its version marker). */
  currentUrl: () => string;
  /** The file-kind icon (html) shown when the file isn't a picture. */
  icon: string;
  image: boolean;
  size: (bytes: number) => string;
  /** Called with the file row the server returns after a restore. */
  changed: (f: VersionsFile) => void;
};

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const LABEL = { current: "Current version", previous: "Previous version", original: "Your original upload" } as const;
const when = (t: number | null) => t ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
let cur: { el: HTMLElement; prev: HTMLElement | null } | null = null;

export const versionsIsOpen = () => !!cur;
export function versionsClose() {
  if (!cur) return; const { el, prev } = cur; cur = null;
  el.classList.remove("on"); el.classList.add("off"); el.setAttribute("aria-hidden", "true"); setTimeout(() => el.remove(), 320);
  if (prev?.isConnected) prev.focus({ preventScroll: true });
}

export async function versionsOpen(o: VersionsOpts) {
  if (cur) versionsClose();
  const base = `${o.api}/res/${encodeURIComponent(o.slug)}/files/${encodeURIComponent(o.id)}`;
  const el = document.createElement("div"); el.className = "dlgw vsw";
  el.innerHTML = `<div class="dlgback" data-vsx></div><div class="dlg vs" role="dialog" aria-modal="true" aria-labelledby="vst" tabindex="-1"><span class="dlggrab" aria-hidden="true"></span><h2 id="vst">Versions of “${esc(o.name)}”</h2><div class="vsbody" aria-live="polite"></div><div class="dlgbtns"><button type="button" class="dlgb no" data-vsx>Close</button></div></div>`;
  const prev = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  document.body.appendChild(el); cur = { el, prev };
  const body = el.querySelector<HTMLElement>(".vsbody")!;
  let busy = false, data: { version: number; versions: KeptVersion[] } | null = null;
  const thumb = (v: KeptVersion) => o.image
    ? `<span class="vsth"><img src="${v.which === "current" ? o.currentUrl() : `${base}?kept=${v.which}&c=${data!.version}`}" alt="" loading="lazy"></span>`
    : `<span class="vsth ic">${o.icon}</span>`;
  const paint = (err = "") => {
    if (!data) return;
    body.innerHTML = `<ul class="vslist">${data.versions.map(v => `<li class="vsrow"><span class="vsl">${thumb(v)}<span class="vsm"><b>${LABEL[v.which]}</b><small>${[when(v.at), v.bytes != null ? o.size(v.bytes) : ""].filter(Boolean).join(" · ")}</small></span></span>${v.which === "current" ? "" : `<button type="button" class="dlgb no vsr" data-vsr="${v.which}" aria-label="Restore ${v.which === "original" ? "your original upload" : "the previous version"}">Restore</button>`}</li>`).join("")}</ul>${err ? `<p class="dlgerr" role="alert">${esc(err)}</p>` : ""}`;
  };
  const load = async () => {
    const r = await fetch(`${base}/versions`, { credentials: "same-origin", cache: "no-store" }).catch(() => null);
    if (!cur || cur.el !== el) return;
    if (!r || !r.ok) { body.innerHTML = `<p class="dlgerr" role="alert">Couldn't load the versions. Close this and try again.</p>`; return; }
    const d = await r.json(); data = { version: d.version, versions: d.versions }; paint();
    (el.querySelector<HTMLElement>(".vsr") || el.querySelector<HTMLElement>("[data-vsx]"))?.focus({ preventScroll: true });
  };
  el.addEventListener("click", async (e) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t.closest("[data-vsx]")) { versionsClose(); return; }
    const b = t.closest<HTMLElement>("[data-vsr]"); if (!b || busy || !data) return;
    const which = b.dataset.vsr as "previous" | "original";
    if (!(await ask({ title: which === "original" ? "Restore your original upload?" : "Restore the previous version?", body: `“${o.name}” goes back to this version. The version it replaces is kept, so you can restore it again.`, confirm: "Restore", cancel: "Cancel" }))) return;
    busy = true; el.classList.add("busy");
    try {
      const r = await fetch(`${base}/restore`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ which, base: data.version }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.file) { o.changed(d.file); await load(); }
      else if (r.status === 409) { await load(); paint("The file changed while this was open. The list is up to date now."); }
      else paint(d.error || "Couldn't restore that version. Try again.");
    } catch { paint("Couldn't restore that version. Check your connection and try again."); }
    busy = false; el.classList.remove("busy");
    (el.querySelector<HTMLElement>(".vsr") || el.querySelector<HTMLElement>("[data-vsx]"))?.focus({ preventScroll: true });
  });
  void el.offsetWidth; el.classList.add("on");
  (el.querySelector<HTMLElement>("[data-vsx]:not(.dlgback)"))?.focus({ preventScroll: true });
  await load();
}
// Esc closes this panel first (also above the file viewer); a confirm dialog on top takes its own Esc.
window.addEventListener("keydown", (e) => { if (!cur || dialogOpen()) return; if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); versionsClose(); } }, true);
