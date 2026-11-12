// Custom dropdowns: the menu offers choices, long lists keep the wanted item, labels carry the field name, and A to B to A loops are found.
import assert from "node:assert"; import { readFileSync } from "node:fs";
import "../src/resident.js";   // loads the modules in the order the Worker does (src/ee/browser-agent.js is part of an import cycle)
import { buildMenu, loopLabels } from "../src/ee/browser-agent.js";
import { parseStructuredResponse } from "../src/structured-output.js";
import { BROWSER_RESULT_SCHEMA, BROWSER_VALUES_SCHEMA } from "../src/ee/browser-agent.js";
const labels = (m) => Object.values(m.menu);

{ // a combobox whose choices are readable is offered as a dropdown, and typing into it is not offered
  const o = '[e17] combobox "Education status:" value="Completed" options: Select | Completed | In progress\n[e18] button ""';
  const L = labels(buildMenu(o, ["Completed"], new Set()));
  assert(L.includes('Choose "Completed" in dropdown "Education status:"'));
  assert(!L.some(x => x.startsWith("Type ")));
  assert(L.includes('Click button "" ') === false && L.includes('Click button "arrow of Education status:"'));
}
{ // a long list: the item that matches a job value is offered although it is far down
  const names = Array.from({ length: 40 }, (_, i) => `Place ${i}`); names.splice(30, 0, "United States");
  const o = `[e3] combobox "Country" options: ${names.join(" | ")}`;
  const m = buildMenu(o, ["united states"], new Set()), L = labels(m);
  assert.equal(L.find(x => x.startsWith("Choose")), 'Choose "United States" in dropdown "Country"');
  assert(L.filter(x => x.startsWith("Choose")).length <= 15);
  assert.deepEqual(m.act[Object.keys(m.menu)[0]], [{ kind: "select", ref: "e3", text: "United States" }]);
}
{ // a combobox with no readable list is offered the job's own values as choices
  const L = labels(buildMenu('[e1] combobox "Country you worked in" value=""', ["Canada"], new Set()));
  assert(L.includes('Choose "Canada" in dropdown "Country you worked in"'));
}
{ // the same item under two fields is two different actions
  const o = ['[e1] combobox "Education 1"', '[e2] option "Completed"', '[e3] combobox "Education 2"', '[e4] option "Completed"'].join("\n");
  const L = labels(buildMenu(o, [], new Set())).filter(x => /option/.test(x));
  assert.deepEqual(L, ['Click option "Completed — in Education 1"', 'Click option "Completed — in Education 2"']);
}
{ // native select still works
  const L = labels(buildMenu('[e4] select "Type" selected="Select" options: Select | Full-time', [], new Set()));
  assert(L.includes('Choose "Full-time" in dropdown "Type"') && !L.some(x => x.startsWith("Click select")));
}
{ // A to B to A: every step since the first A is no progress
  const trail = [];
  assert.deepEqual(loopLabels(trail, "A", "open", "B"), []);
  assert.deepEqual(loopLabels(trail, "B", "close", "A"), ["open", "close"]);
  assert.deepEqual(loopLabels([], "A", "noop", "A"), []);
  const t2 = []; loopLabels(t2, "A", "x", "B"); assert.deepEqual(loopLabels(t2, "B", "y", "C"), []);
}
{ // the job's own schemas drop an extra top-level field instead of failing (already on master; confirmed)
  const resp = (o) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(o) } }] });
  assert.deepEqual(parseStructuredResponse(resp({ summary: "ok", extra: 1 }), BROWSER_RESULT_SCHEMA, { prune: true }), { summary: "ok" });
  assert.deepEqual(parseStructuredResponse(resp({ values: ["a"], note: "x" }), BROWSER_VALUES_SCHEMA, { prune: true }), { values: ["a"] });
}
{ // the browser service reads the job's values and has a select that handles custom dropdowns
  const s = readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
  assert(/chooseCustom\(c, a, fs_\)/.test(s) && /c\.want = /.test(s));
  assert(/select \{ref, text\}/.test(readFileSync(new URL("../src/resident.js", import.meta.url), "utf8")));
}
console.log("browser-dropdown-choose ok");
{ // a plain text input that lists choices (script-made combobox over a hidden select) is a dropdown too
  const L = labels(buildMenu('[e1] text input "Language" value="" options: Perl | Scheme\n[e2] button "Show All Items"', ["Scheme"], new Set()));
  assert(L.includes('Choose "Scheme" in dropdown "Language"') && !L.some(x => x.startsWith("Type ")));
}
