#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isoNow, normalizePlatformEvidence, PLATFORM_ARTIFACT_ROLES, PLATFORM_CHECKS } from "./platform-acceptance-lib.mjs";

const env = process.env;
const platform = String(env.HELM_ACCEPTANCE_PLATFORM || "");
if (!PLATFORM_CHECKS[platform] || !env.HELM_ACCEPTANCE_OUTPUT || !env.HELM_ACCEPTANCE_STARTED_AT) {
  throw new Error("Pending evidence requires a platform, output path, and start timestamp");
}

let source;
let artifacts;
if (platform === "macos") {
  const root = resolve(env.HELM_MAC_CANDIDATE_DOWNLOAD || "");
  source = JSON.parse(readFileSync(join(root, "candidate-evidence", "mac-candidate.json"), "utf8"));
  artifacts = source.artifacts;
} else {
  source = JSON.parse(readFileSync(resolve(env.HELM_CANDIDATE_MANIFEST || ""), "utf8"));
  artifacts = [{
    role: "linux_tgz",
    name: basename(env.HELM_CANDIDATE_ARCHIVE || source.artifact.name),
    sha256: source.artifact.sha256,
    bytes: source.artifact.bytes,
  }];
}
const commit = platform === "macos" ? source.commit : source.source.commit;
const version = source.version;
const sourceCi = platform === "macos" ? source.source_ci : source.ci;
const checkedAt = isoNow();
const pending = (summary) => ({ result: "blocked", checked_at: checkedAt, summary });
const evidence = normalizePlatformEvidence({
  platform,
  commit,
  version,
  candidate: { run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT },
  source_ci: sourceCi,
  started_at: env.HELM_ACCEPTANCE_STARTED_AT,
  checked_at: checkedAt,
  machine: {
    id: `${env.RUNNER_NAME}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    kind: platform === "linux" ? "github-hosted-ephemeral" : `dedicated-${platform}-phase4`,
    os: env.RUNNER_OS,
    os_version: String(env.HELM_MACHINE_OS_VERSION || "preflight-unknown"),
    architecture: env.RUNNER_ARCH,
    dedicated: platform !== "windows",
    production_data: platform === "windows",
  },
  runner: { name: env.RUNNER_NAME, labels: [env.HELM_PHASE4_RUNNER_LABEL], job: env.GITHUB_JOB },
  ...(platform === "windows" ? { continuity: {
    mode: "snapshot-assisted-equivalent",
    result: "blocked",
    checked_at: checkedAt,
    summary: "Continuity mode selected; the exact-candidate exercise has not completed.",
  } } : {}),
  artifacts: PLATFORM_ARTIFACT_ROLES[platform].map((role) => artifacts.find((item) => item.role === role)),
  checks: PLATFORM_CHECKS[platform].map((id) => ({ id, ...pending("Required acceptance check has not completed.") })),
  state_preservation: { ...pending("State-preservation proof has not completed."), before_sha256: null, after_sha256: null },
  recovery: { ...pending(platform === "windows" ? "Scoped uninstall proof has not completed." : "Rollback or recovery proof has not completed."), before_sha256: null, after_sha256: null },
  notes: [platform === "windows"
    ? "Preflight blocker retained before administrator-owned isolation and provisioning evidence is accepted."
    : "Preflight blocker retained so an interrupted acceptance run cannot disappear or become a pass."],
});
writeFileSync(resolve(env.HELM_ACCEPTANCE_OUTPUT), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
