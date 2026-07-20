import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL("..", import.meta.url).pathname;

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

test("embedded provider fabric powers 1Helm agents and its public endpoint", { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "1helm-routing-test-"));
  const appPort = await freePort();
  const routerPort = await freePort();
  const mockPort = await freePort();
  const children = [];
  const logs = [];
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
      });
    `], { cwd: ROOT, env: { ...process.env, CTRL_DATA_DIR: dataDir }, encoding: "utf8" });
    assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout);
    start(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
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

    const oauthStarted = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:oauth-start", payload: "chatgpt" }),
    });
    assert.equal(oauthStarted.ok, true);
    assert.match(oauthStarted.authUrl, /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
    const oauthStatus = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:oauth-status", payload: "chatgpt" }),
    });
    assert.equal(oauthStatus.active, true);
    await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:oauth-cancel", payload: "chatgpt" }),
    });

    const tested = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST",
      body: JSON.stringify({ action: "app:test-keyed-provider", payload: { providerType: "openai-compat", baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: "mock-key" } }),
    });
    assert.equal(tested.ok, true);
    assert.deepEqual(tested.models.map((model) => model.id), ["mock-large", "mock-small"]);

    const added = await json(`http://127.0.0.1:${appPort}/api/providers`, token, {
      method: "POST",
      body: JSON.stringify({ name: "Test source", base_url: `http://127.0.0.1:${mockPort}`, api_key: "mock-key" }),
    });
    assert.equal(added.provider.kind, "routing");
    assert(added.models.some((model) => model.name === "mock-large" && model.id !== "mock-large"), "onboarding receives collision-safe routed model IDs for custom sources");
    const directModel = added.models.find((model) => model.name === "mock-large").id;
    let state = await json(`http://127.0.0.1:${appPort}/api/routing/state`, token);
    assert.equal(Object.hasOwn(state, "apiKeys"), false, "routine control-plane state omits gateway credentials");
    assert.equal(state.providers.length, 2);
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

    const completion = await json(`http://127.0.0.1:${appPort}/v1/chat/completions`, state.apiKey, {
      method: "POST",
      body: JSON.stringify({ model: "workspace-coding", stream: false, messages: [{ role: "user", content: "Answer briefly" }] }),
    });
    assert.match(completion.choices[0].message.content, /Answer complete/);
    const activity = await json(`http://127.0.0.1:${appPort}/api/routing/action`, token, {
      method: "POST", body: JSON.stringify({ action: "app:usage", payload: "all" }),
    });
    assert.equal(activity.usage.requests, 2);
    assert.equal(activity.usage.recent[0].model, "workspace-coding");

    const routingConfig = JSON.parse(readFileSync(join(dataDir, "routing", "config.json"), "utf8"));
    assert.equal(routingConfig.onboardingComplete, true);
    assert.equal(routingConfig.providers.find((provider) => provider.name === "Test source").apiKey, "mock-key", "credentials persist in the 1Helm-owned routing directory");
  } catch (error) {
    error.message += `\nchild output:\n${logs.join("").slice(-12_000)}`;
    throw error;
  } finally {
    for (const child of children.reverse()) {
      if (child.exitCode == null) child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve)).catch(() => undefined);
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
