// node --import ./test/stubs/register.mjs test/howto-pin.test.mjs
// HS_USE on: helper-written "how" rows are pinned too (budgeted, oldest first), and not repeated when the profile already shows them.
import assert from "node:assert";
import { chatPinned, HOW_HELPER_BUDGET } from "../src/resident.js";
const env = { HS_USE: "on", HS_FOUNDATIONS: "on" }, T0 = 1791000000000, D = 864e5;
const row = (id, content, at, author_type) => ({ id, content, kind: "preference", sec: "how", author_type, status: "current", created: at });
const rows = [
  row("setup1", "Mac mini: Tailscale IP 100.64.7.31, user pat. Use this address for any SSH request.", T0, "agent"),
  row("setup2", "Texts go through the BlueBubbles bridge on the Mac mini.", T0 + D, "agent"),
  ...Array.from({ length: 8 }, (_, i) => row(`own${i}`, `Own preference number ${i}`, T0 + i * D, "human")),
  ...Array.from({ length: 39 }, (_, i) => row(`new${String(i).padStart(2, "0")}`, `Newer helper how note ${i}: ${"detail ".repeat(12)}`, T0 + (i + 5) * D, "agent")),
];
const p = chatPinned(env, rows, "on");
assert.ok(p.text.includes("Tailscale IP 100.64.7.31") && p.text.includes("BlueBubbles bridge"), "oldest setup notes are pinned");
assert.ok(p.text.includes("(you) Own preference number 7"), "person's own notes still pinned");
const helperPart = p.text.split("\n").filter((l) => l.startsWith("- (remembered)") || l.startsWith("- (preference)"));
assert.ok(helperPart.join("\n").length <= HOW_HELPER_BUDGET, "helper rows fit the budget");
assert.ok(helperPart.length < 41, "newer helper rows past the budget are left out");
assert.equal(chatPinned(env, rows.slice().reverse(), "on").text, p.text, "same block whatever order the rows arrive in");
assert.ok(!chatPinned(env, rows, "on", "rule: Texts go through the BlueBubbles bridge on the Mac mini.").text.includes("BlueBubbles"), "text already in the profile is not sent twice");
assert.ok(!chatPinned({}, rows, "on").text.includes("Tailscale"), "HS_USE off keeps the old block");
console.log("ok howto-pin");
