import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileUrl, urlPath, urlQuery } from "../src/file-url.mjs";

assert.equal(fileUrl("/api", "family", "0123-abc"), "/api/res/family/files/0123-abc");
assert.equal(fileUrl("/api", "family", "0123-abc", true), "/api/res/family/files/0123-abc?dl=1");

const hostile = 'x" onerror="alert(1)';
const url = fileUrl("/api", 'family/../other', hostile, true);
assert.equal(url, "/api/res/family%2F..%2Fother/files/x%22%20onerror%3D%22alert(1)?dl=1");
assert.ok(!url.includes('"'), "an ID cannot end an HTML URL attribute");
assert.ok(!url.includes("../"), "a slug cannot add path segments");

assert.equal(fileUrl("/api", "family", "0123-abc", false, 2), "/api/res/family/files/0123-abc?v=2");
assert.equal(fileUrl("/api", "family", "0123-abc", true, 1), "/api/res/family/files/0123-abc?dl=1&v=1");
assert.equal(fileUrl("/api", "family", "0123-abc", false, undefined), "/api/res/family/files/0123-abc");

// A file address may end in ?c=<version>: a path segment or a query value is added with urlPath and urlQuery, never by joining strings.
const base = "https://api.example.com/res/s/files/f1";
assert.equal(urlPath(base, "preview"), `${base}/preview`);
assert.equal(urlPath(`${base}?c=1`, "preview"), `${base}/preview?c=1`);
assert.equal(urlPath(`${base}?c=1`, "preview", { retry: 1 }), `${base}/preview?c=1&retry=1`);
assert.equal(urlPath(base, "/preview", { retry: false }), `${base}/preview`);
assert.equal(urlQuery(base, { dl: 1 }), `${base}?dl=1`);
assert.equal(urlQuery(`${base}?c=7`, { dl: 1 }), `${base}?c=7&dl=1`);
assert.equal(urlQuery(`${base}?dl=1&c=7`, { dl: 1 }), `${base}?dl=1&c=7`);
assert.equal(urlQuery("/res/s/files/f1?c=2#x", { dl: 1 }), "/res/s/files/f1?c=2&dl=1#x");
for (const u of [base, `${base}?c=3`]) { const p = new URL(urlPath(u, "preview")); assert.ok(p.pathname.endsWith("/files/f1/preview")); assert.ok(!/\?.*\?/.test(p.search)); }
const bad = [];
for (const dir of ["../src/", "../src/ee/"]) for (const f of readdirSync(new URL(dir, import.meta.url)).filter((f) => f.endsWith(".ts"))) readFileSync(new URL(`${dir}${f}`, import.meta.url), "utf8").split("\n").forEach((l, i) => {
  if (/\$\{(u|url|href|f\.url|FV\.url)\}(\/preview|\/view|\/thumb|\?dl=1|\?retry=1|&dl=1)/.test(l) || /\b(u|url|href)\s*\+\s*["`][/?]/.test(l)) bad.push(`${dir}${f}:${i + 1}`);
});
assert.deepEqual(bad, [], "build file addresses with urlPath/urlQuery: " + bad.join(", "));

console.log("  ok Library file URLs keep IDs inside their path segments");
