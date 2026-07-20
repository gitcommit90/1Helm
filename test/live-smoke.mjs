import { DatabaseSync } from "node:sqlite";
import puppeteer from "puppeteer";

const base = process.env.BASE || "http://proxui.tail6511f5.ts.net:8124";
const appOrigin = new URL(base).origin;
const dataDir = process.env.CTRL_DATA_DIR || "data-refactored";
const database = new DatabaseSync(`${dataDir}/ctrl-pane.db`);
const token = database.prepare(`SELECT s.token FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.is_admin=1 ORDER BY s.created DESC LIMIT 1`).get()?.token;
database.close();
if (!token) throw new Error("No Captain session is available for live smoke verification.");

const readyDeadline = Date.now() + 30_000;
let ready = false;
while (Date.now() < readyDeadline) {
  const response = await fetch(base, { redirect: "manual" }).catch(() => null);
  if (response?.status === 200) { ready = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error(`Live origin did not return HTTP 200 within 30 seconds: ${base}`);

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() !== "error") return;
  const location = message.location();
  if (location.url && new URL(location.url).origin !== appOrigin) return;
  errors.push(`${message.text()}${location.url ? ` (${location.url}:${location.lineNumber || 0})` : ""}`);
});
page.on("pageerror", (error) => errors.push(error.message));
page.on("requestfailed", (request) => {
  if (new URL(request.url()).origin === appOrigin) errors.push(`Request failed: ${request.url()} (${request.failure()?.errorText || "unknown"})`);
});
try {
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate((value) => localStorage.setItem("ctrl.token", value), token);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("aside");
  const contract = await page.evaluate(() => ({
    workspace: document.body.textContent.includes("Nick's Workspace"),
    tabs: ["chat", "threads", "files", "terminal", "memory", "activity", "settings"].every((view) => document.querySelector(`[data-channel-view="${view}"]`)),
    width: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  }));
  if (!contract.workspace || !contract.tabs || !contract.width || errors.length) throw new Error(JSON.stringify({ contract, errors }));
  console.log("LIVE_BROWSER_OK");
} finally {
  await browser.close();
}
