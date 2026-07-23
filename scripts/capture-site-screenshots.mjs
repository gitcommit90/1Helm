import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const session = JSON.parse(readFileSync(process.env.HELM_SCREENSHOT_SESSION || "/tmp/1helm-shot-session.json", "utf8"));
const base = process.env.HELM_SCREENSHOT_URL || "http://127.0.0.1:9192";
const output = join(root, "site", "public", "media");
mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1512, height: 982, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate((token) => localStorage.setItem("ctrl.token", token), session.token);
  await page.goto(`${base}/c/${session.channel}`, { waitUntil: "networkidle0" });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await page.screenshot({ path: join(output, "workspace.png"), fullPage: false });

  await page.locator('button[title="Settings"]').click();
  await page.locator('button::-p-text(Skills)').click();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await page.screenshot({ path: join(output, "skills.png"), fullPage: false });

  await page.locator('button::-p-text(Connections)').click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  await page.screenshot({ path: join(output, "connections.png"), fullPage: false });
} finally { await browser.close(); }
