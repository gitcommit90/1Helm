import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { pages, redirects, sitemapPaths } from "./content.mjs";
import { renderPage } from "./template.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const SITE_PUBLIC = join(import.meta.dirname, "public");
const PRODUCT_PUBLIC = join(ROOT, "public");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const STORY_HTML = readFileSync(join(import.meta.dirname, "story.html"), "utf8");
const MANUAL_HTML = readFileSync(join(import.meta.dirname, "manual.html"), "utf8");
const ASSET_VERSION = createHash("sha256")
  .update(readFileSync(join(import.meta.dirname, "public/assets/story.css")))
  .update(readFileSync(join(import.meta.dirname, "public/assets/story.js")))
  .update(readFileSync(join(import.meta.dirname, "public/assets/manual.css")))
  .digest("hex").slice(0, 10);
const versionAssets = (html) => html.replace(/\/assets\/(story|manual)\.(css|js)/g, (m) => `${m}?v=${ASSET_VERSION}`);
const STATIC_PAGES = { "/": versionAssets(STORY_HTML), "/manual": versionAssets(MANUAL_HTML), "/terms": versionAssets(readFileSync(join(import.meta.dirname, "terms.html"), "utf8")), "/privacy": versionAssets(readFileSync(join(import.meta.dirname, "privacy.html"), "utf8")) };
const VERSION = String(pkg.version || "");
const HOST = process.env.SITE_HOST || "127.0.0.1";
const PORT = Number(process.env.SITE_PORT || process.env.PORT || 8130);
const ORIGIN = "https://1helm.com";
const REPO = "gitcommit90/1Helm";
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;
const RELEASE_CACHE_MS = 10 * 60_000;

let releaseCache = { at: 0, assets: null };
async function latestReleaseAssets() {
  if (Date.now() - releaseCache.at < RELEASE_CACHE_MS && releaseCache.assets) return releaseCache.assets;
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { "user-agent": "1helm-site", accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const release = await response.json();
  releaseCache = { at: Date.now(), assets: release.assets || [] };
  return releaseCache.assets;
}
async function latestAssetUrl(pattern) {
  const asset = (await latestReleaseAssets()).find((entry) => pattern.test(String(entry.name || "")));
  if (!asset?.browser_download_url) throw new Error("no matching asset on latest release");
  return asset.browser_download_url;
}

const mime = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".sh": "text/x-shellscript; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
};

const securityHeaders = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function answer(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders, ...headers });
  res.end(body);
}

function redirect(res, location, status = 302) {
  answer(res, status, "", { location, "cache-control": "no-store" });
}

function safeFile(root, requestPath) {
  const relative = normalize(requestPath).replace(/^[/\\]+/, "");
  const candidate = resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}/`) ? candidate : "";
}

function serveFile(req, res, file, cache = "public, max-age=86400") {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return false;
  const stat = statSync(file);
  const tag = `\"${createHash("sha256").update(`${stat.size}:${stat.mtimeMs}`).digest("hex").slice(0, 20)}\"`;
  if (req.headers["if-none-match"] === tag) {
    res.writeHead(304, { ...securityHeaders, etag: tag, "cache-control": cache });
    res.end();
    return true;
  }
  res.writeHead(200, {
    ...securityHeaders,
    "content-type": mime[extname(file).toLowerCase()] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": cache,
    etag: tag,
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
  return true;
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    answer(res, 405, "Method not allowed", { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
    return;
  }

  if (path === "/health" || path === "/api/health") {
    answer(res, 200, JSON.stringify({ ok: true, product: "1Helm", surface: "website", version: VERSION }), {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    return;
  }
  if (STATIC_PAGES[path]) {
    answer(res, 200, STATIC_PAGES[path], {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    });
    return;
  }
  if (path === "/download/macos") {
    latestAssetUrl(/-arm64\.dmg$/i)
      .then((url) => redirect(res, url))
      .catch(() => redirect(res, RELEASE_PAGE));
    return;
  }
  if (path === "/download/windows") {
    latestAssetUrl(/-windows-x64-setup\.exe$/i)
      .then((url) => redirect(res, url))
      .catch(() => redirect(res, RELEASE_PAGE));
    return;
  }
  if (path === "/github") {
    redirect(res, "https://github.com/gitcommit90/1Helm");
    return;
  }
  if (redirects[path]) {
    redirect(res, redirects[path], 301);
    return;
  }
  if (path === "/robots.txt") {
    answer(res, 200, `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    });
    return;
  }
  if (path === "/sitemap.xml") {
    const updated = new Date().toISOString().slice(0, 10);
    const urls = sitemapPaths.map((entry) => `  <url><loc>${ORIGIN}${entry === "/" ? "" : entry}</loc><lastmod>${updated}</lastmod></url>`).join("\n");
    answer(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    });
    return;
  }

  if (path === "/install.sh" && serveFile(req, res, join(SITE_PUBLIC, "install.sh"), "no-cache")) return;
  if (path.startsWith("/schemas/") && serveFile(req, res, safeFile(SITE_PUBLIC, path.slice(1)), "public, max-age=3600")) return;
  if (path.startsWith("/assets/") && serveFile(req, res, safeFile(SITE_PUBLIC, path.slice(1)), "public, max-age=604800")) return;
  if (path.startsWith("/media/") && serveFile(req, res, safeFile(SITE_PUBLIC, path.slice(1)), "public, max-age=604800")) return;
  if (path.startsWith("/icons/") && serveFile(req, res, safeFile(SITE_PUBLIC, path.slice(1)), "public, max-age=604800")) return;
  if (path.startsWith("/brand/") && serveFile(req, res, safeFile(PRODUCT_PUBLIC, path.slice(1)), "public, max-age=604800")) return;

  const page = pages[path];
  if (page) {
    answer(res, 200, renderPage({ ...page, path, version: VERSION }), {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    });
    return;
  }
  answer(res, 404, renderPage({
    path,
    version: VERSION,
    title: "Page not found",
    description: "This 1Helm page does not exist.",
    kind: "error",
    body: `<main class="error-page"><p class="eyebrow">404 · off course</p><h1>That page is beyond the chart.</h1><p>Head back to the launch site or open the documentation.</p><div class="button-row"><a class="button primary" href="/">Go home</a><a class="button" href="/docs">Read the docs</a></div></main>`,
  }), { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
});

server.listen(PORT, HOST, () => {
  console.log(`1Helm website listening at http://${HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
