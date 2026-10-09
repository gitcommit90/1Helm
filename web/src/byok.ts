// The self-hosted owner's AI service. Plan switching and credits live in ee/byok-billing.ts.
import { ask } from "./dialog";

export const BYK_SEC = "byok";
export const BYK_TITLE = "Use my own AI key";
type Test = { ok?: boolean; checks?: Record<string, { ok?: boolean; error?: string }> };
type Saved = { base: string; host: string; model: string; fast?: string; last4?: string; source?: string; saved_at?: number; test?: Test };
type State = { saved: Saved | null; openrouter?: { pending?: { last4?: string } | null; manage?: string } };
type Deps = { api: ((path: string, body?: any) => Promise<any>) | null; repaint: () => void; open: () => void;
  note: (ok: boolean, title: string, sub: string) => void; who: () => string;
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string; icon: (k: string, s?: number) => string;
  shown: () => boolean; credits: () => void; orStart: string | null };
let D: Deps | null = null;
let lastLoad = 0;
const B: { state: State | null; loading: boolean; busy: "" | "test" | "save" | "delete"; edit: boolean; manual: boolean; eye: boolean;
  error: string; field: string; test: Test | null; form: { base: string; model: string; fast: string; ack: boolean }; key: string } =
  { state: null, loading: false, busy: "", edit: false, manual: false, eye: false, error: "", field: "", test: null,
    form: { base: "", model: "", fast: "", ack: false }, key: "" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const call = (path: string, body?: any) => D?.api ? D.api(path, body) : Promise.resolve(path === "/byok" ? { saved: null } : { error: "Connect to a server to save a key." });
const pending = () => B.state?.openrouter?.pending || null;
const useOpenRouter = () => !B.manual && (!!pending() || (B.edit && B.state?.saved?.source === "openrouter"));
const values = () => useOpenRouter() ? { source: "openrouter", model: B.form.model.trim(), fast: B.form.fast.trim() }
  : { base: B.form.base.trim(), key: B.key.trim(), model: B.form.model.trim(), fast: B.form.fast.trim() };

export function bykLoad(force = false) {
  if (B.loading || (!force && (B.state || Date.now() - lastLoad < 30_000))) return;
  lastLoad = Date.now();
  B.loading = true; B.error = "";
  call("/byok").then(d => { if (d?.error) B.error = d.error; else B.state = d as State; })
    .catch(() => { B.error = "Couldn't load your AI service. Try again."; })
    .finally(() => { B.loading = false; D?.repaint(); });
}
export function bykRow(): string {
  if (!D) return "";
  bykLoad();
  const s = B.state?.saved, title = s ? s.source === "openrouter" ? "OpenRouter" : s.host : "Use my own AI key";
  return D.srow(D.icon("key"), title, s ? `${esc(s.model)} · Your provider bills you directly` : "Add an AI service to start a task", s ? "On" : "Needed", "data-bykrow");
}
export const bykUsageNote = () => "";
const field = (name: "base" | "model" | "fast", title: string, hint: string) => `<label class="sf"><span>${title}</span><input data-bykf="${name}" value="${esc(B.form[name])}" placeholder="${esc(hint)}" autocapitalize="none" spellcheck="false">${B.field === name ? `<em class="bykerr" role="alert">${esc(B.error)}</em>` : ""}</label>`;
const testLine = (test: Test | null) => !test ? "" : `<p class="byktest${test.ok ? "" : " fail"}" role="status">${test.ok ? "Connection and tool calling passed." : "The connection test did not pass."}</p>`;
export function bykPage(): string {
  if (!D) return "";
  bykLoad();
  const who = esc(D.who()), s = B.state?.saved, isOr = useOpenRouter(), edit = !s || B.edit || !!pending();
  const head = `<h2>${BYK_TITLE}</h2><p class="slead">${who} uses your chosen AI service and models. Your provider bills you for its usage. Add an OpenAI-compatible endpoint and a model that supports tool calling.</p>`;
  if (!B.state) return `${head}<div class="sc">${D.srow("", B.error ? "Couldn't load" : "Loading…", esc(B.error), B.error ? `<button class="sa blue" data-bykretry>Try again</button>` : "")}</div>`;
  const saved = s && !edit ? `<div class="sc">${D.srow(D.icon("spark"), s.source === "openrouter" ? "OpenRouter" : esc(s.host), `${esc(s.model)}${s.fast && s.fast !== s.model ? ` · fast: ${esc(s.fast)}` : ""}`, "In use")}
    ${D.srow(D.icon("key"), "Saved key", s.last4 ? `••••${esc(s.last4)}` : "No key required", "")}
    ${testLine(B.test || s.test || null)}<div class="sfoot bykacts"><button class="sa blue" data-byktest${B.busy ? " disabled" : ""}>Test connection</button><button class="sa blue" data-bykedit${B.busy ? " disabled" : ""}>Change</button><button class="sa mute" data-bykrm${B.busy ? " disabled" : ""}>Remove</button></div></div>` : "";
  const orBox = D.orStart && edit && !isOr ? `<div class="sc bykorbox"><b>OpenRouter</b><p>Sign in to create a key, then choose your models here.</p><button class="sa blue" data-bykor>Sign in with OpenRouter</button></div>` : "";
  const form = edit ? `${orBox}<form class="sc sform" id="bykf" novalidate data-unsaved="byok"><div class="sfh">${D.icon("spark")}<b>${isOr ? "Choose your OpenRouter models" : "Your AI service"}</b></div>
    ${isOr ? `<p class="bykorcon">Connected to OpenRouter${pending()?.last4 ? ` · key ••••${esc(pending()!.last4)}` : ""}</p>` : `${field("base", "Service address", "https://api.openai.com/v1")}
    <label class="sf"><span>Key (leave empty if your service needs none)</span><span class="spw"><input id="byk-key" data-bykf="key" type="${B.eye ? "text" : "password"}" placeholder="${s?.last4 ? `Leave empty to keep ••••${esc(s.last4)}` : "Your provider key"}" autocomplete="new-password" autocapitalize="none" spellcheck="false"><button type="button" class="seye" data-bykeye aria-label="Show key">${D.icon("eye", 17)}</button></span>${B.field === "key" ? `<em class="bykerr" role="alert">${esc(B.error)}</em>` : ""}</label>`}
    ${field("model", "Model", "Model ID with tool calling")}${field("fast", "Fast model (optional)", "Leave empty to use the main model")}
    <div class="bykwarn"><div><p>Your messages and files that the AI reads go to your provider under its terms. The key is stored encrypted; this app cannot show it again.</p><label class="bykack"><input type="checkbox" data-bykack${B.form.ack ? " checked" : ""}>I understand</label></div></div>
    ${B.error && !B.field ? `<p class="bykerr" role="alert">${esc(B.error)}</p>` : ""}${testLine(B.test)}
    <div class="sbtns"><button type="submit" class="sprim"${B.busy || !B.form.ack ? " disabled" : ""}>${B.busy === "save" ? "Testing and saving…" : "Save"}</button><button type="button" class="sa blue" data-byktest${B.busy ? " disabled" : ""}>${B.busy === "test" ? "Testing…" : "Test connection"}</button>${s ? `<button type="button" class="sa" data-bykcancel>Cancel</button>` : ""}</div>
    ${isOr ? `<button type="button" class="bykorlink" data-bykmanual>Use a different AI service</button>` : ""}</form>` : "";
  return `${head}${saved}${form}<p class="sfine">Save tests the service before keeping it. If it stops working, ${who} asks you to check these settings.</p>`;
}
export const bykEditing = () => !!B.state && (!B.state.saved || B.edit || !!pending());
export const bykBusy = () => !!B.busy;
export function bykDiscard() { B.edit = false; B.manual = false; B.key = ""; B.error = ""; B.form.ack = false; }
export function bykAfter() { const input = document.getElementById("byk-key") as HTMLInputElement | null; if (input && B.key && input.value !== B.key) input.value = B.key; }
const startEdit = (manual = false) => { const s = B.state?.saved; B.edit = true; B.manual = manual; B.error = B.field = ""; B.test = null; B.key = ""; B.form = { base: manual && s?.source === "openrouter" ? "" : s?.base || "", model: manual && s?.source === "openrouter" ? "" : s?.model || "", fast: manual && s?.source === "openrouter" ? "" : s?.fast || "", ack: false }; };
async function test() {
  if (B.busy) return;
  B.busy = "test"; B.error = B.field = ""; B.test = null; D?.repaint();
  try { const d = await call("/byok/test", bykEditing() ? values() : B.state?.saved?.source === "openrouter" ? { source: "openrouter", model: B.state.saved.model, fast: B.state.saved.fast } : { base: B.state?.saved?.base, model: B.state?.saved?.model, fast: B.state?.saved?.fast, key: "" });
    if (d?.test) B.test = d.test; else { B.error = d?.error || "Couldn't test the connection."; B.field = d?.field || ""; } }
  catch { B.error = "Couldn't test the connection. Try again."; }
  B.busy = ""; D?.repaint();
}
async function save() {
  if (B.busy) return;
  if (!B.form.ack) { B.error = "Read the provider note and tick the box to save."; B.field = "ack"; D?.repaint(); return; }
  B.busy = "save"; B.error = B.field = ""; D?.repaint();
  try { const d = await call("/byok/save", { ...values(), ack: true });
    if (d?.ok && d.saved) { B.state = d; B.edit = false; B.manual = false; B.key = ""; B.form.ack = false; B.test = d.test || null; D?.note(true, "AI service saved", `${D.who()} uses ${d.saved.model} from your next message.`); }
    else { B.error = d?.error || "Couldn't save your AI service."; B.field = d?.field || ""; B.test = d?.test || null; } }
  catch { B.error = "Couldn't save your AI service. Try again."; }
  B.busy = ""; D?.repaint();
}
async function remove() {
  if (B.busy || !B.state?.saved) return;
  if (!await ask({ title: "Remove your AI service?", body: `${D?.who() || "Your helper"} cannot answer until you add one again.`, confirm: "Remove", danger: true })) return;
  B.busy = "delete"; D?.repaint();
  try { const d = await call("/byok/delete", {}); if (d?.error) throw new Error(d.error); B.state = d; startEdit(); B.edit = false; D?.note(true, "AI service removed", "Add a new service to start a task."); }
  catch (e: any) { B.error = e?.message || "Couldn't remove the service."; }
  B.busy = ""; D?.repaint();
}
export const bykSwitched = () => {};
export function bykInit(d: Deps) {
  D = d;
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const a = t.closest?.<HTMLAnchorElement>('a[href*="settings=byok"]');
    if (a) { try { const u = new URL(a.href, location.href); if (u.origin === location.origin) { e.preventDefault(); e.stopPropagation(); D?.open(); return; } } catch {} }
    if (t.closest("[data-bykrow]")) { B.state = null; B.edit = false; B.error = ""; }
    if (t.closest("[data-bykretry]")) { bykLoad(true); return; }
    if (t.closest("[data-bykedit]")) { startEdit(); D?.repaint(); return; }
    if (t.closest("[data-bykcancel]")) { bykDiscard(); D?.repaint(); return; }
    if (t.closest("[data-bykrm]")) { remove(); return; }
    if (t.closest("[data-byktest]")) { e.preventDefault(); test(); return; }
    if (t.closest("[data-bykor]") && D?.orStart) { e.preventDefault(); location.assign(D.orStart); return; }
    if (t.closest("[data-bykmanual]")) { startEdit(true); D?.repaint(); return; }
    if (t.closest("[data-bykeye]")) { B.eye = !B.eye; const input = document.getElementById("byk-key") as HTMLInputElement | null; if (input) input.type = B.eye ? "text" : "password"; return; }
  }, true);
  document.addEventListener("input", e => { const t = e.target as HTMLInputElement, k = t.dataset?.bykf; if (!k) return;
    if (k === "key") B.key = t.value; else if (k === "base" || k === "model" || k === "fast") B.form[k] = t.value;
    if (B.field === k) { B.error = B.field = ""; }
  });
  document.addEventListener("change", e => { const t = e.target as HTMLInputElement; if (t.matches?.("[data-bykack]")) { B.form.ack = t.checked; D?.repaint(); } });
  document.addEventListener("submit", e => { if ((e.target as HTMLElement).id !== "bykf") return; e.preventDefault(); e.stopImmediatePropagation(); save(); }, true);
  const q = new URLSearchParams(location.search), sec = q.get("settings"), oa = q.get("orauth");
  if (oa) { B.state = null; if (oa === "ok") startEdit(); else B.error = "OpenRouter sign-in did not finish. Try again."; q.delete("orauth"); q.delete("orwhy"); }
  if (sec === BYK_SEC || oa) { q.delete("settings"); const qs = q.toString(); history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash); setTimeout(() => D?.open(), 300); }
}
export const bykIs = (sec: string) => sec === BYK_SEC;
