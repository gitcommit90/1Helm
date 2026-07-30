import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import puppeteer from "puppeteer";
import { availableGoogleAccounts } from "../src/server/gmail.ts";

const dataDir = process.env.CTRL_TEST_DATA_DIR;
if (!dataDir) throw new Error("CTRL_TEST_DATA_DIR must point to a disposable copy of production data.");

const root = process.cwd();
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const unique = `${Date.now().toString(36)}-${process.pid}`;
const channelName = `contract-${unique}`.slice(0, 48);
const marker = `TERM_PERSISTS_${unique.replaceAll("-", "_")}`;
const memoryMarker = `KNOWLEDGE_${unique.replaceAll("-", "_")}`;
const gmailQueryMarker = `ONEHELM_CONTRACT_${unique.replaceAll("-", "_")}`;
let app;
let browser;
let pass = 0;
let fail = 0;

const ok = (condition, label) => {
  if (!condition) throw new Error(label);
  pass++;
  console.log("  ok  -", label);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, label, timeout = 120_000) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch (error) { last = error.message; }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
};

const database = new DatabaseSync(`${dataDir}/ctrl-pane.db`);
const auth = database.prepare(`SELECT s.token FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.is_admin=1 ORDER BY s.created DESC LIMIT 1`).get()?.token;
database.close();
if (!auth) throw new Error("The disposable production copy has no active Captain session.");

const api = async (path, options = {}) => {
  const response = await fetch(base + path, {
    method: options.method || (options.body !== undefined ? "POST" : "GET"),
    headers: { authorization: `Bearer ${auth}`, ...(options.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${result.error || response.status}`);
  return result;
};

const replySamples = new Map();
const waitForReply = async (rootId, author) => waitFor(async () => {
  const thread = await api(`/api/messages/${rootId}/thread`);
  const reply = thread.replies?.find((item) => item.author?.name === author && item.body && item.body !== "_Working…_");
  if (!reply) return null;
  const previous = replySamples.get(reply.id);
  replySamples.set(reply.id, { body: reply.body, seen: previous?.body === reply.body ? (previous.seen || 1) + 1 : 1 });
  return replySamples.get(reply.id).seen >= 3 ? reply : null;
}, `@${author} final reply`);

try {
  app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
    cwd: root,
    // This test uses a disposable copy of production data but runs on the
    // development host, not an installed Linux service with the root-owned OCI
    // helper. Keep the production browser contract on the explicit native seam;
    // real OCI acceptance is exercised independently on a native host.
    env: { ...process.env, CTRL_DATA_DIR: dataDir, PORT: String(port), HELM_CHANNEL_COMPUTER_BACKEND: "native" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  app.stdout.on("data", (chunk) => { diagnostics += chunk; });
  app.stderr.on("data", (chunk) => { diagnostics += chunk; });
  await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "disposable production server", 20_000);

  const created = await api("/api/channels", { body: { name: channelName, purpose: "Production contract verification for real agent, browser, terminal, memory, and control-plane workflows." } });
  const channel = created.channel;
  ok(channel?.agent?.name, "disposable channel has one resident agent");

  const residentRoot = (await api(`/api/channels/${channel.id}/messages`, { body: { body: `@${channel.agent.name} Reply with exactly CONTRACT_RESIDENT_OK. Do not use any tool.` } })).message.id;
  const residentReply = await waitForReply(residentRoot, channel.agent.name);
  ok(/CONTRACT_RESIDENT_OK/.test(residentReply.body), "real configured provider completes a resident-agent turn");

  const googleAccounts = availableGoogleAccounts();
  if (googleAccounts.length) {
    const grantRoot = (await api(`/api/channels/${channel.id}/messages`, { body: { body: "@skipper Use grant_gmail_access now for this channel. Grant all connected accounts, do not inspect the shell, then include CONTRACT_GRANT_OK in your final answer." } })).message.id;
    const grantReply = await waitForReply(grantRoot, "skipper");
    const grantDb = new DatabaseSync(`${dataDir}/ctrl-pane.db`);
    const granted = grantDb.prepare(`SELECT ac.config FROM agent_capabilities ac JOIN agent_channels bind ON bind.agent_id=ac.agent_id WHERE bind.channel_id=? AND ac.capability='gmail'`).get(channel.id);
    grantDb.close();
    ok(Boolean(grantReply.body.trim()) && granted?.config, "real Skipper turn grants native scoped Gmail access without shell discovery");

    const searchRoot = (await api(`/api/channels/${channel.id}/messages`, { body: { body: `@${channel.agent.name} Use gmail_search on ${googleAccounts[0]} for query subject:${gmailQueryMarker} with max_results 1. Then include CONTRACT_GMAIL_OK and the result count.` } })).message.id;
    const searchReply = await waitForReply(searchRoot, channel.agent.name);
    const searchDb = new DatabaseSync(`${dataDir}/ctrl-pane.db`);
    const searchAction = searchDb.prepare(`SELECT ta.status FROM tool_actions ta JOIN threads t ON t.id=ta.thread_id WHERE t.root_message_id=? AND ta.tool='gmail_search' ORDER BY ta.id DESC LIMIT 1`).get(searchRoot);
    searchDb.close();
    ok(Boolean(searchReply.body.trim()) && searchAction?.status === "complete", "resident agent reaches Gmail through its scoped native capability");
  }

  const overflowRoot = (await api(`/api/channels/${channel.id}/messages`, { body: { body: `Overflow contract ${"UNBROKEN".repeat(180)}` } })).message.id;
  const knowledge = await api(`/api/channels/${channel.id}/memory`, { body: { kind: "decision", content: `# Contract knowledge\n\n**Durable** ${memoryMarker}`, scope: "channel" } });
  ok(knowledge.memory?.kind === "decision", "durable knowledge is recorded separately from chat");

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate((token) => localStorage.setItem("ctrl.token", token), auth);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("aside");
  const channelButton = await page.evaluateHandle((name) => [...document.querySelectorAll(".nav-item")].find((item) => item.textContent.includes(name)), channelName);
  if (!channelButton.asElement()) throw new Error("Disposable channel is absent from the browser sidebar.");
  await channelButton.asElement().click();
  await page.waitForFunction((name) => document.querySelector("#hdr")?.textContent.includes(name), {}, channelName);
  ok(new URL(page.url()).pathname === `/c/${channel.slug}/chat`, "opening a channel writes its stable slug into the browser URL");

  await page.click('button[title="Settings"]');
  await page.waitForSelector('.modal-overlay button[aria-label="Close settings"]');
  const settingsTabs = await page.$$eval(".modal-overlay button", (buttons) => buttons.map((button) => button.textContent.trim()));
  ok(["Admin", "Agents", "Skills", "Domains", "Members"].every((label) => settingsTabs.includes(label)), "workspace Settings exposes the simple Admin area plus skills, Cloudflare domains, and member management");
  await page.evaluate(() => [...document.querySelectorAll(".modal-overlay button")].find((button) => button.textContent.trim() === "Admin")?.click());
  await page.waitForSelector('.modal-overlay input[autocomplete="organization"]');
  ok(await page.$eval('.modal-overlay input[autocomplete="organization"]', (input) => Boolean(input.value)) && Boolean(await page.$('.modal-overlay select option[value="ocean"]')), "Admin UI renders editable workspace name, photo controls, and theme options");
  await page.evaluate(() => [...document.querySelectorAll(".modal-overlay button")].find((button) => button.textContent.trim() === "Skills")?.click());
  await page.waitForFunction(() => document.querySelector(".modal-overlay")?.textContent.includes("Workspace skill catalog"));
  const skillSurface = await page.$eval(".modal-overlay", (dialog) => dialog.textContent || "");
  ok(/complete procedures/.test(skillSurface) && /SkillsMD library/.test(skillSurface), "Skills UI exposes the complete shipped arsenal and focused SkillsMD catalog");
  await page.evaluate(() => [...document.querySelectorAll(".modal-overlay button")].find((button) => button.textContent.trim() === "Domains")?.click());
  await page.waitForSelector('.modal-overlay input[placeholder="agents.example.com"]');
  ok(Boolean(await page.$('.modal-overlay input[placeholder="Cloudflare API token"]')), "Domains UI provides the Cloudflare hostname and one-time token connection flow");
  await page.click('.modal-overlay button[aria-label="Close settings"]');

  await page.click('[data-channel-view="memory"]');
  await page.waitForFunction((path) => location.pathname === path, {}, `/c/${channel.slug}/memory`);
  await page.waitForFunction((value) => document.querySelector("#channelview")?.textContent.includes(value), {}, memoryMarker);
  const memoryRender = await page.evaluate((value) => {
    const view = document.querySelector("#channelview");
    return { hasHeading: Boolean(view?.querySelector("h1")), hasStrong: Boolean(view?.querySelector("strong")), raw: view?.textContent.includes("# Contract knowledge") || view?.textContent.includes("**Durable**"), marker: view?.textContent.includes(value) };
  }, memoryMarker);
  ok(memoryRender.marker && memoryRender.hasHeading && memoryRender.hasStrong && !memoryRender.raw, "Memory renders safe Markdown instead of raw # and * syntax");
  const memoryApi = await api(`/api/channels/${channel.id}/memory`);
  ok(memoryApi.memory.every((item) => item.kind !== "summary") && memoryApi.memory.some((item) => item.content.includes(memoryMarker)), "Memory API contains knowledge, never automatic transcript summaries");

  await page.click('[data-channel-view="threads"]');
  const threads = await api(`/api/channels/${channel.id}/threads`);
  const overflowThread = threads.threads.find((thread) => thread.root_message_id === overflowRoot);
  await page.waitForSelector(`[data-thread-open="${overflowThread.id}"]`);
  const statusPresentation = await page.$eval(`[data-thread-open="${overflowThread.id}"]`, (button) => ({
    text: button.textContent,
    hasSelect: Boolean(button.closest("article")?.querySelector("select")),
  }));
  ok(/open/i.test(statusPresentation.text) && !statusPresentation.hasSelect, "Threads presents agent-owned status as a readable path without human status controls");
  await page.click(`[data-thread-open="${overflowThread.id}"]`);
  await page.waitForSelector("#threadmsgs");
  const noOverflow = async () => page.evaluate(() => {
    const pane = document.querySelector("#thread");
    const messages = document.querySelector("#threadmsgs");
    const rows = [...document.querySelectorAll("#threadmsgs > *")];
    return Boolean(pane && messages) && messages.scrollWidth <= messages.clientWidth + 1 && rows.every((row) => row.scrollWidth <= row.clientWidth + 1);
  });
  ok(await noOverflow(), "thread pane has no horizontal scrollbar at desktop width");
  await page.setViewport({ width: 640, height: 800 });
  await sleep(300);
  ok(await noOverflow(), "thread pane has no horizontal scrollbar at narrow width");
  await page.setViewport({ width: 1280, height: 850 });

  await page.click('[data-channel-view="terminal"]');
  await page.waitForSelector(".xterm-screen", { timeout: 15_000 });
  await page.waitForFunction(() => Boolean(document.querySelector(".xterm")?.parentElement?.dataset.sessionId), { timeout: 15_000 });
  const terminalSession = await page.$eval(".xterm", (terminal) => terminal.parentElement.dataset.sessionId);
  await page.click(".xterm-screen");
  await page.keyboard.type(`echo ${marker}`);
  await page.keyboard.press("Enter");
  await page.waitForFunction((value) => document.querySelector(".xterm-rows")?.textContent.includes(value), { timeout: 15_000 }, marker);
  await page.click('[data-channel-view="chat"]');
  await page.click('[data-channel-view="terminal"]');
  await page.waitForFunction((value) => document.querySelector(".xterm-rows")?.textContent.includes(value), { timeout: 15_000 }, marker);
  const afterNavigateSession = await page.$eval(".xterm", (terminal) => terminal.parentElement.dataset.sessionId);
  ok(afterNavigateSession === terminalSession, "terminal screen and session survive navigating away and back");

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction((path) => location.pathname === path, {}, `/c/${channel.slug}/terminal`);
  await page.waitForFunction((value) => document.querySelector(".xterm-rows")?.textContent.includes(value), { timeout: 20_000 }, marker);
  const afterReloadSession = await page.$eval(".xterm", (terminal) => terminal.parentElement.dataset.sessionId);
  ok(afterReloadSession === terminalSession, "terminal reconnects to the same server session and replays scrollback after page reload");

  ok(browserErrors.length === 0, "real browser workflow has no console or page errors");
} catch (error) {
  fail++;
  console.error("  FAIL-", error.message);
  if (browser) {
    const pages = await browser.pages();
    await pages.at(-1)?.screenshot({ path: "/tmp/onehelm-production-browser-failure.png", fullPage: true }).catch(() => undefined);
  }
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (app && app.exitCode == null) {
    app.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => app.once("exit", resolve)), sleep(2000)]);
    if (app.exitCode == null) app.kill("SIGKILL");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
