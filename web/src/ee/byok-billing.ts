// Settings → General → Use my own AI key (Captain 10-06): "allow BYOK with any OpenAI Compatible endpoint reminding users that BYOK
// comes without the added ZDR guarantee for the AI portion of using the app." On the Bring your own key plan ($10/month, 100 GB;
// everything else 1Helm runs is paid from credits at cost + 15%) the key is simply their AI. On a full plan (Personal/Plus/Power/Max)
// the person saves the key, then picks one of two options (Captain 10-06):
//   - Keep my plan, use my key as a backup (mode "fallback"): 1Helm credits first; once they're used up, chat goes to the key until
//     they refill. The computer, browser, web search and memory still need credits. Usage shows "Using your own AI key (1Helm credits
//     used up)" while it's on; the switch itself is announced once (the stream event byok_switch → bykSwitched, and the boot notice).
//   - Switch now to the $10 plan with my key (POST /byok/switch-now, Captain 10-28): the plan changes at once, the unused plan usage becomes
//     credits, no charge or refund; the confirm dialog (from /byok/switch-preview) says so. Change plan → Bring your own key does the same
//     (bykSwitchNow, called by storage.ts). A switch already scheduled for the renewal (mode "switch") keeps Undo and gets Switch now next to it.
//     Refused in plain words (with Add storage) when the account uses more than the $10 plan holds, and without a working saved key.
//   Changing the option works both ways; removing the key with a switch pending asks whether to cancel the switch too.
// 1HC: src/byok.js (GET /api/byok, POST /api/byok/test|save|delete|mode).
//   - Fields: the service's address (an OpenAI-compatible base URL), the key, the main model, an optional fast model for small jobs.
//   - Test connection: reach, tool calling, streaming (and the fast model). Save tests first and needs the warning ticked.
//   - The key goes up once and never comes back: the page shows •••• and its last 4. Typed values live here, never in the HTML.
// Sign in with OpenRouter (Captain 10-08, 1HC src/byok-openrouter.js): an optional button above the manual form. It's a same-tab
// navigation to /w/<slug>/byok/openrouter/start (OAuth PKCE on the server; the key never reaches the app) and comes back with
// ?settings=byok&orauth=ok (or &orauth=err&orwhy=<reason>, said in plain words here). Then the form only asks for a model and a fast
// model (a searchable list from OpenRouter's /models, or type any name), the same warning tick, and Save runs the same test + save
// as a pasted key ({ source: "openrouter" }). Connected shows "Connected to OpenRouter" with Disconnect (1Helm forgets the key) and a
// link to the key in their OpenRouter account (to revoke it there). The manual address + key form stays one tap away.
// v3.ts hooks in: bykRow() in General, bykPage() as the "byok" section, bykUsageNote() in the usage card, bykAfter() after every
// Settings paint, bykSwitched() on the stream's byok_switch, bykInit() once.
// Sandbox (no 1HC): the same screens on a pretend service and a pretend Personal plan (?byokplan: on the $10 plan instead; for
// screenshots ?byoksaved / ?byokfb (a backup key in use) / ?byokswitch (a switch pending) / ?byokstorage (the switch refused for storage),
// ?byokor (signed in with OpenRouter, models not picked yet) / ?byokorsaved (saved through OpenRouter) / ?orauth=err&orwhy=<reason>).
import { ask, choose } from "../dialog";

export const BYK_SEC = "byok";
export const BYK_TITLE = "Use my own AI key";
export const BYK_WARN = "With your own AI key, your messages and files that the AI reads go to that provider under their terms. 1Helm's zero-data-retention guarantee covers only the parts we run. Everything else stays private as before.";
export const BYK_TERMS = "1Helm's instructions sent to your AI service remain 1Helm's and are covered by our Terms.";
// A full plan: the caveat holds only while the key is actually answering.
export const BYK_ZDR_FULL = "On your current plan this applies only while your key is in use: with the backup option, only after your 1Helm credits run out; with the switch, from the day it happens.";
export const FALLBACK_NOTE = "Using your own AI key (1Helm credits used up)";
export const BYK_ZDR_OPTS = "Zero data retention: while your key is in use, what the AI reads goes to your provider under their terms, and 1Helm's guarantee covers only the parts we run. With the backup, that's only after your 1Helm credits run out; with the switch, from the day it happens.";
type Check = { ok: boolean; error?: string; ms?: number; model?: string };
type Test = { ok: boolean; checks: { reach?: Check; tools?: Check; stream?: Check; fast?: Check }; ms?: number; at?: number };
type Saved = { base: string; host: string; model: string; fast: string; last4: string; saved_at: number; tested_at: number | null; test: Test | null; source?: "openrouter" };
type OrInfo = { pending: { last4: string; at: number | null } | null; manage: string };
type OrModel = { id: string; name: string; ctx: number; in: number | null; out: number | null };
type Mode = "" | "fallback" | "switch";
type St = { on_plan: boolean; full: boolean; plan_name: string; price: number; saved: Saved | null; mode: Mode; switch_at?: number | null; fallback?: { active: boolean; since: number | null }; openrouter?: OrInfo; custom?: { on: boolean; model: string | null; fast?: string | null } };
type Deps = {
  api: ((path: string, body?: any) => Promise<any>) | null;   // null: design sandbox
  repaint: () => void;                                        // Settings, when this page or General is showing
  open: () => void;                                           // open Settings on this page
  note: (ok: boolean, title: string, sub: string) => void;
  who: () => string;                                          // the helper's name
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  icon: (k: string, s?: number) => string;
  shown: () => boolean;                                       // Settings is open on General or this page
  credits: () => void;                                        // Settings → Usage with Add credits open
  orStart: string | null;                                     // /w/<slug>/byok/openrouter/start (null: design sandbox)
};
let D: Deps | null = null;
// Custom Model Selection on this key (custom-models.ts): while it is on, General's first model answers, so the main model is shown as set there and not edited here.
// The same for the fast model (Background jobs there): it is read-only here while the setting is on.
const setFast = () => (B.st?.custom?.on && B.st.custom.fast ? B.st.custom.fast : "");
const setThere = () => (B.st?.custom?.on && B.st.custom.model ? B.st.custom.model : "");
const B: { st: St | null; loading: boolean; err: string; field: string; busy: "" | "test" | "save" | "del" | "or"; test: Test | null; edit: boolean; eye: boolean;
  f: { base: string; model: string; fast: string; ack: boolean }; key: string; ch: { busy: "" | Mode | "undo" | "now"; err: string; storage: boolean };
  manual: boolean; orErr: string; models: OrModel[] | null; mLoading: boolean; mErr: string } =
  { st: null, loading: false, err: "", field: "", busy: "", test: null, edit: false, eye: false, f: { base: "", model: "", fast: "", ack: false }, key: "", ch: { busy: "", err: "", storage: false },
    manual: false, orErr: "", models: null, mLoading: false, mErr: "" };
// Sign in with OpenRouter came back with an error (?orauth=err&orwhy=…): plain words for each reason the server gives.
export const OR_WHY: Record<string, string> = {
  cancelled: "OpenRouter sign-in was cancelled. Nothing was saved.",
  expired: "That OpenRouter sign-in took too long or was already used. Try again.",
  browser: "That OpenRouter sign-in didn't start in this browser. Try again from here.",
  exchange: "OpenRouter didn't accept the sign-in. Try again.",
  network: "Couldn't reach OpenRouter just now. Try again in a minute.",
  bad_key: "OpenRouter didn't send a key back. Try again.",
};
const OR_KEYS = "https://openrouter.ai/settings/keys";

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };
const dateText = (ms?: number | null) => ms ? new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "";
const ago = (ms: number | null) => { if (!ms) return ""; const m = Math.round((Date.now() - ms) / 60e3); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

// ---- sandbox: a pretend service that passes unless the address or key says otherwise ----
const QP = new URLSearchParams(location.search);
const MOCK_SAVED: Saved = { base: "https://api.openai.com/v1", host: "api.openai.com", model: "gpt-4.1-mini", fast: "", last4: "x7Qa", saved_at: Date.now() - 3 * 864e5, tested_at: Date.now() - 3 * 864e5,
  test: { ok: true, at: Date.now() - 3 * 864e5, checks: { reach: { ok: true, ms: 640 }, tools: { ok: true }, stream: { ok: true } } } };
const MOCK_RENEW = Date.now() + 18 * 864e5;
const MOCK_OR = "https://openrouter.ai/keys/3f2a9c";
const MOCK_OR_SAVED: Saved = { base: "https://openrouter.ai/api/v1", host: "openrouter.ai", model: "anthropic/claude-sonnet-4.5", fast: "openai/gpt-4.1-mini", last4: "9f3b", saved_at: Date.now() - 864e5, tested_at: Date.now() - 864e5, source: "openrouter",
  test: { ok: true, at: Date.now() - 864e5, checks: { reach: { ok: true, ms: 910 }, tools: { ok: true }, stream: { ok: true }, fast: { ok: true } } } };
const MOCK_MODELS: OrModel[] = [["anthropic/claude-haiku-4.5", "Anthropic: Claude Haiku 4.5", 200000, 1, 5], ["anthropic/claude-sonnet-4.5", "Anthropic: Claude Sonnet 4.5", 1000000, 3, 15],
  ["deepseek/deepseek-chat-v3.1", "DeepSeek: DeepSeek V3.1", 163840, 0.2, 0.8], ["google/gemini-2.5-flash", "Google: Gemini 2.5 Flash", 1048576, 0.3, 2.5], ["google/gemini-2.5-pro", "Google: Gemini 2.5 Pro", 1048576, 1.25, 10],
  ["meta-llama/llama-4-maverick", "Meta: Llama 4 Maverick", 1048576, 0.15, 0.6], ["meta-llama/llama-4-scout:free", "Meta: Llama 4 Scout (free)", 128000, 0, 0], ["mistralai/mistral-medium-3.1", "Mistral: Mistral Medium 3.1", 131072, 0.4, 2],
  ["moonshotai/kimi-k2", "MoonshotAI: Kimi K2", 131072, 0.5, 2.4], ["openai/gpt-4.1-mini", "OpenAI: GPT-4.1 Mini", 1047576, 0.4, 1.6], ["openai/gpt-5", "OpenAI: GPT-5", 400000, 1.25, 10],
  ["openai/gpt-5-mini", "OpenAI: GPT-5 Mini", 400000, 0.25, 2], ["qwen/qwen3-235b-a22b", "Qwen: Qwen3 235B A22B", 131072, 0.13, 0.6], ["x-ai/grok-4-fast", "xAI: Grok 4 Fast", 2000000, 0.2, 0.5],
  ["z-ai/glm-4.6", "Z.AI: GLM 4.6", 202752, 0.6, 2.2]].map(([id, name, ctx, i, o]) => ({ id, name, ctx, in: i, out: o } as OrModel));
let mockSt: St = QP.has("byokplan") ? { on_plan: true, full: false, plan_name: "Bring your own key", price: 10, saved: null, mode: "" }   // ?byokplan: pretend to be on the plan
  : { on_plan: false, full: true, plan_name: "Personal", price: 10, saved: QP.has("byoksaved") || QP.has("byokfb") || QP.has("byokswitch") ? MOCK_SAVED : null,
      mode: QP.has("byokfb") ? "fallback" : QP.has("byokswitch") ? "switch" : "", ...(QP.has("byokswitch") ? { switch_at: MOCK_RENEW } : {}),
      ...(QP.has("byokfb") ? { fallback: { active: true, since: Date.now() - 2 * 3600e3 } } : {}) };
if (QP.has("byokor")) mockSt.openrouter = { pending: { last4: "9f3b", at: Date.now() }, manage: MOCK_OR };
if (QP.has("byokorsaved")) { mockSt.saved = MOCK_OR_SAVED; mockSt.mode = mockSt.full ? "fallback" : ""; mockSt.openrouter = { pending: null, manage: MOCK_OR }; }
async function mock(path: string, body?: any): Promise<any> {
  await new Promise(z => setTimeout(z, path.endsWith("/test") || path.endsWith("/save") ? 900 : 250));
  if (path === "/byok") return mockSt;
  if (path === "/byok/models") return { models: MOCK_MODELS };
  if (path === "/byok/openrouter/forget") { mockSt = { ...mockSt, openrouter: { pending: null, manage: OR_KEYS } }; return { ok: true, ...mockSt }; }
  if (path === "/byok/delete") { mockSt = { ...mockSt, saved: null, openrouter: { pending: null, manage: OR_KEYS }, ...(body?.cancel_switch ? { mode: "" as Mode, switch_at: null } : mockSt.mode === "fallback" ? { mode: "" as Mode } : {}) }; return { ok: true, ...mockSt }; }
  if (path === "/byok/switch-preview") return mockSt.on_plan ? { error: "You're on the Bring your own key plan already." } : { ok: true, unused_nano: 14.2e9, unused: "$14.20", price: 10, next_bill_at: MOCK_RENEW };
  if (path === "/byok/switch-now") {
    if (QP.has("byokstorage")) return { error: "You're using 128 GB, and Bring your own key includes 100 GB. Delete files you don't need, or add 1 block of extra storage first.", storage: { used: 128e9, limit: 100e9, need: 1 } };
    mockSt = { ...mockSt, on_plan: true, full: false, plan_name: "Bring your own key", mode: "", switch_at: null, fallback: undefined }; sbCredits = "$" + (14.2 + 5).toFixed(2);
    return { ok: true, plan: "byok", moved_nano: 14.2e9, moved: "$14.20", next_bill_at: MOCK_RENEW };
  }
  if (path === "/byok/mode") {
    const m = String(body?.mode ?? "") as Mode;
    if (m === "switch" && QP.has("byokstorage")) return { error: "You're using 128 GB, and Bring your own key includes 100 GB. Delete files you don't need, or add 1 block of extra storage first.", storage: { used: 128e9, limit: 100e9, need: 1 } };
    mockSt = { ...mockSt, mode: m, switch_at: m === "switch" ? MOCK_RENEW : null, fallback: m === "fallback" ? { active: QP.has("byokfb"), since: null } : undefined };
    return { ok: true, ...mockSt };
  }
  const or = body?.source === "openrouter";
  if (or && !mockSt.openrouter?.pending && mockSt.saved?.source !== "openrouter") return { error: "Sign in with OpenRouter first.", field: "or" };
  const base = or ? "https://openrouter.ai/api/v1" : String(body?.base || "").trim(), host = hostOf(base), key = or ? "sk-or-v1-mock" : String(body?.key || "");
  if (!/^https:\/\//.test(base) || !host.includes(".")) return { error: "The address must start with https://.", field: "base" };
  if (!body?.model) return { error: "Enter the model name exactly as your service lists it, like gpt-4o-mini.", field: "model" };
  if (!key && !mockSt.saved) return { error: "Enter your key.", field: "key" };
  if (path === "/byok/save" && body.ack !== true) return { error: "Read the note about your provider and tick the box to save.", field: "ack" };
  const bad = /bad|wrong/.test(key), notools = /chat-only/.test(body.model);
  const test: Test = { ok: !bad && !notools, at: Date.now(), checks: bad ? { reach: { ok: false, error: `Your AI service (${host}) refused your key (error 401: Incorrect API key provided).` } }
    : { reach: { ok: true, ms: 640, model: body.model }, tools: notools ? { ok: false, error: "The model answered in words instead of calling a tool. 1Helm needs a model that supports tool (function) calling." } : { ok: true }, stream: { ok: true }, ...(body.fast && body.fast !== body.model ? { fast: { ok: true, model: body.fast } } : {}) } };
  if (path === "/byok/test") return { ok: test.ok, test };
  if (!test.ok) return { error: "Not saved: the connection test didn't pass. Fix what it says and try again.", test };
  mockSt = { ...mockSt, saved: { base: base.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, ""), host, model: body.model, fast: body.fast || "", last4: or ? (mockSt.openrouter?.pending?.last4 || mockSt.saved?.last4 || "9f3b") : key ? key.slice(-4) : mockSt.saved!.last4, saved_at: Date.now(), tested_at: Date.now(), test, ...(or ? { source: "openrouter" as const } : {}) },
    openrouter: { pending: null, manage: or ? MOCK_OR : OR_KEYS } };
  return { ok: true, test, ...mockSt };
}
let sbCredits = "$5.00";   // sandbox only: what the usage card says in credits after a pretend switch
/** Sandbox only (no 1HC): the pretend account is on the Bring your own key plan, so the usage card can say so. */
export const bykSbOn = () => !D?.api && !!B.st?.on_plan;
export const bykSbCredits = () => sbCredits;
const call = (path: string, body?: any) => (D?.api || mock)(path, body);

// The page's state from any /byok answer (GET, save, mode, delete all return it).
function stOf(d: any): St {
  const m: Mode = d.mode === "fallback" || d.mode === "switch" ? d.mode : "";
  return { on_plan: !!d.on_plan, full: d.full ?? !d.on_plan, plan_name: String(d.plan_name || ""), price: Number(d.price) || 10, saved: d.saved || null, mode: m,
    switch_at: d.switch_at ?? null, ...(d.fallback ? { fallback: { active: !!d.fallback.active, since: d.fallback.since ?? null } } : {}),
    openrouter: { pending: d.openrouter?.pending || null, manage: /^https:\/\/openrouter\.ai\//.test(String(d.openrouter?.manage || "")) ? d.openrouter.manage : OR_KEYS },
    ...(d.custom?.on ? { custom: { on: true, model: typeof d.custom.model === "string" ? d.custom.model : null, fast: typeof d.custom.fast === "string" ? d.custom.fast : null } } : {}) };
}
const planName = () => B.st?.plan_name || "your plan";
const fbOn = () => !!B.st && B.st.mode === "fallback" && !!B.st.fallback?.active;
export function bykLoad(force = false) {
  if (B.loading || (B.st && !force)) return;
  B.loading = true;
  call("/byok").then(d => { if (d && !d.error) B.st = stOf(d); else B.err = d?.error || ""; })
    .catch(() => { B.err = "Couldn't load your AI key settings. Check your connection and try again."; })
    .finally(() => { B.loading = false; if (D?.shown()) D.repaint(); });
}

// ---- General: the row ----
export function bykRow(): string {
  if (!D) return "";
  bykLoad();
  const s = B.st, sv = s?.saved;
  const use = !s || !sv || s.on_plan ? "" : fbOn() ? "in use: your 1Helm credits are used up" : s.mode === "fallback" ? "backup when your 1Helm credits run out"
    : s.mode === "switch" ? `the $10 plan from ${dateText(s.switch_at) || "your next bill"}` : "choose how to use it";
  const sub = !s ? "Checking…" : sv ? `${esc(sv.host)} · ${esc(setThere() || sv.model)}${use ? ` · ${esc(use)}` : ""}`
    : s.on_plan ? "Your plan uses your own key. Add it here." : s.mode === "switch" ? `Switching to the $10 plan on ${esc(dateText(s.switch_at) || "your next bill")}: add your key` : "Use your own AI service, as a backup or on the $10 plan";
  const val = !s ? "" : sv && s.on_plan ? "On" : s.on_plan ? "Needed" : fbOn() ? "In use" : sv && s.mode === "fallback" ? "Backup" : s.mode === "switch" ? (sv ? "Switching" : "Needed") : sv ? "Saved" : "Off";
  return D.srow(D.icon("spark"), BYK_TITLE, sub, `${val ? `<span class="sval${val === "Needed" ? " bykneed" : val === "In use" ? " bykon" : ""}">${val}</span>` : ""}<span class="schev">${D.icon("chev", 16)}</span>`, ` role="button" tabindex="0" data-sgo="${BYK_SEC}" data-bykrow`);
}

// ---- Usage: which AI is in use, and a pending switch (Captain 10-06: "Using your own AI key (1Helm credits used up)") ----
export function bykUsageNote(): string {
  if (!D) return "";
  bykLoad();
  const s = B.st; if (!s || !s.full) return "";
  if (fbOn()) return `<p class="bykuse on" role="status"><i aria-hidden="true"></i>Using your own AI key (1Helm credits used up)</p>`;
  if (s.mode === "switch") return `<div class="bykuse bykpend" role="status"><span>Switching to Use your own AI key on ${esc(dateText(s.switch_at) || "your next bill")}</span><span class="bykswbtns"><button type="button" class="sa blue" data-bykswitchnow${B.ch.busy ? " disabled" : ""}>${B.ch.busy === "now" ? "One moment…" : "Switch now"}</button><button type="button" class="sa blue" data-bykundo${B.ch.busy ? " disabled" : ""}>${B.ch.busy === "undo" ? "One moment…" : "Undo"}</button></span></div>`;
  return "";
}

// ---- the page ----
const field = (id: string, label: string, val: string, ph: string, hint = "", attrs = "") => `<label class="sf${B.field === id ? " bykbad" : ""}"><span>${label}</span><input id="byk-${id}" data-bykf="${id}" value="${esc(val)}" placeholder="${esc(ph)}" autocomplete="off" autocapitalize="none" spellcheck="false"${attrs}>${hint ? `<em class="bykhint">${hint}</em>` : ""}${B.field === id && B.err ? `<em class="bykerr" role="alert">${esc(B.err)}</em>` : ""}</label>`;
const CHECKS: [keyof Test["checks"], string][] = [["reach", "Reaches the service"], ["tools", "Tool calling works"], ["stream", "Streams its answers"], ["fast", "Fast model answers"]];
function testHtml(t: Test | null, compact = false): string {
  if (!t) return "";
  const rows = CHECKS.filter(([k]) => t.checks[k]).map(([k, l]) => { const c = t.checks[k]!;
    return `<li class="${c.ok ? "ok" : "no"}"><span class="bykdot">${c.ok ? D!.icon("check", 13) : D!.icon("x", 13)}</span><span><b>${l}</b>${c.ok ? (k === "reach" && c.ms ? ` <i>${(c.ms / 1000).toFixed(1)} s</i>` : "") : c.error ? `<span class="bykwhy">${esc(c.error)}</span>` : ""}</span></li>`; }).join("");
  return `<div class="byktest ${t.ok ? "pass" : "fail"}${compact ? " small" : ""}" role="status"><div class="byktt">${t.ok ? "Connection works" : "Connection test didn't pass"}${t.at ? `<i>${ago(t.at)}</i>` : ""}</div><ul>${rows}</ul></div>`;
}
const setFastNote = () => `<div class="sf bykset"><span>Fast model</span><p class="sfine">${esc(setFast())}, set in Custom Model Selection.</p></div>`;
const setNote = (who: string) => `<div class="sf bykset"><span>Model</span><p class="sfine">${esc(setThere())}, set in Settings, Advanced, Custom Model Selection. ${esc(who)} uses it as the main model.</p></div>`;
// ---- Sign in with OpenRouter: the model fields (a searchable list + free typing) and the boxes around the form ----
const ctxText = (n: number) => !n ? "" : n >= 1e6 ? `${Math.round(n / 1e5) / 10}M context` : `${Math.round(n / 1000)}K context`;
const priceText = (m: OrModel) => m.in === 0 && m.out === 0 ? "free" : m.in != null && m.out != null ? `$${m.in} in / $${m.out} out per 1M` : "";
const combo = (id: "model" | "fast", label: string, val: string, ph: string, hint: string) => `<label class="sf bykcombo${B.field === id ? " bykbad" : ""}"><span>${label}</span>
  <input id="byk-${id}" data-bykf="${id}" data-bykcombo role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="byk-${id}-list" value="${esc(val)}" placeholder="${esc(ph)}" autocomplete="off" autocapitalize="none" spellcheck="false">
  <ul class="bykml" id="byk-${id}-list" role="listbox" aria-label="OpenRouter models" hidden></ul>${hint ? `<em class="bykhint">${hint}</em>` : ""}${B.field === id && B.err ? `<em class="bykerr" role="alert">${esc(B.err)}</em>` : ""}</label>`;
const orManage = () => esc(B.st?.openrouter?.manage || OR_KEYS);
const orRevoke = () => `To cancel the key itself, delete it in <a href="${orManage()}" target="_blank" rel="noopener noreferrer">your OpenRouter account</a>.`;
// Above the manual form: the one-tap way. A failed sign-in says why here.
function orBox(): string {
  return `<div class="sc bykorbox"><div class="bykorrow"><span class="bykort"><b>Use OpenRouter</b><span>Sign in instead of copying an address and key, then just pick your models. OpenRouter bills you for the AI.</span></span>
    <button type="button" class="sprim bykorbtn" data-bykor${B.busy ? " disabled" : ""}>Sign in with OpenRouter</button></div>
    ${B.orErr ? `<p class="bykerr bykorerr" role="alert">${esc(B.orErr)}</p>` : ""}</div>
    <p class="bykorsep">Or use any service with an OpenAI-compatible API:</p>`;
}
const orMode = () => { const s = B.st; return !!s && !B.manual && (!!s.openrouter?.pending || (s.saved?.source === "openrouter" && B.edit)); };

export function bykPage(): string {
  if (!D) return "";
  bykLoad();
  const who = esc(D.who()), s = B.st;
  const head = `<h2>${BYK_TITLE}</h2><p class="slead">Use your own AI service, from any provider with an OpenAI-compatible API. ${s?.full ? `On ${esc(planName())}, it can be a backup for when your 1Helm credits run out, or you can switch to the $10 plan that runs on it.` : `${who} sends its AI work there with your key and your models, so your provider bills you for the AI and 1Helm charges nothing for it.`}</p>`;
  if (!s) return `${head}<div class="sc">${D.srow(B.err ? "" : `<span class="bico"><i class="apspin"></i></span>`, B.err ? "Couldn't load" : "Loading…", B.err ? esc(B.err) : "", B.err ? `<button class="sa blue" data-bykretry>Try again</button>` : "")}</div>`;
  const sv = s.saved, pend = s.openrouter?.pending || null, orSaved = sv?.source === "openrouter", orOn = orMode();
  const editing = !sv || B.edit || !!pend, plan = esc(planName());
  const top = s.on_plan ? (sv ? "" : `<div class="bykplan need">${D.icon("help", 16)}<span>You're on the Bring your own key plan, so ${who} needs your key to answer. Add it below.</span></div>`)
    : s.mode === "switch" ? switchBanner(sv)
    : fbOn() ? `<div class="bykplan bykfb">${D.icon("spark", 16)}<span><b>${esc(FALLBACK_NOTE)}</b>${who} is using your key for chat until your credits refill: when ${plan} renews, or when you add credits. The computer, browser, web search and memory need 1Helm credits, so they're paused until then.</span><button class="sa blue" data-bykcredits>Add credits</button></div>`
    : sv ? "" : `<div class="bykplan">${D.icon("spark", 16)}<span><b>Two ways to use it on ${plan}</b>Add your key below, then choose: keep ${plan} and use your key only when your 1Helm credits run out, or switch now to the $${s.price} plan with your key.</span></div>`;
  const status = s.on_plan ? `<span class="sok">${D.icon("check", 14)}In use</span>` : fbOn() ? `<span class="sok">${D.icon("check", 14)}In use</span>`
    : s.mode === "fallback" ? `<span class="sval">Backup</span>` : s.mode === "switch" ? `<span class="sval">From ${esc(dateText(s.switch_at) || "next bill")}</span>` : `<span class="sval">Not in use yet</span>`;
  const savedCard = sv && !editing ? `<div class="sc">
      ${D.srow(D.icon("spark"), orSaved ? "OpenRouter" : esc(sv.host), `${esc(setThere() || sv.model)}${setFast() ? (setFast() !== (setThere() || sv.model) ? ` · fast: ${esc(setFast())}` : "") : sv.fast && sv.fast !== sv.model ? ` · fast: ${esc(sv.fast)}` : ""}`, status)}
      ${D.srow(D.icon("key"), orSaved ? "Connected to OpenRouter" : "Key", `${orSaved ? "Signed in with OpenRouter · " : ""}<span class="bykmask">••••${esc(sv.last4)}</span>${sv.saved_at ? ` · saved ${ago(sv.saved_at)}` : ""}`, "")}
      ${testHtml(B.test || sv.test, true)}
      <div class="sfoot bykacts"><button class="sa blue" data-byktest${B.busy ? " disabled" : ""}>${B.busy === "test" ? "Testing…" : "Test connection"}</button><button class="sa blue" data-bykedit${B.busy ? " disabled" : ""}>${orSaved ? "Change models" : "Change"}</button><button class="sa mute" data-bykrm${B.busy ? " disabled" : ""}>${B.busy === "del" ? (orSaved ? "Disconnecting…" : "Removing…") : orSaved ? "Disconnect" : "Remove"}</button></div></div>
      ${orSaved ? `<p class="sfine bykorfine">${orRevoke()}</p>` : ""}` : "";
  const keyPh = sv && !orSaved ? `Leave empty to keep ••••${sv.last4}` : "sk-…";
  const warn = `<div class="bykwarn${B.field === "ack" ? " bykbad" : ""}">${D.icon("help", 16)}<div><p>${esc(BYK_WARN)}</p>${s.full ? `<p class="bykterms">${esc(BYK_ZDR_FULL)}</p>` : ""}<p class="bykterms">${esc(BYK_TERMS)}</p>
        <label class="bykack"><input type="checkbox" data-bykack${B.f.ack ? " checked" : ""}><span>I understand</span></label>${B.field === "ack" && B.err ? `<em class="bykerr" role="alert">${esc(B.err)}</em>` : ""}</div></div>`;
  const btns = (cancel: boolean) => `<div class="sbtns"><button class="sprim" type="submit"${B.busy || !B.f.ack ? " disabled" : ""}>${B.busy === "save" ? "Testing and saving…" : "Save"}</button><button type="button" class="sa blue" data-byktest${B.busy ? " disabled" : ""}>${B.busy === "test" ? "Testing…" : "Test connection"}</button>${cancel ? `<button type="button" class="sa" data-bykcancel>Cancel</button>` : ""}</div>`;
  // On the way to OpenRouter: no form on the page (nothing "unsaved" to ask about while the page leaves).
  if (B.busy === "or") return `${head}${top}<div class="sc">${D.srow(`<span class="bico"><i class="apspin"></i></span>`, "Opening OpenRouter…", "Sign in there. You come back here to pick your models.", "")}</div>`;
  // Signed in with OpenRouter: only the models (and the same warning) are left to fill in.
  const orLast4 = pend?.last4 || (orSaved ? sv!.last4 : "");
  const orForm = orOn ? `<form class="sc sform" id="bykf" novalidate data-unsaved="byok" data-unsaved-key="or"><div class="sfh">${D.icon("spark")}<b>${pend ? "Pick your models" : "Change your models"}</b></div>
      <div class="bykorcon" role="status"><span class="bykdot">${D.icon("check", 13)}</span><span class="bykort"><b>Connected to OpenRouter</b><span>Key <span class="bykmask">••••${esc(orLast4)}</span>, made for 1Helm in your OpenRouter account</span></span><button type="button" class="sa mute" data-bykordis${B.busy ? " disabled" : ""}>${B.busy === "del" ? "Disconnecting…" : "Disconnect"}</button></div>
      ${B.field === "or" && B.err ? `<p class="bykerr" role="alert">${esc(B.err)}</p>` : ""}
      ${setThere() ? setNote(who) : combo("model", "Model", B.f.model, "Search, or type a model name", `${who}'s main model. The list shows OpenRouter's models that can call tools, which ${who} needs.`)}
      ${setFast() ? setFastNote() : combo("fast", "Fast model (optional)", B.f.fast, "Same as the main model", "For small jobs like task titles and hand-off notes. Leave it empty to use the main model.")}
      ${warn}
      ${B.err && !B.field ? `<p class="bykerr" role="alert">${esc(B.err)}</p>` : ""}
      ${testHtml(B.test)}
      ${btns(!!sv)}
      <p class="bykorfine">${orRevoke()} <button type="button" class="bykorlink" data-bykmanual>Use a different AI service instead</button></p>
    </form>` : "";
  const form = editing && orOn ? orForm : editing ? `${orBox()}<form class="sc sform" id="bykf" novalidate data-unsaved="byok"><div class="sfh">${D.icon("spark")}<b>${sv && !orSaved ? "Change your AI service" : "Your AI service"}</b></div>
      ${field("base", "Service address", B.f.base, "https://api.openai.com/v1", "The address that ends before /chat/completions.", ' inputmode="url"')}
      <label class="sf${B.field === "key" ? " bykbad" : ""}"><span>Key</span><span class="spw"><input id="byk-key" data-bykf="key" type="${B.eye ? "text" : "password"}" placeholder="${esc(keyPh)}" autocomplete="new-password" autocapitalize="none" spellcheck="false"><button type="button" class="seye${B.eye ? " on" : ""}" data-bykeye aria-label="Show key">${D.icon("eye", 17)}</button></span>${B.field === "key" && B.err ? `<em class="bykerr" role="alert">${esc(B.err)}</em>` : ""}</label>
      ${setThere() ? setNote(who) : field("model", "Model", B.f.model, "gpt-4o-mini", `${who}'s main model. It must support tool calling.`)}
      ${setFast() ? setFastNote() : field("fast", "Fast model (optional)", B.f.fast, "Same as the main model", "For small jobs like task titles and hand-off notes. Leave it empty to use the main model.")}
      ${warn}
      ${B.err && !B.field ? `<p class="bykerr" role="alert">${esc(B.err)}</p>` : ""}
      ${testHtml(B.test)}
      ${btns(!!sv)}
    </form>` : "";
  return `${head}${top}${savedCard}${form}${s.full && sv && !editing ? choiceHtml() : ""}
    <p class="sfine">Save runs the connection test first. If your service stops working, ${who} says so in the task and points you here; ${s.full ? "while your key is in use, " : ""}1Helm never switches to its own AI instead. The key is stored encrypted and can't be shown again, only its last 4 characters.</p>`;
}
// A full plan with a switch to the $10 plan pending (made here or in Change plan).
function switchBanner(sv: Saved | null): string {
  const plan = esc(planName()), when = esc(dateText(B.st?.switch_at) || "your next bill");
  return `<div class="bykplan bykswitch" role="status">${D!.icon("clock", 16)}<span><b>Switching to Use your own AI key on ${when}</b>You keep ${plan} until then. From then on it's $${B.st?.price || 10}/month with 100 GB of storage, ${esc(D!.who())} runs on your key, and credits you add pay for the computer, browser and memory.${sv ? "" : ` <em class="bykneedt">Add your key before then, or ${esc(D!.who())} can't answer after the switch.</em>`}</span><span class="bykswbtns"><button class="sa blue" data-bykswitchnow${B.ch.busy ? " disabled" : ""}>${B.ch.busy === "now" ? "One moment…" : "Switch now"}</button><button class="sa blue" data-bykundo${B.ch.busy ? " disabled" : ""} aria-label="Undo: keep ${plan}">${B.ch.busy === "undo" ? "One moment…" : "Undo"}</button></span></div>`;
}
// The two options (a full plan with a saved key).
function choiceHtml(): string {
  const s = B.st!, who = esc(D!.who()), plan = esc(planName()), when = esc(dateText(s.switch_at) || "the end of this billing period");
  const opt = (m: Mode, title: string, sub: string) => { const on = s.mode === m, busy = B.ch.busy === m;
    return `<button type="button" class="sr sradio bykopt${on ? " on" : ""}" role="radio" aria-checked="${on}" data-bykmode="${m}"${B.ch.busy ? " disabled" : ""}><span class="srt"><b>${title}</b><span>${sub}</span></span><span class="rck">${busy ? `<i class="apspin"></i>` : D!.icon("check", 18)}</span></button>`; };
  return `<h3 class="bykh">How ${who} uses your key</h3>${s.mode ? "" : `<p class="bykpick">Your key is saved but not in use yet. Choose one:</p>`}
    <div class="sc bykopts" role="group" aria-label="How ${who} uses your key">
      ${opt("fallback", `Keep my plan, use my key as a backup`, `${who} uses your ${plan} credits first, as now. If they run out before your plan renews, chat switches to your key on its own until they refill. The computer, browser, web search and memory still need 1Helm credits, so they pause until then; plain chat keeps working.`)}
      <button type="button" class="sr sradio bykopt" role="button" data-bykswitchnow${B.ch.busy ? " disabled" : ""}><span class="srt"><b>Switch now to the $${s.price} plan with my key</b><span>Your plan changes now. It's $${s.price}/month with 100 GB of storage, ${who} runs on your key, and credits you add pay for the computer, browser and memory (cost + 15%). Your unused ${plan} usage becomes credits.</span></span><span class="rck">${B.ch.busy === "now" ? `<i class="apspin"></i>` : ""}</span></button>
      ${B.ch.err ? `<div class="bykcherr" role="alert"><p>${esc(B.ch.err)}</p>${B.ch.storage ? `<button type="button" class="sa blue" data-stnadd>Add storage</button>` : ""}</div>` : ""}
    </div>
    <p class="sfine bykzdr">${esc(BYK_ZDR_OPTS)}</p>`;
}
// For the "Save your AI key settings?" prompt (unsaved.ts, wired in v3.ts): the form is showing, a save/test is running, and Discard.
export const bykEditing = () => !!B.st && B.busy !== "or" && (!B.st.saved || B.edit || !!B.st.openrouter?.pending);
export const bykBusy = () => !!B.busy;
export function bykDiscard() { startEdit(); B.edit = false; }   // back to the saved values (or empty), key cleared
// After every Settings paint: the typed key goes back into its field (it's never written into the HTML).
export function bykAfter() { const k = document.getElementById("byk-key") as HTMLInputElement | null; if (k && B.key && k.value !== B.key) k.value = B.key; }

function startEdit() {
  const sv = B.st?.saved, or = sv?.source === "openrouter";
  B.edit = true; B.err = B.field = ""; B.test = null; B.key = ""; B.eye = false;
  // Switching from OpenRouter to a typed service starts from an empty address (its key isn't offered for another one).
  B.f = { base: or && B.manual ? "" : sv?.base || "", model: setThere() || (or && B.manual ? "" : sv?.model || ""), fast: !(or && B.manual) && sv?.fast && sv.fast !== sv.model ? sv.fast : "", ack: false };
}
const body = () => orMode() ? { source: "openrouter", model: B.f.model.trim(), fast: B.f.fast.trim() } : { base: B.f.base.trim(), model: B.f.model.trim(), fast: B.f.fast.trim(), key: B.key.trim() };
function test() {
  if (B.busy) return;
  const sv = B.st?.saved, editing = bykEditing();
  const b = editing ? body() : sv!.source === "openrouter" ? { source: "openrouter", model: sv!.model, fast: sv!.fast } : { base: sv!.base, model: sv!.model, fast: sv!.fast, key: "" };
  B.busy = "test"; B.err = B.field = ""; B.test = null; D?.repaint();
  call("/byok/test", b).then(d => {
    if (d.test) { B.test = d.test; if (!editing && B.st?.saved) B.st.saved.test = d.test; }
    else { B.err = d.error || "Couldn't test the connection. Try again in a minute."; B.field = d.field || ""; }
  }).catch(() => { B.err = "Couldn't test the connection. Check your internet and try again."; })
    .finally(() => { B.busy = ""; D?.repaint(); });
}
function save() {
  if (B.busy) return;
  if (!B.f.ack) { B.err = "Read the note about your provider and tick the box to save."; B.field = "ack"; D?.repaint(); return; }
  B.busy = "save"; B.err = B.field = ""; B.test = null; D?.repaint();
  call("/byok/save", { ...body(), ack: true }).then(d => {
    if (d.ok && d.saved) { B.st = "on_plan" in d ? stOf(d) : { ...B.st!, saved: d.saved }; B.edit = false; B.manual = false; B.key = ""; B.test = d.test || null; B.f.ack = false;
      const st = B.st!;
      D?.note(true, d.saved.source === "openrouter" ? "OpenRouter is set up" : "AI key saved", st.on_plan ? `${D.who()} uses ${d.saved.model} on ${d.saved.source === "openrouter" ? "OpenRouter" : d.saved.host} from your next message.` : st.mode === "fallback" ? `${D.who()} uses it only if your 1Helm credits run out.`
        : st.mode === "switch" ? `It's used from ${dateText(st.switch_at) || "your next bill"}, when you switch to the $10 plan.` : "Now choose how to use it, below.");
      if (st.full && !st.mode) setTimeout(() => document.querySelector(".bykopts")?.scrollIntoView({ block: "center", behavior: "smooth" }), 80); }
    else { B.err = d.error || "Couldn't save. Try again in a minute."; B.field = d.field || ""; if (d.test) B.test = d.test; }
  }).catch(() => { B.err = "Couldn't save. Check your internet and try again."; })
    .finally(() => { B.busy = ""; D?.repaint(); });
}
function remove() {
  if (B.busy || !B.st?.saved) return;
  const st = B.st, who = D!.who(), or = st.saved!.source === "openrouter";
  const T = or ? { title: "Disconnect OpenRouter?", gone: "1Helm forgets the key. To cancel it at OpenRouter too, delete it in your OpenRouter account.", btn: "Disconnect", done: "OpenRouter disconnected" }
    : { title: "Remove your AI key?", gone: "It's deleted from 1Helm. You can add it again any time.", btn: "Remove", done: "AI key removed" };
  // A switch to the $10 plan pending: ask whether it goes too (without a key the helper can't answer after it).
  const q: Promise<"ok" | "alt" | "no"> = st.full && st.mode === "switch"
    ? choose({ title: T.title, body: `You're switching to the $10 plan with your own key on ${dateText(st.switch_at) || "your next bill"}. Without a key, ${who} can't answer after that. Cancel the switch too and keep ${planName()}?`, confirm: `Remove and keep ${planName()}`, alt: "Remove, keep the switch" })
    : ask({ title: T.title, body: st.on_plan ? `You're on the Bring your own key plan, so ${who} can't answer until you add a key again or change plan.${or ? ` ${T.gone}` : ""}`
        : st.mode === "fallback" ? `${who} stops using it as a backup. If your 1Helm credits run out, ${who} pauses until they refill or you add more.${or ? ` ${T.gone}` : ""}` : T.gone, confirm: T.btn, danger: true }).then(ok => ok ? "ok" : "no");
  q.then(pick => {
    if (pick === "no" || B.busy) return;
    const cancel = st.full && st.mode === "switch" && pick === "ok";
    B.busy = "del"; D?.repaint();
    call("/byok/delete", cancel ? { cancel_switch: true } : {}).then(d => { if (d.error) throw new Error(d.error); B.st = "on_plan" in d ? stOf(d) : { ...B.st!, saved: null }; B.test = null; B.edit = false; startEdit(); B.edit = false; B.ch.err = ""; B.ch.storage = false;
      D?.note(true, T.done, cancel ? `It's deleted from 1Helm, and you're keeping ${planName()}.` : B.st?.mode === "switch" ? `It's deleted from 1Helm. Add a key before ${dateText(B.st.switch_at) || "your next bill"}.` : "It's deleted from 1Helm."); })
      .catch(e => D?.note(false, "Couldn't remove the key", e?.message || "Try again in a minute.")).finally(() => { B.busy = ""; D?.repaint(); });
  });
}
// Pick (or change, or undo) the option on a full plan. Undo = "" (keep my plan; the key stays saved, not in use until chosen again).
async function pickMode(m: Mode | "undo") {
  const st = B.st; if (!st || !st.full || B.ch.busy) return;
  const mode: Mode = m === "undo" ? "" : m, who = D!.who(), plan = planName();
  if (mode === st.mode) return;
  const ok = mode === "switch" ? await ask({ title: `Switch to the $${st.price} plan with your key?`, body: `You keep ${plan} until the end of this billing period. Then it's $${st.price}/month with 100 GB of storage and ${who} runs on your key; credits you add pay for the computer, browser and memory. Nothing is charged now, and you can undo it until then. From that day, 1Helm's zero-data-retention guarantee doesn't cover the AI part.`, confirm: "Switch at renewal" })
    : st.mode === "switch" ? await ask({ title: `Keep ${plan}?`, body: `Your switch to the $${st.price} plan is cancelled. Nothing is charged.${mode === "fallback" ? ` Your key becomes a backup for when your 1Helm credits run out.` : " Your key stays saved; choose how to use it any time."}`, confirm: `Keep ${plan}` })
    : true;
  if (!ok) return;
  B.ch = { busy: m, err: "", storage: false }; D?.repaint();
  try {
    const d = await call("/byok/mode", { mode });
    if (d?.error) { B.ch.err = d.error; B.ch.storage = !!d.storage; if (m === "undo") D?.note(false, "Your plan didn't change", d.error); }
    else {
      B.st = stOf(d);
      if (mode === "switch") D?.note(true, `Switching on ${dateText(B.st.switch_at) || "your next bill"}`, `You keep ${plan} until then. Nothing was charged.`);
      else if (mode === "fallback") D?.note(true, "Your key is your backup", `${who} uses your 1Helm credits first and switches to your key only if they run out.`);
      else D?.note(true, `You're keeping ${plan}`, "Nothing changed on your bill.");
    }
  } catch { B.ch.err = "Couldn't change that. Check your internet and try again."; }
  B.ch.busy = ""; D?.repaint();
}
// Switch now: the plan changes at once and the unused plan usage becomes credits. Used by this page, the usage note and Change plan (storage.ts).
export async function bykSwitchNow() {
  if (!D || B.ch.busy) return;
  const end = (err = "", storage = false) => { B.ch = { busy: "", err, storage }; D?.repaint(); };
  B.ch = { busy: "now", err: "", storage: false }; D.repaint();
  try {
    if (!B.st) { const d0 = await call("/byok"); if (d0 && !d0.error) B.st = stOf(d0); }
    const st = B.st; if (!st) return end("Couldn't load your AI key settings. Try again in a minute.");
    if (!st.full) return end();
    if (!st.saved) { end(); D.note(false, "Add your AI key first", "Save it in Use my own AI key, then switch."); D.open(); return; }
    const pv = await call("/byok/switch-preview");
    if (!pv || pv.error) { end(pv?.error || ""); D.note(false, "Your plan didn't change", pv?.error || "Try again in a minute."); return; }
    const plan = planName(), when = dateText(pv.next_bill_at) || "your next bill date";
    const ok = await ask({ title: `Switch to the $${pv.price} plan now?`, body: `Your plan changes now. ${Number(pv.unused_nano) > 0 ? `${pv.unused} of unused ${plan} usage becomes credits.` : `You have no unused ${plan} usage to move to credits.`} Your next bill is $${pv.price} on ${when}. There's no refund.`, confirm: "Switch now" });
    if (!ok) return end();
    const d = await call("/byok/switch-now", {});
    if (d?.error) { end(d.error, !!d.storage); D.note(false, "Your plan didn't change", d.error); return; }
    if (D.api) { location.assign(`${location.pathname}?plan=byok&moved=${encodeURIComponent(String(d.moved || ""))}&bill=${encodeURIComponent(String(d.next_bill_at || ""))}${location.hash}`); return; }   // the app reloads so the plan, usage and storage are the new ones
    B.st = stOf(await call("/byok")); end();
    D.note(true, "You're on the Bring your own key plan", `${d.moved} of unused usage is now credits.`);
  } catch { end("Couldn't change that. Check your internet and try again."); }
}
// ---- Sign in with OpenRouter ----
function orSignIn() {
  if (B.busy) return;
  B.busy = "or"; B.orErr = ""; B.err = B.field = ""; D?.repaint();   // the form goes first (nothing left to call unsaved), then the page leaves
  if (D?.orStart) { const to = D.orStart; setTimeout(() => location.assign(to), 40); return; }
  setTimeout(() => {   // sandbox: OpenRouter said yes
    mockSt = { ...mockSt, openrouter: { pending: { last4: "9f3b", at: Date.now() }, manage: MOCK_OR } };
    B.busy = ""; B.st = stOf(mockSt); B.manual = false; startEdit(); B.edit = !!B.st.saved && B.st.saved.source === "openrouter";
    D?.note(true, "Connected to OpenRouter", "Now pick your models."); D?.repaint();
  }, 700);
}
// Disconnect in the models form: a key still waiting for its models is just forgotten; a saved OpenRouter setup goes the Remove way.
async function orDisconnect() {
  if (B.busy || !B.st) return;
  if (!B.st.openrouter?.pending) { remove(); return; }
  const ok = await ask({ title: "Disconnect OpenRouter?", body: `1Helm forgets the key OpenRouter made for it.${B.st.saved ? " Your current AI service setup stays as it is." : ""} To cancel the key at OpenRouter too, delete it in your OpenRouter account.`, confirm: "Disconnect", danger: true });
  if (!ok) return;
  B.busy = "del"; D?.repaint();
  try { const d = await call("/byok/openrouter/forget", {}); if (d?.error) throw new Error(d.error); B.st = stOf(d); B.edit = false; startEdit(); B.edit = false; B.test = null; D?.note(true, "OpenRouter disconnected", "1Helm forgot the key."); }
  catch (e: any) { D?.note(false, "Couldn't disconnect", e?.message || "Try again in a minute."); }
  B.busy = ""; D?.repaint();
}
// "Use a different AI service instead": a waiting OpenRouter key is forgotten; the address + key form shows.
async function orManual() {
  if (B.busy || !B.st) return;
  if (B.st.openrouter?.pending) {
    B.busy = "del"; D?.repaint();
    try { const d = await call("/byok/openrouter/forget", {}); if (d?.error) throw new Error(d.error); B.st = stOf(d); }
    catch (e: any) { B.busy = ""; D?.note(false, "Couldn't switch", e?.message || "Try again in a minute."); D?.repaint(); return; }
    B.busy = "";
  }
  B.manual = true; startEdit(); B.edit = true; D?.repaint(); (document.getElementById("byk-base") as HTMLInputElement | null)?.focus();
}
// The model list (OpenRouter's, through 1HC): loaded once per visit, on the first focus of a model field.
function loadModels() {
  if (B.models || B.mLoading) return;
  B.mLoading = true;
  call("/byok/models").then(d => { B.models = Array.isArray(d?.models) ? d.models : []; B.mErr = d?.error || (B.models!.length ? "" : "Couldn't load OpenRouter's model list. You can still type a model name."); })
    .catch(() => { B.models = []; B.mErr = "Couldn't load OpenRouter's model list. You can still type a model name."; })
    .finally(() => { B.mLoading = false; const a = document.activeElement as HTMLInputElement | null; if (a?.matches?.("[data-bykcombo]")) comboShow(a); });
}
const CB: { id: string; act: number; items: OrModel[] } = { id: "", act: -1, items: [] };
function comboShow(inp: HTMLInputElement) {
  const ul = document.getElementById(`${inp.id}-list`); if (!ul) return;
  loadModels();
  const toks = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean), all = B.models || [];
  const items = (toks.length ? all.filter(m => { const h = `${m.id} ${m.name}`.toLowerCase(); return toks.every(t => h.includes(t)); }) : all).slice(0, 80);
  CB.id = inp.id; CB.act = -1; CB.items = items;
  ul.innerHTML = !B.models ? `<li class="bykmnote">Loading OpenRouter's models…</li>` : !items.length ? `<li class="bykmnote">${esc(B.mErr || "No match in OpenRouter's list. You can still use the name you typed.")}</li>`
    : items.map((m, i) => { const meta = [ctxText(m.ctx), priceText(m)].filter(Boolean).join(" · ");
        return `<li role="option" id="${inp.id}-o${i}" data-bykm="${esc(m.id)}" aria-selected="false"><b>${esc(m.name)}</b><span><code>${esc(m.id)}</code>${meta ? ` · ${esc(meta)}` : ""}</span></li>`; }).join("");
  ul.hidden = false; inp.setAttribute("aria-expanded", "true"); inp.removeAttribute("aria-activedescendant");
}
function comboHide(id = CB.id) {
  const ul = id ? document.getElementById(`${id}-list`) : null; if (ul) { ul.hidden = true; ul.innerHTML = ""; }
  const inp = id ? document.getElementById(id) : null; inp?.setAttribute("aria-expanded", "false"); inp?.removeAttribute("aria-activedescendant");
  if (id === CB.id) { CB.id = ""; CB.act = -1; CB.items = []; }
}
function comboPick(inp: HTMLInputElement, id: string) {
  inp.value = id; const k = inp.dataset.bykf as "model" | "fast"; B.f[k] = id;
  if (B.field === k) { B.field = ""; B.err = ""; inp.closest(".sf")?.classList.remove("bykbad"); inp.closest(".sf")?.querySelector(".bykerr")?.remove(); }
  comboHide(inp.id);
}
function comboMove(inp: HTMLInputElement, d: number) {
  const ul = document.getElementById(`${inp.id}-list`); if (!ul || ul.hidden) { comboShow(inp); return; }
  if (!CB.items.length) return;
  CB.act = (CB.act + d + CB.items.length) % CB.items.length;
  ul.querySelectorAll<HTMLElement>("[data-bykm]").forEach((li, i) => li.setAttribute("aria-selected", String(i === CB.act)));
  const li = document.getElementById(`${inp.id}-o${CB.act}`); li?.scrollIntoView({ block: "nearest" }); inp.setAttribute("aria-activedescendant", `${inp.id}-o${CB.act}`);
}

// The stream said this account just started using its backup key (byok_switch): the usage note and this page follow at once.
export function bykSwitched() {
  if (B.st?.full && B.st.mode === "fallback") B.st.fallback = { active: true, since: Date.now() }; else if (!B.loading) { B.st = null; bykLoad(true); }
  if (D?.shown()) D.repaint();
}

export function bykInit(d: Deps) {
  D = d;
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    // A link to Settings → Use my own AI key (a reply about a failing AI service): open it here, no page load.
    const a = t.closest?.<HTMLAnchorElement>('a[href*="settings=byok"]');
    if (a) { try { const u = new URL(a.href, location.href); if (u.origin === location.origin) { e.preventDefault(); e.stopPropagation(); B.st = null; D?.open(); return; } } catch {} }
    // Add credits (the line under a reply when the computer, browser or web search paused for credits): Settings → Usage, Add credits open.
    const c = t.closest?.<HTMLAnchorElement>('a[href*="settings=credits"]');
    if (c) { try { const u = new URL(c.href, location.href); if (u.origin === location.origin) { e.preventDefault(); e.stopPropagation(); D?.credits(); return; } } catch {} }
    if (t.closest("[data-bykrow]")) { B.st = null; B.edit = false; B.manual = false; B.orErr = ""; B.test = null; B.err = B.field = ""; B.ch = { busy: "", err: "", storage: false }; }   // fresh state when the page opens (v3 handles data-sgo)
    const mb = t.closest<HTMLElement>("[data-bykmode]"); if (mb) { e.preventDefault(); pickMode(mb.dataset.bykmode as Mode); return; }
    if (t.closest("[data-bykswitchnow]")) { e.preventDefault(); bykSwitchNow(); return; }
    if (t.closest("[data-bykundo]")) { e.preventDefault(); pickMode("undo"); return; }
    if (t.closest("[data-bykcredits]")) { e.preventDefault(); D?.credits(); return; }
    if (t.closest("[data-byktest]")) { e.preventDefault(); test(); return; }
    if (t.closest("[data-bykedit]")) { startEdit(); D?.repaint(); (document.getElementById("byk-base") as HTMLInputElement | null)?.focus(); return; }
    if (t.closest("[data-bykcancel]")) { if (B.st?.openrouter?.pending && !B.manual) { orDisconnect(); return; } B.edit = false; B.manual = false; B.err = B.field = ""; B.test = null; B.key = ""; D?.repaint(); return; }
    if (t.closest("[data-bykrm]")) { remove(); return; }
    if (t.closest("[data-bykor]")) { e.preventDefault(); orSignIn(); return; }
    if (t.closest("[data-bykordis]")) { e.preventDefault(); orDisconnect(); return; }
    if (t.closest("[data-bykmanual]")) { e.preventDefault(); orManual(); return; }
    if (t.closest("[data-bykretry]")) { B.err = ""; bykLoad(true); D?.repaint(); return; }
    if (t.closest("[data-bykeye]")) { B.eye = !B.eye; const i = document.getElementById("byk-key") as HTMLInputElement | null; if (i) i.type = B.eye ? "text" : "password"; t.closest("[data-bykeye]")!.classList.toggle("on", B.eye); return; }
  }, true);
  document.addEventListener("input", e => {
    const t = e.target as HTMLInputElement, k = t.dataset?.bykf; if (!k) return;
    if (k === "key") B.key = t.value; else (B.f as any)[k] = t.value;
    if (t.matches("[data-bykcombo]")) comboShow(t);
    if (B.field === k) { B.field = ""; B.err = ""; t.closest(".sf")?.classList.remove("bykbad"); t.closest(".sf")?.querySelector(".bykerr")?.remove(); }
  });
  document.addEventListener("change", e => {
    const t = e.target as HTMLInputElement; if (!t.matches?.("[data-bykack]")) return;
    B.f.ack = t.checked; if (B.field === "ack") { B.field = ""; B.err = ""; }
    const s = document.querySelector<HTMLButtonElement>("#bykf .sprim"); if (s) s.disabled = !!B.busy || !B.f.ack;
    document.querySelector(".bykwarn")?.classList.remove("bykbad"); document.querySelector(".bykwarn .bykerr")?.remove();
  });
  // The model fields' list: open on focus, filter as you type, arrows + Enter to pick, Esc or leaving the field closes it.
  document.addEventListener("focusin", e => { const t = e.target as HTMLInputElement; if (t?.matches?.("[data-bykcombo]")) comboShow(t); });
  document.addEventListener("focusout", e => { const t = e.target as HTMLInputElement; if (t?.matches?.("[data-bykcombo]")) { const id = t.id; setTimeout(() => { if (document.activeElement?.id !== id) comboHide(id); }, 120); } });
  document.addEventListener("mousedown", e => { const li = (e.target as HTMLElement).closest?.<HTMLElement>("[data-bykm]"); if (li) e.preventDefault(); }, true);   // keep the focus in the field
  document.addEventListener("click", e => { const li = (e.target as HTMLElement).closest?.<HTMLElement>("[data-bykm]"); if (!li) return; e.preventDefault(); e.stopPropagation();
    const inp = document.getElementById(li.closest("ul")!.id.replace(/-list$/, "")) as HTMLInputElement | null; if (inp) comboPick(inp, li.dataset.bykm!); }, true);
  document.addEventListener("keydown", e => {
    const t = e.target as HTMLInputElement; if (!t?.matches?.("[data-bykcombo]")) return;
    const open = !document.getElementById(`${t.id}-list`)?.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); comboMove(t, e.key === "ArrowDown" ? 1 : -1); }
    else if (e.key === "Enter" && open && CB.id === t.id && CB.act >= 0) { e.preventDefault(); e.stopPropagation(); comboPick(t, CB.items[CB.act].id); }
    else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); comboHide(t.id); }
  }, true);
  // Back from OpenRouter with the browser's Back button (the page restored from cache): not on the way there any more.
  window.addEventListener("pageshow", e => { if ((e as PageTransitionEvent).persisted && B.busy === "or") { B.busy = ""; D?.repaint(); } });
  document.addEventListener("submit", e => { if ((e.target as HTMLElement).id !== "bykf") return; e.preventDefault(); e.stopImmediatePropagation(); save(); }, true);
  // ?settings=byok (the link in a reply, or by text): open Settings on this page once the app is up. ?settings=credits: Add credits.
  const q = new URLSearchParams(location.search);
  const sec = q.get("settings");
  // Back from Sign in with OpenRouter: ok → the models form; err → the reason in plain words above the form.
  const oa = q.get("orauth");
  if (oa) {
    const why = q.get("orwhy") || "";
    B.st = null; B.manual = false;
    if (oa === "ok") { B.orErr = ""; startEdit(); B.edit = false; setTimeout(() => D?.note(true, "Connected to OpenRouter", "Now pick your models."), 400); }
    else B.orErr = OR_WHY[why] || OR_WHY.exchange;
    q.delete("orauth"); q.delete("orwhy");
    if (sec !== BYK_SEC) { const qs = q.toString(); history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash); setTimeout(() => D?.open(), 300); }
  }
  if (sec === BYK_SEC || sec === "credits") { q.delete("settings"); const qs = q.toString(); history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash); setTimeout(() => sec === BYK_SEC ? D?.open() : D?.credits(), 300); }
}
// For the page title on phone and the nav highlight.
export const bykIs = (sec: string) => sec === BYK_SEC;
