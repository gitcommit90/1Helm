import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";

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
const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
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
  timeout: 180_000,
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
    stdio: ["ignore", "pipe", "pipe"],
  });
  let appLogs = "";
  app.stdout.on("data", (chunk) => { appLogs = `${appLogs}${chunk}`.slice(-12_000); });
  app.stderr.on("data", (chunk) => { appLogs = `${appLogs}${chunk}`.slice(-12_000); });
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
    let response;
    try {
      response = await fetch(base + path, {
        method: options.method || (options.body !== undefined ? "POST" : "GET"),
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.body !== undefined ? { "content-type": "application/json" } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new Error(`${path}: ${error.message}; server exit=${app.exitCode ?? "running"}\n${appLogs}`);
    }
    const payload = await response.json().catch(() => ({}));
    assert.equal(response.ok, true, `${path}: ${payload.error || response.status}`);
    return payload;
  };
  const registration = await api("/api/auth/register", { body: { username: "captain", password: "secret-pass", display: "Captain" } });
  const token = registration.token;
  const providerRecord = await api("/api/providers", { body: { name: "Mock", base_url: `http://127.0.0.1:${providerPort}/v1`, api_key: "test" } }, token);
  await api("/api/setup/complete", { body: { name: "Cowork Browser", terminals_enabled: true, provider_id: providerRecord.provider.id, model: "mock-large" } }, token);
  const channel = (await api("/api/channels", { body: { name: "Studio", purpose: "Exercise Cowork and Files." } }, token)).channel;
  const collaborator = (await api("/api/admin/users", { body: { username: "crew", password: "secret-pass", display: "Crew Mate" } }, token)).user;
  const invitation = (await api(`/api/channels/${channel.id}/messages`, { body: { body: "@crew join this Cowork channel" } }, token)).message;
  await api(`/api/channels/${channel.id}/members/${collaborator.id}`, { body: { messageId: invitation.id } }, token);
  const collaboratorToken = (await api("/api/auth/login", { body: { username: "crew", password: "secret-pass" } })).token;
  const createFile = (parent, name, content) => api(`/api/channels/${channel.id}/files/entries`, { body: { parent, name, content } }, token);
  await createFile("notes", "field-notes.md", "# Field notes\n\n**Goal**\n");
  await createFile("whiteboards", "map.whiteboard.json", JSON.stringify({ version: 1, elements: [] }, null, 2));
  await createFile("code", "tool.ts", "export const ready = true;\n");
  await createFile("docs", "proposal.md", "# Proposal\n");
  await createFile("presentations", "review.slides.json", JSON.stringify({ version: 1, slides: [{ title: "Review", body: "Ready" }] }, null, 2));
  await api(`/api/channels/${channel.id}/files/directories`, { body: { path: "", name: "archive" } }, token);
  await createFile("", "README.md", "# Workspace overview\n");
  const markdownThread = (await api(`/api/channels/${channel.id}/messages`, { body: { body: "** Goal **\n\n** Session Status **" } }, token)).message;
  for (let index = 0; index < 18; index++) await api(`/api/channels/${channel.id}/messages`, { body: { body: `Mobile scroll fixture ${index + 1}: ${"readable history ".repeat(18)}` } }, token);

  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--use-fake-ui-for-media-stream"] });
  const page = await browser.newPage();
  const downloadDir = join(dataDir, "downloads");
  mkdirSync(downloadDir, { recursive: true });
  await page.createCDPSession().then((session) => session.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir }));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate((value) => localStorage.setItem("ctrl.token", value), token);
  await page.goto(`${base}/c/${channel.slug}/chat`, { waitUntil: "networkidle0" });
  const answerPrompt = async (value) => {
    await page.waitForSelector('.modal-overlay input');
    await page.$eval('.modal-overlay input', (input, next) => { input.value = next; input.dispatchEvent(new Event("input", { bubbles: true })); }, value);
    await page.evaluate(() => [...document.querySelectorAll('.modal-overlay button')].find((button) => button.textContent.trim() === "OK")?.click());
  };

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
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent?.includes("field-notes.md"));
  await page.waitForSelector('.cowork-workspace .cowork-agent-toggle');
  await page.click('.cowork-workspace .cowork-agent-toggle');
  await page.waitForSelector('[data-cowork-agent]:not(.hidden) textarea');
  assert.equal(await page.$eval('[data-cowork-agent] header', (header) => header.textContent.includes('/workspace/notes')), true, "an unopened Cowork section scopes its agent to the current folder");
  await page.type('[data-cowork-agent] textarea', "Summarize this folder");
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-agent] button')].find((button) => button.textContent.includes("Send"))?.click());
  const folderRootId = await waitFor(async () => page.evaluate((id) => Number(localStorage.getItem(`1helm.cowork.thread.${id}.notes`) || 0), channel.id), "folder-scoped Cowork thread id");
  const folderThread = await api(`/api/messages/${folderRootId}/thread`, {}, token);
  assert.match(folderThread.root.body, /^@\S+ Summarize this folder\n\nWorking folder: \/workspace\/notes$/);
  await page.click('.cowork-workspace .cowork-agent-toggle');
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("field-notes.md"))?.click());
  await page.waitForFunction(() => document.querySelector('[aria-label="Notes editor"] .cm-content')?.textContent.includes("Field notes"));
  const editorContent = '[aria-label="Notes editor"] .cm-content';
  await page.click(editorContent);
  await page.keyboard.down(primaryModifier); await page.keyboard.press("a"); await page.keyboard.up(primaryModifier); await page.keyboard.press("ArrowRight");
  await page.keyboard.type("\nUnsaved continuity proof.");
  await page.click('[aria-label="Notes editor"] .cm-line');
  await page.keyboard.down(primaryModifier); await page.keyboard.press("a"); await page.keyboard.up(primaryModifier); await page.keyboard.press("ArrowLeft");
  for (let index = 0; index < 3; index++) await page.keyboard.press("ArrowRight");
  await page.keyboard.down("Shift"); for (let index = 0; index < 8; index++) await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
  await page.evaluate(() => { window.__coworkEditor = document.querySelector('[aria-label="Notes editor"] .cm-content'); });
  await page.evaluate(() => [...document.querySelectorAll('button[title^="Switch to"]')][0]?.click());
  await page.waitForFunction(() => document.querySelector('[aria-label="Notes editor"] .cm-content') === window.__coworkEditor);
  const continuity = await page.evaluate(() => {
    const editor = document.querySelector('[aria-label="Notes editor"] .cm-content');
    return { same: editor === window.__coworkEditor, focused: document.activeElement === editor, lines: [...document.querySelectorAll('[aria-label="Notes editor"] .cm-line')].map((line) => line.textContent) };
  });
  assert.deepEqual(continuity, { same: true, focused: true, lines: ["# Field notes", "", "**Goal**", "", "Unsaved continuity proof."] });
  await page.keyboard.type("PRESERVED");
  assert.deepEqual(await page.$$eval('[aria-label="Notes editor"] .cm-line', (lines) => lines.map((line) => line.textContent)), ["# FPRESERVEDes", "", "**Goal**", "", "Unsaved continuity proof."]);
  await page.keyboard.down(primaryModifier); await page.keyboard.press("s"); await page.keyboard.up(primaryModifier);
  await waitFor(async () => (await api(`/api/channels/${channel.id}/files/text?path=notes%2Ffield-notes.md`, {}, token)).file.content.includes("Unsaved continuity proof"), "saved Cowork note");
  assert.equal(await page.$$eval('[data-speech-toggle]', (buttons) => buttons.some((button) => button.getAttribute("aria-label") === "Dictate note")), true, "Cowork Notes exposes dictation");
  // Install a deterministic SpeechRecognition seam in the page and exercise
  // the real bare Alt event path while CodeMirror owns focus. This previously
  // failed because the shortcut knew the editor target but not its mic button.
  await page.evaluate(() => {
    class FakeRecognition {
      start() { window.__speechStarts = (window.__speechStarts || 0) + 1; }
      stop() { this.onend?.(); }
    }
    window.SpeechRecognition = FakeRecognition;
  });
  await page.click(editorContent);
  await page.keyboard.down("Alt"); await page.keyboard.up("Alt");
  await page.waitForFunction(() => window.__speechStarts === 1);
  assert.equal(await page.$eval('[aria-label="Dictate note"]', (button) => button.getAttribute("aria-pressed")), "true", "bare Alt starts Cowork Notes dictation");
  await page.keyboard.down("Alt"); await page.keyboard.up("Alt");
  await page.waitForFunction(() => document.querySelector('[aria-label="Dictate note"]')?.getAttribute("aria-pressed") === "false");
  await page.keyboard.down("Alt"); await page.keyboard.press("x"); await page.keyboard.up("Alt");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(await page.evaluate(() => window.__speechStarts), 1, "an Option/Alt character combination does not start dictation");

  // The CodeMirror scroller itself must own a finite viewport and scroll—not
  // an outer wrapper whose inner editor clips overflowing content.
  await page.click(editorContent);
  await page.keyboard.down(primaryModifier); await page.keyboard.press("End"); await page.keyboard.up(primaryModifier);
  await page.keyboard.type(`\n${Array.from({ length: 120 }, (_, index) => `Scrollable note row ${index + 1}`).join("\n")}`);
  const noteScroll = await page.$eval('[aria-label="Notes editor"] .cm-scroller', (scroller) => {
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    return { before, after: scroller.scrollTop, clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight };
  });
  assert.ok(noteScroll.clientHeight > 0 && noteScroll.scrollHeight > noteScroll.clientHeight && noteScroll.after > 0, JSON.stringify(noteScroll));
  await page.keyboard.down(primaryModifier); await page.keyboard.press("s"); await page.keyboard.up(primaryModifier);
  await waitFor(async () => (await api(`/api/channels/${channel.id}/files/text?path=notes%2Ffield-notes.md`, {}, token)).file.content.includes("Scrollable note row 120"), "saved long Cowork note");

  // Switch to another Cowork section while this page is the only client. That
  // destroys the server room. Returning must create a fresh Y.Doc rather than
  // reconnecting stale history and duplicating the complete text.
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Docs")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("proposal.md"));
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Notes")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("field-notes.md"));
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("field-notes.md"))?.click());
  await page.waitForSelector('[aria-label="Notes editor"] .cm-content');
  await page.$eval('[aria-label="Notes editor"] .cm-scroller', (scroller) => { scroller.scrollTop = scroller.scrollHeight; });
  await page.waitForFunction(() => document.querySelector('[aria-label="Notes editor"] .cm-content')?.textContent.includes("Scrollable note row 120"));
  await new Promise((resolve) => setTimeout(resolve, 800));
  const sectionReopenedText = (await api(`/api/channels/${channel.id}/files/text?path=notes%2Ffield-notes.md`, {}, token)).file.content;
  assert.equal((sectionReopenedText.match(/Scrollable note row 120/g) || []).length, 1, "switching Cowork sections never duplicates saved text");

  // Reproduce the reported agent-edit path: an external writer replaces the
  // open document, the live room adopts it, and every later reopen must retain
  // exactly the five requested lines without a recovery prompt or replay.
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Docs")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("proposal.md"));
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("proposal.md"))?.click());
  await page.waitForSelector('[aria-label="Docs editor"] .cm-content');
  await api(`/api/channels/${channel.id}/files/text`, { method: "PATCH", body: { path: "docs/proposal.md", content: "Hello World\n".repeat(5) } }, token);
  await page.waitForFunction(() => (document.querySelector('[aria-label="Docs editor"] .cm-content')?.textContent.match(/Hello World/g) || []).length === 5);
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Notes")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("field-notes.md"));
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Docs")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("proposal.md"));
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("proposal.md"))?.click());
  await page.waitForFunction(() => document.querySelector('[aria-label="Docs editor"] .cm-content')?.textContent.includes("Hello World"));
  await new Promise((resolve) => setTimeout(resolve, 800));
  const externallyReopened = (await api(`/api/channels/${channel.id}/files/text?path=docs%2Fproposal.md`, {}, token)).file.content;
  assert.equal((externallyReopened.match(/Hello World/g) || []).length, 5, "an agent-style replacement remains exactly-once after leaving and reopening a document");
  assert.equal(await page.$('.modal-overlay'), null, "authoritative agent edits never trigger a stale local recovery prompt");
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Notes")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("field-notes.md"));
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("field-notes.md"))?.click());
  await page.waitForFunction(() => document.querySelector('[aria-label="Notes editor"] .cm-content')?.textContent.includes("Unsaved continuity proof"));
  // Leave the sole Cowork client and return. The old document transport must
  // never merge its stale Yjs history with a fresh server room and duplicate
  // the complete file.
  await page.evaluate(() => [...document.querySelectorAll("nav button")].find((button) => button.textContent.includes("Files"))?.click());
  await page.waitForSelector('[data-file-browser]');
  await page.evaluate(() => [...document.querySelectorAll("nav button")].find((button) => button.textContent.includes("Cowork"))?.click());
  await page.waitForSelector('[data-cowork-surface]');
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("field-notes.md"))?.click());
  await page.waitForFunction(() => document.querySelector('[aria-label="Notes editor"] .cm-content')?.textContent.includes("Unsaved continuity proof"));
  const reopenedText = await page.$eval('[aria-label="Notes editor"] .cm-content', (editor) => editor.textContent || "");
  assert.equal((reopenedText.match(/Unsaved continuity proof/g) || []).length, 1, "leaving and reopening Cowork never duplicates saved text");

  // Focus the actual Cowork agent textarea and prove the same bare Alt route
  // starts its own mic button rather than falling back to Chat.
  await page.evaluate(() => document.querySelector('.cowork-agent-toggle')?.click());
  await page.waitForSelector('[data-cowork-agent]:not(.hidden) textarea');
  await page.focus('[data-cowork-agent] textarea');
  await page.keyboard.down("Alt"); await page.keyboard.up("Alt");
  try { await page.waitForFunction(() => window.__speechStarts === 2, { timeout: 5_000 }); }
  catch (error) {
    const state = await page.evaluate(() => ({ starts: window.__speechStarts, active: document.activeElement?.outerHTML, pressed: document.querySelector('[aria-label="Dictate Cowork agent request"]')?.getAttribute("aria-pressed") }));
    throw new Error(`Cowork agent Alt shortcut did not start: ${JSON.stringify(state)}`, { cause: error });
  }
  assert.equal(await page.$eval('[aria-label="Dictate Cowork agent request"]', (button) => button.getAttribute("aria-pressed")), "true", "bare Alt starts Cowork agent dictation");
  await page.keyboard.down("Alt"); await page.keyboard.up("Alt");
  await page.waitForFunction(() => document.querySelector('[aria-label="Dictate Cowork agent request"]')?.getAttribute("aria-pressed") === "false");
  await page.evaluate(() => document.querySelector('[aria-label="Close agent panel"]')?.click());

  // A second authenticated member joins the same ordinary workspace file.
  // Both clients see presence, remote cursors, and edits without a reload.
  const collaboratorContext = await browser.createBrowserContext();
  const collaboratorPage = await collaboratorContext.newPage();
  t.after(() => collaboratorContext.close().catch(() => undefined));
  await collaboratorPage.goto(base, { waitUntil: "networkidle0" });
  await collaboratorPage.evaluate((value) => localStorage.setItem("ctrl.token", value), collaboratorToken);
  await collaboratorPage.goto(`${base}/c/${channel.slug}/cowork`, { waitUntil: "networkidle0" });
  await collaboratorPage.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("field-notes.md"))?.click());
  await collaboratorPage.waitForFunction(() => document.querySelector('[aria-label="Notes editor"] .cm-content')?.textContent.includes("continuity proof"));
  await page.waitForSelector('[data-cowork-viewer="crew"]');
  await collaboratorPage.waitForSelector('[data-cowork-viewer="captain"]');
  await collaboratorPage.click('[aria-label="Notes editor"] .cm-content');
  await collaboratorPage.keyboard.down(primaryModifier); await collaboratorPage.keyboard.press("a"); await collaboratorPage.keyboard.up(primaryModifier); await collaboratorPage.keyboard.press("ArrowRight");
  await collaboratorPage.keyboard.type("\nLive words from Crew.");
  await page.$eval('[aria-label="Notes editor"] .cm-scroller', (scroller) => { scroller.scrollTop = scroller.scrollHeight; });
  await page.waitForFunction(() => document.querySelector('[aria-label="Notes editor"] .cm-content')?.textContent.includes("Live words from Crew"));
  await collaboratorPage.evaluate(() => {
    const editor = document.querySelector('[aria-label="Notes editor"] .cm-content');
    const last = [...document.querySelectorAll('[aria-label="Notes editor"] .cm-line')].at(-1)?.firstChild;
    editor.focus(); window.getSelection().setBaseAndExtent(last, 1, last, 5); document.dispatchEvent(new Event("selectionchange"));
  });
  await page.waitForSelector('.cm-ySelectionCaret');
  await page.evaluate(() => [...document.querySelectorAll('.cowork-editor-toolbar button')].find((button) => button.textContent.trim() === "Preview")?.click());
  await page.waitForSelector(".cowork-markdown-preview:not(.hidden) strong");

  // Every mode is file-backed, and the agent drawer starts an ordinary thread
  // whose first human message carries only the open file path as context.
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Whiteboard")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("map.whiteboard.json"));
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("map.whiteboard.json"))?.click());
  await page.waitForSelector('[aria-label="Whiteboard canvas"]');
  await collaboratorPage.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Whiteboard")?.click());
  await collaboratorPage.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("map.whiteboard.json"));
  await collaboratorPage.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("map.whiteboard.json"))?.click());
  await collaboratorPage.waitForSelector('[aria-label="Whiteboard canvas"]');
  await page.waitForSelector('[aria-label="Whiteboard canvas"] .excalidraw canvas');
  const canvas = await page.$('[aria-label="Whiteboard canvas"] .excalidraw');
  const bounds = await canvas.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.keyboard.press("r");
  await page.mouse.move(bounds.x + bounds.width * 0.35, bounds.y + bounds.height * 0.35); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.62, { steps: 5 }); await page.mouse.up();
  await waitFor(async () => JSON.parse((await api(`/api/channels/${channel.id}/files/text?path=whiteboards%2Fmap.whiteboard.json`, {}, token)).file.content).elements.length > 0, "saved Excalidraw shape");
  await collaboratorPage.waitForFunction(() => Number(document.querySelector('[aria-label="Whiteboard canvas"]')?.dataset.sceneElements || 0) > 0);
  await page.waitForSelector('[data-cowork-viewer="crew"]');
  const whiteboardTheme = await page.evaluate(() => {
    window.__coworkCanvas = document.querySelector('[aria-label="Whiteboard canvas"] canvas.interactive');
    return document.documentElement.className;
  });
  await page.evaluate(() => [...document.querySelectorAll('button[title^="Switch to"]')][0]?.click());
  await page.waitForFunction((prior) => document.documentElement.className !== prior, {}, whiteboardTheme);
  assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Whiteboard canvas"] canvas.interactive') === window.__coworkCanvas), true);
  await page.evaluate(() => document.querySelector('.cowork-agent-toggle')?.click());
  await page.waitForSelector('[data-cowork-agent]:not(.hidden) textarea');
  await page.type('[data-cowork-agent] textarea', "Help arrange this board");
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-agent] button')].find((button) => button.textContent.includes("Send"))?.click());
  const coworkRootId = await waitFor(async () => page.evaluate((id) => Number(localStorage.getItem(`1helm.cowork.thread.${id}.whiteboards/map.whiteboard.json`) || 0), channel.id), "Cowork thread id");
  const coworkThread = await api(`/api/messages/${coworkRootId}/thread`, {}, token);
  assert.match(coworkThread.root.body, /^@\S+ Help arrange this board\n\nWorking file: \/workspace\/whiteboards\/map\.whiteboard\.json\nWorking with: @crew$/);

  // Reopening the Cowork agent panel on an existing normal thread contributes
  // current co-viewers once, without duplicating the file path on follow-ups.
  await page.evaluate(() => document.querySelector('.cowork-agent-toggle')?.click());
  await page.evaluate(() => document.querySelector('.cowork-agent-toggle')?.click());
  await page.waitForSelector('[data-cowork-agent]:not(.hidden) textarea');
  await page.type('[data-cowork-agent] textarea', "Polish it together");
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-agent] button')].find((button) => button.textContent.includes("Send"))?.click());
  const coworkFollowup = await waitFor(async () => {
    const thread = await api(`/api/messages/${coworkRootId}/thread`, {}, token);
    return thread.replies.find((reply) => reply.author?.kind === "user" && reply.body.includes("Polish it together"));
  }, "Cowork follow-up context");
  assert.equal(coworkFollowup.body, "Polish it together\n\nWorking with: @crew");
  assert.equal((coworkFollowup.body.match(/Working file:/g) || []).length, 0);

  // Code is a capable text editor: syntax mode, line numbers, indentation,
  // and search work without introducing a second IDE or terminal.
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Code")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("tool.ts"));
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("tool.ts"))?.click());
  await page.waitForSelector('[aria-label="Code editor"][data-cowork-language="typescript"] .cm-lineNumbers');
  if (!(await page.evaluate(() => document.documentElement.classList.contains("light")))) {
    await page.evaluate(() => [...document.querySelectorAll('button[title="Switch to light"]')][0]?.click());
    await page.waitForFunction(() => document.documentElement.classList.contains("light"));
  }
  const codeContrast = await page.$eval('[aria-label="Code editor"]', (editor) => {
    const parse = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (rgb) => {
      const values = rgb.map((value) => { const channel = value / 255; return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
      return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
    };
    const style = getComputedStyle(editor.querySelector('.cm-editor'));
    const background = getComputedStyle(editor).backgroundColor;
    const foreground = style.color;
    const [bright, dark] = [luminance(parse(background)), luminance(parse(foreground))].sort((a, b) => b - a);
    return { background, foreground, ratio: (bright + .05) / (dark + .05) };
  });
  assert.ok(codeContrast.ratio >= 4.5, JSON.stringify(codeContrast));
  await page.click('[aria-label="Code editor"] .cm-content');
  await page.keyboard.down(primaryModifier); await page.keyboard.press("a"); await page.keyboard.up(primaryModifier); await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter"); await page.keyboard.press("Tab"); await page.keyboard.type("const searchableValue = 42;");
  assert.equal(await page.$eval('[aria-label="Code editor"] .cm-line:last-child', (line) => line.textContent.startsWith("  ")), true);
  await page.keyboard.down(primaryModifier); await page.keyboard.press("f"); await page.keyboard.up(primaryModifier);
  await page.waitForSelector('[aria-label="Code editor"] .cm-search input');
  await page.type('[aria-label="Code editor"] .cm-search input', "searchableValue");
  assert.ok(await page.$$eval('[aria-label="Code editor"] .cm-searchMatch', (matches) => matches.length) > 0);
  await page.keyboard.press("Escape");
  await page.keyboard.down(primaryModifier); await page.keyboard.press("s"); await page.keyboard.up(primaryModifier);
  await waitFor(async () => (await api(`/api/channels/${channel.id}/files/text?path=code%2Ftool.ts`, {}, token)).file.content.includes("searchableValue"), "saved TypeScript editor content");
  await page.click('[aria-label="Code editor"] .cm-content');
  await page.keyboard.down(primaryModifier); await page.keyboard.press("a"); await page.keyboard.up(primaryModifier); await page.keyboard.press("ArrowRight");
  await page.keyboard.type(`\n${Array.from({ length: 140 }, (_, index) => `const scrollRow${index + 1} = ${index + 1};`).join("\n")}`);
  const codeScroller = await page.$('[aria-label="Code editor"] .cm-scroller');
  const codeScrollerBox = await codeScroller.boundingBox();
  assert.ok(codeScrollerBox?.height > 0, JSON.stringify(codeScrollerBox));
  await page.$eval('[aria-label="Code editor"] .cm-scroller', (scroller) => { scroller.scrollTop = 0; });
  await page.mouse.move(codeScrollerBox.x + codeScrollerBox.width / 2, codeScrollerBox.y + Math.min(codeScrollerBox.height / 2, 120));
  await page.mouse.wheel({ deltaY: 700 });
  await page.waitForFunction(() => document.querySelector('[aria-label="Code editor"] .cm-scroller')?.scrollTop > 0);
  const codeScroll = await page.$eval('[aria-label="Code editor"] .cm-scroller', (scroller) => ({
    clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight, scrollTop: scroller.scrollTop,
    viewportHeight: document.querySelector('[data-cowork-viewport]').clientHeight,
  }));
  assert.ok(codeScroll.clientHeight < codeScroll.scrollHeight && codeScroll.scrollTop > 0 && codeScroll.clientHeight <= codeScroll.viewportHeight, JSON.stringify(codeScroll));
  await page.keyboard.down(primaryModifier); await page.keyboard.press("s"); await page.keyboard.up(primaryModifier);
  await waitFor(async () => (await api(`/api/channels/${channel.id}/files/text?path=code%2Ftool.ts`, {}, token)).file.content.includes("scrollRow140"), "saved long TypeScript editor content");

  // Docs keeps a page-oriented editor and its formatting controls write
  // ordinary Markdown that survives save/reopen.
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Docs")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("proposal.md"));
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("proposal.md"))?.click());
  await page.waitForSelector('.cowork-doc-page [aria-label="Docs editor"]');
  await page.click('[aria-label="Docs editor"] .cm-content');
  await page.keyboard.down(primaryModifier); await page.keyboard.press("a"); await page.keyboard.up(primaryModifier); await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.evaluate(() => [...document.querySelectorAll('.cowork-editor-toolbar button')].find((button) => button.textContent.trim() === "Bold")?.click());
  await page.keyboard.type("shared proposal");
  await page.keyboard.down(primaryModifier); await page.keyboard.press("s"); await page.keyboard.up(primaryModifier);
  await waitFor(async () => (await api(`/api/channels/${channel.id}/files/text?path=docs%2Fproposal.md`, {}, token)).file.content.includes("**shared proposal**"), "saved formatted document");

  // Cowork-local Explorer actions operate in nested folders over the same
  // /workspace tree as the main Files browser.
  const clickCoworkTitle = (title) => page.evaluate((value) => document.querySelector(`[title="${value}"]`)?.click(), title);
  await clickCoworkTitle("New folder"); await answerPrompt("drafts");
  await page.waitForSelector('[data-cowork-path="docs/drafts"]');
  await page.evaluate(() => document.querySelector('[data-cowork-path="docs/drafts"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  await page.waitForFunction(() => document.querySelector('[aria-label="Cowork folder path"]')?.textContent.includes("drafts"));
  await clickCoworkTitle("New file"); await answerPrompt("nested.md");
  await page.waitForSelector('[data-cowork-path="docs/drafts/nested.md"]');
  await page.click('[data-cowork-path="docs/drafts/nested.md"]');
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-file-actions] button')].find((button) => button.textContent.trim() === "Rename")?.click()); await answerPrompt("renamed.md");
  await page.waitForSelector('[data-cowork-path="docs/drafts/renamed.md"]');
  await page.click('[data-cowork-path="docs/drafts/renamed.md"]');
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-file-actions] button')].find((button) => button.textContent.trim() === "Duplicate")?.click());
  await page.waitForSelector('[data-cowork-path="docs/drafts/renamed copy.md"]');
  await page.click('[data-cowork-path="docs/drafts/renamed.md"]');
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-file-actions] button')].find((button) => button.textContent.trim() === "Move")?.click()); await answerPrompt("docs");
  await page.waitForSelector('[data-cowork-path="docs/renamed.md"]');
  await page.evaluate(() => document.querySelector('[data-cowork-path="docs/drafts"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  await page.waitForSelector('[data-cowork-path="docs/drafts/renamed copy.md"]');
  await page.click('[data-cowork-path="docs/drafts/renamed copy.md"]');
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-file-actions] button')].find((button) => button.textContent.trim() === "Delete")?.click());
  await page.waitForSelector('.modal-overlay'); await page.evaluate(() => [...document.querySelectorAll('.modal-overlay button')].find((button) => button.textContent.trim() === "Confirm")?.click());
  await page.waitForFunction(() => !document.querySelector('[data-cowork-path="docs/drafts/renamed copy.md"]'));
  await page.evaluate(() => document.querySelector('[aria-label="Cowork folder path"] button')?.click());
  await page.waitForFunction(() => !document.querySelector('[aria-label="Cowork folder path"]')?.textContent.includes("drafts"));
  await clickCoworkTitle("New file");
  assert.equal(await page.$eval('.modal-overlay input', (input) => input.value), "", "Cowork new-file prompts start blank");
  await answerPrompt("default-document");
  await page.waitForSelector('[data-cowork-path="docs/default-document.md"]');
  await clickCoworkTitle("New file"); await answerPrompt("explicit.custom");
  await page.waitForSelector('[data-cowork-path="docs/explicit.custom"]');

  // Presentations are one collaborative file with live slide structure,
  // Excalidraw drawing, reordering, deletion, persistence, and presentation mode.
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Presentations")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("review.slides.json"));
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("review.slides.json"))?.click());
  await page.waitForSelector('[data-cowork-presentation][data-slide-count="1"] .cowork-slide-canvas .excalidraw');
  await page.waitForSelector('.cowork-slide-canvas[data-initial-fit="complete"]');
  assert.ok(await page.$eval('.cowork-slide-canvas', (canvas) => Number(canvas.dataset.initialZoom) < 1), "the initial presentation viewport zooms out to fit the complete printable boundary");
  assert.deepEqual(await page.$eval('.cowork-slide-canvas', (canvas) => ({
    width: Number(canvas.dataset.printableWidth),
    height: Number(canvas.dataset.printableHeight),
    ratio: getComputedStyle(canvas).aspectRatio,
  })), { width: 1500, height: 1000, ratio: "1500 / 1000" }, "legacy decks open inside the default 1500 × 1000 printable area");
  await page.click('.cowork-slide-canvas .main-menu-trigger');
  await page.waitForSelector('.cowork-slide-canvas .dropdown-menu');
  const menuGeometry = await page.$eval('.cowork-slide-canvas .dropdown-menu', (menu) => {
    const menuBox = menu.getBoundingClientRect();
    const canvasBox = menu.closest('.cowork-slide-canvas').getBoundingClientRect();
    const stageBox = menu.closest('.cowork-slide-stage').getBoundingClientRect();
    const container = menu.querySelector('.dropdown-menu-container');
    const firstAction = menu.querySelector('.dropdown-menu-item');
    const actionBox = firstAction?.getBoundingClientRect();
    const visibleAtAction = actionBox ? document.elementFromPoint(actionBox.left + Math.min(16, actionBox.width / 2), actionBox.top + actionBox.height / 2) : null;
    return {
      menuTop: menuBox.top, menuBottom: menuBox.bottom, menuHeight: menuBox.height,
      canvasTop: canvasBox.top, canvasBottom: canvasBox.bottom, stageTop: stageBox.top, stageBottom: stageBox.bottom,
      clientHeight: container?.clientHeight || 0, scrollHeight: container?.scrollHeight || 0,
      firstActionVisible: Boolean(firstAction && visibleAtAction && (firstAction === visibleAtAction || firstAction.contains(visibleAtAction))),
      firstAction: actionBox ? { text: firstAction.textContent?.trim(), top: actionBox.top, bottom: actionBox.bottom, left: actionBox.left, right: actionBox.right } : null,
      hit: visibleAtAction ? { tag: visibleAtAction.tagName, className: String(visibleAtAction.className), text: visibleAtAction.textContent?.trim()?.slice(0, 80) } : null,
    };
  });
  assert.ok(menuGeometry.menuTop >= menuGeometry.stageTop - 1 && menuGeometry.menuBottom <= menuGeometry.stageBottom + 1, JSON.stringify(menuGeometry));
  assert.ok(menuGeometry.menuHeight > 100 && menuGeometry.clientHeight > 100 && menuGeometry.scrollHeight >= menuGeometry.clientHeight && menuGeometry.firstActionVisible, JSON.stringify(menuGeometry));
  const presentationMenuText = await page.$eval('.cowork-slide-canvas .dropdown-menu', (menu) => menu.textContent || "");
  assert.match(presentationMenuText, /Export PDF/);
  assert.doesNotMatch(presentationMenuText, /Export Image/);
  await page.screenshot({ path: "/tmp/1helm-presentation-menu.png" });
  await page.click('.cowork-slide-canvas .main-menu-trigger');
  await collaboratorPage.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Presentations")?.click());
  await collaboratorPage.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("review.slides.json"));
  await collaboratorPage.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("review.slides.json"))?.click());
  await collaboratorPage.waitForSelector('[data-cowork-presentation][data-slide-count="1"]');
  assert.ok(await page.$eval('.cowork-slide-canvas', (canvas) => Number(canvas.dataset.sceneElements || 0)) > 0);
  assert.ok(await collaboratorPage.$eval('.cowork-slide-canvas', (canvas) => Number(canvas.dataset.sceneElements || 0)) > 0);
  await page.evaluate(() => [...document.querySelectorAll('.cowork-editor-toolbar button')].find((button) => button.textContent.includes("Slide"))?.click());
  await page.waitForSelector('[data-cowork-presentation][data-slide-count="2"]');
  await page.waitForSelector('.cowork-slide-canvas[data-initial-fit="complete"]');
  await collaboratorPage.waitForSelector('[data-cowork-presentation][data-slide-count="2"]');
  await page.evaluate(() => [...document.querySelectorAll('.cowork-editor-toolbar button')].find((button) => button.textContent.trim() === "Duplicate")?.click());
  await page.waitForSelector('[data-cowork-presentation][data-slide-count="3"]');
  await page.evaluate(() => {
    const active = document.querySelector('.cowork-slide-thumb.is-active');
    active?.querySelector('[title="Move slide up"]')?.click();
  });
  const orderAfterMove = await waitFor(async () => {
    const slides = JSON.parse((await api(`/api/channels/${channel.id}/files/text?path=presentations%2Freview.slides.json`, {}, token)).file.content).slides;
    return slides.length === 3 && /copy/i.test(slides[1]?.name || "") ? slides.map((slide) => slide.name) : null;
  }, "reordered presentation slides");
  assert.equal(orderAfterMove.length, 3);
  await page.waitForSelector('[data-cowork-presentation][data-slide-count="3"]');
  await page.evaluate(() => [...document.querySelectorAll('.cowork-editor-toolbar button')].find((button) => button.textContent.trim() === "Delete")?.click());
  await waitFor(async () => JSON.parse((await api(`/api/channels/${channel.id}/files/text?path=presentations%2Freview.slides.json`, {}, token)).file.content).slides.length === 2, "deleted presentation slide");
  await page.waitForFunction(() => document.querySelector('[data-cowork-presentation]')?.dataset.slideCount === "2");
  await page.$eval('[aria-label="Printable width"]', (input) => { input.value = "1600"; input.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForSelector('.cowork-slide-canvas[data-printable-width="1600"]');
  await page.$eval('[aria-label="Printable height"]', (input) => { input.value = "900"; input.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForSelector('.cowork-slide-canvas[data-printable-width="1600"][data-printable-height="900"]');
  const persistedDeck = await waitFor(async () => {
    const parsed = JSON.parse((await api(`/api/channels/${channel.id}/files/text?path=presentations%2Freview.slides.json`, {}, token)).file.content);
    return parsed.version === 3 && parsed.printableArea?.width === 1600 && parsed.printableArea?.height === 900 ? parsed : null;
  }, "custom printable area persistence");
  assert.equal(persistedDeck.slides.flatMap((slide) => slide.scene?.elements || []).some((element) => element.id === "1helm-printable-area-boundary"), false,
    "the locked editing boundary never becomes persisted slide content");

  await page.click('.cowork-slide-canvas .main-menu-trigger');
  await page.waitForSelector('.cowork-slide-canvas .dropdown-menu');
  await page.evaluate(() => [...document.querySelectorAll('.cowork-slide-canvas .dropdown-menu-item')].find((item) => item.textContent?.trim() === "Export PDF")?.click());
  const pdfPath = await waitFor(() => {
    const file = readdirSync(downloadDir).find((name) => name.endsWith(".pdf") && !name.endsWith(".crdownload"));
    return file ? join(downloadDir, file) : null;
  }, "complete presentation PDF download", 30_000);
  const exportedPdf = await PDFDocument.load(readFileSync(pdfPath));
  assert.equal(exportedPdf.getPageCount(), 2, "Export PDF emits the entire deck as one two-page document");
  assert.deepEqual(exportedPdf.getPages().map((pdfPage) => ({ width: pdfPage.getWidth(), height: pdfPage.getHeight() })),
    [{ width: 1600, height: 900 }, { width: 1600, height: 900 }], "every PDF page uses the exact custom printable dimensions");
  await page.evaluate(() => [...document.querySelectorAll('.cowork-editor-toolbar button')].find((button) => button.textContent.trim() === "Present")?.click());
  await page.waitForSelector('[role="dialog"][aria-label="Presentation mode"]');
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Presentation mode"]'));
  await page.evaluate(() => [...document.querySelectorAll('.cowork-editor-toolbar button')].find((button) => button.textContent.trim() === "Save")?.click());
  await waitFor(async () => JSON.parse((await api(`/api/channels/${channel.id}/files/text?path=presentations%2Freview.slides.json`, {}, token)).file.content).slides.length === 2, "saved presentation structure");

  // Unsupported binaries stay simple and safe.
  writeFileSync(join(dataDir, "channels", String(channel.id), "workspace", "code", "data.db"), Buffer.from("SQLite payload"));
  await page.evaluate(() => [...document.querySelectorAll('[aria-label="Cowork sections"] button')].find((button) => button.textContent.trim() === "Code")?.click());
  await page.waitForFunction(() => document.querySelector('[data-cowork-files]')?.textContent.includes("data.db"));
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent.includes("data.db"))?.click());
  await page.waitForFunction(() => /not supported to view/i.test(document.querySelector('[data-cowork-viewport]')?.textContent || ""));
  await page.screenshot({ path: "/tmp/1helm-cowork-desktop.png" });

  // Files behaves like a bounded file browser and all familiar CRUD actions
  // operate on the same tree Cowork has just edited.
  await page.goto(`${base}/c/${channel.slug}/files`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-file-browser]');
  const rootFolders = await page.$$eval('[data-file-directory="/"] [data-file-kind="directory"]', (items) => items.map((item) => ({ name: item.textContent, folderIcon: Boolean(item.querySelector('.file-grid-icon.is-folder')) })));
  assert.ok(["notes", "whiteboards", "code", "docs", "presentations"].every((name) => rootFolders.some((item) => item.name.includes(name) && item.folderIcon)));
  const treeBeforeOther = await page.$$eval('[data-file-folder-tree] [data-file-tree-path]', (items) => items.map((item) => item.getAttribute("data-file-tree-path")));
  assert.deepEqual(treeBeforeOther.filter((path) => path === "/" || !path.includes("/")).slice(0, 6), ["/", "notes", "whiteboards", "code", "docs", "presentations"]);
  assert.equal(treeBeforeOther.includes("archive"), false, "Other starts collapsed");
  await page.click('[data-file-other-toggle]');
  await page.waitForSelector('[data-file-tree-path="archive"]');
  await page.waitForSelector('[data-file-tree-path="README.md"]');
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
  assert.equal(await page.$eval('[data-file-metadata] [data-download-docx]', (button) => button.textContent.trim()), "Download - DOCX");
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

  // Desktop navigation collapses to a compact rail, gives the main surface
  // the reclaimed width, persists through a shell reload, and expands again.
  const expandedWidth = await page.$eval('[data-sidebar="desktop"]', (sidebar) => sidebar.getBoundingClientRect().width);
  const mainWidthBeforeCollapse = await page.$eval('#main', (main) => main.getBoundingClientRect().width);
  await page.click('[data-sidebar="desktop"] [data-sidebar-collapse-toggle]');
  await page.waitForSelector('[data-sidebar="desktop"][data-sidebar-collapsed="true"]');
  const collapsedLayout = await page.evaluate(() => ({
    sidebar: document.querySelector('[data-sidebar="desktop"]').getBoundingClientRect().width,
    main: document.querySelector('#main').getBoundingClientRect().width,
  }));
  assert.ok(collapsedLayout.sidebar < expandedWidth && collapsedLayout.main > mainWidthBeforeCollapse, JSON.stringify(collapsedLayout));
  await waitFor(async () => (await api("/api/me/ui-state", {}, token)).state.desktop_sidebar_collapsed === true, "persisted desktop sidebar collapse");
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('[data-sidebar="desktop"][data-sidebar-collapsed="true"] [aria-label="Expand navigation"]');
  await page.click('[data-sidebar="desktop"] [data-sidebar-collapse-toggle]');
  await page.waitForSelector('[data-sidebar="desktop"][data-sidebar-collapsed="false"]');

  // On a phone, a deliberate upward finger drag blurs the composer (so the OS
  // keyboard can dismiss). Programmatic / keyboard-reflow scrolls must not.
  // Settings navigation stays compact, and the visible viewport owns the
  // application height without clipping below the screen.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.goto(`${base}/c/${channel.slug}/chat`, { waitUntil: "networkidle0" });
  await page.waitForSelector('#msgs');
  const mobile = await page.evaluate(async () => {
    const input = document.querySelector('textarea[data-composer-parent="root"]');
    const messages = document.getElementById("msgs");
    // Guarantee a scrollable conversation so upward drag can change scrollTop.
    if (messages.scrollHeight <= messages.clientHeight + 40) {
      const pad = document.createElement("div");
      pad.style.height = "1200px";
      pad.setAttribute("data-test-scroll-pad", "");
      messages.append(pad);
    }
    input.focus();
    // installMobileViewportBehavior ignores blur during the post-focus settle window.
    await new Promise((resolve) => setTimeout(resolve, 750));
    const fireTouch = (type, clientY) => {
      const target = messages;
      const touchInit = { identifier: 1, target, clientX: 120, clientY, pageX: 120, pageY: clientY, screenX: 120, screenY: clientY, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 };
      const touch = typeof Touch === "function" ? new Touch(touchInit) : touchInit;
      const list = type === "touchend" || type === "touchcancel" ? [] : [touch];
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        touches: list,
        targetTouches: list,
        changedTouches: [touch],
      }));
    };
    // Finger moves down the screen → content scrolls toward history (touchDraggedUp).
    fireTouch("touchstart", 420);
    fireTouch("touchmove", 480);
    messages.scrollTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
    messages.dispatchEvent(new Event("scroll", { bubbles: true }));
    messages.scrollTop = Math.max(0, messages.scrollTop - 160);
    messages.dispatchEvent(new Event("scroll", { bubbles: true }));
    fireTouch("touchend", 480);
    const shell = document.querySelector(".workspace-shell")?.getBoundingClientRect();
    return {
      blurred: document.activeElement !== input,
      shellBottom: shell?.bottom,
      viewport: innerHeight,
      cssHeight: getComputedStyle(document.documentElement).getPropertyValue("--app-viewport-height"),
      scrollable: messages.scrollHeight > messages.clientHeight,
    };
  });
  assert.equal(mobile.blurred, true, JSON.stringify(mobile));
  assert.ok(Math.abs(mobile.shellBottom - mobile.viewport) <= 1 && mobile.cssHeight.endsWith("px"), JSON.stringify(mobile));
  await page.click('[aria-label="Open navigation"]');
  await page.waitForSelector('[data-sidebar="mobile"] [aria-label="Open settings"]');
  assert.equal(await page.$('[data-sidebar="mobile"] [data-sidebar-collapse-toggle]'), null, "desktop collapse never changes the mobile drawer");
  await page.evaluate(() => document.querySelector('[data-sidebar="mobile"] [aria-label="Open settings"]')?.click());
  await page.waitForSelector('[aria-label="Settings sections"]');
  const settings = await page.$eval('[aria-label="Settings sections"]', (nav) => ({ height: nav.getBoundingClientRect().height, width: nav.getBoundingClientRect().width, scrolls: nav.scrollWidth > nav.clientWidth }));
  assert.ok(settings.height < 90 && settings.width >= 380 && settings.scrolls, JSON.stringify(settings));
  await page.screenshot({ path: "/tmp/1helm-mobile-settings.png" });
  assert.deepEqual(errors.filter((message) => message !== "Failed to load resource: the server responded with a status of 400 (Bad Request)"), []);
});
