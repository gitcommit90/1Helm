import type { IncomingMessage, ServerResponse } from "node:http";

export const JSON_BODY_LIMIT = 1024 * 1024;
export const UPLOAD_BODY_LIMIT = 25 * 1024 * 1024;

export const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".yaml": "application/yaml",
  ".yml": "application/yaml", ".xml": "application/xml", ".pdf": "application/pdf", ".mp3": "audio/mpeg",
  ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp4": "video/mp4",
  ".webm": "video/webm", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

// TLS is terminated by the deployment's reverse proxy. Local and first-run
// HTTP deployments must still load their relative JS and CSS assets.
export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss: https:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(self), geolocation=(), unload=(self)",
};

export function json(res: ServerResponse, code: number, responseBody: unknown): void {
  res.writeHead(code, { "content-type": "application/json", ...SECURITY_HEADERS });
  res.end(JSON.stringify(responseBody));
}

const MOBILE_APP_ORIGINS = new Set(["capacitor://localhost", "https://localhost"]);

export function applyMobileCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = String(req.headers.origin || "");
  if (!MOBILE_APP_ORIGINS.has(origin)) return false;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-methods", "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "Authorization, Content-Type, X-Filename");
  res.setHeader("access-control-expose-headers", "Content-Disposition, Content-Type");
  res.setHeader("vary", "Origin");
  return true;
}

export function body(req: IncomingMessage, limit = JSON_BODY_LIMIT): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > limit) {
      const error = new Error(`Request exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit.`);
      error.name = "PayloadTooLargeError";
      reject(error);
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let oversized = false;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > limit) { oversized = true; chunks.length = 0; }
      else if (!oversized) chunks.push(chunk);
    });
    req.on("end", () => {
      if (oversized) {
        const error = new Error(`Request exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit.`);
        error.name = "PayloadTooLargeError";
        reject(error);
      } else resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

export async function jbody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await body(req);
  try { return JSON.parse(raw.toString() || "{}"); }
  catch { return {}; }
}

export function requestAddress(req: IncomingMessage): string {
  const forwarded = String(req.headers["cf-connecting-ip"] || "").trim();
  return /^[a-f0-9:.]{3,64}$/i.test(forwarded) ? forwarded : String(req.socket.remoteAddress || "unknown");
}

const requestLimits = new Map<string, { count: number; reset: number }>();

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  if (requestLimits.size >= 5000 && !requestLimits.has(key)) {
    const time = Date.now();
    for (const [candidate, value] of requestLimits) if (value.reset <= time) requestLimits.delete(candidate);
    while (requestLimits.size >= 5000) requestLimits.delete(requestLimits.keys().next().value as string);
  }
  const current = requestLimits.get(key);
  if (!current || current.reset <= Date.now()) {
    requestLimits.set(key, { count: 1, reset: Date.now() + windowMs });
    return false;
  }
  current.count++;
  return current.count > limit;
}

export function clearRateLimit(key: string): void {
  requestLimits.delete(key);
}
