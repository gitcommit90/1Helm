import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import puppeteer from "puppeteer";

const root = process.cwd();
const dataDir = join(root, ".native-test-data", `cowork-browser-${process.pid}`);

async function browserExecutable() {
  const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH || ""];
  try { candidates.push(await puppeteer.executablePath()); } catch { /* no bundled browser */ }
  candidates.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  for (const candidate of candidates.filter(Boolean)) {
    try { accessSync(candidate, fsConstants.X_OK); return candidate; } catch { /* try next */ }
  }
  return null;
}

const executablePath = await browserExecutable();
const freePort = () => new Promise((resolve, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const waitFor = async (fn, label, timeout = 20_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

test("Cowork, Files, Quick Note, Markdown, and mobile continuity work as one file-backed product", {
  timeout: 120_000,
  skip: executablePath ? false : "No local Chrome executable; server and source contracts cover the nonvisual fallback.",
}, async (t) => {
  rmSync(dataDir, { recursive: true, force: true });
  const appPort = await freePort();
  const providerPort = await freePort();
  const base = `http://127.0.0.1:${appPort}`;
  const provider = spawn(process.execPath, ["test/mock-openai.mjs", String(providerPort)], { cwd: root, stdio: "ignore" });
  const app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
    cwd: root,
    env: { ...process.env, CTRL_DATA_DIR: dataDir, PORT: String(appPort), NODE_ENV: "test", HELM_CHANNEL_COMPUTER_BACKEND: "native", IMPROVEMENT_INTERVAL_MS: "600000" },
    stdio: "ignore",
  });
  let browser;
  t.after(async () => {
    await browser?.close().catch(() => undefined);
    app.kill("SIGTERM"); provider.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => app.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3_000))]);
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
    const payload = await response.json().catch(() => ({}));
    assert.equal(response.ok, true, `${path}: ${payload.error || response.status}`);
    return payload;
  };
  const registration = await api("/api/auth/register", { body: { username: "captain", password: "secret-pass", display: "Captain" } });
  const token = registration.token;
  const providerRecord = await api("/api/providers", { body: { name: "Mock", base_url: `http://127.0.0.1:${providerPort}/v1`, api_key: "test" } }, token);
  await api("/api/setup/complete", { body: { name: "Cowork Browser", terminals_enabled: true, provider_id: providerRecord.provider.id, model: "mock-large" } }, token);
  const channel = (await api("/api/channels", { body: { name: "Studio", purpose: "Exercise Cowork and Files." } }, token)).channel;
  const createFile = (parent, name, content) => api(`/api/channels/${channel.id}/files/entries`, { body: { parent, name, content } }, token);
  await createFile("notes", "field-notes.md", "# Field notes\n\n**Goal**\n");
  await createFile("whiteboards", "map.whiteboard.json", JSON.stringify({ version: 1, elements: [] }, null, 2));
  await createFile("code", "tool.ts", "export const ready = true;\n");
  await createFile("docs", "proposal.md", "# Proposal\n");
  await createFile("presentations", "review.slides.json", JSON.stringify({ version: 1, slides: [{ title: "Review", body: "Ready" }] }, null, 2));
  const markdownThread = (await api(`/api/channels/${channel.id}/messages`, { body: { body: "** Goal **\n\n** Session Status **" } }, token)).message;
  for (let index = 0; index < 18; index++) await api(`/api/channels/${channel.id}/messages`, { body: { body: `Mobile scroll fixture ${index + 1}: ${"readable history ".repeat(18)}` } }, token);

  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate((value) => localStorage.setItem("ctrl.token", value), token);
  await page.goto(`${base}/c/${channel.slug}/chat`, { waitUntil: "networkidle0" });

  // Quick Note stays above the current context, collapses without discarding,
  // saves with both shortcuts, and allocates collision-safe untitled names.
  await page.click("[data-quick-note-header]");
  await page.waitForSelector('[role="dialog"][aria-label="Quick Note"]');
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Quick Note content");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Quick Note content");
  await page.type('[aria-label="Quick Note content"]', "First captured thought");
  await page.click('nav button:nth-child(1)');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Quick Note"]'));
  await page.click("[data-quick-note-header]");
  assert.equal(await page.$eval('[aria-label="Quick Note content"]', (input) => input.value), "First captured thought");
  await page.$eval('[role="dialog"][aria-label="Quick Note"]', (panel) => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })));
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Quick Note"]'));
  await waitFor(async () => (await api(`/api/channels/${channel.id}/notes`, {}, token)).notes.some((note) => note.name === "untitled-quick-note-1.md"), "first Quick Note");
  await page.click("[data-quick-note-header]");
  await page.type('[aria-label="Quick Note content"]', "Second captured thought");
  await page.$eval('[role="dialog"][aria-label="Quick Note"]', (panel) => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await waitFor(async () => (await api(`/api/channels/${channel.id}/notes`, {}, token)).notes.some((note) => note.name === "untitled-quick-note-2.md"), "second Quick Note");

  // Cowork keeps one live editor node and exact selection across an otherwise
  // full shell paint, while editing the authoritative /workspace file.
  await page.goto(`${base}/c/${channel.slug}/cowork`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-cowork-surface]');
  assert.deepEqual(await page.$$eval('[aria-label="Cowork sections"] button', (buttons) => buttons.map((button) => button.textContent.trim())), ["Notes", "Whiteboard", "Code", "Docs", "Presentations"]);
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("field-notes.md"))?.click());
  await page.waitForFunction(() => document.querySelector('[aria-label="Notes editor"]')?.value.includes("Field notes"));
  await page.evaluate(() => {
    const editor = document.querySelector('[aria-label="Notes editor"]');
    editor.value += "\nUnsaved continuity proof."; editor.dispatchEvent(new Event("input")); editor.focus(); editor.setSelectionRange(3, 12); window.__coworkEditor = editor;
  });
  await page.evaluate(() => [...document.querySelectorAll('button[title^="Switch to"]')][0]?.click());
  await page.waitForFunction(() => document.activeElement === document.querySelector('[aria-label="Notes editor"]'));
  const continuity = await page.evaluate(() => {
    const editor = document.querySelector('[aria-label="Notes editor"]');
    return { same: editor === window.__coworkEditor, focused: document.activeElement === editor, value: editor?.value, start: editor?.selectionStart, end: editor?.selectionEnd };
  });
  assert.deepEqual(continuity, { same: true, focused: true, value: "# Field notes\n\n**Goal**\n\nUnsaved continuity proof.", start: 3, end: 12 });
  await page.keyboard.down("Control"); await page.keyboard.press("s"); await page.keyboard.up("Control");
  await waitFor(async () => (await api(`/api/channels/${channel.id}/files/text?path=notes%2Ffield-notes.md`, {}, token)).file.content.includes("Unsaved continuity proof"), "saved Cowork note");
  await page.evaluate(() => [...document.querySelectorAll('.cowork-editor-toolbar button')].find((button) => button.textContent.trim() === "Preview")?.click());
  await page.waitForSelector(".cowork-markdown-preview:not(.hidden) strong");

  // Every mode is file-backed, and the agent drawer starts an ordinary thread
  // whose first human message carries only the open file path as context.
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Whiteboard")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("map.whiteboard.json"));
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("map.whiteboard.json"))?.click());
  await page.waitForSelector('[aria-label="Whiteboard canvas"]');
  await page.evaluate(() => [...document.querySelectorAll('.cowork-editor-toolbar button')].find((button) => button.textContent.includes("Card"))?.click());
  assert.equal(await page.$$eval(".cowork-whiteboard-card", (cards) => cards.length), 1);
  await page.evaluate(() => document.querySelector('.cowork-agent-toggle')?.click());
  await page.waitForSelector('[data-cowork-agent]:not(.hidden) textarea');
  await page.type('[data-cowork-agent] textarea', "Help arrange this board");
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-agent] button')].find((button) => button.textContent.includes("Send"))?.click());
  const coworkRootId = await waitFor(async () => page.evaluate((id) => Number(localStorage.getItem(`1helm.cowork.thread.${id}.whiteboards/map.whiteboard.json`) || 0), channel.id), "Cowork thread id");
  const coworkThread = await api(`/api/messages/${coworkRootId}/thread`, {}, token);
  assert.match(coworkThread.root.body, /^@\S+ Help arrange this board\n\nWorking file: \/workspace\/whiteboards\/map\.whiteboard\.json$/);

  for (const [label, file, selector] of [
    ["Code", "tool.ts", '[aria-label="Code editor"]'],
    ["Docs", "proposal.md", '[aria-label="Docs editor"]'],
    ["Presentations", "review.slides.json", ".cowork-slide"],
  ]) {
    await page.evaluate((next) => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === next)?.click(), label);
    await page.waitForFunction((name) => document.querySelector('[data-cowork-files]')?.textContent.includes(name), {}, file);
    await page.evaluate((name) => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes(name))?.click(), file);
    await page.waitForSelector(selector);
  }
  await page.screenshot({ path: "/tmp/1helm-cowork-desktop.png" });

  // Files behaves like a bounded file browser and all familiar CRUD actions
  // operate on the same tree Cowork has just edited.
  await page.goto(`${base}/c/${channel.slug}/files`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-file-browser]');
  const rootFolders = await page.$$eval('[data-file-directory="/"] [data-file-kind="directory"]', (items) => items.map((item) => ({ name: item.textContent, folderIcon: Boolean(item.querySelector('.file-grid-icon.is-folder')) })));
  assert.ok(["notes", "whiteboards", "code", "docs", "presentations"].every((name) => rootFolders.some((item) => item.name.includes(name) && item.folderIcon)));
  await page.screenshot({ path: "/tmp/1helm-files-desktop.png" });
  await page.evaluate(() => document.querySelector('[data-file-path="docs"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  await page.waitForSelector('[data-file-directory="docs"]');
  const clickNamedButton = (name) => page.evaluate((text) => {
    const candidates = [...document.querySelectorAll('button')].filter((button) => button.textContent.trim() === text);
    const button = candidates.find((candidate) => candidate.offsetParent !== null && !(candidate.closest('[data-file-path]'))) || candidates.find((candidate) => candidate.offsetParent !== null);
    button?.click();
  }, name);
  const submitPrompt = async (value) => {
    await page.waitForSelector('.modal-overlay input');
    await page.$eval('.modal-overlay input', (input, next) => { input.value = next; input.dispatchEvent(new Event("input", { bubbles: true })); }, value);
    await page.evaluate(() => [...document.querySelectorAll('.modal-overlay button')].find((button) => button.textContent.trim() === "OK")?.click());
  };
  await clickNamedButton("New folder"); await submitPrompt("plans");
  await page.waitForSelector('[data-file-path="docs/plans"]');
  await clickNamedButton("New file"); await submitPrompt("browser.md");
  await page.waitForSelector('[data-file-path="docs/browser.md"]');
  await page.click('[data-file-path="docs/browser.md"]');
  await page.waitForFunction(() => document.querySelector('[data-file-metadata]')?.textContent.includes("browser.md"));
  await page.evaluate(() => [...document.querySelectorAll('[data-file-metadata] button')].find((button) => button.textContent.trim() === "Rename")?.click()); await submitPrompt("renamed.md");
  await page.waitForSelector('[data-file-path="docs/renamed.md"]');
  await page.click('[data-file-path="docs/renamed.md"]');
  await page.waitForFunction(() => document.querySelector('[data-file-metadata]')?.textContent.includes("renamed.md"));
  await page.evaluate(() => [...document.querySelectorAll('[data-file-metadata] button')].find((button) => button.textContent.trim() === "Duplicate")?.click()); await page.waitForSelector('[data-file-path="docs/renamed copy.md"]');
  await page.click('[data-file-path="docs/renamed.md"]');
  await page.waitForFunction(() => document.querySelector('[data-file-metadata]')?.textContent.includes("renamed.md"));
  await page.evaluate(() => [...document.querySelectorAll('[data-file-metadata] button')].find((button) => button.textContent.trim() === "Move")?.click()); await submitPrompt("docs/plans");
  await page.waitForFunction(() => !document.querySelector('[data-file-path="docs/renamed.md"]'));
  await page.evaluate(() => document.querySelector('[aria-label="File breadcrumbs"] button')?.click());
  await page.waitForSelector('[data-file-directory="/"]');

  // Global Threads uses the shared Markdown renderer, including spaced bold.
  const globalThread = (await api("/api/threads", {}, token)).threads.find((thread) => thread.root_message_id === markdownThread.id);
  assert.ok(globalThread, "Markdown fixture appears in the global Threads API");
  await page.evaluate(() => [...document.querySelectorAll('[data-sidebar="desktop"] button')].find((button) => button.textContent.trim() === "Threads")?.click());
  await page.waitForSelector(`[data-global-thread-open="${globalThread.id}"]`);
  const markdown = await page.$eval(`[data-global-thread-open="${globalThread.id}"]`, (row) => ({ text: row.textContent, strong: [...row.querySelectorAll("strong")].map((node) => node.textContent) }));
  assert.ok(markdown.strong.some((text) => text.trim().toLowerCase().startsWith("goal")) && markdown.strong.some((text) => text.trim().toLowerCase().startsWith("session status")), JSON.stringify(markdown));
  assert.doesNotMatch(markdown.text, /\*\*/);

  // On a phone, scrolling away blurs the composer (allowing the OS keyboard
  // to dismiss), settings navigation stays compact, and the visible viewport
  // owns the application height without clipping below the screen.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.goto(`${base}/c/${channel.slug}/chat`, { waitUntil: "networkidle0" });
  await page.waitForSelector('#msgs');
  const mobile = await page.evaluate(() => {
    const input = document.querySelector('textarea[data-composer-parent="root"]');
    const messages = document.getElementById("msgs");
    input.focus(); messages.scrollTop = Math.max(0, messages.scrollHeight - messages.clientHeight); messages.dispatchEvent(new Event("scroll"));
    messages.scrollTop = Math.max(1, messages.scrollTop - 160); messages.dispatchEvent(new Event("scroll"));
    const shell = document.querySelector(".workspace-shell")?.getBoundingClientRect();
    return { blurred: document.activeElement !== input, shellBottom: shell?.bottom, viewport: innerHeight, cssHeight: getComputedStyle(document.documentElement).getPropertyValue("--app-viewport-height") };
  });
  assert.equal(mobile.blurred, true);
  assert.ok(Math.abs(mobile.shellBottom - mobile.viewport) <= 1 && mobile.cssHeight.endsWith("px"), JSON.stringify(mobile));
  await page.click('[aria-label="Open navigation"]');
  await page.waitForSelector('[data-sidebar="mobile"] [aria-label="Open settings"]');
  await page.click('[data-sidebar="mobile"] [aria-label="Open settings"]');
  await page.waitForSelector('[aria-label="Settings sections"]');
  const settings = await page.$eval('[aria-label="Settings sections"]', (nav) => ({ height: nav.getBoundingClientRect().height, width: nav.getBoundingClientRect().width, scrolls: nav.scrollWidth > nav.clientWidth }));
  assert.ok(settings.height < 90 && settings.width >= 380 && settings.scrolls, JSON.stringify(settings));
  await page.screenshot({ path: "/tmp/1helm-mobile-settings.png" });
  assert.deepEqual(errors, []);
});
