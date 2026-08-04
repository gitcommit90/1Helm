import { lstatSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { candidateIdentityFromArchive } from "./candidate-manifest.mjs";
import { PLATFORM_CHECKS, platformEvidenceBlockers } from "./platform-acceptance-lib.mjs";
import { STABLE_ARTIFACT_ROLES, STABLE_MANIFEST_KIND, STABLE_REPOSITORY, sha256, sha256File, stableArtifactNames, validateStableManifest } from "./stable-manifest-lib.mjs";
import { normalizeChannelImageManifest, releasedChannelImageManifest } from "./artifact-contract.mjs";

export const PROMOTION_KIND = "1helm-stable-promotion-candidate";
export const CONFIRMATION_PREFIX = "PROMOTE EXACT CANDIDATE";

const VERSION = /^\d+\.\d+\.\d+$/;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const ID = /^\d+$/;
const PLATFORMS = PLATFORM_CHECKS;

const digestFile = sha256File;
const add = (blockers, condition, message) => { if (!condition) blockers.push(message); };
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function isChangelogDate(value) {
  if (value.length !== 10 || value[4] !== "-" || value[7] !== "-") return false;
  for (const index of [0, 1, 2, 3, 5, 6, 8, 9]) {
    if (value[index] < "0" || value[index] > "9") return false;
  }
  return true;
}

function hasVersionedChangelogHeading(changelog, version) {
  const prefix = `## [${version}] - `;
  return String(changelog).split("\n").some((rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    return line.startsWith(prefix)
      && line.length === prefix.length + 10
      && isChangelogDate(line.slice(prefix.length));
  });
}

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
  add(blockers, value?.offline_bundle?.name === stableArtifactNames(expected.version).linux_offline_tgz
    && HEX64.test(String(value?.offline_bundle?.sha256 || "")), "candidate manifest: Linux offline artifact identity is invalid");
  add(blockers, HEX64.test(String(value?.source?.source_archive_sha256 || "")) && HEX64.test(String(value?.sealed_oci?.sha256 || "")), "candidate manifest: source or sealed OCI digest is invalid");
}

function validateMacCandidateManifest(value, expected, artifacts, blockers) {
  add(blockers, value?.schema === 1 && value?.kind === "1helm-macos-candidate", "Mac candidate manifest: schema or kind mismatch");
  add(blockers, value?.repository === STABLE_REPOSITORY && value?.ref === "refs/heads/main"
    && value?.commit === expected.commit && value?.version === expected.version, "Mac candidate manifest: source identity mismatch");
  add(blockers, value?.candidate?.workflow === "Candidate dress rehearsal"
    && value?.candidate?.workflow_path === ".github/workflows/candidate.yml" && value?.candidate?.event === "workflow_run"
    && String(value?.candidate?.run_id) === expected.runId && String(value?.candidate?.run_attempt) === expected.runAttempt,
  "Mac candidate manifest: candidate run identity mismatch");
  add(blockers, value?.source_ci?.workflow === "CI" && String(value?.source_ci?.run_id) === String(expected.ciRunId)
    && value?.source_ci?.conclusion === "success", "Mac candidate manifest: CI identity mismatch");
  add(blockers, value?.builder?.type === "dedicated-self-hosted" && value?.builder?.runner_label === "1helm-macos-phase4"
    && value?.builder?.os === "macOS" && value?.builder?.architecture === "ARM64"
    && /^[A-Za-z0-9][A-Za-z0-9 ._:/@+()#-]{0,255}$/.test(String(value?.builder?.runner_name || "")),
  "Mac candidate manifest: dedicated builder identity mismatch");
  add(blockers, value?.signing?.identity === "developer-id-application" && value?.signing?.notarization === "accepted"
    && value?.signing?.stapling === "validated" && value?.signing?.gatekeeper === "accepted", "Mac candidate manifest: signing proof is incomplete");
  const records = Array.isArray(value?.artifacts) ? value.artifacts : [];
  for (const role of ["mac_dmg", "mac_updater_zip"]) {
    const item = records.filter((record) => record?.role === role);
    add(blockers, item.length === 1 && item[0]?.name === artifacts[role]?.name && item[0]?.sha256 === artifacts[role]?.sha256
      && Number(item[0]?.bytes) === Number(artifacts[role]?.bytes), `Mac candidate manifest: ${role} bytes mismatch`);
  }
  add(blockers, records.length === 2, "Mac candidate manifest: artifact records are incomplete or unexpected");
}

function validateRun(value, expected, blockers) {
  add(blockers, String(value?.id) === expected.runId, "candidate workflow: run ID mismatch");
  add(blockers, value?.name === "Candidate dress rehearsal" && value?.path === ".github/workflows/candidate.yml", "candidate workflow: workflow name or path mismatch");
  add(blockers, value?.event === "workflow_run" && value?.status === "completed" && value?.conclusion === "success", "candidate workflow: run did not complete successfully");
  add(blockers, value?.head_branch === "main" && value?.head_sha === expected.commit && value?.head_repository?.full_name === STABLE_REPOSITORY, "candidate workflow: source is not the exact repository main commit");
  add(blockers, ID.test(String(value?.run_attempt || "")), "candidate workflow: run attempt identity is missing");
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

function validatePlatformEvidence(platform, value, expected, artifacts, channelImage, blockers) {
  const label = `${platform} acceptance`;
  for (const message of platformEvidenceBlockers(value, { ...expected, platform, artifacts, channelImage })) blockers.push(`${label}: ${message}`);
}

function releaseNotes(version, commit, promotion, artifacts, channelImage, changelog, acceptance) {
  const digestLines = STABLE_ARTIFACT_ROLES.map((role) => `- \`${artifacts[role].name}\` — \`${artifacts[role].sha256}\``).join("\n");
  return `# 1Helm ${version}\n\n${acceptance.trim()}\n\n## Authored changelog\n\n${changelog.trim()}\n\n## Promoted candidate evidence\n\n- Source: \`${STABLE_REPOSITORY}@${commit}\` on \`main\`\n- Candidate workflow run: \`${promotion.candidate.workflow_run_id}\`\n- Candidate artifact: \`${promotion.candidate.artifact_id}\` (\`${promotion.candidate.artifact_name}\`)\n- Private dress rehearsal: exact Linux commit and digest healthy\n- Platform acceptance: retained macOS, Linux, and Windows records all passed\n- Shared channel image: \`${channelImage.architecture}\`, contract v\`${channelImage.version}\`, SHA-256 \`${channelImage.sha256}\`\n- The ordinary Linux artifact omits the shared image; the explicit offline bundle includes its exact bytes.\n\n## Exact release artifacts\n\n${digestLines}\n`;
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
  const macCandidateManifest = checkedRecord(bundle, records.mac_candidate_manifest, blockers, "Mac candidate manifest");
  const runRecord = checkedRecord(bundle, records.candidate_workflow, blockers, "candidate workflow");
  const ciRecord = checkedRecord(bundle, records.candidate_ci, blockers, "candidate CI");
  const artifactRecord = checkedRecord(bundle, records.candidate_artifact, blockers, "candidate artifact");
  const rehearsal = checkedRecord(bundle, records.dress_rehearsal, blockers, "private dress rehearsal");
  if (candidateManifest) {
    expected.ciRunId = String(candidateManifest.value?.ci?.run_id || "");
    validateCandidateManifest(candidateManifest.value, expected, blockers);
  }
  if (runRecord) {
    expected.runAttempt = String(runRecord.value?.run_attempt || "");
    validateRun(runRecord.value, expected, blockers);
  }
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
      add(blockers, provenance.value?.version === expected.version && String(provenance.value?.candidate_workflow_run_id) === expected.runId
        && String(provenance.value?.source_ci_run_id) === String(expected.ciRunId), `${role} provenance: version or candidate/CI run identity mismatch`);
      add(blockers, provenance.value?.artifact?.role === role && provenance.value?.artifact?.name === spec?.name
        && provenance.value?.artifact?.sha256 === spec?.sha256 && Number(provenance.value?.artifact?.bytes) === Number(spec?.bytes), `${role} provenance: artifact digest or byte count mismatch`);
      if (["linux_tgz", "linux_offline_tgz"].includes(role)) {
        add(blockers, provenance.value?.builder === "github-hosted" && provenance.value?.attestation_created === true && provenance.value?.signer_workflow === "gitcommit90/1Helm/.github/workflows/candidate.yml", "linux_tgz provenance: trusted hosted builder attestation record is missing");
        add(blockers, options.linuxAttestationVerified === true, "linux_tgz provenance: GitHub attestation was not cryptographically verified in this promotion run");
      }
      if (["mac_dmg", "mac_updater_zip"].includes(role)) {
        add(blockers, provenance.value?.builder === "dedicated-macos"
          && provenance.value?.signer_workflow === "gitcommit90/1Helm/.github/workflows/candidate.yml", `${role} provenance: dedicated Mac builder/workflow identity is missing`);
        add(blockers, provenance.value?.signing === "developer-id" && provenance.value?.notarization === "accepted"
          && provenance.value?.stapling === "validated" && provenance.value?.gatekeeper === "accepted", `${role} provenance: signing, notarization, stapling, or Gatekeeper evidence is missing`);
      }
    }
  }
  add(blockers, (Array.isArray(promotion?.artifacts) ? promotion.artifacts : []).length === STABLE_ARTIFACT_ROLES.length, "desktop artifact matrix must contain the complete split artifact set");
  if (macCandidateManifest) validateMacCandidateManifest(macCandidateManifest.value, expected, artifacts, blockers);

  let channelImage = null;
  try { channelImage = normalizeChannelImageManifest(promotion?.channel_image, { requireUrl: true }); }
  catch (error) { blockers.push(`channel image manifest: ${error.message}`); }
  const imageArtifact = confinedFile(bundle, promotion?.channel_image?.candidate?.artifact?.path, blockers, "channel image artifact");
  const imageManifest = checkedRecord(bundle, promotion?.channel_image?.candidate?.manifest, blockers, "channel image retained manifest");
  const imageProvenance = checkedRecord(bundle, promotion?.channel_image?.candidate?.provenance, blockers, "channel image provenance");
  if (channelImage && imageArtifact) {
    add(blockers, basename(imageArtifact) === channelImage.artifact.name && digestFile(imageArtifact) === channelImage.sha256
      && statSync(imageArtifact).size === channelImage.bytes, "channel image exact bytes do not match its immutable manifest");
  }
  if (channelImage && imageManifest) {
    try {
      const retained = normalizeChannelImageManifest(imageManifest.value);
      add(blockers, JSON.stringify(releasedChannelImageManifest(retained)) === JSON.stringify(channelImage),
        "channel image retained build manifest does not match promotion contract");
    } catch (error) { blockers.push(`channel image retained build manifest: ${error.message}`); }
  }
  if (channelImage && imageProvenance) {
    add(blockers, imageProvenance.value?.schema === 1 && imageProvenance.value?.kind === "1helm-channel-image-provenance"
      && imageProvenance.value?.repository === STABLE_REPOSITORY && imageProvenance.value?.ref === "refs/heads/main"
      && imageProvenance.value?.source_commit === expected.commit
      && String(imageProvenance.value?.candidate_workflow_run_id) === expected.runId
      && String(imageProvenance.value?.source_ci_run_id) === String(expected.ciRunId)
      && imageProvenance.value?.artifact?.name === channelImage.artifact.name
      && imageProvenance.value?.artifact?.sha256 === channelImage.sha256
      && Number(imageProvenance.value?.artifact?.bytes) === channelImage.bytes
      && imageProvenance.value?.manifest?.sha256 === promotion?.channel_image?.candidate?.manifest?.sha256
      && imageProvenance.value?.inputs?.containerfile_sha256 === channelImage.inputs.containerfile_sha256
      && imageProvenance.value?.inputs?.context_sha256 === channelImage.inputs.context_sha256
      && imageProvenance.value?.inputs?.base_image_digest === channelImage.inputs.base_image_digest
      && imageProvenance.value?.cache?.key === channelImage.cache.key
      && typeof imageProvenance.value?.cache?.reused === "boolean"
      && imageProvenance.value?.cache?.key === candidateManifest?.value?.build?.sealed_oci_cache?.key
      && imageProvenance.value?.cache?.reused === candidateManifest?.value?.build?.sealed_oci_cache?.reused
      && imageProvenance.value?.signer_workflow === `${STABLE_REPOSITORY}/.github/workflows/candidate.yml`
      && imageProvenance.value?.attestation_created === true, "channel image provenance is incomplete or mismatched");
    add(blockers, options.linuxAttestationVerified === true, "channel image provenance was not cryptographically verified");
  }

  if (candidateManifest && artifacts.linux_tgz?.path) {
    add(blockers, candidateManifest.value?.artifact?.sha256 === artifacts.linux_tgz.sha256 && candidateManifest.value?.artifact?.bytes === artifacts.linux_tgz.bytes, "Linux candidate manifest does not match promoted archive bytes");
    add(blockers, candidateManifest.value?.offline_bundle?.sha256 === artifacts.linux_offline_tgz?.sha256
      && candidateManifest.value?.offline_bundle?.bytes === artifacts.linux_offline_tgz?.bytes, "Linux candidate manifest does not match promoted offline bundle bytes");
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
    if (record) {
      validatePlatformEvidence(platform, record.value, expected, artifacts, channelImage, blockers);
      if (platform === "macos" && macCandidateManifest) {
        add(blockers, record.value?.runner?.name === macCandidateManifest.value?.builder?.runner_name,
          "macos acceptance: runner does not match the dedicated Mac builder");
      }
    }
  }

  const packageRecord = checkedRecord(bundle, records.package, blockers, "package version record");
  if (packageRecord) add(blockers, packageRecord.value?.version === expected.version, "package version does not match intended version");
  const changelogPath = confinedFile(bundle, records?.changelog?.path, blockers, "authored changelog");
  const acceptancePath = confinedFile(bundle, records?.acceptance_content?.path, blockers, "authored acceptance content");
  let changelog = ""; let acceptance = "";
  if (changelogPath) {
    changelog = readFileSync(changelogPath, "utf8");
    add(blockers, digestFile(changelogPath) === records.changelog.sha256, "authored changelog: SHA-256 mismatch");
    add(blockers, hasVersionedChangelogHeading(changelog, expected.version), "authored changelog: named version section is missing");
  }
  if (acceptancePath) {
    acceptance = readFileSync(acceptancePath, "utf8");
    add(blockers, digestFile(acceptancePath) === records.acceptance_content.sha256, "authored acceptance content: SHA-256 mismatch");
    add(blockers, /^1\.\s+\S/m.test(acceptance), "authored acceptance content: numbered owner ledger is missing");
  }

  const digest = promotion ? digestFile(join(bundle, "promotion.json")) : "";
  const stableManifest = blockers.length ? null : validateStableManifest({
    schema: 2, kind: STABLE_MANIFEST_KIND, repository: STABLE_REPOSITORY, ref: "refs/heads/main",
    version: expected.version, tag: `v${expected.version}`, commit: expected.commit,
    promoted_at: options.promotedAt || new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    promotion: { candidate_workflow_run_id: expected.runId, candidate_artifact_id: expected.artifactId, manifest_sha256: digest },
    artifacts: STABLE_ARTIFACT_ROLES.map((role) => ({
      role, name: artifacts[role].name, sha256: artifacts[role].sha256, bytes: artifacts[role].bytes,
      url: `https://github.com/${STABLE_REPOSITORY}/releases/download/v${expected.version}/${artifacts[role].name}`,
    })),
    channel_image: channelImage,
  });
  return {
    schema: 1, kind: "1helm-stable-promotion-report", mode: "dry-run", repository: STABLE_REPOSITORY,
    candidate: { workflow_run_id: expected.runId, artifact_id: expected.artifactId, artifact_name: expected.artifactName, commit: expected.commit, version: expected.version },
    dress_rehearsal: rehearsal ? { result: rehearsal.value?.install?.result || "unknown", health: rehearsal.value?.install?.health || "unknown" } : { result: "missing", health: "unknown" },
    evidence: Object.fromEntries(Object.keys(PLATFORMS).map((platform) => [platform, blockers.some((item) => item.startsWith(`${platform} acceptance`)) ? "blocked" : "passed"])),
    artifacts: STABLE_ARTIFACT_ROLES.map((role) => ({ role, name: artifacts[role]?.name || expectedNames[role], sha256: artifacts[role]?.sha256 || null })),
    eligible: blockers.length === 0, blockers, stable_touched: false, stable_manifest: stableManifest,
    release_notes: blockers.length ? null : releaseNotes(expected.version, expected.commit, promotion, artifacts, channelImage, changelog, acceptance),
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
