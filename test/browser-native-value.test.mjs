// node --import ./test/stubs/register.mjs test/browser-native-value.test.mjs
// The text-to-value conversion for native date, time and similar inputs in the browser server. No Chrome.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
const block = src.slice(src.indexOf("// <native-value>"), src.indexOf("// </native-value>"));
assert.ok(block.includes("function nativeValue"), "the native-value block is in the browser server");
const v = new Function(`${block}\nreturn nativeValue;`)();
const same = (type, want, ...inputs) => { for (const i of inputs) assert.equal(v(type, i), want, `${type}: ${i}`); };
same("date", "2026-11-25", "2026-11-25", "11/25/2026", "11252026", "Nov 25, 2026", "November 25 2026", "nov. 25th, 2026", " 2026-11-25 ");
same("date", "2026-02-03", "2/3/2026");
same("time", "14:00", "14:00", "2:00 PM", "2pm", "0200PM", "1400", "2 p.m.");
same("time", "00:30", "12:30 AM");
same("time", "09:05:07", "9:05:07");
same("datetime-local", "2026-11-25T14:00", "2026-11-25T14:00", "11/25/2026 2:00 PM", "Nov 25, 2026 2pm", "2026-11-25 14:00");
same("month", "2026-11", "2026-11", "11/2026", "Nov 2026", "November 2026");
same("week", "2026-W48", "2026-W48", "2026W48");
same("color", "#ff8800", "#FF8800");
same("range", "40", "40");
for (const [t, bad] of [["date", "2026-13-01"], ["date", "02/30/2026"], ["date", "tomorrow"], ["date", "Foo 5 2026"], ["time", "25:00"], ["time", "13pm"], ["time", "noon"], ["datetime-local", "2026-11-25"], ["week", "2026-W60"], ["color", "red"], ["range", "abc"], ["text", "x"]]) assert.equal(v(t, bad), null, `${t}: ${bad}`);
console.log("browser-native-value: all ok");
