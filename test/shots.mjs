import puppeteer from "puppeteer";
const B = process.env.BASE || "http://localhost:8177";
const MOCK = "http://localhost:9099/v1";
const u = Date.now().toString(36);
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (tag, text) => { const h = await page.evaluateHandle((tag, text) => [...document.querySelectorAll(tag)].find((e) => e.textContent.trim() === text || e.textContent.includes(text)), tag, text); await h.asElement().click(); };
const type = async (sel, t) => { const e = await page.$(sel); await e.click({ clickCount: 3 }); await e.type(t); };
const setTheme = (t) => page.evaluate((t) => { document.documentElement.classList.remove("light", "dark"); document.documentElement.classList.add(t); localStorage.setItem("ctrl.theme", t); window.dispatchEvent(new CustomEvent("themechange", { detail: t })); }, t);

await page.goto(B, { waitUntil: "networkidle0" });
await clickText("button", "Create an account");
await type('input[placeholder="username"]', "ada" + u);
await type('input[placeholder="display name (optional)"]', "Ada Lovelace");
await type('input[placeholder="password"]', "secret1");
await clickText("button", "Create account");
await page.waitForSelector("textarea");

await page.evaluate(async () => {
  const tok = localStorage.getItem("ctrl.token");
  const post = (p, b) => fetch(p, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify(b) });
  await post("/api/channels", { name: "engineering", topic: "Ship the launch" });
  await post("/api/channels", { name: "design", topic: "Pixels and polish" });
});
await wait(300); await page.reload({ waitUntil: "networkidle0" }); await page.waitForSelector("textarea");

for (const m of ["Morning team! Kicking off the CTRL PANE launch today. 🚀", "Reminder: you can drag files right onto the composer.", "Threads keep side conversations tidy — reply here."]) { await type("textarea", m); await page.keyboard.press("Enter"); await wait(250); }

// bot + computer
await page.click('button[title="Settings"]'); await wait(300);
await clickText("button", "Add a new bot");
await type('input[placeholder="Bot name (used for @mention)"]', "sage");
await type('input[placeholder^="Base URL"]', MOCK);
await type('input[placeholder="API key"]', "x");
await clickText("button", "Fetch models");
await page.waitForFunction(() => [...document.querySelectorAll("option")].some((o) => o.textContent.includes("mock-large")));
await page.select("select", "mock-large").catch(() => {});
await page.screenshot({ path: "/tmp/shot-settings.png" });
await clickText("button", "Create bot"); await wait(400);
await page.mouse.click(12, 12); await wait(300);

await type("textarea", "@sage summarize our launch checklist");
await page.keyboard.press("Enter"); await wait(400);
await (await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add"))).asElement().click(); await wait(1600);
await page.evaluate(() => { const b = [...document.querySelectorAll("#msgs button")].find((x) => /\d+\s+repl/i.test(x.textContent)); if (b) b.click(); }); await wait(1200);
await type("textarea", "@sage now double-check it against the runbook"); await page.keyboard.press("Enter"); await wait(1600);

await setTheme("dark"); await wait(200);
await page.screenshot({ path: "/tmp/shot-chat-dark.png" });

// model routing popover (dark)
await page.evaluate(() => { const b = [...document.querySelectorAll("#thread button")].find((x) => /Models/.test(x.textContent)); if (b) b.click(); }); await wait(900);
await page.screenshot({ path: "/tmp/shot-models.png" });
await page.mouse.click(12, 12); await wait(200);

await setTheme("light"); await wait(250);
await page.screenshot({ path: "/tmp/shot-chat-light.png" });

// terminals (light chrome, dark panes) + split
await clickText("button", "Terminals");
await page.waitForSelector(".xterm"); await wait(700);
await page.click(".xterm-screen").catch(() => {});
await page.keyboard.type("echo 'Welcome to CTRL PANE' && uname -sm && ls\n"); await wait(700);
await (await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.title === "Split right"))).asElement().click(); await wait(900);
await page.click(".xterm-screen").catch(() => {});
await page.keyboard.type("uptime && whoami\n"); await wait(700);
await page.screenshot({ path: "/tmp/shot-term-light.png" });

await browser.close();
console.log("shots saved");
