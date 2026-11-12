// node --import ./test/stubs/register.mjs test/slides-images.test.mjs
// Google Slides pictures (deck-route.js slidesImageNote): a write that asked for pictures and got no createImage back says so, deterministically.
// App facts only: fake Composio results, no model wording.
import assert from "node:assert";
import { slidesImageNote, imageAsked } from "../src/deck-route.js";
import { findSkill } from "../src/skills/index.js";

const BATCH = "GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE", CREATE = "GOOGLESLIDES_CREATE_SLIDES_MARKDOWN";
const noImg = `Google Slides ${BATCH} ok:\n{"commentUpdateState":"NO_UPDATES_REQUESTED","replies":[{"createSlide":{"objectId":"s1"}},{},{"createShape":{"objectId":"t1"}},{}]}`;
const oneImg = noImg.replace("{}]}", `{"createImage":{"objectId":"i1"}}]}`);
const md = "# A\n- x ||| ![dog](https://upload.wikimedia.org/a.jpg)\n---\n# B\n- y ||| ![pup](https://upload.wikimedia.org/b.jpg)";

// markdown image tags in a batch update, no createImage in the replies -> warning
let r = slidesImageNote({ action: BATCH, arguments: { presentationId: "p", markdown_text: md } }, noImg);
assert.ok(r.startsWith(noImg) && /2 pictures asked for, 0 made/.test(r) && /NOT added/.test(r) && /createImage/.test(r));
// fewer createImage replies than asked -> warning naming the shortfall
r = slidesImageNote({ action: BATCH, arguments: { presentationId: "p", markdown_text: md } }, oneImg);
assert.ok(/2 pictures asked for, 1 made/.test(r) && /NOT added/.test(r));
// raw createImage requests that all came back as createImage -> untouched
const reqs = [{ createImage: { url: "https://u/1.jpg", elementProperties: { pageObjectId: "s1" } } }];
assert.equal(slidesImageNote({ action: BATCH, arguments: { presentationId: "p", requests: reqs } }, oneImg), oneImg);
// raw requests with a createImage reply missing -> warning
assert.ok(/1 picture asked for, 0 made/.test(slidesImageNote({ action: BATCH, arguments: { presentationId: "p", requests: reqs } }, noImg)));
// requests passed as a JSON string are still counted
assert.ok(/NOT added/.test(slidesImageNote({ action: BATCH, arguments: JSON.stringify({ requests: JSON.stringify(reqs) }) }, noImg)));
// no pictures asked for, errors, other actions -> untouched
assert.equal(slidesImageNote({ action: BATCH, arguments: { markdown_text: "# A\n- text" } }, noImg), noImg);
assert.equal(slidesImageNote({ action: BATCH, arguments: { markdown_text: md } }, "error: boom"), "error: boom");
assert.equal(slidesImageNote({ action: "GOOGLESLIDES_PRESENTATIONS_GET", arguments: { markdown_text: md } }, noImg), noImg);
// markdown create with image tags: its result can't show pictures, so it says to read the slides back
r = slidesImageNote({ action: CREATE, arguments: { title: "t", markdown_text: md } }, 'Google Slides ok:\n{"presentation_id":"p","slide_count":2}');
assert.ok(/2 pictures asked for/.test(r) && /pageElements/.test(r));
assert.deepEqual(imageAsked({ markdown_text: "![a](http://x/y.png) ![b](not a url)" }), { md: 1, raw: 0 });

// the google-slides skill names the real way in and the check
const skill = findSkill("google-slides") || {};
const text = typeof skill === "string" ? skill : skill.body || "";
assert.ok(/createImage/.test(text) && /EMU/.test(text) && /thumb\//.test(text), "skill names createImage, EMU size and a Wikimedia thumbnail");
assert.ok(/pageElements/.test(text) && /before you say it's done/i.test(text), "skill requires reading the slides back");
console.log("PASS slides-images");
