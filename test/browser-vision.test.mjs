// node --import ./test/stubs/register.mjs test/browser-vision.test.mjs
// Seeing the screen when the outline is not enough (browser-vision.js): the triggers, the click positions built from OCR and vision
// results and added to the worker's closed menu, and the conversion of click_at numbers (picture pixels or 0 to 1 fractions) to the page.
// No network and no model calls.
import assert from "node:assert/strict";
import { visionReasons, unnamedControls, lastStepStalled, identityFrame, frameOf, frameText, convertClick, convertActions, ocrClickItems, pointClickItems, addVisionItems, parseTargets, observeScreen, jpegSize, probePoint, checkClickAt } from "../src/browser-vision.js";
import { buildMenu } from "../src/ee/browser-agent.js";
import { browserPurchaseGuard, buyControlTargeted } from "../src/ee/browser-tasks.js";
import { ocrLines } from "../src/ocr-look.js";
import { jpegSize as residentJpegSize } from "../src/resident.js";

const ok = (n) => console.log("  ok", n);
assert.equal(residentJpegSize, jpegSize, "one jpegSize");

// ---- triggers ----
const plain = '[e1] link "Home"\n[e2] button "Save"\n[e3] textbox "Name"';
assert.deepEqual(visionReasons({ outline: plain }), [], "a named page has no reason to look");
assert.deepEqual(visionReasons({ outline: plain, hints: { canvas: 0, clickable_images: 0 } }), []);
assert.match(visionReasons({ outline: plain, hints: { canvas: 1 } }).join(), /canvas/);
assert.match(visionReasons({ outline: plain, hints: { clickable_images: 2 } }).join(), /clickable pictures/);
assert.match(visionReasons({ outline: plain, stalled: true }).join(), /changed nothing/);
assert.equal(unnamedControls('[e1] button ""\n[e2] link ""\n[e3] button "Go"'), 2);
assert.equal(unnamedControls('[e1] combobox "Country"\n[e2] button ""\n[e3] option "France"'), 0, "a dropdown's arrow button has its name from the menu");
assert.match(visionReasons({ outline: '[e1] button ""' }).join(), /1 control with no name/);
assert.equal(lastStepStalled(["a → done", 'Click button "X" → no visible change']), true);
assert.equal(lastStepStalled(["a → done", "Looked again"]), true);
assert.equal(lastStepStalled(["a → done"]), false); assert.equal(lastStepStalled([]), false);
ok("triggers");

// ---- picture size and scale ----
const jpeg = (w, h) => Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0, 0]);
assert.deepEqual(jpegSize(jpeg(1000, 625)), { width: 1000, height: 625 });
const f = frameOf(jpeg(1000, 625), { w: 1280, h: 800 });
assert.deepEqual(f, { w: 1000, h: 625, viewW: 1280, viewH: 800 });
assert.match(frameText(f), /1000x625 pixels.*1280x800.*fractions from 0 to 1/);
assert.deepEqual(frameOf(null, undefined), identityFrame());
assert.deepEqual(identityFrame({ w: 1024, h: 768 }), { w: 1024, h: 768, viewW: 1024, viewH: 768 });
ok("frame");

// ---- click conversion ----
assert.deepEqual(convertClick({ x: 500, y: 250 }, f), { x: 640, y: 320, how: "picture pixels" });
assert.deepEqual(convertClick({ x: 0.5, y: 0.25 }, f), { x: 640, y: 200, how: "fractions" });
assert.deepEqual(convertClick({ x: 1, y: 1 }, f), { x: 1280, y: 800, how: "fractions" }, "both at most 1 means fractions");
assert.deepEqual(convertClick({ x: 0, y: 0 }, f), { x: 0, y: 0, how: "fractions" });
assert.deepEqual(convertClick({ x: 1200, y: 700 }, f), { x: 1200, y: 700, how: "page pixels" }, "outside the picture can only be page pixels");
assert.deepEqual(convertClick({ x: 600, y: 700 }, f), { x: 600, y: 700, how: "page pixels" }, "y outside the picture too");
assert.deepEqual(convertClick({ x: 640, y: 400 }, identityFrame()), { x: 640, y: 400, how: "page pixels" }, "no scale: unchanged");
assert.deepEqual(convertClick({ x: 0.5, y: 0.5 }), { x: 640, y: 400, how: "fractions" }, "no picture yet: fractions of the 1280x800 page");
assert.deepEqual(convertClick({ x: 1000, y: 625 }, f), { x: 1280, y: 800, how: "picture pixels" });
assert.ok(convertClick({ x: "a", y: 3 }, f).error); assert.ok(convertClick({ x: -1, y: 3 }, f).error);
{ const c = convertActions([{ kind: "click", ref: "e1" }, { kind: "click_at", x: 500, y: 250 }, { kind: "click_at", x: 0.5, y: 0.5 }], f);
  assert.deepEqual(c.actions[0], { kind: "click", ref: "e1" }); assert.deepEqual([c.actions[1].x, c.actions[1].y], [640, 320]); assert.deepEqual([c.actions[2].x, c.actions[2].y], [640, 400]);
  assert.equal(c.notes.length, 2); assert.match(c.notes[0], /picture pixels/); assert.match(c.notes[1], /fractions/); }
{ const input = [{ kind: "click_at", x: 500, y: 250 }]; convertActions(input, f); assert.equal(input[0].x, 500, "input is not changed"); }
{ const c = convertActions([{ kind: "click_at", x: 640, y: 400 }], identityFrame()); assert.equal(c.notes.length, 0, "nothing converted, nothing said"); }
assert.deepEqual(convertActions(undefined, f), { actions: undefined, notes: [] });
ok("conversion");

// ---- menu items ----
const ocr = ocrLines({ lines: [{ text: "Save", x: 100, y: 100, w: 40, h: 20 }, { text: "Play", x: 300, y: 500, w: 60, h: 30 }, { text: "x".repeat(80), x: 0, y: 0, w: 10, h: 10 }, { text: "Play", x: 900, y: 500, w: 60, h: 30 }] });
const items = ocrClickItems(ocr, plain, identityFrame());
assert.deepEqual(items.map((i) => i.label), ['Click at (330, 515): text "Play" read on the screen'], "text already in the outline and long sentences are left out; a repeat is one item");
assert.deepEqual(items[0].act, [{ kind: "click_at", x: 330, y: 515, label: "Play" }]);
{ const sc = ocrClickItems(ocr, "", { w: 640, h: 400, viewW: 1280, viewH: 800 }); assert.equal(sc.find((i) => /Save/.test(i.label)).act[0].x, 240, "positions in a scaled picture are page pixels"); }
const pts = pointClickItems([{ what: "magnifier icon at the top right", points: [[500, 62]] }, { what: "nothing", points: [] }], { w: 1000, h: 625, viewW: 1280, viewH: 800 });
assert.deepEqual(pts.map((i) => i.label), ["Click at (640, 79): magnifier icon at the top right (found on the screen by a vision model)"]);
assert.deepEqual(parseTargets("- magnifier icon\n2. gear at the bottom\nok\n\n* cart icon\n* fourth thing here"), ["magnifier icon", "gear at the bottom", "cart icon"]);
{ const built = buildMenu(plain, [], new Set()), n0 = Object.keys(built.menu).length;
  addVisionItems(built, [...pts, ...items], new Set([items[0].label]));
  assert.equal(Object.keys(built.menu).length, n0 + 1, "a dead item is not added");
  const id = Object.keys(built.menu).find((k) => /magnifier/.test(built.menu[k]));
  assert.deepEqual(built.act[id], [{ kind: "click_at", x: 640, y: 79, label: "magnifier icon at the top right" }]);
  assert.equal(new Set(Object.keys(built.menu)).size, Object.keys(built.menu).length, "ids are unique");
  assert.ok(built.ids.FINISH && built.menu[built.ids.FINISH], "the special items are still there"); }
ok("menu items");

// ---- the payment guard sees a click_at by its label ----
assert.equal(browserPurchaseGuard([{ kind: "click_at", x: 5, y: 5, label: "magnifier icon", pageText: "" }], { url: "https://x.test/", snapshot: plain }), null);
assert.match(browserPurchaseGuard([{ kind: "click_at", x: 5, y: 5, label: "Buy now", pageText: "" }], { url: "https://x.test/", snapshot: plain }), /payment/);
assert.match(browserPurchaseGuard([{ kind: "click_at", x: 5, y: 5, label: "icon", pageText: "" }], { url: "https://x.test/checkout", snapshot: plain }), /checkout/, "never on a checkout page");
assert.match(browserPurchaseGuard([{ kind: "click_at", x: 5, y: 5 }], { url: "https://x.test/", snapshot: plain }), /unknown action/, "a click_at with no label (the helper's own) is still refused");
assert.equal(buyControlTargeted([{ kind: "click_at", x: 5, y: 5, label: "Place order" }], { url: "https://x.test/", snapshot: plain }), true);
assert.equal(buyControlTargeted([{ kind: "click_at", x: 5, y: 5, label: "menu" }], { url: "https://x.test/", snapshot: plain }), false);
ok("guard");

// ---- what is really at the point is read in plain code and checked too ----
{ const pg = { url: "https://x.test/", snapshot: plain }, vague = { kind: "click_at", x: 5, y: 5, label: "green button at the bottom right (found on the screen by a vision model)" };
  assert.match(browserPurchaseGuard([{ ...vague, pageText: "Place order" }], pg), /payment/, "a vague label over a Place order button is stopped");
  assert.match(browserPurchaseGuard([{ kind: "click_at", x: 5, y: 5, label: "Place order", pageText: "" }], pg), /payment/, "OCR text Place order is stopped");
  assert.equal(browserPurchaseGuard([{ ...vague, label: "magnifier icon", pageText: "Search" }], pg), null, "a harmless icon passes");
  assert.match(browserPurchaseGuard([vague], pg), /could not be checked/, "a point that was not read is stopped");
  assert.equal(buyControlTargeted([{ ...vague, pageText: "Complete purchase" }], pg), true);
  assert.equal(buyControlTargeted([{ ...vague, pageText: "Search" }], pg), false);
  const C = (probe) => ({ browser: async (op, body) => { assert.equal(op, "screenshot"); assert.deepEqual(body.probe_at, [5, 5]); return probe; } });
  assert.deepEqual(await probePoint(C({ ok: true, probe: { tag: "button", text: "Place order" } }), { x: 5, y: 5 }), { text: "Place order" });
  assert.match((await probePoint(C({ ok: true, probe: { error: "the point is inside a cross-origin frame" } }), { x: 5, y: 5 })).error, /cross-origin/);
  assert.ok((await probePoint(C({ ok: true }), { x: 5, y: 5 })).error, "an older service gives no probe: unreadable");
  assert.ok((await probePoint({ browser: async () => { throw new Error("down"); } }, { x: 5, y: 5 })).error);
  const r1 = await checkClickAt(C({ ok: true, probe: { text: "Search" } }), [{ kind: "scroll" }, { kind: "click_at", x: 5, y: 5, label: "icon" }], {});
  assert.equal(r1.acts[1].pageText, "Search"); assert.deepEqual(r1.acts[0], { kind: "scroll" });
  assert.ok((await checkClickAt(C({ ok: true }), [{ kind: "click_at", x: 5, y: 5, label: "icon" }], {})).error); }
ok("what is at the point");

// ---- a look that cannot be taken changes nothing ----
{ let spent = 0; const res = { env: {}, ledger: () => ({ reserve: async () => { spent++; return { ok: true }; }, settle: async () => {} }) };
  assert.equal(await observeScreen(res, { browser: async () => ({ ok: false }) }, {}), null);
  assert.equal(await observeScreen(res, { browser: async () => ({ ok: true, jpeg_base64: "AA==", url: "about:blank" }) }, {}), null, "a blank page is not looked at");
  assert.equal(spent, 0, "nothing was reserved"); }
ok("no look");
console.log("PASS browser-vision");
