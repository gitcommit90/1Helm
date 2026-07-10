import puppeteer from "puppeteer";
const B = process.env.BASE || "http://localhost:8166";
const u = "md" + Date.now().toString(36);
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });
const clickText = async (t) => { const h = await page.evaluateHandle((t) => [...document.querySelectorAll("button")].find((e) => e.textContent.includes(t)), t); await h.asElement().click(); };
const type = async (sel, t) => { const e = await page.$(sel); await e.click({ clickCount: 3 }); await e.type(t); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(B, { waitUntil: "networkidle0" });
await clickText("Create an account");
await type('input[placeholder="username"]', u);
await type('input[placeholder="password"]', "secret1");
await clickText("Create account");
await page.waitForSelector("textarea");

const body = [
  "# Deploy Runbook",
  "Here's the **plan** with a few _caveats_ and ~~old steps~~ removed.",
  "## Steps",
  "1. Pull the latest image",
  "2. Run `docker compose up -d`",
  "3. Restart the service",
  "### Environments",
  "| Env | Port | Notes |",
  "| --- | --- | --- |",
  "| prod | 8123 | customer-facing |",
  "| dev | 8124 | safe to break |",
  "> Tip: back up the database first.",
  "```bash",
  "pg_dump app > backup.sql && echo done",
  "```",
  "See [the docs](https://example.com) for more. Ping @tux if stuck.",
].join("\n");

await page.evaluate(async (body) => {
  const tok = localStorage.getItem("ctrl.token");
  const chans = await fetch("/api/channels", { headers: { authorization: "Bearer " + tok } }).then((r) => r.json());
  await fetch(`/api/channels/${chans.channels[0].id}/messages`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify({ body }) });
}, body);
await wait(700);
await page.screenshot({ path: "/tmp/shot-markdown.png" });
await browser.close();
console.log("markdown shot saved");
