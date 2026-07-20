import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

const root = process.cwd();
const tmpRoot = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, "tmp") : join(root, ".native-test-data");
const runRoot = join(tmpRoot, `onboarding-browser-${process.pid}`);
let mock;
let cloudflare;
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

async function exerciseScenario(kind, mockPort, cloudflarePort, cloudflareRequests) {
  const appPort = await freePort();
  const base = `http://127.0.0.1:${appPort}`;
  const dataDir = join(runRoot, kind);
  let app;
  let browser;
  const diagnostics = [];
  try {
    app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
      cwd: root,
      env: {
        ...process.env,
        CTRL_DATA_DIR: dataDir,
        PORT: String(appPort),
        CLOUDFLARE_API_BASE: `http://127.0.0.1:${cloudflarePort}/client/v4`,
        CLOUDFLARE_UNIT_PATH: join(dataDir, "cloudflare", "1helm-cloudflare-domain.service"),
        CLOUDFLARED_BIN: "/bin/true",
        CLOUDFLARE_SYSTEMCTL_BIN: "/bin/true",
        IMPROVEMENT_INTERVAL_MS: "600000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    app.stdout.on("data", (chunk) => diagnostics.push(chunk.toString()));
    app.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));
    await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, `${kind} server`);

    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    const browserErrors = [];
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto(base, { waitUntil: "networkidle0" });

    await waitForHeading(page, "Create the Captain account");
    await page.type('input[autocomplete="username"]', `captain-${kind}`);
    await page.type('input[autocomplete="name"]', "Captain");
    await page.type('input[autocomplete="new-password"]', "onboarding-test-pass");
    await clickButton(page, "Continue");

    await waitForHeading(page, "Connect an AI brain");
    await page.type('input[placeholder="OpenAI, local gateway, work account"]', "Deterministic provider");
    await page.type('input[placeholder="https://api.openai.com/v1"]', `http://127.0.0.1:${mockPort}/v1`);
    await page.type('input[placeholder="Paste your API key"]', "provider-test-key");
    await clickButton(page, "Test connection & load models");
    await page.waitForFunction(() => {
      const select = document.querySelector("select.field");
      return select instanceof HTMLSelectElement && !select.disabled && select.options.length === 2;
    });
    await clickButton(page, "Use this provider");
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((candidate) =>
      candidate.textContent?.trim() === "Continue" && candidate instanceof HTMLButtonElement && !candidate.disabled));
    await clickButton(page, "Continue");

    await waitForHeading(page, "Show channel terminals?");
    await clickButton(page, "Continue");
    await waitForHeading(page, "Name this workspace");
    const workspaceName = `Fresh ${kind} workspace`;
    await page.click('input[autocomplete="organization"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.type('input[autocomplete="organization"]', workspaceName);
    await clickButton(page, "Create workspace");

    await waitForHeading(page, "Connect your Cloudflare domain");
    const domainCopy = await page.evaluate(() => document.querySelector(".wizard-panel")?.textContent || "");
    ok(/Step 5 \/ 5/.test(domainCopy) && /Do you have a domain on Cloudflare\?/.test(domainCopy), `${kind}: onboarding includes the explicit final Cloudflare domain step`);
    ok(Boolean(await page.$('input[placeholder="agents.example.com"]')) && Boolean(await page.$('input[placeholder="Cloudflare API token"]')), `${kind}: domain step asks for hostname and a one-time Cloudflare token`);

    if (kind === "skip") {
      await clickButton(page, "Not now");
      await page.waitForSelector("aside", { timeout: 15_000 });
      const database = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
      const domains = database.prepare("SELECT count(*) n FROM workspace_domains").get().n;
      database.close();
      ok(domains === 0 && new URL(page.url()).pathname === "/c/main/chat", "Not now finishes onboarding without creating a domain and opens the workspace");
    } else {
      const hostname = "fresh.agents.example.com";
      const oneTimeToken = "CLOUDFLARE_ONE_TIME_BROWSER_TOKEN_92f3";
      await page.type('input[placeholder="agents.example.com"]', hostname);
      await page.type('input[placeholder="Cloudflare API token"]', oneTimeToken);
      await clickButton(page, "Connect domain");
      await waitForHeading(page, "Your workspace is on the web.");
      ok(await page.$eval(".wizard-panel a", (anchor, expected) => anchor.textContent?.trim() === `https://${expected}`, hostname), "Connect domain shows the resulting HTTPS hostname before entering the workspace");
      await page.waitForSelector("aside", { timeout: 15_000 });
      const database = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
      const domain = database.prepare("SELECT hostname,status FROM workspace_domains").get();
      const columns = database.prepare("PRAGMA table_info(workspace_domains)").all().map((column) => column.name);
      database.close();
      const persistedBytes = readFileSync(join(dataDir, "ctrl-pane.db"));
      ok(domain?.hostname === hostname && domain?.status === "active", "mocked Cloudflare connection persists the active custom hostname");
      ok(!columns.includes("token") && !persistedBytes.includes(Buffer.from(oneTimeToken)), "Cloudflare API token is not stored in the domain schema or database");
      const calls = cloudflareRequests.splice(0);
      ok(calls.length === 3
        && calls[0].method === "GET" && calls[0].path.startsWith("/client/v4/zones?")
        && calls[1].method === "POST" && calls[1].path === "/client/v4/accounts/account-test/cfd_tunnel"
        && calls[2].method === "POST" && calls[2].path === "/client/v4/zones/zone-test/dns_records"
        && calls.every((call) => call.authorized), "connector performs authenticated zone lookup, named-tunnel creation, and proxied DNS creation through the Cloudflare API");
      const credentialPath = join(dataDir, "cloudflare", "tunnel.json");
      const configPath = join(dataDir, "cloudflare", "config.yml");
      const unitPath = join(dataDir, "cloudflare", "1helm-cloudflare-domain.service");
      const credentials = JSON.parse(readFileSync(credentialPath, "utf8"));
      const config = readFileSync(configPath, "utf8");
      const unit = readFileSync(unitPath, "utf8");
      ok(credentials.AccountTag === "account-test" && credentials.TunnelID === "tunnel-test" && credentials.TunnelSecret
        && (statSync(credentialPath).mode & 0o777) === 0o600, "connector writes the named-tunnel credential with mode 0600");
      ok(config.includes(`hostname: ${hostname}`) && config.includes(`service: http://127.0.0.1:${appPort}`)
        && config.includes(`credentials-file: ${credentialPath}`), "connector writes a persistent local tunnel ingress configuration for the workspace server");
      ok(unit.includes(`ExecStart=/bin/true --no-autoupdate --config ${configPath} tunnel run`)
        && unit.includes("WantedBy=multi-user.target"), "connector installs an enableable persistent systemd unit for cloudflared");
    }

    const status = await fetch(`${base}/api/setup/status`).then((response) => response.json());
    ok(status.setup_complete && status.workspace.name === workspaceName, `${kind}: first-run onboarding completes the configured workspace (${JSON.stringify(status)})`);
    ok(browserErrors.length === 0, `${kind}: onboarding browser flow has no console or page errors`);
  } catch (error) {
    throw new Error(`${kind} scenario failed: ${error.message}\n${diagnostics.join("").slice(-4000)}`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (app && app.exitCode == null) {
      app.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => app.once("exit", resolve)), sleep(2000)]);
      if (app.exitCode == null) app.kill("SIGKILL");
    }
  }
}

try {
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const mockPort = await freePort();
  mock = spawn(process.execPath, ["test/mock-openai.mjs", String(mockPort)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${mockPort}/v1/models`).catch(() => null))?.ok, "mock provider");
  const cloudflarePort = await freePort();
  const cloudflareRequests = [];
  cloudflare = createHttpServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${cloudflarePort}`);
    let raw = "";
    for await (const chunk of request) raw += chunk;
    cloudflareRequests.push({ method: request.method, path: url.pathname + url.search, authorized: /^Bearer\s+/.test(String(request.headers.authorization || "")), body: raw ? JSON.parse(raw) : null });
    let result;
    if (request.method === "GET" && url.pathname === "/client/v4/zones") result = [{ id: "zone-test", name: "example.com", account: { id: "account-test" } }];
    else if (request.method === "POST" && url.pathname === "/client/v4/accounts/account-test/cfd_tunnel") result = { id: "tunnel-test", name: "1helm-test" };
    else if (request.method === "POST" && url.pathname === "/client/v4/zones/zone-test/dns_records") result = { id: "dns-test" };
    else { response.writeHead(404, { "content-type": "application/json" }); return response.end(JSON.stringify({ success: false, errors: [{ message: "Unexpected Cloudflare test request" }] })); }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, errors: [], result }));
  });
  await new Promise((resolve, reject) => { cloudflare.once("error", reject); cloudflare.listen(cloudflarePort, "127.0.0.1", resolve); });
  await exerciseScenario("skip", mockPort, cloudflarePort, cloudflareRequests);
  ok(cloudflareRequests.length === 0, "Not now makes no Cloudflare API requests");
  await exerciseScenario("connect", mockPort, cloudflarePort, cloudflareRequests);
} catch (error) {
  fail++;
  console.error("  FAIL-", error.message);
} finally {
  if (mock && mock.exitCode == null) mock.kill("SIGTERM");
  if (cloudflare) await new Promise((resolve) => cloudflare.close(resolve));
  rmSync(runRoot, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
