// node --import ./test/stubs/register.mjs test/browser-outline.test.mjs
// The browser service's outline (image/opt/1hc-browser/server.mjs): lines ranked before the outline is cut to size (an open dialog and the focused
// control first, then what is on screen, then what is near, then the rest; hidden controls left out and counted), the list of lines that changed
// after a browser_act, the outcome label of an act result (src/browser-effects.js), and that the worker menu (buildMenu) still builds from the new
// outline. The pure parts are loaded from server.mjs between its markers; the in-page walk runs in a real Chrome on local HTML when puppeteer and
// Chrome are on this host (skipped otherwise, said on the output). No model calls.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { actOutcome, describeOutcome, OUTCOME_LABELS } from "../src/browser-effects.js";
import "../src/resident.js";   // loads the Worker modules in their usual order first (the licensed browser worker imports a module that calls buildMenu while it loads)
import { buildMenu } from "../src/ee/browser-agent.js";

const src = readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
const block = (name) => { const m = src.match(new RegExp(`// <${name}>[^\\n]*\\n([\\s\\S]*?)// </${name}>`)); assert(m, `${name} markers in server.mjs`); return m[1]; };
const { outlineHeader, assembleOutline, outlineLines, diffOutline, formatChanges, changesFor, OUTLINE_MARK } = new Function(`${block("outline-build")}\nreturn { outlineHeader, assembleOutline, outlineLines, diffOutline, formatChanges, changesFor, OUTLINE_MARK };`)();

// ---- header and assembly ----
{
  assert.equal(outlineHeader({ total: 5, shown: 5, hidden: { css: 0, aria: 0, zero: 0 } }, 0), "", "a page that fits with nothing hidden has no header");
  const h = outlineHeader({ total: 300, shown: 100, left: { near: 20, below: 150, above: 30, side: 0 }, hidden: { css: 4, aria: 2, zero: 1 } }, 102);
  assert.match(h, /^\[outline: 100 of 300 lines come first/); assert.match(h, /200 more lines follow after a marker: 20 near the screen, 150 below the screen, 30 above the screen\./);
  assert.match(h, /from_line: 102/); assert.match(h, /not listed: 7 hidden controls \(hidden by style 4, aria-hidden 2, zero size 1\)\]$/); assert.ok(!h.includes("\n"), "one line");
  assert.match(outlineHeader({ total: 8, shown: 8, hidden: { css: 1, aria: 0, zero: 0 } }, 0), /^\[outline: all 8 lines are listed; not listed: 1 hidden control \(hidden by style 1\)\]$/);
  const a = assembleOutline({ text: "[open dialog \"Sign in\"]\n[e9] button \"OK\"", rest: "far text\n[e1] link \"Home\"", total: 4, shown: 2, left: { below: 2 }, hidden: { css: 0, aria: 0, zero: 0 } }, "\n--- inside frame f1 (x.com) ---\n[f1e1] button \"Pay\"");
  const lines = a.text.split("\n");
  assert.equal(lines[0], a.header); assert.equal(lines[1], '[open dialog "Sign in"]'); assert.equal(lines[2], '[e9] button "OK"');
  const from = Number(a.header.match(/from_line: (\d+)/)[1]); assert.equal(lines[from], OUTLINE_MARK, "from_line points at the marker, so paging from it reads the later lines"); assert.equal(lines[from + 1], "far text");
  assert.deepEqual(outlineLines(a.text), ['[open dialog "Sign in"]', '[e9] button "OK"', "--- inside frame f1 (x.com) ---", '[f1e1] button "Pay"', "far text", '[e1] link "Home"'], "header and marker are not outline lines");
  console.log("  ok header and assembly");
}

// ---- the change list ----
{
  const prev = ["# Cart", '[e1] link "Home" → /', '[e2] button "Add"', '[e3] text input "Qty" value="1"', "Total 10", "Total 10", "Old note"];
  const cur = ["# Cart", '[e1] link "Home" → /', '[e2] button "Add"', '[e3] text input "Qty" value="2"', "Total 10", '[e8] button "Checkout"', "New note"];
  const d = diffOutline(prev, cur);
  assert.deepEqual(d.added, ['[e8] button "Checkout"', "New note"]); assert.deepEqual(d.changed, ['[e3] text input "Qty" value="2"']);
  assert.deepEqual(d.removed, ["Total 10", "Old note"], "one of two equal text lines is gone");
  const t = formatChanges(d, cur.length);
  assert.match(t, /^\[outline changes since your last look/); assert.match(t, /Added:\n\[e8\] button "Checkout"\nNew note\n/); assert.match(t, /Changed \(as they are now\):\n\[e3\]/); assert.match(t, /Removed \(no longer on the page\):\nTotal 10\nOld note\n/);
  assert.match(formatChanges(diffOutline(cur, cur), 7), /No outline line changed\./);
  // refs in the change list parse the same way as in the outline
  assert.equal(buildMenu(t, [], new Set()).act.a1[0].ref, "e8", "the worker menu reads a ref from a change list line");
  // when to return the whole outline
  const big = Array.from({ length: 80 }, (_, i) => `[e${i + 1}] link "Item number ${i + 1}" → /i/${i}`), size = big.join("\n").length;
  const rec = (lines, url = "https://x.test/a") => ({ url, lines, size: lines.join("\n").length });
  assert.equal(changesFor(null, rec(big)), null, "no earlier outline");
  assert.equal(changesFor(rec(big), rec(big, "https://x.test/b")), null, "another page");
  assert.equal(changesFor(rec(big), rec(big.slice(0, 5).concat(big.slice(6)))).includes('[e6]'), true, "a short list for a small change");
  assert.equal(changesFor(rec(big.slice(0, 3)), rec(big.slice(0, 2).concat(['[e90] button "Completely different long line of text here"', '[e91] button "Another completely different long line of text"']))), null, "a list longer than the outline");
  assert.ok(size > 0);
  console.log("  ok change list");
}

// ---- outcome labels ----
{
  const L = (r, n) => actOutcome(r, n);
  const E = (e, more = {}) => ({ completed: 1, effects: { outline_changed: false, address_changed: false, visible: false, ...e }, ...more });
  assert.equal(L(E({ outline_changed: true, visible: true }), 1).label, "worked");
  assert.equal(L(E({ address_changed: true, visible: true }), 1).label, "worked");
  assert.equal(L(E({ downloads: [{ name: "a.pdf", bytes: 5000, state: "completed" }], visible: true }), 1).label, "worked");
  assert.equal(L(E({ downloads: [{ name: "a.pdf", bytes: 5, state: "in_progress" }], visible: true }), 1).label, "partly worked");
  assert.equal(L(E({ downloads: [{ name: "a.pdf", bytes: 0, state: "canceled" }], visible: true }), 1).label, "blocked");
  assert.equal(L(E({ popups_blocked: ["x.com/a"], popup_opened_for_you: false, visible: true }), 1).label, "blocked");
  assert.equal(L(E({ popups_blocked: ["x.com/a"], popup_opened_for_you: true, new_tab: true, visible: true }), 1).label, "worked");
  assert.equal(L(E({ file_chooser: true, visible: true }), 1).label, "partly worked"); assert.match(L(E({ file_chooser: true, visible: true }), 1).next, /upload step/);
  assert.equal(L(E({}), 1).label, "nothing happened"); assert.match(L(E({}), 1).next, /different element/);
  assert.equal(L(E({ requests: { count: 1, items: ["POST x/api"] } }), 1).label, "can't tell");
  assert.equal(L(E({ mutations: 3 }), 1).label, "can't tell");
  assert.equal(L(E({}, { snapshot: '[open dialog "Cookies"]\n[e2] button "Accept"' }), 1).label, "blocked"); assert.match(L(E({}, { snapshot: '[open dialog "Cookies"]' }), 1).next, /a dialog is open/);
  assert.equal(L(E({ outline_changed: true, visible: true }, { completed: 2 }), 5).label, "partly worked"); assert.match(L(E({ outline_changed: true, visible: true }, { completed: 2 }), 5).next, /only 2 of 5 steps ran/);
  assert.equal(L(E({ outline_changed: true, visible: true }, { notes: ['picked "Texas" in e9 (x); the page does not clearly show it'] }), 1).label, "partly worked");
  assert.equal(L({ completed: 1, page_changed: true }, 1).label, "worked", "an older service with no effects");
  assert.equal(L({ completed: 1, page_changed: false }, 1).label, "nothing happened");
  assert.equal(L({ completed: 1 }, 1).label, "can't tell");
  for (const r of [E({}), E({ mutations: 1 }), E({ outline_changed: true, visible: true }), E({ file_chooser: true }), { completed: 1 }]) { const o = L(r, 1); assert.ok(OUTCOME_LABELS.includes(o.label)); assert.ok(o.next.length > 10); }
  assert.match(describeOutcome(E({}), 1), /^Outcome: nothing happened\. Suggested next step: .+\. $/);
  console.log("  ok outcome labels");
}

// ---- the in-page walk, in a real Chrome ----
const CHROME = process.env.CHROME_BIN || "";   // path of a Chrome or Chromium binary; the in-page walk is skipped without it
let puppeteer = null;
for (const base of [new URL("../node_modules/", import.meta.url).pathname]) {
  try { puppeteer = createRequire(base + "x.js")("puppeteer"); } catch {}
  if (puppeteer) break;
}
if (!puppeteer || !existsSync(CHROME)) console.log("  skipped in-page walk: puppeteer or Chrome is not on this host");
else {
  const m = src.match(/const SNAPSHOT_JS = String\.raw`([\s\S]*?)`;\n\/\/ Cross-origin iframes/); assert(m, "SNAPSHOT_JS in server.mjs");
  const js = (budget = 3000, prefix = "") => m[1].replace("__WANT__", "[]").replace("__REFP__", JSON.stringify(prefix)).replace("__BUDGET__", String(budget));
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"], headless: true, defaultViewport: { width: 1280, height: 800 } });
  try {
    const page = await browser.newPage();
    const build = (s) => assembleOutline(s, "").text;
    const items = Array.from({ length: 120 }, (_, i) => `<p><a href="/p/${i}">Product link number ${i} with a long label so the outline is large</a></p>`).join("\n");
    await page.setContent(`<!doctype html><body style="margin:0"><h1>Shop</h1><button id=top>Top button</button>
      ${items}
      <button style="display:none">Hidden by style</button><button style="width:0;height:0;padding:0;border:0">Zero size</button><div aria-hidden="true"><button>Decorative</button><a href="/x">Hidden link</a></div>
      <div role="dialog" aria-label="Sign in" style="position:fixed;top:100px;left:300px;width:400px;background:#fff"><input aria-label="Email" type="text"><button>Continue</button></div>
      <button id=last>Last control</button></body>`);
    const s = await page.evaluate(js(3000));
    // the dialog, though it is last in the page, is picked for the first part; the first part is printed in page order
    const lines = build(s).split("\n");
    assert.match(lines[0], /^\[outline: /); const body = lines.slice(1);
    const iMark = body.indexOf(OUTLINE_MARK); assert.ok(iMark > 3, "a marker follows the first part");
    const firstPart = body.slice(0, iMark), later = body.slice(iMark + 1);
    const iDlg = firstPart.indexOf('[open dialog "Sign in"]');
    assert.ok(iDlg > 0 && /"Email"/.test(firstPart[iDlg + 1]) && /"Continue"/.test(firstPart[iDlg + 2]), "the dialog and its controls are in the first part, in page order");
    assert.ok(iDlg === firstPart.length - 3 || /Last control/.test(firstPart[iDlg + 3] || ""), "the dialog comes after the page text before it");
    assert.ok(firstPart.some((l) => /"Product link number 0 /.test(l)), "controls on screen are in the first part");
    assert.ok(firstPart.some((l) => /^# Shop$/.test(l)), "text on screen is in the first part");
    assert.ok(!firstPart.some((l) => /"Product link number 119 /.test(l)) && later.some((l) => /"Product link number 119 /.test(l)), "a link far below the screen is after the marker");
    assert.ok(body.some((l) => /"Last control"/.test(l)), "the last control is still listed");
    const pos = (ls, re) => ls.findIndex((l) => re.test(l));
    assert.ok(pos(firstPart, /Product link number 3 /) < pos(firstPart, /Product link number 9 /), "within the first part the page order is kept");
    // hidden elements are out and counted
    const all = body.join("\n"); assert.ok(!/Hidden by style|Zero size|Decorative|Hidden link/.test(all), "hidden controls are not listed");
    assert.deepEqual(s.hidden, { css: 1, zero: 1, aria: 2 }, "hidden controls counted by reason");
    assert.match(lines[0], /not listed: 4 hidden controls \(hidden by style 1, aria-hidden 2, zero size 1\)/);
    // omitted counts add up, and the from_line in the header points at the marker
    assert.equal(s.shown + s.rest.split("\n").length, s.total); assert.equal(Object.values(s.left).reduce((a, b) => a + b, 0), s.total - s.shown);
    assert.equal(lines[Number(lines[0].match(/from_line: (\d+)/)[1])], OUTLINE_MARK);
    assert.ok(s.left.below > 50, `most of the later lines are below the screen: ${JSON.stringify(s.left)}`);
    // a page that fits is listed whole, in page order, with no marker
    const s2 = await page.evaluate(js(200000)); const t2 = build(s2);
    assert.ok(!t2.includes(OUTLINE_MARK) && s2.rest === "" && s2.shown === s2.total); assert.match(t2.split("\n")[0], /^\[outline: all \d+ lines are listed; not listed: 4 hidden controls/);
    assert.ok(t2.indexOf("Product link number 0 ") < t2.indexOf('[open dialog') && t2.indexOf('[open dialog') < t2.indexOf("Last control"), "page order when everything fits");
    // the focused control is picked for the first part though it is at the bottom of a long page
    const none = build(await page.evaluate(js(1200))).split("\n"), pickLast = (ls) => ls.indexOf(OUTLINE_MARK) > ls.findIndex((l) => /"Last control"/.test(l)) && ls.findIndex((l) => /"Last control"/.test(l)) >= 0;
    assert.equal(pickLast(none), false, "without focus the last control is not in the first part when the budget is small");
    await page.evaluate(() => { document.querySelector("#last").focus(); });
    const s3 = await page.evaluate(js(3000)); const b3 = build(await page.evaluate(js(1200))).split("\n");
    assert.equal(pickLast(b3), true, "with focus it is");
    // scrolling changes the pick but not the page: the fingerprint stays, the lines are the same set
    await page.evaluate(() => scrollTo(0, 1200));
    const s4 = await page.evaluate(js(3000)); assert.equal(s4.sig, s3.sig, "the fingerprint of the page does not change with the scroll position");
    assert.deepEqual(outlineLines(build(s4)).sort(), outlineLines(build(s3)).sort(), "the same lines, ordered differently");
    assert.ok(build(s4).split("\n").slice(1, iMark).some((l) => /Product link number (4[0-9]) /.test(l)), "after scrolling the lines on screen come first");
    console.log("  ok ranking in Chrome");

    // refs stay with their element, also when something is added before it, and a change list shows only what moved
    await page.setContent(`<!doctype html><body><div id=box></div><button>One</button><button>Two</button><a href="/z">Three</a></body>`);
    const a1 = await page.evaluate(js()); const l1 = outlineLines(build(a1));
    const refTwo = l1.find((l) => /"Two"/.test(l)).match(/^\[(e\d+)\]/)[1];
    await page.evaluate(() => { document.querySelector("#box").innerHTML = '<button>Brand new</button>'; });
    const a2 = await page.evaluate(js()); const l2 = outlineLines(build(a2));
    assert.equal(l2.find((l) => /"Two"/.test(l)).match(/^\[(e\d+)\]/)[1], refTwo, "an old ref keeps its element after a new element is added before it");
    assert.equal(l2.filter((l) => /"Brand new"/.test(l)).length, 1);
    const d = diffOutline(l1, l2); assert.deepEqual(d.added.map((l) => l.replace(/^\[e\d+\] /, "")), ['button "Brand new"']); assert.deepEqual(d.changed, []); assert.deepEqual(d.removed, []);
    // a frame prefix is used in the refs
    const fr = await page.evaluate(js(3000, "f2")); assert.ok(outlineLines(build(fr)).every((l) => !/^\[e\d+\]/.test(l)) && outlineLines(build(fr)).some((l) => /^\[f2e\d+\] /.test(l)));
    console.log("  ok stable refs and change list in Chrome");

    // the worker menu builds from the new outline, with a header, a marker, a dialog line and refs that are not in order
    await page.setContent(`<!doctype html><body>${items}<div role="dialog" aria-label="Sign in" style="position:fixed;top:50px;left:50px;background:#fff"><input aria-label="Email" type="text"><button>Continue</button></div><button style="display:none">Gone</button></body>`);
    const s5 = await page.evaluate(js(3000)); const outline = build(s5);
    assert.match(outline.split("\n")[0], /^\[outline: /); assert.ok(outline.includes(OUTLINE_MARK));
    const { menu, act } = buildMenu(outline, ["a@b.test"], new Set()), labels = Object.values(menu);
    assert.ok(labels.includes('Click button "Continue"'), labels.slice(0, 5).join(" / ")); assert.ok(labels.includes('Type "a@b.test" into text input "Email"'));
    assert.ok(!labels.some((l) => /"\[(outline|open dialog|the lines)/.test(l)), "header, marker and dialog lines are not offered as actions");
    const emailRef = outline.match(/^\[(e\d+)\] text input "Email"/m)[1];
    assert.deepEqual(Object.values(act).find((a) => a[0].kind === "fill" && a[0].ref === emailRef)[0], { kind: "fill", ref: emailRef, text: "a@b.test" });
    // menu buttons are marked the way buildMenu on the browser-actions branch reads them, and sliders are listed
    await page.setContent(`<!doctype html><body><button aria-haspopup="menu">Account</button><button aria-expanded="false">Filters</button><button aria-expanded="true">Open one</button><button aria-haspopup="false">Plain</button>
      <div role="slider" style="width:100px;height:10px" tabindex="0" aria-label="Volume" aria-valuenow="30"></div><input type="range" aria-label="Zoom"></body>`);
    const o6 = outlineLines(build(await page.evaluate(js())));
    const line = (n) => o6.find((l) => l.includes(`"${n}"`));
    assert.match(line("Account"), /\(has popup\)$/); assert.match(line("Filters"), /\(collapsed\)$/);
    assert.ok(!/\((has popup|collapsed)\)/.test(line("Open one")) && !/\((has popup|collapsed)\)/.test(line("Plain")));
    assert.match(line("Volume"), /^\[e\d+\] slider "Volume" value="30"/); assert.match(line("Zoom"), /^\[e\d+\] range input "Zoom"/);
    assert.ok(/\((collapsed|has popup)\)/.test(line("Account").replace(/^.*?"Account"/, "")), "the marker is in the part buildMenu passes as rest");
    console.log("  ok worker menu from the new outline");
  } finally { await browser.close(); }
}
console.log("browser-outline passed");
