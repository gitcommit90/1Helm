#!/usr/bin/env node
import { statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readStableManifest, sha256File, stableArtifactNames } from "./stable-manifest-lib.mjs";

const [version, commit, workflowRunId, artifactDirectory = "dist/release", outputPath] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw new Error("Usage: create-stable-manifest.mjs VERSION COMMIT WORKFLOW_RUN_ID [ARTIFACT_DIR] [OUTPUT]");
if (!/^[a-f0-9]{40}$/.test(commit || "")) throw new Error("Commit must be a full lowercase Git SHA");
if (!/^\d+$/.test(workflowRunId || "")) throw new Error("Workflow run ID must be numeric");

const names = stableArtifactNames(version);
const roles = ["mac_dmg", "mac_updater_zip", "linux_tgz"];
const artifacts = roles.map((role) => {
  const name = names[role];
  const path = resolve(artifactDirectory, name);
  return {
    role,
    name,
    sha256: sha256File(path),
    bytes: statSync(path).size,
    url: `https://github.com/gitcommit90/1Helm/releases/download/v${version}/${name}`,
  };
});
const promotedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const manifest = {
  schema: 3,
  kind: "1helm-promoted-stable",
  repository: "gitcommit90/1Helm",
  ref: "refs/heads/main",
  version,
  tag: `v${version}`,
  commit,
  promoted_at: promotedAt,
  publication: { workflow_run_id: workflowRunId },
  artifacts,
};
const destination = outputPath ? resolve(outputPath) : resolve(artifactDirectory, `1Helm-${version}-stable.json`);
writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
readStableManifest(destination);
console.log(destination);
