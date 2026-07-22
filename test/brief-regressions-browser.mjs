import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { rmSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

const root = process.cwd();
const dataDir = join(root, ".native-test-data", `brief-browser-${process.pid}`);
const freePort = () => new Promise((resolve, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (fn, label, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch { /* retry */ } await sleep(100); }
  throw new Error(`Timed out waiting for ${label}`);
};
const appPort = await freePort();
const mockPort = await freePort();
const base = `http://127.0.0.1:${appPort}`;
let app; let mock; let browser; let pass = 0; let fail = 0;
const ok = (condition, label) => { if (!condition) throw new Error(label); pass++; console.log("  ok  -", label); };
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

try {
  rmSync(dataDir, { recursive: true, force: true });
  mock = spawn(process.execPath, ["test/mock-openai.mjs", String(mockPort)], { cwd: root, stdio: "ignore" });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${mockPort}/v1/models`).catch(() => null))?.ok, "mock provider");
  app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
    cwd: root, env: { ...process.env, CTRL_DATA_DIR: dataDir, PORT: String(appPort), IMPROVEMENT_INTERVAL_MS: "600000" }, stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "app");
  const registration = await api("/api/auth/register", { body: { username: "captain", password: "secret-pass", display: "Captain" } });
  const token = registration.token;
  const provider = await api("/api/providers", { body: { name: "Mock", base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: "test" } }, token);
  await api("/api/setup/complete", { body: { name: "Browser Brief", terminals_enabled: true, provider_id: provider.provider.id, model: "mock-large" } }, token);
  const channel = (await api("/api/channels", { body: { name: "Visual", purpose: "Exercise the brief regressions." } }, token)).channel;
  const rootMessage = (await api(`/api/channels/${channel.id}/messages`, { body: { body: `@${channel.agent.name} run whoami` } }, token)).message;
  await waitFor(async () => {
    const thread = await api(`/api/messages/${rootMessage.id}/thread`, {}, token);
    return thread.replies?.find((reply) => reply.author.name === channel.agent.name && /Answer complete/.test(reply.body || ""));
  }, "agent reply");
  for (let index = 0; index < 10; index++) {
    await api(`/api/channels/${channel.id}/messages`, { body: { body: `Scroll fixture ${index + 1}: ${"stable viewport words ".repeat(32)}`, parentId: rootMessage.id } }, token);
  }

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate((value) => localStorage.setItem("ctrl.token", value), token);
  await page.goto(`${base}/c/${channel.slug}/thread/${rootMessage.id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#thread:not(.hidden)");
  const brand = await page.evaluate(() => ({
    title: document.title,
    body: document.body.innerText,
    appName: document.querySelector('meta[name="application-name"]')?.getAttribute("content"),
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute("href"),
    workspaceLogo: document.querySelector(".logo-asset")?.getAttribute("src"),
  }));
  ok(brand.title.includes("1Helm") && brand.appName === "1Helm" && !brand.body.includes("1Herd"), "the browser presents the product as 1Helm throughout");
  ok(brand.favicon === "/brand/1helm.png" && brand.workspaceLogo === "/brand/1helm.png", "the app logo is the web favicon and default customizable workspace image");
  const initialWidth = await page.$eval("#thread", (element) => element.getBoundingClientRect().width);
  ok(initialWidth >= 500, "thread panel opens at the wider default size");
  const handle = await page.$(".thread-resizer");
  const handleBox = await handle.boundingBox();
  await page.mouse.move(handleBox.x + 4, handleBox.y + 180);
  await page.mouse.down(); await page.mouse.move(handleBox.x - 90, handleBox.y + 180, { steps: 5 }); await page.mouse.up();
  const resizedWidth = await page.$eval("#thread", (element) => element.getBoundingClientRect().width);
  const storedWidth = await page.evaluate(() => Number(localStorage.getItem("1helm.threadWidth.1")));
  ok(resizedWidth > initialWidth + 50 && storedWidth === Math.round(resizedWidth), "thread panel is draggable and persists its user-scoped width");
  const modelPickers = await page.$$(".model-picker-button");
  ok(modelPickers.length === 2, "both the channel and thread input boxes expose a model picker beside Send");
  ok(Boolean(await page.$("details.agent-progress")), "agent progress is available from a collapsible disclosure");

  const streamState = await page.evaluate((parentId) => {
    const input = document.querySelector(`textarea[data-composer-parent="${parentId}"]`);
    const scroller = document.getElementById("threadmsgs");
    if (!input || !scroller) return null;
    scroller.scrollTop = Math.max(1, Math.floor((scroller.scrollHeight - scroller.clientHeight) / 2));
    window.__briefThreadComposer = input;
    return { scrollTop: scroller.scrollTop, maxScroll: scroller.scrollHeight - scroller.clientHeight };
  }, rootMessage.id);
  ok(streamState?.maxScroll > 100 && streamState.scrollTop > 0, "thread fixture provides a real mid-history scroll position");
  const threadComposer = await page.$(`textarea[data-composer-parent="${rootMessage.id}"]`);
  await threadComposer.type(`@${channel.agent.name} live-ui-stream`);
  await threadComposer.press("Enter");
  await sleep(25);
  const clearedImmediately = await page.evaluate((parentId) => {
    const input = document.querySelector(`textarea[data-composer-parent="${parentId}"]`);
    return input === window.__briefThreadComposer && input?.value === "";
  }, rootMessage.id);
  ok(clearedImmediately, "thread composer clears synchronously when Send is pressed");
  await threadComposer.type("draft remains focused during stream");
  await page.evaluate((parentId) => {
    const input = document.querySelector(`textarea[data-composer-parent="${parentId}"]`);
    input.focus(); input.setSelectionRange(6, 13);
  }, rootMessage.id);
  await page.waitForFunction(() => document.getElementById("threadmsgs")?.innerText.includes("Live stream update"), { timeout: 5000 });
  await sleep(450);
  const stableStream = await page.evaluate(({ parentId, priorTop }) => {
    const input = document.querySelector(`textarea[data-composer-parent="${parentId}"]`);
    const scroller = document.getElementById("threadmsgs");
    return {
      sameNode: input === window.__briefThreadComposer,
      connected: input?.isConnected,
      focused: document.activeElement === input,
      value: input?.value,
      selectionStart: input?.selectionStart,
      selectionEnd: input?.selectionEnd,
      scrollTop: scroller?.scrollTop,
      priorTop,
      visible: scroller?.innerText.includes("Live stream update"),
    };
  }, { parentId: rootMessage.id, priorTop: streamState.scrollTop });
  ok(stableStream.sameNode && stableStream.connected && stableStream.focused
    && stableStream.value === "draft remains focused during stream"
    && stableStream.selectionStart === 6 && stableStream.selectionEnd === 13
    && Math.abs(stableStream.scrollTop - stableStream.priorTop) <= 1 && stableStream.visible,
  "streaming agent updates preserve the exact focused composer, selection, draft, and scroll position");
  await waitFor(async () => {
    const thread = await api(`/api/messages/${rootMessage.id}/thread`, {}, token);
    return thread.replies?.find((reply) => /Live stream update[\s\S]*Answer complete/.test(reply.body || ""));
  }, "live UI stream completion");

  const rootComposer = await page.$('textarea[data-composer-parent="root"]');
  await rootComposer.type("draft survives navigation");
  await page.evaluate(() => [...document.querySelectorAll("nav button")].find((button) => button.textContent.includes("Files"))?.click());
  await page.waitForSelector("#channelview");
  const fileInput = await page.waitForSelector('#channelview input[type="file"]');
  await fileInput.uploadFile(join(root, "README.md"));
  await page.waitForFunction(() => document.getElementById("channelview")?.innerText.includes("/files/README.md"), { timeout: 5000 });
  ok(true, "Files upload imports a selected file directly into the channel workspace");
  await page.evaluate(() => [...document.querySelectorAll("nav button")].find((button) => button.textContent.includes("Chat"))?.click());
  await page.waitForSelector('textarea[data-composer-parent="root"]');
  const restoredDraft = await page.$eval('textarea[data-composer-parent="root"]', (element) => element.value);
  ok(restoredDraft === "draft survives navigation", "user/channel/thread-scoped drafts survive navigation");

  await page.evaluate(() => [...document.querySelectorAll("nav button")].find((button) => button.textContent.includes("Board"))?.click());
  await page.waitForSelector(".board-lanes");
  const boardGeometry = await page.evaluate(() => {
    const viewport = document.documentElement;
    const channelView = document.getElementById("channelview");
    const scroller = document.querySelector(".board-scroll");
    const lanes = document.querySelector(".board-lanes");
    const laneRects = [...document.querySelectorAll(".board-lane")].map((lane) => lane.getBoundingClientRect());
    const scrollRect = scroller.getBoundingClientRect();
    return {
      pageFits: viewport.scrollWidth <= viewport.clientWidth,
      viewFits: channelView.scrollWidth <= channelView.clientWidth,
      lanesFit: lanes.getBoundingClientRect().right <= scrollRect.right + 1,
      everyLaneFits: laneRects.every((rect) => rect.left >= scrollRect.left - 1 && rect.right <= scrollRect.right + 1),
    };
  });
  ok(boardGeometry.pageFits && boardGeometry.viewFits && boardGeometry.lanesFit && boardGeometry.everyLaneFits,
    "Board lanes wrap within the viewport without horizontal spill");

  await page.evaluate(() => [...document.querySelectorAll("nav button")].find((button) => button.textContent.includes("Terminal"))?.click());
  await page.waitForSelector(".xterm");
  await sleep(400);
  const terminal = await page.$eval(".xterm", (element) => ({ height: element.getBoundingClientRect().height, rows: element.querySelector(".xterm-rows")?.children.length || 0 }));
  ok(terminal.height > 500 && terminal.rows >= 20, "channel terminal opens as a full-height terminal instead of a thin line");
  ok(browserErrors.length === 0, "the regression browser flow has no console or page errors");
} catch (error) {
  fail++;
  console.error("  FAIL-", error.stack || error.message);
} finally {
  await browser?.close().catch(() => undefined);
  for (const child of [app, mock]) if (child && child.exitCode == null) child.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
