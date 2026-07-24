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
let captain = "";
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
    env: {
      ...process.env,
      CTRL_DATA_DIR: dataDir,
      PORT: String(appPort),
      CLOUDFLARE_MOCK: "1",
      IMPROVEMENT_INTERVAL_MS: "600000",
      CTRL_MAX_TOOL_ROUNDS: "6",
      NODE_ENV: "test",
      HELM_CHANNEL_COMPUTER_BACKEND: "native",
      HELM_TEST_WEB_SEARCH_FIXTURE: JSON.stringify([{
        title: "West Hollywood sinkhole filled after water main repairs",
        url: "https://example.com/news/sunset-sinkhole",
        snippet: "A water-main rupture created a roadway sinkhole on Sunset Boulevard.",
        source: "Example News",
        published_at: "2026-07-23T18:00:00.000Z",
        image_url: "https://example.com/images/sunset-sinkhole.jpg",
      }]),
      HELM_TEST_WEB_SOURCE_FIXTURES: JSON.stringify({
        "https://example.com/openterminal/": [
          "# Open Terminal",
          "A lightweight self-hosted REST API for agent shell commands and files.",
          "Install with `pip install open-terminal`; Docker is recommended for isolation.",
          "Require an API key. Bare-metal commands run with the service user's real host permissions.",
          "Mounting the Docker socket is effective host-root access. File-browser root is only a UI hint.",
          "Single-container multi-user mode is not hard production isolation.",
        ].join("\n\n"),
        "https://example.com/news/sunset-sinkhole": "Sunset Boulevard reopened after crews repaired a broken water main and filled and stabilized the resulting roadway collapse.",
        "https://example.com/images/sunset-sinkhole.jpg": { content_type: "image/jpeg", base64: "/9j/2Q==" },
      }),
    },
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
  captain = registration.body.token;
  ok(registration.status === 200 && captain && registration.body.user.is_admin, "first user becomes Captain/admin");

  const provider = await api("/api/providers", { body: { name: "Deterministic provider", base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: "test" } }, captain);
  const providerId = provider.body.provider.id;
  const primaryLargeModel = provider.body.models.find((model) => model.name === "mock-large").id;
  const primarySmallModel = provider.body.models.find((model) => model.name === "mock-small").id;
  const alternateProvider = await api("/api/providers", { body: { name: "Alternate deterministic provider", base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: "test-2" } }, captain);
  const alternateProviderId = alternateProvider.body.provider.id;
  const alternateSmallModel = alternateProvider.body.models.find((model) => model.name === "mock-small").id;
  const setup = await api("/api/setup/complete", { body: { name: "Native Test", terminals_enabled: true, provider_id: providerId, model: primaryLargeModel } }, captain);
  ok(setup.status === 200, "first-run setup completes with Skipper");

  const hostDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const hostComputer = hostDb.prepare("SELECT base_url,api_key FROM computers WHERE name='This Computer' LIMIT 1").get();
  hostDb.close();
  const hostPathResponse = await fetch(`${hostComputer.base_url}/execute?wait=5`, {
    method: "POST",
    headers: { authorization: `Bearer ${hostComputer.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ command: `printf '%s' "$PATH"` }),
  });
  const hostPathResult = await hostPathResponse.json();
  const hostPath = (hostPathResult.output || []).map((entry) => entry.data).join("");
  ok(hostPath.startsWith("/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:"), "Skipper host commands restore Homebrew paths after login-shell startup");

  let channels = (await api("/api/channels", {}, captain)).body.channels;
  const main = channels.find((channel) => channel.name === "main");
  ok(main?.agent?.kind === "skipper" && main.agent.name === "skipper", "#main exposes the one workspace-wide Skipper");
  ok(main.agent.runtime.avatar === "color:#4F6D7A", "Skipper starts with the customizable flat-color avatar");
  const skipperTerm = await api("/api/term/open", { body: { channelId: main.id, cols: 240, rows: 28 } }, captain);
  const skipperTermState = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${appPort}/ws/term/${skipperTerm.body.sessionId}?token=${captain}`);
    let output = "";
    const timer = setTimeout(() => { ws.close(); reject(new Error("Skipper terminal PATH timeout: " + output)); }, 8000);
    ws.on("open", () => ws.send(JSON.stringify({ type: "input", data: `printf 'HELM_PATH=%s\\n' "$PATH"; cd /tmp\r` })));
    ws.on("message", (chunk) => {
      output += chunk.toString();
      const match = output.match(/HELM_PATH=(\/[^\r\n]+)/);
      if (match && /:\/tmp[$#%] /.test(output)) { clearTimeout(timer); ws.close(); resolve({ path: match[1], output }); }
    });
    ws.on("error", reject);
  });
  ok(String(skipperTermState.path).startsWith("/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:")
    && /:\/tmp[$#%] /.test(String(skipperTermState.output))
    && !/\\u@\\h:\\w|HELM_NATIVE_PATH|export PATH=|unset HELM|Starting terminal/.test(String(skipperTermState.output)),
  "#main terminal replays its cwd-aware startup prompt, changes the visible path after cd, preserves Homebrew PATH, and never prints bootstrap or foreign-shell escapes");
  const templates = await api("/api/agent-templates", {}, captain);
  const catalog = await api("/api/skills", {}, captain);
  ok(templates.body.templates?.length >= 5 && templates.body.templates.some((template) => template.slug === "home"), "bare-bones growing-agent templates ship in the product");
  const arsenal = (catalog.body.skills || []).filter((skill) => !skill.arsenal_locked);
  ok(arsenal.length >= 30 && arsenal.some((skill) => skill.slug === "outcome-ownership")
    && arsenal.some((skill) => skill.slug === "email-operations")
    && arsenal.some((skill) => skill.slug === "message-operations")
    && arsenal.some((skill) => skill.slug === "software-delivery")
    && arsenal.every((skill) => String(skill.instructions || "").length >= 300)
    && main.agent.skills.length === arsenal.length,
  "Skipper starts with a substantial complete operational arsenal rather than generic prompt snippets");
  const learned = await api("/api/skills/learn", { body: { notes: "Turn our incident notes into a reusable postmortem skill." } }, captain);
  ok(learned.status === 202 && learned.body.channelId === main.id && /@skipper[\s\S]*create_skill/i.test(learned.body.message.body), "Learn a new skill opens a visible Skipper thread that gathers sources and authors through create_skill");
  await waitFor(async () => (await api("/api/skills", {}, captain)).body.skills?.some((skill) => skill.slug === "incident-postmortem"), "learned skill creation");
  ok(true, "Skipper completes the learning thread by adding the reusable skill to the shared arsenal");
  const learnedFromWeb = await api("/api/skills/learn", { body: { url: "https://example.com/openterminal/" } }, captain);
  await waitFor(async () => (await api("/api/skills", {}, captain)).body.skills?.some((skill) => skill.slug === "open-terminal-safe-deployment"), "web-source skill creation");
  const learnedFromWebDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const learnedThread = learnedFromWebDb.prepare("SELECT id FROM threads WHERE root_message_id=?").get(learnedFromWeb.body.rootMessageId);
  const learnedActions = learnedFromWebDb.prepare("SELECT tool,status,input_summary,result_summary FROM tool_actions WHERE thread_id=? ORDER BY id").all(learnedThread.id);
  const learnedSkill = learnedFromWebDb.prepare("SELECT instructions FROM skills WHERE slug='open-terminal-safe-deployment'").get();
  learnedFromWebDb.close();
  ok(learnedFromWeb.status === 202
    && learnedActions.some((action) => action.tool === "inspect_web_source" && action.status === "complete" && /example\.com\/openterminal/.test(action.input_summary))
    && learnedActions.some((action) => action.tool === "create_skill" && action.status === "complete")
    && learnedActions.findIndex((action) => action.tool === "inspect_web_source") < learnedActions.findIndex((action) => action.tool === "create_skill")
    && /Docker socket[\s\S]*host-root|host-root[\s\S]*Docker socket/i.test(learnedSkill.instructions),
  "Learn a new skill inspects a supplied HTTPS source before creating a source-grounded shared skill");
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

  const ideasCreate = await api("/api/channels", { body: { name: "ideas", purpose: "Capture and develop ideas." } }, captain);
  const skipperLifecycleEvents = [];
  const skipperLifecycleSocket = new WebSocket(`ws://127.0.0.1:${appPort}/ws?token=${captain}`);
  skipperLifecycleSocket.on("message", (data) => skipperLifecycleEvents.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { skipperLifecycleSocket.on("open", resolve); skipperLifecycleSocket.on("error", reject); });
  await waitFor(() => skipperLifecycleEvents.find((event) => event.type === "hello"), "Skipper lifecycle socket hello");
  skipperLifecycleEvents.length = 0;
  const inventoryRequest = await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper what channels exist" } }, captain);
  await waitForAgentReply(inventoryRequest.body.message.id, captain, "skipper");
  const inventoryDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const inventoryThread = inventoryDb.prepare("SELECT id FROM threads WHERE root_message_id=?").get(inventoryRequest.body.message.id);
  const inventoryActions = inventoryDb.prepare("SELECT tool,status FROM tool_actions WHERE thread_id=? ORDER BY id").all(inventoryThread.id);
  inventoryDb.close();
  ok(inventoryActions.some((action) => action.tool === "list_channels" && action.status === "complete") && !inventoryActions.some((action) => action.tool === "run_command"), "plain-language channel inventory uses the authoritative Skipper control plane without a filesystem detour");
  const availabilityRequest = await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper do we have a calendar skill?" } }, captain);
  await waitForAgentReply(availabilityRequest.body.message.id, captain, "skipper");
  const availabilityDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const availabilityThread = availabilityDb.prepare("SELECT id FROM threads WHERE root_message_id=?").get(availabilityRequest.body.message.id);
  const availabilityActions = availabilityDb.prepare("SELECT tool FROM tool_actions WHERE thread_id=? ORDER BY id").all(availabilityThread.id);
  availabilityDb.close();
  ok(!availabilityActions.some((action) => ["install_skill", "run_command", "ask_user"].includes(action.tool)), "a read-only capability question cannot install a skill or package and cannot open an interview");
  const gmailRequest = await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper can we set up gmail" } }, captain);
  await waitForAgentReply(gmailRequest.body.message.id, captain, "skipper");
  const gmailDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const gmailThread = gmailDb.prepare("SELECT id FROM threads WHERE root_message_id=?").get(gmailRequest.body.message.id);
  const gmailActions = gmailDb.prepare("SELECT tool,input_summary,result_summary FROM tool_actions WHERE thread_id=? ORDER BY id").all(gmailThread.id);
  const gmailQuestionCount = gmailDb.prepare("SELECT COUNT(*) n FROM agent_questions aq JOIN messages m ON m.id=aq.message_id WHERE m.parent_id=?").get(gmailRequest.body.message.id).n;
  gmailDb.close();
  ok(gmailActions.some((action) => action.tool === "connect_gmail") && !gmailActions.some((action) => action.tool === "ask_user") && gmailQuestionCount === 0 && !JSON.stringify(gmailActions).match(/(?:refresh_token|access_token|client_secret)/i), "plain-language Gmail setup invokes the native host-owned connector once without duplicate interviews or token exposure");

  const eventRequest = await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper give me an update and explanation of the Sunset Boulevard sinkhole in West Hollywood from two days ago" } }, captain);
  const eventReply = await waitForAgentReply(eventRequest.body.message.id, captain, "skipper");
  const eventDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const eventThread = eventDb.prepare("SELECT id FROM threads WHERE root_message_id=?").get(eventRequest.body.message.id);
  const eventActions = eventDb.prepare("SELECT tool,status FROM tool_actions WHERE thread_id=? ORDER BY id").all(eventThread.id);
  const eventAgentReplies = eventDb.prepare("SELECT body FROM messages WHERE parent_id=? AND bot_id IS NOT NULL").all(eventRequest.body.message.id);
  eventDb.close();
  ok(eventActions.some((action) => action.tool === "search_web" && action.status === "complete")
    && eventActions.some((action) => action.tool === "inspect_web_source" && action.status === "complete")
    && !eventActions.some((action) => action.tool === "ask_user")
    && eventAgentReplies.length === 1
    && /July 23, 2026[\s\S]*https:\/\/example\.com\/news\/sunset-sinkhole/i.test(eventReply.body),
  "a recent-event question immediately researches dated sources and produces one coherent answer without interviewing the user");

  const imageRequest = await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper show me an actual image of that Sunset Boulevard sinkhole incident", parentId: eventRequest.body.message.id } }, captain);
  await waitFor(async () => {
    const thread = await api(`/api/messages/${eventRequest.body.message.id}/thread`, {}, captain);
    return thread.body.replies?.find((message) => message.id !== eventReply.id && message.author?.name === "skipper" && /Answer complete/.test(message.body || "") && message.attachments?.length);
  }, "sourced event image attachment", 15_000);
  const imageDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const allImageActions = imageDb.prepare("SELECT tool,status FROM tool_actions WHERE thread_id=? ORDER BY id").all(eventThread.id);
  imageDb.close();
  ok(imageRequest.status === 200
    && allImageActions.some((action) => action.tool === "attach_web_image" && action.status === "complete")
    && !allImageActions.some((action) => action.tool === "generate_image"),
  "a real-event image request attaches a sourced web image and never substitutes generated art");

  const rapidRoots = await Promise.all([1, 2, 3].map((index) => api(`/api/channels/${main.id}/messages`, { body: { body: `@skipper slow-turn run whoami for independent thread ${index}` } }, captain)));
  const rapidIds = rapidRoots.map((result) => result.body.message.id);
  await waitFor(() => {
    const rapidDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
    const running = rapidDb.prepare(`SELECT COUNT(*) n FROM agent_turns WHERE bot_id=? AND trigger_id IN (?,?,?) AND state='running'`).get(main.agent.bot_id, ...rapidIds).n;
    rapidDb.close();
    return running === 3;
  }, "three concurrent Skipper threads", 2_000);
  ok(true, "three rapid messages in independent Skipper threads start concurrently instead of leaving the third thread dead");
  await Promise.all(rapidIds.map((rootId) => waitForAgentReply(rootId, captain, "skipper")));

  const queueRoot = (await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper slow-turn run whoami for ordered session one" } }, captain)).body.message.id;
  await waitFor(async () => (await api(`/api/messages/${queueRoot}/thread`, {}, captain)).body.replies?.some((reply) => reply.progress?.some((item) => item.status === "running")), "ordered Skipper turn start");
  await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper run whoami for ordered session two", parentId: queueRoot } }, captain);
  await waitFor(async () => {
    const replies = (await api(`/api/messages/${queueRoot}/thread`, {}, captain)).body.replies || [];
    return replies.find((reply) => reply.progress?.some((item) => /Queued · 1 ahead/.test(item.body || "")));
  }, "visible same-thread queue");
  ok(true, "a same-thread follow-up is durably admitted and immediately shows Queued · 1 ahead");
  await waitFor(async () => {
    const replies = (await api(`/api/messages/${queueRoot}/thread`, {}, captain)).body.replies || [];
    return replies.filter((reply) => reply.author?.name === "skipper" && /Answer complete/.test(reply.body || "")).length >= 2;
  }, "same-thread queue drain", 15_000);

  const deleteRequest = await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper sunset and delete #ideas" } }, captain);
  await waitForAgentReply(deleteRequest.body.message.id, captain, "skipper");
  const deleteDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const deleteThread = deleteDb.prepare("SELECT id FROM threads WHERE root_message_id=?").get(deleteRequest.body.message.id);
  const deleteActions = deleteDb.prepare("SELECT tool,status FROM tool_actions WHERE thread_id=? ORDER BY id").all(deleteThread.id);
  const ideasState = deleteDb.prepare("SELECT status FROM channels WHERE id=?").get(ideasCreate.body.channel.id);
  deleteDb.close();
  const archivedIdeasEvent = await waitFor(() => skipperLifecycleEvents.find((event) => event.type === "channel_update" && event.channel?.id === ideasCreate.body.channel.id && event.channel?.status === "archived"), "Skipper archived channel live event");
  const deletedIdeasEvent = await waitFor(() => skipperLifecycleEvents.find((event) => event.type === "channel_deleted" && event.channelId === ideasCreate.body.channel.id), "Skipper deleted channel live event");
  skipperLifecycleSocket.close();
  ok(deleteActions.some((action) => action.tool === "archive_channel" && action.status === "complete") && deleteActions.some((action) => action.tool === "delete_channel" && action.status === "complete") && !deleteActions.some((action) => action.tool === "run_command") && !ideasState && archivedIdeasEvent && deletedIdeasEvent, "plain-language sunset and deletion uses native lifecycle tools, updates the sidebar immediately, and removes only the named archived channel world");

  const launchCreate = await api("/api/channels", { body: { name: "Launch", purpose: "Plan and coordinate the product launch.", template: "project" } }, captain);
  const launch = launchCreate.body.channel;
  ok(launchCreate.status === 201 && launch.agent?.kind === "channel", "creating a channel atomically provisions its resident agent");
  ok(launch.agent?.name === "launch-agent" && launch.agent.status === "ready", "resident identity is ready and derived from channel purpose");
  ok(/^color:#[0-9A-F]{6}$/.test(launch.agent.runtime.avatar), "new resident agents receive a customizable random flat-color avatar");
  ok(launch.slug === "launch" && launch.agent.skills.length === arsenal.length
    && launch.agent.skills.some((skill) => skill.slug === "outcome-ownership")
    && launch.agent.skills.some((skill) => skill.slug === "project-planning"),
  "every resident permanently owns the safe built-in arsenal while preserving a normal channel identity");
  const deepRoute = await fetch(`${base}/c/${launch.slug}/memory`);
  ok(deepRoute.status === 200 && /id="app"/.test(await deepRoute.text()), "slug-based channel deep links serve the application shell");
  const deepRouteHead = await fetch(`${base}/c/${launch.slug}/thread/123`, { method: "HEAD" });
  ok(deepRouteHead.status === 200 && /text\/html/.test(deepRouteHead.headers.get("content-type") || "") && (await deepRouteHead.text()) === "", "slug-based channel deep links also support bodyless HEAD probes");

  const policyRootResult = await api(`/api/channels/${launch.id}/messages`, { body: {
    body: `@${launch.agent.name} use the selected thread model`,
    modelPolicy: { provider_id: alternateProviderId, model: alternateSmallModel },
  } }, captain);
  const policyRoot = policyRootResult.body.message.id;
  ok(policyRootResult.body.message.reply_count === 0, "sending a message does not report a phantom reply while the agent is only Working");
  const policyReply = await waitForAgentReply(policyRoot, captain, launch.agent.name);
  const threadPolicy = await api(`/api/messages/${policyRoot}/model-policy`, {}, captain);
  const countedThread = await api(`/api/messages/${policyRoot}/thread`, {}, captain);
  ok(/mock-small/.test(policyReply.body) && threadPolicy.body.policy.provider_id === alternateProviderId && threadPolicy.body.policy.model === alternateSmallModel && threadPolicy.body.policy.overridden,
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
  const threadGuest = (await api("/api/users", {}, captain)).body.users.find((user) => user.username === "thread-guest");
  const threadGuestInvite = await api(`/api/channels/${launch.id}/messages`, { body: { body: "@thread-guest join this agent channel" } }, captain);
  await api(`/api/channels/${launch.id}/members/${threadGuest.id}`, { body: { messageId: threadGuestInvite.body.message.id } }, captain);
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

  const interviewRoot = (await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${launch.agent.name} ask me a structured interview with multiple choice` } }, captain)).body.message.id;
  const interviewReply = await waitFor(async () => {
    const replies = (await api(`/api/messages/${interviewRoot}/thread`, {}, captain)).body.replies || [];
    return replies.find((reply) => reply.author?.name === launch.agent.name && reply.questions?.status === "pending");
  }, "structured interview");
  ok(interviewReply.questions.questions[0].options.length === 2, "agent questions persist as structured message metadata with pre-filled choices");
  const interviewAnswer = await api(`/api/messages/${interviewReply.id}/questions/answer`, { body: { answers: [{ question_id: "q1", values: ["Thorough"], custom: "" }] } }, captain);
  ok(interviewAnswer.status === 200 && /Thorough/.test(interviewAnswer.body.message.body), "structured interview buttons submit a visible conversational follow-up");

  const stopRoot = (await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${launch.agent.name} slow-turn run command` } }, captain)).body.message.id;
  await waitFor(async () => (await api(`/api/messages/${stopRoot}/thread`, {}, captain)).body.replies?.some((reply) => reply.progress?.some((item) => item.status === "running")), "stoppable turn start");
  const stopped = await api(`/api/messages/${stopRoot}/stop`, { body: {} }, captain);
  await sleep(100);
  const stopDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const stoppedThread = stopDb.prepare("SELECT stopped_followup_pending FROM threads WHERE root_message_id=?").get(stopRoot);
  ok(stopped.status === 200 && stoppedThread.stopped_followup_pending === 1, "Stop immediately aborts only the active thread turn and arms hidden continuation context");
  await api(`/api/channels/${launch.id}/messages`, { body: { body: "continue carefully", parentId: stopRoot } }, captain);
  const hiddenFollowup = stopDb.prepare("SELECT stopped_followup,body FROM messages WHERE parent_id=? AND user_id IS NOT NULL ORDER BY id DESC LIMIT 1").get(stopRoot);
  stopDb.close();
  ok(hiddenFollowup.stopped_followup === 1 && hiddenFollowup.body === "continue carefully", "the next follow-up consumes hidden stop context without altering visible text");

  const isolatedStopRoots = await Promise.all(["keep", "stop"].map((label) => api(`/api/channels/${launch.id}/messages`, { body: { body: `@${launch.agent.name} slow-turn answer without a command ${label} lane` } }, captain)));
  const keepRoot = isolatedStopRoots[0].body.message.id;
  const isolatedStopRoot = isolatedStopRoots[1].body.message.id;
  await waitFor(() => {
    const isolatedDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
    const count = isolatedDb.prepare("SELECT COUNT(*) n FROM agent_turns WHERE trigger_id IN (?,?) AND state='running'").get(keepRoot, isolatedStopRoot).n;
    isolatedDb.close();
    return count === 2;
  }, "two independent resident lanes");
  await api(`/api/messages/${isolatedStopRoot}/stop`, { body: {} }, captain);
  await waitForAgentReply(keepRoot, captain, launch.agent.name);
  const isolatedStopDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const laneStates = isolatedStopDb.prepare("SELECT trigger_id,state FROM agent_turns WHERE trigger_id IN (?,?)").all(keepRoot, isolatedStopRoot);
  isolatedStopDb.close();
  ok(laneStates.find((turn) => turn.trigger_id === keepRoot)?.state === "completed"
    && laneStates.find((turn) => turn.trigger_id === isolatedStopRoot)?.state === "stopped",
  "Stop affects only the selected thread lane while another turn on the same agent completes");

  const retry = await api("/api/channels", { body: { name: "Launch", purpose: "Plan and coordinate the product launch." } }, captain);
  ok(retry.status === 200 && retry.body.channel.id === launch.id && retry.body.created === false, "safe retry returns the same world without duplicates");

  const finance = (await api("/api/channels", { body: { name: "Finance", purpose: "Own finance planning and records." } }, captain)).body.channel;
  ok(finance.agent.id !== launch.agent.id && finance.agent.bot_id !== launch.agent.bot_id, "each channel receives a distinct resident agent");
  ok(finance.agent.runtime.avatar !== launch.agent.runtime.avatar, "new resident agents start with distinct random avatar colors while unused palette colors remain");
  const rejectedMainGuestRoot = (await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper invite @finance-agent into #main for unrelated research" } }, captain)).body.message.id;
  await waitForAgentReply(rejectedMainGuestRoot, captain, "skipper");
  await sleep(300);
  const rejectedMainGuestDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const rejectedMainThread = rejectedMainGuestDb.prepare("SELECT id FROM threads WHERE root_message_id=?").get(rejectedMainGuestRoot);
  const rejectedMainBinding = rejectedMainGuestDb.prepare("SELECT 1 FROM thread_agent_guests WHERE thread_id=? AND status='active'").get(rejectedMainThread.id);
  const rejectedMainResidentTurns = rejectedMainGuestDb.prepare("SELECT COUNT(*) n FROM agent_turns WHERE thread_root_id=? AND bot_id=?").get(rejectedMainGuestRoot, finance.agent.bot_id).n;
  const rejectedMainDispatchActions = rejectedMainGuestDb.prepare("SELECT COUNT(*) n FROM tool_actions WHERE thread_id=? AND tool IN ('invite_agent','call_agent')").get(rejectedMainThread.id).n;
  rejectedMainGuestDb.close();
  ok(!rejectedMainBinding && rejectedMainResidentTurns === 0 && rejectedMainDispatchActions === 0, "#main cannot expose or dispatch resident invitations even when the Captain explicitly asks Skipper to invite one");
  const rejectedMainCallRoot = (await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper attempt forbidden direct call_agent in #main" } }, captain)).body.message.id;
  await waitForAgentReply(rejectedMainCallRoot, captain, "skipper");
  await sleep(200);
  const rejectedMainCallDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const rejectedMainCallAction = rejectedMainCallDb.prepare("SELECT status,result_summary FROM tool_actions WHERE thread_id=(SELECT id FROM threads WHERE root_message_id=?) AND tool='call_agent'").get(rejectedMainCallRoot);
  const rejectedMainCallBinding = rejectedMainCallDb.prepare("SELECT 1 FROM thread_agent_guests WHERE thread_id=(SELECT id FROM threads WHERE root_message_id=?) AND status='active'").get(rejectedMainCallRoot);
  const rejectedMainCallTurn = rejectedMainCallDb.prepare("SELECT COUNT(*) n FROM agent_turns WHERE thread_root_id=? AND bot_id=?").get(rejectedMainCallRoot, finance.agent.bot_id).n;
  rejectedMainCallDb.close();
  ok(rejectedMainCallAction?.status === "failed" && /cannot be called|cannot.*#main/i.test(rejectedMainCallAction.result_summary) && !rejectedMainCallBinding && rejectedMainCallTurn === 0, "a provider-forced cross-channel call_agent invocation is rejected at the #main execution boundary");
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

  const duplicateGuestRoot = (await api(`/api/channels/${launch.id}/messages`, { body: { body: "@skipper invite @finance-agent twice into this thread for one review" } }, captain)).body.message.id;
  await waitForAgentReply(duplicateGuestRoot, captain, "finance-agent");
  await waitForAgentReply(duplicateGuestRoot, captain, "skipper");
  const duplicateGuestDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const financeGuestTurns = duplicateGuestDb.prepare("SELECT COUNT(*) n FROM agent_turns WHERE bot_id=? AND thread_root_id=?").get(finance.agent.bot_id, duplicateGuestRoot).n;
  const duplicateInviteActions = duplicateGuestDb.prepare("SELECT status FROM tool_actions WHERE thread_id=(SELECT id FROM threads WHERE root_message_id=?) AND tool='invite_agent'").all(duplicateGuestRoot);
  duplicateGuestDb.close();
  ok(financeGuestTurns === 1 && duplicateInviteActions.length === 2 && duplicateInviteActions.some((action) => action.status === "failed"), "re-inviting an already active thread guest is rejected without dispatching another resident turn");

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
  // macOS may report the rejected intermediate symlink as already absent after
  // the security probe; cleanup must not turn a passing assertion into ENOENT.
  rmSync(escapedLink, { force: true });

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
  const hostComputerId = (await api("/api/computers", {}, captain)).body.computers.find((computer) => computer.name === "This Computer")?.id;
  const rejectedHostTerm = await api("/api/term/open", { body: { channelId: launch.id, computerId: hostComputerId, cols: 90, rows: 28 } }, captain);
  ok(rejectedHostTerm.status === 403, "ordinary channel terminal rejects an explicit native host computer");
  const expectedWorkspace = join(dataDir, "channels", String(launch.id), "workspace");
  // Native compatibility terminals run directly in the channel's host mirror.
  // On a real Apple container machine, that same private channel workspace is
  // intentionally mounted at the stable guest-only path `/workspace`.
  const expectedTerminalWorkspace = process.platform === "darwin" ? "/workspace" : expectedWorkspace;
  const terminalOutput = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${appPort}/ws/term/${termOpen.body.sessionId}?token=${captain}`);
    let output = "";
    const timer = setTimeout(() => { ws.close(); reject(new Error("terminal output timeout: " + output)); }, 8000);
    ws.on("open", () => ws.send(JSON.stringify({ type: "input", data: "pwd; printf 'terminal note\\n' > terminal-note.txt; echo TERM_DONE\r" })));
    ws.on("message", (chunk) => {
      output += chunk.toString();
      if (output.includes("TERM_DONE") && output.includes(expectedTerminalWorkspace)) { clearTimeout(timer); ws.close(); resolve(output); }
    });
    ws.on("error", reject);
  });
  ok(String(terminalOutput).includes(expectedTerminalWorkspace), "terminal starts in the selected channel's exact workspace");
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

  // Collaboration access is request/approval based. A new coworker starts in
  // the human-only Collab holding space and cannot see an agent channel until
  // the Captain tags and confirms them in that exact channel.
  const collaborationDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  collaborationDb.prepare("UPDATE workspace SET collaboration_enabled=1,collaboration_slug='native-test',collaboration_hostname='native-test.1helm.com',collaboration_status='active'").run();
  collaborationDb.prepare("INSERT INTO workspace_domains (hostname,provider,status,tunnel_id,verified,created,updated) VALUES (?,'cloudflare','active','custom-tunnel',?,?,?)")
    .run("helm.example.com", Date.now(), Date.now(), Date.now());
  collaborationDb.close();
  const customPrimary = await api("/api/collaboration", {}, captain);
  ok(customPrimary.body.collaboration.hostname === "native-test.1helm.com"
    && customPrimary.body.collaboration.custom_domain === "helm.example.com"
    && customPrimary.body.collaboration.primary_url === "https://helm.example.com",
  "an active custom domain becomes primary while the reserved 1helm.com hostname remains assigned");
  await api("/api/collaboration/requests-enabled", { body: { enabled: false } }, captain);
  const closedRequest = await api("/api/access-requests", { body: { email: "requester@example.com", display: "Requester" } });
  ok(closedRequest.status === 400 && closedRequest.body.error === "Native Test Renamed isn’t accepting requests right now", "the Captain's request toggle returns the workspace-specific closed-request message");
  await api("/api/collaboration/requests-enabled", { body: { enabled: true } }, captain);
  const accessRequest = await api("/api/access-requests", { body: { email: "requester@example.com", display: "Requester" } });
  const mainMessages = await api(`/api/channels/${main.id}/messages`, {}, captain);
  const requestNotice = mainMessages.body.messages.find((message) => message.author?.kind === "system" && /requester@example\.com has requested access/.test(message.body));
  const requested = (await api("/api/access-requests", {}, captain)).body.requests.find((request) => request.email === "requester@example.com");
  ok(accessRequest.status === 201 && requested?.status === "pending" && requestNotice?.author.name === "1Helm", "an access request creates an LLM-agnostic 1Helm notice in #main and appears in Settings → Members");
  await api(`/api/access-requests/${requested.id}`, { method: "PATCH", body: { approved: true } }, captain);
  const accessClaim = await api(`/api/access-requests/${accessRequest.body.claim_token}`, { body: { username: "requester", password: "request-pass", display: "Requester" } });
  const requester = accessClaim.body.token;
  const requesterChannelsBefore = (await api("/api/channels", {}, requester)).body.channels;
  const collab = requesterChannelsBefore.find((channel) => channel.kind === "collab" && channel.name === "Collab");
  const requesterMain = requesterChannelsBefore.find((channel) => channel.kind === "channel" && channel.name === "main" && channel.personal_main);
  const hiddenBots = await api("/api/bots", {}, requester);
  const hiddenProviders = await api("/api/providers", {}, requester);
  const hiddenComputers = await api("/api/computers", {}, requester);
  const hiddenRouting = await api("/api/routing/state", {}, requester);
  const hiddenSkills = await api("/api/skills", {}, requester);
  const hiddenCollaboration = await api("/api/collaboration", {}, requester);
  const holdingDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const collabRuntime = holdingDb.prepare(`SELECT
    (SELECT COUNT(*) FROM agent_channels WHERE channel_id=c.id) agents,
    (SELECT COUNT(*) FROM channel_computers WHERE channel_id=c.id) computers,
    (SELECT COUNT(*) FROM bot_channels WHERE channel_id=c.id) bots
    FROM channels c WHERE c.kind='collab'`).get();
  holdingDb.close();
  const captainDeniedRequesterMain = await api(`/api/channels/${requesterMain.id}/messages`, {}, captain);
  ok(accessClaim.status === 200 && requesterChannelsBefore.length === 2 && collab && requesterMain?.agent?.kind === "skipper" && requesterMain.computer === null
    && collabRuntime.agents === 0 && collabRuntime.computers === 0 && collabRuntime.bots === 0
    && hiddenBots.body.bots.some((bot) => bot.name === "skipper") && hiddenProviders.status === 403 && hiddenComputers.body.computers.length === 0
    && hiddenRouting.status === 200 && hiddenRouting.body.scope === "member" && !JSON.stringify(hiddenRouting.body).includes("api_key")
    && hiddenSkills.status === 403 && hiddenCollaboration.status === 403,
  "an approved coworker lands in human-only Collab plus a private Skipper #main and a credential-safe personal provider surface without Captain control-plane access");
  ok(captainDeniedRequesterMain.status === 403, "the Captain cannot read a coworker's private personal #main");
  const requesterChannelRequest = await api(`/api/channels/${requesterMain.id}/messages`, { body: { body: '@skipper create a new channel called "requester-notes"' } }, requester);
  await waitForAgentReply(requesterChannelRequest.body.message.id, requester, "skipper");
  const requesterNotes = (await api("/api/channels", {}, requester)).body.channels.find((channel) => channel.name === "requester-notes");
  const captainDeniedRequesterNotes = await api(`/api/channels/${requesterNotes.id}/messages`, {}, captain);
  const privateChannelDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const requesterNotesMembers = privateChannelDb.prepare("SELECT user_id FROM members WHERE channel_id=? ORDER BY user_id").all(requesterNotes.id);
  privateChannelDb.close();
  ok(requesterNotes?.agent?.kind === "channel" && requesterNotesMembers.length === 1
    && Number(requesterNotesMembers[0].user_id) === Number(accessClaim.body.user.id) && captainDeniedRequesterNotes.status === 403,
  "a coworker's Skipper creates a private agent channel for that coworker without Captain approval or automatic Captain access");
  const scopedFleetRequest = await api(`/api/channels/${requesterMain.id}/messages`, { body: { body: "@skipper reconcile my channel computers" } }, requester);
  await waitForAgentReply(scopedFleetRequest.body.message.id, requester, "skipper");
  const scopedFleetActivity = (await api(`/api/channels/${requesterMain.id}/activity`, {}, requester)).body.actions;
  const scopedFleetAction = scopedFleetActivity.find((action) => action.tool === "care_for_channel_computer" && action.status === "complete");
  ok(/"checked":1/.test(scopedFleetAction?.result_summary || ""), "a coworker's private Skipper reconciles only that coworker's one channel computer, never the Captain fleet");
  const autonomousInstall = await api(`/api/channels/${requesterNotes.id}/messages`, { body: { body: `@${requesterNotes.agent.name} download openai codex for your machine` } }, requester);
  await waitForAgentReply(autonomousInstall.body.message.id, requester, requesterNotes.agent.name);
  const installActivity = (await api(`/api/channels/${requesterNotes.id}/activity`, {}, requester)).body.actions;
  ok(installActivity.some((action) => action.tool === "run_command" && action.status === "complete")
    && !installActivity.some((action) => action.tool === "ask_user")
    && existsSync(join(dataDir, "channels", String(requesterNotes.id), "workspace", "codex-install.txt")),
  "a resident treats install/download work as autonomous action on its own machine instead of asking the user for permission");
  const captainUser = (await api("/api/users", {}, requester)).body.users.find((candidate) => candidate.username === "captain");
  const captainInvitation = await api(`/api/channels/${requesterNotes.id}/messages`, { body: { body: "@captain join my private notes channel" } }, requester);
  const addCaptain = await api(`/api/channels/${requesterNotes.id}/members/${captainUser.id}`, { body: { messageId: captainInvitation.body.message.id } }, requester);
  const captainAfterInvitation = await api(`/api/channels/${requesterNotes.id}/messages`, {}, captain);
  ok(addCaptain.status === 200 && captainAfterInvitation.status === 200,
    "a coworker can explicitly tag and confirm the Captain into a coworker-owned private channel");
  const collabUploadResponse = await fetch(`${base}/api/upload`, { method: "POST", headers: { authorization: `Bearer ${requester}`, "content-type": "text/plain", "x-filename": "coworker-note.txt" }, body: "human-only attachment" });
  const collabUpload = await collabUploadResponse.json();
  const collabMessage = await api(`/api/channels/${collab.id}/messages`, { body: { body: "Shared with the human team", uploads: [collabUpload] } }, requester);
  const collabMessages = await api(`/api/channels/${collab.id}/messages`, {}, captain);
  const sharedAttachment = collabMessages.body.messages.find((message) => message.id === collabMessage.body.message.id)?.attachments?.[0];
  const sharedAttachmentResponse = await fetch(`${base}/api/files/${sharedAttachment.id}`, { headers: { authorization: `Bearer ${captain}` } });
  ok(await sharedAttachmentResponse.text() === "human-only attachment" && !existsSync(join(dataDir, "channels", String(collab.id))), "Collab supports human messages and attachments without creating an agent workspace tree");
  const deniedMessages = await api(`/api/channels/${launch.id}/messages`, {}, requester);
  const deniedFiles = await api(`/api/channels/${launch.id}/files`, {}, requester);
  const deniedTerminal = await api("/api/term/open", { body: { channelId: launch.id } }, requester);
  const deniedAdd = await api(`/api/channels/${launch.id}/members/${accessClaim.body.user.id}`, { body: {} }, captain);
  ok(deniedMessages.status === 403 && deniedFiles.status === 403 && deniedTerminal.status === 403 && deniedAdd.status === 409, "agent-channel messages, files, terminals, and direct membership are server-locked until the Captain's confirmed tag");
  const requesterEvents = [];
  const requesterSocket = new WebSocket(`ws://127.0.0.1:${appPort}/ws?token=${requester}`);
  requesterSocket.on("message", (data) => requesterEvents.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { requesterSocket.on("open", resolve); requesterSocket.on("error", reject); });
  await waitFor(() => requesterEvents.find((event) => event.type === "hello"), "requester socket hello");
  requesterEvents.length = 0;
  const captainInviteEvents = [];
  const captainInviteSocket = new WebSocket(`ws://127.0.0.1:${appPort}/ws?token=${captain}`);
  captainInviteSocket.on("message", (data) => captainInviteEvents.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { captainInviteSocket.on("open", resolve); captainInviteSocket.on("error", reject); });
  const privateBeforeInvite = await api(`/api/channels/${launch.id}/messages`, { body: { body: "private-before-confirmed-membership" } }, captain);
  await sleep(200);
  ok(!requesterEvents.some((event) => event.message?.id === privateBeforeInvite.body.message.id), "unauthorized coworkers receive no agent-channel WebSocket fan-out");
  const requesterInvite = await api(`/api/channels/${launch.id}/messages`, { body: { body: "@requester join this agent channel" } }, captain);
  const addConfirmation = await waitFor(() => captainInviteEvents.find((event) => event.type === "member_add_confirmation" && event.messageId === requesterInvite.body.message.id), "human membership confirmation");
  const addRequester = await api(`/api/channels/${launch.id}/members/${accessClaim.body.user.id}`, { body: { messageId: requesterInvite.body.message.id } }, captain);
  await waitFor(() => requesterEvents.find((event) => event.type === "channel_new" && event.channel?.id === launch.id), "new member channel event");
  const requesterChannelsAfter = (await api("/api/channels", {}, requester)).body.channels;
  const requesterAgentMessages = await api(`/api/channels/${launch.id}/messages`, {}, requester);
  ok(addConfirmation.username === "requester" && addRequester.status === 200 && requesterChannelsAfter.some((channel) => channel.id === launch.id)
    && requesterAgentMessages.body.bots.length > 0 && requesterAgentMessages.body.bots.every((bot) => !("prompt" in bot)),
  "tagging a coworker prompts Add @user and confirmation grants that one agent channel without exposing agent instructions");
  requesterSocket.close(); captainInviteSocket.close();

  const collaboratorCreate = await api("/api/admin/users", { body: { username: "collaborator", password: "secret-pass", display: "Collaborator" } }, captain);
  const collaboratorLogin = await api("/api/auth/login", { body: { username: "collaborator", password: "secret-pass" } });
  const collaborator = collaboratorLogin.body.token;
  ok(collaboratorCreate.status === 201 && collaborator, "Captain can add a workspace member who can sign in");
  const collaboratorInvite = await api(`/api/channels/${launch.id}/messages`, { body: { body: "@collaborator join this agent channel" } }, captain);
  await api(`/api/channels/${launch.id}/members/${collaboratorCreate.body.user.id}`, { body: { messageId: collaboratorInvite.body.message.id } }, captain);
  const removalStatus = await api("/api/app/removal", {}, captain);
  const forbiddenRemoval = await api("/api/app/removal", {}, collaborator);
  const unconfirmedRemoval = await api("/api/app/removal", { body: { confirmation: "wrong" } }, captain);
  const removalCountMatchesBackend = removalStatus.body.backend === "apple"
    ? removalStatus.body.machines > 0
    : removalStatus.body.backend === "native" && removalStatus.body.machines === 0;
  ok(removalStatus.status === 200 && removalCountMatchesBackend && forbiddenRemoval.status === 403 && unconfirmedRemoval.status === 400, "app-removal preparation is Captain-only, typed-confirmed, and reports the exact backend-owned VM count");
  const collaboratorLaunch = (await api("/api/channels", {}, collaborator)).body.channels.find((channel) => channel.id === launch.id);
  const collaboratorThread = await api(`/api/messages/${taskRoot}/thread`, {}, collaborator);
  const collaboratorFiles = await api(`/api/channels/${launch.id}/files`, {}, collaborator);
  ok(collaboratorLaunch.agent.id === launch.agent.id && collaboratorThread.body.replies.length > 0 && collaboratorFiles.body.files.some((file) => file.path === "workspace/launch-plan.md"), "a Captain-added coworker sees the same agent, transcript, session, and files");

  const modelChange = await api(`/api/channels/${launch.id}/agent-policy`, { method: "PATCH", body: { provider_id: providerId, model: primarySmallModel } }, captain);
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
  ok(afterRestart.agent.id === launch.agent.id && afterRestart.agent.model === primarySmallModel, "restart preserves agent identity, workspace, and changed model policy");
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
  const automaticReturn = await waitFor(async () => {
    const thread = await api(`/api/messages/${escalationRoot.body.message.id}/thread`, {}, captain);
    const replies = thread.body.replies || [];
    const residentReplies = replies.filter((message) => message.author?.name === afterRestart.agent.name && message.body !== "_Working…_");
    const handoff = replies.some((message) => message.author?.name === "skipper" && /Calling \*\*@.*-agent/i.test(String(message.body || "")));
    return residentReplies.length >= 2 && handoff ? { residentReplies: residentReplies.length, handoff } : null;
  }, "automatic Skipper-to-resident return", 20_000);
  ok(Boolean(automaticReturn), "runtime automatically returns a resident escalation after Skipper unblocks it even when the Skipper model omits call_agent");

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
  const followThread = await api(`/api/messages/${followRoot.body.message.id}/thread`, {}, captain);
  const visibleFollowupReply = followThread.body.replies?.some((message) => message.author?.name === afterRestart.agent.name && message.body && message.body !== "_Working…_");
  ok(Boolean(followEvidence) && !visibleFollowupReply, "resident schedule_followup creates a durable pending re-entry without a fake user-facing completion");

  await api(`/api/threads/${taskThread.id}`, { method: "PATCH", body: { status: "waiting" } }, captain);
  const archive = await api(`/api/channels/${launch.id}/archive`, { body: {} }, captain);
  const blocked = await api(`/api/channels/${launch.id}/messages`, { body: { body: `@${afterRestart.agent.name} should not run` } }, captain);
  ok(archive.body.channel.status === "archived" && archive.body.channel.agent.id === launch.agent.id && blocked.status === 409, "archive pauses work while preserving the same agent world");
  const archivedObligationDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const activeArchivedFollowups = archivedObligationDb.prepare("SELECT COUNT(*) n FROM channel_computer_obligations WHERE channel_id=? AND kind='followup' AND status='active'").get(launch.id).n;
  archivedObligationDb.close();
  ok(activeArchivedFollowups === 0, "archiving cancels native follow-up wake obligations instead of treating archive like idle sleep");

  const restore = await api(`/api/channels/${launch.id}/restore`, { body: {} }, captain);
  const restoredThread = (await api(`/api/channels/${launch.id}/threads`, {}, captain)).body.threads.find((thread) => thread.id === taskThread.id);
  ok(restore.body.channel.status === "active" && restore.body.channel.agent.id === launch.agent.id && restoredThread.status === "waiting" && existsSync(join(dataDir, "channels", String(launch.id), "workspace", "launch-plan.md")), "restore reuses the same world without rewriting independent thread status");

  // Crash recovery: start a slow turn, SIGKILL mid-flight, restart, and verify boot recovers.
  const crashRoot = (await api(`/api/channels/${finance.id}/messages`, { body: { body: `@${finance.agent.name} slow-turn run command` } }, captain)).body.message.id;
  await waitFor(() => {
    const crashDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
    const running = crashDb.prepare("SELECT 1 FROM agent_turns WHERE trigger_id=? AND state='running'").get(crashRoot);
    crashDb.close();
    return running;
  }, "crash-test turn running");
  const crashQueuedTrigger = (await api(`/api/channels/${finance.id}/messages`, { body: { body: `@${finance.agent.name} run command after restart`, parentId: crashRoot } }, captain)).body.message.id;
  await waitFor(() => {
    const crashDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
    const queued = crashDb.prepare("SELECT 1 FROM agent_turns WHERE trigger_id=? AND state='queued'").get(crashQueuedTrigger);
    crashDb.close();
    return queued;
  }, "durable queued turn before crash");
  const killedApp = app;
  killedApp.kill("SIGKILL");
  await Promise.race([new Promise((resolve) => killedApp.once("exit", resolve)), sleep(2000)]);
  await launchApp();
  await waitFor(() => {
    const resumedDb = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
    const completed = resumedDb.prepare("SELECT 1 FROM agent_turns WHERE trigger_id=? AND state='completed'").get(crashQueuedTrigger);
    resumedDb.close();
    return completed;
  }, "queued turn resume after crash");
  const db2 = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const stuckWorking = db2.prepare("SELECT count(*) n FROM agents WHERE status='working'").get().n;
  const emptyPlaceholders = db2.prepare("SELECT count(*) n FROM messages WHERE body='' AND bot_id IS NOT NULL AND parent_id IS NOT NULL").get().n;
  const blindlyReplayedRunning = db2.prepare("SELECT COUNT(*) n FROM agent_turns WHERE error='server restart interrupted a running turn' AND state<>'failed'").get().n;
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
  ok(blindlyReplayedRunning === 0, "boot never blindly replays a turn that may already have produced side effects");
  ok(true, "a never-started queued turn survives a process crash and drains after restart");
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
  if (process.platform === "darwin" && captain && app?.exitCode == null) {
    try {
      const removal = await api("/api/app/removal", { body: { confirmation: "REMOVE 1HELM" } }, captain);
      if (removal.body.remaining !== 0) throw new Error(`${removal.body.remaining} test channel VMs remained`);
    } catch (error) {
      fail++;
      console.error("\nNative world Apple VM cleanup failed:", error);
    }
  }
  await stopApp();
  if (mock && mock.exitCode == null) mock.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
