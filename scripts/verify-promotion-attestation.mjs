#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { sha256File } from "./stable-manifest-lib.mjs";

const bundle = resolve(process.env.HELM_PROMOTION_BUNDLE || "");
const promotion = JSON.parse(readFileSync(resolve(bundle, "promotion.json"), "utf8"));
const subjects = [
  ...(Array.isArray(promotion?.artifacts) ? promotion.artifacts.filter((item) => ["linux_tgz", "linux_offline_tgz"].includes(item?.role)) : []),
  promotion?.channel_image?.candidate?.artifact,
];
if (subjects.length !== 3 || !/^[a-f0-9]{40}$/.test(String(promotion?.commit || ""))) {
  throw new Error("Refusing incomplete Linux/image attestation subject set");
}
for (const subject of subjects) {
  const path = resolve(bundle, String(subject?.path || ""));
  const rel = relative(bundle, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || lstatSync(path).isSymbolicLink()
      || !/^[a-f0-9]{64}$/.test(String(subject?.sha256 || "")) || sha256File(path) !== subject.sha256) {
    throw new Error("Refusing invalid Linux/image artifact identity before attestation verification");
  }
  execFileSync("gh", ["attestation", "verify", path,
    "--repo", "gitcommit90/1Helm",
    "--signer-workflow", "gitcommit90/1Helm/.github/workflows/candidate.yml",
    "--source-ref", "refs/heads/main",
    "--source-digest", promotion.commit,
    "--deny-self-hosted-runners"], { stdio: "inherit" });
}
