// Briefs state the outcome and skills decide the method (app facts only; no model wording is graded).
import test from "node:test"; import assert from "node:assert";
import { Resident } from "../src/resident.js";
import { helperJobText, START_HELPER_TOOL, SEND_HELPER_TOOL, HELPER_PROMPT, SKILL_METHOD_RULE } from "../src/helpers.js";
import { ORCHESTRATOR_NOTE, MESSAGE_TOOL, orchestrationPolicy } from "../src/ee/orchestrator.js";
import { START_TASK_TOOL } from "../src/task-kickoff.js";
import { fileRecipe } from "../src/file-recipe.js";
import { readSkill } from "../src/skills/index.js";
import { commandNotes } from "../src/spendguard.js";
import { readFileSync } from "node:fs";

const deckJob = { id: 18, name: "AI impact deck", task: "Make a 2026 AI Impact Report for executives, one slide per project, with an editable PowerPoint. Use python-pptx.", dynamic_routing: 1 };
const recipeOf = (h) => Resident.prototype.helperRecipe.call({ docFlags: () => ({}) }, h);

test("a deck job gets the presentation recipe in its first input, with no extra step", () => {
  const r = recipeOf(deckJob);
  assert.equal(r.kind, "presentation");
  const text = helperJobText(deckJob, "main", null, () => r);
  assert.ok(text.includes("new_deck.mjs"), "the deck recipe is in the first input");
  assert.ok(text.includes(readSkill({ slug: "artifacts", ref: "deck-templates" }, {}).slice(0, 200)));
  assert.ok(text.indexOf("new_deck.mjs") < text.indexOf("Use python-pptx"), "the recipe comes before the brief");
});

test("the worker instructions put the skill's method above a brief's tool, in both layouts", () => {
  for (const h of [deckJob, { ...deckJob, dynamic_routing: 0 }]) assert.ok(helperJobText(h, "main").includes(SKILL_METHOD_RULE));
  assert.match(SKILL_METHOD_RULE, /skill's method wins/);
  assert.match(SKILL_METHOD_RULE, /editable PowerPoint/);
});

test("a job that is not a file kind gets no recipe", () => {
  assert.equal(recipeOf({ name: "Compare flights", task: "Compare three flights to Denver" }), null);
  assert.ok(!helperJobText({ id: 1, name: "x", task: "compare flights", dynamic_routing: 1 }, "main", null, () => null).includes("covers this job"));
});

test("file kinds map to their references", () => {
  assert.deepEqual(fileRecipe("a PDF one-pager").refs, ["pdf", "pdf-design"]);
  assert.deepEqual(fileRecipe("a Word document memo").refs, ["document"]);
  assert.deepEqual(fileRecipe("a budget spreadsheet").refs, ["spreadsheet", "spreadsheet-formulas"]);
  assert.deepEqual(fileRecipe("a deck with a PDF copy").refs, ["presentation", "deck-templates"]);
  assert.deepEqual(fileRecipe("edit the deck at /workspace/files/q3.html").refs, ["deck-editing"]);
  for (const k of ["presentation", "deck-templates", "pdf", "pdf-design", "document", "spreadsheet", "spreadsheet-formulas", "deck-editing"])
    assert.ok(!/no reference called/.test(readSkill({ slug: "artifacts", ref: k }, {})), k);
});

test("delegation tools and guidance say to state outcomes, not methods", () => {
  const texts = [START_HELPER_TOOL.function.description, JSON.stringify(START_HELPER_TOOL.function.parameters), SEND_HELPER_TOOL.function.parameters.properties.message.description,
    HELPER_PROMPT, ORCHESTRATOR_NOTE, MESSAGE_TOOL.function.description, START_TASK_TOOL.function.parameters.properties.instructions.description,
    readFileSync(new URL("../src/prompt/08-background-helpers.md", import.meta.url), "utf8"),
    orchestrationPolicy({ orchestration: { steer: 3 } })];
  for (const t of texts) assert.match(t, /(tools?|methods?)/i);
  for (const t of texts) assert.match(t, /(didn't ask|did not ask|never prescribe|do not prescribe|does not (choose|prescribe)|not prescribe|do not (choose|name) tools|not as a tool)/i);
});

test("a helper's loop note never tells it to stop and ask the person", () => {
  const out = Array.from({ length: 12 }, (_, i) => `row ${i} ok`).join("\n");
  const w = commandNotes({ code: 0, out }, { kind: "helper" }).out, p = commandNotes({ code: 0, out }, { kind: "chat" }).out;
  assert.ok(w.includes("[1Helm:") && !/ask before trying more|Tell the person/.test(w) && /report/.test(w));
  assert.match(p, /Tell the person what you found and ask before trying more/);
  assert.ok(!/tell the person/i.test(commandNotes({ timed_out: true, out: "x", limit_ms: 6e4 }, { kind: "helper" }).out));
});
