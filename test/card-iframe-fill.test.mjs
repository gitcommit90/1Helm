// node --import ./test/stubs/register.mjs test/card-iframe-fill.test.mjs
// browser_fill_card on hosted card fields (2026-10-30, the 405 Express Lanes toll): number, expiry, CVC, name and ZIP that live in a cross-origin
// iframe, including a page input that the page swaps for an iframe on focus or on the first keystroke. No network, no model calls.
//   1. Browser server (image/opt/1hc-browser/server.mjs, the "Typing into one field" block run against a fake CDP page):
//      a field in an iframe of its own process, a field in an iframe on the same site (execution context), a swap on focus, a swap on the first
//      keystroke, a plain page field that is left alone, and a field that cannot be filled (exact field named, hand off, no "new snapshot" loop).
//   2. The card value never appears in anything the fake browser returned, threw, or was asked to evaluate.
//   3. The outline code masks values inside frames and card-looking values, and never uses a typed value as a label.
//   4. The resident: fields carry their kind, spaced and dashed card numbers are scrubbed, a failed fill blocks look on that page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SEED } from "./helpers/seed-settings.mjs";
import { Resident } from "../src/resident.js";
import { sealSecret } from "../src/sentinel.js";

const ok = (n) => console.log("  ok", n);
const src = readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
const NUMBER = "4242424242424242", SPACED = "4242 4242 4242 4242", CVC = "737", EXP = "1231";
const leaks = (x) => { const t = typeof x === "string" ? x : JSON.stringify(x); return t.includes(NUMBER) || t.includes(SPACED) || t.includes("4242-4242") || t.includes(CVC); };

// ---------- 1. the fill block against a fake page ----------
const block = src.slice(src.indexOf("// ---- Typing into one field"), src.indexOf("const KEYS = {"));
assert.ok(block.includes("async function fillField"));
function world(spec) {
  // spec: { top: { ref: {swap: "focus"|"key"|null, hint} }, frames: [{ n, session|ctx, id, input: {ref, hint, value} }] , later: bool (frame appears only after the swap) }
  const w = { seen: [], typed: [], pageText: "", frameText: {}, evals: [], frameCalls: 0, spec, swapped: false, focusedRef: null };
  const topEl = spec.top;
  const frameVisible = () => !spec.late || w.swapped;
  const fr = () => spec.frames.map((f) => ({ id: f.id, n: f.n, ...(f.session ? { session: f.session } : { ctx: f.ctx }), url: "https://pay.example/frame" }));
  const evalJS = async (c, expr, where) => {
    w.evals.push(expr);
    const wf = typeof where === "string" ? { session: where } : where || {};
    const inFrame = spec.frames.find((f) => (wf.session && f.session === wf.session) || (wf.ctx && f.ctx === wf.ctx));
    if (expr.includes("cx: r.left")) return topEl && !inFrame ? { cx: 300, cy: 200, hint: topEl.hint } : null;
    if (expr.includes("gone: true")) { if (!topEl || w.swapped) return { gone: true }; return { gone: false, hidden: false }; }
    if (expr.includes("data-1hc', 'f")) { if (!inFrame || !frameVisible()) return null; return inFrame.input.findable === false ? null : { ref: `f${inFrame.n}e990`, score: 2, count: 1, x: 0, y: 0 }; }
    if (expr.includes("e.focus()")) { if (topEl && !inFrame && topEl.swap === "focus") w.swapped = true; w.focusedRef = inFrame ? "frame" : "page"; return null; }
    if (expr.includes("'value' in e ? e.value")) {
      if (inFrame) return inFrame.input.shows ?? w.frameText[inFrame.id] ?? "";
      if (!topEl || w.swapped) return null; return w.pageText;
    }
    throw new Error("unexpected eval: " + expr.slice(0, 80));
  };
  const c = { send: async (m, p, ms, session) => {
    if (m === "Input.insertText") {
      w.typed.push({ session: session || null, text: p.text });
      if (session) { const f = spec.frames.find((x) => x.session === session); w.frameText[f.id] = (f.input.format ? f.input.format(p.text) : p.text); }
      else if (w.focusedRef === "frame") { const f = spec.frames[0]; w.frameText[f.id] = p.text; }
      else if (topEl && !w.swapped) { if (topEl.swap === "key") w.swapped = true; else w.pageText = p.text; }
      return {};
    }
    if (m === "DOM.enable") return {};
    if (m === "DOM.getFrameOwner") return { backendNodeId: 1 };
    if (m === "DOM.getContentQuads") return { quads: [[250, 150, 450, 150, 450, 250, 250, 250]] };
    throw new Error("unexpected cdp " + m);
  } };
  const frames = async () => { w.frameCalls++; return frameVisible() ? fr() : []; };
  const box = async (c2, ref) => {
    const m = String(ref).match(/^f(\d+)e\d+$/);
    if (!m) { if (!topEl || w.swapped) throw new Error(`no element ${ref} on the page now — take a new snapshot`); return { x: 300, y: 200, tag: "input" }; }
    const f = fr().find((x) => x.n === Number(m[1])); if (!f) throw new Error(`frame f${m[1]} is gone — take a new snapshot`);
    return { x: 300, y: 200, tag: "input", session: f.session, fr: f };
  };
  const mk = new Function("evalJS", "box", "click", "frames", "sleep", "press", "FAST", "settle", `${block}\nreturn { fillField, classify };`);
  const lib = mk(evalJS, box, async () => {}, frames, (ms) => new Promise((z) => setTimeout(z, Math.min(ms, 40))), async () => {}, true);
  return { w, c, lib };
}
const fill = async (spec, a, secret = true) => { const { w, c, lib } = world(spec); let err = null; try { await lib.fillField(c, { kind: "fill", text: NUMBER, ...a }, "fill", secret); } catch (e) { err = e; } return { w, err }; };

{ // 1a. a field inside an iframe of its own process: typed through that frame's session, never the page's
  const { w, err } = await fill({ top: null, frames: [{ id: "F2", n: 2, session: "S2", input: { format: (t) => t.replace(/(.{4})/g, "$1 ").trim() } }] }, { ref: "f2e1", field: "number" });
  assert.equal(err, null); assert.deepEqual(w.typed, [{ session: "S2", text: NUMBER }]); assert.equal(w.frameText.F2, SPACED);
  ok("a card number in an iframe with its own process is typed through that iframe's session and the spaced read-back counts as taken");
}
{ // 1b. a field in an iframe on the same site as the page (no process of its own): reached by execution context, typed through the page
  const { w, err } = await fill({ top: null, frames: [{ id: "F3", n: 3, ctx: 77, input: {} }] }, { ref: "f3e4", field: "cvc", text: CVC });
  assert.equal(err, null); assert.deepEqual(w.typed, [{ session: null, text: CVC }]);
  ok("a field in a same-site cross-origin iframe is reached by its execution context");
}
{ // 1c. a placeholder input that the page swaps for an iframe on focus
  const { w, err } = await fill({ top: { swap: "focus", hint: "cardnumber Credit Card Number" }, late: true, frames: [{ id: "F2", n: 2, session: "S2", input: {} }] }, { ref: "e11", field: "number" });
  assert.equal(err, null); assert.deepEqual(w.typed, [{ session: "S2", text: NUMBER }]); assert.equal(w.pageText, "");
  ok("a page input swapped for an iframe on focus: the number goes into the iframe field, nothing into the page");
}
{ // 1d. swapped on the first keystroke (the page input is gone after typing)
  const { w, err } = await fill({ top: { swap: "key", hint: "card number" }, late: false, frames: [{ id: "F2", n: 2, session: "S2", input: {} }] }, { ref: "e11" });
  assert.equal(err, null); assert.equal(w.typed.length, 2); assert.deepEqual(w.typed[1], { session: "S2", text: NUMBER }); assert.equal(w.frameText.F2, NUMBER);
  ok("a page input swapped on the first keystroke: the text is typed again into the iframe field, with the kind read from the field's own hint");
}
{ // 1e. a plain same-page field is left alone: no frame lookup, typed in the page
  const { w, err } = await fill({ top: { swap: null, hint: "cardnumber" }, frames: [{ id: "F9", n: 9, session: "S9", input: {} }] }, { ref: "e11", field: "number" });
  assert.equal(err, null); assert.deepEqual(w.typed, [{ session: null, text: NUMBER }]); assert.equal(w.pageText, NUMBER); assert.equal(w.frameCalls, 0);
  ok("a same-page card field is typed in the page and the frames are never looked at");
}
{ // 1f. a hosted field that shows only dots after typing counts as taken
  const { err } = await fill({ top: null, frames: [{ id: "F2", n: 2, session: "S2", input: { shows: "•••• •••• •••• ••••" } }] }, { ref: "f2e1", field: "number" });
  assert.equal(err, null); ok("a hosted field that shows only dots counts as taken");
}
{ // 1g. cannot be filled: no replacement exists
  const t0 = Date.now();
  const { w, err } = await fill({ top: { swap: "focus", hint: "card number" }, late: true, frames: [] }, { ref: "e11", field: "number" });
  assert.ok(err); assert.match(err.message, /card number field e11/); assert.match(err.message, /browser_handoff/); assert.doesNotMatch(err.message, /take (a )?new snapshot/);
  assert.ok(Date.now() - t0 < 8000);
  // a frame field that stays empty
  const r2 = await fill({ top: null, frames: [{ id: "F2", n: 2, session: "S2", input: { shows: "" } }] }, { ref: "f2e1", field: "cvc", text: CVC });
  assert.ok(r2.err); assert.match(r2.err.message, /security code field f2e1/); assert.match(r2.err.message, /browser_handoff/); assert.doesNotMatch(r2.err.message, /new snapshot/);
  // a frame that is gone
  const r3 = await fill({ top: null, frames: [] }, { ref: "f5e1", field: "number" });
  assert.match(r3.err.message, /card number field f5e1/); assert.doesNotMatch(r3.err.message, /new snapshot/);
  for (const x of [err.message, r2.err.message, r3.err.message]) assert.ok(!leaks(x), "no card value in an error");
  ok("a field that cannot be filled names the field, says to hand off, and never says to take a new snapshot");
}
{ // 1h. an ordinary, non-secret fill keeps its old errors
  const { err } = await fill({ top: null, frames: [] }, { ref: "f5e1", text: "hello" }, false);
  assert.match(err.message, /frame f5 is gone — take a new snapshot/);
  ok("a non-secret fill keeps the old error text");
}
{ // 2. the card value is never in what was evaluated in the page except as typed text through insertText
  const { w } = await fill({ top: { swap: "focus", hint: "card number" }, late: true, frames: [{ id: "F2", n: 2, session: "S2", input: {} }] }, { ref: "e11", field: "number" });
  assert.ok(w.evals.every((e) => !leaks(e)), "no expression carried the card");
  ok("no evaluated expression carried the card value");
}
{ // classify
  const { lib } = world({ top: null, frames: [] });
  assert.equal(lib.classify("cc-number cardnumber Card number"), "number"); assert.equal(lib.classify("cc-exp MM / YY"), "expiry");
  assert.equal(lib.classify("cc-csc CVC"), "cvc"); assert.equal(lib.classify("postal-code zip"), "zip"); assert.equal(lib.classify("search"), null);
  ok("fields are classified by their own autocomplete, name and label");
}

// ---------- 3. the outline code ----------
{
  assert.match(src, /IN_FRAME = window\.top !== window/);
  assert.match(src, /const hide = IN_FRAME \|\| el\.type === 'password'/);
  assert.match(src, /\\d\[\\d\\s\.-\]\{11,\}/, "a 12+ digit value is masked on any field");
  assert.match(src, /tagOf\(el\) === 'input' && \/\^\(button\|submit\|reset\)\$\/\.test\(el\.type\) \? el\.value : ''/, "a typed value is never the label");
  assert.match(src, /autocomplete=' \+ acv/);
  // same-site frames are reached too
  assert.match(src, /Page\.createIsolatedWorld/); assert.match(src, /Page\.getFrameTree/);
  ok("the outline masks values inside frames and card-looking values, labels never come from a value, and same-site frames are listed");
}

// ---------- 4. the resident ----------
{
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE link_accounts (tenant_id TEXT, sealed TEXT, access_expires_at INTEGER); CREATE TABLE link_purchases (id TEXT, tenant_id TEXT, status TEXT, card_last4 TEXT, updated_at INTEGER, test INTEGER, approval_url TEXT)");
  const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows, one: () => rows[0] }; } };
  const env = { MODEL_SETTINGS: SEED, MEMORY: "off", GENUI: "off", WORKMEM: "off", PROMPT_CACHE: "off", NO_TOLERANT_STUBS: true, LINK_REAL: "1",
    VAULT_KEY: Buffer.from(new Uint8Array(32).map((_, i) => i * 5 + 3)).toString("base64"),
    DB: { prepare: (query) => { let a = []; const q = { bind: (...x) => { a = x; return q; },
      first: async () => (query.includes("perm_prefs") ? { level: "standard" } : /FROM link_purchases/.test(query) ? { id: a[0], tenant_id: "t1", test: 1 } : /FROM link_accounts/.test(query) ? { sealed: await sealSecret(env, JSON.stringify({ access_token: "tok", refresh_token: "r" })), access_expires_at: Date.now() + 3600e3 } : null),
      all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return q; } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => new Response(JSON.stringify({ id: "lsrq_1", status: "approved", amount: 2655, currency: "usd", merchant_name: "405 Express Lanes", merchant_url: "https://myaccount.405expresslanes.com/pay",
    card: { number: NUMBER, exp_month: 12, exp_year: 2031, cvc: CVC, billing_address: { name: "Pat Doe", postal_code: "92614" } } }), { status: 200 });
  try {
    const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
    R.put("tenant", "t1"); R.put("channel", "main"); R.arm = async () => {};
    const calls = []; let mode = "ok";
    R.computer = () => ({ browser: async (op, body) => { calls.push([op, body]);
      if (op === "snapshot") return { ok: true, url: "https://myaccount.405expresslanes.com/pay", title: "Pay", snapshot: "x" };
      if (mode === "fail") return { ok: false, error: `could not type the card number field e11 (typed ${NUMBER}, ${SPACED}, ${NUMBER.replace(/(\d{4})(?=\d)/g, "$1-")})` };
      return { ok: true, url: "https://myaccount.405expresslanes.com/pay", title: "Pay", snapshot: `--- inside frame f2 (pay.example) ---\n[f2e1] text input "Card number" value="${SPACED}"\n[e3] text input "x" value="${NUMBER}-${CVC}"` }; } });
    const tc = { kind: "chat", session: "s1", turn: "t1", emit: () => {}, inTool: 1, extraCharge: 0 };
    const args = { purchase_id: "lsrq_1", number_ref: "e11", expiry_ref: "e12", cvc_ref: "e13", name_ref: "e14", zip_ref: "e20" };
    const r = await R.browserToolInner("browser_fill_card", args, tc);
    assert.equal(r.code, 0, r.out);
    const act = calls.find((x) => x[0] === "act")[1];
    assert.deepEqual(act.actions.map((x) => x.field), ["number", "expiry", "cvc", "name", "zip"]); assert.equal(act.secret, true);
    assert.ok(!leaks(r.out), "the result to the model carries no card number or CVC, spaced or not"); assert.match(r.out, /••••/);
    ok("fill_card tags each field with its kind and scrubs plain, spaced and dashed card numbers from the returned outline");
    mode = "fail"; calls.length = 0;
    const f = await R.browserToolInner("browser_fill_card", args, tc);
    assert.equal(f.code, 1); assert.ok(!leaks(f.out), "an error carries no card number in any format"); assert.match(f.out, /card number field e11/);
    assert.ok(R.get("card_filled_url"), "a failed fill may leave digits on the page, so look is blocked there");
    ok("a failed fill scrubs the error, keeps its field name, and blocks screenshot look on that page");
  } finally { globalThis.fetch = realFetch; }
}
console.log("card-iframe-fill: all ok");
