// Part of the prompt docs check that used to live in test/prompt.test.mjs (section 9): every doc, served in every switch combination,
// has no TODO and no unrendered tag. The combinations are split into four files by (combination number % 4), so the same assertions
// run on four workers instead of one. Together the four parts cover every combination exactly once.
import assert from "node:assert";
import { FLAGS } from "../../src/prompt/index.js";
import { DOCS, readDoc } from "../../src/docs/index.js";
export function runDocsCombos(part, parts = 4) {
  const DF = [...FLAGS, "route2", "task_fast", "priv_unrestricted", "priv_no_training", "priv_zdr", "checkpoint", "link_real"];
  let n = 0;
  for (let m = part; m < 1 << DF.length; m += parts) {
    const f = Object.fromEntries(DF.map((k, i) => [k, !!(m & (1 << i))]));
    for (const d of DOCS) { const out = readDoc({ name: d.name }, f); assert.doesNotMatch(out, /TODO|\{\{|\}\}/, `${d.name} served with TODO/tags ${JSON.stringify(f)}`); }
    n++;
  }
  assert.ok(n > 0);
  console.log(`  ok docs served without TODO or tags in ${n} switch combinations (part ${part + 1} of ${parts})`);
}
