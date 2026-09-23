import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/client/app.ts", import.meta.url), "utf8");
const start = app.indexOf("function progressStepCard(");
const end = app.indexOf("\nfunction progressDisclosure(", start);
const card = app.slice(start, end);

test("every ordinary work-log step shows its creation time with the shared chat formatter", () => {
  assert.ok(start >= 0 && end > start, "progress step renderer exists");
  assert.match(card, /dataset: \{ progressStepTime: String\(item\.created\) \}/);
  assert.match(card, /timeLabel\(item\.created\)/, "uses the same formatter as scheduled follow-up checks");
  assert.equal((card.match(/stepTime\(\),/g) || []).length, 4, "status, short thought, long thought, and tool rows each show a time");
});
