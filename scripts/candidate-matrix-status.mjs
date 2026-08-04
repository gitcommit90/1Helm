#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isoNow, REF, REPOSITORY } from "./platform-acceptance-lib.mjs";

const result = (value) => value === "success" ? "passed" : value === "failure" || value === "cancelled" ? "failed" : "blocked";
const env = process.env;
const platforms = {
  linux: { build: result(env.HELM_LINUX_BUILD_RESULT), dress_rehearsal: result(env.HELM_LINUX_REHEARSAL_RESULT), acceptance: result(env.HELM_LINUX_ACCEPTANCE_RESULT) },
  macos: { build: result(env.HELM_MAC_BUILD_RESULT), acceptance: result(env.HELM_MAC_ACCEPTANCE_RESULT) },
  windows: { build: "not_applicable", acceptance: result(env.HELM_WINDOWS_ACCEPTANCE_RESULT) },
};
for (const value of Object.values(platforms)) {
  value.result = Object.values(value).includes("failed") ? "failed" : Object.values(value).includes("blocked") ? "blocked" : "passed";
}
const status = {
  schema: 1,
  kind: "1helm-candidate-matrix-status",
  repository: REPOSITORY,
  ref: REF,
  commit: String(env.HELM_CANDIDATE_COMMIT || ""),
  version: String(env.HELM_CANDIDATE_VERSION || JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || ""),
  candidate_workflow_run_id: String(env.GITHUB_RUN_ID || ""),
  checked_at: isoNow(),
  platforms,
  promotion_bundle: result(env.HELM_PROMOTION_BUNDLE_RESULT),
  complete: Object.values(platforms).every((value) => value.result === "passed") && result(env.HELM_PROMOTION_BUNDLE_RESULT) === "passed",
  stable_touched: false,
};
if (!/^[a-f0-9]{40}$/.test(status.commit) || !/^\d+\.\d+\.\d+$/.test(status.version) || !/^\d+$/.test(status.candidate_workflow_run_id)) {
  throw new Error("Candidate matrix status requires exact commit, version, and run identity");
}
writeFileSync(resolve(env.HELM_CANDIDATE_STATUS_OUTPUT || "candidate-matrix-status.json"), `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
for (const [platform, value] of Object.entries(platforms)) process.stdout.write(`${platform}: ${value.result}\n`);
process.stdout.write(`promotion bundle: ${status.complete ? "ready" : "blocked"}\nStable touched: NO\n`);
