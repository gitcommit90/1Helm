import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as ack from "../src/plain-ack.js";

const INTERNAL = /\b(workers?|sub-?agents?|primary|orchestrat\w*|delegat\w*|dispatch\w*|coordinator|handoff|turn|task ids?)\b/i;

test("required-delegation and steer replies are the plain constants", () => {
  assert.equal(ack.ACK_JOB_STARTED, "Checking.");
  assert.ok(ack.ACK_JOB_STARTED_VARIANTS.length === 6);
  assert.equal(ack.ACK_UPDATE_SENT, "Got it.");
  const src = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  assert.match(src, /tc\.orchestration\?\.requiredDelegation \? this\.nextJobAck\(tc\)/);
  assert.doesNotMatch(src, /(?:\? |= )ACK_JOB_STARTED/);
  assert.match(src, /\(tc\.orchestration\?\.steer \|\| tc\.orchestration\?\.review\) \? this\.ack\(tc, ACK_UPDATE_SENT\)/);
  assert.doesNotMatch(src, /I have the work running|sent to the worker|I started the worker/);
});

test("no person-facing constant names an internal mechanism", () => {
  assert.ok(ack.PERSON_FACING_ACKS.length >= 7);
  for (const s of ack.PERSON_FACING_ACKS) assert.doesNotMatch(s, INTERNAL, s);
});

test("the main helper prompt tells it not to mention internal mechanics", () => {
  const p = readFileSync(new URL("../src/prompt/08-background-helpers.md", import.meta.url), "utf8");
  assert.match(p, /Never mention workers, sub-agents/);
});

const ORDER = ["Checking.", "Checking on this.", "On it.", "Let me take a look.", "Looking into this.", "On it."];

test("the job-started line rotates in order and never repeats back to back", () => {
  assert.deepEqual(ack.ACK_JOB_STARTED_VARIANTS, ORDER);
  let prev = "";
  for (let n = 0; n < 25; n++) {
    const s = ack.jobStartedReply(n);
    assert.equal(s, ORDER[n % 6]);
    assert.notEqual(s, prev);
    prev = s;
  }
});

test("all 6 variant lines are person-facing acks", () => {
  for (const s of ORDER) assert.ok(ack.PERSON_FACING_ACKS.includes(s), s);
  assert.equal(new Set(ack.PERSON_FACING_ACKS).size, ack.PERSON_FACING_ACKS.length - 1, "On it. is listed twice on purpose");
});

test("the app and texting both get a line from the Resident counter", () => {
  const src = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  assert.match(src, /nextJobAck\(tc = null\) \{[^}]*ack_job_n[^}]*put\("ack_job_n", n \+ 1\)[^}]*jobStartedReply\(n\)/);
  assert.doesNotMatch(src, /jobStartedReply\(tc\.viaText\)/);
  const p = readFileSync(new URL("../src/prompt/08-background-helpers.md", import.meta.url), "utf8");
  assert.match(p, /acknowledge a handed-off job in plain words such as "Checking this\."/);
});
