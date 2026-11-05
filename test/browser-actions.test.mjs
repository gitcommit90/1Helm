// node --import ./test/stubs/register.mjs test/browser-actions.test.mjs
// The browser_act step kinds hover, drag, double_click, right_click and key combinations: the tool schema, the key-combination parser in the
// browser server, the guards (typing and purchase), and the "Hover over" item of the browser worker's menu. No Chrome and no model calls here;
// test/browser-actions-chrome.test.mjs runs the real steps in a browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SEED } from "./helpers/seed-settings.mjs";
import { Resident } from "../src/resident.js";
import { buildMenu, hoverOpensMenu } from "../src/ee/browser-agent.js";
import { browserPurchaseGuard, buyControlTargeted } from "../src/ee/browser-tasks.js";
import { classifySteps } from "../src/personal-fill.js";

const ok = (n) => console.log("  ok", n);
const src = readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
const block = src.slice(src.indexOf("// <key-combos>"), src.indexOf("// </key-combos>"));
assert.ok(block.includes("function parseKeyCombo"), "the key-combos block is in the browser server");
const parse = new Function(`${block}\nreturn parseKeyCombo;`)();
const fails = (s, re) => assert.throws(() => parse(s), re, s);

// 1. The tool schema and description.
{
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...args) {
    if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
    const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []);
    return { toArray: () => rows, one: () => rows[0] };
  } };
  const env = { MODEL_SETTINGS: SEED, MEMORY: "off", GENUI: "off", WORKMEM: "off", PROMPT_CACHE: "off", NO_TOLERANT_STUBS: true, WS: { put: async () => {}, get: async () => null, delete: async () => {} } };
  const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
  const t = R.tools().find((x) => x.function.name === "browser_act").function;
  const items = t.parameters.properties.actions.items.properties;
  for (const k of ["click", "click_at", "fill", "type", "select", "press", "scroll", "wait", "upload", "hover", "drag", "double_click", "right_click"]) assert.ok(items.kind.enum.includes(k), k);
  for (const f of ["ref", "x", "y", "to_ref", "to_x", "to_y", "key"]) assert.ok(items[f], f);
  assert.equal(items.to_x.type, "number"); assert.equal(items.to_ref.type, "string");
  for (const w of ["hover {ref or x,y", "double_click {ref or x,y", "right_click {ref or x,y", "drag {ref or x,y, to_ref or to_x,to_y", "Control+A", "Shift+Tab", "Control+Shift+K", "press never types text"]) assert.ok(t.description.includes(w), w);
  assert.match(t.description, /click_at \{x, y\}/, "old kinds stay described");
  ok("browser_act lists the new kinds and fields, the old ones stay");
}

// 2. Key combinations.
{
  const p = parse("Control+A");
  assert.deepEqual([p.mods, p.key, p.code, p.vk, p.bits, p.text, p.commands], [["Control"], "a", "KeyA", 65, 2, "", ["selectAll"]]);
  const s = parse("Shift+Tab"); assert.deepEqual([s.mods, s.key, s.code, s.vk, s.bits, s.text], [["Shift"], "Tab", "Tab", 9, 8, "\t"]);
  const k = parse("Control+Shift+K"); assert.deepEqual([k.mods, k.key, k.code, k.bits, k.commands], [["Control", "Shift"], "K", "KeyK", 10, []]);
  assert.deepEqual(parse("shift+control+k").mods, ["Control", "Shift"], "order and case do not matter");
  assert.equal(parse("Control+Shift+Z").commands[0], "redo"); assert.equal(parse("Control+Z").commands[0], "undo");
  for (const m of ["Cmd", "Command", "Meta", "Super", "CmdOrCtrl", "ctrl"]) assert.deepEqual(parse(`${m}+C`).mods, ["Control"], m);
  assert.equal(parse("Alt+ArrowLeft").bits, 1); assert.equal(parse("Option+Left").code, "ArrowLeft");
  assert.deepEqual([parse("Enter").key, parse("Enter").text, parse("Enter").vk], ["Enter", "\r", 13]);
  assert.deepEqual([parse("Space").key, parse("Space").code, parse("Space").text], [" ", "Space", " "]);
  assert.equal(parse("Esc").key, "Escape"); assert.equal(parse("escape").key, "Escape"); assert.equal(parse("pagedown").code, "PageDown");
  assert.deepEqual([parse("F5").vk, parse("f12").vk, parse("F1").code], [116, 123, "F1"]);
  assert.equal(parse("Control+Enter").text, "", "a shortcut sends no text");
  assert.equal(parse("Control+=").code, "Equal"); assert.equal(parse("Control++").key, "+");
  assert.equal(parse("Control+1").code, "Digit1");
  for (const key of ["Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End", "Space"]) parse(key);
  ok("key combinations: modifiers, aliases, Cmd as Control, named keys, F keys, shortcut commands");
  fails("", /needs a key/); fails("Hyper+A", /unknown modifier/); fails("Control+", /no key/); fails("Control+Banana", /unsupported key/); fails("F13", /unsupported key/);
  ok("key combinations: unknown modifiers and keys are errors that name what to use");
}

// 3. Typing through key presses stays blocked: press never enters text, so card, password and ID checks cannot be skipped.
{
  for (const bad of ["4", "a", "Z", "Shift+4", "Shift+a", "@"]) fails(bad, /does not type text/);
  parse("Control+4"); parse("Alt+a");
  assert.deepEqual(classifySteps([{ kind: "press", key: "Control+A" }], "", {}), { what: [] });
  assert.deepEqual(classifySteps([{ kind: "hover", ref: "e1" }, { kind: "drag", ref: "e1", to_ref: "e2" }, { kind: "double_click", ref: "e1" }, { kind: "right_click", x: 1, y: 2 }], '[e1] textbox "Card number"', {}), { what: [] }, "the new mouse kinds type nothing");
  assert.ok(classifySteps([{ kind: "type", ref: "e1", text: "4000 0099 9000 1984" }], '[e1] textbox "Card number"', {}).block, "type into a card field is still blocked");
  assert.match(src, /press needs a key|press does not type text/);
  ok("press refuses plain characters, so card, password and ID text still goes through the blocked typing path");
}

// 4. Purchase guards: the browser worker may hover (read-only) and nothing else new; the other kinds are judged by their ref like click.
{
  const page = { url: "https://example.com/products/widget", snapshot: '[e1] button "Place order"\n[e2] link "More details"' };
  assert.equal(browserPurchaseGuard([{ kind: "hover", ref: "e2" }], page), null);
  assert.match(browserPurchaseGuard([{ kind: "hover", ref: "e1" }], page), /payment or final-order/);
  assert.match(browserPurchaseGuard([{ kind: "hover", ref: "e2" }], { ...page, url: "https://example.com/checkout" }), /checkout or payment page/);
  for (const kind of ["double_click", "right_click", "drag"]) assert.match(browserPurchaseGuard([{ kind, ref: "e2" }], page), /unknown action/, kind);
  assert.match(browserPurchaseGuard([{ kind: "press", key: "Control+A" }], page), /submitting a form/);
  assert.equal(buyControlTargeted([{ kind: "double_click", ref: "e1" }], page), true);
  assert.equal(buyControlTargeted([{ kind: "right_click", ref: "e1" }], page), true);
  assert.equal(buyControlTargeted([{ kind: "drag", ref: "e1", to_ref: "e2" }], page), true);
  assert.equal(buyControlTargeted([{ kind: "double_click", ref: "e2" }], page), false);
  assert.equal(buyControlTargeted([{ kind: "press", key: "Control+Enter" }], { ...page, url: "https://example.com/checkout" }), true);
  ok("purchase guards: hover is allowed for the worker, the other new kinds are refused there and count as buy clicks on a buy control");
}

// 5. The worker's menu offers "Hover over" for controls that open menus, and nothing else new.
{
  const o = ['[e1] button "Products" (collapsed)', '[e2] button "Account" (has popup)', '[e3] button "Main menu"', '[e4] link "Home"', '[e5] button "Save"', '[e6] textbox "Name"'].join("\n");
  const m = buildMenu(o, [], new Set()), labels = Object.values(m.menu);
  assert.deepEqual(labels.filter((l) => l.startsWith("Hover")), ['Hover over button "Products"', 'Hover over button "Account"', 'Hover over button "Main menu"']);
  const id = Object.keys(m.menu).find((k) => m.menu[k] === 'Hover over button "Products"');
  assert.deepEqual(m.act[id], [{ kind: "hover", ref: "e1" }]);
  assert.ok(!labels.some((l) => /Double|Right|Drag/i.test(l)), "no other new items");
  const base = buildMenu('[e1] button "Save"', [], new Set()); assert.ok(!Object.values(base.menu).some((l) => l.startsWith("Hover")));
  assert.equal(hoverOpensMenu("button", "Save", ""), false); assert.equal(hoverOpensMenu("link", "Home", " (collapsed)"), true);
  const dead = buildMenu(o, [], new Set(['Hover over button "Products"'])); assert.ok(!Object.values(dead.menu).includes('Hover over button "Products"'), "a hover that did nothing leaves the menu like other dead actions");
  assert.ok(Object.values(m.menu).at(-5) !== undefined && m.ids.FINISH && m.ids.ABSTAIN && m.ids.REOBSERVE, "the special items stay");
  const many = buildMenu(Array.from({ length: 30 }, (_, i) => `[e${i + 1}] button "Menu ${i}" (collapsed)`).join("\n"), [], new Set());
  assert.equal(Object.values(many.menu).filter((l) => l.startsWith("Hover")).length, 6, "at most 6 hover items");
  ok("menu: Hover over items for popup and menu buttons only, capped, and they leave the menu once dead");
}
console.log("browser-actions: all ok");

// 6. After the outline branch: a "(has popup)" or "(collapsed)" line in the real outline gives a Hover over item, and role=slider is listed.
{
  const sub = src.slice(src.indexOf("const SNAPSHOT_JS"), src.indexOf("const snapJS"));
  assert.match(sub, /\(has popup\)/); assert.match(sub, /\(collapsed\)/); assert.match(sub, /role=slider/);
  const outline = '[e1] button "Products" (has popup)\n[e2] slider "Volume"\n[e3] button "Save"';
  const m = buildMenu(outline, [], new Set());
  assert.ok(Object.values(m.menu).includes('Hover over button "Products"'));
  assert.ok(!Object.values(m.menu).includes('Hover over slider "Volume"'));
  ok("outline markers: (has popup) gives a Hover over item and role=slider is in the outline source");
}
console.log("browser-actions: outline markers ok");
