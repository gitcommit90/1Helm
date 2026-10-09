// New channel: a name and what it's for, nothing else. ONE helper (Captain, Muse overhaul): a channel is not a new helper, it's
// the person's same helper kept on one project, so there is no helper picker. A centered card on desktop, a bottom sheet on phone
// (dialog.css look). Esc and the backdrop cancel; Tab stays inside; app shortcuts underneath never see the keys while it's open.
// Live: POST <api>/channels {name, purpose} → {id, slug, name, purpose}. Errors from the server (duplicate, limit) show inline.
// Import this module early in v3.ts (right after dialog.ts), so its key handling runs before the app's own capture listeners.

export type NewChannel = { id: number; slug: string; name: string; purpose: string };
export type NcOpts = {
  helper: { name: string; avatar: number };
  /** Creates it: live = the API, sandbox = a local mock. Resolves the channel, or throws an Error whose message is shown. */
  create: (name: string, purpose: string) => Promise<NewChannel>;
  done: (c: NewChannel) => void;
};
export const NC_NAME_MAX = 40, NC_PURPOSE_MAX = 200;

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const reduced = () => matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let cur: { el: HTMLElement; prev: HTMLElement | null; busy: boolean } | null = null;

export const newChannelOpen = () => !!cur;

function close() {
  if (!cur || cur.busy) return;
  const { el, prev } = cur; cur = null;
  el.classList.remove("on"); el.classList.add("off");
  if (reduced()) el.remove(); else setTimeout(() => el.remove(), 320);
  if (prev && prev.isConnected) prev.focus({ preventScroll: true });
}

/** Live: the API call, with the server's own words on failure. */
export async function createViaApi(api: string, name: string, purpose: string): Promise<NewChannel> {
  let r: Response;
  try { r = await fetch(`${api}/channels`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, purpose }) }); }
  catch { throw Object.assign(new Error("Couldn't reach 1Helm. Check your connection and try again."), { code: "network" }); }
  const d = await r.json().catch(() => ({}));
  if (r.ok && d?.slug) return d as NewChannel;
  const msg = r.status === 402 ? "Your account is paused until a payment goes through, so new channels can't be added right now."
    : d?.error && d.error !== "payment_required" ? String(d.error) : "Couldn't create the channel. Try again in a minute.";
  throw Object.assign(new Error(msg), { code: d?.code || String(r.status), existing: d?.existing });
}

export function openNewChannel(o: NcOpts) {
  if (cur) return;
  const el = document.createElement("div");
  el.className = "dlgw ncw";
  el.innerHTML = `<div class="dlgback" data-ncx></div>
    <form class="dlg nc" role="dialog" aria-modal="true" aria-labelledby="ncT" aria-describedby="ncS" novalidate autocomplete="off">
      <span class="dlggrab" aria-hidden="true"></span>
      <div class="nchead"><img class="ncav" src="/av/${Number(o.helper.avatar) || 8}.png" alt=""><div><h2 id="ncT">New channel</h2>
        <p id="ncS">A space for one project. ${esc(o.helper.name)} keeps its work and memory there, focused on just that.</p></div></div>
      <label class="ncf"><span>Name</span><input id="ncName" name="name" maxlength="${NC_NAME_MAX}" placeholder="Garden, Wedding, Taxes 2026…" enterkeyhint="next" spellcheck="false"><em class="ncc" data-for="ncName"></em></label>
      <label class="ncf"><span>What's it for?</span><textarea id="ncPurp" name="purpose" rows="2" maxlength="${NC_PURPOSE_MAX}" placeholder="Help me plan the veggie garden and keep track of what to plant when" enterkeyhint="done"></textarea><em class="ncc" data-for="ncPurp"></em></label>
      <p class="ncerr" id="ncErr" role="alert" hidden></p>
      <div class="dlgbtns"><button type="button" class="dlgb no" data-ncx>Cancel</button><button type="submit" class="dlgb ok" data-ncok>Create channel</button></div>
    </form>`;
  const prev = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  document.body.appendChild(el);
  cur = { el, prev, busy: false };
  const form = el.querySelector<HTMLFormElement>("form")!, name = el.querySelector<HTMLInputElement>("#ncName")!, purp = el.querySelector<HTMLTextAreaElement>("#ncPurp")!;
  const err = el.querySelector<HTMLElement>("#ncErr")!, ok = el.querySelector<HTMLButtonElement>("[data-ncok]")!;
  const count = (f: HTMLInputElement | HTMLTextAreaElement, max: number) => { const n = [...f.value].length, c = el.querySelector<HTMLElement>(`.ncc[data-for="${f.id}"]`)!; c.textContent = n >= max * 0.75 ? `${n}/${max}` : ""; };
  const showErr = (msg: string, field?: HTMLInputElement | HTMLTextAreaElement) => {
    err.textContent = msg; err.hidden = !msg;
    for (const f of [name, purp]) { f.classList.toggle("bad", f === field && !!msg); f.setAttribute("aria-invalid", String(f === field && !!msg)); }
    if (field && msg) field.setAttribute("aria-describedby", "ncErr"); else for (const f of [name, purp]) f.removeAttribute("aria-describedby");
  };
  name.addEventListener("input", () => { count(name, NC_NAME_MAX); if (name.classList.contains("bad") || !err.hidden) showErr(""); });
  purp.addEventListener("input", () => { count(purp, NC_PURPOSE_MAX); if (purp.classList.contains("bad")) showErr(""); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); e.stopPropagation();   // the app's own document "submit" handler is the composer's
    if (!cur || cur.busy) return;
    const n = name.value.replace(/\s+/g, " ").trim(), p = purp.value.replace(/\s+/g, " ").trim();
    if (!n) { showErr("Give the channel a name.", name); name.focus(); return; }
    showErr(""); cur.busy = true; el.classList.add("busy"); ok.disabled = true; ok.textContent = "Creating…"; name.readOnly = purp.readOnly = true;
    try {
      const c = await o.create(n, p);
      if (cur) cur.busy = false; close(); o.done(c);
    } catch (x: any) {
      if (!cur) return;
      cur.busy = false; el.classList.remove("busy"); ok.disabled = false; ok.textContent = "Create channel"; name.readOnly = purp.readOnly = false;
      const field = /^(duplicate|name_)/.test(x?.code || "") ? name : /^purpose_/.test(x?.code || "") ? purp : undefined;
      showErr(String(x?.message || "Couldn't create the channel. Try again."), field); (field || name).focus();
    }
  });
  // Clicks in here never reach the app's document handlers (menus that close on an outside click, rows that open pages...).
  el.addEventListener("click", (e) => { e.stopPropagation(); if ((e.target as HTMLElement).closest("[data-ncx]")) close(); });
  el.addEventListener("mousedown", (e) => { if ((e.target as HTMLElement).closest(".dlgback")) e.preventDefault(); });
  void el.offsetWidth; el.classList.add("on");
  name.focus({ preventScroll: true });
}

// While it's open: Esc closes, Tab cycles inside, and no app shortcut underneath sees the keys (typing still types).
window.addEventListener("keydown", (e) => {
  if (!cur) return;
  e.stopImmediatePropagation();
  if (e.key === "Escape") { e.preventDefault(); close(); return; }
  // Enter: in Name, on to "What's it for?" (or submit when Name is empty, which shows the error); in "What's it for?", Create
  // (Shift+Enter is a new line). The element handlers never see keys (stopped above), so it's handled here.
  const a = document.activeElement as HTMLElement | null;
  if (e.key === "Enter" && !e.isComposing && (a?.id === "ncName" || (a?.id === "ncPurp" && !e.shiftKey))) {
    e.preventDefault(); const form = cur.el.querySelector<HTMLFormElement>("form")!, name = cur.el.querySelector<HTMLInputElement>("#ncName")!;
    if (a.id === "ncName" && name.value.trim()) cur.el.querySelector<HTMLTextAreaElement>("#ncPurp")!.focus(); else form.requestSubmit();
    return;
  }
  if (e.key === "Tab") {
    const f = [...cur.el.querySelectorAll<HTMLElement>("input,textarea,button:not([disabled])")];
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
  }
}, true);
window.addEventListener("keyup", (e) => { if (cur) e.stopImmediatePropagation(); }, true);
document.addEventListener("focusin", (e) => { if (cur && !cur.el.contains(e.target as Node)) cur.el.querySelector<HTMLElement>("#ncName")?.focus({ preventScroll: true }); }, true);
