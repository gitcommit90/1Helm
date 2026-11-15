// Headless Chrome for the artifact scripts (render_audit.mjs, assemble_deck.mjs).
//
// One place that knows where the browser lives on the channel computer and how
// to launch it, plus the small page diagnostics both scripts share: console
// errors, image responses that failed, sub-resources that failed, and a read of
// every <img> so a broken one can be named.

import { accessSync, constants as fsConstants, existsSync } from "node:fs";
// --help: print the header above and exit.
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n" + "(A module the other scripts load; you don't run it.)\n"); process.exit(0);
}

// The channel computer ships Chrome for Testing here. The others are fallbacks
// for running the scripts somewhere else (a dev box).
const CHROME_PATHS = [
  process.env.ONEHC_CHROME || "",
  "/opt/chrome/chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

// The computer runs as root inside a container: Chrome's own sandbox can't
// start there, and /dev/shm is small. The rest keeps a render quiet and offline
// from Google's background services.
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-sync",
  "--disable-domain-reliability",
  "--disable-component-update",
  "--disable-background-networking",
  "--no-first-run",
  "--no-default-browser-check",
];

const MAX_CONSOLE_ERRORS = 20;
const MAX_BROKEN_ASSETS = 20;
const MAX_IMAGE_SAMPLE = 12;

// Image responses that mean the picture is gone or blocked.
const FAILED_IMAGE_STATUSES = new Set([401, 403, 404]);
// Other sub-resources whose failure leaves the page blank or unstyled.
const FAILED_ASSET_TYPES = new Set(["stylesheet", "script", "font", "fetch", "xhr", "media"]);

// Hosts and query params that mark an image URL as signed or expiring: it loads
// now and breaks later, so the bytes must be downloaded and embedded instead.
const EXPIRING_HOST_SUFFIXES = ["cdninstagram.com", "fbcdn.net"];
const EXPIRING_QUERY_PARAMS = new Set([
  "expires", "oe", "oh", "x-amz-signature", "x-amz-credential", "x-amz-expires",
  "x-goog-signature", "key-pair-id",
]);

export function findSystemChrome() {
  for (const candidate of CHROME_PATHS) {
    if (!existsSync(candidate)) continue;
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      /* present but not executable */
    }
  }
  return null;
}

// playwright-core is found next to the scripts (a node_modules above them) and, when a script was copied somewhere else, at the one
// place the channel computer installs it. Either way the scripts work from any folder.
const PLAYWRIGHT_HOME = process.env.ONEHC_PLAYWRIGHT || "/opt/1hc/node_modules/playwright-core";   // the variable is for testing elsewhere
export async function loadPlaywright() {
  try {
    return await import("playwright-core");
  } catch (err) {
    try {
      const { pathToFileURL } = await import("node:url");
      for (const entry of ["index.mjs", "index.js"]) {
        if (!existsSync(`${PLAYWRIGHT_HOME}/${entry}`)) continue;
        const m = await import(pathToFileURL(`${PLAYWRIGHT_HOME}/${entry}`).href);
        return m.chromium ? m : m.default;
      }
      throw err;
    } catch {
      throw new Error(
        `playwright-core is not installed (${(err && err.message) || err}); ` +
          `expected it at ${PLAYWRIGHT_HOME}`,
      );
    }
  }
}

// Kept as (executablePath, proxyServer, ...) so callers written against the
// older signature still work; proxying is not used on the channel computer.
export function buildLaunchOptions(executablePath, proxyServer = null) {
  const options = { headless: true, args: [...LAUNCH_ARGS] };
  if (executablePath) options.executablePath = executablePath;
  if (proxyServer) options.proxy = { server: proxyServer };
  return options;
}

export async function loadBrowserRuntime() {
  const playwright = await loadPlaywright();
  const executablePath = findSystemChrome();
  if (executablePath === null) {
    throw new Error(`no Chrome found (looked in ${CHROME_PATHS.join(", ")})`);
  }
  const audit = {
    buildLaunchOptions,
    installPageDiagnostics,
    collectRawImages,
    summarizeImages,
    dedupeBrokenAssets,
  };
  return { audit, playwright, executablePath };
}

// Same thing under the name the ported deck scripts already import.
export const loadBrowserAuditRuntime = loadBrowserRuntime;

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function classifyImageSource(rawSrc) {
  if (typeof rawSrc !== "string" || !rawSrc.trim()) return { unstable: false, reason: null };
  let parsed;
  try {
    parsed = new URL(rawSrc.trim());
  } catch {
    return { unstable: false, reason: null };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { unstable: false, reason: null };
  }
  const host = parsed.hostname.toLowerCase();
  for (const suffix of EXPIRING_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      return { unstable: true, reason: `expiring host (${suffix})` };
    }
  }
  for (const key of parsed.searchParams.keys()) {
    if (EXPIRING_QUERY_PARAMS.has(key.toLowerCase())) {
      return { unstable: true, reason: `signed or expiring URL (${key})` };
    }
  }
  return { unstable: false, reason: null };
}

export function dedupeBrokenAssets(assets) {
  const seen = new Set();
  const out = [];
  for (const asset of assets) {
    const key = `${asset.url} ${asset.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(asset);
  }
  return out;
}

function formatConsoleError(text, locationUrl) {
  const where = String(locationUrl || "").trim();
  if (!where || text.includes(where)) return `console.error: ${text}`;
  return `console.error: ${text} (${where})`;
}

// Collect page errors, console errors, failed image responses and failed
// sub-resources into the arrays the caller owns. The extra positional
// arguments are accepted and ignored so older call sites keep working.
export function installPageDiagnostics(
  page,
  consoleErrors,
  failedImageResponses,
  ownOrigin,
  _consoleWarnings = [],
  brokenAssets = [],
) {
  page.on("pageerror", (err) => {
    if (consoleErrors.length < MAX_CONSOLE_ERRORS) consoleErrors.push(`pageerror: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const locationUrl = msg.location().url;
    // The browser asks for /favicon.ico on its own; that says nothing about the file.
    try {
      const u = new URL(locationUrl);
      if (u.pathname === "/favicon.ico" && (!ownOrigin || u.origin === ownOrigin)) return;
    } catch {
      /* no usable location */
    }
    if (consoleErrors.length < MAX_CONSOLE_ERRORS) {
      consoleErrors.push(formatConsoleError(msg.text(), locationUrl));
    }
  });
  page.on("response", (response) => {
    try {
      const type = response.request().resourceType();
      const status = response.status();
      if (type === "image") {
        if (FAILED_IMAGE_STATUSES.has(status)) failedImageResponses.push({ url: response.url(), status });
        return;
      }
      if (FAILED_ASSET_TYPES.has(type) && status >= 400 && brokenAssets.length < MAX_BROKEN_ASSETS) {
        brokenAssets.push({ url: response.url(), status, resource_type: type });
      }
    } catch {
      /* a listener error must never fail the render */
    }
  });
}

export async function collectRawImages(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("img")).map((img) => {
      const style = window.getComputedStyle(img);
      const rect = img.getBoundingClientRect();
      return {
        src: img.currentSrc || img.src,
        alt: img.alt ?? "",
        complete: img.complete,
        nw: img.naturalWidth,
        nh: img.naturalHeight,
        hidden: style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0,
      };
    }),
  );
}

function isSvgSource(src) {
  try {
    return new URL(src, "http://local/").pathname.toLowerCase().endsWith(".svg");
  } catch {
    return src.toLowerCase().split("?")[0].endsWith(".svg");
  }
}

// An image is broken when the browser finished loading it and got no pixels.
// Hidden ones count too, so an onerror that hides the element can't hide the
// defect. SVGs are skipped: they report a zero natural size and render fine.
export function summarizeImages(rawImages, failedResponses) {
  const failed = [];
  for (const f of failedResponses || []) {
    if (f && typeof f.url === "string" && f.url && failed.length < MAX_IMAGE_SAMPLE) {
      failed.push({ url: f.url, status: f.status });
    }
  }
  const broken = [];
  const unstable = [];
  const unstableSeen = new Set();
  const counts = new Map();
  for (const img of rawImages || []) {
    if (!img.src) continue;
    counts.set(img.src, (counts.get(img.src) ?? 0) + 1);
    if (img.complete && (img.nw === 0 || img.nh === 0) && !isSvgSource(img.src)) {
      broken.push({ src: img.src, alt: img.alt, reason: "not_loaded_or_zero_size" });
    }
    const c = classifyImageSource(img.src);
    if (c.unstable && !unstableSeen.has(img.src)) {
      unstableSeen.add(img.src);
      if (unstable.length < MAX_IMAGE_SAMPLE) unstable.push({ src: img.src, reason: c.reason });
    }
  }
  const duplicate = [...counts.entries()].filter(([, n]) => n > 1).map(([src, count]) => ({ src, count }));
  return {
    total: (rawImages || []).length,
    broken,
    duplicate,
    unstable,
    failed_requests: failed,
    origin_sample: [...counts.keys()].slice(0, 6).map(safeOrigin),
    verdict: broken.length > 0 || unstable.length > 0 ? "fail" : "pass",
  };
}
