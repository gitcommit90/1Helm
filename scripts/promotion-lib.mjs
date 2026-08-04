import { lstatSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { candidateIdentityFromArchive } from "./candidate-manifest.mjs";
import { STABLE_ARTIFACT_ROLES, STABLE_MANIFEST_KIND, STABLE_REPOSITORY, sha256, sha256File, stableArtifactNames, validateStableManifest } from "./stable-manifest-lib.mjs";

export const PROMOTION_KIND = "1helm-stable-promotion-candidate";
export const CONFIRMATION_PREFIX = "PROMOTE EXACT CANDIDATE";

const VERSION = /^\d+\.\d+\.\d+$/;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const ID = /^\d+$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PLATFORMS = Object.freeze({
  macos: ["signature", "notarization", "staple", "gatekeeper", "clean_install", "prior_version_update", "retained_state", "loopback", "version"],
  linux: ["digest", "clean_install", "prior_version_update", "health_failure_rollback", "retained_state", "systemd_health"],
  windows: ["non_elevated_install", "single_uac", "restart_resume", "keepalive_reboot", "onboarding", "prior_version_update", "retained_state", "uninstall_safety"],
});

const digestFile = sha256File;
const add = (blockers, condition, message) => { if (!condition) blockers.push(message); };
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function confinedFile(bundle, relativePath, blockers, label) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.startsWith("/") || relativePath.includes("\\")) {
    blockers.push(`${label}: path is invalid`);
    return null;
  }
  const path = resolve(bundle, relativePath);
  const rel = relative(bundle, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
    blockers.push(`${label}: path escapes the promotion bundle`);
    return null;
  }
  try {
    let current = bundle;
    for (const segment of rel.split(sep)) {
      current = join(current, segment);
      if (lstatSync(current).isSymbolicLink()) throw new Error();
    }
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error();
    return path;
  } catch {
    blockers.push(`${label}: file is missing or is not a regular file`);
    return null;
  }
}

function checkedRecord(bundle, record, blockers, label) {
  if (!record || typeof record !== "object") {
    blockers.push(`${label}: evidence record is missing`);
    return null;
  }
  const path = confinedFile(bundle, record?.path, blockers, label);
  if (!path) return null;
  add(blockers, HEX64.test(String(record?.sha256 || "")), `${label}: recorded SHA-256 is invalid`);
  if (HEX64.test(String(record?.sha256 || ""))) add(blockers, digestFile(path) === record.sha256, `${label}: file SHA-256 mismatch`);
  try { return { path, value: json(path) }; } catch { blockers.push(`${label}: JSON is invalid`); return null; }
}

function validateCandidateManifest(value, expected, blockers) {
  add(blockers, value?.schema === 1 && value?.kind === "1helm-dress-rehearsal-candidate", "candidate manifest: schema or kind mismatch");
  add(blockers, value?.source?.repository === STABLE_REPOSITORY && value?.source?.ref === "refs/heads/main" && value?.source?.state === "trusted-main", "candidate manifest: source is not trusted repository main");
  add(blockers, value?.source?.commit === expected.commit, "candidate manifest: commit does not match promotion identity");
  add(blockers, value?.version === expected.version, "candidate manifest: version does not match intended version");
  add(blockers, value?.ci?.workflow === "CI" && ID.test(String(value?.ci?.run_id || "")) && value?.ci?.conclusion === "success", "candidate manifest: CI did not succeed");
  add(blockers, value?.artifact?.name === stableArtifactNames(expected.version).linux_tgz && HEX64.test(String(value?.artifact?.sha256 || "")), "candidate manifest: Linux artifact identity is invalid");
  add(blockers, HEX64.test(String(value?.source?.source_archive_sha256 || "")) && HEX64.test(String(value?.sealed_oci?.sha256 || "")), "candidate manifest: source or sealed OCI digest is invalid");
}

function validateRun(value, expected, blockers) {
  add(blockers, String(value?.id) === expected.runId, "candidate workflow: run ID mismatch");
  add(blockers, value?.name === "Candidate dress rehearsal" && value?.path === ".github/workflows/candidate.yml", "candidate workflow: workflow name or path mismatch");
  add(blockers, value?.event === "workflow_run" && value?.status === "completed" && value?.conclusion === "success", "candidate workflow: run did not complete successfully");
  add(blockers, value?.head_branch === "main" && value?.head_sha === expected.commit && value?.head_repository?.full_name === STABLE_REPOSITORY, "candidate workflow: source is not the exact repository main commit");
}

function validateCi(value, expected, blockers) {
  add(blockers, String(value?.id) === String(expected.ciRunId), "candidate CI: run ID mismatch");
  add(blockers, value?.name === "CI" && value?.path === ".github/workflows/ci.yml", "candidate CI: workflow name or path mismatch");
  add(blockers, value?.event === "push" && value?.status === "completed" && value?.conclusion === "success", "candidate CI: run did not complete successfully from push");
  add(blockers, value?.head_branch === "main" && value?.head_sha === expected.commit && value?.head_repository?.full_name === STABLE_REPOSITORY, "candidate CI: source is not the exact repository main commit");
}

function validateArtifactRecord(value, expected, blockers) {
  add(blockers, String(value?.id) === expected.artifactId, "candidate artifact: artifact ID mismatch");
  add(blockers, value?.name === expected.artifactName && value?.expired === false, "candidate artifact: name mismatch or artifact expired");
  add(blockers, String(value?.workflow_run?.id) === expected.runId, "candidate artifact: workflow run mismatch");
}

function validatePlatformEvidence(platform, value, expected, artifacts, blockers) {
  const label = `${platform} acceptance`;
  add(blockers, value?.schema === 1 && value?.kind === "1helm-platform-acceptance" && value?.platform === platform, `${label}: schema, kind, or platform mismatch`);
  add(blockers, value?.repository === STABLE_REPOSITORY && value?.ref === "refs/heads/main" && value?.commit === expected.commit && value?.version === expected.version, `${label}: source identity mismatch`);
  add(blockers, value?.result === "passed" && ISO_TIME.test(String(value?.checked_at || "")), `${label}: retained result is not a timestamped pass`);
  const checkMap = new Map((Array.isArray(value?.checks) ? value.checks : []).map((item) => [item?.id, item?.result]));
  for (const check of PLATFORMS[platform]) add(blockers, checkMap.get(check) === "passed", `${label}: ${check} evidence is missing or did not pass`);
  const expectedRoles = platform === "macos" ? ["mac_dmg", "mac_updater_zip"] : ["linux_tgz"];
  const records = Array.isArray(value?.artifacts) ? value.artifacts : [];
  for (const role of expectedRoles) {
    const matching = records.filter((item) => item?.role === role);
    add(blockers, matching.length === 1 && matching[0].name === artifacts[role]?.name && matching[0].sha256 === artifacts[role]?.sha256, `${label}: ${role} does not match candidate bytes`);
  }
}

function releaseNotes(version, commit, promotion, artifacts, changelog, acceptance) {
  const digestLines = STABLE_ARTIFACT_ROLES.map((role) => `- \`${artifacts[role].name}\` — \`${artifacts[role].sha256}\``).join("\n");
  return `# 1Helm ${version}\n\n${acceptance.trim()}\n\n## Authored changelog\n\n${changelog.trim()}\n\n## Promoted candidate evidence\n\n- Source: \`${STABLE_REPOSITORY}@${commit}\` on \`main\`\n- Candidate workflow run: \`${promotion.candidate.workflow_run_id}\`\n- Candidate artifact: \`${promotion.candidate.artifact_id}\` (\`${promotion.candidate.artifact_name}\`)\n- Private dress rehearsal: exact Linux commit and digest healthy\n- Platform acceptance: retained macOS, Linux, and Windows records all passed\n\n## Exact release artifacts\n\n${digestLines}\n`;
}

export function confirmationText(version, runId, artifactId) {
  return `${CONFIRMATION_PREFIX} v${version} RUN ${runId} ARTIFACT ${artifactId}`;
}

export function validatePromotionBundle(options) {
  const blockers = [];
  const bundle = resolve(options.bundleDir);
  let promotion;
  try { promotion = json(join(bundle, "promotion.json")); } catch { blockers.push("promotion manifest: promotion.json is missing or invalid"); }
  const expected = {
    version: String(options.version || ""), runId: String(options.runId || ""),
    artifactId: String(options.artifactId || ""), commit: String(promotion?.commit || ""),
    artifactName: String(promotion?.candidate?.artifact_name || ""),
  };
  add(blockers, VERSION.test(expected.version), "intended version is not three-part semantic versioning");
  add(blockers, promotion?.schema === 1 && promotion?.kind === PROMOTION_KIND, "promotion manifest: schema or kind mismatch");
  add(blockers, promotion?.repository === STABLE_REPOSITORY && promotion?.ref === "refs/heads/main", "promotion manifest: repository or ref mismatch");
  add(blockers, promotion?.version === expected.version && HEX40.test(expected.commit), "promotion manifest: version or commit mismatch");
  add(blockers, promotion?.acceptance_ledger_required === true, "promotion manifest: authored acceptance ledger was not declared required");
  add(blockers, String(promotion?.candidate?.workflow_run_id) === expected.runId && ID.test(expected.runId), "promotion manifest: candidate workflow run ID mismatch");
  add(blockers, String(promotion?.candidate?.artifact_id) === expected.artifactId && ID.test(expected.artifactId), "promotion manifest: candidate artifact ID mismatch");
  add(blockers, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(expected.artifactName), "promotion manifest: candidate artifact name is invalid");
  add(blockers, options.mainContainsCandidate === true, "candidate commit is not contained on current main");
  add(blockers, options.tagAbsent === true, `tag v${expected.version} already exists or absence was not proven`);
  add(blockers, options.releaseAbsent === true, `release v${expected.version} already exists or absence was not proven`);

  const records = promotion?.records || {};
  const candidateManifest = checkedRecord(bundle, records.candidate_manifest, blockers, "candidate manifest");
  const runRecord = checkedRecord(bundle, records.candidate_workflow, blockers, "candidate workflow");
  const ciRecord = checkedRecord(bundle, records.candidate_ci, blockers, "candidate CI");
  const artifactRecord = checkedRecord(bundle, records.candidate_artifact, blockers, "candidate artifact");
  const rehearsal = checkedRecord(bundle, records.dress_rehearsal, blockers, "private dress rehearsal");
  if (candidateManifest) {
    expected.ciRunId = String(candidateManifest.value?.ci?.run_id || "");
    validateCandidateManifest(candidateManifest.value, expected, blockers);
  }
  if (runRecord) validateRun(runRecord.value, expected, blockers);
  if (ciRecord) validateCi(ciRecord.value, expected, blockers);
  if (artifactRecord) validateArtifactRecord(artifactRecord.value, expected, blockers);

  const artifacts = {};
  const expectedNames = stableArtifactNames(expected.version);
  for (const role of STABLE_ARTIFACT_ROLES) {
    const spec = (Array.isArray(promotion?.artifacts) ? promotion.artifacts : []).find((item) => item?.role === role);
    const path = confinedFile(bundle, spec?.path, blockers, `${role} artifact`);
    add(blockers, spec?.name === expectedNames[role] && basename(spec?.path || "") === expectedNames[role], `${role} artifact: name/version mismatch`);
    add(blockers, HEX64.test(String(spec?.sha256 || "")), `${role} artifact: recorded SHA-256 is invalid`);
    if (path && HEX64.test(String(spec?.sha256 || ""))) {
      add(blockers, digestFile(path) === spec.sha256, `${role} artifact: exact-byte SHA-256 mismatch`);
      add(blockers, Number(spec.bytes) === statSync(path).size && statSync(path).size > 0, `${role} artifact: byte count mismatch`);
    }
    artifacts[role] = { ...spec, path };
    const provenance = checkedRecord(bundle, spec?.provenance, blockers, `${role} provenance`);
    if (provenance) {
      add(blockers, provenance.value?.schema === 1 && provenance.value?.kind === "1helm-artifact-provenance", `${role} provenance: schema or kind mismatch`);
      add(blockers, provenance.value?.repository === STABLE_REPOSITORY && provenance.value?.ref === "refs/heads/main" && provenance.value?.commit === expected.commit, `${role} provenance: source identity mismatch`);
      add(blockers, provenance.value?.artifact?.role === role && provenance.value?.artifact?.name === spec?.name && provenance.value?.artifact?.sha256 === spec?.sha256, `${role} provenance: artifact digest mismatch`);
      if (role === "linux_tgz") {
        add(blockers, provenance.value?.builder === "github-hosted" && provenance.value?.attestation_created === true && provenance.value?.signer_workflow === "gitcommit90/1Helm/.github/workflows/candidate.yml", "linux_tgz provenance: trusted hosted builder attestation record is missing");
        add(blockers, options.linuxAttestationVerified === true, "linux_tgz provenance: GitHub attestation was not cryptographically verified in this promotion run");
      }
      if (role !== "linux_tgz") add(blockers, provenance.value?.signing === "developer-id" && provenance.value?.notarization === "accepted", `${role} provenance: signing or notarization evidence is missing`);
    }
  }
  add(blockers, (Array.isArray(promotion?.artifacts) ? promotion.artifacts : []).length === 3, "desktop artifact matrix must contain exactly three artifacts");

  if (candidateManifest && artifacts.linux_tgz?.path) {
    add(blockers, candidateManifest.value?.artifact?.sha256 === artifacts.linux_tgz.sha256 && candidateManifest.value?.artifact?.bytes === artifacts.linux_tgz.bytes, "Linux candidate manifest does not match promoted archive bytes");
    try {
      const identity = candidateIdentityFromArchive(artifacts.linux_tgz.path);
      add(blockers, identity.commit === expected.commit && identity.version === expected.version, "Linux embedded commit/version does not match promotion identity");
      add(blockers, identity.source_archive_sha256 === candidateManifest.value?.source?.source_archive_sha256 && identity.sealed_oci_sha256 === candidateManifest.value?.sealed_oci?.sha256, "Linux embedded source/OCI digest does not match candidate manifest");
    } catch (error) { blockers.push(`Linux embedded candidate identity refused: ${error.message}`); }
  }
  if (rehearsal) {
    const running = rehearsal.value?.running_candidate;
    add(blockers, rehearsal.value?.schema === 1 && rehearsal.value?.kind === "1helm-dress-rehearsal-status", "private dress rehearsal: schema or kind mismatch");
    add(blockers, running?.commit === expected.commit && running?.digest === artifacts.linux_tgz?.sha256 && running?.version === expected.version, "private dress rehearsal: running commit/digest/version mismatch");
    add(blockers, rehearsal.value?.install?.result === "healthy" && rehearsal.value?.install?.health === "healthy", "private dress rehearsal: exact candidate is not healthy");
  }

  for (const platform of Object.keys(PLATFORMS)) {
    const record = checkedRecord(bundle, records?.acceptance?.[platform], blockers, `${platform} acceptance`);
    if (record) validatePlatformEvidence(platform, record.value, expected, artifacts, blockers);
  }

  const packageRecord = checkedRecord(bundle, records.package, blockers, "package version record");
  if (packageRecord) add(blockers, packageRecord.value?.version === expected.version, "package version does not match intended version");
  const changelogPath = confinedFile(bundle, records?.changelog?.path, blockers, "authored changelog");
  const acceptancePath = confinedFile(bundle, records?.acceptance_content?.path, blockers, "authored acceptance content");
  let changelog = ""; let acceptance = "";
  if (changelogPath) {
    changelog = readFileSync(changelogPath, "utf8");
    add(blockers, digestFile(changelogPath) === records.changelog.sha256, "authored changelog: SHA-256 mismatch");
    add(blockers, new RegExp(`^## \\[${expected.version.replaceAll(".", "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(changelog), "authored changelog: named version section is missing");
  }
  if (acceptancePath) {
    acceptance = readFileSync(acceptancePath, "utf8");
    add(blockers, digestFile(acceptancePath) === records.acceptance_content.sha256, "authored acceptance content: SHA-256 mismatch");
    add(blockers, /^1\.\s+\S/m.test(acceptance), "authored acceptance content: numbered owner ledger is missing");
  }

  const digest = promotion ? digestFile(join(bundle, "promotion.json")) : "";
  const stableManifest = blockers.length ? null : validateStableManifest({
    schema: 1, kind: STABLE_MANIFEST_KIND, repository: STABLE_REPOSITORY, ref: "refs/heads/main",
    version: expected.version, tag: `v${expected.version}`, commit: expected.commit,
    promoted_at: options.promotedAt || new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    promotion: { candidate_workflow_run_id: expected.runId, candidate_artifact_id: expected.artifactId, manifest_sha256: digest },
    artifacts: STABLE_ARTIFACT_ROLES.map((role) => ({
      role, name: artifacts[role].name, sha256: artifacts[role].sha256, bytes: artifacts[role].bytes,
      url: `https://github.com/${STABLE_REPOSITORY}/releases/download/v${expected.version}/${artifacts[role].name}`,
    })),
  });
  return {
    schema: 1, kind: "1helm-stable-promotion-report", mode: "dry-run", repository: STABLE_REPOSITORY,
    candidate: { workflow_run_id: expected.runId, artifact_id: expected.artifactId, artifact_name: expected.artifactName, commit: expected.commit, version: expected.version },
    dress_rehearsal: rehearsal ? { result: rehearsal.value?.install?.result || "unknown", health: rehearsal.value?.install?.health || "unknown" } : { result: "missing", health: "unknown" },
    evidence: Object.fromEntries(Object.keys(PLATFORMS).map((platform) => [platform, blockers.some((item) => item.startsWith(`${platform} acceptance`)) ? "blocked" : "passed"])),
    artifacts: STABLE_ARTIFACT_ROLES.map((role) => ({ role, name: artifacts[role]?.name || expectedNames[role], sha256: artifacts[role]?.sha256 || null })),
    eligible: blockers.length === 0, blockers, stable_touched: false, stable_manifest: stableManifest,
    release_notes: blockers.length ? null : releaseNotes(expected.version, expected.commit, promotion, artifacts, changelog, acceptance),
  };
}

export function formatPromotionReport(report) {
  const lines = [
    "1Helm Stable promotion dry run",
    `  Candidate: workflow run ${report.candidate.workflow_run_id}, artifact ${report.candidate.artifact_id} (${report.candidate.artifact_name || "unknown"})`,
    `  Identity: v${report.candidate.version} @ ${report.candidate.commit || "unknown"}`,
    `  Dress rehearsal: ${report.dress_rehearsal.result} / ${report.dress_rehearsal.health}`,
    `  Required evidence: macOS ${report.evidence.macos}; Linux ${report.evidence.linux}; Windows ${report.evidence.windows}`,
    `  Dry-run eligibility: ${report.eligible ? "ELIGIBLE" : "BLOCKED"}`,
  ];
  lines.push("  Publish blockers:", ...report.blockers.map((item) => `    - ${item}`));
  lines.push(
    "    - this report is dry-run mode, not publish mode",
    "    - protected Stable publication approval and the intentionally absent enablement secret are required",
    "    - the identity-bound owner confirmation is not active in a dry run",
    `  Owner confirmation after every blocker is cleared: ${confirmationText(report.candidate.version, report.candidate.workflow_run_id, report.candidate.artifact_id)}`,
  );
  lines.push("  Stable touched: NO", "  This command is read-only and cannot tag, release, upload, or change the website.");
  return `${lines.join("\n")}\n`;
}

export function writeVerifiedPromotion(report, directory) {
  if (!report.eligible || !report.stable_manifest || !report.release_notes) throw new Error("Refusing to write publish inputs for an ineligible promotion");
  writeFileSync(join(directory, `1Helm-${report.candidate.version}-stable.json`), `${JSON.stringify(report.stable_manifest, null, 2)}\n`);
  writeFileSync(join(directory, `1Helm-${report.candidate.version}-release-notes.md`), report.release_notes);
  writeFileSync(join(directory, "verified-promotion.json"), `${JSON.stringify({
    ...report,
    release_notes: undefined,
    release_notes_sha256: sha256(report.release_notes),
    stable_manifest_sha256: sha256(`${JSON.stringify(report.stable_manifest, null, 2)}\n`),
  }, null, 2)}\n`);
}
