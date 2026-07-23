import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

const root = process.cwd();
const dataDir = join(root, ".native-test-data", `guide-capture-${process.pid}`);
const gmailDir = join(dataDir, "isolated-gmail");
const output = join(root, "docs", "assets", "guide");
const siteOutput = join(root, "site", "public", "media");
mkdirSync(output, { recursive: true });
mkdirSync(siteOutput, { recursive: true });
const freePort = () => new Promise((resolve, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, label, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { const result = await fn(); if (result) return result; } catch { /* retry */ } await sleep(100); }
  throw new Error(`Timed out waiting for ${label}`);
};

const appPort = await freePort();
const mockPort = await freePort();
const base = `http://127.0.0.1:${appPort}`;
let app; let mock; let browser;
const api = async (path, options = {}, token = "") => {
  const response = await fetch(base + path, {
    method: options.method || (options.body !== undefined ? "POST" : "GET"),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${result.error || response.status}`);
  return result;
};
const clickButton = async (page, label, rootSelector = "body") => page.evaluate(({ label, rootSelector }) => {
  const rootNode = document.querySelector(rootSelector) || document;
  const button = [...rootNode.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label || candidate.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  button.click();
}, { label, rootSelector });

try {
  rmSync(dataDir, { recursive: true, force: true });
  mock = spawn(process.execPath, ["test/mock-openai.mjs", String(mockPort)], { cwd: root, stdio: "ignore" });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${mockPort}/v1/models`).catch(() => null))?.ok, "mock provider");
  app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      CTRL_DATA_DIR: dataDir,
      ONEHELM_GOOGLE_CONNECTION_DIR: gmailDir,
      ONEHELM_GOOGLE_TOKENS_DIR: join(gmailDir, "tokens"),
      PORT: String(appPort),
      IMPROVEMENT_INTERVAL_MS: "600000",
    },
    stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "1Helm");
  const registration = await api("/api/auth/register", { body: { username: "captain", password: "guide-pass", display: "Captain" } });
  const token = registration.token;
  const provider = await api("/api/providers", { body: { name: "Product model fabric", base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: "guide-key" } }, token);
  await api("/api/setup/complete", { body: { name: "Harbor Studio", terminals_enabled: true, provider_id: provider.provider.id, model: "mock-large" } }, token);
  const channel = (await api("/api/channels", { body: { name: "Product Launch", purpose: "Own the launch plan, implementation, evidence, and release." } }, token)).channel;
  const main = (await api("/api/channels", {}, token)).channels.find((entry) => entry.name === "main");
  const work = await api(`/api/channels/${channel.id}/messages`, { body: { body: `@${channel.agent.name} run a command to create launch-plan.md with a launch plan` } }, token);
  await waitFor(async () => (await api(`/api/messages/${work.message.id}/thread`, {}, token)).replies?.some((reply) => /Answer complete/.test(reply.body || "")), "launch plan");
  await api(`/api/channels/${channel.id}/messages`, { body: { body: "Launch scope confirmed. Prioritize reliability, distribution, and customer evidence." } }, token);
  await api(`/api/channels/${channel.id}/messages`, { body: { body: "Release checklist is ready for owner review." } }, token);
  await api(`/api/channels/${channel.id}/messages`, { body: { body: "Customer communication draft is awaiting final launch timing." } }, token);
  const question = await api(`/api/channels/${channel.id}/messages`, { body: { body: `@${channel.agent.name} ask me a structured interview with multiple choice` } }, token);
  const questionReply = await waitFor(async () => (await api(`/api/messages/${question.message.id}/thread`, {}, token)).replies?.find((reply) => reply.questions?.status === "pending"), "structured question");
  const skipper = await api(`/api/channels/${main.id}/messages`, { body: { body: "@skipper what channels exist" } }, token);
  await waitFor(async () => (await api(`/api/messages/${skipper.message.id}/thread`, {}, token)).replies?.some((reply) => /Answer complete/.test(reply.body || "")), "Skipper inventory");

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1512, height: 982, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate((sessionToken) => localStorage.setItem("ctrl.token", sessionToken), token);
  await page.goto(`${base}/c/${channel.slug}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('textarea[data-composer-parent="root"]');
  await page.screenshot({ path: join(output, "workspace-chat.png") });
  copyFileSync(join(output, "workspace-chat.png"), join(siteOutput, "workspace.png"));

  await page.goto(`${base}/c/${channel.slug}/thread/${question.message.id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector(`[data-message-id="${questionReply.id}"] [aria-pressed="false"]`);
  await page.click(`[data-message-id="${questionReply.id}"] [aria-pressed="false"]`);
  await page.screenshot({ path: join(output, "structured-questions.png") });

  await clickButton(page, "Board", "nav");
  await page.waitForSelector(".board-lanes");
  await page.screenshot({ path: join(output, "board.png") });

  await clickButton(page, "Files", "nav");
  await page.waitForFunction(() => document.getElementById("channelview")?.innerText.includes("launch-plan.md"));
  await page.screenshot({ path: join(output, "files.png") });

  await clickButton(page, "Activity", "nav");
  await page.waitForFunction(() => document.getElementById("channelview")?.innerText.includes("complete"));
  await page.screenshot({ path: join(output, "activity.png") });

  await clickButton(page, "Terminal", "nav");
  await page.waitForSelector(".xterm");
  await sleep(500);
  await page.click(".xterm-helper-textarea");
  await page.keyboard.type("cd /workspace && clear && printf 'release evidence ready\\n'"); await page.keyboard.press("Enter");
  await sleep(500);
  await page.screenshot({ path: join(output, "terminal.png") });

  await page.click('button[title="Settings"]');
  await clickButton(page, "Providers", 'nav[aria-label="Settings sections"]');
  await page.waitForSelector(".routing-fabric");
  await page.screenshot({ path: join(output, "providers.png") });
  await clickButton(page, "Connections", 'nav[aria-label="Settings sections"]');
  await page.waitForFunction(() => document.body.innerText.includes("Gmail") && document.body.innerText.includes("Photon"));
  await page.screenshot({ path: join(output, "connections.png") });
  copyFileSync(join(output, "connections.png"), join(siteOutput, "connections.png"));
  await clickButton(page, "Skills", 'nav[aria-label="Settings sections"]');
  await page.waitForFunction(() => document.body.innerText.includes("SkillsMD") && document.body.innerText.includes("Learn a new skill"));
  await page.screenshot({ path: join(output, "skills.png") });
  copyFileSync(join(output, "skills.png"), join(siteOutput, "skills.png"));
  await clickButton(page, "Skipper computers", 'nav[aria-label="Settings sections"]');
  await page.waitForFunction(() => document.body.innerText.includes("Channel computers"));
  await page.screenshot({ path: join(output, "computers.png") });

  console.log(`Captured current product screenshots in ${output} and ${siteOutput}`);
} finally {
  await browser?.close().catch(() => undefined);
  for (const child of [app, mock]) if (child && child.exitCode == null) child.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}
