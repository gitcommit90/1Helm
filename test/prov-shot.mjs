import puppeteer from "puppeteer";
const B = process.env.BASE || "http://localhost:8144";
const MOCK = "http://localhost:9099/v1";
const u = "pv" + Date.now().toString(36);
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 820, deviceScaleFactor: 2 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (text) => { const h = await page.evaluateHandle((text) => { const els = [...document.querySelectorAll("button")]; return els.find((e) => e.textContent.trim() === text) || els.reverse().find((e) => e.textContent.includes(text)); }, text); await h.asElement().click(); };
const type = async (sel, t) => { const e = await page.$(sel); await e.click({ clickCount: 3 }); await e.type(t); };

await page.goto(B, { waitUntil: "networkidle0" });
await clickText("Create an account");
await type('input[placeholder="username"]', u);
await type('input[placeholder="password"]', "secret1");
await clickText("Create account");
await page.waitForSelector("textarea");

// seed two providers directly, plus two bots sharing one provider
await page.evaluate(async (MOCK) => {
  const tok = localStorage.getItem("ctrl.token");
  const post = (p, b) => fetch(p, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify(b) }).then((r) => r.json());
  const p1 = await post("/api/providers", { name: "OpenAI (work)", base_url: "https://api.openai.com/v1", api_key: "sk-demo" });
  const p2 = await post("/api/providers", { name: "MockRouter", base_url: MOCK, api_key: "x" });
  await post("/api/bots", { name: "sage", provider_id: p2.provider.id, model: "mock-large" });
  await post("/api/bots", { name: "scout", provider_id: p2.provider.id, model: "mock-small" });
}, MOCK);
await wait(300);
await page.reload({ waitUntil: "networkidle0" });
await page.waitForSelector("textarea");

await page.click('button[title="Settings"]'); await wait(300);
await clickText("Providers"); await wait(400);
await page.screenshot({ path: "/tmp/shot-providers.png" });

await clickText("Bots"); await wait(300);
await clickText("Add a new bot"); await wait(300);
await page.screenshot({ path: "/tmp/shot-bot-editor.png" });

await browser.close();
console.log("provider shots saved");
