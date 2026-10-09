import assert from "node:assert/strict";
import { fileUrl } from "../src/file-url.mjs";

assert.equal(fileUrl("/api", "family", "0123-abc"), "/api/res/family/files/0123-abc");
assert.equal(fileUrl("/api", "family", "0123-abc", true), "/api/res/family/files/0123-abc?dl=1");

const hostile = 'x" onerror="alert(1)';
const url = fileUrl("/api", 'family/../other', hostile, true);
assert.equal(url, "/api/res/family%2F..%2Fother/files/x%22%20onerror%3D%22alert(1)?dl=1");
assert.ok(!url.includes('"'), "an ID cannot end an HTML URL attribute");
assert.ok(!url.includes("../"), "a slug cannot add path segments");

console.log("  ok Library file URLs keep IDs inside their path segments");
