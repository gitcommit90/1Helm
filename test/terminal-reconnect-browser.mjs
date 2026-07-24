import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import puppeteer from "puppeteer";

const root = new URL("..", import.meta.url).pathname;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(() => resolve(port));
  });
});
const waitFor = async (fn, label, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch (error) { last = error; }
    await sleep(100);
  }
  throw last instanceof Error ? last : new Error(`Timed out waiting for ${label}`);
};

test("browser silently reconnects a dropped terminal socket to the same live shell", { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "1helm-terminal-reconnect-"));
  const appPort = await freePort();
  const mockPort = await freePort();
  const base = `http://127.0.0.1:${appPort}`;
  const children = [];
  let browser;
  const start = (args, env = {}) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: "ignore" });
    children.push(child);
    return child;
  };
  const api = async (path, token = "", body) => {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    assert.equal(response.ok, true, `${path}: ${result.error || response.status}`);
    return result;
  };

  try {
    start(["test/mock-openai.mjs", String(mockPort)]);
    await waitFor(async () => (await fetch(`http://127.0.0.1:${mockPort}/v1/models`).catch(() => null))?.ok, "mock provider");
    start(["--disable-warning=ExperimentalWarning", "src/server/index.ts"], { CTRL_DATA_DIR: dataDir, PORT: String(appPort), IMPROVEMENT_INTERVAL_MS: "600000" });
    await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "1Helm server");

    const registration = await api("/api/auth/register", "", { username: "captain", password: "secret-pass", display: "Captain" });
    const provider = await api("/api/providers", registration.token, { name: "Mock", base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: "test" });
    await api("/api/setup/complete", registration.token, { name: "Reconnect Test", terminals_enabled: true, provider_id: provider.provider.id, model: "mock-large" });
    const channel = (await api("/api/channels", registration.token, { name: "terminal-reconnect", purpose: "Prove terminal session continuity." })).channel;

    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      const NativeWebSocket = window.WebSocket;
      window.__terminalTestSockets = [];
      function TrackedWebSocket(...args) {
        const socket = new NativeWebSocket(...args);
        window.__terminalTestSockets.push(socket);
        return socket;
      }
      TrackedWebSocket.prototype = NativeWebSocket.prototype;
      for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Object.defineProperty(TrackedWebSocket, key, { value: NativeWebSocket[key] });
      window.WebSocket = TrackedWebSocket;
    });
    await page.goto(base, { waitUntil: "networkidle0" });
    await page.evaluate((token) => localStorage.setItem("ctrl.token", token), registration.token);
    await page.goto(`${base}/c/${channel.slug}/terminal`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.querySelector(".xterm")?.parentElement?.dataset.connection === "connected");
    const sessionId = await page.$eval(".xterm", (terminal) => terminal.parentElement.dataset.sessionId);

    await page.click(".xterm-screen");
    await page.keyboard.type("export HELM_RECONNECT_PROOF=same-shell; cd /tmp; echo BEFORE-$HELM_RECONNECT_PROOF");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /BEFORE-same-shell/.test(document.querySelector(".xterm-rows")?.textContent || ""));

    const socketCount = await page.evaluate(() => {
      const sockets = window.__terminalTestSockets.filter((socket) => socket.url.includes("/ws/term/"));
      const active = sockets.at(-1);
      if (!active) return 0;
      active.close(4001, "test transport interruption");
      return sockets.length;
    });
    assert.ok(socketCount >= 1, "the test observed the real terminal WebSocket");
    await page.waitForFunction((priorCount) => window.__terminalTestSockets.filter((socket) => socket.url.includes("/ws/term/")).length > priorCount, {}, socketCount);
    await page.waitForFunction(() => document.querySelector(".xterm")?.parentElement?.dataset.connection === "connected");

    const reconnectedSessionId = await page.$eval(".xterm", (terminal) => terminal.parentElement.dataset.sessionId);
    assert.equal(reconnectedSessionId, sessionId, "reconnect reused the exact server terminal session");
    await page.click(".xterm-screen");
    await page.keyboard.type("echo AFTER-$HELM_RECONNECT_PROOF-$(pwd)");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /AFTER-same-shell-\/tmp/.test(document.querySelector(".xterm-rows")?.textContent || ""));
    assert.equal(await page.$eval(".xterm", (terminal) => /terminal disconnected/i.test(terminal.textContent || "")), false, "no disconnect noise was printed into the shell");
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children) if (child.exitCode == null) child.kill("SIGTERM");
    await sleep(200);
    for (const child of children) if (child.exitCode == null) child.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
