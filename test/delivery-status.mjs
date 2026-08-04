import assert from "node:assert/strict";
import test from "node:test";
import {
  collectEnvironmentStatus,
  DEFAULT_STATUS_CONFIG,
  formatEnvironmentStatus,
  parseAppStatus,
  parseCandidateEvidence,
  parsePctStatus,
  parseStableArtifact,
  parseWebsiteStatus,
  repositoryIdentity,
  statusConfig,
} from "../scripts/delivery-status-lib.mjs";

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test("status parsers accept proven identities and reject lookalike responses", () => {
  assert.deepEqual(parseAppStatus('{"product":"1Helm","version":"0.0.38"}'), { version: "0.0.38" });
  assert.equal(parseAppStatus('{"product":"something else","version":"0.0.38"}'), null);
  assert.equal(parseAppStatus("not json"), null);
  assert.deepEqual(parseWebsiteStatus('{"ok":true,"product":"1Helm","surface":"website","version":"0.0.41"}'), { version: "0.0.41" });
  assert.equal(parseWebsiteStatus('{"ok":true,"product":"1Helm","version":"0.0.41"}'), null);
  assert.equal(parsePctStatus("status: running\n"), "running");
  assert.equal(parsePctStatus("unexpected output"), null);

  const artifact = parseStableArtifact(JSON.stringify({
    version: "0.0.41",
    url: "https://github.com/gitcommit90/1Helm/releases/download/v0.0.41/1Helm-0.0.41-linux-node.tgz",
    sha256: "a".repeat(64),
  }));
  assert.deepEqual(artifact, { version: "0.0.41", artifact: "1Helm-0.0.41-linux-node.tgz", sha256: "a".repeat(64) });
});

test("candidate evidence parser requires complete honest install and rollback state", () => {
  const candidate = {
    commit: "a".repeat(40), digest: "b".repeat(64), version: "0.0.41",
    build_identity: "candidate-1-2.1", ci: { workflow: "CI", run_id: "1", conclusion: "success" },
  };
  const evidence = {
    schema: 1, kind: "1helm-dress-rehearsal-status", running_candidate: candidate,
    last_attempt: candidate, previous_candidate: null,
    install: { result: "healthy", health: "healthy", checked_at: "2026-08-04T12:00:00Z" },
    rollback: { result: "not_needed", checked_at: "2026-08-04T12:00:00Z" },
    last_rollback: { result: "not_needed", checked_at: "2026-08-04T12:00:00Z" },
  };
  assert.deepEqual(parseCandidateEvidence(JSON.stringify(evidence)), evidence);
  assert.equal(parseCandidateEvidence(JSON.stringify({ ...evidence, install: { result: "maybe" } })), null);
});

test("status configuration rejects secret-bearing URLs and option-like SSH hosts", () => {
  assert.throws(() => statusConfig({ HELM_STATUS_SITE_URL: "https://user:secret@example.com" }), /without credentials/);
  assert.throws(() => statusConfig({ HELM_STATUS_FIXTURE_URL: "http://example.test/?token=secret", HELM_STATUS_FIXTURE_HOST: "fixture", HELM_STATUS_FIXTURE_ID: "112" }), /without credentials/);
  assert.throws(() => statusConfig({ HELM_STATUS_FIXTURE_URL: "http://example.test", HELM_STATUS_FIXTURE_HOST: "-V", HELM_STATUS_FIXTURE_ID: "112" }), /HOST is invalid/);
  assert.throws(() => statusConfig({ HELM_STATUS_FIXTURE_URL: "http://example.test" }), /requires.*together/);
});

test("private fixture identity is not tracked and is not probed until configured locally", async () => {
  const config = statusConfig({});
  assert.equal(config.fixtureUrl, null);
  assert.equal(config.fixtureHost, null);
  assert.equal(config.fixtureId, null);
  const urls = [];
  const report = await collectEnvironmentStatus(config, {
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.endsWith("/health")) return response(200, '{"ok":true,"product":"1Helm","surface":"website","version":"0.0.41"}');
      if (url.endsWith("/api/releases/linux/latest")) return response(503, "");
      return response(200, '{"product":"1Helm","version":"0.0.41"}');
    },
    runCommand: async () => { throw new Error("fixture command must not run"); },
    sourceIdentity: { version: "0.0.41", commit: "abc123", dirty: false },
  });
  const fixture = report.environments.find(({ id }) => id === "fixture");
  assert.equal(fixture.health, "not_configured");
  assert.equal(fixture.target, "not configured");
  assert.equal(urls.some((url) => /192\.168\.|pve2/.test(url)), false);
});

test("status collection remains honest when remote state is unavailable", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith(DEFAULT_STATUS_CONFIG.localUrl)) return response(200, '{"product":"1Helm","version":"0.0.41"}');
    if (url === `${DEFAULT_STATUS_CONFIG.siteUrl}/health`) return response(200, '{"ok":true,"product":"1Helm","surface":"website","version":"0.0.41"}');
    if (url.includes("/api/releases/linux/latest")) return response(503, "unavailable");
    throw Object.assign(new Error("offline"), { name: "TypeError" });
  };
  const report = await collectEnvironmentStatus(DEFAULT_STATUS_CONFIG, {
    fetchImpl,
    runCommand: async () => ({ ok: false, stdout: "", timedOut: true }),
    sourceIdentity: { version: "0.0.41", commit: "abc123", dirty: false },
    now: Date.UTC(2026, 7, 4, 12),
  });

  assert.equal(report.readOnly, true);
  assert.deepEqual(report.environments.map(({ health }) => health), ["healthy", "healthy", "not_configured", "not_configured"]);
  assert.equal(report.environments[1].artifact, null);
  assert.equal(report.environments[2].version, null);
  assert.equal(report.environments[2].lxcState, null);

  const text = formatEnvironmentStatus(report);
  assert.match(text, /Stable artifact: unknown/);
  assert.match(text, /NOT CONFIGURED/);
  assert.match(text, /Nothing was changed/);
});

test("a responding fixture remains uncertain when its LXC identity cannot be read", async () => {
  let command;
  const fetchImpl = async (url) => {
    if (url.includes("fixture.example")) return response(200, '{"product":"1Helm","version":"0.0.38"}');
    if (url.endsWith("/health")) return response(200, '{"ok":true,"product":"1Helm","surface":"website","version":"0.0.41"}');
    if (url.endsWith("/api/releases/linux/latest")) return response(503, "");
    if (url.includes("/api/mobile/compatibility")) return response(200, '{"product":"1Helm","version":"0.0.41"}');
    return response(200, "ok");
  };
  const report = await collectEnvironmentStatus({
    ...DEFAULT_STATUS_CONFIG,
    fixtureUrl: "http://fixture.example:8123",
    fixtureHost: "fixture-host",
    fixtureId: "112",
  }, {
    fetchImpl,
    runCommand: async (file, args) => {
      command = { file, args };
      return { ok: false, stdout: "", timedOut: false };
    },
    sourceIdentity: { version: "0.0.41", commit: "abc123", dirty: true },
  });
  const fixture = report.environments.find(({ id }) => id === "fixture");
  assert.equal(fixture.health, "uncertain");
  assert.equal(fixture.version, "0.0.38");
  assert.equal(command.file, "ssh");
  assert.deepEqual(command.args.slice(-5), ["ConnectTimeout=3", "fixture-host", "pct", "status", "112"]);
  assert.ok(command.args.includes("ClearAllForwardings=yes"));
  assert.ok(command.args.includes("PermitLocalCommand=no"));
  assert.ok(command.args.includes("UpdateHostKeys=no"));
});

test("repository Git identity commands run against the requested root", async () => {
  const calls = [];
  await repositoryIdentity(new URL("..", import.meta.url).pathname, async (file, args, timeout, options) => {
    calls.push({ file, args, timeout, options });
    return { ok: true, stdout: args[0] === "status" ? " M package.json\n" : "abc123\n", timedOut: false };
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.file === "git" && call.options?.cwd));
  assert.ok(calls.every((call) => call.options.cwd === new URL("..", import.meta.url).pathname));
});

test("website probing uses the structured health identity instead of scraping HTML", async () => {
  const urls = [];
  const config = statusConfig({ HELM_STATUS_SITE_URL: "https://site.example" });
  const report = await collectEnvironmentStatus(config, {
    fetchImpl: async (url) => {
      urls.push(url);
      if (url === "https://site.example/health") return response(200, '{"ok":true,"product":"1Helm","surface":"website","version":"0.0.41"}');
      if (url === "https://site.example/api/releases/linux/latest") return response(503, "");
      return response(200, '{"product":"1Helm","version":"0.0.41"}');
    },
    sourceIdentity: { version: "0.0.41", commit: "abc123", dirty: false },
  });
  const site = report.environments.find(({ id }) => id === "website");
  assert.equal(site.health, "healthy");
  assert.equal(site.version, "0.0.41");
  const requested = urls.map((value) => new URL(value));
  assert.ok(requested.some((url) => url.origin === "https://site.example" && url.pathname === "/health" && url.search === "" && url.hash === ""));
  assert.ok(!requested.some((url) => url.origin === "https://site.example" && url.pathname === "/" && url.search === "" && url.hash === ""));
});
