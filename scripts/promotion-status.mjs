#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { formatPromotionReport, validatePromotionBundle, writeVerifiedPromotion } from "./promotion-lib.mjs";

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index < 0 ? "" : String(args[index + 1] || ""); };
const has = (name) => args.includes(name);
const HELP = `Usage: npm run stable:status -- --bundle <directory> --version <x.y.z> --candidate-run <id> --candidate-artifact <id> [--json] [--write-verified <directory>]

Performs a read-only, fail-closed Stable promotion dry run. It never publishes.
In GitHub Actions, fetched main/tag/release state is passed through environment
variables; local fixture proofs may use the HELM_PROMOTION_* overrides.
`;

if (has("--help") || has("-h")) { process.stdout.write(HELP); process.exit(0); }
const known = new Set(["--bundle", "--version", "--candidate-run", "--candidate-artifact", "--json", "--write-verified"]);
for (let index = 0; index < args.length; index += 1) {
  if (!known.has(args[index])) { process.stderr.write(`${HELP}\nUnknown option: ${args[index]}\n`); process.exit(2); }
  if (args[index] !== "--json") index += 1;
}
const bundleDir = option("--bundle");
const version = option("--version");
const runId = option("--candidate-run");
const artifactId = option("--candidate-artifact");
if (!bundleDir || !version || !runId || !artifactId) { process.stderr.write(HELP); process.exit(2); }

const capture = (file, commandArgs) => execFileSync(file, commandArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const env = process.env;
let mainCommit = env.HELM_PROMOTION_MAIN_COMMIT || "";
let mainContainsCandidate = env.HELM_PROMOTION_MAIN_CONTAINS_CANDIDATE === "1";
let tagAbsent = env.HELM_PROMOTION_TAG_ABSENT === "1";
let releaseAbsent = env.HELM_PROMOTION_RELEASE_ABSENT === "1";
if (!mainCommit) {
  try { mainCommit = capture("git", ["rev-parse", "refs/remotes/origin/main"]); } catch {}
  try {
    const promotion = JSON.parse(capture(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(resolve(bundleDir, "promotion.json"))},'utf8'))`]));
    mainContainsCandidate = capture("git", ["merge-base", "--is-ancestor", promotion.commit, "refs/remotes/origin/main"]) === "";
    tagAbsent = !capture("git", ["tag", "--list", `v${version}`]);
  } catch {}
}
const report = validatePromotionBundle({
  bundleDir, version, runId, artifactId, mainCommit, mainContainsCandidate, tagAbsent, releaseAbsent,
  linuxAttestationVerified: env.HELM_PROMOTION_LINUX_ATTESTATION_VERIFIED === "1",
  promotedAt: env.HELM_PROMOTION_TIME || undefined,
});
const output = option("--write-verified");
if (output) writeVerifiedPromotion(report, resolve(output));
process.stdout.write(has("--json") ? `${JSON.stringify(report, null, 2)}\n` : formatPromotionReport(report));
if (!report.eligible) process.exitCode = 1;
