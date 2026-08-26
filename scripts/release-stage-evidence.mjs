#!/usr/bin/env node
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const RUN_ID = /^\d+$/;

function fail(message) { throw new Error(`Release evidence refused: ${message}`); }
function sha256File(path) {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let length;
    while ((length = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
  } finally { closeSync(descriptor); }
  return hash.digest("hex");
}
function identity(value) {
  if (!value || value.schema !== 1 || value.repository !== "gitcommit90/1Helm") fail("schema or repository mismatch");
  if (!VERSION.test(String(value.version || "")) || !HEX40.test(String(value.commit || ""))) fail("version or commit is invalid");
  if (!RUN_ID.test(String(value.run_id || "")) || !RUN_ID.test(String(value.run_attempt || ""))) fail("workflow provenance is invalid");
  if (!Array.isArray(value.artifacts)) fail("artifact inventory is missing");
  for (const artifact of value.artifacts) {
    if (!artifact || basename(String(artifact.name || "")) !== artifact.name || !HEX64.test(String(artifact.sha256 || ""))
        || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) fail("artifact inventory is invalid");
  }
  return value;
}

const [command, ...args] = process.argv.slice(2);
if (command === "create") {
  const [stage, version, commit, destination, ...files] = args;
  if (!stage || !VERSION.test(version || "") || !HEX40.test(commit || "") || !destination || !files.length) {
    fail("usage: create STAGE VERSION COMMIT DESTINATION FILE...");
  }
  const runId = String(process.env.GITHUB_RUN_ID || "");
  const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || "");
  if (!RUN_ID.test(runId) || !RUN_ID.test(runAttempt)) fail("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT are required");
  const artifacts = files.map((file) => {
    const path = resolve(file);
    return { name: basename(path), sha256: sha256File(path), bytes: statSync(path).size };
  });
  const evidence = identity({
    schema: 1,
    kind: "1helm-release-stage",
    repository: "gitcommit90/1Helm",
    stage,
    version,
    commit,
    run_id: runId,
    run_attempt: runAttempt,
    workflow: process.env.GITHUB_WORKFLOW || "local-test",
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    artifacts,
  });
  writeFileSync(resolve(destination), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(resolve(destination));
} else if (command === "verify") {
  const [evidencePath, stage, version, commit, directory = "."] = args;
  const evidence = identity(JSON.parse(readFileSync(resolve(evidencePath), "utf8")));
  if (evidence.stage !== stage || evidence.version !== version || evidence.commit !== commit) fail("stage identity does not match the requested release");
  for (const artifact of evidence.artifacts) {
    const path = resolve(directory, artifact.name);
    if (statSync(path).size !== artifact.bytes || sha256File(path) !== artifact.sha256) fail(`${artifact.name} bytes do not match evidence`);
  }
  console.log(`${stage} evidence verified for ${version} ${commit}`);
} else {
  fail("usage: release-stage-evidence.mjs create|verify ...");
}
