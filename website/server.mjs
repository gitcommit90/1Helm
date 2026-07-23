// 1Helm marketing site server — static files + live download redirect.
// No dependencies. Node 22+.
//
//   node server.mjs            # serves ./ on 127.0.0.1:4390
//   PORT=8130 node server.mjs
//
// /download/macos resolves the newest -arm64.dmg asset on the repository's
// latest GitHub release at request time (cached), so the button always ships
// the current DMG without a site redeploy.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4390);
const REPO = "gitcommit90/1Helm";
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;
const RELEASE_CACHE_MS = 10 * 60_000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

let releaseCache = { at: 0, url: "" };
async function latestDmgUrl() {
  if (Date.now() - releaseCache.at < RELEASE_CACHE_MS && releaseCache.url) return releaseCache.url;
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { "user-agent": "1helm-site", accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const release = await response.json();
  const asset = (release.assets || []).find((entry) => /-arm64\.dmg$/i.test(String(entry.name || "")));
  if (!asset?.browser_download_url) throw new Error("no arm64 DMG asset on latest release");
  releaseCache = { at: Date.now(), url: asset.browser_download_url };
  return releaseCache.url;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, "http://x").pathname); }
  catch { return send(res, 400, "Bad request", { "content-type": "text/plain" }); }

  if (path === "/download/macos" || path === "/download" || path === "/download/") {
    try {
      const url = await latestDmgUrl();
      res.writeHead(302, { location: url, "cache-control": "no-cache" });
      return res.end();
    } catch {
      res.writeHead(302, { location: RELEASE_PAGE, "cache-control": "no-cache" });
      return res.end();
    }
  }

  // static files, contained to ROOT
  let filePath = normalize(join(ROOT, path));
  if (!filePath.startsWith(ROOT)) return send(res, 403, "Forbidden", { "content-type": "text/plain" });
  try {
    let info = await stat(filePath);
    if (info.isDirectory()) {
      if (!path.endsWith("/")) {
        res.writeHead(301, { location: path + "/" });
        return res.end();
      }
      filePath = join(filePath, "index.html");
      info = await stat(filePath);
    }
    const type = TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
    const html = type.startsWith("text/html");
    const body = await readFile(filePath);
    return send(res, 200, body, {
      "content-type": type,
      "cache-control": html ? "no-cache" : "public, max-age=3600",
    });
  } catch {
    return send(res, 404, "Not found — try https://1helm.com or /docs/", { "content-type": "text/plain; charset=utf-8" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`1helm site: http://${HOST}:${PORT} (root ${ROOT})`);
});
