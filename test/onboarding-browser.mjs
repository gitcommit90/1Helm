import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer";

const root = process.cwd();
const tmpRoot = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, "tmp") : join(root, ".native-test-data");
const runRoot = join(tmpRoot, `onboarding-browser-${process.pid}`);
let mock;
let app;
let browser;
let pass = 0;
let fail = 0;

/** APFS external volumes can race on deep venv trees (ENOTEMPTY) while Python
 * site-packages are still settling after mnemosyne bootstrap. Cleanup must not
 * fail a green browser suite. */
async function removeTree(path) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      return;
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : "";
      if (!["ENOTEMPTY", "EBUSY", "EPERM", "ENOENT"].includes(String(code)) || attempt === 7) {
        if (code === "ENOENT") return;
        // Last-resort: leave the temp tree; the suite already passed.
        if (attempt === 7) {
          console.warn(`  warn - could not fully remove ${path}: ${error.message}`);
          return;
        }
      }
      await delay(100 * (attempt + 1));
    }
  }
}

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
  await removeTree(runRoot);
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
      NODE_ENV: "test",
      HELM_UPDATE_MANIFEST_URL: `http://127.0.0.1:${mockPort}/update-manifest`,
      HELM_INSTALL_KIND: "linux-systemd",
      HELM_CHANNEL_COMPUTER_BACKEND: "native",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.on("data", (chunk) => diagnostics.push(chunk.toString()));
  app.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));
  await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "onboarding server");

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({
    width: Number(process.env.ONBOARDING_VIEWPORT_WIDTH || 1200),
    height: Number(process.env.ONBOARDING_VIEWPORT_HEIGHT || 1000),
  });
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle0" });

  await waitForHeading(page, "Create the Captain account");
  const captainGeometry = await page.evaluate(() => ({ shell: document.querySelector(".wizard-shell")?.scrollHeight, client: document.querySelector(".wizard-shell")?.clientHeight, panel: document.querySelector(".wizard-panel")?.scrollHeight, panelClient: document.querySelector(".wizard-panel")?.clientHeight }));
  ok(captainGeometry.shell === captainGeometry.client && captainGeometry.panel === captainGeometry.panelClient, "Captain onboarding fits without page or panel scrolling");
  await page.type('input[autocomplete="username"]', "captain");
  await page.type('input[autocomplete="name"]', "Captain");
  await page.type('input[autocomplete="new-password"]', "onboarding-test-pass");
  await clickButton(page, "Continue");

  await waitForHeading(page, "Connect the providers you use");
  const providerCopy = await page.$eval(".wizard-panel", (element) => element.textContent || "");
  ok(/Step 2 \/ 3/.test(providerCopy) && /one or several accounts or keys/i.test(providerCopy) && /no single AI brain/i.test(providerCopy), "provider onboarding teaches the multi-provider fabric");
  ok(!/starter model|choose a model/i.test(providerCopy) && !await page.$("select.field"), "provider onboarding does not ask for a starter model");
  ok(Boolean(await page.$('[data-provider-source="chatgpt"]')) && Boolean(await page.$('[data-provider-source="claude"]')) && Boolean(await page.$('[data-provider-source="custom"]')), "provider onboarding exposes OAuth and keyed sources from the routing control plane");
  const providerGeometry = await page.evaluate(() => ({ shell: document.querySelector(".wizard-shell")?.scrollHeight, client: document.querySelector(".wizard-shell")?.clientHeight, panel: document.querySelector(".wizard-panel")?.scrollHeight, panelClient: document.querySelector(".wizard-panel")?.clientHeight }));
  ok(providerGeometry.shell === providerGeometry.client && providerGeometry.panel === providerGeometry.panelClient, "provider onboarding uses horizontal space and does not scroll");

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
  const workspaceGeometry = await page.evaluate(() => ({ shell: document.querySelector(".wizard-shell")?.scrollHeight, client: document.querySelector(".wizard-shell")?.clientHeight, panel: document.querySelector(".wizard-panel")?.scrollHeight, panelClient: document.querySelector(".wizard-panel")?.clientHeight }));
  ok(workspaceGeometry.shell === workspaceGeometry.client && workspaceGeometry.panel === workspaceGeometry.panelClient, "workspace onboarding fits without scrolling");
  const workspaceCopy = await page.$eval(".wizard-panel", (element) => element.textContent || "");
  ok(/Step 3 \/ 3/.test(workspaceCopy) && /private Linux computer for every ordinary channel/i.test(workspaceCopy), "workspace creation explains automatic per-channel computers without a computer decision step");
  ok(!/Cloudflare API token|human terminal access|CPU|RAM|disk size/i.test(workspaceCopy), "onboarding contains no domain, terminal, or resource-sizing ceremony");
  const workspaceName = "Fresh provider fabric";
  await page.$eval('input[autocomplete="organization"]', (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, workspaceName);
  await clickButton(page, "Create workspace");
  await page.waitForSelector("aside", { timeout: 20_000 });
  await page.waitForSelector("#welcome-tour", { timeout: 20_000 });
  const welcomeTour = await page.$eval("#welcome-tour", (element) => element.textContent || "");
  ok(/Which model should be primary/i.test(welcomeTour) && /30-second tour/i.test(welcomeTour) && /Channels are private worlds/i.test(welcomeTour), "fresh onboarding lands on the optional primary-model choice and product tour");
  ok(await page.$$eval("#welcome-tour select.field", (selects) => selects.length === 2 && selects.every((select) => select.options.length > 0)), "primary model choice uses provider and model selectors instead of exposing 1Helm Router");
  await page.evaluate(() => [...document.querySelectorAll("#welcome-tour button")].find((button) => button.textContent?.trim() === "Keep current")?.click());
  await page.waitForFunction(() => !document.querySelector("#welcome-tour"));

  // This browser test combines the legacy Linux service contract with the
  // native fake-computer backend so it can exercise the host update UI. The
  // real 0.0.5 migration watcher is intentionally absent; clear its synthetic
  // bootstrap request before asserting the independent release check.
  rmSync(join(dataDir, "host-update.request"), { force: true });
  await page.click('button[title="Open profile"]');
  await page.waitForSelector("#profile-popover");
  await page.waitForFunction(() => document.querySelector("[data-profile-update-status]")?.textContent?.includes("available for this Linux host"));
  const updateAction = await page.evaluate(() => {
    const section = document.querySelector("[data-profile-update]");
    const status = section?.querySelector("[data-profile-update-status]");
    const button = section?.querySelector("[data-profile-update-action]");
    if (!(button instanceof HTMLButtonElement)) return null;
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      status: status?.textContent || "",
      text: button.textContent || "",
      hasBrowserUrl: Boolean(button.dataset.updateUrl),
      visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      sameSection: Boolean(section && status && section.contains(button)),
    };
  });
  ok(updateAction?.visible && updateAction.sameSection
    && updateAction.status === "1Helm v9.9.9 is available for this Linux host."
    && updateAction.text === "Update host to v9.9.9"
    && !updateAction.hasBrowserUrl,
  "an available update offers a host-owned action without giving the browsing device an installer URL");
  await page.$eval('#profile-popover input[placeholder="Job title"]', (input) => { input.value = "Product captain"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval('#profile-popover textarea', (input) => { input.value = "Builds calm native products."; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.evaluate(() => [...document.querySelectorAll("#profile-popover button")].find((button) => button.textContent?.trim() === "Save profile")?.click());
  await page.waitForFunction(() => !document.querySelector("#profile-popover"));
  ok(await page.evaluate(() => document.querySelector('button[title="Open profile"]')?.textContent?.includes("Captain")), "bottom-left identity opens and saves the Profile popover without replacing Settings");

  await page.click('button[aria-label="Open settings"]');
  await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Skills")?.click());
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent?.includes("Learn a new skill")));
  ok(true, "Settings Skills exposes the visible Learn a new skill workflow");
  await page.click('button[aria-label="Close settings"]');

  const status = await fetch(`${base}/api/setup/status`).then((response) => response.json());
  ok(status.setup_complete && status.workspace.name === workspaceName && status.workspace.terminals_enabled, "workspace completes with terminals available by default");
  const database = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
  const workspace = database.prepare("SELECT default_provider_id,default_model FROM workspace WHERE id=1").get();
  const captainProfile = database.prepare("SELECT job_title,description,tour_complete FROM users WHERE username='captain'").get();
  const provider = database.prepare("SELECT kind,name FROM providers WHERE id=?").get(workspace.default_provider_id);
  database.close();
  const routingConfig = JSON.parse(readFileSync(join(dataDir, "routing", "config.json"), "utf8"));
  ok(provider?.kind === "routing" && provider?.name === "1Helm Router" && workspace.default_model, "setup assigns Skipper to the provider-neutral internal router without asking for a model");
  ok(captainProfile.tour_complete === 1 && captainProfile.job_title === "Product captain" && /calm native products/.test(captainProfile.description), "tour completion and profile fields persist in the native workspace database");
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
  await removeTree(runRoot);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
