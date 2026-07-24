import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const root = process.cwd();
const dataDir = join(root, ".native-test-data", `feedback-browser-${process.pid}`);
const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const waitFor = async (fn, label, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

test("Feedback button saves a real report and the admin inbox shows it", async (t) => {
  rmSync(dataDir, { recursive: true, force: true });
  const appPort = await freePort();
  const providerPort = await freePort();
  const collectorPort = await freePort();
  const base = `http://127.0.0.1:${appPort}`;
  const collector = createHttpServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: payload.public_id }));
    });
  });
  await new Promise((resolve) => collector.listen(collectorPort, "127.0.0.1", resolve));
  const provider = spawn(process.execPath, ["test/mock-openai.mjs", String(providerPort)], { cwd: root, stdio: "ignore" });
  const app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      CTRL_DATA_DIR: dataDir,
      PORT: String(appPort),
      HELM_CHANNEL_COMPUTER_BACKEND: "native",
      HELM_FEEDBACK_URL: `http://127.0.0.1:${collectorPort}/v1/feedback`,
      IMPROVEMENT_INTERVAL_MS: "600000",
    },
    stdio: "ignore",
  });
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  t.after(async () => {
    await browser.close().catch(() => undefined);
    app.kill("SIGTERM");
    provider.kill("SIGTERM");
    await new Promise((resolve) => collector.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${providerPort}/v1/models`).catch(() => null))?.ok, "mock provider");
  await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "1Helm server");
  const api = async (path, options = {}, token = "") => {
    const response = await fetch(base + path, {
      method: options.method || (options.body !== undefined ? "POST" : "GET"),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json();
    assert.equal(response.ok, true, `${path}: ${payload.error || response.status}`);
    return payload;
  };
  const registration = await api("/api/auth/register", { body: { username: "captain", password: "secret-pass", display: "Captain" } });
  const token = registration.token;
  const providerRecord = await api("/api/providers", { body: { name: "Mock", base_url: `http://127.0.0.1:${providerPort}/v1`, api_key: "test" } }, token);
  await api("/api/setup/complete", { body: { name: "Feedback Test", terminals_enabled: true, provider_id: providerRecord.provider.id, model: "mock-large" } }, token);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate((value) => localStorage.setItem("ctrl.token", value), token);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("[data-feedback-action]");
  await page.click("[data-feedback-action]");
  await page.waitForSelector('#feedback-modal[aria-label="Send feedback"]');
  await page.type("[data-feedback-comment]", "The feedback button now reaches a durable report.");
  const diagnosticsDefault = await page.$eval("[data-feedback-diagnostics]", (input) => input.checked);
  assert.equal(diagnosticsDefault, false, "diagnostics default to opt-in");
  await page.click("[data-feedback-submit]");
  await page.waitForFunction(() => /Saved as fb_/.test(document.querySelector("[data-feedback-status]")?.textContent || ""));
  const reports = await waitFor(async () => {
    const result = await api("/api/feedback", {}, token);
    return result.reports?.length ? result.reports : null;
  }, "durable feedback row");
  assert.equal(reports[0].comment, "The feedback button now reaches a durable report.");
  assert.deepEqual(reports[0].diagnostics, {});

  await page.waitForSelector("#feedback-modal", { hidden: true });
  await page.click('[aria-label="Open settings"]');
  await page.waitForSelector('nav[aria-label="Settings sections"]');
  await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Settings sections"] button')]
    .find((button) => button.textContent?.trim() === "Feedback")?.click());
  await page.waitForSelector("[data-feedback-inbox]");
  await page.waitForFunction(() => document.querySelector("[data-feedback-inbox]")?.textContent?.includes("The feedback button now reaches a durable report."));
  assert.ok(await page.$(`[data-feedback-report="${reports[0].public_id}"]`));

  // Keep the Skills control plane open while Skipper creates a new skill. The
  // WebSocket event must invalidate the view; no page reload or tab hop is used.
  await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Settings sections"] button')]
    .find((button) => button.textContent?.trim() === "Skills")?.click());
  await page.waitForSelector('article[data-skill-slug="outcome-ownership"]');
  await api("/api/skills/learn", { body: { notes: "Turn this UI refresh evidence into a reusable incident postmortem skill." } }, token);
  await waitFor(async () => (await api("/api/skills", {}, token)).skills?.find((skill) => skill.slug === "incident-postmortem"), "new skill in authoritative arsenal");
  await page.waitForSelector('article[data-skill-slug="incident-postmortem"]', { timeout: 10_000 });

  // Assignment must likewise repaint an already-open channel Settings surface.
  const main = (await api("/api/channels", {}, token)).channels.find((channel) => channel.name === "main" && channel.kind === "channel");
  assert.ok(main?.agent?.id);
  await page.goto(`${base}/c/main/settings`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-assigned-skills]");
  assert.equal(await page.$('[data-assigned-skill="incident-postmortem"]'), null);
  await api(`/api/agents/${main.agent.id}/skills`, { body: { skill: "incident-postmortem", reason: "Live invalidation browser test." } }, token);
  await page.waitForSelector('[data-assigned-skill="incident-postmortem"]', { timeout: 10_000 });
});
