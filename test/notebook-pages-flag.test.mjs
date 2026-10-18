// Self-hosted installs without Hindsight keep the plain Notebook note lists. The boot answer sends flags.notebook_pages from whether Hindsight is
// configured (never from the environment name), and the web app turns the pages screen off only when that flag is explicitly false.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hsOn } from "../src/hindsight.js";

const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8"), web = readFileSync(new URL("../web/src/v3.ts", import.meta.url), "utf8");
assert.ok(worker.includes("flags: { notebook_pages: hsOn(env) }"), "boot sends the flag from the Hindsight configuration");
assert.ok(!/notebook_pages:\s*env\.ENV_NAME/.test(worker), "boot does not read the environment name for the flag");
assert.ok(web.includes('BOOT?.flags?.notebook_pages === false ? "" : "a"'), "the pages screen is off only when the flag is false");
assert.ok(!web.includes("nbPagesFlag"), "the old opt-in flag helper is gone");
assert.equal(hsOn({}), false, "no Hindsight binding: the flag is false and the note lists show");
assert.equal(hsOn({ HINDSIGHT: {}, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight" }), true);
console.log("ok notebook pages flag");
