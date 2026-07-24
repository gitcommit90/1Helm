import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_TEXT_CHARS = 120_000;
const REQUEST_TIMEOUT_MS = 15_000;

type SourceResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export type WebSourceInspection = {
  requested_url: string;
  final_url: string;
  status: number;
  content_type: string;
  bytes: number;
  sha256: string;
  fetched_at: string;
  content: string;
  links: string[];
};

const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(network, prefix, "ipv4");

const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
] as const) blockedV6.addSubnet(network, prefix, "ipv6");

const normalizeMappedV4 = (address: string): string => {
  const match = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return match?.[1] || address;
};

export function isPublicWebAddress(addressInput: string): boolean {
  const address = normalizeMappedV4(String(addressInput || "").trim());
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return !blockedV6.check(address, "ipv6");
  return false;
}

export function validateWebSourceUrl(input: string): URL {
  let url: URL;
  try { url = new URL(String(input || "").trim()); }
  catch { throw new Error("Use a valid HTTPS source URL."); }
  if (url.protocol !== "https:") throw new Error("Web source inspection accepts HTTPS URLs only.");
  if (url.username || url.password) throw new Error("Web source URLs cannot contain credentials.");
  if (url.port && url.port !== "443") throw new Error("Web source inspection accepts HTTPS on port 443 only.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")
    || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa")) {
    throw new Error("Local and private network web sources are not allowed.");
  }
  if (isIP(hostname) && !isPublicWebAddress(hostname)) throw new Error("Local and private network web sources are not allowed.");
  url.hash = "";
  return url;
}

function fixtureResponse(url: URL): SourceResponse | null {
  if (process.env.NODE_ENV !== "test" || !process.env.HELM_TEST_WEB_SOURCE_FIXTURES) return null;
  try {
    const fixtures = JSON.parse(process.env.HELM_TEST_WEB_SOURCE_FIXTURES) as Record<string, string>;
    if (url.hostname !== "example.com" || typeof fixtures[url.href] !== "string") return null;
    return { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" }, body: Buffer.from(fixtures[url.href]) };
  } catch { return null; }
}

async function requestSource(url: URL, signal?: AbortSignal): Promise<SourceResponse> {
  const fixture = fixtureResponse(url);
  if (fixture) return fixture;
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicWebAddress(entry.address))) {
    throw new Error("The source hostname resolves to a local, private, reserved, or otherwise unsafe address.");
  }
  const pinned = addresses[0];
  return await new Promise<SourceResponse>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, response?: SourceResponse): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(response!);
    };
    const req = request(url, {
      method: "GET",
      headers: {
        accept: "text/html, text/markdown, text/plain, application/json, application/xml;q=0.8, text/xml;q=0.8",
        "accept-encoding": "identity",
        "user-agent": "1Helm-Web-Source/1.0",
      },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      },
      signal,
    }, (res) => {
      const status = Number(res.statusCode || 0);
      const headers = Object.fromEntries(Object.entries(res.headers)
        .filter((entry): entry is [string, string | string[]] => entry[1] != null)
        .map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value)]));
      const declared = Number(headers["content-length"] || 0);
      if (declared > MAX_RESPONSE_BYTES) {
        res.resume();
        finish(new Error(`Web source exceeds the ${MAX_RESPONSE_BYTES} byte inspection limit.`));
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          res.destroy(new Error(`Web source exceeds the ${MAX_RESPONSE_BYTES} byte inspection limit.`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => finish(undefined, { status, headers, body: Buffer.concat(chunks) }));
      res.on("error", (error) => finish(error));
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("Web source inspection timed out.")));
    req.on("error", (error) => finish(error));
    req.end();
  });
}

const decodeHtml = (value: string): string => value
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_all, decimal: string) => String.fromCodePoint(Number(decimal)))
  .replace(/&#x([a-f0-9]+);/gi, (_all, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));

function readableContent(body: string, contentType: string): string {
  if (!/html/i.test(contentType)) return body.replace(/\u0000/g, "").slice(0, MAX_TEXT_CHARS).trim();
  return decodeHtml(body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(?:p|div|section|article|main|header|footer|h[1-6]|li|pre|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim().slice(0, MAX_TEXT_CHARS);
}

function htmlLinks(body: string, base: URL): string[] {
  const links = new Set<string>();
  for (const match of body.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const link = new URL(match[1], base);
      link.hash = "";
      if (link.protocol === "https:") links.add(link.href);
    } catch { /* malformed reference */ }
    if (links.size >= 50) break;
  }
  return [...links];
}

export async function inspectWebSource(input: string, signal?: AbortSignal): Promise<WebSourceInspection> {
  const requested = validateWebSourceUrl(input);
  let current = requested;
  let response: SourceResponse | undefined;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    response = await requestSource(current, signal);
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.location;
    if (!location) throw new Error(`Web source returned redirect status ${response.status} without a Location header.`);
    if (redirects === MAX_REDIRECTS) throw new Error("Web source exceeded the redirect limit.");
    current = validateWebSourceUrl(new URL(location, current).href);
  }
  const declaredEncoding = String(response?.headers["content-encoding"] || "identity").toLowerCase();
  if (declaredEncoding && declaredEncoding !== "identity") throw new Error(`Web source returned unsupported content encoding ${declaredEncoding}.`);
  if (!response || response.status < 200 || response.status >= 300) throw new Error(`Web source returned HTTP ${response?.status || 0}.`);
  const contentType = String(response.headers["content-type"] || "application/octet-stream").toLowerCase();
  if (!/(?:^|\b)(?:text\/|application\/(?:json|xml|xhtml\+xml))/.test(contentType)) {
    throw new Error(`Web source content type ${contentType} is not inspectable text.`);
  }
  const raw = response.body.toString("utf8");
  return {
    requested_url: requested.href,
    final_url: current.href,
    status: response.status,
    content_type: contentType,
    bytes: response.body.length,
    sha256: createHash("sha256").update(response.body).digest("hex"),
    fetched_at: new Date().toISOString(),
    content: readableContent(raw, contentType),
    links: /html/i.test(contentType) ? htmlLinks(raw, current) : [],
  };
}
