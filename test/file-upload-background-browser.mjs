import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import puppeteer from "puppeteer";

const root = new URL("..", import.meta.url).pathname;
async function browserExecutable() {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured) {
    try { accessSync(configured, fsConstants.X_OK); return configured; } catch { /* use discovery */ }
  }
  try {
    const bundled = await puppeteer.executablePath();
    accessSync(bundled, fsConstants.X_OK);
    return bundled;
  } catch { /* no bundled browser */ }
  for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
    try { accessSync(candidate, fsConstants.X_OK); return candidate; } catch { /* try next */ }
  }
  return null;
}

const executablePath = await browserExecutable();
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

test("resident Files upload survives cross-channel navigation with global progress", {
  timeout: 45_000,
  skip: executablePath ? false : "No local Chrome executable; source and upload destination contracts still run independently.",
}, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "1helm-background-upload-"));
  const appPort = await freePort();
  const mockPort = await freePort();
  const base = `http://127.0.0.1:${appPort}`;
  const children = [];
  let browser;
  let releaseUpload;
  const uploadRelease = new Promise((resolve) => { releaseUpload = resolve; });
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
    start(["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
      CTRL_DATA_DIR: dataDir,
      PORT: String(appPort),
      IMPROVEMENT_INTERVAL_MS: "600000",
      NODE_ENV: "test",
      HELM_CHANNEL_COMPUTER_BACKEND: "native",
    });
    await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "1Helm server");

    const registration = await api("/api/auth/register", "", { username: "captain", password: "secret-pass", display: "Captain" });
    const provider = await api("/api/providers", registration.token, { name: "Mock", base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: "test" });
    await api("/api/setup/complete", registration.token, { name: "Upload Test", terminals_enabled: true, provider_id: provider.provider.id, model: "mock-large" });
    const main = (await api("/api/channels", registration.token)).channels.find((channel) => channel.name === "main");
    const uploadChannel = (await api("/api/channels", registration.token, { name: "Upload lane", purpose: "Own upload continuity." })).channel;
    const uploadPath = join(dataDir, "background-upload.txt");
    writeFileSync(uploadPath, "background upload remains alive\n".repeat(4096));

    browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(base, { waitUntil: "networkidle0" });
    await page.evaluate((token) => localStorage.setItem("ctrl.token", token), registration.token);
    await page.goto(`${base}/c/${uploadChannel.slug}/files`, { waitUntil: "networkidle0" });
    const fileInput = await page.waitForSelector('#channelview input[type="file"]');

    let markUploadIntercepted;
    const uploadIntercepted = new Promise((resolve) => { markUploadIntercepted = resolve; });
    const interceptUpload = (request) => {
      if (request.url() === `${base}/api/upload` && request.method() === "POST") {
        markUploadIntercepted();
        void uploadRelease.then(() => request.continue());
        return;
      }
      void request.continue();
    };
    await page.setRequestInterception(true);
    page.on("request", interceptUpload);
    await fileInput.uploadFile(uploadPath);
    await uploadIntercepted;
    await page.click(`[data-continuity-key="sidebar-desktop-channel-${main.id}"]`);
    await page.waitForSelector('[data-resident-upload-indicator] [data-resident-upload-state="uploading"]');
    const active = await page.$eval('[data-resident-upload-indicator]', (node) => node.textContent || "");
    assert.match(active, /Uploading 1 of 1/);
    assert.match(active, /background-upload\.txt/);
    assert.match(active, new RegExp(`#${uploadChannel.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

    releaseUpload();
    await page.waitForSelector('[data-resident-upload-indicator] [data-resident-upload-state="complete"]', { timeout: 5_000 });
    const finished = await page.$eval('[data-resident-upload-indicator]', (node) => node.textContent || "");
    assert.match(finished, /Uploaded 1 item/);
    assert.match(finished, /Finished/);
    await waitFor(async () => (await api(`/api/channels/${uploadChannel.id}/files?path=`, registration.token)).files?.some((file) => file.name === "background-upload.txt"), "backgrounded upload import");
    page.off("request", interceptUpload);
    await page.setRequestInterception(false);
  } finally {
    releaseUpload?.();
    await browser?.close().catch(() => undefined);
    for (const child of children) if (child.exitCode == null) child.kill("SIGTERM");
    await sleep(200);
    for (const child of children) if (child.exitCode == null) child.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
