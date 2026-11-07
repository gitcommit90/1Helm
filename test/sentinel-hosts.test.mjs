import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { interceptTargets, KEY_TARGET_MAX } from "../src/sentinel-hosts.js";
import { newStandin } from "../src/sentinel.js";

const row = (...hosts) => ({ name: "K", standin: "x", hosts: JSON.stringify(hosts) });
test("Sentinel intercepts only key hosts and 1Helm's own hosts", () => {
  const t = interceptTargets([row("api.weather.example"), row("*.github.com", "github.com")], { GATEWAY_HOST: "app.example.com", APP_HOST: "app.example.com" });
  assert.deepEqual(t.targets.sort(), ["api.weather.example", "*.github.com", "github.com", "app.example.com"].sort());
  assert.ok(!t.targets.includes("*")); assert.deepEqual(t.dropped, []);
});
test("a wildcard key site also covers its bare domain, and bad patterns are never intercepted", () => {
  const t = interceptTargets([row("*.example.com", "*", "*.com", "no spaces.example", "")], {});
  assert.deepEqual(t.targets.sort(), ["*.example.com", "example.com"]);
});
test("no saved keys means nothing but 1Helm's hosts is intercepted", () => {
  assert.deepEqual(interceptTargets([], {}).targets, []);
  assert.deepEqual(interceptTargets([{ hosts: "not json" }], { APP_HOST: "app.1helm.com" }).targets, ["app.1helm.com"]);
});
test("more key hosts than the platform allows are reported, not silently dropped", () => {
  const hosts = Array.from({ length: KEY_TARGET_MAX + 4 }, (_, i) => `h${i}.example.com`);
  const t = interceptTargets([row(...hosts)], {});
  assert.equal(t.targets.length, KEY_TARGET_MAX); assert.equal(t.dropped.length, 4);
});
test("a stand-in is random text, not a real key", () => {
  const a = newStandin(), b = newStandin(); assert.match(a, /^1hs_[A-Za-z0-9]{32}$/); assert.notEqual(a, b);
});
test("the computer starts with direct internet and no catch-all intercept", () => {
  const src = fs.readFileSync(new URL("../src/channel-computer.js", import.meta.url), "utf8");
  assert.match(src, /enableInternet: true/); assert.doesNotMatch(src, /enableInternet: !sentinel/);
  assert.doesNotMatch(src, /interceptOutboundHttps\("\*"/); assert.doesNotMatch(src, /interceptAllOutboundHttp\(S\)/);
});
