import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import puppeteer from "puppeteer";

const ROOT = new URL("..", import.meta.url).pathname;

function browserExecutable() {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured) {
    try { accessSync(configured, fsConstants.X_OK); return configured; } catch { /* use discovery */ }
  }
  try {
    const bundled = puppeteer.executablePath();
    accessSync(bundled, fsConstants.X_OK);
    return bundled;
  } catch { /* no bundled browser */ }
  for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
    try { accessSync(candidate, fsConstants.X_OK); return candidate; } catch { /* try next */ }
  }
  return null;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
      last = new Error(`HTTP ${response.status}`);
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw last || new Error(`Timed out waiting for ${url}`);
}

async function waitUntil(check, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await check(); if (last) return last; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (last instanceof Error) throw last;
  throw new Error("Timed out waiting for condition");
}

async function json(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || body.error || `HTTP ${response.status}`);
  return body;
}

test("embedded provider fabric powers 1Helm agents and its public endpoint", { timeout: 90_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "1helm-routing-test-"));
  const appPort = await freePort();
  const routerPort = await freePort();
  const mockPort = await freePort();
  const children = [];
  const logs = [];
  let browser;
  let app;
  const start = (command, args, env = {}) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
    child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
    children.push(child); return child;
  };

  try {
    start(process.execPath, ["test/mock-openai.mjs", String(mockPort)]);
    await waitFor(`http://127.0.0.1:${mockPort}/models`);
    const seeded = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `
      import('./src/server/db.ts').then(({ run, now }) => {
        const providerId = run("INSERT INTO providers (name,base_url,api_key,kind,created) VALUES (?,?,?,?,?)", "Legacy source", "http://127.0.0.1:${mockPort}", "legacy-key", "openai", now()).lastInsertRowid;
        run("INSERT INTO bots (name,provider_id,model,prompt,avatar,base_url,api_key,created) VALUES (?,?,?,?,?,'','',?)", "legacy-agent", providerId, "legacy-model", "", "", now());
        run("INSERT INTO providers (name,base_url,api_key,kind,created) VALUES (?,?,?,?,?)", "Non-HTTP local provider", "session://host-only", "host-secret", "native", now());
      });
    `], { cwd: ROOT, env: { ...process.env, CTRL_DATA_DIR: dataDir }, encoding: "utf8" });
    assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout);
    app = start(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
      CTRL_DATA_DIR: dataDir,
      PORT: String(appPort),
      HELM_ROUTER_PORT: String(routerPort),
    });
    await waitFor(`http://127.0.0.1:${appPort}/api/setup/status`);

    const unauthenticated = await fetch(`http://127.0.0.1:${appPort}/api/routing/state`);
    assert.equal(unauthenticated.status, 401, "control plane requires a 1Helm session");
    const registration = await json(`http://127.0.0.1:${appPort}/api/auth/register`, "", {
      method: "POST", body: JSON.stringify({ username: "captain", display: "Captain", password: "test-password" }),
    });
    const token = registration.token;
    await json(`http://127.0.0.1:${appPort}/api/admin/users`, token, {
      method: "POST", body: JSON.stringify({ username: "crew", display: "Crew", password: "crew-password", is_admin: false }),
    });
    const guestToken = (await json(`http://127.0.0.1:${appPort}/api/auth/login`, "", {
      method: "POST", body: JSON.stringify({ username: "crew", password: "crew-password" }),
    })).token;
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/routing/models`, { headers: { authorization: `Bearer ${guestToken}` } })).status, 200, "non-admin members can read the model catalog used by agents");
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/routing/state`, { headers: { authorization: `Bearer ${guestToken}` } })).status, 403, "non-admin members cannot read provider credentials or control state");
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/routing/action`, { method: "POST", headers: { authorization: `Bearer ${guestToken}`, "content-type": "application/json" }, body: JSON.stringify({ action: "app:logs-clear" }) })).status, 403, "non-admin members cannot mutate the provider fabric");

    const oauthOrigins = {
      chatgpt: "https://auth.openai.com",
      claude: "https://claude.ai",
      antigravity: "https://accounts.google.com",
      xai: "https://auth.x.ai",
    };
    for (const [type, expectedOrigin] of Object.entries(oauthOrigins)) {
      const oauthStarted = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
        method: "POST", body: JSON.stringify({ action: "app:oauth-start", payload: type }),
      });
      assert.equal(oauthStarted.ok, true, `${type} OAuth can be initiated from 1Helm`);
      assert.equal(new URL(oauthStarted.authUrl).origin, expectedOrigin, `${type} uses the expected provider authorization host`);
      const oauthStatus = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
        method: "POST", body: JSON.stringify({ action: "app:oauth-status", payload: type }),
      });
      assert.equal(oauthStatus.active, true);
      await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
        method: "POST", body: JSON.stringify({ action: "app:oauth-cancel", payload: type }),
      });
      const cancelled = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
        method: "POST", body: JSON.stringify({ action: "app:oauth-status", payload: type }),
      });
      assert.equal(cancelled.active, false, `${type} OAuth cancellation clears pending state`);
    }
    const objectOauth = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:oauth-start", payload: { type: "chatgpt", providerId: "existing-account" } }),
    });
    assert.equal(objectOauth.ok, true, "1Helm accepts native OAuth metadata while passing only the provider type to the embedded engine");
    assert.equal(new URL(objectOauth.authUrl).origin, oauthOrigins.chatgpt);
    const objectOauthStatus = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:oauth-status", payload: "chatgpt" }),
    });
    assert.equal(objectOauthStatus.active, true, "server-side OAuth completion watcher preserves observable pending status");
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:oauth-cancel", payload: "chatgpt" }),
    });
    const oauthLogs = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:logs-get", payload: 200 }),
    });
    assert.equal(JSON.stringify(oauthLogs).includes("code_challenge="), false, "OAuth logs never expose callback challenges or full authorization URLs");

    const oauthPoolId = "prov_test_xai_oauth2";
    const seededOauthPool = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `
      const { readFileSync, writeFileSync } = require("node:fs");
      const file = process.argv[1];
      const config = JSON.parse(readFileSync(file, "utf8"));
      config.providers.push({ id: "${oauthPoolId}", type: "xai", name: "xAI test account 2", accountAlias: "oauth2", accessToken: "offline-test-token", enabled: true, createdAt: Date.now(), models: [{ id: "grok-4.5", name: "Grok 4.5", enabled: true }] });
      writeFileSync(file, JSON.stringify(config, null, 2));
    `, join(dataDir, "routing", "config.json")], { encoding: "utf8" });
    assert.equal(seededOauthPool.status, 0, seededOauthPool.stderr || seededOauthPool.stdout);
    app.kill("SIGTERM");
    await new Promise((resolve) => app.once("exit", resolve));
    app = start(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
      CTRL_DATA_DIR: dataDir,
      PORT: String(appPort),
      HELM_ROUTER_PORT: String(routerPort),
    });
    await waitFor(`http://127.0.0.1:${appPort}/api/setup/status`);
    let seededState = await json(`http://127.0.0.1:${appPort}/api/routing/state`, token);
    assert.equal(seededState.providers.find((provider) => provider.id === oauthPoolId)?.accountAlias, "oauth2", "same-provider account pool state is exposed with a human alias");
    assert.equal((await json(`http://127.0.0.1:${appPort}/api/routing/models`, token)).models.some((model) => model.id === "xai/grok-4.5"), true, "same-provider OAuth accounts publish a shared fill-first model route");
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, { method: "POST", body: JSON.stringify({ action: "app:set-provider-enabled", payload: { id: oauthPoolId, enabled: false } }) });
    seededState = await json(`http://127.0.0.1:${appPort}/api/routing/state`, token);
    assert.equal(seededState.providers.find((provider) => provider.id === oauthPoolId)?.enabled, false, "same-provider account pool members remain independently controllable");
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, { method: "POST", body: JSON.stringify({ action: "app:remove-provider", payload: oauthPoolId }) });
    assert.equal((await json(`http://127.0.0.1:${appPort}/api/routing/state`, token)).providers.some((provider) => provider.id === oauthPoolId), false, "removing an OAuth account removes its active authentication record");

    const tested = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST",
      body: JSON.stringify({ action: "app:test-keyed-provider", payload: { providerType: "openai-compat", baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: "mock-key" } }),
    });
    assert.equal(tested.ok, true);
    assert.deepEqual(tested.models.map((model) => model.id), ["mock-large", "mock-small"]);

    const noAuthTest = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST",
      body: JSON.stringify({ action: "app:test-keyed-provider", payload: { providerType: "openai-compat", baseUrl: `http://127.0.0.1:${mockPort}/no-auth`, apiKey: "" } }),
    });
    assert.deepEqual(noAuthTest.models.map((model) => model.id), ["mock-large", "mock-small"], "custom endpoints can be tested without an API key or Authorization header");
    const noAuthAdded = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST",
      body: JSON.stringify({ action: "app:add-keyed-provider", payload: { name: "No auth source", baseUrl: `http://127.0.0.1:${mockPort}/no-auth`, apiKey: "", models: noAuthTest.models } }),
    });
    assert(noAuthAdded.id, "an unauthenticated custom endpoint is stored without inventing a credential");

    const added = await json(`http://127.0.0.1:${appPort}/api/providers`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Test source", base_url: `http://127.0.0.1:${mockPort}`, api_key: "mock-key" }),
    });
    assert.equal(added.provider.kind, "routing");
    assert(added.models.some((model) => model.name === "mock-large" && model.id !== "mock-large"), "onboarding receives collision-safe routed model IDs for custom sources");
    const directModel = added.models.find((model) => model.name === "mock-large").id;
    let state = await json(`http://127.0.0.1:${appPort}/api/routing/state`, token);
    assert.equal(Object.hasOwn(state, "apiKeys"), false, "routine control-plane state omits gateway credentials");
    assert.equal(state.providers.length, 3);
    assert.equal(state.providers.some((provider) => provider.name === "Non-HTTP local provider"), false, "migration excludes non-HTTP host providers");
    assert(state.combos.some((combo) => combo.name === "legacy-model"), "legacy model assignment becomes a compatibility route");
    const addedProvider = state.providers.find((provider) => provider.name === "Test source");
    assert.equal(addedProvider.hasToken, true);
    assert.equal(Object.hasOwn(addedProvider, "apiKey"), false, "control-plane state does not expose provider credentials");
    const providerId = addedProvider.id;

    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST",
      body: JSON.stringify({ action: "app:save-combo", payload: { name: "workspace-coding", strategy: "fallback", members: [{ providerId, model: "mock-large" }] } }),
    });
    const internal = await json(`http://127.0.0.1:${appPort}/api/providers`, token);
    assert.equal(internal.providers.length, 1);
    assert.equal(internal.providers[0].kind, "routing");

    await json(`http://127.0.0.1:${appPort}/api/setup/complete`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Routing test", terminals_enabled: false, provider_id: internal.providers[0].id, model: "workspace-coding" }),
    });
    const db = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
    const skipper = db.prepare("SELECT b.model,p.kind FROM bots b JOIN providers p ON p.id=b.provider_id WHERE b.name='skipper'").get();
    assert.equal(skipper.model, "workspace-coding");
    assert.equal(skipper.kind, "routing");
    const legacyBot = db.prepare("SELECT b.model,p.kind FROM bots b JOIN providers p ON p.id=b.provider_id WHERE b.name='legacy-agent'").get();
    assert.equal(legacyBot.model, "legacy-model");
    assert.equal(legacyBot.kind, "routing");
    db.close();

    const executablePath = browserExecutable();
    browser = executablePath ? await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }) : null;
    const page = browser ? await browser.newPage() : null;
    if (page) {
    await page.goto(`http://127.0.0.1:${appPort}`, { waitUntil: "domcontentloaded" });
    await page.evaluate((sessionToken) => localStorage.setItem("ctrl.token", sessionToken), token);
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector('button[title="Settings"]');
    await page.click('button[title="Settings"]');
    await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Providers")?.click());
    await page.waitForSelector('[data-provider-group-body="custom"]');
    await page.evaluate(() => document.querySelector('[data-provider-group-body="custom"]')?.parentElement?.querySelector(".routing-provider-head")?.click());
    const accountSelector = `[data-provider-account="${providerId}"]`;
    await page.waitForSelector(accountSelector);
    await page.$eval(`${accountSelector} .routing-account-head`, (button) => button.click());
    assert.equal(await page.$eval(`${accountSelector} [data-account-details]`, (element) => !element.classList.contains("hidden")), true);
    await page.$eval(`${accountSelector} [data-model-toggle]`, (input) => input.click());
    await page.waitForFunction((selector) => {
      const input = document.querySelector(`${selector} [data-model-toggle]`);
      return input && !input.disabled;
    }, {}, accountSelector);
    assert.equal(await page.$eval(`${accountSelector} [data-account-details]`, (element) => !element.classList.contains("hidden")), true, "individual model selection keeps the account editor open");
    await page.$eval(`${accountSelector} [data-models-all="off"]`, (button) => button.click());
    await page.waitForFunction((selector) => {
      const button = document.querySelector(`${selector} [data-models-all="off"]`);
      return button && !button.disabled;
    }, {}, accountSelector);
    assert.equal(await page.$eval(`${accountSelector} [data-account-details]`, (element) => !element.classList.contains("hidden")), true, "All off keeps the account editor open");
    assert.equal(await page.$$eval(`${accountSelector} [data-model-toggle]`, (inputs) => inputs.every((input) => !input.checked)), true);
    await page.$eval(`${accountSelector} [data-models-all="on"]`, (button) => button.click());
    await page.waitForFunction((selector) => {
      const button = document.querySelector(`${selector} [data-models-all="on"]`);
      return button && !button.disabled;
    }, {}, accountSelector);
    assert.equal(await page.$eval('[data-provider-group-body="custom"]', (element) => !element.classList.contains("hidden")), true, "bulk model changes keep the provider group open");
    assert.equal(await page.$$eval(`${accountSelector} [data-model-toggle]`, (inputs) => inputs.every((input) => input.checked)), true);

    const keyedForm = '[data-keyed-form="custom"]';
    const openCustomForm = async () => {
      await page.evaluate(() => {
        const body = document.querySelector('[data-provider-group-body="custom"]');
        [...(body?.querySelectorAll("button") || [])].find((button) => button.textContent?.trim() === "Add key")?.click();
      });
      await page.waitForSelector(keyedForm);
    };
    await openCustomForm();
    await page.$eval(`${keyedForm} [data-keyed-field="name"]`, (input) => { input.value = "Browser safe source"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.$eval(`${keyedForm} [data-keyed-field="base"]`, (input, value) => { input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true })); }, `http://127.0.0.1:${mockPort}`);
    await page.$eval(`${keyedForm} [data-keyed-field="key"]`, (input) => { input.value = "browser-one-time-secret"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.click(`${keyedForm} [data-keyed-action="test"]`);
    await page.waitForFunction((selector) => !document.querySelector(`${selector} [data-keyed-action="add"]`)?.disabled, {}, keyedForm);
    await page.$eval(`${keyedForm} [data-keyed-field="name"]`, (input) => { input.value += " edited"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.equal(await page.$eval(`${keyedForm} [data-keyed-action="add"]`, (button) => button.disabled), true, "changing tested fields invalidates the connection test");
    await page.click(`${keyedForm} [data-keyed-action="test"]`);
    await page.waitForFunction((selector) => !document.querySelector(`${selector} [data-keyed-action="add"]`)?.disabled, {}, keyedForm);
    let addRequests = 0;
    page.on("request", (request) => {
      if (!request.url().endsWith("/api/routing/action") || request.method() !== "POST") return;
      try { if (JSON.parse(request.postData() || "{}").action === "app:add-keyed-provider") addRequests += 1; } catch { /* ignore */ }
    });
    await page.$eval(`${keyedForm} [data-keyed-action="add"]`, (button) => { button.click(); button.click(); });
    await page.waitForFunction((selector) => !document.querySelector(selector), {}, keyedForm);
    assert.equal(addRequests, 1, "double-clicking Connect performs one add");
    assert.equal((await page.$eval("body", (body) => body.textContent || "")).includes("browser-one-time-secret"), false, "saved provider credentials are not echoed into the DOM");

    await openCustomForm();
    await page.$eval(`${keyedForm} [data-keyed-field="base"]`, (input, value) => { input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true })); }, `http://127.0.0.1:${mockPort}/no-models`);
    await page.$eval(`${keyedForm} [data-keyed-field="key"]`, (input) => { input.value = "exact-model-secret"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.$eval(`${keyedForm} [data-keyed-field="model"]`, (input) => { input.value = "mock-large"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.click(`${keyedForm} [data-keyed-action="test"]`);
    await page.waitForFunction((selector) => !document.querySelector(`${selector} [data-keyed-action="add"]`)?.disabled, {}, keyedForm);
    assert.match(await page.$eval(`${keyedForm} [data-keyed-status]`, (element) => element.textContent || ""), /1 model ready/);
    await page.$eval(`${keyedForm} [data-keyed-field="key"]`, (input) => { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.click(`${keyedForm} [data-keyed-action="test"]`);
    await page.waitForFunction((selector) => !document.querySelector(`${selector} [data-keyed-action="add"]`)?.disabled, {}, keyedForm);
    assert.match(await page.$eval(`${keyedForm} [data-keyed-status]`, (element) => element.textContent || ""), /1 model ready/);
    assert.equal(await page.$eval(`${keyedForm} [data-keyed-action="add"]`, (button) => button.disabled), false, "an empty custom API key remains a valid tested configuration");
    const liveCredentials = await json(`http://127.0.0.1:${appPort}/api/routing/credentials`, token);
    await json(`http://127.0.0.1:${appPort}/v1/chat/completions`, liveCredentials.apiKey, {
      method: "POST",
      body: JSON.stringify({ model: directModel, stream: false, messages: [{ role: "user", content: "Render this live" }] }),
    });
    await page.waitForFunction(() => /Test source/.test(document.querySelector(".routing-fabric")?.textContent || "") && /mock-large/.test(document.querySelector(".routing-fabric")?.textContent || ""));
    assert.equal(Boolean(await page.$(".routing-fabric")), true, "Sources renders real request routing activity in place from the workspace WebSocket");
    await browser.close(); browser = undefined;
    }

    state = await json(`http://127.0.0.1:${appPort}/api/routing/credentials`, token);
    const invalid = await fetch(`http://127.0.0.1:${appPort}/v1/models`);
    assert.equal(invalid.status, 401, "public endpoint requires a gateway key");
    const modelList = await json(`http://127.0.0.1:${appPort}/v1/models`, state.apiKey);
    assert(modelList.data.some((model) => model.id === "workspace-coding"));
    assert(modelList.data.some((model) => model.id === directModel));

    const directCompletion = await json(`http://127.0.0.1:${appPort}/v1/chat/completions`, state.apiKey, {
      method: "POST",
      body: JSON.stringify({ model: directModel, stream: false, messages: [{ role: "user", content: "Answer directly" }] }),
    });
    assert.match(directCompletion.choices[0].message.content, /Answer complete/);
    const noAuthModel = (await json(`http://127.0.0.1:${appPort}/api/routing/models`, token)).models.find((model) => model.providerName === "No auth source").id;
    const noAuthCompletion = await json(`http://127.0.0.1:${appPort}/v1/chat/completions`, state.apiKey, {
      method: "POST",
      body: JSON.stringify({ model: noAuthModel, stream: false, messages: [{ role: "user", content: "No auth please" }] }),
    });
    assert.match(noAuthCompletion.choices[0].message.content, /Answer complete/, "custom endpoint requests omit Authorization when its key is empty");

    const completion = await json(`http://127.0.0.1:${appPort}/v1/chat/completions`, state.apiKey, {
      method: "POST",
      body: JSON.stringify({ model: "workspace-coding", stream: false, messages: [{ role: "user", content: "Answer briefly" }] }),
    });
    assert.match(completion.choices[0].message.content, /Answer complete/);
    const activity = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:usage", payload: "all" }),
    });
    assert(activity.usage.requests >= 3, "direct, unauthenticated, and named-route requests are recorded in usage");
    assert.equal(activity.usage.recent[0].model, "workspace-coding");

    const addSource = async (name, baseUrl, models = [{ id: "mock-large", name: "mock-large", enabled: true }]) => {
      const result = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
        method: "POST",
        body: JSON.stringify({ action: "app:add-keyed-provider", payload: { name, baseUrl, apiKey: "mock-key", models } }),
      });
      return result.id;
    };
    const failingProvider = await addSource("Always fail", `http://127.0.0.1:${mockPort}/always-fail`);
    const backupProvider = await addSource("Fallback backup", `http://127.0.0.1:${mockPort}/fallback-backup`);
    const roundA = await addSource("Round A", `http://127.0.0.1:${mockPort}/round-a`);
    const roundB = await addSource("Round B", `http://127.0.0.1:${mockPort}/round-b`);

    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:save-combo", payload: { name: "fallback-contract", strategy: "fallback", members: [{ providerId: failingProvider, model: "mock-large" }, { providerId: backupProvider, model: "mock-large" }] } }),
    });
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:save-combo", payload: { name: "round-contract", strategy: "round-robin", members: [{ providerId: roundA, model: "mock-large" }, { providerId: roundB, model: "mock-large" }] } }),
    });
    const fallbackCompletion = await json(`http://127.0.0.1:${appPort}/v1/chat/completions`, state.apiKey, {
      method: "POST", body: JSON.stringify({ model: "fallback-contract", stream: false, messages: [{ role: "user", content: "fallback" }] }),
    });
    assert.match(fallbackCompletion.choices[0].message.content, /fallback-backup/, "fallback routes advance to the next real upstream after a retryable failure");
    const roundResults = [];
    for (let index = 0; index < 3; index++) {
      const result = await json(`http://127.0.0.1:${appPort}/v1/chat/completions`, state.apiKey, {
        method: "POST", body: JSON.stringify({ model: "round-contract", stream: false, messages: [{ role: "user", content: `round ${index}` }] }),
      });
      roundResults.push(result.choices[0].message.content);
    }
    assert.deepEqual(roundResults.map((content) => /round-a/.test(content) ? "a" : /round-b/.test(content) ? "b" : "?"), ["a", "b", "a"], "round-robin rotates real upstream starting points");

    let controlState = await json(`http://127.0.0.1:${appPort}/api/routing/state`, token);
    const roundRoute = controlState.combos.find((combo) => combo.name === "round-contract");
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:save-combo", payload: { id: roundRoute.id, name: "round-contract-edited", strategy: "fallback", members: roundRoute.members } }),
    });
    controlState = await json(`http://127.0.0.1:${appPort}/api/routing/state`, token);
    assert.equal(controlState.combos.some((combo) => combo.name === "round-contract-edited" && combo.strategy === "fallback"), true, "routes can be edited in place");
    const editedRoundRoute = controlState.combos.find((combo) => combo.name === "round-contract-edited");
    await json(`http://127.0.0.1:${appPort}/api/workspace/model-policy`, token, {
      method: "PATCH", body: JSON.stringify({ model: editedRoundRoute.name }),
    });
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:delete-combo", payload: editedRoundRoute.id }),
    });
    assert.equal((await json(`http://127.0.0.1:${appPort}/api/routing/state`, token)).combos.some((combo) => combo.name === "round-contract-edited"), false, "routes can be deleted");
    const reconciledWorkspace = await json(`http://127.0.0.1:${appPort}/api/workspace/model-policy`, token);
    assert.notEqual(reconciledWorkspace.model, editedRoundRoute.name, "deleting a selected route immediately reconciles stale workspace and agent policy");
    assert(reconciledWorkspace.models.some((model) => model.id === reconciledWorkspace.model), "reconciled model policy always names a live catalog entry");

    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:set-provider-enabled", payload: { id: backupProvider, enabled: false } }),
    });
    assert.equal((await json(`http://127.0.0.1:${appPort}/api/routing/state`, token)).providers.find((provider) => provider.id === backupProvider).enabled, false, "providers can be disabled");
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:set-provider-enabled", payload: { id: backupProvider, enabled: true } }),
    });
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:set-model-enabled", payload: { providerId: backupProvider, modelId: "mock-large", enabled: false } }),
    });
    assert.equal((await json(`http://127.0.0.1:${appPort}/api/routing/state`, token)).providers.find((provider) => provider.id === backupProvider).models.find((model) => model.id === "mock-large").enabled, false, "individual models can be disabled");
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:set-all-models-enabled", payload: { providerId: backupProvider, enabled: true } }),
    });
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:add-model", payload: { providerId: backupProvider, modelId: "mock-extra" } }),
    });
    assert.equal((await json(`http://127.0.0.1:${appPort}/api/routing/state`, token)).providers.find((provider) => provider.id === backupProvider).models.some((model) => model.id === "mock-extra"), true, "an exact model can be tested and added");
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:remove-model", payload: { providerId: backupProvider, modelId: "mock-extra" } }),
    });
    assert.equal((await json(`http://127.0.0.1:${appPort}/api/routing/state`, token)).providers.find((provider) => provider.id === backupProvider).models.some((model) => model.id === "mock-extra"), false, "models can be removed through the control plane");

    const quotaGet = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, { method: "POST", body: JSON.stringify({ action: "app:quota-get" }) });
    const quotaRefresh = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, { method: "POST", body: JSON.stringify({ action: "app:quota-refresh" }) });
    assert(Array.isArray(quotaGet.quota.accounts) && Array.isArray(quotaRefresh.quota.accounts), "quota read and refresh return the native account shape");
    const logsBeforeClear = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, { method: "POST", body: JSON.stringify({ action: "app:logs-get", payload: 300 }) });
    assert(logsBeforeClear.entries.length > 0, "routing and OAuth activity is visible in Logs");
    assert.equal(JSON.stringify(logsBeforeClear).includes("mock-key"), false, "Logs redact provider credentials");
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, { method: "POST", body: JSON.stringify({ action: "app:logs-clear" }) });
    const logsAfterClear = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, { method: "POST", body: JSON.stringify({ action: "app:logs-get", payload: 300 }) });
    assert.equal(logsAfterClear.entries.some((entry) => entry.msg !== "Logs cleared by user"), false, "Logs can be cleared from 1Helm");

    const migrationSnapshot = JSON.stringify(JSON.parse(readFileSync(join(dataDir, "routing", "config.json"), "utf8")).providers.filter((provider) => String(provider.importSource || "").startsWith("1helm-legacy:")));
    const migrationRoutes = (await json(`http://127.0.0.1:${appPort}/api/routing/state`, token)).combos.filter((combo) => combo.name === "legacy-model").length;

    let routingConfig = JSON.parse(readFileSync(join(dataDir, "routing", "config.json"), "utf8"));
    assert.equal(routingConfig.onboardingComplete, true);
    assert.equal(routingConfig.providers.find((provider) => provider.name === "Test source").apiKey, "mock-key", "credentials persist in the 1Helm-owned routing directory");

    const residentTurn = async (marker) => {
      const channels = await json(`http://127.0.0.1:${appPort}/api/channels`, token);
      const main = channels.channels.find((channel) => channel.name === "main");
      assert(main, "setup creates the resident-agent main channel");
      const posted = await json(`http://127.0.0.1:${appPort}/api/channels/${main.id}/messages`, token, {
        method: "POST", body: JSON.stringify({ body: `@skipper ${marker}. Reply briefly.` }),
      });
      return waitUntil(async () => {
        const thread = await json(`http://127.0.0.1:${appPort}/api/messages/${posted.message.id}/thread`, token);
        return thread.replies.find((reply) => reply.author?.kind === "bot" && /Answer complete/.test(reply.body || ""));
      }, 20_000);
    };

    const initialCredentials = await json(`http://127.0.0.1:${appPort}/api/routing/credentials`, token);
    const createdExternal = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:create-api-key", payload: "Temporary external" }),
    });
    const externalKeys = [...initialCredentials.apiKeys, createdExternal.key];
    routingConfig = JSON.parse(readFileSync(join(dataDir, "routing", "config.json"), "utf8"));
    const internalKey = routingConfig.apiKeys.find((entry) => entry.scope === "1helm-internal");
    assert(internalKey?.enabled, "a durable private workspace credential exists and stays enabled");
    assert.equal(externalKeys.some((entry) => entry.id === internalKey.id || entry.key === internalKey.key), false, "the private credential is absent from Captain Endpoint credentials and key mutations");
    for (const entry of externalKeys) {
      await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
        method: "POST", body: JSON.stringify({ action: "app:set-api-key-enabled", payload: { id: entry.id, enabled: false } }),
      });
      assert.equal((await fetch(`http://127.0.0.1:${appPort}/v1/models`, { headers: { authorization: `Bearer ${entry.key}` } })).status, 401);
    }
    let credentials = await json(`http://127.0.0.1:${appPort}/api/routing/credentials`, token);
    assert.equal(credentials.apiKey, "", "disabling every external key leaves no public primary key");
    assert.equal(JSON.stringify(credentials).includes(internalKey.key), false, "the private credential is not serialized by the credentials endpoint");
    assert(await residentTurn("INTERNAL_AUTH_DISABLED_KEYS"), "resident agents still use routed models while every external key is disabled");

    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:set-api-key-enabled", payload: { id: createdExternal.key.id, enabled: true } }),
    });
    assert((await json(`http://127.0.0.1:${appPort}/v1/models`, createdExternal.key.key)).data.length, "re-enabling an external key restores public access");
    for (const entry of externalKeys) {
      await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
        method: "POST", body: JSON.stringify({ action: "app:revoke-api-key", payload: entry.id }),
      });
    }
    credentials = await json(`http://127.0.0.1:${appPort}/api/routing/credentials`, token);
    assert.deepEqual(credentials.apiKeys, [], "revoking every external key does not expose or replace the private credential");
    assert.equal((await fetch(`http://127.0.0.1:${appPort}/v1/models`, { headers: { authorization: `Bearer ${createdExternal.key.key}` } })).status, 401);
    assert(await residentTurn("INTERNAL_AUTH_REVOKED_KEYS"), "resident agents remain online after every external key is revoked");

    app.kill("SIGTERM");
    await new Promise((resolve) => app.once("exit", resolve));
    app = start(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
      CTRL_DATA_DIR: dataDir,
      PORT: String(appPort),
      HELM_ROUTER_PORT: String(routerPort),
    });
    await waitFor(`http://127.0.0.1:${appPort}/api/setup/status`);
    credentials = await json(`http://127.0.0.1:${appPort}/api/routing/credentials`, token);
    assert.deepEqual(credentials.apiKeys, [], "restart preserves an intentionally empty external key set");
    routingConfig = JSON.parse(readFileSync(join(dataDir, "routing", "config.json"), "utf8"));
    assert.equal(routingConfig.apiKeys.find((entry) => entry.scope === "1helm-internal")?.key, internalKey.key, "restart preserves the same private credential");
    assert.equal(JSON.stringify(routingConfig.providers.filter((provider) => String(provider.importSource || "").startsWith("1helm-legacy:"))), migrationSnapshot, "legacy provider migration is idempotent after restart");
    assert.equal((await json(`http://127.0.0.1:${appPort}/api/routing/state`, token)).combos.filter((combo) => combo.name === "legacy-model").length, migrationRoutes, "legacy compatibility routes are not duplicated after restart");
    assert(await residentTurn("INTERNAL_AUTH_AFTER_RESTART"), "resident agents retain routed model access after restart");
    const replacementExternal = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:create-api-key", payload: "Replacement external" }),
    });
    assert((await json(`http://127.0.0.1:${appPort}/v1/models`, replacementExternal.key.key)).data.length, "a new external key restores public access after restart");
    assert.equal(JSON.stringify(await json(`http://127.0.0.1:${appPort}/api/routing/state`, token)).includes(internalKey.key), false, "routine state never returns the private credential");
    const originalBind = (await json(`http://127.0.0.1:${appPort}/api/routing/credentials`, token)).bindHost;
    const changedBind = originalBind === "0.0.0.0" ? "127.0.0.1" : "0.0.0.0";
    assert.equal((await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, { method: "POST", body: JSON.stringify({ action: "app:set-bind-host", payload: changedBind }) })).bindHost, changedBind, "bind-host mutation restarts the embedded gateway");
    assert.equal((await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, { method: "POST", body: JSON.stringify({ action: "app:set-bind-host", payload: originalBind }) })).bindHost, originalBind, "bind-host is restored after the contract test");
  } catch (error) {
    error.message += `\nchild output:\n${logs.join("").slice(-12_000)}`;
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) {
      if (child.exitCode == null) child.kill("SIGTERM");
      if (child.exitCode == null) await new Promise((resolve) => child.once("exit", resolve)).catch(() => undefined);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
