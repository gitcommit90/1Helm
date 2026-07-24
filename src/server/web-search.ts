import { inspectWebSource } from "./web-source.ts";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  published_at: string | null;
  image_url: string | null;
};

export type WebSearchResponse = {
  query: string;
  category: "news" | "web";
  searched_at: string;
  results: WebSearchResult[];
};

const decodeXml = (value: string): string => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, "\"")
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_all, decimal: string) => String.fromCodePoint(Number(decimal)))
  .replace(/&#x([a-f0-9]+);/gi, (_all, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));

const tag = (item: string, name: string): string => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeXml(item.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"))?.[1] || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

function directNewsUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const embedded = url.searchParams.get("url");
    if (embedded) {
      const direct = new URL(embedded);
      if (direct.protocol === "https:") return direct.href;
    }
    if (url.protocol === "https:") return url.href;
  } catch { /* invalid search result */ }
  return "";
}

function publicImageUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

export function parseBingSearchRss(xml: string, category: "news" | "web", limit = 10): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const rawLink = tag(item, "link");
    const url = category === "news" ? directNewsUrl(rawLink) : directNewsUrl(rawLink);
    const title = tag(item, "title");
    if (!title || !url) continue;
    const rawPublished = tag(item, "pubDate");
    const timestamp = Date.parse(rawPublished);
    const image = tag(item, "News:Image");
    results.push({
      title,
      url,
      snippet: tag(item, "description").slice(0, 1_200),
      source: tag(item, "News:Source") || new URL(url).hostname.replace(/^www\./, ""),
      published_at: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      image_url: image ? publicImageUrl(image) : null,
    });
    if (results.length >= Math.max(1, Math.min(20, limit))) break;
  }
  return results;
}

export async function searchWeb(
  queryInput: string,
  categoryInput: string = "web",
  limitInput = 10,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const query = String(queryInput || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (query.length < 2) throw new Error("Web search needs a specific query.");
  const category = categoryInput === "news" ? "news" : "web";
  const limit = Math.max(1, Math.min(20, Number(limitInput) || 10));
  if (process.env.NODE_ENV === "test" && process.env.HELM_TEST_WEB_SEARCH_FIXTURE) {
    const fixture = JSON.parse(process.env.HELM_TEST_WEB_SEARCH_FIXTURE) as WebSearchResult[];
    return { query, category, searched_at: new Date().toISOString(), results: fixture.slice(0, limit) };
  }
  const path = category === "news" ? "/news/search" : "/search";
  const url = new URL(`https://www.bing.com${path}`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");
  const source = await inspectWebSource(url.href, signal);
  const results = parseBingSearchRss(source.content, category, limit);
  if (!results.length) throw new Error("Web search returned no usable public results. Try a broader query.");
  return { query, category, searched_at: source.fetched_at, results };
}
