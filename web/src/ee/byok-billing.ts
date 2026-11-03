// Settings → AI services (a side panel of its own, right after General; before 2026-11-02 a page under General named Use my own AI key). An account connects any number of AI services at once (task byok-multi, Captain 2026-11-02: "if i add chatgpt and opencode, i then, in the model
// selector, see models from both subs to be able to assign"). The panel lists the connected services (name, the account or address, the last 4 of its key, Test
// and Remove, and buttons Sign in with OpenRouter, Continue with ChatGPT, Use OpenCode and any OpenAI-compatible service), then a Models section (custom-models.ts cmodelsOwnPanel: the own-key editor, which lists
// the models of every connected service together), then the plan options. After a service connects, the panel scrolls to Models, whose first slot says Choose a model; nothing is ever chosen for the person.
// The plan options stay as they were. On the Bring your own key plan ($10/month, 100 GB; everything else 1Helm runs is paid from credits at cost + 15%) the connected services are
// simply the AI. On a full plan (Personal/Plus/Power/Max) the person connects a service, then picks one of two options (Captain 10-06):
//   - Keep my plan, use my key as a backup (mode "fallback"): 1Helm credits first; once they're used up, chat goes to the services until they refill.
//   - Switch now to the $10 plan (POST /byok/switch-now, Captain 10-28): the plan changes at once, the unused plan usage becomes credits; the confirm dialog (from /byok/switch-preview) says so.
//     A switch already scheduled for the renewal (mode "switch") keeps Undo and gets Switch now next to it. Refused in plain words when the account uses more than the $10 plan holds.
// 1HC: src/byok.js. GET /api/byok → { connections: [{ id, kind, label, host, last4, email, signin_again, tested_at, test }], mode, custom: { model } … }; POST /api/byok/connections { base, key, label, ack },
// /opencode { key, ack }, /test { id }, /remove { id, cancel_switch }, /mode, /switch-now, /chatgpt/finish { url }. A key goes up once and never comes back (last 4 only).
// Sign in with OpenRouter: a same-tab navigation to /w/<slug>/byok/openrouter/start; it comes back with ?settings=byok&orauth=ok (or err) and the key is the OpenRouter connection at once.
// Continue with ChatGPT: OpenAI's page opens in a new tab and ends on a 127.0.0.1 address that can't load, so the person pastes that address here. Use OpenCode: the OpenCode console
// (https://opencode.ai/console/account, where personal API keys are made) opens in a new tab and the person pastes the key (?add=opencode opens this step, from the onboarding card; ?settings=byok and ?settings=ai open the panel).
// v3.ts hooks in: bykPage() as the "ai" section (the nav entry AI services), bykUsageNote() in the usage card, bykAfter() after every Settings paint, bykSwitched() on the stream's byok_switch, bykInit() once.
// Sandbox (no 1HC): the same screens on pretend services (?byoksaved one service, ?byokthree three, ?byokplan the $10 plan, ?byokfb a backup in use, ?byokswitch a switch pending, ?byokstorage refused).
import { ask, choose } from "../dialog";
import { cmodelsOwnPanel, cmodelsRefresh, cmodelsPrefetch } from "./custom-models";   // the Models section
import { logoOver, logoChip, serviceDomain } from "../logo";   // logo.dev through /logo/<domain>: every service shows its own logo, drawn over the icon that was there

export const BYK_SEC = "ai";   // ?settings=byok (older links, the onboarding cards) lands here too
export const BYK_TITLE = "AI services";
export const BYK_WARN = "With your own AI key, your messages and files that the AI reads go to that provider under their terms. 1Helm's zero-data-retention guarantee covers only the parts we run. Everything else stays private as before.";
export const BYK_TERMS = "1Helm's instructions sent to your AI service remain 1Helm's and are covered by our Terms.";
// A full plan: the caveat holds only while the key is actually answering.
export const BYK_ZDR_FULL = "On your current plan this applies only while your key is in use: with the backup option, only after your 1Helm credits run out; with the switch, from the day it happens.";
export const FALLBACK_NOTE = "Using your own AI key (1Helm credits used up)";
export const BYK_ZDR_OPTS = "Zero data retention: while your key is in use, what the AI reads goes to your provider under their terms, and 1Helm's guarantee covers only the parts we run. With the backup, that's only after your 1Helm credits run out; with the switch, from the day it happens.";
export const OC_CONSOLE = "https://opencode.ai/console/account";
type Check = { ok: boolean; error?: string; ms?: number; models?: number };
type Test = { ok: boolean; checks: { reach?: Check }; ms?: number; at?: number };
type Kind = "plain" | "openrouter" | "chatgpt" | "opencode" | "claudecode";
type Conn = { id: string; kind: Kind; plan?: "go" | "payg"; label: string; host: string; last4: string; email?: string; plan_name?: string; signin_again?: boolean; added_at: number | null; tested_at: number | null; test: Test | null };
type Mode = "" | "fallback" | "switch";
type UsageWin = { id: string; label: string; used: number; resets_at: number | null };
type Usage = { windows: UsageWin[]; at: number; tried: boolean; manage: string; limit: { window: string; resets_at: number | null } | null };
type St = { usage: Record<string, Usage>; on_plan: boolean; full: boolean; plan_name: string; price: number; connections: Conn[]; mode: Mode; switch_at?: number | null; fallback?: { active: boolean; since: number | null }; openrouter: { manage: string }; custom: { model: string | null } };
type Deps = {
  api: ((path: string, body?: any) => Promise<any>) | null;   // null: design sandbox
  repaint: () => void;                                        // Settings, when this panel or General is showing
  open: () => void;                                           // open Settings on this page
  note: (ok: boolean, title: string, sub: string) => void;
  who: () => string;                                          // the helper's name
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  icon: (k: string, s?: number) => string;
  shown: () => boolean;                                       // Settings is open on General or this panel
  credits: () => void;                                        // Settings → Usage with Add credits open
  orStart: string | null;                                     // /w/<slug>/byok/openrouter/start (null: design sandbox)
  cgStart: string | null;                                     // /w/<slug>/byok/chatgpt/start, opened in a new tab (null: design sandbox)
};
let D: Deps | null = null;
type Step = "" | "plain" | "opencode" | "chatgpt" | "claudecode";
const CC: { s: "" | "loading" | "ready" | "failed"; url: string; n: number } = { s: "", url: "", n: 0 };   // the Continue with Claude step: waiting for Anthropic's address, ready to open, or failed
const B: { st: St | null; loading: boolean; err: string; field: string; busy: "" | "plan" | "test" | "add" | "del" | "or" | "cg" | "cc"; busyId: string; step: Step; f: { base: string; label: string; ock: string; plan: string; ack: boolean; cgurl: string; cccode: string; cred: string }; key: string; eye: boolean;
  at: number; last: string; orErr: string; reveal: boolean; ch: { busy: "" | Mode | "undo" | "now"; err: string; storage: boolean } } =
  { st: null, loading: false, err: "", field: "", busy: "", busyId: "", step: "", f: { base: "", label: "", ock: "", plan: "go", ack: false, cgurl: "", cccode: "" }, key: "", eye: false, at: 0, last: "", orErr: "", reveal: false, ch: { busy: "", err: "", storage: false } };
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
const CG_USAGE = "https://chatgpt.com/settings/usage";
// The ChatGPT button: its logo from logo.dev on a white chip. OpenAI's own mark stays underneath and shows only if the logo can't load.
const CG_MARK = `<svg width="21" height="21" viewBox="0 0 21 21" fill="none" aria-hidden="true" focusable="false"><path d="M11.8102 19.1625C11.2327 19.1625 10.6841 19.0528 10.1643 18.8334C9.64459 18.6139 9.18259 18.3078 8.77834 17.9151C8.33944 18.0653 7.88322 18.1404 7.40967 18.1404C6.63582 18.1404 5.91972 17.9498 5.26137 17.5686C4.60302 17.1875 4.07172 16.6677 3.66747 16.0094C3.27477 15.351 3.07842 14.6176 3.07842 13.8091C3.07842 13.4742 3.12462 13.1103 3.21702 12.7176C2.75502 12.2903 2.39697 11.7994 2.14287 11.245C1.88877 10.679 1.76172 10.09 1.76172 9.47785C1.76172 8.85415 1.89454 8.25355 2.16019 7.67605C2.42584 7.09855 2.79544 6.6019 3.26899 6.1861C3.75409 5.75875 4.31427 5.46422 4.94952 5.30252C5.07657 4.64417 5.34222 4.05512 5.74647 3.53537C6.16227 3.00407 6.67047 2.58827 7.27107 2.28797C7.87167 1.98767 8.51269 1.83752 9.19414 1.83752C9.77164 1.83752 10.3203 1.94725 10.84 2.1667C11.3598 2.38615 11.8218 2.69222 12.226 3.08492C12.6649 2.93477 13.1211 2.8597 13.5947 2.8597C14.3685 2.8597 15.0846 3.05027 15.743 3.43142C16.4013 3.81257 16.9269 4.33232 17.3196 4.99067C17.7238 5.64902 17.9259 6.38245 17.9259 7.19095C17.9259 7.5259 17.8797 7.88973 17.7873 8.28242C18.2493 8.70977 18.6074 9.20643 18.8615 9.77238C19.1156 10.3268 19.2426 10.91 19.2426 11.5222C19.2426 12.1459 19.1098 12.7465 18.8442 13.324C18.5785 13.9015 18.2031 14.4039 17.718 14.8313C17.2445 15.2471 16.6901 15.5358 16.0548 15.6975C15.9278 16.3559 15.6564 16.9449 15.2406 17.4647C14.8363 17.996 14.3339 18.4118 13.7333 18.7121C13.1327 19.0124 12.4917 19.1625 11.8102 19.1625ZM7.53094 16.9969C8.10844 16.9969 8.61087 16.8756 9.03822 16.6331L12.2953 14.762C12.4108 14.6811 12.4686 14.5714 12.4686 14.4328V12.9429L8.27592 15.351C8.02182 15.5012 7.76772 15.5012 7.51362 15.351L4.23919 13.4626C4.23919 13.4973 4.23342 13.5377 4.22187 13.5839C4.22187 13.6301 4.22187 13.6994 4.22187 13.7918C4.22187 14.3808 4.36047 14.9237 4.63767 15.4203C4.92642 15.9054 5.32489 16.2866 5.83309 16.5638C6.34129 16.8525 6.90724 16.9969 7.53094 16.9969ZM7.70419 14.1729C7.77349 14.2076 7.83702 14.2249 7.89477 14.2249C7.95252 14.2249 8.01027 14.2076 8.06802 14.1729L9.36739 13.4279L5.19207 11.0024C4.93797 10.8523 4.81092 10.6271 4.81092 10.3268V6.56725C4.23342 6.82135 3.77142 7.21405 3.42492 7.74535C3.07842 8.2651 2.90517 8.8426 2.90517 9.47785C2.90517 10.0438 3.04954 10.5866 3.33829 11.1064C3.62704 11.6261 4.00242 12.0189 4.46442 12.2845L7.70419 14.1729ZM11.8102 18.0191C12.4224 18.0191 12.9768 17.8805 13.4734 17.6033C13.9701 17.3261 14.3628 16.9449 14.6515 16.4598C14.9403 15.9747 15.0846 15.4319 15.0846 14.8313V11.0891C15.0846 10.9505 15.0269 10.8465 14.9114 10.7772L13.5947 10.0149V14.8486C13.5947 15.1489 13.4676 15.3741 13.2135 15.5243L9.93912 17.4127C10.5051 17.817 11.1288 18.0191 11.8102 18.0191ZM12.4686 11.6781V9.32192L10.5108 8.21312L8.53579 9.32192V11.6781L10.5108 12.7869L12.4686 11.6781ZM7.40967 6.15145C7.40967 5.85115 7.53672 5.62592 7.79082 5.47577L11.0652 3.58735C10.4993 3.1831 9.87559 2.98097 9.19414 2.98097C8.58199 2.98097 8.02759 3.11957 7.53094 3.39677C7.03429 3.67397 6.64159 4.05512 6.35284 4.54022C6.07564 5.02532 5.93704 5.56817 5.93704 6.16878V9.89365C5.93704 10.0323 5.99479 10.142 6.11029 10.2228L7.40967 10.9851V6.15145ZM16.2108 14.4328C16.7883 14.1787 17.2445 13.786 17.5794 13.2547C17.9259 12.7234 18.0992 12.1459 18.0992 11.5222C18.0992 10.9562 17.9548 10.4134 17.6661 9.89365C17.3773 9.3739 17.0019 8.9812 16.5399 8.71555L13.3002 6.84445C13.2309 6.79825 13.1673 6.78092 13.1096 6.79248C13.0518 6.79248 12.9941 6.8098 12.9363 6.84445L11.637 7.5721L15.8296 10.0149C15.9567 10.0842 16.0491 10.1766 16.1068 10.2921C16.1761 10.3961 16.2108 10.5231 16.2108 10.6733V14.4328ZM12.7284 5.6317C12.9825 5.47 13.2366 5.47 13.4907 5.6317L16.7825 7.55477C16.7825 7.47393 16.7825 7.36997 16.7825 7.24292C16.7825 6.68852 16.6439 6.163 16.3667 5.66635C16.101 5.15815 15.7141 4.7539 15.2059 4.4536C14.7093 4.1533 14.1318 4.00315 13.4734 4.00315C12.8959 4.00315 12.3935 4.12442 11.9661 4.36697L8.70904 6.23808C8.59354 6.31892 8.53579 6.42865 8.53579 6.56725V8.0572L12.7284 5.6317Z" fill="currentColor"/></svg>`;
const CG_LOGO = `<span class="bykcglogo lgo-host" aria-hidden="true">${CG_MARK}${logoOver("chatgpt.com", 22)}</span>`;
export const CG_WHY: Record<string, string> = {
  cancelled: "ChatGPT sign-in was cancelled. Nothing was saved.",
  expired: "That ChatGPT sign-in took too long or was already used. Try again.",
  paste: "That isn't the address from your ChatGPT sign-in. Copy the whole address from the page that didn't load, and paste it here.",
  exchange: "ChatGPT didn't accept the sign-in. Try again.",
  network: "ChatGPT didn't answer. Try again in a minute.",
  verify: "ChatGPT's answer couldn't be checked, so nothing was saved. Try again.",
  no_use: "ChatGPT sign-in worked, but you didn't allow 1Helm to use your ChatGPT plan. Try again and allow it.",
  other_account: "That's a different ChatGPT account than the one connected before. Sign out first, then sign in with the new account.",
};

const esc = (s: any = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };
const dateText = (ms?: number | null) => ms ? new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "";
const ago = (ms: number | null) => { if (!ms) return ""; const m = Math.round((Date.now() - ms) / 60e3); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };

// ---- sandbox: pretend services that pass unless the address or key says otherwise ----
const QP = new URLSearchParams(location.search);
const MOCK_RENEW = Date.now() + 18 * 864e5;
const day = 864e5;
function usagePages(): Record<string, string> { return { chatgpt: "https://chatgpt.com/settings/usage", claudecode: "https://claude.ai/settings/usage", opencode: "https://opencode.ai/console" }; }
const MOCK_CONNS: Record<string, Conn> = {
  p_work1: { id: "p_work1", kind: "plain", label: "Work account", host: "api.openai.com", last4: "x7Qa", added_at: Date.now() - 3 * day, tested_at: Date.now() - 3 * day, test: { ok: true, at: Date.now() - 3 * day, checks: { reach: { ok: true, ms: 640, models: 41 } } } },
  chatgpt: { id: "chatgpt", kind: "chatgpt", label: "ChatGPT", host: "", last4: "", email: "sam@example.com", added_at: Date.now() - day, tested_at: Date.now() - day, test: { ok: true, at: Date.now() - day, checks: { reach: { ok: true, ms: 1180, models: 6 } } } },
  opencode: { id: "opencode", kind: "opencode", plan: "go", label: "OpenCode", host: "", last4: "9f3b", added_at: Date.now() - 2 * day, tested_at: Date.now() - 2 * day, test: { ok: true, at: Date.now() - 2 * day, checks: { reach: { ok: true, ms: 420 } } } },
  claudecode: { id: "claudecode", kind: "claudecode", label: "Claude Code", host: "", last4: "", email: "sam@example.com", plan_name: "Max", added_at: Date.now() - day, tested_at: Date.now() - day, test: { ok: true, at: Date.now() - day, checks: { reach: { ok: true, ms: 300 } } } },
  openrouter: { id: "openrouter", kind: "openrouter", label: "OpenRouter", host: "", last4: "4c1d", added_at: Date.now() - 5 * day, tested_at: null, test: null },
};
let mockSt: St = { usage: {}, on_plan: QP.has("byokplan"), full: !QP.has("byokplan"), plan_name: QP.has("byokplan") ? "Bring your own key" : "Personal", price: 10, connections: [], mode: QP.has("byokfb") ? "fallback" : QP.has("byokswitch") ? "switch" : "",
  ...(QP.has("byokswitch") ? { switch_at: MOCK_RENEW } : {}), ...(QP.has("byokfb") ? { fallback: { active: true, since: Date.now() - 2 * 3600e3 } } : {}), openrouter: { manage: "https://openrouter.ai/keys/3f2a9c" }, custom: { model: QP.has("byoknomodel") ? null : "p_work1:gpt-6.1-sol" } };
if (QP.has("byoksaved") || QP.has("byokfb") || QP.has("byokswitch")) mockSt.connections = [MOCK_CONNS.p_work1];
if (QP.has("byokthree")) mockSt.connections = [MOCK_CONNS.chatgpt, MOCK_CONNS.opencode, MOCK_CONNS.p_work1];
if (QP.has("byokcc")) mockSt.connections = [MOCK_CONNS.claudecode, MOCK_CONNS.opencode];
if (QP.has("byokcgagain")) mockSt.connections = [{ ...MOCK_CONNS.chatgpt, signin_again: true }];
// Sandbox only: ChatGPT and Claude show two bars (?byokusagelink: the link instead, ?byokusagelimit: a limit reached), OpenCode is always the link.
const mockUsage = (kinds: string[]): Record<string, Usage> => Object.fromEntries(kinds.map(k => {
  const manage = usagePages()[k], none = k === "opencode" || QP.has("byokusagelink"), hit = QP.has("byokusagelimit") && k === "chatgpt";
  return [k, { windows: none ? [] : [{ id: "session", label: "5 hours", used: hit ? 100 : k === "chatgpt" ? 38 : 64, resets_at: Date.now() + (hit ? 85 : 130) * 60e3 }, { id: "weekly", label: "This week", used: k === "chatgpt" ? 12 : 41, resets_at: Date.now() + 3 * day }], at: Date.now(), tried: true, manage,
    limit: hit ? { window: "session", resets_at: Date.now() + 85 * 60e3 } : null }];
}));
if (QP.has("byokusagecached")) mockSt.usage = mockUsage(mockSt.connections.map(c => c.kind));   // sandbox: the numbers were saved from an earlier visit
const STORAGE_MSG = "You're using 128 GB, and Bring your own key includes 100 GB. Delete files you don't need, or add 1 block of extra storage first.";
async function mock(path: string, body?: any): Promise<any> {
  await new Promise(z => setTimeout(z, path.endsWith("/test") || path.endsWith("/opencode") || path.endsWith("/connections") ? 700 : 250));
  const add = (c: Conn) => { mockSt = { ...mockSt, connections: [...mockSt.connections.filter(x => x.id !== c.id), c] }; };
  if (path === "/byok") return mockSt;
  if (path === "/byok/usage") { const kinds = mockSt.connections.map(c => c.kind).filter(k => k === "chatgpt" || k === "claudecode" || k === "opencode"); await new Promise(z => setTimeout(z, QP.has("byokusageslow") ? 4000 : 0)); mockSt = { ...mockSt, usage: mockUsage(kinds) }; return { usage: mockSt.usage }; }
  if (path === "/byok/test") { const c = mockSt.connections.find(x => x.id === body?.id); if (!c) return { error: "That service isn't connected." };
    const t: Test = { ok: true, at: Date.now(), checks: { reach: { ok: true, ms: 540 } } }; add({ ...c, test: t, tested_at: t.at! }); return { ok: true, test: t, ...mockSt }; }
  if (path === "/byok/remove") { mockSt = { ...mockSt, connections: mockSt.connections.filter(x => x.id !== body?.id), ...(!mockSt.connections.some(x => x.id !== body?.id) ? (body?.cancel_switch ? { mode: "" as Mode, switch_at: null } : mockSt.mode === "fallback" ? { mode: "" as Mode } : {}) : {}) }; return { ok: true, removed_models: 2, ...mockSt }; }
  if (path === "/byok/chatgpt/finish") { if (!/code=/.test(String(body?.url || ""))) return { error: CG_WHY.paste, why: "paste" }; add(MOCK_CONNS.chatgpt); return { ok: true, ...mockSt }; }
  if (path === "/byok/claudecode/start") { await new Promise(z => setTimeout(z, QP.has("byokccslow") ? 6000 : 1200)); if (QP.has("byokccerr")) { const c = QP.get("byokccerr") || ""; return c === "day_limit" ? { error: "skipped: daily safety limit reached", code: "day_limit" } : { error: c }; } return QP.has("byokccfail") ? { error: "Claude isn't reachable right now. Try again in a minute." } : { ok: true, url: "https://claude.ai/oauth/authorize?code=true&client_id=sandbox" }; }
  if (path === "/byok/claudecode/finish") { if (String(body?.code || "").trim().length < 4 || /bad|wrong/.test(String(body?.code))) return { error: "That code didn't work. Copy the whole code Claude shows, paste it here and try again.", field: "code" }; add(MOCK_CONNS.claudecode); return { ok: true, ...mockSt }; }
  if (path === "/byok/opencode-plan") { const c = mockSt.connections.find(x => x.id === "opencode"); if (!c) return { error: "OpenCode isn't connected." }; add({ ...c, plan: body?.plan === "payg" ? "payg" : "go" }); return { ok: true, ...mockSt }; }
  if (path === "/byok/opencode") {
    if (body?.ack !== true) return { error: "Read the note about your provider and tick the box to connect.", field: "ack" };
    if (!String(body?.key || "").trim()) return { error: "Paste the key from your OpenCode console. It is one line.", field: "key" };
    if (/bad|wrong/.test(String(body.key))) return { error: "OpenCode didn't accept that key. Copy it again from your OpenCode console, then try again (https://opencode.ai/console/account).", field: "key" };
    add({ ...MOCK_CONNS.opencode, plan: body?.plan === "payg" ? "payg" : "go", last4: String(body.key).slice(-4) }); return { ok: true, id: "opencode", ...mockSt };
  }
  if (path === "/byok/connections") {
    const base = String(body?.base || "").trim(), host = hostOf(base);
    if (body?.ack !== true) return { error: "Read the note about your provider and tick the box to connect.", field: "ack" };
    if (!/^https:\/\//.test(base) || !host.includes(".")) return { error: "The address must start with https://.", field: "base" };
    if (/bad|wrong/.test(String(body.key))) return { error: "Not connected: the connection test didn't pass. Fix what it says and try again.", test: { ok: false, checks: { reach: { ok: false, error: `Your AI service (${host}) refused your key (error 401).` } } } };
    add({ id: "p_" + Math.random().toString(36).slice(2, 7), kind: "plain", label: String(body.label || "").trim() || host, host, last4: String(body.key || "").slice(-4), added_at: Date.now(), tested_at: Date.now(), test: { ok: true, at: Date.now(), checks: { reach: { ok: true, ms: 610, models: 12 } } } });
    return { ok: true, ...mockSt };
  }
  if (path === "/byok/switch-preview") return mockSt.on_plan ? { error: "You're on the Bring your own key plan already." } : { ok: true, unused_nano: 14.2e9, unused: "$14.20", price: 10, next_bill_at: MOCK_RENEW };
  if (path === "/byok/switch-now") {
    if (QP.has("byokstorage")) return { error: STORAGE_MSG, storage: { used: 128e9, limit: 100e9, need: 1 } };
    mockSt = { ...mockSt, on_plan: true, full: false, plan_name: "Bring your own key", mode: "", switch_at: null, fallback: undefined }; sbCredits = "$" + (14.2 + 5).toFixed(2);
    return { ok: true, plan: "byok", moved_nano: 14.2e9, moved: "$14.20", next_bill_at: MOCK_RENEW };
  }
  if (path === "/byok/mode") {
    const m = String(body?.mode ?? "") as Mode;
    if (m === "switch" && QP.has("byokstorage")) return { error: STORAGE_MSG, storage: { used: 128e9, limit: 100e9, need: 1 } };
    mockSt = { ...mockSt, mode: m, switch_at: m === "switch" ? MOCK_RENEW : null, fallback: m === "fallback" ? { active: QP.has("byokfb"), since: null } : undefined };
    return { ok: true, ...mockSt };
  }
  return { error: "Not found" };
}
let sbCredits = "$5.00";   // sandbox only: what the usage card says in credits after a pretend switch
/** Sandbox only (no 1HC): the pretend account is on the Bring your own key plan, so the usage card can say so. */
export const bykSbOn = () => !D?.api && !!B.st?.on_plan;
export const bykSbCredits = () => sbCredits;
const call = (path: string, body?: any) => (D?.api || mock)(path, body);
// Plain words for what a connect or sign-in step can answer. The server sends a message (and a code for billing stops); a bare code like out_of_credits, a status number or an engine error never reaches the page.
export const BYK_CREDITS_MSG = "Continue with Claude runs on 1Helm's computer, which is paid from credits you add, at cost plus 15%. Add credits to go on. Your Claude plan pays for the AI itself.";
export const BYK_DAY_MSG = "The daily safety limit was reached, so Continue with Claude is paused until midnight Pacific. Nothing was lost.";
const RAW_ERR = /^(?:https?\s*)?[1-5]\d\d$|^\S{2,60}$/;   // one word with no spaces (out_of_credits, internal_error, 502, ETIMEDOUT) is a code, not a sentence
export function say(m: any, fb: string, code?: string): string {
  const t = String(m ?? "").trim(), c = String(code ?? "");
  if (c === "out_of_credits" || /out_of_credits?\b|^402$/.test(t)) return BYK_CREDITS_MSG;
  if (c === "day_limit" || /daily safety limit|^429$/i.test(t)) return /^429$/.test(t) ? "Too many tries in a short time. Wait a minute and try again." : BYK_DAY_MSG;
  if (/^(?:https?\s*)?5\d\d$|timed? ?out|etimedout|econn|engine (?:is )?not ready|not_ready|container/i.test(t) && !/\s.*\s.*\s/.test(t)) return fb;
  if (!t || RAW_ERR.test(t)) return fb;
  return t;
}


// The page's state from any /byok answer (GET, add, remove, mode all return it).
function stOf(d: any): St {
  const m: Mode = d.mode === "fallback" || d.mode === "switch" ? d.mode : "";
  return { on_plan: !!d.on_plan, full: d.full ?? !d.on_plan, plan_name: String(d.plan_name || ""), price: Number(d.price) || 10, mode: m, switch_at: d.switch_at ?? null,
    connections: Array.isArray(d.connections) ? d.connections : [], ...(d.fallback ? { fallback: { active: !!d.fallback.active, since: d.fallback.since ?? null } } : {}),
    openrouter: { manage: /^https:\/\/openrouter\.ai\//.test(String(d.openrouter?.manage || "")) ? d.openrouter.manage : OR_KEYS }, custom: { model: typeof d.custom?.model === "string" ? d.custom.model : null }, usage: usageOf(d.usage) };
}
const planName = () => B.st?.plan_name || "your plan";
const fbOn = () => !!B.st && B.st.mode === "fallback" && !!B.st.fallback?.active;
const has = (k: Kind) => !!B.st?.connections.some(c => c.kind === k);
// The last answer is kept in this browser (localStorage, by workspace; it holds no key or token: only the service names, last 4 characters and settings the page shows), so the page draws its
// full content on every open. It is read again in the background at boot and whenever Settings opens, and the page changes in place only when the answer differs.
const ckey = () => { try { const slug = String((window as any).__1HC?.slug || ""); return D?.api && slug ? `1hc-ai-services:${slug}` : ""; } catch { return ""; } };
const cacheOf = (): any => { try { const k = ckey(); const raw = k ? localStorage.getItem(k) : null; const d = raw ? JSON.parse(raw) : null; return d && !d.error && Array.isArray(d.connections) ? d : null; } catch { return null; } };
let hydrated = false;
function hydrate() { if (hydrated || B.st) return; hydrated = true; const d = cacheOf(); if (d) { try { B.st = stOf(d); B.last = JSON.stringify(d); } catch { B.st = null; } } }
export function bykLoad(force = false) {
  if (B.loading) return;
  hydrate();
  if (B.st && !force && Date.now() - B.at < 15000) return;
  B.loading = true; B.at = Date.now(); let changed = false;
  call("/byok").then(d => {
    if (d && !d.error) {
      const j = JSON.stringify(d);
      if (j !== B.last || !B.st) { B.st = stOf(d); B.last = j; changed = true; try { const k = ckey(); if (k) localStorage.setItem(k, j); } catch {} }
      if (B.err && !B.step) { B.err = ""; changed = true; }
    } else if (!B.st) { B.err = say(d?.error, "Couldn't load your AI key settings. Try again in a minute.", d?.code); changed = true; }
  })
    .catch(() => { if (!B.st) { B.err = "Couldn't load your AI key settings. Check your connection and try again."; changed = true; } })
    .finally(() => { B.loading = false; if (changed && D?.shown()) D.repaint(); });
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
const keyField = (id: "key" | "ock", ph: string) => `<label class="sf${B.field === "key" ? " bykbad" : ""}"><span>Key</span><span class="spw"><input id="byk-${id}" data-bykf="${id}" type="${B.eye ? "text" : "password"}" placeholder="${esc(ph)}" autocomplete="new-password" autocapitalize="none" spellcheck="false"><button type="button" class="seye${B.eye ? " on" : ""}" data-bykeye aria-label="Show key">${D!.icon("eye", 17)}</button></span>${B.field === "key" && B.err ? `<em class="bykerr" role="alert">${esc(B.err)}</em>` : ""}</label>`;
function testHtml(t: Test | null): string {
  if (!t) return "";
  const c = t.checks.reach;
  return `<div class="byktest small ${t.ok ? "pass" : "fail"}" role="status"><div class="byktt">${t.ok ? "Connection works" : "Connection test didn't pass"}${t.at ? `<i>${ago(t.at)}</i>` : ""}</div>${!t.ok && c?.error ? `<span class="bykwhy">${esc(c.error)}</span>` : ""}</div>`;
}
const KIND_NAME: Record<Kind, string> = { plain: "", openrouter: "Signed in with OpenRouter", chatgpt: "Signed in with ChatGPT", opencode: "OpenCode key", claudecode: "Runs Claude Code with your Claude plan" };
const subOf = (c: Conn) => {
  const who = c.kind === "opencode" ? (c.plan === "payg" ? "OpenCode pay as you go" : "OpenCode Go plan") : c.kind === "chatgpt" ? (c.signin_again ? "Sign-in ended" : c.email ? `Signed in as ${esc(c.email)}` : "Signed in") : c.kind === "claudecode" ? (c.signin_again ? "Sign-in ended" : c.email ? `Runs Claude Code with your Claude plan · ${esc(c.email)}${c.plan_name ? ` (${esc(c.plan_name)})` : ""}` : KIND_NAME.claudecode) : c.kind === "plain" ? esc(c.host) : KIND_NAME[c.kind];
  const key = c.last4 ? ` · <span class="bykmask">••••${esc(c.last4)}</span>` : "";
  return `${who}${key}`;
};
// A service's icon with its logo drawn over it (same 38px tile as the other rows), and the small logo for the buttons and form headings.
const svcIcon = (kind: Kind, host: string, icon: string) => `<span class="favi">${icon}${logoOver(serviceDomain(kind, host), 38)}</span>`;
const svcHead = (kind: Kind, icon: string) => `<span class="bykhl lgo-host">${icon}${logoOver(serviceDomain(kind), 24)}</span>`;
// ---- plan usage under a connected service (Captain 2026-11-03): up to two thin bars (a 5 hour window and a week), each with when it resets, or a Manage usage link when no numbers could be read ----
const USAGE_HOST = /^https:\/\/(chatgpt\.com|claude\.ai|opencode\.ai)\//;
function usageOf(d: any): Record<string, Usage> {
  const out: Record<string, Usage> = {};
  for (const k of Object.keys(usagePages())) {
    const u = d && typeof d === "object" ? d[k] : null; if (!u || typeof u !== "object") continue;
    const windows: UsageWin[] = (Array.isArray(u.windows) ? u.windows : []).filter((w: any) => w && Number.isFinite(Number(w.used))).slice(0, 2).map((w: any) => ({ id: w.id === "weekly" ? "weekly" : "session", label: String(w.label || "").slice(0, 24) || (w.id === "weekly" ? "This week" : "Session"), used: Math.max(0, Math.min(100, Number(w.used))), resets_at: Number(w.resets_at) > 0 ? Number(w.resets_at) : null }));
    const lim = u.limit && typeof u.limit === "object" ? { window: String(u.limit.window || ""), resets_at: Number(u.limit.resets_at) > 0 ? Number(u.limit.resets_at) : null } : null;
    out[k] = { windows, at: Number(u.at) || 0, tried: !!u.tried, manage: USAGE_HOST.test(String(u.manage || "")) ? String(u.manage) : usagePages()[k], limit: lim };
  }
  return out;
}
// "Resets in 2h 5m" within a day, else the date. A window whose time has passed counts as unused again.
function resetText(ms: number | null): string {
  if (!ms) return ""; const left = ms - Date.now(); if (left <= 0) return "";
  const m = Math.max(1, Math.round(left / 60e3)); if (m < 60) return `Resets in ${m}m`;
  if (m < 1440) return `Resets in ${Math.floor(m / 60)}h ${m % 60}m`;
  return `Resets ${new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
}
function usageBlock(c: Conn): string {
  if (c.kind !== "chatgpt" && c.kind !== "claudecode" && c.kind !== "opencode") return "";
  if (c.signin_again) return "";
  const u = B.st?.usage?.[c.kind], manage = u?.manage || usagePages()[c.kind];
  const link = (t: string) => `<a class="bukmanage" href="${esc(manage)}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  const wins = (u?.windows || []).map(w => (w.resets_at && w.resets_at <= Date.now() ? { ...w, used: 0, resets_at: null } : w));
  if (wins.length) {
    const lim = u?.limit && (!u.limit.resets_at || u.limit.resets_at > Date.now()) ? u.limit : null;
    return `<div class="bykusage" data-bykusage="${c.kind}">${wins.map(w => { const pct = Math.round(w.used), full = w.used >= 99.5;
      return `<div class="bukw${full ? " full" : ""}"><div class="bukt"><b>${esc(w.label)}</b><span>${pct}% used</span><em>${esc(w.resets_at ? resetText(w.resets_at) : "Not in use")}</em></div><div class="bukbar" role="progressbar" aria-label="${esc(w.label)} usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${Math.max(w.used > 0 ? 2 : 0, w.used)}%"></i></div></div>`; }).join("")}
      ${lim ? `<p class="bukhit" role="status">${esc(lim.window === "weekly" ? "Weekly limit reached" : lim.window === "session" ? "5 hour limit reached" : "Usage limit reached")}${lim.resets_at ? `. ${esc(resetText(lim.resets_at))}` : ""}. ${link("Manage usage")}</p>` : `<p class="bukmore">${link("Manage usage")}</p>`}</div>`;
  }
  if (c.kind === "opencode" || u?.tried) return `<div class="bykusage bukno" data-bykusage="${c.kind}"><p>${u?.limit ? "Usage limit reached. " : "Usage isn't shown here. "}${link("Manage usage")}</p></div>`;
  return `<div class="bykusage bukwait" data-bykusage="${c.kind}" aria-hidden="true"></div>`;   // the numbers are on their way: the space is kept so nothing moves
}
let usageAt = 0;
// Read the numbers again when AI services opens (the saved ones are drawn first). The server throttles the services themselves, so asking often is cheap.
export function bykUsageLoad() {
  if (!B.st || Date.now() - usageAt < 60e3 || !B.st.connections.some(c => c.kind === "chatgpt" || c.kind === "claudecode" || c.kind === "opencode")) return;
  usageAt = Date.now();
  call("/byok/usage").then(d => {
    if (!d || d.error || !B.st) return;
    const next = usageOf(d.usage); if (JSON.stringify(next) === JSON.stringify(B.st.usage)) return;
    B.st = { ...B.st, usage: { ...B.st.usage, ...next } };
    try { const k = ckey(), raw = k ? localStorage.getItem(k) : null; if (k && raw) { const j = JSON.parse(raw); j.usage = { ...(j.usage || {}), ...d.usage }; B.last = JSON.stringify(j); localStorage.setItem(k, B.last); } } catch {}
    if (D?.shown() && !B.step && !B.busy) D.repaint();
  }).catch(() => {});
}

function connRow(c: Conn): string {
  const busy = B.busy === "test" && B.busyId === c.id, del = B.busy === "del" && B.busyId === c.id, off = B.busy ? " disabled" : "";
  const again = c.kind === "chatgpt" && c.signin_again ? `<button class="bykcgbtn" data-bykcg${off}>${CG_LOGO}<span>Continue with ChatGPT</span></button>` : "";
  const ccAgain = c.kind === "claudecode" && c.signin_again ? `<button class="bykaddb" data-bykcc${off}>${logoChip(serviceDomain("claudecode"), 20)}Continue with Claude</button>` : "";
  return `<div class="sc bykconn" data-bykconn="${esc(c.id)}">${D!.srow(svcIcon(c.kind, c.host, D!.icon(c.kind === "chatgpt" || c.kind === "openrouter" ? "key" : "spark")), esc(c.label), subOf(c), c.test ? `<span class="${c.test.ok ? "sok" : "sval bykneed"}">${c.test.ok ? D!.icon("check", 14) + "Works" : "Failed"}</span>` : "")}
    ${testHtml(c.test && !c.test.ok ? c.test : null)}${usageBlock(c)}
    <div class="sfoot bykacts">${again}${ccAgain}${c.kind === "opencode" ? `<button class="sa" data-bykplan="${c.plan === "payg" ? "go" : "payg"}"${off}>${B.busy === "plan" ? "Switching…" : c.plan === "payg" ? "Use my Go plan" : "Use pay as you go"}</button>` : ""}<button class="sa blue" data-byktest="${esc(c.id)}"${off}>${busy ? "Testing…" : "Test"}</button><button class="sa mute" data-bykrm="${esc(c.id)}"${off}>${del ? "Removing…" : "Remove"}</button></div></div>`;
}
// The buttons that add a service. A service that can only be connected once leaves the list of buttons when it is connected.
function addButtons(): string {
  const off = B.busy ? " disabled" : "";
  return `<div class="sc bykadd"><div class="bykaddrow">${!has("openrouter") ? `<button type="button" class="sprim bykorbtn" data-bykor${off}>${logoChip(serviceDomain("openrouter"), 20)}Sign in with OpenRouter</button>` : ""}
    ${!has("chatgpt") ? `<button type="button" class="bykcgbtn" data-bykcg${off}>${CG_LOGO}<span>Continue with ChatGPT</span></button>` : ""}
    ${!has("claudecode") ? `<button type="button" class="bykaddb" data-bykcc${off}>${logoChip(serviceDomain("claudecode"), 20)}Continue with Claude</button>` : ""}
    ${!has("opencode") ? `<button type="button" class="bykaddb" data-bykoc${off}>${logoChip(serviceDomain("opencode"), 20)}Use OpenCode</button>` : ""}
    <button type="button" class="bykaddb" data-bykplain${off}>Add an OpenAI-compatible service</button></div></div>`;
}
const warn = () => `<div class="bykwarn${B.field === "ack" ? " bykbad" : ""}">${D!.icon("help", 16)}<div><p>${esc(BYK_WARN)}</p>${B.st?.full ? `<p class="bykterms">${esc(BYK_ZDR_FULL)}</p>` : ""}<p class="bykterms">${esc(BYK_TERMS)}</p>
  <label class="bykack"><input type="checkbox" data-bykack${B.f.ack ? " checked" : ""}><span>I understand</span></label>${B.field === "ack" && B.err ? `<em class="bykerr" role="alert">${esc(B.err)}</em>` : ""}</div></div>`;
const btns = (label: string, busyLabel: string) => `<div class="sbtns"><button class="sprim" type="submit"${B.busy || !B.f.ack ? " disabled" : ""}>${B.busy === "add" ? busyLabel : label}</button><button type="button" class="sa" data-bykcancel${B.busy ? " disabled" : ""}>Cancel</button></div>`;
// Use OpenCode: the plan that pays (Go or pay as you go) and a personal API key pasted from the OpenCode console.
function ocForm(): string {
  const head = `<div class="sfh">${svcHead("opencode", D!.icon("spark"))}<b>Use OpenCode</b></div>`;
  return `<form class="sc sform" id="bykf" novalidate data-unsaved="byok">${head}
    <p class="sfine bykcgsteps">1Helm uses your OpenCode Go plan through a personal API key. Make the key in the OpenCode console, then paste it here.</p>
    <ol class="bykcgsteps bykol">
      <li>Open the <a href="${OC_CONSOLE}" target="_blank" rel="noopener noreferrer">OpenCode console</a> and go to Account, then Personal API keys.</li>
      <li>Click Add API key and choose your workspace.</li>
      <li>Click Create, then copy the key.</li>
      <li>Paste the key below.</li>
    </ol>
    <fieldset class="bykplans"><legend>Which OpenCode plan pays for the AI?</legend>
      <label><input type="radio" name="bykplan" data-bykplanpick="go"${B.f.plan !== "payg" ? " checked" : ""}><span>My OpenCode Go plan</span></label>
      <label><input type="radio" name="bykplan" data-bykplanpick="payg"${B.f.plan === "payg" ? " checked" : ""}><span>Pay as you go from my OpenCode balance</span></label></fieldset>
    ${keyField("ock", "Paste your OpenCode key")}
    ${warn()}${B.err && !B.field ? `<p class="bykerr" role="alert">${esc(B.err)}</p>` : ""}${btns("Connect", "Checking and connecting…")}</form>`;
}
function stepForm(): string {
  if (B.step === "plain") return `<form class="sc sform" id="bykf" novalidate data-unsaved="byok"><div class="sfh">${D!.icon("spark")}<b>Add an OpenAI-compatible service</b></div>
    ${field("base", "Service address", B.f.base, "https://api.openai.com/v1", "The address that ends before /chat/completions.", ' inputmode="url"')}
    ${keyField("key", "sk-…")}
    ${field("label", "Name (optional)", B.f.label, "The address is used when empty")}
    ${warn()}${B.err && !B.field ? `<p class="bykerr" role="alert">${esc(B.err)}</p>` : ""}${btns("Connect", "Testing and connecting…")}</form>`;
  if (B.step === "opencode") return ocForm();
  if (B.step === "claudecode") {
    const st = CC.s === "ready"
      ? `<p class="sfine bykcgsteps">1Helm runs Claude Code with your Claude plan. Open Claude, sign in there and allow it, then copy the code Claude shows and paste it here.</p>
    <div class="sbtns"><button type="button" class="sprim" data-bykccopen>Open Claude sign-in</button></div>`
      : CC.s === "failed"
        ? `<p class="bykerr" role="alert">${esc(B.err)}</p><div class="sbtns">${B.err === BYK_CREDITS_MSG ? `<button type="button" class="sprim" data-bykcredits>Add credits</button>` : `<button type="button" class="sprim" data-bykcc>Try again</button>`}</div>`
        : `<p class="sfine bykcgsteps" role="status">Getting Claude's sign-in page…</p>`;
    return `<form class="sc sform" id="bykccf" novalidate><div class="sfh">${svcHead("claudecode", D!.icon("spark"))}<b>Continue with Claude</b></div>
    ${st}
    ${CC.s === "ready" ? `<label class="sf${B.err ? " bykbad" : ""}"><span>Paste the code from Claude</span><input id="byk-cccode" data-bykf="cccode" value="${esc(B.f.cccode)}" placeholder="Code from Claude" autocomplete="off" autocapitalize="none" spellcheck="false">${B.err ? `<em class="bykerr" role="alert">${esc(B.err)}</em>` : ""}</label>
    <div class="sbtns"><button class="sprim" type="submit"${B.busy ? " disabled" : ""}>${B.busy === "cc" ? "Checking…" : "Continue"}</button><button type="button" class="sa" data-bykcancel${B.busy ? " disabled" : ""}>Cancel</button></div>` : `<div class="sbtns"><button type="button" class="sa" data-bykcancel>Cancel</button></div>`}</form>`;
  }
  if (B.step === "chatgpt") return `<form class="sc sform" id="bykcgf" novalidate><div class="sfh">${svcHead("chatgpt", D!.icon("spark"))}<b>Continue with ChatGPT</b></div>
    <p class="sfine bykcgsteps">ChatGPT opened in a new tab. Allow 1Helm there. The page you land on won't load, and that's expected: copy its address from the address bar and paste it here.</p>
    <label class="sf${B.err ? " bykbad" : ""}"><span>Paste the address of the page you land on</span><input id="byk-cgurl" data-bykf="cgurl" value="${esc(B.f.cgurl)}" placeholder="http://127.0.0.1:1479/auth/callback?code=…" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url">${B.err ? `<em class="bykerr" role="alert">${esc(B.err)}</em>` : ""}</label>
    <div class="sbtns"><button class="sprim" type="submit"${B.busy ? " disabled" : ""}>${B.busy === "cg" ? "Checking…" : "Continue"}</button><button type="button" class="sa blue" data-bykcg${B.busy ? " disabled" : ""}>Open ChatGPT again</button><button type="button" class="sa" data-bykcancel${B.busy ? " disabled" : ""}>Cancel</button></div></form>`;
  return "";
}
export function bykPage(): string {
  if (!D) return "";
  bykLoad(); cmodelsPrefetch(); if (B.st && !B.st.connections.some(c => c.kind === "claudecode" && !c.signin_again)) bykWarm(true); bykUsageLoad();
  const who = esc(D.who()), s = B.st;
  const head = `<h2>${BYK_TITLE}</h2><p class="slead">Connect the AI services you already pay for, then choose which of their models ${who} uses. ${s?.full ? `On ${esc(planName())}, they can be a backup for when your 1Helm credits run out, or you can switch to the $10 plan that runs on them.` : `${who} sends its AI work to them with your keys, so your providers bill you for the AI and 1Helm charges nothing for it.`}</p>`;
  if (!s) return B.err ? `${head}<div class="sc">${D.srow("", "Couldn't load", esc(B.err), `<button class="sa blue" data-bykretry>Try again</button>`)}</div>`
    : `${head}<div class="sc cmskel" aria-hidden="true"></div><h3 data-cmown>Models</h3><div class="sc cmskel" aria-hidden="true"></div>`;   // the very first open on a new browser: the frame of the page, no loading line
  const cs = s.connections, plan = esc(planName());
  if (B.busy === "or") return `${head}<div class="sc">${D.srow(`<span class="bico"><i class="apspin"></i></span>`, "Opening OpenRouter…", "Sign in there. You come back here.", "")}</div>`;
  const top = s.on_plan ? (cs.length ? "" : `<div class="bykplan need">${D.icon("help", 16)}<span>You're on the Bring your own key plan, so ${who} needs a connected AI service to answer. Add one below.</span></div>`)
    : s.mode === "switch" ? switchBanner(cs.length > 0)
    : fbOn() ? `<div class="bykplan bykfb">${D.icon("spark", 16)}<span><b>${esc(FALLBACK_NOTE)}</b>${who} is using your services for chat until your credits refill: when ${plan} renews, or when you add credits. The computer, browser, web search and memory need 1Helm credits, so they're paused until then.</span><button class="sa blue" data-bykcredits>Add credits</button></div>`
    : cs.length ? "" : `<div class="bykplan">${D.icon("spark", 16)}<span><b>Two ways to use it on ${plan}</b>Connect a service below, then choose: keep ${plan} and use your services only when your 1Helm credits run out, or switch now to the $${s.price} plan with them.</span></div>`;
  const list = cs.map(connRow).join(""), step = stepForm();
  const status = B.err && !B.step && !B.field ? `<p class="bykerr" role="alert">${esc(B.err)}</p>` : B.orErr ? `<p class="bykerr bykorerr" role="alert">${esc(B.orErr)}</p>` : "";
  return `${head}${top}${list}${step || addButtons()}${status}${cmodelsOwnPanel(cs.length > 0)}${s.full && cs.length && !step ? choiceHtml() : ""}
    <p class="sfine">${esc(BYK_WARN)} If a service stops working, ${who} says so in the task and points you here; ${s.full ? "while your services are in use, " : ""}1Helm never switches to its own AI instead. Keys are stored encrypted and can't be shown again, only their last 4 characters.</p>`;
}
// A full plan with a switch to the $10 plan pending (made here or in Change plan).
function switchBanner(hasConn: boolean): string {
  const plan = esc(planName()), when = esc(dateText(B.st?.switch_at) || "your next bill");
  return `<div class="bykplan bykswitch" role="status">${D!.icon("clock", 16)}<span><b>Switching to Use your own AI key on ${when}</b>You keep ${plan} until then. From then on it's $${B.st?.price || 10}/month with 100 GB of storage, ${esc(D!.who())} runs on your services, and credits you add pay for the computer, browser and memory.${hasConn ? "" : ` <em class="bykneedt">Connect a service before then, or ${esc(D!.who())} can't answer after the switch.</em>`}</span><span class="bykswbtns"><button class="sa blue" data-bykswitchnow${B.ch.busy ? " disabled" : ""}>${B.ch.busy === "now" ? "One moment…" : "Switch now"}</button><button class="sa blue" data-bykundo${B.ch.busy ? " disabled" : ""} aria-label="Undo: keep ${plan}">${B.ch.busy === "undo" ? "One moment…" : "Undo"}</button></span></div>`;
}
// The two options (a full plan with a connected service).
function choiceHtml(): string {
  const s = B.st!, who = esc(D!.who()), plan = esc(planName());
  const opt = (m: Mode, title: string, sub: string) => { const on = s.mode === m, busy = B.ch.busy === m;
    return `<button type="button" class="sr sradio bykopt${on ? " on" : ""}" role="radio" aria-checked="${on}" data-bykmode="${m}"${B.ch.busy ? " disabled" : ""}><span class="srt"><b>${title}</b><span>${sub}</span></span><span class="rck">${busy ? `<i class="apspin"></i>` : D!.icon("check", 18)}</span></button>`; };
  return `<h3 class="bykh">How ${who} uses your services</h3>${s.mode ? "" : `<p class="bykpick">Your services are connected but not in use yet. Choose one:</p>`}
    <div class="sc bykopts" role="group" aria-label="How ${who} uses your services">
      ${opt("fallback", `Keep my plan, use my key as a backup`, `${who} uses your ${plan} credits first, as now. If they run out before your plan renews, chat switches to your services on its own until they refill. The computer, browser, web search and memory still need 1Helm credits, so they pause until then; plain chat keeps working.`)}
      <button type="button" class="sr sradio bykopt" role="button" data-bykswitchnow${B.ch.busy ? " disabled" : ""}><span class="srt"><b>Switch now to the $${s.price} plan with my key</b><span>Your plan changes now. It's $${s.price}/month with 100 GB of storage, ${who} runs on your services, and credits you add pay for the computer, browser and memory (cost + 15%). Your unused ${plan} usage becomes credits.</span></span><span class="rck">${B.ch.busy === "now" ? `<i class="apspin"></i>` : ""}</span></button>
      ${B.ch.err ? `<div class="bykcherr" role="alert"><p>${esc(B.ch.err)}</p>${B.ch.storage ? `<button type="button" class="sa blue" data-stnadd>Add storage</button>` : ""}</div>` : ""}
    </div>
    <p class="sfine bykzdr">${esc(BYK_ZDR_OPTS)}</p>`;
}
// For the "Save your AI key settings?" prompt (unsaved.ts, wired in v3.ts): a form with typed values is showing, or a request is running.
export const bykEditing = () => !!B.step && B.step !== "chatgpt" && B.step !== "claudecode" && !!B.st;
export const bykBusy = () => !!B.busy;
export function bykDiscard() { closeStep(); }
// After every Settings paint: the typed key goes back into its field (it's never written into the HTML).
export function bykAfter() { if (B.reveal) { B.reveal = false; document.querySelector("[data-cmown]")?.scrollIntoView({ block: "start", behavior: "smooth" }); }
  const k = document.getElementById(B.step === "opencode" ? "byok-ock" : "byok-key") as HTMLInputElement | null, v = B.step === "opencode" ? B.f.ock : B.key; if (k && v && k.value !== v) k.value = v; }
function closeStep() { CC.s = ""; CC.url = ""; CC.n++; B.step = ""; B.err = B.field = ""; B.key = ""; B.eye = false; B.f = { base: "", label: "", ock: "", plan: "go", ack: false, cgurl: "", cccode: "" }; }
function openStep(s: Step) { closeStep(); B.step = s; B.orErr = ""; D?.repaint(); setTimeout(() => (document.getElementById(s === "plain" ? "byok-base" : s === "opencode" ? "byok-ock" : s === "claudecode" ? "byok-cccode" : "byok-cgurl") as HTMLInputElement | null)?.focus(), 60); }

// ---- the requests ----
function applyState(d: any) { B.st = "on_plan" in d ? stOf(d) : B.st; }
function test(id: string) {
  if (B.busy) return;
  B.busy = "test"; B.busyId = id; B.err = B.field = ""; D?.repaint();
  call("/byok/test", { id }).then(d => { if (d.connections) applyState(d); else B.err = say(d.error, "Couldn't test the connection. Try again in a minute.", d.code); })
    .catch(() => { B.err = "Couldn't test the connection. Check your internet and try again."; }).finally(() => { B.busy = ""; B.busyId = ""; D?.repaint(); });
}
// A service connected: read the models again, then bring the Models section into view (its first slot says Choose a model). Never picks one.
function reveal() { void cmodelsRefresh().then(() => { B.reveal = true; D?.repaint(); }); }
function afterAdd(name: string) {
  const none = !B.st?.custom.model && !!B.st?.on_plan;
  D?.note(true, `${name} connected`, none ? "Now choose your models, below." : B.st?.on_plan ? `${D.who()} can use its models from your next message.` : B.st?.mode === "fallback" ? `${D.who()} uses it only if your 1Helm credits run out.` : B.st?.mode === "switch" ? `It's used from ${dateText(B.st.switch_at) || "your next bill"}, when you switch to the $10 plan.` : "Now choose how to use it, below.");
  reveal();
  if (B.st?.full && !B.st.mode && !none) setTimeout(() => document.querySelector(".bykopts")?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
}
function add() {
  if (B.busy) return;
  if (!B.f.ack) { B.err = "Read the note about your provider and tick the box to connect."; B.field = "ack"; D?.repaint(); return; }
  const oc = B.step === "opencode";
  B.busy = "add"; B.err = B.field = ""; D?.repaint();
  call(oc ? "/byok/opencode" : "/byok/connections", oc ? { key: B.f.ock.trim(), plan: B.f.plan === "payg" ? "payg" : "go", ack: true } : { base: B.f.base.trim(), key: B.key.trim(), label: B.f.label.trim(), ack: true }).then(d => {
    if (d.ok) { applyState(d); const name = oc ? "OpenCode" : B.st?.connections.find(c => c.id === d.id)?.label || "Service"; closeStep(); afterAdd(name); }
    else { B.err = say(d.error, "Couldn't connect. Try again in a minute.", d.code); B.field = d.field || ""; if (d.test?.checks?.reach?.error) B.err += ` ${d.test.checks.reach.error}`; }
  }).catch(() => { B.err = "Couldn't connect. Check your internet and try again."; }).finally(() => { B.busy = ""; D?.repaint(); });
}
function ocPlan(plan: string) {
  if (B.busy) return;
  B.busy = "plan"; B.err = B.field = ""; D?.repaint();
  call("/byok/opencode-plan", { plan }).then(d => { if (d.connections) applyState(d); else B.err = say(d.error, "Couldn't switch the plan. Try again in a minute.", d.code); })
    .catch(() => { B.err = "Couldn't switch the plan. Check your internet and try again."; }).finally(() => { B.busy = ""; D?.repaint(); });
}
function remove(id: string) {
  const st = B.st, c = st?.connections.find(x => x.id === id); if (B.busy || !st || !c) return;
  const who = D!.who(), last = st.connections.length === 1;
  const T = c.kind === "claudecode" ? { title: "Disconnect Claude Code?", gone: "1Helm signs out of Claude Code and forgets the sign-in. To remove 1Helm in Claude too, open your Claude settings." }
    : c.kind === "chatgpt" ? { title: "Disconnect ChatGPT?", gone: "1Helm stops using your ChatGPT plan and forgets the sign-in. To remove 1Helm in ChatGPT too, open your ChatGPT settings." }
    : c.kind === "openrouter" ? { title: "Disconnect OpenRouter?", gone: "1Helm forgets the key. To cancel it at OpenRouter too, delete it in your OpenRouter account." }
    : { title: `Remove ${c.label}?`, gone: "The key is deleted from 1Helm. You can add it again any time." };
  const models = " Its models leave Models, and you'll be asked to choose replacements.";
  const q: Promise<"ok" | "alt" | "no"> = last && st.full && st.mode === "switch"
    ? choose({ title: T.title, body: `You're switching to the $10 plan with your own key on ${dateText(st.switch_at) || "your next bill"}. Without a connected service, ${who} can't answer after that. Cancel the switch too and keep ${planName()}?`, confirm: `Remove and keep ${planName()}`, alt: "Remove, keep the switch" })
    : ask({ title: T.title, body: `${last && st.on_plan ? `You're on the Bring your own key plan, so ${who} can't answer until you connect a service again or change plan. ` : last && st.mode === "fallback" ? `${who} stops using it as a backup. If your 1Helm credits run out, ${who} pauses until they refill or you add more. ` : ""}${T.gone}${models}`, confirm: c.kind === "plain" ? "Remove" : "Disconnect", danger: true }).then(ok => ok ? "ok" : "no");
  q.then(pick => {
    if (pick === "no" || B.busy) return;
    B.busy = "del"; B.busyId = id; D?.repaint();
    call("/byok/remove", { id, ...(last && st.full && st.mode === "switch" && pick === "ok" ? { cancel_switch: true } : {}) }).then(d => {
      if (d.error) throw new Error(say(d.error, "Try again in a minute.", d.code)); applyState(d); B.ch.err = ""; B.ch.storage = false;
      D?.note(true, `${c.label} removed`, d.removed_models ? "Its models were taken out of Models. Choose replacements there." : "It's deleted from 1Helm."); void cmodelsRefresh().then(() => D?.repaint());
    }).catch(e => D?.note(false, "Couldn't remove it", e?.message || "Try again in a minute.")).finally(() => { B.busy = ""; B.busyId = ""; D?.repaint(); });
  });
}
// Pick (or change, or undo) the option on a full plan. Undo = "" (keep my plan; the services stay connected, not in use until chosen again).
async function pickMode(m: Mode | "undo") {
  const st = B.st; if (!st || !st.full || B.ch.busy) return;
  const mode: Mode = m === "undo" ? "" : m, who = D!.who(), plan = planName();
  if (mode === st.mode) return;
  const ok = mode === "switch" ? await ask({ title: `Switch to the $${st.price} plan with your key?`, body: `You keep ${plan} until the end of this billing period. Then it's $${st.price}/month with 100 GB of storage and ${who} runs on your services; credits you add pay for the computer, browser and memory. Nothing is charged now, and you can undo it until then. From that day, 1Helm's zero-data-retention guarantee doesn't cover the AI part.`, confirm: "Switch at renewal" })
    : st.mode === "switch" ? await ask({ title: `Keep ${plan}?`, body: `Your switch to the $${st.price} plan is cancelled. Nothing is charged.${mode === "fallback" ? ` Your services become a backup for when your 1Helm credits run out.` : " They stay connected; choose how to use them any time."}`, confirm: `Keep ${plan}` })
    : true;
  if (!ok) return;
  B.ch = { busy: m, err: "", storage: false }; D?.repaint();
  try {
    const d = await call("/byok/mode", { mode });
    if (d?.error) { B.ch.err = say(d.error, "Couldn't change that. Try again in a minute.", d.code); B.ch.storage = !!d.storage; if (m === "undo") D?.note(false, "Your plan didn't change", B.ch.err); }
    else {
      B.st = stOf(d);
      if (mode === "switch") D?.note(true, `Switching on ${dateText(B.st.switch_at) || "your next bill"}`, `You keep ${plan} until then. Nothing was charged.`);
      else if (mode === "fallback") D?.note(true, "Your services are your backup", `${who} uses your 1Helm credits first and switches to your services only if they run out.`);
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
    if (!st.connections.length) { end(); D.note(false, "Connect an AI service first", "Add one in AI services, then switch."); D.open(); return; }
    const pv = await call("/byok/switch-preview");
    if (!pv || pv.error) { const m = say(pv?.error, "Try again in a minute.", pv?.code); end(pv?.error ? m : ""); D.note(false, "Your plan didn't change", m); return; }
    const plan = planName(), when = dateText(pv.next_bill_at) || "your next bill date";
    const ok = await ask({ title: `Switch to the $${pv.price} plan now?`, body: `Your plan changes now. ${Number(pv.unused_nano) > 0 ? `${pv.unused} of unused ${plan} usage becomes credits.` : `You have no unused ${plan} usage to move to credits.`} Your next bill is $${pv.price} on ${when}. There's no refund.`, confirm: "Switch now" });
    if (!ok) return end();
    const d = await call("/byok/switch-now", {});
    if (d?.error) { const m = say(d.error, "Try again in a minute.", d.code); end(m, !!d.storage); D.note(false, "Your plan didn't change", m); return; }
    if (D.api) { location.assign(`${location.pathname}?plan=byok&moved=${encodeURIComponent(String(d.moved || ""))}&bill=${encodeURIComponent(String(d.next_bill_at || ""))}${location.hash}`); return; }   // the app reloads so the plan, usage and storage are the new ones
    B.st = stOf(await call("/byok")); end();
    D.note(true, "You're on the Bring your own key plan", `${d.moved} of unused usage is now credits.`);
  } catch { end("Couldn't change that. Check your internet and try again."); }
}
// ---- Sign in with OpenRouter ----
function orSignIn() {
  if (B.busy) return;
  B.busy = "or"; B.orErr = ""; B.err = B.field = ""; D?.repaint();   // the page leaves
  if (D?.orStart) { const to = D.orStart; setTimeout(() => location.assign(to), 40); return; }
  setTimeout(() => {   // sandbox: OpenRouter said yes
    mockSt = { ...mockSt, connections: [...mockSt.connections.filter(c => c.kind !== "openrouter"), MOCK_CONNS.openrouter] };
    B.busy = ""; B.st = stOf(mockSt); D?.note(true, "OpenRouter connected", "Now choose your models, below."); D?.repaint(); reveal();
  }, 700);
}
// ---- Continue with ChatGPT ----
function cgOpen() { if (D?.cgStart) window.open(D.cgStart, "_blank", "noopener"); else window.open("about:blank", "_blank", "noopener"); }   // OpenAI's page in a new tab; this tab stays here for the paste
function cgSignIn() { if (B.busy) return; const first = B.step !== "chatgpt"; cgOpen(); if (first) openStep("chatgpt"); }
function cgFinish() {
  if (B.busy) return;
  const url = B.f.cgurl.trim();
  if (!url) { B.err = CG_WHY.paste; D?.repaint(); return; }
  B.busy = "cg"; B.err = ""; D?.repaint();
  call("/byok/chatgpt/finish", { url }).then(d => {
    if (d?.ok) { applyState(d); closeStep(); afterAdd("ChatGPT"); } else B.err = say(d?.error, CG_WHY[d?.why] || CG_WHY.exchange, d?.code) || CG_WHY.exchange;
  }).catch(() => { B.err = "Couldn't reach 1Helm. Check your internet and try again."; }).finally(() => { B.busy = ""; D?.repaint(); });
}
// ---- Continue with Claude: Anthropic's page opens in a new tab, the code it shows is pasted here ----
// only Anthropic's own sign-in pages are opened: https on claude.ai, claude.com or anthropic.com, or a subdomain of them (Claude Code 2.1.316 prints claude.com/cai/oauth/authorize)
const CC_HOST = /^https:\/\/([a-z0-9-]+\.)*(claude\.ai|claude\.com|anthropic\.com)(:443)?(\/|\?|#|$)/i;
export const ccHostOk = (u: string) => CC_HOST.test(u);
function ccSignIn() {
  if (B.busy) return;
  bykWarm(true);
  if (B.step !== "claudecode") openStep("claudecode");
  const n = ++CC.n; CC.s = "loading"; CC.url = ""; B.err = ""; B.f.cccode = ""; D?.repaint();   // the step shows at once, no blank tab
  const fail = (m: string) => { if (n !== CC.n) return; CC.s = "failed"; B.err = m; D?.repaint(); };
  call("/byok/claudecode/start", {}).then(d => {
    if (n !== CC.n) return;
    if (d?.url && ccHostOk(String(d.url))) { CC.s = "ready"; CC.url = String(d.url); D?.repaint(); setTimeout(() => document.getElementById("byk-cccode")?.focus(), 60); }
    else fail(d?.url ? "Claude's sign-in page wasn't the one expected. Try again in a minute." : say(d?.error, "Claude isn't reachable right now. Try again in a minute.", d?.code));
  }).catch(() => fail("Couldn't reach 1Helm. Check your internet and try again."));
}
function ccOpen() { if (CC.url) window.open(CC.url, "_blank", "noopener"); }   // on the person's own click, so no popup blocker
function ccFinish() {
  if (B.busy) return;
  const code = B.f.cccode.trim();
  if (!code) { B.err = "Paste the code Claude shows after you sign in."; D?.repaint(); return; }
  B.busy = "cc"; B.err = ""; D?.repaint();
  call("/byok/claudecode/finish", { code }).then(d => {
    if (d?.ok) { applyState(d); closeStep(); afterAdd("Claude Code"); } else B.err = say(d?.error, "That code didn't work. Copy the whole code Claude shows and try again.", d?.code);
  }).catch(() => { B.err = "Couldn't reach 1Helm. Check your internet and try again."; }).finally(() => { B.busy = ""; D?.repaint(); });
}
// Warm the account's Claude Code engine when a channel opens and when the composer gets focus. The server starts it only when General's model is Claude Code, and at most every 30 seconds.
let warmAt = 0, warmLoginAt = 0;
export function bykWarm(login = false) { if (!D?.api) return; if (login) { if (Date.now() - warmLoginAt < 30000) return; warmLoginAt = Date.now(); } else { if (Date.now() - warmAt < 30000) return; warmAt = Date.now(); } D.api("/byok/claudecode/warm", login ? { login: true } : {}).catch(() => {}); }
// ---- Use OpenCode: the console opens in a new tab, the key is pasted here ----
function ocOpen() { if (B.busy) return; openStep("opencode"); }

// The stream said this account just started using its backup key (byok_switch): the usage note and this page follow at once.
export function bykSwitched() {
  if (B.st?.full && B.st.mode === "fallback") B.st.fallback = { active: true, since: Date.now() }; else if (!B.loading) bykLoad(true);
  if (D?.shown()) D.repaint();
}

export function bykInit(d: Deps) {
  D = d;
  if (cacheOf()) window.setTimeout(() => { bykLoad(true); void cmodelsRefresh(); }, 1500);   // a browser that has the page cached: read both answers again in the background after the app has started
  for (const ev of ["pointerover", "focusin"]) document.addEventListener(ev, e => { if ((e.target as HTMLElement)?.closest?.("[data-bykcc]")) bykWarm(true); });   // the engine starts while the person is about to click
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    // A link to Settings → AI services (a reply about a failing AI service): open it here, no page load.
    const a = t.closest?.<HTMLAnchorElement>('a[href*="settings=byok"], a[href*="settings=ai"]');
    if (a) { try { const u = new URL(a.href, location.href); if (u.origin === location.origin) { e.preventDefault(); e.stopPropagation(); B.at = 0; D?.open(); return; } } catch {} }
    // Add credits (the line under a reply when the computer, browser or web search paused for credits): Settings → Usage, Add credits open.
    const c = t.closest?.<HTMLAnchorElement>('a[href*="settings=credits"]');
    if (c) { try { const u = new URL(c.href, location.href); if (u.origin === location.origin) { e.preventDefault(); e.stopPropagation(); D?.credits(); return; } } catch {} }
    if (t.closest(`[data-sgo="${BYK_SEC}"]`)) { B.at = 0; closeStep(); B.orErr = ""; B.ch = { busy: "", err: "", storage: false }; }   
    const mb = t.closest<HTMLElement>("[data-bykmode]"); if (mb) { e.preventDefault(); pickMode(mb.dataset.bykmode as Mode); return; }
    if (t.closest("[data-bykswitchnow]")) { e.preventDefault(); bykSwitchNow(); return; }
    if (t.closest("[data-bykundo]")) { e.preventDefault(); pickMode("undo"); return; }
    if (t.closest("[data-bykcredits]")) { e.preventDefault(); D?.credits(); return; }
    const tb = t.closest<HTMLElement>("[data-byktest]"); if (tb) { e.preventDefault(); test(tb.dataset.byktest!); return; }
    const pb = t.closest<HTMLElement>("[data-bykplan]"); if (pb) { e.preventDefault(); ocPlan(pb.dataset.bykplan!); return; }
    const rb = t.closest<HTMLElement>("[data-bykrm]"); if (rb) { e.preventDefault(); remove(rb.dataset.bykrm!); return; }
    if (t.closest("[data-bykcancel]")) { e.preventDefault(); closeStep(); D?.repaint(); return; }
    if (t.closest("[data-bykcg]")) { e.preventDefault(); cgSignIn(); return; }
    if (t.closest("[data-bykccopen]")) { e.preventDefault(); ccOpen(); return; }
    if (t.closest("[data-bykcc]")) { e.preventDefault(); ccSignIn(); return; }
    if (t.closest("[data-bykor]")) { e.preventDefault(); orSignIn(); return; }
    if (t.closest("[data-bykoc]")) { e.preventDefault(); ocOpen(); return; }
    if (t.closest("[data-bykplain]")) { e.preventDefault(); openStep("plain"); return; }
    if (t.closest("[data-bykretry]")) { B.err = ""; bykLoad(true); D?.repaint(); return; }
    if (t.closest("[data-bykeye]")) { B.eye = !B.eye; const i = document.getElementById(B.step === "opencode" ? "byk-ock" : "byk-key") as HTMLInputElement | null; if (i) i.type = B.eye ? "text" : "password"; t.closest("[data-bykeye]")!.classList.toggle("on", B.eye); return; }
  }, true);
  document.addEventListener("input", e => {
    const t = e.target as HTMLInputElement, k = t.dataset?.bykf; if (!k) return;
    if (k === "key") B.key = t.value; else (B.f as any)[k] = t.value;
    if ((k === "cgurl" || k === "cccode") && B.err) { B.err = ""; t.closest(".sf")?.classList.remove("bykbad"); t.closest(".sf")?.querySelector(".bykerr")?.remove(); return; }
    if (B.field === (k === "ock" ? "key" : k)) { B.field = ""; B.err = ""; t.closest(".sf")?.classList.remove("bykbad"); t.closest(".sf")?.querySelector(".bykerr")?.remove(); }
  });
  document.addEventListener("change", e => {
    const t = e.target as HTMLInputElement;
    if (t.matches?.("[data-bykplanpick]")) { B.f.plan = t.dataset.bykplanpick === "payg" ? "payg" : "go"; return; }
    if (!t.matches?.("[data-bykack]")) return;
    B.f.ack = t.checked; if (B.field === "ack") { B.field = ""; B.err = ""; }
    const s = document.querySelector<HTMLButtonElement>("#bykf .sprim"); if (s) s.disabled = !!B.busy || !B.f.ack;
    document.querySelector(".bykwarn")?.classList.remove("bykbad"); document.querySelector(".bykwarn .bykerr")?.remove();
  });
  // Back from OpenRouter with the browser's Back button (the page restored from cache): not on the way there any more.
  window.addEventListener("pageshow", e => { if ((e as PageTransitionEvent).persisted && B.busy === "or") { B.busy = ""; D?.repaint(); } });
  document.addEventListener("submit", e => { const id = (e.target as HTMLElement).id; if (id === "bykcgf") { e.preventDefault(); e.stopImmediatePropagation(); cgFinish(); return; } if (id === "bykccf") { e.preventDefault(); e.stopImmediatePropagation(); ccFinish(); return; } if (id !== "bykf") return; e.preventDefault(); e.stopImmediatePropagation(); add(); }, true);
  // ?settings=byok (the link in a reply, or by text): open Settings on this page once the app is up. ?add=opencode: the OpenCode key step is open (the onboarding card). ?settings=credits: Add credits.
  const q = new URLSearchParams(location.search);
  if (!D.api && q.has("byokccpaste")) { B.step = "claudecode"; CC.s = "ready"; CC.url = "https://claude.ai/oauth/authorize?code=true"; }
  if (!D.api && q.has("byokcgpaste")) B.step = "chatgpt";   // sandbox: the paste step, for screenshots
  if (!D.api && q.has("byokoc")) B.step = "opencode";
  if (!D.api && q.has("byokform")) B.step = "plain";
  const sec = q.get("settings") === "byok" ? BYK_SEC : q.get("settings");   // the old name still opens the panel
  if (q.get("add") === "opencode" && D.api) { B.step = "opencode"; q.delete("add"); }
  if (q.get("add") === "claudecode" && D.api) { q.delete("add"); ccSignIn(); }   // the Continue with Claude step opens and asks for Anthropic's sign-in address (the person's click then opens the tab)   // no new tab here: the browser would block one that no click opened
  // Back from Sign in with OpenRouter: ok → the connection is there; err → the reason in plain words above the buttons.
  const oa = q.get("orauth");
  if (oa) {
    const why = q.get("orwhy") || "";
    B.at = 0;
    if (oa === "ok") { B.orErr = ""; setTimeout(() => D?.note(true, "OpenRouter connected", "Now choose your models, below."), 400); setTimeout(reveal, 900); }
    else B.orErr = OR_WHY[why] || OR_WHY.exchange;
    q.delete("orauth"); q.delete("orwhy");
    if (sec !== BYK_SEC) { const qs = q.toString(); history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash); setTimeout(() => D?.open(), 300); }
  }
  if (sec === BYK_SEC || sec === "credits") { q.delete("settings"); q.delete("add"); const qs = q.toString(); history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash); setTimeout(() => sec === BYK_SEC ? D?.open() : D?.credits(), 300); }
}
// For the page title on phone and the nav highlight.
export const bykIs = (sec: string) => sec === BYK_SEC;
