import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { enabled, features, registry, routeEnabled, toolEnabled } from "../src/ee/index.js";
import { route2On } from "../src/ee/route2.js";
import { staticCore } from "../src/prompt/index.js";
import { readSkill } from "../src/skills/index.js";

const providerKeys = { COMPOSIO_KEY: "present", BROWSER_AGENT: "jev", ROUTER_MODE: "two", OWN_ROUTER: "on" };
for (const value of [undefined, "", "true", "1", "1HC"]) {
  const env = { ...providerKeys, ONEHELM_EE: value };
  assert.equal(enabled(env), false, `ONEHELM_EE=${value}`);
  assert.deepEqual(features(env), []);
  assert.deepEqual(registry(env), { routes: { global: [], workspace: [] }, tools: [], crons: [], durableObjects: {}, skills: [], features: [] });
  assert.equal(route2On(env), false);
  for (const [path, scope] of [["/c/card-token", "global"], ["/composio/webhook", "global"], ["/stripe/webhook", "global"], ["/api/apps", "workspace"], ["/api/portal", "workspace"], ["/api/res/main/sessions/123/livenotes", "workspace"], ["/api/res/main/event-log", "workspace"], ["/api/res/main/event-workflow", "workspace"]])
    assert.equal(routeEnabled(env, path, scope), false, `${scope} ${path}`);
  for (const tool of ["app_run", "gmail_search", "text_person", "browser_task", "buy_with_link"])
    assert.equal(toolEnabled(env, tool), false, tool);
  assert.equal(routeEnabled(env, "/api/share", "workspace"), true);
  assert.equal(toolEnabled(env, "web_search"), true);
}

const on = { ...providerKeys, ONEHELM_EE: "1hc" };
assert.equal(enabled(on), true);
assert.equal(features(on).length, 5);
assert.deepEqual(Object.keys(registry(on).durableObjects).sort(), ["BeeSync", "Ledger", "LiveNotes"]);
assert.deepEqual(registry(on).skills, ["gmail", "google-calendar", "google-drive"]);
assert.ok(registry(on).crons.includes("bee"));
assert.equal(route2On(on), true);
assert.equal(routeEnabled(on, "/api/apps", "workspace"), true);
assert.equal(toolEnabled(on, "app_run"), true);

const publicPrompt = staticCore({ apps: false, browser_task: false, ee: false });
for (const slug of ["gmail", "google-calendar", "google-drive"]) {
  assert.doesNotMatch(publicPrompt, new RegExp(`- ${slug}:`));
  assert.match(readSkill({ slug }, { ee: false }), /no skill called/);
  assert.match(readSkill({ slug }, { ee: true }), /\[1Helm skill:/);
}
assert.match(publicPrompt, /- artifacts:/);

// Core imports EE code through the one module boundary.
const src = new URL("../src/", import.meta.url);
for (const file of readdirSync(src).filter((name) => name.endsWith(".js"))) {
  const code = readFileSync(new URL(file, src), "utf8");
  for (const match of code.matchAll(/(?:from\s*|import\s*\()\s*["']\.\/ee\/([^"']+)["']/g))
    assert.equal(match[1], "index.js", `${file} imports EE ${match[1]} directly`);
}
