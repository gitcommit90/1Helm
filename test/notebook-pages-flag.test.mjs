// Self-hosted installs without Hindsight have no memory, so the Notebook says so instead of reporting a failed load. The boot answer sends
// flags.notebook_pages from whether Hindsight is configured (never from the environment name), and the web app turns the pages screen off only
// when that flag is explicitly false (it then makes no pages request).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hsOn } from "../src/hindsight.js";

const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8"), web = readFileSync(new URL("../web/src/v3.ts", import.meta.url), "utf8");
assert.ok(worker.includes("flags: { notebook_pages: hsOn(env) }"), "boot sends the flag from the Hindsight configuration");
assert.ok(!/notebook_pages:\s*env\.ENV_NAME/.test(worker), "boot does not read the environment name for the flag");
assert.ok(web.includes("const nbPagesOff = (): boolean => !!LIVE && BOOT?.flags?.notebook_pages === false;"), "the pages screen is off only when the flag is false");
assert.ok(web.includes("if (!LIVE || nbPagesOff()) return; const st = nbpState(ch.slug);"), "no pages request is made while the screen is off");
assert.ok(!web.includes("const nbVar"), "the old Notebook switch is gone");
assert.ok(!web.includes("nbPagesFlag"), "the old opt-in flag helper is gone");
assert.equal(hsOn({}), false, "no Hindsight binding: the flag is false and the Notebook says memory is off");
assert.equal(hsOn({ HINDSIGHT: {}, HINDSIGHT_API_KEY: "k", MEMORY_BACKEND: "hindsight" }), true);
console.log("ok notebook pages flag");
