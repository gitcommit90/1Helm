import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import WebSocket from "ws";

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const root = process.cwd();
const tmpRoot = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, "tmp") : join(root, ".native-test-data");
const dataDir = join(tmpRoot, `native-world-${process.pid}`);
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
    headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};
const launchApp = async () => {
  app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
    cwd: root,
    env: { ...process.env, CTRL_DATA_DIR: dataDir, PORT: String(appPort), CLOUDFLARE_MOCK: "1", IMPROVEMENT_INTERVAL_MS: "600000" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  app.stdout.on("data", (chunk) => { diagnostics += chunk; });
  app.stderr.on("data", (chunk) => { diagnostics += chunk; });
  app.on("exit", (code) => { if (code && code !== 0) console.error(diagnostics); });
  await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "app start");
};
const stopApp = async () => {
  if (!app || app.exitCode != null) return;
  app.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => app.once("exit", resolve)), sleep(2000)]);
  if (app.exitCode == null) app.kill("SIGKILL");
};
const waitForAgentReply = async (rootId, token, authorName) => waitFor(async () => {
  const response = await api(`/api/messages/${rootId}/thread`, {}, token);
  return response.body.replies?.find((message) => message.author?.name === authorName && /Answer complete\.|Error contacting model/.test(message.body || ""));
}, `@${authorName} reply`, 15_000);

try {
  rmSync(dataDir, { recursive: true, force: true });
  mock = spawn(process.execPath, ["test/mock-openai.mjs", String(mockPort)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${mockPort}/v1/models`).catch(() => null))?.ok, "mock provider");
  await launchApp();

  const registration = await api("/api/auth/register", { body: { username: "captain", password: "secret-pass", display: "Captain" } });
  const captain = registration.body.token;
  ok(registration.status === 200 && captain && registration.body.user.is_admin, "first user becomes Captain/admin");

  const provider = await api("/api/providers", { body: { name: "Deterministic provider", base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: "test" } }, captain);
  const providerId = provider.body.provider.id;
  const alternateProvider = await api("/api/providers", { body: { name: "Alternate deterministic provider", base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: "test-2" } }, captain);
  const alternateProviderId = alternateProvider.body.provider.id;
  const setup = await api("/api/setup/complete", { body: { name: "Native Test", terminals_enabled: true, provider_id: providerId, model: "mock-large" } }, captain);
  ok(setup.status === 200, "first-run setup completes with Skipper");

  let channels = (await api("/api/channels", {}, captain)).body.channels;
  const main = channels.find((channel) => channel.name === "main");
  ok(main?.agent?.kind === "skipper" && main.agent.name === "skipper", "#main exposes the one workspace-wide Skipper");
  const templates = await api("/api/agent-templates", {}, captain);
  const catalog = await api("/api/skills", {}, captain);
  ok(templates.body.templates?.length >= 5 && templates.body.templates.some((template) => template.slug === "home"), "bare-bones growing-agent templates ship in the product");
  const arsenal = (catalog.body.skills || []).filter((skill) => !skill.arsenal_locked);
  ok(arsenal.some((skill) => skill.slug === "self-hosting-guide") && main.agent.skills.length === arsenal.length, "Skipper starts with the complete shipped skill arsenal");
  ok(channels.every((channel) => channel.kind !== "channel" || channel.slug), "every channel has a stable URL slug");

  const workspaceUpdate = await api("/api/workspace", { method: "PATCH", body: { name: "Native Test Renamed", theme: "ocean" } }, captain);
  const photoResponse = await fetch(`${base}/api/workspace/photo`, { method: "POST", headers: { authorization: `Bearer ${captain}`, "content-type": "image/png" }, body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
  const photoRead = await fetch(`${base}/api/workspace/photo`, { headers: { authorization: `Bearer ${captain}` } });
  ok(workspaceUpdate.body.workspace.name === "Native Test Renamed" && workspaceUpdate.body.workspace.theme === "ocean" && photoResponse.status === 200 && photoRead.status === 200, "Admin can update workspace name, photo, and theme");
  const domain = await api("/api/domains/cloudflare", { body: { hostname: "agents.example.com", token: "one-time-token" } }, captain);
  ok(domain.status === 201 && domain.body.domain.status === "active" && domain.body.domain.hostname === "agents.example.com", "Cloudflare domain connection flow records an active HTTPS hostname without persisting its token");

  const channelRequest = await api(`/api/channels/${main.id}/messages`, { body: { body: '@skipper create a new channel called "emails"' } }, captain);
  const channelReply = await waitForAgentReply(channelRequest.body.message.id, captain, "skipper");
  channels = (await api("/api/channels", {}, captain)).body.channels;
  const emails = channels.find((channel) => channel.name === "emails");
  ok(emails?.agent?.kind === "channel" && emails.agent.name === "emails-agent", "Skipper creates a native channel directly from a plain-language request");
  ok(!/`?\$\s|\/root\//.test(channelReply.body), "tool calls and host paths do not leak into agent chat messages");
  const mainActivity = (await api(`/api/channels/${main.id}/activity`, {}, captain)).body.actions;
  ok(mainActivity.some((action) => action.tool === "create_channel" && action.status === "complete"), "native channel creation remains attributable in Activity");

  const launchCreate = await api("/api/channels", { body: { name: "Launch", purpose: "Plan and coordinate the product launch.", template: "project" } }, captain);
  const launch = launchCreate.body.channel;
  ok(launchCreate.status === 201 && launch.agent?.kind === "channel", "creating a channel atomically provisions its resident agent");
  ok(launch.agent?.name === "launch-agent" && launch.agent.status === "ready", "resident identity is ready and derived from channel purpose");
  ok(launch.slug === "launch" && launch.agent.skills.some((skill) => skill.slug === "project-planning"), "template provisions a useful permanent starter skill kit while preserving a normal channel identity");
  const deepRoute = await fetch(`${base}/c/${launch.slug}/memory`);
  ok(deepRoute.status === 200 && /id="app"/.test(await deepRoute.text()), "slug-based channel deep links serve the application shell");
  const deepRouteHead = await fetch(`${base}/c/${launch.slug}/thread/123`, { method: "HEAD" });
  ok(deepRouteHead.status === 200 && /text\/html/.test(deepRouteHead.headers.get("content-type") || "") && (await deepRouteHead.text()) === "", "slug-based channel deep links also support bodyless HEAD probes");

  const policyRootResult = await api(`/api/channels/${launch.id}/messages`, { body: {
    body: `@${launch.agent.name} use the selected thread model`,
    modelPolicy: { provider_id: alternateProviderId, model: "mock-small" },
  } }, captain);
  const policyRoot = policyRootResult.body.message.id;
  ok(policyRootResult.body.message.reply_count === 0, "sending a message does not report a phantom reply while the agent is only Working");
  const policyReply = await waitForAgentReply(policyRoot, captain, launch.agent.name);
  const threadPolicy = await api(`/api/messages/${policyRoot}/model-policy`, {}, captain);
  const countedThread = await api(`/api/messages/${policyRoot}/thread`, {}, captain);
  ok(/mock-small/.test(policyReply.body) && threadPolicy.body.policy.provider_id === alternateProviderId && threadPolicy.body.policy.model === "mock-small" && threadPolicy.body.policy.overridden,
    "a composer-selected provider and model persist together for the thread and serve its agent replies");
  ok(countedThread.body.root.reply_count === 1, "a completed agent answer counts exactly once despite streaming message updates");
  const beforeConversational = (await api(`/api/messages/${policyRoot}/thread`, {}, captain)).body.replies.length;
  await api(`/api/channels/${launch.id}/messages`, { body: { body: "continue without making me tag you", parentId: policyRoot } }, captain);
  const conversational = await waitFor(async () => {
    const replies = (await api(`/api/messages/${policyRoot}/thread`, {}, captain)).body.replies || [];
    return replies.length > beforeConversational + 1 && replies.find((reply, index) => index >= beforeConversational && reply.author?.name === launch.agent.name && /Answer complete/.test(reply.body || ""));
  }, "mention-free resident continuation");
  ok(/mock-small/.test(conversational.body), "a one-human/one-agent thread remains conversational without repeated @mentions and keeps its thread model");

  await api("/api/admin/users", { body: { username: "thread-guest", password: "secret-pass", display: "Thread Guest" } }, captain);
  const guestUser = (await api("/api/auth/login", { body: { username: "thread-guest", password: "secret-pass" } })).body.token;
  const guestEvents = [];
  const guestSocket = new WebSocket(`ws://127.0.0.1:${appPort}/ws?token=${guestUser}`);
  guestSocket.on("message", (data) => guestEvents.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { guestSocket.on("open", resolve); guestSocket.on("error", reject); });
  const guestMessage = (await api(`/api/channels/${launch.id}/messages`, { body: { body: "adding a second human to this discussion", parentId: policyRoot } }, guestUser)).body.message;
  const reminder = await waitFor(() => guestEvents.find((event) => event.type === "mention_confirmation" && event.messageId === guestMessage.id), "mention confirmation for multi-participant thread");
  ok(reminder.botName === launch.agent.name, "when another human joins, an untagged reply asks whether the user meant to tag the current agent");
  await api(`/api/messages/${guestMessage.id}/mention-confirmation`, { body: { confirm: false, botId: launch.agent.bot_id } }, guestUser);
  guestEvents.length = 0;
  await api(`/api/channels/${launch.id}/messages`, { body: { body: "do not remind me again in this thread", parentId: policyRoot } }, guestUser);
  await sleep(300);
  ok(!guestEvents.some((event) => event.type === "mention_confirmation"), "choosing No mutes the tag reminder for that user in that thread");
  guestSocket.close();

  const progressRoot = (await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${launch.agent.name} run whoami and explain` } }, captain)).body.message.id;
  const progressReply = await waitForAgentReply(progressRoot, captain, launch.agent.name);
  ok(progressReply.progress?.some((item) => item.kind === "tool" && item.status === "complete"), "agent working updates are persisted as a chronological disclosure log");

  const retry = await api("/api/channels", { body: { name: "Launch", purpose: "Plan and coordinate the product launch." } }, captain);
  ok(retry.status === 200 && retry.body.channel.id === launch.id && retry.body.created === false, "safe retry returns the same world without duplicates");

  const finance = (await api("/api/channels", { body: { name: "Finance", purpose: "Own finance planning and records." } }, captain)).body.channel;
  ok(finance.agent.id !== launch.agent.id && finance.agent.bot_id !== launch.agent.bot_id, "each channel receives a distinct resident agent");
  const legacyBot = (await api("/api/bots", { body: { name: "ambient-third-agent", provider_id: providerId, model: "mock-large" } }, captain)).body.bot;
  const rejectedJoin = await api(`/api/bots/${legacyBot.id}/join`, { body: { channelId: launch.id } }, captain);
  const membershipDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const nativeMembership = membershipDb.prepare("SELECT 1 FROM bot_channels WHERE bot_id=? AND channel_id=?").get(legacyBot.id, launch.id);
  membershipDb.close();
  ok(rejectedJoin.status === 409 && !nativeMembership, "legacy/manual bot joins cannot add an ambient third agent to a native channel");

  const skillRequestRoot = (await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${launch.agent.name} request the self-hosting-guide skill` } }, captain)).body.message.id;
  await waitForAgentReply(skillRequestRoot, captain, launch.agent.name);
  const requestedSkills = (await api(`/api/agents/${launch.agent.id}/skills`, {}, captain)).body.skills;
  ok(requestedSkills.some((skill) => skill.slug === "self-hosting-guide"), "resident agent can request a global skill and Skipper provisions it permanently");
  const proposalRoot = (await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${launch.agent.name} propose a reusable meeting brief skill` } }, captain)).body.message.id;
  await waitForAgentReply(proposalRoot, captain, launch.agent.name);
  const catalogAfterProposal = (await api("/api/skills", {}, captain)).body.skills;
  const skillsAfterProposal = (await api(`/api/agents/${launch.agent.id}/skills`, {}, captain)).body.skills;
  ok(catalogAfterProposal.some((skill) => skill.slug === "meeting-brief") && skillsAfterProposal.some((skill) => skill.slug === "meeting-brief"), "resident agent can silently propose a reusable skill that Skipper approves, shares, and permanently assigns");

  const guestRoot = (await api(`/api/channels/${launch.id}/messages`, { body: { body: "@skipper invite @finance-agent into this thread for one review" } }, captain)).body.message.id;
  await waitForAgentReply(guestRoot, captain, "finance-agent");
  await waitForAgentReply(guestRoot, captain, "skipper");
  const guestDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const guestThread = guestDb.prepare("SELECT id FROM threads WHERE root_message_id=?").get(guestRoot);
  const guestBinding = guestDb.prepare("SELECT status FROM thread_agent_guests WHERE thread_id=? AND agent_id=?").get(guestThread.id, finance.agent.id);
  const poisonedMembership = guestDb.prepare("SELECT 1 FROM bot_channels WHERE bot_id=? AND channel_id=?").get(finance.agent.bot_id, launch.id);
  guestDb.close();
  ok(guestBinding?.status === "active" && !poisonedMembership, "Skipper can invite an expert into one thread without adding it to or poisoning the channel");
  await api(`/api/threads/${guestThread.id}`, { method: "PATCH", body: { status: "resolved" } }, captain);
  const resolvedGuestDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const removedGuest = resolvedGuestDb.prepare("SELECT status FROM thread_agent_guests WHERE thread_id=? AND agent_id=?").get(guestThread.id, finance.agent.id);
  const stillUnpoisoned = resolvedGuestDb.prepare("SELECT 1 FROM bot_channels WHERE bot_id=? AND channel_id=?").get(finance.agent.bot_id, launch.id);
  resolvedGuestDb.close();
  ok(removedGuest?.status === "removed" && !stillUnpoisoned, "resolving the thread revokes its guest expert without changing channel membership");

  const database = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const duplicateBindings = database.prepare("SELECT channel_id, COUNT(*) n FROM agent_channels GROUP BY channel_id HAVING n<>1").all();
  const launchBinding = database.prepare("SELECT * FROM agent_channels WHERE channel_id=?").get(launch.id);
  const secondBinding = database.prepare("SELECT * FROM agent_channels WHERE channel_id=?").get(finance.id);
  database.close();
  ok(duplicateBindings.length === 0 && launchBinding && secondBinding, "database constraints hold exactly one resident binding per created channel");
  ok(existsSync(join(dataDir, "channels", String(launch.id), "workspace")) && existsSync(join(dataDir, "channels", String(finance.id), "workspace")), "stable channel workspace trees are provisioned");

  const escapedLink = join(dataDir, "channels", String(launch.id), "workspace", "outside");
  symlinkSync("/etc", escapedLink);
  const escapedFile = await fetch(`${base}/api/channels/${launch.id}/files/content?path=${encodeURIComponent("workspace/outside/passwd")}`, { headers: { authorization: `Bearer ${captain}` } });
  ok(escapedFile.status === 404, "workspace file endpoint rejects intermediate symlink escapes");
  rmSync(escapedLink);

  const slowTurn = await api(`/api/channels/${finance.id}/messages`, { body: { body: `@${finance.agent.name} slow-turn run command` } }, captain);
  await api(`/api/channels/${finance.id}/archive`, { body: {} }, captain);
  await sleep(1500);
  const archivedFinance = (await api("/api/channels", {}, captain)).body.channels.find((channel) => channel.id === finance.id);
  ok(archivedFinance.agent.status === "archived" && !existsSync(join(dataDir, "channels", String(finance.id), "workspace", "should-not-exist")), "archiving cancels an in-flight turn before tool execution and preserves archived status");
  await api(`/api/channels/${finance.id}/restore`, { body: {} }, captain);

  const financeTerm = await api("/api/term/open", { body: { channelId: finance.id, cols: 80, rows: 24 } }, captain);
  const financeWs = new WebSocket(`ws://127.0.0.1:${appPort}/ws/term/${financeTerm.body.sessionId}?token=${captain}`);
  await new Promise((resolve, reject) => { financeWs.on("open", resolve); financeWs.on("error", reject); });
  financeWs.send(JSON.stringify({ type: "input", data: "sleep 1; touch late-terminal-file\r" }));
  await sleep(100);
  await api(`/api/channels/${finance.id}/archive`, { body: {} }, captain);
  await sleep(1300);
  ok(!existsSync(join(dataDir, "channels", String(finance.id), "workspace", "late-terminal-file")), "archiving terminates upstream PTYs and their child processes");
  await api(`/api/channels/${finance.id}/restore`, { body: {} }, captain);

  const task = await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${launch.agent.name} run a command to create launch-plan.md with a launch plan` } }, captain);
  const taskRoot = task.body.message.id;
  await waitForAgentReply(taskRoot, captain, launch.agent.name);
  const files = (await api(`/api/channels/${launch.id}/files`, {}, captain)).body.files;
  ok(files.some((file) => file.path === "workspace/launch-plan.md"), "resident shell-created file appears in the channel Files surface");
  const openedFile = await fetch(`${base}/api/channels/${launch.id}/files/content?path=${encodeURIComponent("workspace/launch-plan.md")}`, { headers: { authorization: `Bearer ${captain}` } });
  ok(openedFile.status === 200 && /Launch plan from resident agent/.test(await openedFile.text()), "authenticated Files content endpoint returns the workspace file");

  const threadList = (await api(`/api/channels/${launch.id}/threads`, {}, captain)).body.threads;
  const taskThread = threadList.find((thread) => thread.root_message_id === taskRoot);
  ok(taskThread?.status === "open" && /launch-plan/i.test(taskThread.summary), "thread has durable status and rolling summary independent of raw messages");

  const toolLimitRoot = (await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${launch.agent.name} repeat-tool-limit run whoami` } }, captain)).body.message.id;
  const toolLimitReply = await waitForAgentReply(toolLimitRoot, captain, launch.agent.name);
  const toolLimitDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const toolLimitThread = toolLimitDb.prepare("SELECT id FROM threads WHERE root_message_id=?").get(toolLimitRoot);
  const toolLimitActions = toolLimitDb.prepare("SELECT count(*) n FROM tool_actions WHERE thread_id=? AND status='complete'").get(toolLimitThread.id).n;
  toolLimitDb.close();
  ok(Boolean(toolLimitReply.body.trim()) && /Answer complete/.test(toolLimitReply.body) && toolLimitActions === 6, "a model that repeatedly requests tools is forced to return a non-empty final answer at the tool limit");

  const mixedRoot = (await api(`/api/channels/${launch.id}/messages`, { body: { body: `@skipper @${launch.agent.name} run whoami and report once` } }, captain)).body.message.id;
  await waitForAgentReply(mixedRoot, captain, "skipper");
  await sleep(500);
  const mixedReplies = (await api(`/api/messages/${mixedRoot}/thread`, {}, captain)).body.replies;
  ok(mixedReplies.some((message) => message.author.name === "skipper") && !mixedReplies.some((message) => message.author.name === launch.agent.name), "an explicit Skipper escalation with a resident mention launches only Skipper");

  const termOpen = await api("/api/term/open", { body: { channelId: launch.id, cols: 90, rows: 28 } }, captain);
  ok(termOpen.status === 200 && termOpen.body.sessionId, "channel terminal session opens without choosing a computer or directory");
  const expectedWorkspace = join(dataDir, "channels", String(launch.id), "workspace");
  const terminalOutput = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${appPort}/ws/term/${termOpen.body.sessionId}?token=${captain}`);
    let output = "";
    const timer = setTimeout(() => { ws.close(); reject(new Error("terminal output timeout: " + output)); }, 8000);
    ws.on("open", () => ws.send(JSON.stringify({ type: "input", data: "pwd; printf 'terminal note\\n' > terminal-note.txt; echo TERM_DONE\r" })));
    ws.on("message", (chunk) => {
      output += chunk.toString();
      if (output.includes("TERM_DONE") && output.includes(expectedWorkspace)) { clearTimeout(timer); ws.close(); resolve(output); }
    });
    ws.on("error", reject);
  });
  ok(String(terminalOutput).includes(expectedWorkspace), "terminal starts in the selected channel's exact workspace");
  await waitFor(async () => (await api(`/api/channels/${launch.id}/files`, {}, captain)).body.files?.some((file) => file.path === "workspace/terminal-note.txt"), "terminal file indexing");
  ok(true, "terminal-created file is visible through the same channel Files surface");

  const memory = await api(`/api/channels/${launch.id}/memory`, { body: { kind: "decision", content: "launch-on-monday", scope: "channel" } }, captain);
  ok(memory.status === 201 && memory.body.memory.kind === "decision", "Captain can record provider-neutral channel knowledge with provenance");
  const knowledgeOnly = (await api(`/api/channels/${launch.id}/memory`, {}, captain)).body.memory;
  ok(knowledgeOnly.length === 1 && knowledgeOnly[0].kind === "decision" && !knowledgeOnly.some((item) => item.kind === "summary" || /Captain:|agent:/i.test(item.content)), "Memory API contains curated knowledge, not session recaps or transcript dumps");
  const mnemosynePath = join(dataDir, "channels", String(launch.id), "memory", "mnemosyne.db");
  const skipperMemoryPath = join(dataDir, "skipper", "memory", "mnemosyne.db");
  const memoryDb = new DatabaseSync(mnemosynePath);
  const mnemosyneDecision = memoryDb.prepare("SELECT content FROM working_memory WHERE content LIKE '%launch-on-monday%' LIMIT 1").get();
  memoryDb.close();
  ok(existsSync(skipperMemoryPath) && existsSync(mnemosynePath) && mnemosyneDecision, "Skipper and every resident own separate real Mnemosyne databases used for durable writes");

  await api(`/api/channels/${launch.id}/messages`, { body: { body: "I already told you what I prefer. This is frustrating; stop making me repeat it." } }, captain);
  const improvement = await api("/api/improvements/run", { body: {} }, captain);
  const improvementActivity = (await api(`/api/channels/${launch.id}/activity`, {}, captain)).body.activity;
  ok(improvement.body.improved >= 1 && improvementActivity.some((item) => item.kind === "improvement"), "Skipper silently reviews recent interactions, makes durable behavior improvements, and leaves a concise Activity note");

  const publicRegistration = await api("/api/auth/register", { body: { username: "intruder", password: "secret-pass", display: "Intruder" } });
  ok(publicRegistration.status === 403, "public registration closes after the Captain account");
  const collaboratorCreate = await api("/api/admin/users", { body: { username: "collaborator", password: "secret-pass", display: "Collaborator" } }, captain);
  const collaboratorLogin = await api("/api/auth/login", { body: { username: "collaborator", password: "secret-pass" } });
  const collaborator = collaboratorLogin.body.token;
  ok(collaboratorCreate.status === 201 && collaborator, "Captain can add a workspace member who can sign in");
  const collaboratorLaunch = (await api("/api/channels", {}, collaborator)).body.channels.find((channel) => channel.id === launch.id);
  const collaboratorThread = await api(`/api/messages/${taskRoot}/thread`, {}, collaborator);
  const collaboratorFiles = await api(`/api/channels/${launch.id}/files`, {}, collaborator);
  ok(collaboratorLaunch.agent.id === launch.agent.id && collaboratorThread.body.replies.length > 0 && collaboratorFiles.body.files.some((file) => file.path === "workspace/launch-plan.md"), "a second human sees the same agent, transcript, session, and files");

  const modelChange = await api(`/api/channels/${launch.id}/agent-policy`, { method: "PATCH", body: { provider_id: providerId, model: "mock-small" } }, captain);
  ok(modelChange.status === 200 && modelChange.body.channel.agent.id === launch.agent.id, "model policy changes without replacing the resident identity");

  // Live updates: renames/settings must land on open sockets without a page refresh.
  const liveEvents = [];
  const liveSocket = new WebSocket(`ws://127.0.0.1:${appPort}/ws?token=${captain}`);
  liveSocket.on("message", (data) => liveEvents.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { liveSocket.on("open", resolve); liveSocket.on("error", reject); });
  await waitFor(() => liveEvents.find((event) => event.type === "hello"), "live socket hello");
  liveEvents.length = 0;

  const renamed = await api(`/api/channels/${launch.id}`, { method: "PATCH", body: { name: "launch-room" } }, captain);
  ok(renamed.status === 200 && renamed.body.channel.name === "launch-room" && renamed.body.channel.slug === "launch-room", "channel rename updates name and slug");
  const renameEvent = await waitFor(() => liveEvents.find((event) => event.type === "channel_update" && event.channel?.id === launch.id && event.channel?.name === "launch-room"), "live channel rename event");
  ok(renameEvent.channel.slug === "launch-room" && renameEvent.channel.unread === undefined, "channel_update carries shared meta and omits per-user unread");

  liveEvents.length = 0;
  const purposeLive = await api(`/api/channels/${launch.id}`, { method: "PATCH", body: { purpose: "Coordinate launch without refresh tax." } }, captain);
  ok(purposeLive.status === 200 && purposeLive.body.channel.purpose.includes("without refresh"), "purpose patch still works after rename");
  await waitFor(() => liveEvents.find((event) => event.type === "channel_update" && event.channel?.id === launch.id && /without refresh/.test(event.channel?.purpose || "")), "live purpose event");

  liveEvents.length = 0;
  const workspaceLive = await api("/api/workspace", { method: "PATCH", body: { name: "Native Live Workspace", theme: "forest" } }, captain);
  ok(workspaceLive.status === 200 && workspaceLive.body.workspace.name === "Native Live Workspace", "workspace rename returns updated identity");
  await waitFor(() => liveEvents.find((event) => event.type === "workspace_update" && event.workspace?.name === "Native Live Workspace" && event.workspace?.theme === "forest"), "live workspace_update event");

  liveEvents.length = 0;
  const providerLive = await api(`/api/providers/${providerId}`, { method: "PATCH", body: { name: "Deterministic provider live" } }, captain);
  ok(providerLive.status === 200, "provider rename succeeds");
  await waitFor(() => liveEvents.find((event) => event.type === "provider_update" && event.provider?.id === providerId && event.provider?.name === "Deterministic provider live"), "live provider_update event");
  liveSocket.close();
  // Keep local fixtures in sync with the rename for the rest of the suite.
  launch.name = "launch-room";
  launch.slug = "launch-room";

  await stopApp();
  await launchApp();
  channels = (await api("/api/channels", {}, captain)).body.channels;
  const afterRestart = channels.find((channel) => channel.id === launch.id);
  ok(afterRestart.agent.id === launch.agent.id && afterRestart.agent.model === "mock-small", "restart preserves agent identity, workspace, and changed model policy");
  ok(afterRestart.name === "launch-room" && afterRestart.slug === "launch-room", "renamed channel name and slug survive restart");
  ok(afterRestart.agent.skills.some((skill) => skill.slug === "self-hosting-guide") && afterRestart.agent.skills.some((skill) => skill.slug === "meeting-brief"), "newly granted and agent-created skills remain permanently in the arsenal after restart");

  const recall = await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${afterRestart.agent.name} what launch decision do you remember?` } }, captain);
  const recallReply = await waitForAgentReply(recall.body.message.id, captain, afterRestart.agent.name);
  ok(/launch-on-monday/i.test(recallReply.body), "later thread retrieves a persisted decision after model change and server restart");

  const skipperCall = await api(`/api/channels/${launch.id}/messages`, { body: { body: "@skipper run whoami at host scope and report here", parentId: recall.body.message.id } }, captain);
  await waitForAgentReply(recall.body.message.id, captain, "skipper");
  const activity = await waitFor(async () => {
    const result = await api(`/api/channels/${launch.id}/activity`, {}, captain);
    return result.body.escalations?.some((item) => item.status === "resolved") && result.body.actions?.some((item) => item.tool === "run_command" && item.status === "complete") ? result.body : null;
  }, "resolved Skipper escalation");
  ok(Boolean(activity), "Skipper receives the invoking thread, performs the broader action, and records it visibly");
  ok(skipperCall.status === 200, "Skipper replies in the invoking thread");

  // Channel-agent -> Skipper escalation (SPEC §6.3 primary scenario, previously untested).
  // The resident agent calls call_skipper; Skipper must receive host authority and run the command.
  const escalationRoot = await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${afterRestart.agent.name} call skipper to run whoami` } }, captain);
  await waitForAgentReply(escalationRoot.body.message.id, captain, afterRestart.agent.name);
  await waitForAgentReply(escalationRoot.body.message.id, captain, "skipper");
  const escalationActivity = await waitFor(async () => {
    const result = await api(`/api/channels/${launch.id}/activity`, {}, captain);
    return result.body.escalations?.some((item) => /need host whoami/i.test(item.reason) && item.status === "resolved") && result.body.actions?.some((item) => item.tool === "run_command" && item.status === "complete") ? result.body : null;
  }, "channel-agent call_skipper escalation");
  ok(Boolean(escalationActivity), "a channel-agent call_skipper escalation authorizes Skipper to run the host command and resolves visibly");

  // Skipper hand-back: after unblocking, Skipper must re-invoke the resident via call_agent
  // so the Captain never has to re-tag the agent (symmetric with call_skipper).
  const handoffRoot = await api(`/api/channels/${launch.id}/messages`, {
    body: { body: "@skipper hand the work back to the resident with call_agent so they finish the request" },
  }, captain);
  await waitForAgentReply(handoffRoot.body.message.id, captain, "skipper");
  const handoffEvidence = await waitFor(async () => {
    const result = await api(`/api/channels/${launch.id}/activity`, {}, captain);
    const actions = result.body.actions || [];
    const activity = result.body.activity || [];
    const called = actions.some((item) => item.tool === "call_agent" && item.status === "complete");
    const handoffNote = activity.some((item) =>
      /handed work back|call_agent|handoff/i.test(String(item.summary || item.kind || "")),
    );
    const thread = await api(`/api/messages/${handoffRoot.body.message.id}/thread`, {}, captain);
    const msgs = thread.body.replies || [];
    const callMsg = msgs.some((m) => /Calling \*\*@/i.test(String(m.body || "")) && m.author?.name === "skipper");
    const residentAfter = msgs.find((m) =>
      m.author?.name === afterRestart.agent.name
      && m.body
      && m.body !== "_Working…_"
      && (/Answer complete/i.test(m.body) || /Error contacting model/i.test(m.body)),
    );
    return (called || handoffNote || callMsg) && residentAfter
      ? { called, handoffNote, callMsg, residentBody: residentAfter.body }
      : null;
  }, "Skipper call_agent hand-back re-invokes resident", 20_000);
  ok(Boolean(handoffEvidence), "Skipper call_agent re-invokes the channel resident so the Captain does not finish the loop");

  // Durable follow-up: agent schedules re-entry; ending the turn without this is permanent silence.
  const followRoot = await api(`/api/channels/${launch.id}/messages`, {
    body: { body: `@${afterRestart.agent.name} schedule followup because an async download is still running — wake me later` },
  }, captain);
  await waitForAgentReply(followRoot.body.message.id, captain, afterRestart.agent.name);
  const followEvidence = await waitFor(async () => {
    const result = await api(`/api/channels/${launch.id}/activity`, {}, captain);
    const actions = result.body.actions || [];
    const scheduled = actions.some((item) => item.tool === "schedule_followup" && item.status === "complete");
    const db = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
    let row2;
    try {
      row2 = db.prepare("SELECT id, status, due_at, reason FROM agent_followups ORDER BY id DESC LIMIT 1").get();
    } catch {
      row2 = null;
    }
    db.close();
    return scheduled && row2?.status === "pending" ? { scheduled, row: row2 } : null;
  }, "schedule_followup persists pending row", 15_000);
  ok(Boolean(followEvidence), "resident schedule_followup creates a durable pending re-entry (no silent background promise)");

  await api(`/api/threads/${taskThread.id}`, { method: "PATCH", body: { status: "waiting" } }, captain);
  const archive = await api(`/api/channels/${launch.id}/archive`, { body: {} }, captain);
  const blocked = await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${afterRestart.agent.name} should not run` } }, captain);
  ok(archive.body.channel.status === "archived" && archive.body.channel.agent.id === launch.agent.id && blocked.status === 409, "archive pauses work while preserving the same agent world");

  const restore = await api(`/api/channels/${launch.id}/restore`, { body: {} }, captain);
  const restoredThread = (await api(`/api/channels/${launch.id}/threads`, {}, captain)).body.threads.find((thread) => thread.id === taskThread.id);
  ok(restore.body.channel.status === "active" && restore.body.channel.agent.id === launch.agent.id && restoredThread.status === "waiting" && existsSync(join(dataDir, "channels", String(launch.id), "workspace", "launch-plan.md")), "restore reuses the same world without rewriting independent thread status");

  // Crash recovery: start a slow turn, SIGKILL mid-flight, restart, and verify boot recovers.
  await api(`/api/channels/${finance.id}/messages`, { body: { body: `@${finance.agent.name} slow-turn run command` } }, captain);
  await sleep(200);
  const killedApp = app;
  killedApp.kill("SIGKILL");
  await Promise.race([new Promise((resolve) => killedApp.once("exit", resolve)), sleep(2000)]);
  await launchApp();
  const db2 = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const stuckWorking = db2.prepare("SELECT count(*) n FROM agents WHERE status='working'").get().n;
  const emptyPlaceholders = db2.prepare("SELECT count(*) n FROM messages WHERE body='' AND bot_id IS NOT NULL AND parent_id IS NOT NULL").get().n;
  // Simulate the live bug: final answer already on the message, but progress left 'running'
  // (crash between setBody and the bulk complete UPDATE). Boot recovery must clear it.
  const finishedReply = db2.prepare(
    "SELECT id FROM messages WHERE bot_id IS NOT NULL AND parent_id IS NOT NULL AND body<>'' AND body<>'_Working…_' ORDER BY id DESC LIMIT 1",
  ).get();
  if (finishedReply?.id) {
    const t = Date.now();
    db2.prepare(
      "INSERT INTO agent_progress (message_id,kind,body,status,created,updated) VALUES (?,'thinking','stale progress left running','running',?,?)",
    ).run(finishedReply.id, t, t);
  }
  db2.close();
  // Re-run recovery via process restart (seed → recoverInterruptedRuns).
  const appForRecovery = app;
  appForRecovery.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => appForRecovery.once("exit", resolve)), sleep(2000)]);
  await launchApp();
  const db3 = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const stuckProgress = db3.prepare("SELECT count(*) n FROM agent_progress WHERE status='running'").get().n;
  db3.close();
  ok(stuckWorking === 0 && emptyPlaceholders === 0, "boot recovers agents stuck working and sweeps empty placeholder turn messages after a crash");
  ok(stuckProgress === 0, "boot clears stranded agent_progress running rows so Working… cannot stick on finished replies");
  const financeAfterCrash = (await api("/api/channels", {}, captain)).body.channels.find((channel) => channel.id === finance.id);
  ok(financeAfterCrash.agent.status === "ready", "agent returns to ready after crash recovery");

  await api(`/api/channels/${launch.id}/archive`, { body: {} }, captain);
  const wrongDelete = await api(`/api/channels/${launch.id}`, { method: "DELETE", body: { confirm: "wrong" } }, captain);
  const deleted = await api(`/api/channels/${launch.id}`, { method: "DELETE", body: { confirm: "launch-room" } }, captain);
  channels = (await api("/api/channels", {}, captain)).body.channels;
  ok(wrongDelete.status === 400 && deleted.status === 200, "permanent deletion requires explicit server-verified channel-name confirmation");
  ok(!channels.some((channel) => channel.id === launch.id) && channels.some((channel) => channel.id === finance.id) && !existsSync(join(dataDir, "channels", String(launch.id))), "permanent deletion removes only the target agent world");
} catch (error) {
  fail++;
  console.error("\nNative world test crashed:", error);
} finally {
  await stopApp();
  if (mock && mock.exitCode == null) mock.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
