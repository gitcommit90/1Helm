// Shared by the sandbox sample tests: checks that a sample's golden is well formed for its type (the contract is in app-assets/app-static/sandbox-golden.js).
import assert from "node:assert/strict";

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const filled = (x) => typeof x === "string" ? x.trim() !== "" : typeof x === "number";

export function checkGoldenShape(job, g) {
  assert.ok(isObj(g), `${job}: has a golden`);
  assert.ok(["choices", "items", "text", "contains"].includes(g.type), `${job}: golden type ${g.type}`);
  if (g.type === "choices") {
    assert.equal(typeof g.list, "string", `${job}: list is a dotted path ("" for the root)`);
    assert.ok(g.id === null || (typeof g.id === "string" && g.id), `${job}: id is a field name or null`);
    assert.ok(typeof g.field === "string" && g.field, `${job}: field names the answer`);
    assert.ok(isObj(g.value) && Object.keys(g.value).length > 0, `${job}: expected answers`);
    for (const [k, v] of Object.entries(g.value)) { assert.ok(k.trim() && typeof v === "string" && v.trim(), `${job}: ${k} has an expected answer`); }
    if (g.options !== undefined) {
      assert.ok(Array.isArray(g.options) && g.options.length > 1 && g.options.every((o) => typeof o === "string"), `${job}: options`);
      for (const v of Object.values(g.value)) assert.ok(g.options.includes(v), `${job}: ${v} is one of the options`);
    }
  } else if (g.type === "items") {
    assert.ok(typeof g.list === "string" && g.list, `${job}: list names the array`);
    assert.ok(Array.isArray(g.match) && g.match.length > 0 && g.match.every((f) => typeof f === "string" && f), `${job}: match fields`);
    assert.ok(Array.isArray(g.value) && g.value.length > 0, `${job}: expected items`);
    for (const e of g.value) {
      assert.ok(isObj(e), `${job}: an expected item is an object`);
      assert.ok(g.match.some((f) => filled(e[f])), `${job}: an expected item has a match field filled`);
      for (const k of Object.keys(e)) assert.ok(g.match.includes(k), `${job}: ${k} is a match field`);
    }
  } else if (g.type === "text") {
    assert.ok(g.field === null || (typeof g.field === "string" && g.field), `${job}: field`);
    assert.ok(typeof g.max_wer === "number" && g.max_wer >= 0 && g.max_wer <= 1, `${job}: max_wer`);
    assert.ok(typeof g.value === "string" && g.value.trim(), `${job}: expected text`);
  } else {
    assert.ok(g.field === null || (typeof g.field === "string" && g.field), `${job}: field`);
    assert.ok(Array.isArray(g.value) && g.value.length > 0 && g.value.every((p) => typeof p === "string" && p.trim()), `${job}: phrases`);
  }
}
