import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 3_000;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export const DEFAULT_STATUS_CONFIG = Object.freeze({
  localUrl: "http://127.0.0.1:8123",
  siteUrl: "https://1helm.com",
  fixtureUrl: null,
  fixtureHost: null,
  fixtureId: null,
  candidateUrl: null,
  candidateHost: null,
  candidateId: null,
  timeoutMs: DEFAULT_TIMEOUT_MS,
});

function configuredUrl(value, label) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error(`${label} must be an http(s) URL`); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be an http(s) URL without credentials, a query, or a fragment`);
  }
  return url.toString().replace(/\/$/, "");
}

export function statusConfig(env = process.env) {
  const timeoutMs = Number(env.HELM_STATUS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const fixtureValues = [env.HELM_STATUS_FIXTURE_URL, env.HELM_STATUS_FIXTURE_HOST, env.HELM_STATUS_FIXTURE_ID];
  const fixtureConfigured = fixtureValues.every((value) => String(value || "").trim());
  if (!fixtureConfigured && fixtureValues.some((value) => String(value || "").trim())) {
    throw new Error("fixture probing requires HELM_STATUS_FIXTURE_URL, HELM_STATUS_FIXTURE_HOST, and HELM_STATUS_FIXTURE_ID together");
  }
  const fixtureHost = fixtureConfigured ? String(env.HELM_STATUS_FIXTURE_HOST) : null;
  const fixtureId = fixtureConfigured ? String(env.HELM_STATUS_FIXTURE_ID) : null;
  const candidateValues = [env.HELM_STATUS_CANDIDATE_URL, env.HELM_STATUS_CANDIDATE_HOST, env.HELM_STATUS_CANDIDATE_ID];
  const candidateConfigured = candidateValues.every((value) => String(value || "").trim());
  if (!candidateConfigured && candidateValues.some((value) => String(value || "").trim())) {
    throw new Error("candidate probing requires HELM_STATUS_CANDIDATE_URL, HELM_STATUS_CANDIDATE_HOST, and HELM_STATUS_CANDIDATE_ID together");
  }
  const candidateHost = candidateConfigured ? String(env.HELM_STATUS_CANDIDATE_HOST) : null;
  const candidateId = candidateConfigured ? String(env.HELM_STATUS_CANDIDATE_ID) : null;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error("HELM_STATUS_TIMEOUT_MS must be an integer from 100 to 60000");
  }
  if (fixtureHost && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fixtureHost)) throw new Error("HELM_STATUS_FIXTURE_HOST is invalid");
  if (fixtureId && !/^\d+$/.test(fixtureId)) throw new Error("HELM_STATUS_FIXTURE_ID must contain digits only");
  if (candidateHost && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidateHost)) throw new Error("HELM_STATUS_CANDIDATE_HOST is invalid");
  if (candidateId && !/^\d+$/.test(candidateId)) throw new Error("HELM_STATUS_CANDIDATE_ID must contain digits only");
  return {
    localUrl: configuredUrl(env.HELM_STATUS_LOCAL_URL || DEFAULT_STATUS_CONFIG.localUrl, "HELM_STATUS_LOCAL_URL"),
    siteUrl: configuredUrl(env.HELM_STATUS_SITE_URL || DEFAULT_STATUS_CONFIG.siteUrl, "HELM_STATUS_SITE_URL"),
    fixtureUrl: fixtureConfigured ? configuredUrl(env.HELM_STATUS_FIXTURE_URL, "HELM_STATUS_FIXTURE_URL") : null,
    fixtureHost,
    fixtureId,
    candidateUrl: candidateConfigured ? configuredUrl(env.HELM_STATUS_CANDIDATE_URL, "HELM_STATUS_CANDIDATE_URL") : null,
    candidateHost,
    candidateId,
    timeoutMs,
  };
}

export function parseCandidateEvidence(body) {
  try {
    const parsed = JSON.parse(body);
    const candidate = parsed?.running_candidate;
    const previous = parsed?.previous_candidate;
    const attempt = parsed?.last_attempt;
    const install = parsed?.install;
    const rollback = parsed?.rollback;
    const lastRollback = parsed?.last_rollback || rollback;
    const validCandidate = (value, optional = false) => (optional && value == null) || (
      value && /^[a-f0-9]{40}$/.test(String(value.commit || ""))
      && /^[a-f0-9]{64}$/.test(String(value.digest || ""))
      && VERSION_PATTERN.test(String(value.version || ""))
      && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(String(value.build_identity || ""))
    );
    if (parsed?.schema !== 1 || parsed?.kind !== "1helm-dress-rehearsal-status"
      || !validCandidate(candidate, true) || !validCandidate(previous, true) || !validCandidate(attempt)
      || !["healthy", "failed"].includes(install?.result)
      || !["healthy", "unhealthy", "unknown"].includes(install?.health)
      || !["not_needed", "healthy", "failed", "unavailable"].includes(rollback?.result)
      || !["not_needed", "healthy", "failed", "unavailable"].includes(lastRollback?.result)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseAppStatus(body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed?.product !== "1Helm" || !VERSION_PATTERN.test(String(parsed.version || ""))) return null;
    return { version: String(parsed.version) };
  } catch {
    return null;
  }
}

export function parseWebsiteStatus(body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed?.product !== "1Helm" || parsed?.surface !== "website" || parsed?.ok !== true
      || !VERSION_PATTERN.test(String(parsed.version || ""))) return null;
    return { version: String(parsed.version) };
  } catch {
    return null;
  }
}

export function parseStableArtifact(body) {
  try {
    const parsed = JSON.parse(body);
    const version = String(parsed?.version || "");
    const sha256 = String(parsed?.sha256 || "").toLowerCase();
    const url = new URL(String(parsed?.url || ""));
    const artifact = basename(url.pathname);
    if (!VERSION_PATTERN.test(version) || !/^https:$/.test(url.protocol)
      || artifact !== `1Helm-${version}-linux-node.tgz` || !/^[a-f0-9]{64}$/.test(sha256)) return null;
    return { version, artifact, sha256 };
  } catch {
    return null;
  }
}

export function parsePctStatus(output) {
  const match = String(output).trim().match(/^status:\s*([a-z-]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

function defaultRunCommand(file, args, timeoutMs, options = {}) {
  return new Promise((resolveResult) => {
    execFile(file, args, {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      cwd: options.cwd,
    }, (error, stdout) => {
      resolveResult({
        ok: !error,
        stdout: String(stdout || ""),
        timedOut: Boolean(error?.killed || error?.code === "ETIMEDOUT"),
      });
    });
  });
}

async function fetchText(fetchImpl, url, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json,text/html;q=0.5", "user-agent": "1helm-read-only-status" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { reachable: true, ok: response.ok, status: response.status, body: await response.text() };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return { reachable: false, ok: false, status: null, body: "", timedOut };
  }
}

async function appProbe(fetchImpl, baseUrl, timeoutMs) {
  const endpoint = new URL("/api/mobile/compatibility", `${baseUrl}/`).toString();
  const response = await fetchText(fetchImpl, endpoint, timeoutMs);
  if (!response.reachable) return { health: "unreachable", version: null, detail: response.timedOut ? "request timed out" : "could not connect" };
  if (!response.ok) return { health: "unhealthy", version: null, detail: `health endpoint returned HTTP ${response.status}` };
  const identity = parseAppStatus(response.body);
  if (!identity) return { health: "uncertain", version: null, detail: "endpoint responded but did not prove it is 1Helm" };
  return { health: "healthy", version: identity.version, detail: "1Helm health endpoint responded" };
}

async function siteProbe(fetchImpl, baseUrl, timeoutMs) {
  const healthResponse = await fetchText(fetchImpl, new URL("/health", `${baseUrl}/`).toString(), timeoutMs);
  if (!healthResponse.reachable) {
    return { health: "unreachable", version: null, stableVersion: null, commit: null, artifact: null, sha256: null, detail: healthResponse.timedOut ? "request timed out" : "could not connect" };
  }
  if (!healthResponse.ok) {
    return { health: "unhealthy", version: null, stableVersion: null, commit: null, artifact: null, sha256: null, detail: `website health endpoint returned HTTP ${healthResponse.status}` };
  }
  const identity = parseWebsiteStatus(healthResponse.body);
  const metadata = await fetchText(fetchImpl, new URL("/api/releases/linux/latest", `${baseUrl}/`).toString(), timeoutMs);
  const artifact = metadata.ok ? parseStableArtifact(metadata.body) : null;
  return {
    health: identity ? "healthy" : "uncertain",
    version: identity?.version || null,
    stableVersion: artifact?.version || null,
    commit: null,
    artifact: artifact?.artifact || null,
    sha256: artifact?.sha256 || null,
    detail: identity
      ? "1Helm website health endpoint responded; site commit is not exposed"
      : "health endpoint responded but did not prove it is the 1Helm website",
  };
}

async function fixtureProbe(fetchImpl, runCommand, config) {
  if (!config.fixtureUrl || !config.fixtureHost || !config.fixtureId) {
    return { health: "not_configured", version: null, commit: null, artifact: null, lxcState: null, detail: "fixture probing is not configured locally" };
  }
  const sshArgs = [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "ClearAllForwardings=yes",
    "-o", "ControlMaster=no",
    "-o", "ControlPath=none",
    "-o", "KbdInteractiveAuthentication=no",
    "-o", "PasswordAuthentication=no",
    "-o", "PermitLocalCommand=no",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "UpdateHostKeys=no",
    "-o", `ConnectTimeout=${Math.max(1, Math.ceil(config.timeoutMs / 1000))}`,
    config.fixtureHost, "pct", "status", config.fixtureId,
  ];
  const [command, app] = await Promise.all([
    runCommand("ssh", sshArgs, config.timeoutMs),
    appProbe(fetchImpl, config.fixtureUrl, config.timeoutMs),
  ]);
  const lxcState = command.ok ? parsePctStatus(command.stdout) : null;
  let health;
  if (lxcState === "running") health = app.health === "healthy" ? "healthy" : app.health === "uncertain" ? "uncertain" : "unhealthy";
  else if (lxcState === "stopped") health = app.health === "unreachable" ? "unhealthy" : "uncertain";
  else if (lxcState) health = "uncertain";
  else health = app.health === "unreachable" ? "unreachable" : "uncertain";

  const infrastructure = lxcState || (command.timedOut ? "unreachable (timed out)" : "unreachable");
  const detail = !lxcState
    ? `${app.detail}; LXC state could not be read`
    : `LXC is ${lxcState}; ${app.detail}`;
  return { health, version: app.version, commit: null, artifact: null, lxcState: infrastructure, detail };
}

async function candidateProbe(fetchImpl, runCommand, config) {
  if (!config.candidateUrl || !config.candidateHost || !config.candidateId) {
    return { health: "not_configured", version: null, commit: null, artifact: null, evidence: null, detail: "dress-rehearsal probing is not configured locally" };
  }
  const app = await appProbe(fetchImpl, config.candidateUrl, config.timeoutMs);
  const sshArgs = [
    "-T", "-o", "BatchMode=yes", "-o", "ClearAllForwardings=yes", "-o", "ControlMaster=no", "-o", "ControlPath=none",
    "-o", "KbdInteractiveAuthentication=no", "-o", "PasswordAuthentication=no", "-o", "PermitLocalCommand=no",
    "-o", "StrictHostKeyChecking=yes", "-o", "UpdateHostKeys=no",
    "-o", `ConnectTimeout=${Math.max(1, Math.ceil(config.timeoutMs / 1000))}`,
    config.candidateHost, "pct", "exec", config.candidateId, "--", "cat", "/var/lib/1helm-candidate/evidence/status.json",
  ];
  const command = await runCommand("ssh", sshArgs, config.timeoutMs);
  const evidence = command.ok ? parseCandidateEvidence(command.stdout) : null;
  const running = evidence?.running_candidate || null;
  let health = app.health;
  if (!evidence) health = app.health === "unreachable" ? "unreachable" : "uncertain";
  else if (evidence.install.result === "failed" && evidence.rollback.result === "healthy" && app.health === "healthy" && app.version === running?.version) health = "healthy";
  else if (evidence.install.health !== "healthy" || evidence.install.result !== "healthy") health = "unhealthy";
  else if (app.health !== "healthy" || app.version !== running?.version) health = app.health === "unreachable" ? "unhealthy" : "uncertain";
  return {
    health,
    version: running?.version || app.version,
    commit: running?.commit || null,
    artifact: running?.digest || null,
    evidence,
    detail: evidence ? `${app.detail}; local candidate evidence was read` : `${app.detail}; local candidate evidence is unavailable or invalid`,
  };
}

export async function repositoryIdentity(root = resolve(import.meta.dirname, ".."), runCommand = defaultRunCommand) {
  let version = null;
  try {
    const candidate = String(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version || "");
    version = VERSION_PATTERN.test(candidate) ? candidate : null;
  } catch { /* reported as unknown */ }
  const [commitResult, dirtyResult] = await Promise.all([
    runCommand("git", ["rev-parse", "--short=12", "HEAD"], DEFAULT_TIMEOUT_MS, { cwd: root }),
    runCommand("git", ["status", "--porcelain"], DEFAULT_TIMEOUT_MS, { cwd: root }),
  ]);
  return {
    version,
    commit: commitResult.ok ? commitResult.stdout.trim() || null : null,
    dirty: dirtyResult.ok ? Boolean(dirtyResult.stdout.trim()) : null,
  };
}

export async function collectEnvironmentStatus(config, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const runCommand = dependencies.runCommand || defaultRunCommand;
  const source = dependencies.sourceIdentity || await repositoryIdentity(dependencies.root, runCommand);
  const [local, site, fixture, candidate] = await Promise.all([
    appProbe(fetchImpl, config.localUrl, config.timeoutMs),
    siteProbe(fetchImpl, config.siteUrl, config.timeoutMs),
    fixtureProbe(fetchImpl, runCommand, config),
    candidateProbe(fetchImpl, runCommand, config),
  ]);
  return {
    checkedAt: new Date(dependencies.now ?? Date.now()).toISOString(),
    readOnly: true,
    source,
    environments: [
      { id: "local", name: "Local standalone app", target: config.localUrl, commit: null, artifact: null, ...local },
      { id: "website", name: "Public website service", target: config.siteUrl, ...site },
      {
        id: "fixture",
        name: "Linux acceptance fixture",
        target: config.fixtureUrl ? `LXC ${config.fixtureId} on ${config.fixtureHost}; ${config.fixtureUrl}` : "not configured",
        ...fixture,
      },
      {
        id: "candidate",
        name: "Private dress-rehearsal candidate",
        target: config.candidateUrl || "not configured",
        ...candidate,
      },
    ],
  };
}

const shown = (value) => value ?? "unknown";
const healthLabel = (value) => String(value || "unknown").replaceAll("_", " ").toUpperCase();

export function formatEnvironmentStatus(report) {
  const sourceIdentity = report.source.version || report.source.commit
    ? `${report.source.version ? `v${report.source.version}` : "version unknown"} @ ${shown(report.source.commit)}`
    : "unknown";
  const dirty = report.source.dirty === null ? "unknown" : report.source.dirty ? "has local changes" : "clean";
  const lines = [
    "1Helm environment status",
    `Checked: ${report.checkedAt}`,
    "Read-only check: no services, containers, releases, files, or data were changed.",
    "",
    "Source checkout",
    `  Identity: ${sourceIdentity}`,
    `  Working tree: ${dirty}`,
  ];
  for (const environment of report.environments) {
    lines.push("", environment.name, `  Target: ${environment.target}`, `  Health: ${healthLabel(environment.health)} — ${environment.detail}`);
    if (environment.id === "website") {
      lines.push(`  Site version: ${environment.version ? `v${environment.version}` : "unknown"}`);
      lines.push(`  Stable artifact: ${environment.artifact ? `${environment.artifact} (v${environment.stableVersion}, sha256 ${environment.sha256.slice(0, 12)}…)` : "unknown"}`);
      lines.push(`  Site commit: ${shown(environment.commit)}`);
    } else if (environment.id === "candidate") {
      const evidence = environment.evidence;
      const running = evidence?.running_candidate;
      const previous = evidence?.previous_candidate;
      const ci = running?.ci || evidence?.last_attempt?.ci;
      lines.push(`  Running: ${running ? `v${running.version} @ ${running.commit}` : "unknown"}`);
      lines.push(`  Digest: ${running?.digest || "unknown"}`);
      lines.push(`  Build identity: ${running?.build_identity || "unknown"}`);
      lines.push(`  CI result: ${running?.source_state !== "trusted-main" ? "not run (local provisioning proof)" : ci ? `${ci.workflow} run ${ci.run_id} — ${ci.conclusion}` : "unknown"}`);
      lines.push(`  Install health: ${evidence ? `${evidence.install.result} / ${evidence.install.health} at ${evidence.install.checked_at}` : "unknown"}`);
      lines.push(`  Previous candidate: ${previous ? `${previous.commit} / ${previous.digest}` : "none or unknown"}`);
      const rollback = evidence?.last_rollback || evidence?.rollback;
      lines.push(`  Rollback: ${rollback ? `${rollback.result} at ${rollback.checked_at}` : "unknown"}`);
    } else {
      if (environment.lxcState) lines.push(`  LXC state: ${environment.lxcState}`);
      lines.push(`  Runtime version: ${environment.version ? `v${environment.version}` : "unknown"}`);
    }
  }
  lines.push("", "Nothing was changed.");
  return `${lines.join("\n")}\n`;
}
