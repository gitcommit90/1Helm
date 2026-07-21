import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

const root = process.cwd();
const tmpRoot = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, "tmp") : join(root, ".native-test-data");
const runRoot = join(tmpRoot, `onboarding-browser-${process.pid}`);
let mock;
let app;
let browser;
let pass = 0;
let fail = 0;

const freePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    const port = typeof address === "object" && address ? address.port : 0;
    probe.close(() => resolve(port));
  });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, label, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; }
    catch (error) { last = error.message; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
};
const ok = (condition, label) => {
  if (!condition) throw new Error(label);
  pass++;
  console.log("  ok  -", label);
};
const clickButton = (page, label) => page.evaluate((text) => {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  button.click();
}, label);
const waitForHeading = (page, title) => page.waitForFunction((text) =>
  [...document.querySelectorAll("h2")].some((heading) => heading.textContent?.trim() === text), {}, title);

try {
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const dataDir = join(runRoot, "workspace");
  const mockPort = await freePort();
  mock = spawn(process.execPath, ["test/mock-openai.mjs", String(mockPort)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${mockPort}/v1/models`).catch(() => null))?.ok, "mock provider");

  const appPort = await freePort();
  const base = `http://127.0.0.1:${appPort}`;
  const diagnostics = [];
  app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      CTRL_DATA_DIR: dataDir,
      PORT: String(appPort),
      IMPROVEMENT_INTERVAL_MS: "600000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.on("data", (chunk) => diagnostics.push(chunk.toString()));
  app.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));
  await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "onboarding server");

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1000 });
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle0" });

  await waitForHeading(page, "Create the Captain account");
  await page.type('input[autocomplete="username"]', "captain");
  await page.type('input[autocomplete="name"]', "Captain");
  await page.type('input[autocomplete="new-password"]', "onboarding-test-pass");
  await clickButton(page, "Continue");

  await waitForHeading(page, "Connect the providers you use");
  const providerCopy = await page.$eval(".wizard-panel", (element) => element.textContent || "");
  ok(/Step 2 \/ 3/.test(providerCopy) && /one or several accounts or keys/i.test(providerCopy) && /no single AI brain/i.test(providerCopy), "provider onboarding teaches the multi-provider fabric");
  ok(!/starter model|choose a model/i.test(providerCopy) && !await page.$("select.field"), "provider onboarding does not ask for a starter model");
  ok(Boolean(await page.$('[data-provider-source="chatgpt"]')) && Boolean(await page.$('[data-provider-source="claude"]')) && Boolean(await page.$('[data-provider-source="custom"]')), "provider onboarding exposes OAuth and keyed sources from the routing control plane");

  await page.click('[data-provider-source="custom"]');
  await page.waitForSelector('[data-keyed-form="custom"]');
  await page.$eval('[data-keyed-field="name"]', (input) => { input.value = "Deterministic provider"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.type('[data-keyed-field="base"]', `http://127.0.0.1:${mockPort}/v1`);
  await page.type('[data-keyed-field="key"]', "provider-test-key");
  await page.click('[data-keyed-action="test"]');
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-keyed-action="add"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.click('[data-keyed-action="add"]');
  await page.waitForSelector("[data-provider-account]");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((candidate) =>
    candidate.textContent?.trim() === "Continue" && candidate instanceof HTMLButtonElement && !candidate.disabled));
  ok(/connected accounts & keys/i.test(await page.$eval(".wizard-panel", (element) => element.textContent || "")), "the shared provider UI immediately shows the connected account");
  await clickButton(page, "Continue");

  await waitForHeading(page, "Name this workspace");
  const workspaceCopy = await page.$eval(".wizard-panel", (element) => element.textContent || "");
  ok(/Step 3 \/ 3/.test(workspaceCopy) && /private Linux computer for every ordinary channel/i.test(workspaceCopy), "workspace creation explains automatic per-channel computers without a computer decision step");
  ok(!/Cloudflare API token|human terminal access|CPU|RAM|disk size/i.test(workspaceCopy), "onboarding contains no domain, terminal, or resource-sizing ceremony");
  const workspaceName = "Fresh provider fabric";
  await page.click('input[autocomplete="organization"]');
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.type('input[autocomplete="organization"]', workspaceName);
  await clickButton(page, "Create workspace");
  await page.waitForSelector("aside", { timeout: 20_000 });

  const status = await fetch(`${base}/api/setup/status`).then((response) => response.json());
  ok(status.setup_complete && status.workspace.name === workspaceName && status.workspace.terminals_enabled, "workspace completes with terminals available by default");
  const database = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const workspace = database.prepare("SELECT default_provider_id,default_model FROM workspace WHERE id=1").get();
  const provider = database.prepare("SELECT kind,name FROM providers WHERE id=?").get(workspace.default_provider_id);
  database.close();
  const routingConfig = JSON.parse(readFileSync(join(dataDir, "routing", "config.json"), "utf8"));
  ok(provider?.kind === "routing" && provider?.name === "1Helm Router" && workspace.default_model, "setup assigns Skipper to the provider-neutral internal router without asking for a model");
  ok(routingConfig.providers.some((item) => item.name === "Deterministic provider" && item.type === "openai-compat"), "the onboarding connection is persisted in the authoritative routing store");
  ok(new URL(page.url()).pathname === "/c/main/chat", "completion opens the workspace directly without a Domain step");
  ok(browserErrors.length === 0, `onboarding browser flow has no console or page errors (${browserErrors.join("; ")})`);
} catch (error) {
  fail++;
  console.error("  FAIL-", error.message);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (app && app.exitCode == null) {
    app.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => app.once("exit", resolve)), sleep(2000)]);
    if (app.exitCode == null) app.kill("SIGKILL");
  }
  if (mock && mock.exitCode == null) mock.kill("SIGTERM");
  rmSync(runRoot, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
