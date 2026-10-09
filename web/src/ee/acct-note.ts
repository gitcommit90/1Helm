// Account notes (Captain, 10-06): under each connected account, on the app's own page and in Settings → Connected accounts, a quiet
// "Add a note for <helper>" opens a small text box (one or two lines, 300 characters) with Save / Cancel / Delete. The saved note shows
// under the account in a quiet style, and the helper reads it when choosing which account to use ("my work email; use for anything
// Tennis Channel"). Server: POST <api>/apps/note { id, note } → { ok, note, accounts } (an empty note deletes it).
// One note box is open at a time, wherever it is. Both surfaces draw with acctNoteHtml() and listen through onAcctNote().
export const NOTE_MAX = 300;
type Deps = { api: () => string | null; helper: () => string };
let D: Deps | null = null;
const NT = { edit: "", draft: "", busy: "", err: "", focus: false };
const subs: { saved: (accounts: any[]) => void; repaint: () => void }[] = [];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const pen = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const plus = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;

export function initAcctNote(deps: Deps) { D = deps; }
// A surface (the app page, Settings) hears about saves (the server's whole connected-apps list) and repaints when the box changes.
export function onAcctNote(saved: (accounts: any[]) => void, repaint: () => void) { subs.push({ saved, repaint }); }
export const acctNoteEditing = () => !!NT.edit;
export function acctNoteReset() { NT.edit = ""; NT.draft = ""; NT.err = ""; NT.busy = ""; NT.focus = false; }

// The note part under one account: the link, the saved note, or the open box. memo = the saved note ("" = none).
export function acctNoteHtml(a: { id: string; memo?: string; label?: string }) {
  const h = esc(D?.helper() || "your helper"), memo = String(a.memo || "");
  if (NT.edit === a.id) {
    const busy = NT.busy === a.id, n = NT.draft.length;
    return `<div class="acnbox" data-acnbox="${esc(a.id)}"><textarea class="acnta" id="acnta" rows="2" maxlength="${NOTE_MAX}" aria-label="Note for ${h} about ${esc(a.label || "this account")}" placeholder="e.g. My work email. Use it for anything work-related."${busy ? " disabled" : ""}>${esc(NT.draft)}</textarea>
      <div class="acnbar"><span class="acnhint${NT.err ? " err" : ""}" aria-live="polite">${NT.err ? esc(NT.err) : n > NOTE_MAX - 60 ? `${n}/${NOTE_MAX}` : `${h} reads this when picking an account.`}</span>
      <span class="acnbtns">${memo ? `<button type="button" class="acnb acnred" data-acndel="${esc(a.id)}"${busy ? " disabled" : ""}>Delete</button>` : ""}<button type="button" class="acnb" data-acnx${busy ? " disabled" : ""}>Cancel</button><button type="button" class="acnb acnsave" data-acnsave="${esc(a.id)}"${busy ? " disabled" : ""}>${busy ? "Saving…" : "Save"}</button></span></div></div>`;
  }
  if (memo) return `<div class="acnshow"><button type="button" class="acnmemo" data-acnedit="${esc(a.id)}" title="Edit the note for ${h}"><span class="acnq">${esc(memo)}</span><span class="acned">${pen}<span>Edit</span></span></button></div>`;
  return `<div class="acnshow"><button type="button" class="acnadd" data-acnedit="${esc(a.id)}">${plus}<span>Add a note for ${h}</span></button></div>`;
}
// After a surface repaints: the open box keeps its focus and caret.
export function acctNoteAfter() {
  if (!NT.edit || !NT.focus) return;
  const t = document.getElementById("acnta") as HTMLTextAreaElement | null; if (!t || document.activeElement === t) return;
  t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length);
}
const repaint = () => { for (const s of subs) { try { s.repaint(); } catch (e) { console.error("account note: repaint", e); } } acctNoteAfter(); };

function open(id: string, memo: string) { NT.edit = id; NT.draft = memo; NT.err = ""; NT.busy = ""; NT.focus = true; repaint(); }
function close() { acctNoteReset(); repaint(); }
function save(id: string, note: string) {
  const api = D?.api(); if (!api || NT.busy) return;
  NT.busy = id; NT.err = ""; NT.draft = note; repaint();
  fetch(`${api}/apps/note`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, note }) }).then(r => r.json())
    .then(d => {
      if (!d || !Array.isArray(d.accounts)) { NT.busy = ""; NT.err = d?.error || "Couldn't save. Try again in a minute."; repaint(); return; }
      acctNoteReset();
      for (const s of subs) { try { s.saved(d.accounts); } catch (e) { console.error("account note: saved", e); } }
      repaint();
    }).catch(() => { NT.busy = ""; NT.err = "Couldn't save. Check your connection and try again."; repaint(); });
}
const memoOf = (el: HTMLElement) => el.closest(".acnshow")?.querySelector(".acnq")?.textContent || "";

// Taps anywhere (both surfaces): open, save, cancel, delete. Clicks inside the box never reach the row underneath.
document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  const ed = t.closest<HTMLElement>("[data-acnedit]"); if (ed) { e.stopPropagation(); open(ed.dataset.acnedit!, memoOf(ed)); return; }
  const sv = t.closest<HTMLElement>("[data-acnsave]"); if (sv) { e.stopPropagation(); save(sv.dataset.acnsave!, (document.getElementById("acnta") as HTMLTextAreaElement | null)?.value ?? NT.draft); return; }
  const dl = t.closest<HTMLElement>("[data-acndel]"); if (dl) { e.stopPropagation(); save(dl.dataset.acndel!, ""); return; }
  if (t.closest("[data-acnx]")) { e.stopPropagation(); close(); return; }
  if (NT.edit) NT.focus = !!t.closest(".acnbox");   // tapped elsewhere: a repaint won't pull the focus back
}, true);
document.addEventListener("input", e => { const t = e.target as HTMLTextAreaElement; if (t.id !== "acnta") return; NT.draft = t.value; NT.err = "";
  const hint = t.closest(".acnbox")?.querySelector(".acnhint"); if (hint) { hint.classList.remove("err"); hint.textContent = t.value.length > NOTE_MAX - 60 ? `${t.value.length}/${NOTE_MAX}` : `${D?.helper() || "Your helper"} reads this when picking an account.`; } });
// Enter saves (a note is one line of text); Esc closes the box first, before the page or Settings underneath.
window.addEventListener("keydown", e => {
  const t = e.target as HTMLElement; if (!NT.edit || t?.id !== "acnta") return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopImmediatePropagation(); save(NT.edit, (t as HTMLTextAreaElement).value); }
}, true);
