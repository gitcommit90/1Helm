#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizePlatformEvidence, sha256File } from "./platform-acceptance-lib.mjs";

const inputPath = resolve(process.env.HELM_ACCEPTANCE_INPUT || "");
const outputPath = resolve(process.env.HELM_ACCEPTANCE_OUTPUT || "");
if (!process.env.HELM_ACCEPTANCE_INPUT || !process.env.HELM_ACCEPTANCE_OUTPUT) {
  throw new Error("HELM_ACCEPTANCE_INPUT and HELM_ACCEPTANCE_OUTPUT are required");
}
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const evidence = normalizePlatformEvidence(input);
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${evidence.platform} ${evidence.result}: ${sha256File(outputPath)}\n`);
if (evidence.result !== "passed") process.exitCode = 1;
