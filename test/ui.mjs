import puppeteer from "puppeteer";

const B = process.env.BASE || "http://localhost:8123";
const MOCK = "http://localhost:9099/v1";
const uniq = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  ok  -", l); } else { fail++; console.log("  FAIL-", l); } };

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERR: " + e.message));

const $ = async (sel, t = 5000) => { await page.waitForSelector(sel, { timeout: t }); return page.$(sel); };
const typeInto = async (sel, text) => { const el = await $(sel); await el.click({ clickCount: 3 }); await el.type(text); };
const clickText = async (tag, text) => { const h = await page.evaluateHandle((tag, text) => { const els = [...document.querySelectorAll(tag)]; return els.find((e) => e.textContent.trim() === text) || els.reverse().find((e) => e.textContent.includes(text)); }, tag, text); const el = h.asElement(); if (!el) throw new Error(`no ${tag} "${text}"`); await el.click(); };

try {
  // ---- register (first user = admin) ----
  await page.goto(B, { waitUntil: "networkidle0" });
  await clickText("button", "Create an account");
  await typeInto('input[placeholder="username"]', "admin" + uniq);
  await typeInto('input[placeholder="display name (optional)"]', "Ada Admin");
  await typeInto('input[placeholder="password"]', "secret1");
  await clickText("button", "Create account");
  await $('aside');
  ok(true, "registered and entered workspace");
  ok(await page.$eval("body", (b) => b.textContent.includes("CTRL PANE")), "workspace shows CTRL PANE");
  ok(await page.$eval("body", (b) => b.textContent.includes("general")), "default #general channel present");

  // ---- post a message ----
  await typeInto("textarea", "Hello from Puppeteer");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#msgs")?.textContent.includes("Hello from Puppeteer"), { timeout: 5000 });
  ok(true, "posted a channel message");

  // ---- open settings, add a computer + bot ----
  await page.click('button[title="Settings"]');
  await $('.card ::-p-text(Settings)').catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  await clickText("button", "Computers");
  await clickText("button", "Add a computer");
  await typeInto('input[placeholder="Name"]', "TestBox");
  await typeInto('input[placeholder^="Base URL"]', "http://127.0.0.1:9099"); // dummy; not used for exec in UI test
  await clickText("button", "Add computer");
  await new Promise((r) => setTimeout(r, 400));
  ok(true, "added a computer via UI");

  // add a provider (reusable), then a bot that selects it
  const botName = "sage" + uniq;
  await clickText("button", "Providers");
  await clickText("button", "Add a provider");
  await typeInto('input[placeholder^="Name"]', "MockRouter");
  await typeInto('input[placeholder^="Base URL"]', MOCK);
  await typeInto('input[placeholder="API key"]', "x");
  await clickText("button", "Add provider");
  await new Promise((r) => setTimeout(r, 400));
  ok(true, "added a reusable provider via UI");

  await clickText("button", "Bots");
  await clickText("button", "Add a new bot");
  await typeInto('input[placeholder="Bot name (used for @mention)"]', botName);
  // choose the provider (first non-placeholder option in the provider select)
  await page.evaluate(() => { const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => /MockRouter/.test(o.textContent))); sel.value = [...sel.options].find((o) => /MockRouter/.test(o.textContent)).value; sel.dispatchEvent(new Event("change")); });
  await page.waitForFunction(() => [...document.querySelectorAll("option")].some((o) => o.textContent.includes("mock-large")), { timeout: 5000 });
  ok(true, "bot editor loaded models from the chosen provider");
  await page.evaluate(() => { const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "mock-large")); sel.value = "mock-large"; sel.dispatchEvent(new Event("change")); });
  await clickText("button", "Create bot");
  await new Promise((r) => setTimeout(r, 500));
  ok(true, "created a bot that references the provider");
  await page.mouse.click(12, 12); // click backdrop to close settings
  await new Promise((r) => setTimeout(r, 300));

  // ---- mention bot in channel → expect add-to-channel prompt ----
  await new Promise((r) => setTimeout(r, 300));
  await typeInto("textarea", `hey @${botName} please help`);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.body.textContent.includes("isn't in") || document.body.textContent.includes("Add @"), { timeout: 5000 });
  ok(true, "mentioning bot showed 'add to channel' prompt");
  const addBtn = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add"));
  await addBtn.asElement().click();
  await new Promise((r) => setTimeout(r, 1500));
  // bot must reply in a THREAD, not the main channel — main view should NOT contain the answer
  const inMain = await page.evaluate(() => document.querySelector("#msgs")?.textContent.includes("mock-large"));
  ok(!inMain, "bot did NOT speak in the main channel");
  await page.waitForFunction(() => [...document.querySelectorAll("#msgs button")].some((b) => /\d+\s+repl(y|ies)/i.test(b.textContent)), { timeout: 5000 });
  const replyBtn = await page.evaluateHandle(() => [...document.querySelectorAll("#msgs button")].find((b) => /\d+\s+repl(y|ies)/i.test(b.textContent)));
  await replyBtn.asElement().click();
  await page.waitForFunction(() => document.querySelector("#threadmsgs")?.textContent.includes("mock-large"), { timeout: 5000 });
  ok(true, "bot replied in a THREAD using the selected model (mock-large)");

  // ---- model routing panel differentiates the three levels (thread still open) ----
  const opened = await page.evaluate(() => { const b = [...document.querySelectorAll("#thread button")].find((x) => /Models/.test(x.textContent)); if (!b) return false; b.click(); return true; });
  ok(opened, "thread has a Models routing button");
  await new Promise((r) => setTimeout(r, 900));
  const levels = await page.evaluate(() => document.body.innerText);
  ok(/Global/.test(levels) && /Channel/.test(levels) && /Thread/.test(levels), "model routing panel shows Global / Channel / Thread levels");
  ok(/Serving here/.test(levels), "model routing shows effective ('Serving here') model");
  await page.mouse.click(4, 4);

  // ---- theme toggle ----
  const before = await page.evaluate(() => document.documentElement.className);
  const themeBtn = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => /Switch to/.test(b.title)));
  await themeBtn.asElement().click();
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.evaluate(() => document.documentElement.className);
  ok(before !== after && /light|dark/.test(after), "light/dark theme toggles the root class");

  // ---- terminal workspace ----
  await clickText("button", "Terminals");
  await page.waitForFunction(() => document.querySelector(".xterm") != null, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 800));
  ok((await page.$(".xterm")) != null, "xterm terminal mounted in terminal view");
  await typeInto("body", ""); // focus
  await page.click(".xterm-screen").catch(() => {});
  await page.keyboard.type("echo TERMUI_$((3*3))\n");
  await new Promise((r) => setTimeout(r, 900));
  const termText = await page.evaluate(() => document.querySelector(".xterm-rows")?.innerText || "");
  ok(/TERMUI_9/.test(termText), "typed command executed in live terminal");

  ok(errors.length === 0, "no console/page errors" + (errors.length ? " :: " + errors.slice(0, 3).join(" | ") : ""));
} catch (e) {
  fail++; console.log("  FAIL- exception:", e.message);
  await page.screenshot({ path: "/tmp/ui-fail.png" }).catch(() => {});
  console.log("  (screenshot saved to /tmp/ui-fail.png)");
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (errors.length) console.log("console errors:\n" + errors.join("\n"));
  await browser.close();
  process.exit(fail ? 1 : 0);
}
