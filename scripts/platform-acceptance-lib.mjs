import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

export const ACCEPTANCE_KIND = "1helm-platform-acceptance";
export const ACCEPTANCE_SCHEMA = 1;
export const CANDIDATE_WORKFLOW = Object.freeze({
  name: "Candidate dress rehearsal",
  path: ".github/workflows/candidate.yml",
  event: "workflow_run",
});
export const REPOSITORY = "gitcommit90/1Helm";
export const REF = "refs/heads/main";

export const PLATFORM_CHECKS = Object.freeze({
  macos: Object.freeze([
    "signature", "notarization", "staple", "gatekeeper", "clean_install",
    "prior_version_update", "retained_state", "loopback", "version",
  ]),
  linux: Object.freeze([
    "digest", "clean_install", "prior_version_update", "health_failure_rollback",
    "retained_state", "systemd_health",
  ]),
  windows: Object.freeze([
    "non_elevated_install", "single_uac", "restart_resume", "keepalive_reboot",
    "onboarding", "prior_version_update", "retained_state", "uninstall_safety",
  ]),
});

export const PLATFORM_ARTIFACT_ROLES = Object.freeze({
  macos: Object.freeze(["mac_dmg", "mac_updater_zip"]),
  linux: Object.freeze(["linux_tgz"]),
  windows: Object.freeze(["linux_tgz"]),
});

const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const ID = /^\d+$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9 .,;_'":/\[\]@+()#-]{0,511}$/;

export const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const sha256File = (path) => sha256Bytes(readFileSync(path));
export const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function safeText(value, label, { allowEmpty = false } = {}) {
  const text = String(value ?? "").trim();
  if ((!text && allowEmpty) || SAFE_TEXT.test(text)) return text;
  throw new Error(`${label} is missing or contains unsafe/unbounded text`);
}

function exact(value, pattern, label) {
  const text = String(value ?? "");
  if (!pattern.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function uniqueChecks(platform, checks) {
  const required = PLATFORM_CHECKS[platform];
  if (!Array.isArray(checks)) throw new Error(`${platform} checks must be an array`);
  const map = new Map();
  for (const item of checks) {
    const id = String(item?.id || "");
    if (!required.includes(id) || map.has(id)) throw new Error(`${platform} check ${id || "<missing>"} is unknown or duplicated`);
    const result = String(item?.result || "");
    if (!['passed', 'failed', 'blocked'].includes(result)) throw new Error(`${platform} check ${id} result is invalid`);
    map.set(id, {
      id,
      result,
      checked_at: exact(item?.checked_at, ISO_TIME, `${platform} check ${id} timestamp`),
      summary: safeText(item?.summary, `${platform} check ${id} summary`),
    });
  }
  return required.map((id) => map.get(id) || {
    id, result: "blocked", checked_at: isoNow(), summary: "Required evidence was not produced.",
  });
}

function normalizeOutcome(value, label, allowed) {
  if (!value || typeof value !== "object") throw new Error(`${label} outcome is missing`);
  const result = String(value.result || "");
  if (!allowed.includes(result)) throw new Error(`${label} outcome is invalid`);
  return {
    result,
    checked_at: exact(value.checked_at, ISO_TIME, `${label} timestamp`),
    summary: safeText(value.summary, `${label} summary`),
    before_sha256: value.before_sha256 == null ? null : exact(value.before_sha256, HEX64, `${label} before digest`),
    after_sha256: value.after_sha256 == null ? null : exact(value.after_sha256, HEX64, `${label} after digest`),
  };
}

function normalizeMachine(value, platform) {
  if (!value || typeof value !== "object") throw new Error(`${platform} machine identity is missing`);
  return {
    id: safeText(value.id, `${platform} machine ID`),
    kind: safeText(value.kind, `${platform} machine kind`),
    os: safeText(value.os, `${platform} machine OS`),
    os_version: safeText(value.os_version, `${platform} machine OS version`),
    architecture: safeText(value.architecture, `${platform} architecture`),
    dedicated: value.dedicated === true,
    production_data: value.production_data === false ? false : true,
  };
}

function normalizeRunner(value, platform) {
  if (!value || typeof value !== "object") throw new Error(`${platform} runner identity is missing`);
  const labels = Array.isArray(value.labels) ? value.labels.map((item) => safeText(item, `${platform} runner label`)) : [];
  if (labels.length !== 1) throw new Error(`${platform} runner evidence must name its one unique no-default label`);
  return {
    name: safeText(value.name, `${platform} runner name`),
    labels,
    job: safeText(value.job, `${platform} runner job`),
  };
}

function normalizeContinuity(value, platform) {
  if (platform !== "windows") return null;
  if (!value || typeof value !== "object") throw new Error("windows reboot/resume continuity evidence is missing");
  if (!['real-reboot', 'snapshot-assisted-equivalent'].includes(value.mode)) {
    throw new Error("windows reboot/resume continuity mode is invalid");
  }
  return {
    mode: value.mode,
    result: ['passed', 'failed', 'blocked'].includes(value.result)
      ? value.result : (() => { throw new Error("windows reboot/resume continuity result is invalid"); })(),
    checked_at: exact(value.checked_at, ISO_TIME, "windows reboot/resume continuity timestamp"),
    summary: safeText(value.summary, "windows reboot/resume continuity summary"),
  };
}

export function artifactRecord(role, path) {
  const bytes = statSync(path).size;
  if (!bytes) throw new Error(`${role} artifact is empty`);
  return { role, name: basename(path), sha256: sha256File(path), bytes };
}

/**
 * Convert runner observations into the one promotion schema. A runner may
 * honestly emit failed/blocked evidence, but only a complete set of passed
 * checks can produce result=passed.
 */
export function normalizePlatformEvidence(input) {
  const platform = String(input?.platform || "");
  if (!PLATFORM_CHECKS[platform]) throw new Error("platform is invalid");
  const checks = uniqueChecks(platform, input.checks);
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts.map((item) => ({
    role: String(item?.role || ""),
    name: safeText(item?.name, `${platform} artifact name`),
    sha256: exact(item?.sha256, HEX64, `${platform} artifact digest`),
    bytes: Number(item?.bytes),
  })) : [];
  const roles = PLATFORM_ARTIFACT_ROLES[platform];
  if (artifacts.length !== roles.length || roles.some((role) => artifacts.filter((item) => item.role === role).length !== 1)) {
    throw new Error(`${platform} artifact binding is incomplete or duplicated`);
  }
  if (artifacts.some((item) => !Number.isSafeInteger(item.bytes) || item.bytes <= 0)) throw new Error(`${platform} artifact byte count is invalid`);
  const candidate = input?.candidate || {};
  const sourceCi = input?.source_ci || {};
  const machine = normalizeMachine(input.machine, platform);
  const runner = normalizeRunner(input.runner, platform);
  const continuity = normalizeContinuity(input.continuity, platform);
  const statePreservation = normalizeOutcome(input.state_preservation, `${platform} state preservation`, ["passed", "failed", "blocked"]);
  const recovery = normalizeOutcome(input.recovery, `${platform} recovery`, ["passed", "failed", "blocked", "not_applicable"]);
  const outcomes = [...checks.map((item) => item.result), statePreservation.result, recovery.result,
    ...(continuity ? [continuity.result] : [])];
  const derived = outcomes.every((result) => result === "passed") ? "passed"
    : outcomes.some((result) => result === "failed") ? "failed" : "blocked";
  if (input.result && input.result !== derived) throw new Error(`${platform} aggregate result does not match its required outcomes`);
  if (derived === "passed" && (!machine.dedicated || machine.production_data)) {
    throw new Error(`${platform} passing evidence did not come from a dedicated production-data-free machine`);
  }
  return {
    schema: ACCEPTANCE_SCHEMA,
    kind: ACCEPTANCE_KIND,
    platform,
    result: derived,
    repository: REPOSITORY,
    ref: REF,
    commit: exact(input.commit, HEX40, `${platform} commit`),
    version: exact(input.version, VERSION, `${platform} version`),
    candidate: {
      workflow: CANDIDATE_WORKFLOW.name,
      workflow_path: CANDIDATE_WORKFLOW.path,
      event: CANDIDATE_WORKFLOW.event,
      run_id: exact(candidate.run_id, ID, `${platform} candidate run ID`),
      run_attempt: exact(candidate.run_attempt, ID, `${platform} candidate run attempt`),
    },
    source_ci: {
      workflow: "CI",
      run_id: exact(sourceCi.run_id, ID, `${platform} CI run ID`),
      conclusion: sourceCi.conclusion === "success" ? "success" : (() => { throw new Error(`${platform} CI conclusion is not success`); })(),
    },
    started_at: exact(input.started_at, ISO_TIME, `${platform} start timestamp`),
    checked_at: exact(input.checked_at, ISO_TIME, `${platform} completion timestamp`),
    machine,
    runner,
    ...(continuity ? { continuity } : {}),
    artifacts,
    checks,
    state_preservation: statePreservation,
    recovery,
    notes: Array.isArray(input.notes) ? input.notes.map((item) => safeText(item, `${platform} evidence note`)) : [],
  };
}

export function platformEvidenceBlockers(value, expected) {
  const blockers = [];
  const add = (condition, message) => { if (!condition) blockers.push(message); };
  const platform = expected.platform;
  add(value?.schema === ACCEPTANCE_SCHEMA && value?.kind === ACCEPTANCE_KIND && value?.platform === platform, "schema, kind, or platform mismatch");
  add(value?.repository === REPOSITORY && value?.ref === REF && value?.commit === expected.commit && value?.version === expected.version, "source identity mismatch");
  add(value?.candidate?.workflow === CANDIDATE_WORKFLOW.name && value?.candidate?.workflow_path === CANDIDATE_WORKFLOW.path
    && value?.candidate?.event === CANDIDATE_WORKFLOW.event && String(value?.candidate?.run_id) === String(expected.runId)
    && String(value?.candidate?.run_attempt) === String(expected.runAttempt), "candidate workflow identity mismatch");
  add(value?.source_ci?.workflow === "CI" && String(value?.source_ci?.run_id) === String(expected.ciRunId)
    && value?.source_ci?.conclusion === "success", "successful CI identity mismatch");
  add(value?.result === "passed" && ISO_TIME.test(String(value?.started_at || "")) && ISO_TIME.test(String(value?.checked_at || "")), "retained result is not a timestamped pass");
  const machineKinds = { linux: "github-hosted-ephemeral", macos: "dedicated-apple-silicon", windows: "dedicated-windows-11-vm" };
  const operatingSystems = { linux: "Linux", macos: "macOS", windows: "Windows" };
  const architectures = { linux: "X64", macos: "ARM64", windows: "X64" };
  const labels = { linux: "ubuntu-latest", macos: "1helm-macos-phase4", windows: "1helm-windows-phase4" };
  add(value?.machine?.dedicated === true && value?.machine?.production_data === false && SAFE_TEXT.test(String(value?.machine?.id || ""))
    && value?.machine?.kind === machineKinds[platform] && value?.machine?.os === operatingSystems[platform]
    && value?.machine?.architecture === architectures[platform], "dedicated machine identity or platform architecture is missing");
  add(Array.isArray(value?.runner?.labels) && value.runner.labels.length === 1 && value.runner.labels[0] === labels[platform]
    && value?.runner?.job === `accept-${platform}`, "unique no-default runner label or job identity is missing");
  if (platform === "windows") {
    add(['real-reboot', 'snapshot-assisted-equivalent'].includes(value?.continuity?.mode)
      && value?.continuity?.result === "passed" && ISO_TIME.test(String(value?.continuity?.checked_at || ""))
      && SAFE_TEXT.test(String(value?.continuity?.summary || "")), "honest reboot/resume or snapshot-assisted equivalent evidence is missing");
  }
  const map = new Map((Array.isArray(value?.checks) ? value.checks : []).map((item) => [item?.id, item]));
  for (const check of PLATFORM_CHECKS[platform]) {
    const item = map.get(check);
    add(item?.result === "passed" && ISO_TIME.test(String(item?.checked_at || "")) && SAFE_TEXT.test(String(item?.summary || "")), `${check} evidence is missing or did not pass`);
  }
  add(value?.state_preservation?.result === "passed" && HEX64.test(String(value?.state_preservation?.before_sha256 || ""))
    && value?.state_preservation?.before_sha256 === value?.state_preservation?.after_sha256, "state preservation identity did not pass");
  add(value?.recovery?.result === "passed", `${platform === "windows" ? "scoped uninstall" : "rollback/recovery"} outcome did not pass`);
  const records = Array.isArray(value?.artifacts) ? value.artifacts : [];
  for (const role of PLATFORM_ARTIFACT_ROLES[platform]) {
    const actual = records.filter((item) => item?.role === role);
    const wanted = expected.artifacts[role];
    add(actual.length === 1 && actual[0]?.name === wanted?.name && actual[0]?.sha256 === wanted?.sha256
      && Number(actual[0]?.bytes) === Number(wanted?.bytes), `${role} does not match exact candidate bytes`);
  }
  add(records.length === PLATFORM_ARTIFACT_ROLES[platform].length, "artifact evidence contains unexpected records");
  return blockers;
}
