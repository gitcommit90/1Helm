// Our own confirm / notice dialog. 1Helm never uses the browser's confirm(), alert() or prompt() (the Captain's rule; a proto
// test fails the build if one comes back). A centered card on desktop, a bottom sheet on phone, in the settings-sheet look.
//   if (!(await ask({ title: "Disconnect Gmail?", body: "Skipper won't be able to use it anymore.", confirm: "Disconnect", danger: true }))) return;
//   await tell({ title: "Couldn't save", body: "Try again in a minute." });
//   const r = await choose({ title: "Save changes to Sam?", confirm: "Save", alt: "Discard", cancel: "Keep editing" });   // "ok" | "alt" | "no"
//   const r = await askOr({ title: "Start Live notes?", confirm: "Start", link: "Use this device's mic instead" });         // a small text option: "alt"
//   const p = await sheet({ title: "Start Live notes?", confirm: "Start", choices: [{ id: "tab", label: "A meeting tab" }, …], value: "tab",
//     toggle: { for: "tab", label: "Also record my microphone", on: true }, check: async (p) => ok ? null : "One-line fix" });   // {v, toggle} | null
// Esc and the backdrop cancel. Enter only presses the focused button: destructive dialogs open with Cancel focused, others with the
// confirm button. Tab stays inside. While it's open, no app shortcut or Esc handler underneath sees the keys.
// Import this module before anything that registers its own window keydown (capture) listener, so its Esc handling wins.

export type AskOpts = {
  title: string;
  body?: string;
  /** The confirm button's label: say what it does ("Disconnect", "Delete"). */
  confirm?: string;
  /** The cancel button's label; null hides it (tell() does that). */
  cancel?: string | null;
  /** Destructive: a red confirm button, and Cancel gets the focus. */
  danger?: boolean;
  /** Typed confirmation: the confirm button stays off until the box holds `match` (case and extra spaces don't matter). */
  type?: { match: string; label: string; placeholder?: string };
  /** A third button (choose() only), like Discard in "Save / Discard / Keep editing". Its text is red; on desktop it sits on the left. */
  alt?: string;
  /** A small text option under the body (askOr() only), like "Use this device's mic instead". Pressing it answers "alt". */
  link?: string;
  /** Radio choices under the body (sheet() only); a disabled one shows its sub as the reason. */
  choices?: SheetOpt[];
  value?: string | null;
  /** A switch shown under one choice while it's picked (sheet() only). */
  toggle?: { for: string; label: string; sub?: string; on: boolean };
  /** sheet() only: runs inside the confirm tap. null → the sheet closes with the pick; a string → it stays open with that one-line
   *  fix under the choices, and the confirm button reads `retry`. While it runs, the sheet can't be closed. */
  check?: (p: SheetPick) => Promise<string | null>;
  retry?: string;
};
export type SheetOpt = { id: string; label: string; sub?: string; disabled?: boolean };
export type SheetPick = { v: string; toggle: boolean };
type Pick = "ok" | "alt" | "no";
export const typedOk = (v: string, match: string) => { const n = (x: string) => String(x || "").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim().toLowerCase(); return !!n(match) && n(v) === n(match); };

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const reduced = () => matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let cur: { el: HTMLElement; done: (v: Pick) => void; prev: HTMLElement | null; busy?: boolean } | null = null;
let n = 0;

export const dialogOpen = () => !!cur;

function buttons() { return cur ? [...cur.el.querySelectorAll<HTMLElement>(".dlgin, .dlglink, .dlgopt input:checked, .dlgtog:not([hidden]) input, .dlgb:not(:disabled)")] : []; }

function close(v: Pick, force = false) {
  if (!cur || (cur.busy && !force)) return;
  const { el, done, prev } = cur; cur = null;
  el.classList.remove("on"); el.classList.add("off"); el.setAttribute("aria-hidden", "true");
  if (reduced()) el.remove(); else setTimeout(() => el.remove(), 320);
  if (prev && prev.isConnected) prev.focus({ preventScroll: true });
  done(v);
}

/** Ask a yes/no question in our own UI. Resolves true only when the confirm button is pressed. */
export function ask(o: AskOpts): Promise<boolean> { return show({ ...o, alt: undefined, link: undefined }).then(v => v === "ok"); }
/** The confirm button plus a small text option under the body: "ok", "alt" (the option) or "no". */
export function askOr(o: AskOpts & { link: string }): Promise<Pick> { return show({ ...o, alt: undefined }); }
/** Three answers: "ok" (the confirm button), "alt" (the alt button), "no" (cancel, Esc, a tap outside). */
export function choose(o: AskOpts & { alt: string }): Promise<Pick> { return show(o); }

/** Pick one of several choices (radio rows), maybe with a switch under one, and a confirm that may check first (check). → the pick, or null. */
export function sheet(o: AskOpts & { choices: SheetOpt[] }): Promise<SheetPick | null> {
  const got: { p: SheetPick | null } = { p: null };
  return show(o, got).then((v) => (v === "ok" ? got.p : null));
}

function show(o: AskOpts, got?: { p: SheetPick | null }): Promise<Pick> {
  if (cur) close("no", true);
  const id = `dlg${++n}`, cancel = o.cancel === undefined ? "Cancel" : o.cancel;
  const el = document.createElement("div");
  el.className = "dlgw";
  el.innerHTML = `<div class="dlgback" data-dlgx></div>
    <div class="dlg" role="${o.danger ? "alertdialog" : "dialog"}" aria-modal="true" aria-labelledby="${id}t"${o.body ? ` aria-describedby="${id}b"` : ""} tabindex="-1">
      <span class="dlggrab" aria-hidden="true"></span>
      <h2 id="${id}t">${esc(o.title)}</h2>${o.body ? `<p id="${id}b">${esc(o.body)}</p>` : ""}${o.link ? `<button type="button" class="dlglink" data-dlgalt>${esc(o.link)}</button>` : ""}
      ${o.choices ? `<div class="dlgopts" role="radiogroup" aria-labelledby="${id}t">${o.choices.map((c) => `<label class="dlgopt${c.disabled ? " off" : ""}"><input type="radio" name="${id}r" value="${esc(c.id)}"${c.id === o.value && !c.disabled ? " checked" : ""}${c.disabled ? " disabled" : ""}><span><b>${esc(c.label)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</span></label>${o.toggle && o.toggle.for === c.id ? `<label class="dlgtog"${c.id === o.value ? "" : " hidden"}><input type="checkbox"${o.toggle.on ? " checked" : ""}><span><b>${esc(o.toggle.label)}</b>${o.toggle.sub ? `<small>${esc(o.toggle.sub)}</small>` : ""}</span></label>` : ""}`).join("")}</div><p class="dlgerr" role="alert" hidden></p>` : ""}
      ${o.type ? `<label class="dlgtype"><span>${esc(o.type.label)}</span><input class="dlgin" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="${esc(o.type.placeholder || o.type.match)}" aria-label="${esc(o.type.label)}"></label>` : ""}
      <div class="dlgbtns">${cancel ? `<button type="button" class="dlgb no" data-dlgno>${esc(cancel)}</button>` : ""}${o.alt ? `<button type="button" class="dlgb no alt" data-dlgalt>${esc(o.alt)}</button>` : ""}<button type="button" class="dlgb ${o.danger ? "bad" : "ok"}" data-dlgok${o.type ? " disabled" : ""}>${esc(o.confirm || "OK")}</button></div>
    </div>`;
  // Clicks in here never reach the app's document handlers (menus that close on an outside click, rows that open pages...).
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (t.closest("[data-dlgok]")) { if (!(t.closest("[data-dlgok]") as HTMLButtonElement).disabled) { if (o.choices) pickOk(); else close("ok"); } }
    else if (t.closest("[data-dlgalt]")) close("alt");
    else if (t.closest("[data-dlgno]") || t.closest("[data-dlgx]")) close("no");
  });
  el.addEventListener("mousedown", (e) => { if ((e.target as HTMLElement).closest("[data-dlgx]")) e.preventDefault(); });
  const tin = el.querySelector<HTMLInputElement>(".dlgin"), okb = el.querySelector<HTMLButtonElement>("[data-dlgok]")!;
  if (tin && o.type) tin.addEventListener("input", () => { okb.disabled = !typedOk(tin.value, o.type!.match); });
  // sheet(): the switch follows its choice; the confirm needs a pick; check() runs inside the tap and may keep the sheet open.
  const pick = (): SheetPick => ({ v: el.querySelector<HTMLInputElement>(".dlgopt input:checked")?.value || "", toggle: !!el.querySelector<HTMLInputElement>(".dlgtog input")?.checked });
  const err = el.querySelector<HTMLElement>(".dlgerr"), label = okb.textContent || "";
  const sync = () => { const p = pick(); okb.disabled = !p.v; el.querySelectorAll<HTMLElement>(".dlgtog").forEach((g) => { g.hidden = o.toggle?.for !== p.v; }); };
  if (o.choices) { el.addEventListener("change", () => { sync(); if (err) err.hidden = true; okb.textContent = label; }); sync(); }
  async function pickOk() {
    const me = cur; if (!me || me.el !== el || me.busy) return;
    const p = pick(); if (!p.v) return;
    if (!o.check) { if (got) got.p = p; close("ok"); return; }
    me.busy = true; okb.disabled = true; el.classList.add("busy");
    let r: string | null = null;
    try { r = await o.check(p); } catch { r = "That didn't work. Try again."; }
    me.busy = false; el.classList.remove("busy");
    if (cur !== me) return;
    if (r == null) { if (got) got.p = p; close("ok"); return; }
    if (err) { err.textContent = r; err.hidden = false; }
    okb.textContent = o.retry || "Try again"; okb.disabled = false; okb.focus({ preventScroll: true });
  }
  const prev = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  document.body.appendChild(el);
  return new Promise<Pick>((done) => {
    cur = { el, done, prev };
    const first = tin || el.querySelector<HTMLButtonElement>(o.danger && cancel ? "[data-dlgno]" : "[data-dlgok]")!;
    first.focus({ preventScroll: true });
    void el.offsetWidth; el.classList.add("on");
  });
}

/** A notice with one button (our replacement for alert()). */
export function tell(o: { title: string; body?: string; ok?: string }): Promise<void> {
  return ask({ title: o.title, body: o.body, confirm: o.ok || "OK", cancel: null }).then(() => {});
}

// Registered when this module loads, before the app's own capture listeners (Apps popup, app page, Settings), so Esc cancels the
// dialog and nothing else. Every other key is kept from the app too; its default still happens (Enter/Space press the focused button).
window.addEventListener("keydown", (e) => {
  if (!cur) return;
  e.stopImmediatePropagation();
  if (e.key === "Escape") { e.preventDefault(); close("no"); return; }
  if (e.key === "Tab") {
    e.preventDefault();
    const bs = buttons(); if (!bs.length) return;
    const i = bs.indexOf(document.activeElement as HTMLElement);
    bs[(i < 0 ? 0 : i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
    return;
  }
  const inBox = (document.activeElement as HTMLElement)?.classList?.contains("dlgin");
  if (inBox && e.key === "Enter") { e.preventDefault(); const ok = cur.el.querySelector<HTMLButtonElement>("[data-dlgok]"); if (ok && !ok.disabled) close("ok"); return; }
  const onPick = !!(document.activeElement as HTMLElement)?.closest?.(".dlgopt, .dlgtog");
  if (onPick && e.key === "Enter") { e.preventDefault(); cur.el.querySelector<HTMLButtonElement>("[data-dlgok]")?.click(); return; }
  if ((e.key === "Enter" || e.key === " ") && !inBox && !onPick && !(document.activeElement as HTMLElement)?.closest?.(".dlgb")) e.preventDefault();
}, true);
window.addEventListener("keyup", (e) => { if (cur) e.stopImmediatePropagation(); }, true);
// If something underneath grabs the focus (a box that refocuses itself), bring it back.
document.addEventListener("focusin", (e) => {
  if (!cur || cur.el.contains(e.target as Node)) return;
  (cur.el.querySelector<HTMLElement>("[data-dlgno]") || cur.el.querySelector<HTMLElement>("[data-dlgok]"))?.focus({ preventScroll: true });
}, true);
