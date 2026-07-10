import puppeteer from "puppeteer";

const B = process.env.BASE || "http://localhost:8123";
const u = "orx" + Date.now().toString(36);
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (text) => {
  const h = await page.evaluateHandle((text) => {
    const els = [...document.querySelectorAll("button")];
    return els.find((e) => e.textContent.trim() === text) || els.reverse().find((e) => e.textContent.includes(text));
  }, text);
  const el = h.asElement();
  if (!el) throw new Error(`no button "${text}"`);
  await el.click();
};
const type = async (sel, t) => { const e = await page.waitForSelector(sel); await e.click({ clickCount: 3 }); await e.type(t); };

// Register a fresh test user, then place its session in the browser before using the UI.
await page.goto(B, { waitUntil: "networkidle0" });
const secureContext = await page.evaluate(() => window.isSecureContext);
console.log("secure browser context:", secureContext);
if (!secureContext) throw new Error(`OpenRouter OAuth requires a secure browser context; BASE is ${B}`);
const token = await page.evaluate(async (username) => {
  const r = await fetch("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "secret1" }) });
  const b = await r.json();
  if (!b.token) throw new Error(b.error || "registration returned no token");
  return b.token;
}, u);
await page.evaluate((token) => localStorage.setItem("ctrl.token", token), token);
await page.reload({ waitUntil: "networkidle0" });
await page.waitForSelector("textarea", { timeout: 8000 });

// confirm the served bundle is the freshly stamped one
const src = await page.evaluate(() => document.querySelector('script[type="module"]')?.getAttribute("src"));
console.log("bundle loaded:", src);

// open settings → Providers
await page.click('button[title="Settings"]');
await wait(400);
await clickText("Providers");
await wait(400);

const btn = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Connect OpenRouter"));
const el = btn.asElement();
console.log("Connect OpenRouter button present:", !!el);
if (!el) { console.log("NOTE: button only renders for admins — this user may not be admin."); await browser.close(); process.exit(1); }

// Capture the outbound redirect without leaving the test origin, then simulate
// OpenRouter's callback and the server-side key exchange.
let navUrl = null;
let exchange = null;
await page.setRequestInterception(true);
page.on("request", (r) => {
  if (r.isNavigationRequest() && r.url().includes("openrouter.ai/auth")) {
    navUrl = r.url();
    return r.abort();
  }
  if (r.url().endsWith("/api/oauth/openrouter/exchange") && r.method() === "POST") {
    exchange = JSON.parse(r.postData() || "{}");
    return r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ provider: { id: 1 } }) });
  }
  r.continue();
});
await el.click();
await wait(300);
// The aborted navigation leaves an error document where storage is inaccessible;
// return to the app origin (a valid verifier survives a no-code boot) to read it.
await page.goto(B, { waitUntil: "networkidle0" });
const verifier = await page.evaluate(() => JSON.parse(localStorage.getItem("ctrl.or_verifier") || "{}").v);
const outbound = Boolean(navUrl && /code_challenge=[A-Za-z0-9_-]+/.test(navUrl));
console.log("navigated to:", navUrl ? navUrl.slice(0, 110) + "…" : page.url());
console.log(outbound ? "PASS: click redirects to OpenRouter OAuth with PKCE challenge" : "FAIL: no OAuth redirect");

await page.goto(`${B}/?code=fake-code`, { waitUntil: "networkidle0" });
await page.waitForSelector(".fixed.inset-0", { timeout: 8000 });
const callback = Boolean(exchange?.code === "fake-code" && exchange?.code_verifier === verifier);
console.log(callback ? "PASS: callback exchanges the stored PKCE verifier" : "FAIL: callback did not exchange the stored verifier");

let missingVerifierAlert = "";
page.on("dialog", async (dialog) => { missingVerifierAlert = dialog.message(); await dialog.accept(); });
await page.evaluate(() => localStorage.removeItem("ctrl.or_verifier"));
await page.goto(`${B}/?code=missing-verifier`, { waitUntil: "networkidle0" });
await wait(150);
const missingVerifier = /no longer has the matching sign-in state/.test(missingVerifierAlert);
console.log(missingVerifier ? "PASS: missing verifier reports an actionable error" : "FAIL: missing verifier was not reported");

await browser.close();
process.exit(outbound && callback && missingVerifier ? 0 : 1);
