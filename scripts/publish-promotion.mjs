#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { confirmationText } from "./promotion-lib.mjs";
import { sha256File, STABLE_ARTIFACT_ROLES, validateStableManifest } from "./stable-manifest-lib.mjs";
import { assertRemoteVersionAbsent } from "./github-promotion-gates.mjs";

const bundle = resolve(process.env.HELM_PROMOTION_BUNDLE || "");
const version = String(process.env.HELM_PROMOTION_VERSION || "");
const runId = String(process.env.HELM_PROMOTION_RUN_ID || "");
const artifactId = String(process.env.HELM_PROMOTION_ARTIFACT_ID || "");
const confirmation = String(process.env.HELM_PROMOTION_CONFIRMATION || "");
const mode = String(process.env.HELM_PROMOTION_MODE || "");
const environmentEnabled = String(process.env.STABLE_PUBLICATION_ENABLED || "");
const githubToken = String(process.env.GH_TOKEN || "");
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^\d+$/.test(runId) || !/^\d+$/.test(artifactId)) throw new Error("Refusing invalid publish identity");
if (mode !== "publish") throw new Error("Refusing without explicit publish mode");
if (confirmation !== confirmationText(version, runId, artifactId)) throw new Error("Refusing without exact owner confirmation text");
// This secret must exist only inside the owner-protected environment. Its
// absence keeps the path unusable even if GitHub auto-creates an unprotected
// environment for the workflow name.
if (environmentEnabled !== "PROTECTED STABLE ENVIRONMENT ENABLED") throw new Error("Refusing until the owner protects and enables the Stable publication environment");

const verified = JSON.parse(readFileSync(join(bundle, "verified-promotion.json"), "utf8"));
const stablePath = join(bundle, `1Helm-${version}-stable.json`);
const stable = validateStableManifest(JSON.parse(readFileSync(stablePath, "utf8")));
if (!verified.eligible || verified.stable_touched !== false
    || verified.candidate?.version !== version || String(verified.candidate?.workflow_run_id) !== runId
    || String(verified.candidate?.artifact_id) !== artifactId || stable.version !== version
    || stable.commit !== verified.candidate.commit) {
  throw new Error("Refusing publish inputs that are not the exact complete verification result");
}
const hash = sha256File;
if (JSON.stringify(stable) !== JSON.stringify(verified.stable_manifest)
    || hash(stablePath) !== verified.stable_manifest_sha256) {
  throw new Error("Refusing changed stable manifest after verification");
}

const run = (file, args, options = {}) => execFileSync(file, args, { encoding: "utf8", stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit" });
const captured = (file, args) => run(file, args, { capture: true }).trim();
const tag = `v${version}`;
await assertRemoteVersionAbsent(version, githubToken);
run("git", ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
run("git", ["merge-base", "--is-ancestor", stable.commit, "refs/remotes/origin/main"]);

const artifactPaths = STABLE_ARTIFACT_ROLES.map((role) => {
  const artifact = stable.artifacts.find((item) => item.role === role);
  const path = join(bundle, artifact.name);
  const digest = hash(path);
  if (digest !== artifact.sha256) throw new Error(`Refusing changed ${role} bytes after verification`);
  return path;
});
const notes = join(bundle, `1Helm-${version}-release-notes.md`);
if (hash(notes) !== verified.release_notes_sha256) throw new Error("Refusing changed authored release notes after verification");

// GitHub cannot atomically create an annotated tag and Release. Push the one
// immutable tag only after every check, then create the complete Release in one
// command. A failure after the push strands this version; the tag is never
// deleted, moved, or reused. The recovery is a new version.
run("git", ["tag", "-a", tag, stable.commit, "-m", `1Helm ${version}`]);
run("git", ["push", "origin", `refs/tags/${tag}:refs/tags/${tag}`]);
// Upload behind a draft boundary so Stable never exposes a partial matrix. The
// same guarded owner-approved job verifies GitHub's stored digests, then makes
// the complete Release public without a second approval or follow-up change.
run("gh", ["release", "create", tag, ...artifactPaths, stablePath, "--repo", stable.repository,
  "--verify-tag", "--draft", "--title", `1Helm ${version}`, "--notes-file", notes]);
const response = await fetch(`https://api.github.com/repos/${stable.repository}/releases/tags/${encodeURIComponent(tag)}`, {
  headers: { accept: "application/vnd.github+json", authorization: `Bearer ${githubToken}`, "user-agent": "1helm-stable-promotion", "x-github-api-version": "2022-11-28" },
  redirect: "error",
  signal: AbortSignal.timeout(10_000),
});
if (!response.ok) throw new Error(`Could not verify draft Release assets: GitHub API ${response.status}`);
const release = await response.json();
if (release.draft !== true || release.prerelease === true || release.tag_name !== tag) throw new Error("Draft Release identity changed before publication");
const expectedAssets = [...stable.artifacts, { name: `1Helm-${version}-stable.json`, sha256: hash(stablePath) }];
if (!Array.isArray(release.assets) || release.assets.length !== expectedAssets.length) throw new Error("Draft Release asset matrix is incomplete or contains unexpected assets");
for (const expected of expectedAssets) {
  const matches = release.assets.filter((asset) => asset?.name === expected.name && asset?.digest === `sha256:${expected.sha256}`);
  if (matches.length !== 1) throw new Error(`Draft Release bytes do not match ${expected.name}`);
}
run("gh", ["release", "edit", tag, "--repo", stable.repository, "--draft=false", "--latest"]);
