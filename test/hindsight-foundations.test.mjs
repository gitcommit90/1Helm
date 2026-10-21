// node --import ./test/stubs/register.mjs test/hindsight-foundations.test.mjs
// The context strings and speaker labels that the memory writers (src/hindsight-writers.js) put on every item they save.
// The Hindsight bank templates, mental models, health checks and deletion order are gone with the Hindsight server (see test/mem0.test.mjs).
import assert from "node:assert/strict";
import { speakerLabels, contextFor } from "../src/hindsight-template.js";

const ok = (name) => console.log("  ok", name);

// ================= B. context strings and labels =================
{
  const long = { first: "F".repeat(90), helper: "H".repeat(90), channel: "c".repeat(90), section: "s".repeat(90), file: "f".repeat(300), address: "a".repeat(300), summary: "z".repeat(900) };
  // No length limit (Captain 2026-10-14): long names and fields arrive whole.
  for (const k of ["chat", "note", "helper-note", "live", "bee"]) assert.ok(contextFor(k, long).includes("F".repeat(90)), `${k}: the name is kept whole`);
  assert.ok(contextFor("file", long).includes("f".repeat(300)) && contextFor("bee", long).includes("a".repeat(300)) && contextFor("bee", long).includes("z".repeat(900)) && contextFor("chat", long).includes("F".repeat(90)), "nothing is cut");
  const n = { first: "Sam", helper: "Skipper", channel: "main" };
  assert.equal(contextFor("chat", n), "1Helm chat in #main between Sam (the user) and Skipper (the user's AI assistant). The user's lines are the user's own words and facts about the user. The assistant's lines are what the assistant said or did. Each entry may name its message origin. Keep the stated origin with facts from that entry so app messages, phone texts, voice messages and poll votes remain distinguishable. A phone service is known only when the entry names it. Do not apply one entry's origin to another entry, and do not infer successful phone delivery from an assistant reply.");
  assert.equal(contextFor("scheduled", n), "Scheduled run of a Skipper workflow in #main. These lines are the assistant's own work, not the user's words.");
  assert.match(contextFor("note", { ...n, section: "about" }), /^A note Sam wrote in their 1Helm Notebook, in the about section\. It is Sam's own statement\.$/);
  assert.match(contextFor("helper-note", { ...n, section: "about" }), /^A note Skipper saved about Sam/); assert.match(contextFor("file", { ...n, file: "menu.pdf" }), /^A file in Sam's 1Helm Library: menu\.pdf\.$/);
  assert.match(contextFor("live", n), /Speaker labels come from Bee and may be missing or wrong, and a single label such as "Unknown" often covers lines from two or more people\./); assert.match(contextFor("bee", { ...n, address: "12 Main St", summary: "Lunch" }), /at 12 Main St\. These are raw transcripts captured from the person's surroundings by their Bee wearable\. They may contain other people's voices\. Speaker labels come from Bee and may be missing or wrong, and a single label such as "Unknown" often covers lines from two or more people\. Summary: Lunch/);
  assert.throws(() => contextFor("nope", n));
  assert.deepEqual(speakerLabels(n), { user: "Sam (user)", assistant: "Skipper (assistant)", notes: "Skipper (assistant notes)", scheduled: "Scheduled run prompt" });
  assert.equal(speakerLabels({}).user, "User"); assert.equal(speakerLabels({}).assistant, "Skipper (assistant)");
  ok("context strings: exact text, nothing cut from the longest inputs; named speaker labels with fallbacks");
}
