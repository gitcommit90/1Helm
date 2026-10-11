// node test/reply-grouping.test.mjs: one agent message paints as ONE bubble per run of text (src/progress-dedupe.ts joinedReply feeding
// src/genui-render.ts replyParts, exactly what v3.ts partHtml does). Tool steps never split it; a card does. Duplicate progress lines
// (live or saved, old turns included) collapse; the final answer is untouched. Live and reload share this one path.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "rg-")), entry = join(dir, "entry.ts"), out = join(dir, "rg.mjs");
const P = (f) => JSON.stringify(new URL(`../src/${f}`, import.meta.url).pathname);
writeFileSync(entry, `export * from ${P("progress-dedupe.ts")}; export { replyParts } from ${P("genui-render.ts")};`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error", mainFields: ["module", "main"], loader: { ".json": "json" } });
const { dedupeProgress: dd, joinedReply: jr, replyParts, splitParts, workStep, finishReply } = await import(out);
const bubbles = (pre, body, live = false) => replyParts(jr(pre, body), live).map((p) => p.k + ":" + p.s);
const kinds = (pre, body) => replyParts(jr(pre, body)).map((p) => p.k).join(",");

// 1. consecutive text parts: one bubble, joined as paragraphs
assert.deepEqual(bubbles(["Looking at your calendar.", "Now the invoices."], "You have 2 meetings and 1 invoice due."), ["text:Looking at your calendar.\n\nNow the invoices.\n\nYou have 2 meetings and 1 invoice due."]);
// 2. only the final answer: unchanged
assert.deepEqual(bubbles([], "Just the answer."), ["text:Just the answer."]);
// 3. live: pre parts and a body still streaming append into the same bubble; an empty body leaves the progress lines as the bubble
assert.equal(kinds(["Checking."], "Here is"), "text"); assert.equal(kinds(["Checking."], ""), "text");
// 4. a card between texts splits the bubble where it sits
const CARD = 'root = Stack([a])\na = Say("Pick one")';
assert.equal(kinds(["Let me look.", CARD], "Which one do you want?"), "text,card,text");
// 5. exact and near duplicates show once (both Captain examples), final answer intact
const E2 = "You're right — that shared last name should've clicked. Let me pull that email back up and get the actual details.";
assert.deepEqual(bubbles([E2, E2], "The final answer."), [`text:${E2}\n\nThe final answer.`]);
assert.deepEqual(dd(["Got it — I'll check your CRM for that number.", "I'll search your CRM for that phone number now.", "Found 2 people."]), ["I'll search your CRM for that phone number now.", "Found 2 people."]);
// 6. different lines stay; code blocks are never touched
assert.equal(dd(["Searching your email for the invoice.", "Now checking the calendar for Tuesday.", "Done."]).length, 3);
const CODE = "Run:\n```\nls\n```"; assert.deepEqual(dd([CODE, CODE, "end"]), [CODE, CODE, "end"]);
// 7. a saved old turn (parts array) renders the same as the live stream that produced it (reload == live)
const parts = ["Let me check.", "Let me check.", "Here you go."];
assert.deepEqual(bubbles(parts.slice(0, -1), parts.at(-1)), bubbles(["Let me check."], "Here you go."));
// 8. the final answer is never dropped even if it repeats a progress line
assert.deepEqual(dd(["Same words here again.", "Same words here again."]), ["Same words here again."]);

// ---- progress vs answer: live stream and reload must land on the same split ----
// live(texts, serverReply): each text streams in, a tool call follows every text but the last that has tools after it (ends: array of bool)
const live = (texts, toolAfter, serverReply) => { const r = { body: "" }; texts.forEach((t, i) => { r.body += t; if (toolAfter[i]) workStep(r); }); finishReply(r, serverReply); return r; };
const SEVEN = ["Got it, I'll find the contact first.", "I'll look up the account record now.", "Found the contact, now I'll look up the company.", "I found the bakery record, now I'm looking up the owner.", "Found it, so I'll add the note to the record.", "Done. Added the note to the record.", "The owner is Sam, and the note is saved on the bakery record."];
const ANS = SEVEN[6];
let L = live(SEVEN, [1, 1, 1, 1, 1, 1, 0], ANS);
assert.equal(L.body, ANS); assert.deepEqual(L.prog, SEVEN.slice(0, 6)); assert.deepEqual(L.pre || [], []);
assert.deepEqual(bubbles(L.pre, L.body), [`text:${ANS}`], "the reply bubble shows only the answer");
let R7 = splitParts(SEVEN, [0, 1, 2, 3, 4, 5]);   // reload with the server's flags
assert.deepEqual(R7, { prog: SEVEN.slice(0, 6), answer: [ANS] });
assert.deepEqual(splitParts(SEVEN, null), R7, "an old saved turn (no flags) classifies on render by the same rule");
assert.deepEqual(splitParts(SEVEN), R7);
// answer written, then only bookkeeping (remember): the answer stays the answer, live and reload
const A = "The invoice is due Friday for 400 dollars.";
L = live(["Looking that up for you.", A], [1, 1], A);   // the second text is followed by a remember call
assert.equal(L.body, A); assert.deepEqual(L.prog, ["Looking that up for you."]);
assert.deepEqual(splitParts(["Looking that up for you.", A], [0]), { prog: ["Looking that up for you."], answer: [A] });
// a question before a tool call stays in the reply
const Q = "Do you want the Friday or the Monday flight?";
L = live([Q, "Here you go, booked the Friday one."], [1, 0], Q + "\n\nHere you go, booked the Friday one.");
assert.equal(L.body, Q + "\n\nHere you go, booked the Friday one."); assert.deepEqual(L.prog || [], []);
assert.deepEqual(splitParts([Q, "Here you go, booked the Friday one."], null).answer, [Q, "Here you go, booked the Friday one."], "old turn: the question is not hidden");
// cards and code before a tool call are not hidden; narration around them is
const CODE2 = "Run this:\n```\nls -la\n```";
L = live(["Checking now.", CODE2, "All good."], [1, 1, 0], CODE2 + "\n\nAll good.");
assert.deepEqual(L.prog, ["Checking now."]); assert.equal(L.body, CODE2 + "\n\nAll good.");
assert.deepEqual(splitParts(["Checking now.", CODE2, "All good."], [0]), { prog: ["Checking now."], answer: [CODE2, "All good."] });
assert.ok(splitParts(["Checking now.", CARD, "Done."], null).answer.includes(CARD), "a card part is never progress");
// unsure keeps content: a snapshot (resumed stream) with the server reply shows the reply; empty server reply changes nothing
const rs = { body: "everything so far", snap: 1 }; finishReply(rs, "The answer."); assert.equal(rs.body, "The answer.");
const re = { body: "kept", prog: ["a note"] }; finishReply(re, ""); assert.equal(re.body, "kept"); assert.deepEqual(re.prog, ["a note"]);
// a single part: untouched
assert.deepEqual(splitParts(["Only."], null), { prog: [], answer: ["Only."] });
// duplicates inside narration collapse in the steps list too
L = live(["Let me check.", "Let me check.", "Result is 4."], [1, 1, 0], "Result is 4."); assert.deepEqual(L.prog, ["Let me check."]);
console.log("reply-grouping ok");
