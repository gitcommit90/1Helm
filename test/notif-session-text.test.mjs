// The per-task data carries the push text (notif_body, notif_why) so the Mac app's own notification reads like the phone push.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { finishedBody, whyText } from "../src/notify.js";
assert.equal(finishedBody("I found **three** flights under $400."), "I found three flights under $400.");
assert.equal(finishedBody(""), ""); assert.equal(finishedBody(null), "");
assert.equal(finishedBody("x ".repeat(200)).length, 140);
assert.equal(whyText("question"), "has a question for you"); assert.equal(whyText("answer"), "needs you"); assert.equal(whyText(""), "needs you");
const src = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8"), nsrc = readFileSync(new URL("../src/notify.js", import.meta.url), "utf8");
assert.match(src, /ALTER TABLE sessions ADD COLUMN notif_body/);
assert.match(src, /UPDATE sessions SET notif_body=\? WHERE id=\?", finishedBody\(r\.reply\)/);
const view = src.slice(src.indexOf("  sessionView("), src.indexOf("  // Texting conversations are titled"));
assert.match(view, /state === "waiting" \? \{ notif_why: whyText\(/); assert.match(view, /state !== "waiting" && state !== "working" && row\.notif_body/);
assert.match(nsrc, /body: finishedBody\(reply\) \|\|/); assert.match(nsrc, /\$\{whyText\(why\)\}/);   // the push uses the same helpers
console.log("notif-session-text: all ok");
