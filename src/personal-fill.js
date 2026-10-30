// "Fill in your personal details" (the Captain, 10-07): "the helper can fill things out AFTER a user 'Always allow' and then that and
// any personal detail fill out can be always allowed."
//
// A permission kind (perms.js KIND "personal") that asks at EVERY level, Standard included. It covers contact details only: name,
// phone, email, home/shipping address, date of birth. Never payment cards, passwords or ID numbers (SSN, passport, driver's license):
// those are refused here whatever the person allowed, and keep going in by Link (browser_fill_card), a saved login
// (browser_fill_login) or the person (browser_handoff), exactly as before.
//
// Enforced in code at the browser typing tools, for both engines (Resident.execComputerTool → fillGate for browser_act; the browser
// agent's own steps → fillStepGate for browser_task). It doesn't rely on the model owning up: a call types the person's details when
//   1. a field it types into is a personal field on the page (the outline line for the ref: "email input", "tel input", or a label
//      like First name / Phone / Address / ZIP / Date of birth), or
//   2. a value it types looks like a personal detail whatever the field (an email address, a phone number, a street address) or is
//      the account's own name, email or texting number, or
//   3. the model says so (fills_personal: true), which covers details code can't recognise (a name the person gave in chat).
// The fields come from a fresh outline of the page (the browser's act re-reads the page the same way before it types).
// Then: always allowed (perm_allow "personal") → it types; allowed once in this turn for this site → it types; otherwise the
// permission card: "OK to fill in your name, phone and email on opentable.com?" Allow once / Always allow filling in your details /
// Don't allow. "Allow once" covers this site for the rest of this turn; the next turn (or another site) asks again.
import { EMAIL_RE, STREET_RE, SSN_RE, turnPerms, askPerson, notAllowed, takeGrant } from "./perms.js";
import { tabKeyOf } from "./browser-tab.js";

const TYPING = new Set(["fill", "type", "select"]);   // select: a dropdown choice counts too (birth month / year, state)
const digits = (s) => String(s || "").replace(/\D/g, "");
const low = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

function luhn(d) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) { let x = +d[d.length - 1 - i]; if (i % 2) { x *= 2; if (x > 9) x -= 9; } sum += x; }
  return sum % 10 === 0;
}
// A card number anywhere in the text: written like a card (16 digits in fours, or Amex 4-6-5; Link's own test card
// "4000 0099 9000 1984" doesn't pass Luhn), or 13–19 digits in a row that pass the Luhn check. Order numbers in other groupings
// ("112-7713498-2215") aren't cards.
export const cardIn = (t) => { const s = String(t || "");
  return /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b|\b\d{4}[ -]\d{6}[ -]\d{5}\b/.test(s) || (s.match(/\b\d{13,19}\b/g) || []).some(luhn); };
// A phone number: 10–15 digits written like one (not a card, not a date/time).
const phoneLike = (t) => (String(t || "").match(/\+?\(?\d[\d\s().-]{8,20}\d/g) || []).some((m) => { const n = digits(m).length; return n >= 10 && n <= 15 && !luhn13(m) && !DATEISH.test(m); });
const DATEISH = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}/;   // "2026-10-07 1930", "10.07.2026": a date and time, not a phone
const luhn13 = (m) => digits(m).length >= 13 && luhn(digits(m));

// The outline line of a ref → { role, label } ("[e4] tel input "Phone"" → tel input / phone).
function fieldOf(outline, ref) {
  if (!ref) return { role: "", label: "" };
  const line = String(outline || "").split("\n").find((l) => l.startsWith(`[${ref}] `));
  const m = line?.match(/^\[(?:f\d+)?e\d+\] (.+?) "([^"]*)"/);
  return m ? { role: m[1], label: low(m[2]) } : { role: "", label: "" };
}

// The account's own details, for recognising them in what's typed: { names: [lowercase], emails: [lowercase], phones: [digits] }.
export async function ownDetails(res) {
  const own = { names: [], emails: [], phones: [] };
  try {
    const r = await res.env.DB.prepare("SELECT u.email, t.first_name FROM tenants t JOIN users u ON u.id=t.owner_user_id WHERE t.id=?").bind(res.get("tenant")).first();
    if (r?.email) own.emails.push(low(r.email)); if (r?.first_name) own.names.push(low(r.first_name));
  } catch {}
  try { const x = await res.env.DB.prepare("SELECT phone FROM texting WHERE tenant_id=?").bind(res.get("tenant")).first(); if (digits(x?.phone).length >= 7) own.phones.push(digits(x.phone)); } catch {}
  return own;
}

// One typed value (and the field it goes into) → { block } for a card / password / ID, or { what: [personal detail kinds] }.
const NAME_LABEL = /\bname\b|surname|\bfirst\b|\blast\b/, NOT_NAME = /user ?name|login|account|company|business|organi[sz]ation|restaurant|hotel|venue|search|nick ?name|display name|screen name|file ?name|event|group|team|list|project|pet|coupon|promo|gift/;
const ADDR_LABEL = /address|street|\bcity\b|\btown\b|\bzip\b|postal|post ?code|\bapt\b|apartment|suite|\bstate\b|province|county/, NOT_ADDR = /e-?mail|\bip\b|web ?address|url|website/;
const TRAVEL_FIELD = /airport|origin|destination|departure|\barrival|\bleaving\b|going to|flying (from|to)|\bstation\b|where (from|to)|\bfrom\b.*\bcity\b|check-?in|check-?out/;
export function classifyValue(text, field = { role: "", label: "" }, own = {}) {
  const t = String(text ?? ""), { role, label } = field;
  if (!t.trim()) return { what: [] };
  // Never typed by anyone but the person, Link or a saved login.
  if (role === "password input" || /pass ?word|passcode|passphrase/.test(label)) return { block: "password" };
  if (cardIn(t) || (/card|\bcvc\b|\bcvv\b|\bcsc\b|\bcc\b|expir|\bexp\b|mm ?\/ ?yy/.test(label) && digits(t).length >= 2)) return { block: "card" };
  if (SSN_RE.test(t) || /social security|\bssn\b|\bsin number\b|tax id|\btin\b|\bitin\b/.test(label)
    || (/passport|driver'?s? ?licen[cs]e|national id|\bid (number|no)\b|identity (card|number)/.test(label) && digits(t).length >= 4)) return { block: "id" };
  // A travel search box is a search too (skill evals run4, 10-07: united.com's "Enter your origin city, airport name, or airport
  // code." read as a name and an address, so typing SFO asked to fill in their personal details).
  const what = new Set(), lt = low(t), search = /search/.test(role) || /search|\bfind\b/.test(label) || TRAVEL_FIELD.test(label);
  if (role === "email input" || (!search && /e-?mail/.test(label)) || EMAIL_RE.test(t) || (own.emails || []).some((e) => e && lt.includes(e))) what.add("email");
  if (role === "tel input" || (!search && /phone|mobile|\bcell\b|telephone/.test(label)) || phoneLike(t) || (own.phones || []).some((p) => p.length >= 7 && digits(t).length >= 7 && digits(t).endsWith(p.slice(-7)))) what.add("phone");
  if (!search && /birth|\bdob\b|birthday/.test(label)) what.add("date of birth");
  if ((!search && ADDR_LABEL.test(label) && !NOT_ADDR.test(label)) || STREET_RE.test(t)) what.add("address");
  const words = lt.split(" ");
  if ((!search && NAME_LABEL.test(label) && !NOT_NAME.test(label) && !/\d/.test(t)) || (own.names || []).some((n) => n && words.length <= 4 && (lt === n || words.includes(n)))) what.add("name");
  return { what: [...what] };
}

// Every typed value in a batch of browser steps → { block, what: [kinds in a fixed order] }.
const ORDER = ["name", "phone", "email", "address", "date of birth"];
export function classifySteps(actions, outline, own) {
  const what = new Set();
  for (const x of actions || []) {
    if (!x || !TYPING.has(x.kind)) continue;
    const c = classifyValue(x.text, fieldOf(outline, x.ref), own);
    if (c.block) return { block: c.block, what: [] };
    for (const k of c.what) what.add(k);
  }
  return { what: ORDER.filter((k) => what.has(k)) };
}
// Plain values with no field (browser_task's task and values, before the browser agent starts).
export function classifyTexts(texts, own) {
  const what = new Set();
  for (const t of texts) { const c = classifyValue(t, undefined, own); if (c.block) return { block: c.block, what: [] }; for (const k of c.what) what.add(k); }
  return { what: ORDER.filter((k) => what.has(k)) };
}

export const BLOCKED = {
  card: "NOT TYPED: that's a payment card number or a card field. Card details never go in by typing: pay through Link (buy_with_link → check_purchase → browser_fill_card), or hand the payment step to the person with browser_handoff. Nothing was typed.",
  password: "NOT TYPED: that's a password field. A password goes in only with browser_fill_login (a saved login) or by the person (browser_handoff). Nothing was typed.",
  id: "NOT TYPED: that looks like a Social Security, passport, driver's license or other ID number. Those are typed by the person: use browser_handoff at that form, saying which fields. Nothing was typed.",
};
const listOf = (what) => !what.length ? "personal details" : what.length === 1 ? what[0] : `${what.slice(0, -1).join(", ")} and ${what.at(-1)}`;
// The site an answer covers: its registrable name, roughly (book.resy.com → resy.com; www.bbc.co.uk → bbc.co.uk).
export const siteOf = (u) => {
  let h = ""; try { h = new URL(String(u)).hostname.toLowerCase(); } catch { return ""; }
  const p = h.split("."); if (p.length <= 2 || /^\d+$/.test(p.at(-1))) return h;
  return p.slice(/^[a-z]{2}$/.test(p.at(-1)) && p.at(-2).length <= 3 ? -3 : -2).join(".");
};

// Personal details found → null when they may be typed, else the text the tool returns (NEEDS PERMISSION / NOT ALLOWED).
async function needPersonal(res, tc, what, url) {
  if (!tc || !tc.turn) return null;
  const st = await turnPerms(res, tc);
  // Standard: ordinary requested form completion is not a second consent event.
  // Keep the person's deliberately stricter Careful/Locked-down choice.
  if (st.level === "standard" || st.allow.has("personal")) return null;
  const host = siteOf(url), key = `personal@${host}`;
  if (tc.permOk?.has(key)) return null;
  if (tc.permNo?.has(key)) return notAllowed("personal");
  const cover = () => { try { res.coverSite?.(tc.session, host, "your OK to fill in your details"); } catch {} };
  if (takeGrant(res, tc, "personal")) { (tc.permOk ||= new Set()).add(key); cover(); return null; }
  const r = await askPerson(res, tc, "personal", `fill in your ${listOf(what)} on ${host || "this website"}`, key);
  if (r === null) cover();
  return r;
}

// browser_act (both engines, from Resident.execComputerTool): → null (go ahead) or the text it returns instead.
export async function fillGate(res, tc, name, a = {}) {
  if (name !== "browser_act" || !tc || !tc.turn) return null;
  const acts = (Array.isArray(a.actions) ? a.actions : []).filter((x) => x && TYPING.has(x.kind) && String(x.text ?? "").trim());
  if (!acts.length) return null;
  // The page as it is now (the browser's act re-reads it the same way before it types, so the refs line up): its fields and its site.
  let page = null;
  try { const s = await res.computer().browser("snapshot", {}, null, tabKeyOf(tc)); if (s && s.ok !== false) page = { url: s.url, snapshot: s.snapshot || "" }; } catch {}
  const c = classifySteps(acts, page?.snapshot || "", tc.ownDetails ||= await ownDetails(res));
  if (c.block) return BLOCKED[c.block];
  if (!c.what.length && a.fills_personal !== true) return null;
  return await needPersonal(res, tc, c.what, page?.url);
}

// browser_task, before the browser agent starts: its task text and values.
export async function fillTaskGate(res, tc, a = {}) {
  if (!tc || !tc.turn) return null;
  const texts = [a.task, ...(Array.isArray(a.values) ? a.values : [])].map((x) => String(x ?? ""));
  const c = classifyTexts(texts, tc.ownDetails ||= await ownDetails(res));
  if (c.block) return BLOCKED[c.block];
  if (!c.what.length && a.fills_personal !== true) return null;
  let url = a.url; if (!url) { try { url = (await res.computer().browser("snapshot", {}, null, tabKeyOf(tc)))?.url; } catch {} }
  return await needPersonal(res, tc, c.what, url);
}

// browser_task, each step the browser agent is about to take (its page outline is the one the step's refs come from).
export async function fillStepGate(res, tc, actions, page) {
  if (!tc || !tc.turn) return null;
  const c = classifySteps(actions, page?.snapshot || "", tc.ownDetails ||= await ownDetails(res));
  if (c.block) return BLOCKED[c.block];
  if (!c.what.length) return null;
  return await needPersonal(res, tc, c.what, page?.url);
}
