import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});

const root = process.cwd();
const dataDir = join(root, ".native-test-data", `thread-audit-${process.pid}`);
const appPort = await freePort();
const mockPort = await freePort();
const base = `http://127.0.0.1:${appPort}`;
let app;
let mock;
let pass = 0;
let fail = 0;

const ok = (condition, label) => {
  if (condition) { pass++; console.log("  ok  -", label); }
  else { fail++; console.log("  FAIL-", label); }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, label, timeout = 12_000) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
};
const api = async (path, opts = {}, token = "") => {
  const response = await fetch(base + path, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

try {
  rmSync(dataDir, { recursive: true, force: true });
  mock = spawn(process.execPath, ["test/mock-openai.mjs", String(mockPort)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${mockPort}/v1/models`).catch(() => null))?.ok, "mock provider");

  app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      CTRL_DATA_DIR: dataDir,
      PORT: String(appPort),
      CLOUDFLARE_MOCK: "1",
      // Keep background loops far away; tests call the pass endpoint directly.
      IMPROVEMENT_INTERVAL_MS: "6000000",
      THREAD_AUDIT_INTERVAL_MS: "6000000",
      THREAD_AUDIT_MIN_IDLE_MS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  app.stdout.on("data", (chunk) => { diagnostics += chunk; });
  app.stderr.on("data", (chunk) => { diagnostics += chunk; });
  app.on("exit", (code) => { if (code && code !== 0) console.error(diagnostics); });
  await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "app start");

  const registration = await api("/api/auth/register", { body: { username: "captain", password: "secret-pass", display: "Captain" } });
  const captain = registration.body.token;
  ok(registration.status === 200 && captain, "captain registers");

  const provider = await api("/api/routing/action", {
    body: { action: "app:add-keyed-provider", payload: {
      name: "Deterministic provider",
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: "test",
      models: [{ id: "mock-small", name: "mock-small", enabled: true }],
    } },
  }, captain);
  ok(provider.status === 200 && provider.body.id, "routing provider is connected");
  const setup = await api("/api/setup/complete", {
    body: {
      model: "mock-small",
      terminals_enabled: false,
      name: "Audit Workspace",
    },
  }, captain);
  ok(setup.status === 200, "setup completes");

  const channel = await api("/api/channels", { body: { name: "ops", purpose: "Ops triage for audit tests" } }, captain);
  ok(channel.status === 201 && channel.body.channel?.id, "channel provisioned");
  const channelId = channel.body.channel.id;
  const agentName = channel.body.channel.agent.name;

  // Thread A: clearly finished — agent answered "done / complete".
  const doneRoot = await api(`/api/channels/${channelId}/messages`, {
    body: { body: `@${agentName} ship the checklist` },
  }, captain);
  ok(doneRoot.status === 200, "done root posted");
  await waitFor(async () => {
    const thread = await api(`/api/messages/${doneRoot.body.message.id}/thread`, {}, captain);
    return thread.body.replies?.some((message) => /Answer complete\./.test(message.body || ""));
  }, "agent finished done thread", 30_000);

  // Thread B: clearly waiting on human.
  const waitRoot = await api(`/api/channels/${channelId}/messages`, {
    body: { body: "please confirm which environment to deploy" },
  }, captain);
  ok(waitRoot.status === 200, "waiting root posted");
  // Seed a bot-less open thread with waiting language by writing a follow-up that stays human-only.
  await api(`/api/channels/${channelId}/messages`, {
    body: { body: "still waiting for your decision on staging vs prod", parentId: waitRoot.body.message.id },
  }, captain);

  // Thread C: ambiguous / still open work — should keep. Keep this fixture
  // human-only: resident-turn scheduling is covered elsewhere, and making the
  // thread-audit contract depend on a second unrelated agent turn caused this
  // focused test to race a loaded host.
  const openRoot = await api(`/api/channels/${channelId}/messages`, {
    body: { body: "explore options for the next sprint" },
  }, captain);
  ok(openRoot.status === 200, "open root posted");
  await api(`/api/channels/${channelId}/messages`, {
    body: { body: "keep this open — still gathering options, more work remains", parentId: openRoot.body.message.id },
  }, captain);

  const list = (await api(`/api/channels/${channelId}/threads`, {}, captain)).body.threads;
  const byRoot = Object.fromEntries(list.map((thread) => [thread.root_message_id, thread]));
  const doneThread = byRoot[doneRoot.body.message.id];
  const waitThread = byRoot[waitRoot.body.message.id];
  const openThread = byRoot[openRoot.body.message.id];
  ok(doneThread && waitThread && openThread, "three durable threads exist");

  // Force open + richer summaries via API (no concurrent SQLite handle against the live server).
  await api(`/api/threads/${doneThread.id}`, {
    method: "PATCH",
    body: {
      status: "open",
      summary: "**Goal:** ship the checklist\n\n**Latest outcome:** Answer complete. Work is done and finished.\n\n**Session status:** open.",
    },
  }, captain);
  await api(`/api/threads/${waitThread.id}`, {
    method: "PATCH",
    body: {
      status: "open",
      summary: "**Goal:** please confirm which environment\n\n**Latest request:** still waiting for your decision on staging vs prod\n\n**Session status:** open.",
    },
  }, captain);
  await api(`/api/threads/${openThread.id}`, {
    method: "PATCH",
    body: {
      status: "open",
      summary: "**Goal:** explore options for the next sprint\n\n**Latest request:** keep this open — still gathering options, more work remains\n\n**Session status:** open.",
    },
  }, captain);

  // Age candidates so the audit idle filter (even when set to 0) sees them as settled.
  await sleep(250);

  const audit = await api("/api/thread-audit/run", { body: {} }, captain);
  ok(audit.status === 200, "captain can run Skipper thread audit");
  ok(audit.body.examined >= 3, `audit examined open threads (got ${audit.body.examined})`);
  ok(audit.body.changed >= 1, `audit changed at least one status (got ${audit.body.changed}, source=${audit.body.source})`);

  const after = (await api(`/api/channels/${channelId}/threads`, {}, captain)).body.threads;
  const afterDone = after.find((thread) => thread.id === doneThread.id);
  const afterWait = after.find((thread) => thread.id === waitThread.id);
  const afterOpen = after.find((thread) => thread.id === openThread.id);

  ok(afterDone?.status === "resolved", `clearly finished thread marked resolved (got ${afterDone?.status})`);
  ok(afterWait?.status === "waiting" || afterWait?.status === "open", `blocked thread is waiting or left open conservatively (got ${afterWait?.status})`);
  ok(!["failed", "archived"].includes(afterOpen?.status), `ambiguous thread is not failed/archived (got ${afterOpen?.status})`);

  const activity = await api(`/api/channels/${channelId}/activity`, {}, captain);
  const rawActivity = activity.body.activity || [];
  const hasAuditLog = rawActivity.some((item) => item.kind === "thread_audit" || /Skipper marked thread/i.test(item.summary || ""));
  ok(hasAuditLog, "thread_audit activity is recorded");

  const routingState = await api("/api/routing/state", {}, captain);
  const systemRequest = (routingState.body.recentActivity || []).find((event) => event.request?.work_kind === "thread-audit");
  ok(systemRequest?.request?.initiator === "system" && String(systemRequest.request.id || "").startsWith("system-"),
    "silent audit routing is explicitly identified by its own system request identity");

  const forbidden = await api("/api/thread-audit/run", { body: {} }, "");
  ok(forbidden.status === 401 || forbidden.status === 403, "anonymous cannot run audit");
} catch (error) {
  fail++;
  console.error("\nThread audit test crashed:", error);
} finally {
  if (app && app.exitCode == null) {
    app.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => app.once("exit", resolve)), sleep(2000)]);
    if (app.exitCode == null) app.kill("SIGKILL");
  }
  if (mock && mock.exitCode == null) mock.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
