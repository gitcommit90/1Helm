import puppeteer from "puppeteer";
const B = process.env.BASE || "http://localhost:8177";
const u = "term" + Date.now().toString(36);
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (tag, text) => { const h = await page.evaluateHandle((tag, text) => [...document.querySelectorAll(tag)].find((e) => e.textContent.includes(text)), tag, text); await h.asElement().click(); };
const type = async (sel, t) => { const e = await page.$(sel); await e.click({ clickCount: 3 }); await e.type(t); };

await page.goto(B, { waitUntil: "networkidle0" });
await clickText("button", "Create an account");
await type('input[placeholder="username"]', u);
await type('input[placeholder="password"]', "secret1");
await clickText("button", "Create account");
await page.waitForSelector("textarea");
await page.evaluate(() => { document.documentElement.classList.remove("dark"); document.documentElement.classList.add("light"); });

await clickText("button", "Terminals");
await page.waitForSelector(".xterm", { timeout: 10000 }); await wait(800);
await page.click(".xterm-screen").catch(() => {});
await page.keyboard.type("echo 'Welcome to CTRL PANE' && uname -sm && ls | head\n"); await wait(700);
await (await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.title === "Split right"))).asElement().click(); await wait(900);
await page.click(".xterm-screen").catch(() => {});
await page.keyboard.type("uptime && whoami\n"); await wait(700);
await page.screenshot({ path: "/tmp/shot-term-light.png" });
await browser.close();
console.log("term shot saved");
