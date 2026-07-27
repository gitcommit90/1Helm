import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";

const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";

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
    cwd: root, env: { ...process.env, NODE_ENV: "test", CTRL_DATA_DIR: dataDir, PORT: String(appPort), IMPROVEMENT_INTERVAL_MS: "600000", HELM_CHANNEL_COMPUTER_BACKEND: "native" }, stdio: "ignore",
  });
  await waitFor(async () => (await fetch(`${base}/api/setup/status`).catch(() => null))?.ok, "app");
  const registration = await api("/api/auth/register", { body: { username: "captain", password: "secret-pass", display: "Captain" } });
  const token = registration.token;
  const provider = await api("/api/providers", { body: { name: "Mock", base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: "test" } }, token);
  await api("/api/setup/complete", { body: { name: "Browser Brief", terminals_enabled: true, provider_id: provider.provider.id, model: "mock-large" } }, token);
  const channel = (await api("/api/channels", { body: { name: "Visual", purpose: "Exercise the brief regressions." } }, token)).channel;
  const extensionlessNote = await api(`/api/channels/${channel.id}/notes`, { body: { name: "Quiet refresh proof", content: "# Durable note\n\nStart here." } }, token);
  ok(extensionlessNote.note.name === "Quiet refresh proof.md", "extensionless note titles are normalized to .md by the API");
  const securityResponse = await fetch(base);
  ok(/(?:^|;)\s*frame-src 'self' blob:(?:;|$)/.test(securityResponse.headers.get("content-security-policy") || ""), "the web control plane permits only same-origin and blob frames for safe PDF preview");
  ok(/(?:^|;)\s*media-src 'self' blob:(?:;|$)/.test(securityResponse.headers.get("content-security-policy") || ""), "the web control plane permits only same-origin and blob media for safe audio/video preview");
  const rootMessage = (await api(`/api/channels/${channel.id}/messages`, { body: { body: `@${channel.agent.name} run whoami` } }, token)).message;
  await waitFor(async () => {
    const thread = await api(`/api/messages/${rootMessage.id}/thread`, {}, token);
    return thread.replies?.find((reply) => reply.author.name === channel.agent.name && /Answer complete/.test(reply.body || ""));
  }, "agent reply");
  // Schedule early on an independent lane so later visual fixtures cannot make
  // countdown acceptance depend on draining unrelated message work.
  const followupRoot = (await api(`/api/channels/${channel.id}/messages`, {
    body: { body: `@${channel.agent.name} schedule followup for the browser follow-up countdown because an async download is still running` },
  }, token)).message;
  await waitFor(async () => (await api(`/api/messages/${followupRoot.id}/thread`, {}, token)).followup, "persisted browser follow-up", 15_000);
  for (let index = 0; index < 10; index++) {
    await api(`/api/channels/${channel.id}/messages`, { body: { body: `Scroll fixture ${index + 1}: ${"stable viewport words ".repeat(32)}`, parentId: rootMessage.id } }, token);
  }
  for (let index = 0; index < 14; index++) {
    await api(`/api/channels/${channel.id}/messages`, { body: { body: `Board overflow fixture ${index + 1}` } }, token);
  }
  const pdfUploadResponse = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/pdf", "x-filename": "preview-proof.pdf" },
    body: "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n",
  });
  const pdfUpload = await pdfUploadResponse.json();
  const pdfMessage = (await api(`/api/channels/${channel.id}/messages`, { body: { body: "Safe PDF preview fixture", uploads: [pdfUpload] } }, token)).message;
  const audioUploadResponse = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "audio/wav", "x-filename": "preview-proof.wav" },
    body: "RIFF0000WAVEfmt ",
  });
  const audioUpload = await audioUploadResponse.json();
  const audioMessage = (await api(`/api/channels/${channel.id}/messages`, { body: { body: "Safe audio preview fixture", uploads: [audioUpload] } }, token)).message;

  // Photon is already configured by this point in a real workspace. Seed only
  // the host-owned credential marker and one private conversation so browser
  // acceptance can exercise the Texts UI without an external Photon account.
  writeFileSync(join(dataDir, "photon-credentials.json"), JSON.stringify({ project_id: "browser-fixture", project_secret: "stored-outside-renderer", operator_phone: "+15551234567", assigned_phone: "+15557654321", configured_at: Date.now() }), { mode: 0o600 });
  await api("/api/testing/photon", { body: { event: { id: "browser-phone-1", space_id: "browser-space", space_type: "dm", sender: "+15551234567", text: "Phone hello", timestamp: new Date().toISOString() } } }, token);
  const textConversation = (await api("/api/texts", {}, token)).conversations[0].id;

  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  await page.goto(base, { waitUntil: "networkidle0" });
  // A first-ever service-worker claim can trigger one intentional soft reload.
  // Retry the read across that navigation instead of making fresh CI profiles flaky.
  const authBrand = await waitFor(() => page.evaluate(() => ({
      heading: document.querySelector("h2")?.textContent || "",
      src: document.querySelector(".logo-asset")?.getAttribute("src") || "",
      loaded: document.querySelector(".logo-asset") instanceof HTMLImageElement
        && document.querySelector(".logo-asset").complete
        && document.querySelector(".logo-asset").naturalWidth > 0,
    })).catch(() => null), "stable bridge login after service-worker claim", 5_000);
  ok(authBrand.heading === "Enter the bridge" && authBrand.src === "/brand/1helm-sailboat.png" && authBrand.loaded,
    "the bridge login displays the current sailboat artwork");
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
  ok(brand.favicon === "/brand/1helm-sailboat.png" && brand.workspaceLogo === "/brand/1helm-sailboat.png", "the sailboat is the web favicon and default customizable workspace image");

  await page.goto(`${base}/c/${channel.slug}/cowork`, { waitUntil: "networkidle0" });
  await page.evaluate(() => [...document.querySelectorAll('[data-cowork-files] button')].find((button) => button.textContent?.includes("Quiet refresh proof.md"))?.click());
  await page.waitForFunction(() => document.querySelector('[aria-label="Notes editor"] .cm-content')?.textContent.includes("Start here"));
  await page.click('[aria-label="Notes editor"] .cm-content');
  await page.keyboard.down(primaryModifier); await page.keyboard.press("a"); await page.keyboard.up(primaryModifier); await page.keyboard.press("ArrowRight");
  await page.keyboard.type("\n\nUnsaved words survive.");
  await page.click('[aria-label="Notes editor"] .cm-line');
  await page.keyboard.down(primaryModifier); await page.keyboard.press("a"); await page.keyboard.up(primaryModifier); await page.keyboard.press("ArrowLeft");
  for (let index = 0; index < 2; index++) await page.keyboard.press("ArrowRight");
  await page.keyboard.down("Shift"); for (let index = 0; index < 7; index++) await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift");
  await page.evaluate(() => {
    const editor = document.querySelector('[aria-label="Notes editor"] .cm-content');
    window.__briefNoteEditor = editor;
  });
  const themeBeforeNotesRefresh = await page.evaluate(() => document.documentElement.className);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => /Switch to/.test(button.title))?.click());
  await page.waitForFunction((prior) => document.documentElement.className !== prior, {}, themeBeforeNotesRefresh);
  const durableNote = await page.evaluate(() => {
    const editor = document.querySelector('[aria-label="Notes editor"] .cm-content');
    return {
      sameNode: editor === window.__briefNoteEditor,
      value: [...document.querySelectorAll('[aria-label="Notes editor"] .cm-line')].map((line) => line.textContent).join("\n"),
      focused: document.activeElement === editor,
    };
  });
  ok(durableNote.sameNode && durableNote.value === "# Durable note\n\nStart here.\n\nUnsaved words survive." && durableNote.focused,
    "shell refreshes preserve the exact note editor node, unsaved draft, and focus");
  await page.keyboard.type("Steady");
  ok(await page.$eval('[aria-label="Notes editor"] .cm-content', (editor) => editor.textContent.startsWith("# Steady note") && editor.textContent.endsWith("Unsaved words survive.")),
    "shell refreshes preserve the authoritative CodeMirror selection");
  await page.evaluate(() => [...document.querySelectorAll('.cowork-editor-toolbar button')].find((button) => button.textContent?.trim() === "Preview")?.click());
  await page.waitForSelector('.cowork-markdown-preview:not(.hidden)');
  ok(await page.$eval('.cowork-markdown-preview', (element) => /Unsaved words survive/.test(element.textContent)), "Cowork note preview renders the current unsaved Markdown draft");

  await api(`/api/channels/${channel.id}`, { method: "PATCH", body: { purpose: "A deliberately long channel description that must remain one calm truncated line even when a large-monitor user narrows the remote application window. ".repeat(5) } }, token);
  await page.setViewport({ width: 1280, height: 760 });
  await page.goto(`${base}/c/${channel.slug}/chat`, { waitUntil: "networkidle0" });
  const compactHeader = await page.$eval("#hdr", (header) => {
    const purpose = [...header.querySelectorAll('[title]')].find((element) => element.title.startsWith("A deliberately long channel description"));
    const style = purpose ? getComputedStyle(purpose) : null;
    return { headerHeight: header.getBoundingClientRect().height, purposeWidth: purpose?.getBoundingClientRect().width || 0, purposeHeight: purpose?.getBoundingClientRect().height || 0, lineHeight: style ? parseFloat(style.lineHeight) : 0, overflow: style?.overflow, whitespace: style?.whiteSpace, textOverflow: style?.textOverflow };
  });
  ok(compactHeader.headerHeight < 72 && (compactHeader.purposeWidth === 0 || (compactHeader.purposeHeight <= compactHeader.lineHeight + 1 && compactHeader.overflow === "hidden" && compactHeader.whitespace === "nowrap" && compactHeader.textOverflow === "ellipsis")),
    `narrow desktop headers keep long channel descriptions to one truncated line instead of one letter per row (${JSON.stringify(compactHeader)})`);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.goto(`${base}/c/${channel.slug}/chat`, { waitUntil: "networkidle0" });
  const phoneHeader = await page.evaluate(() => {
    const header = document.getElementById("hdr");
    const title = document.querySelector("[data-mobile-header-title]");
    const actions = document.querySelector("[data-mobile-header-actions]");
    const headerRect = header?.getBoundingClientRect();
    const titleRect = title?.getBoundingClientRect();
    const actionRect = actions?.getBoundingClientRect();
    const controls = [...(actions?.querySelectorAll("button") || [])].map((button) => button.getBoundingClientRect());
    return {
      twoRows: Boolean(titleRect && actionRect && titleRect.bottom <= actionRect.top + 1),
      rightAligned: Boolean(headerRect && actionRect && Math.abs(actionRect.right - headerRect.right) <= 10),
      controlsFit: Boolean(actionRect && controls.every((rect) => rect.left >= actionRect.left - 1 && rect.right <= actionRect.right + 1 && rect.width >= 43 && rect.height >= 43)),
      pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  });
  ok(phoneHeader.twoRows && phoneHeader.rightAligned && phoneHeader.controlsFit && phoneHeader.pageFits,
    `phone channel chrome uses a safe title row plus right-aligned 44px actions without horizontal overflow (${JSON.stringify(phoneHeader)})`);
  await page.evaluate(() => document.querySelector('[data-quick-note-header]')?.click());
  await page.waitForSelector('[role="dialog"][aria-label="Quick Note"]');
  const phoneNotes = await page.evaluate(() => {
    const surface = document.querySelector('[role="dialog"][aria-label="Quick Note"]');
    const buttons = [...(surface?.querySelectorAll("button") || [])];
    return {
      visible: buttons.length >= 4 && buttons.every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
      }),
      pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  });
  ok(phoneNotes.visible && phoneNotes.pageFits, "phone Quick Note keeps dictation, collapse, Discard, and Save visible inside the viewport");
  await page.evaluate(() => document.querySelector('[aria-label="Collapse Quick Note"]')?.click());
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  await page.goto(`${base}/c/main/texts`, { waitUntil: "networkidle0" });
  await page.waitForSelector(`[data-texts-messages="${textConversation}"]`);
  ok(await page.$eval("body", (body) => body.innerText.includes("Phone hello") && body.innerText.includes("Phone") && body.innerText.includes("Texts")), "configured Photon exposes a private #main Texts inbox with phone-originated history");
  const outboundBeforeDesktop = (await api("/api/testing/photon", { body: {} }, token)).outbound;
  await page.type(`[data-texts-composer="${textConversation}"]`, "Continue from desktop");
  await page.click(`[data-texts-composer="${textConversation}"] + button`);
  await page.waitForFunction(() => document.body.innerText.includes("Continue from desktop"));
  await page.waitForFunction(() => document.querySelector('[data-texts-messages]')?.innerText.includes("Answer complete"), { timeout: 10_000 });
  const outboundAfterDesktop = (await api("/api/testing/photon", { body: {} }, token)).outbound;
  ok(outboundAfterDesktop === outboundBeforeDesktop, "desktop Texts continuation shares Skipper context without echoing app messages back to iMessage");

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/c/${channel.slug}/thread/${rootMessage.id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#thread:not(.hidden)");
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
    window.__briefChannelRootRow = document.querySelector(`[data-message-surface="channel"][data-message-id="${parentId}"]`);
    window.__briefChannelRootBody = window.__briefChannelRootRow?.querySelector('[data-live-slot="body"]');
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
    const live = [...(scroller?.querySelectorAll('[data-message-surface="thread"]') || [])].find((row) => /Live stream update/.test(row.textContent || ""));
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
      liveMessageId: live?.getAttribute("data-message-id") || "",
      sameChannelRow: document.querySelector(`[data-message-surface="channel"][data-message-id="${parentId}"]`) === window.__briefChannelRootRow,
      sameChannelBody: document.querySelector(`[data-message-surface="channel"][data-message-id="${parentId}"] [data-live-slot="body"]`) === window.__briefChannelRootBody,
    };
  }, { parentId: rootMessage.id, priorTop: streamState.scrollTop });
  ok(stableStream.sameNode && stableStream.connected && stableStream.focused
    && stableStream.value === "draft remains focused during stream"
    && stableStream.selectionStart === 6 && stableStream.selectionEnd === 13
    && Math.abs(stableStream.scrollTop - stableStream.priorTop) <= 1 && stableStream.visible
    && stableStream.sameChannelRow && stableStream.sameChannelBody,
  "streaming agent updates preserve both channel nodes plus the exact focused thread composer, selection, draft, and scroll position");
  await page.evaluate((messageId) => {
    const row = document.querySelector(`[data-message-surface="thread"][data-message-id="${messageId}"]`);
    window.__briefLiveMessageRow = row;
    window.__briefLiveMessageBody = row?.querySelector('[data-live-slot="body"]');
  }, stableStream.liveMessageId);
  await sleep(220);
  const stableLiveNodes = await page.evaluate((messageId) => {
    const row = document.querySelector(`[data-message-surface="thread"][data-message-id="${messageId}"]`);
    return { sameRow: row === window.__briefLiveMessageRow, sameBody: row?.querySelector('[data-live-slot="body"]') === window.__briefLiveMessageBody };
  }, stableStream.liveMessageId);
  ok(stableLiveNodes.sameRow && stableLiveNodes.sameBody, "streaming preserves the exact message row and rendered body nodes across live updates");
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
  await page.waitForSelector('#channelview [data-file-path="README.md"]', { timeout: 5000 });
  ok(true, "Files upload imports a selected file directly into the channel workspace");
  await page.evaluate(() => [...document.querySelectorAll("nav button")].find((button) => button.textContent.includes("Activity"))?.click());
  await page.waitForFunction(() => document.getElementById("channelview")?.innerText.includes("Ran work in the resident workspace → complete."));
  const activityApi = await api(`/api/channels/${channel.id}/activity`, {}, token);
  const actionId = activityApi.actions.find((action) => action.tool === "run_command")?.id;
  const activityEvidence = await page.evaluate((expectedActionId) => {
    const rows = [...document.querySelectorAll(`#channelview details[data-action-id="${expectedActionId}"]`)];
    const element = rows[0];
    element?.querySelector("summary")?.click();
    return { rows: rows.length, text: element?.textContent || "", open: element?.open };
  }, actionId);
  ok(activityEvidence.rows === 1 && activityEvidence.open && /Input/.test(activityEvidence.text) && /Outcome evidence/.test(activityEvidence.text) && /status=completed/.test(activityEvidence.text),
    "Activity mutates one outcome-first row and expands to the retained input and outcome evidence");
  await page.evaluate(() => [...document.querySelectorAll("nav button")].find((button) => button.textContent.includes("Chat"))?.click());
  await page.waitForSelector('textarea[data-composer-parent="root"]');
  const restoredDraft = await page.$eval('textarea[data-composer-parent="root"]', (element) => element.value);
  ok(restoredDraft === "draft survives navigation", "user/channel/thread-scoped drafts survive navigation");

  const questionRequest = await api(`/api/channels/${channel.id}/messages`, { body: { body: `@${channel.agent.name} ask me structured multiple choice` } }, token);
  const questionReply = await waitFor(async () => {
    const thread = await api(`/api/messages/${questionRequest.message.id}/thread`, {}, token);
    return thread.replies?.find((reply) => reply.questions?.status === "pending");
  }, "structured interview");
  await page.goto(`${base}/c/${channel.slug}/thread/${questionRequest.message.id}`, { waitUntil: "networkidle0" });
  await page.waitForSelector('#thread [aria-pressed="false"]');
  const selectedLabel = await page.$eval('#thread [aria-pressed="false"]', (button) => { button.click(); return button.querySelector("span")?.textContent || button.textContent || ""; });
  await page.waitForFunction(() => Boolean(document.querySelector('#thread [aria-pressed="true"]')));
  await page.evaluate((messageId) => {
    const row = document.querySelector(`[data-message-surface="thread"][data-message-id="${messageId}"]`);
    window.__briefQuestionRow = row;
  }, questionReply.id);
  await api(`/api/channels/${channel.id}/messages`, { body: { body: "unrelated live repaint fixture", parentId: questionRequest.message.id } }, token);
  await sleep(250);
  const questionSelection = await page.evaluate(({ messageId, selected }) => {
    const row = document.querySelector(`[data-message-surface="thread"][data-message-id="${messageId}"]`);
    const selectedButton = row?.querySelector('[aria-pressed="true"]');
    return { sameRow: row === window.__briefQuestionRow, selected: (selectedButton?.textContent || "").includes(selected) };
  }, { messageId: questionReply.id, selected: selectedLabel.trim() });
  ok(questionSelection.sameRow && questionSelection.selected, "structured-question selection survives a live thread repaint and keeps the same row");
  await page.$eval('#thread button', (_button) => undefined);
  await page.evaluate(() => [...document.querySelectorAll('#thread button')].find((button) => button.textContent?.trim() === "Continue")?.click());
  await page.waitForFunction(() => document.getElementById("thread")?.innerText.includes("Interview answered"));
  const answered = await api(`/api/messages/${questionRequest.message.id}/thread`, {}, token);
  const savedAnswer = answered.replies.find((reply) => reply.id === questionReply.id)?.questions?.answers?.[0]?.values || [];
  ok(savedAnswer.length === 1 && savedAnswer[0] === selectedLabel.trim(), "clicking a structured option submits exactly one authoritative single-select value");

  await page.evaluate(() => [...document.querySelectorAll("nav button")].find((button) => button.textContent.includes("Files"))?.click());
  await page.waitForSelector('#channelview [data-file-path="README.md"]');
  await page.click('#channelview [data-file-path="README.md"]');
  await page.waitForFunction(() => document.querySelector('[data-file-metadata]')?.textContent?.includes("README.md"));
  const fileActions = await page.$$eval("[data-file-metadata] button", (buttons) => buttons.map((button) => button.textContent?.trim()).filter((text) => text === "Open" || text === "Download"));
  ok(fileActions.includes("Open") && fileActions.includes("Download"), "Files exposes explicit authenticated Open and Download actions");
  await page.evaluate(() => [...document.querySelectorAll('[data-file-metadata] button')].find((button) => button.textContent?.trim() === "Open")?.click());
  await page.waitForSelector('[role="dialog"][aria-label^="Preview "]');
  ok(await page.$eval('[role="dialog"]', (dialog) => /README\.md/.test(dialog.textContent || "") && /Download/.test(dialog.textContent || "")), "Files opens an authenticated in-app preview with its own download action");
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.trim() === "Close")?.click());
  await page.goto(`${base}/c/${channel.slug}`, { waitUntil: "networkidle0" });
  await page.waitForSelector(`[data-message-id="${pdfMessage.id}"] button`);
  await page.evaluate((messageId) => [...document.querySelectorAll(`[data-message-id="${messageId}"] button`)].find((button) => button.textContent?.trim() === "Open")?.click(), pdfMessage.id);
  await page.waitForSelector('[role="dialog"] iframe');
  ok(await page.$eval('[role="dialog"] iframe', (frame) => frame.getAttribute("src")?.startsWith("blob:") && frame.getAttribute("title") === "preview-proof.pdf"), "a PDF attachment opens inside the authenticated in-app blob iframe");
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.trim() === "Close")?.click());
  await page.evaluate((messageId) => [...document.querySelectorAll(`[data-message-id="${messageId}"] button`)].find((button) => button.textContent?.trim() === "Open")?.click(), audioMessage.id);
  await page.waitForSelector('[role="dialog"] audio');
  ok(await page.$eval('[role="dialog"] audio', (media) => media.getAttribute("src")?.startsWith("blob:") && media.hasAttribute("controls")), "an audio attachment opens in the authenticated in-app blob player");
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.trim() === "Close")?.click());

  await page.click('button[title="Settings"]');
  await page.waitForFunction(() => document.body.innerText.includes("Skipper computers") && document.body.innerText.includes("Connections"));
  const settingsGeometry = await page.evaluate(() => {
    const overlay = document.querySelector(".fixed.inset-0.z-40");
    const sidebar = overlay?.querySelector('nav[aria-label="Settings sections"]');
    return { sidebar: Boolean(sidebar), page: Boolean(overlay), coversViewport: overlay ? overlay.getBoundingClientRect().width >= innerWidth - 2 : false };
  });
  ok(settingsGeometry.sidebar && settingsGeometry.page && settingsGeometry.coversViewport, "Settings opens as a full-screen application page with desktop sidebar navigation");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Providers")?.click());
  await page.waitForSelector(".routing-fabric");
  const fabricText = await page.$eval(".routing-fabric", (element) => element.textContent || "");
  const fabricAria = await page.$eval(".routing-fabric-svg", (element) => element.getAttribute("aria-label") || "");
  ok(/REQUESTS/.test(fabricText) && /1HELM ROUTER/.test(fabricText) && /routed provider/.test(fabricAria), "Providers visualizes the live dotted Requests → 1Helm Router → provider flow");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Close settings" || button.textContent?.trim() === "Close")?.click());
  await page.goto(`${base}/c/${channel.slug}`, { waitUntil: "networkidle0" });

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
      everyLaneVertical: laneRects.every((rect) => rect.top >= scrollRect.top - 1 && rect.bottom <= scrollRect.bottom + 1),
    };
  });
  ok(boardGeometry.pageFits && boardGeometry.viewFits && boardGeometry.lanesFit && boardGeometry.everyLaneFits && boardGeometry.everyLaneVertical,
    "Board lanes wrap within the viewport without horizontal or vertical spill");
  const laneScroll = await page.evaluate(() => {
    const cards = document.querySelector('[data-board-status="open"] .board-lane-cards');
    const last = cards?.lastElementChild;
    if (!(cards instanceof HTMLElement) || !(last instanceof HTMLElement)) return null;
    const before = cards.scrollTop;
    cards.scrollTop = cards.scrollHeight;
    const cardsRect = cards.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    return {
      overflows: cards.scrollHeight > cards.clientHeight,
      before,
      after: cards.scrollTop,
      lastReachable: lastRect.bottom <= cardsRect.bottom + 1 && lastRect.top >= cardsRect.top - 1,
    };
  });
  ok(laneScroll?.overflows && laneScroll.before === 0 && laneScroll.after > 0 && laneScroll.lastReachable,
    "a crowded Board swim lane scrolls vertically until its final task is reachable");

  await page.evaluate(() => [...document.querySelectorAll("nav button")].find((button) => button.textContent.includes("Terminal"))?.click());
  await page.waitForSelector(".xterm");
  await sleep(400);
  const terminal = await page.$eval(".xterm", (element) => ({ height: element.getBoundingClientRect().height, rows: element.querySelector(".xterm-rows")?.children.length || 0 }));
  ok(terminal.height > 500 && terminal.rows >= 20, "channel terminal opens as a full-height terminal instead of a thin line");
  await page.click(".xterm-helper-textarea");
  await page.keyboard.type("cd /tmp"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => /:\/tmp[$#]/.test(document.querySelector(".xterm-rows")?.textContent || ""));
  ok(true, "the terminal prompt visibly reports the current path and changes after cd");

  await page.goto(`${base}/c/${channel.slug}/thread/${followupRoot.id}`, { waitUntil: "networkidle0" });
  // Hydration must work even if the socket event raced with navigation.
  if (!(await page.$("[data-thread-followup]"))) await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("[data-thread-followup]", { timeout: 10_000 });
  const firstCountdown = await page.$eval("[data-thread-followup]", (element) => ({
    text: element.textContent || "",
    seconds: Number((element.querySelector("[data-thread-followup-countdown]")?.textContent || "").match(/(\d+)s/)?.[1] || -1),
  }));
  await sleep(1_150);
  const secondCountdown = await page.$eval("[data-thread-followup-countdown]", (element) => Number((element.textContent || "").match(/(\d+)s/)?.[1] || -1));
  ok(firstCountdown.text.includes(`@${channel.agent.name} will check back in`) && firstCountdown.seconds > secondCountdown,
    "a persisted resident follow-up appears in the open thread and counts down live");
  ok(browserErrors.length === 0, "the regression browser flow has no console or page errors");
} catch (error) {
  fail++;
  console.error("  FAIL-", error.stack || error.message);
} finally {
  await browser?.close().catch(() => undefined);
  for (const child of [app, mock]) if (child && child.exitCode == null) child.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
