// Registry tools shared by Magic UI, React Bits and Canvas UI. The Magic UI part is a port of the npm package @magicuidesign/mcp 2.0.0
// (MIT): same tool names, inputs and result shapes. React Bits and Canvas UI are public shadcn registries, so the same three tools serve them.
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 150;
const CACHE_MS = 10 * 60 * 1000;

export const REGISTRIES = {
 magicui: {
  label: "Magic UI",
  registryUrl: "https://magicui.design/registry.json",
  itemUrl: (name) => `https://magicui.design/r/${name}.json`,
  withImportNote: true,
 },
 reactbits: {
  label: "React Bits",
  registryUrl: "https://reactbits.dev/r/registry.json",
  itemUrl: (name) => `https://reactbits.dev/r/${name}.json`,
  note: " Each component comes in four variants whose names end in -JS-CSS, -JS-TW, -TS-CSS and -TS-TW (language, then CSS or Tailwind). For a plain HTML page, read the -JS-CSS one.",
 },
 canvasui: {
  label: "Canvas UI",
  registryUrl: "https://canvasui.dev/r/registry.json",
  itemUrl: (name) => `https://canvasui.dev/r/${name}.json`,
  note: " Each component comes in one variant per framework, with names ending in -react, -vue, -svelte, -solid, -preact and -vanilla, and a -webgpu version of each. For a plain HTML page, read the -vanilla one.",
 },
};

const cache = new Map();

export function clearRegistryCache() {
 cache.clear();
}

async function fetchJson(url, label) {
 const res = await fetch(url, { headers: { accept: "application/json" } });
 if (!res.ok) throw new Error(`Failed to fetch ${label}: ${res.statusText} (Status: ${res.status})`);
 return res.json();
}

async function loadEntries(reg) {
 const hit = cache.get(reg.registryUrl);
 if (hit && Date.now() - hit.at < CACHE_MS) return hit.entries;
 const data = await fetchJson(reg.registryUrl, "registry.json");
 if (!data || !Array.isArray(data.items)) throw new Error("registry.json has no items list");
 const entries = data.items.filter((i) => i && typeof i.name === "string" && typeof i.type === "string");
 cache.set(reg.registryUrl, { at: Date.now(), entries });
 return entries;
}

const displayName = (name) => name.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
const componentName = (name) => name.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");

function normalizeKind(type) {
 if (type === "registry:ui") return "component";
 if (type === "registry:example") return "example";
 if (type === "registry:style") return "style";
 return type.replace(/^registry:/, "");
}

function buildCatalog(entries) {
 return entries.map((e) => ({
  name: e.name,
  title: e.title ?? displayName(e.name),
  description: e.description,
  kind: normalizeKind(e.type),
  registryType: e.type,
 }));
}

function singular(token) {
 if (token.length <= 3 || token.endsWith("ss")) return undefined;
 if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
 if (/(ches|shes|xes|zes|ses|oes)$/.test(token) && token.length > 4) return token.slice(0, -2);
 if (token.endsWith("s")) return token.slice(0, -1);
 return undefined;
}

function tokenizeValue(value) {
 const v = String(value ?? "").trim().toLowerCase();
 if (!v) return [];
 const raw = v.split(/[^a-z0-9]+/).filter(Boolean);
 const toks = raw.flatMap((t) => {
  const s = singular(t);
  return s && s !== t ? [t, s] : [t];
 });
 return [...new Set([v, ...toks])];
}

function tokenizeWords(value) {
 const v = String(value ?? "").trim().toLowerCase();
 if (!v) return [];
 return [...new Set(v.split(/[^a-z0-9]+/).filter(Boolean).map((t) => singular(t) ?? t))];
}

const searchTerms = (item) => [...new Set([item.name, item.title, item.description ?? "", item.kind, item.registryType].flatMap(tokenizeValue))];

function filterCatalog(catalog, opts = {}) {
 const kind = opts.kind?.trim().toLowerCase();
 const query = opts.query?.trim().toLowerCase();
 const words = tokenizeWords(opts.query ?? "");
 return catalog
  .filter((i) => !kind || i.kind.toLowerCase() === kind || i.registryType.toLowerCase() === kind)
  .filter((i) => {
   if (!query) return true;
   const terms = searchTerms(i);
   return terms.some((t) => t.includes(query)) || (words.length > 0 && words.every((w) => terms.some((t) => t.includes(w))));
  })
  .sort((a, b) => a.name.localeCompare(b.name));
}

function variantScore(value, variants, exact, contains) {
 let best = 0;
 for (const v of variants) {
  if (!v) continue;
  if (value === v) best = Math.max(best, exact);
  else if (value.includes(v)) best = Math.max(best, contains);
 }
 return best;
}

function termScore(terms, variants, exact, contains) {
 for (const v of variants) if (v && terms.some((t) => t === v)) return exact;
 for (const v of variants) if (v && terms.some((t) => t.includes(v))) return contains;
 return 0;
}

function searchScore(item, query) {
 const q = query.toLowerCase();
 if (!q) return 0;
 const terms = searchTerms(item);
 const words = tokenizeWords(query);
 const variants = [...new Set([q, ...words])];
 let score = 0;
 score += variantScore(item.name.toLowerCase(), variants, 120, 90);
 score += variantScore(item.title.toLowerCase(), variants, 100, 70);
 const d = item.description?.toLowerCase();
 if (d && variants.some((v) => v && d.includes(v))) score += 35;
 score += variantScore(item.kind.toLowerCase(), variants, 25, 15);
 score += variantScore(item.registryType.toLowerCase(), variants, 25, 15);
 score += termScore(terms, variants, 40, 20);
 if (words.length > 0 && words.every((w) => terms.some((t) => t.includes(w)))) score += 15;
 return score;
}

function paginate(items, opts = {}) {
 const n = Number(opts.limit);
 const limit = !n || Number.isNaN(n) ? DEFAULT_LIMIT : Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
 const o = Number(opts.offset);
 const offset = opts.offset === undefined || Number.isNaN(o) ? 0 : Math.max(Math.trunc(o), 0);
 const page = items.slice(offset, offset + limit);
 const next = offset + page.length;
 const hasMore = next < items.length;
 return { limit, offset, hasMore, nextOffset: hasMore ? next : undefined, items: page };
}

const availableKinds = (catalog) => [...new Set(catalog.map((i) => i.kind))].sort();

function filesSource(files) {
 const out = (files || [])
  .map((f) => {
   const c = typeof f.content === "string" ? f.content.trim() : "";
   if (!c) return undefined;
   return f.path ? `// File: ${f.path}\n${c}` : c;
  })
  .filter(Boolean)
  .join("\n\n");
 return out || undefined;
}

function regDepName(dep) {
 const d = String(dep ?? "").trim();
 if (!d) return undefined;
 if (d.startsWith("@magicui/")) return d.slice(9) || undefined;
 const m = d.match(/(?:^|\/)r\/([^/.]+)(?:\.json)?$/);
 if (m && m[1]) return m[1];
 if (!d.includes("/") && !d.includes(":")) return d.replace(/\.json$/, "") || undefined;
 return undefined;
}

function exampleMap(entries) {
 const map = new Map();
 for (const e of entries) {
  if (e.type !== "registry:example") continue;
  for (const dep of e.registryDependencies || []) {
   const n = regDepName(dep);
   if (!n) continue;
   if (!map.has(n)) map.set(n, []);
   if (!map.get(n).includes(e.name)) map.get(n).push(e.name);
  }
 }
 return map;
}

export async function listRegistryItems(reg, args = {}) {
 const catalog = buildCatalog(await loadEntries(reg));
 const filtered = filterCatalog(catalog, args);
 const page = paginate(filtered, args);
 return { total: filtered.length, limit: page.limit, offset: page.offset, hasMore: page.hasMore, nextOffset: page.nextOffset, availableKinds: availableKinds(catalog), items: page.items };
}

export async function searchRegistryItems(reg, args = {}) {
 const catalog = buildCatalog(await loadEntries(reg));
 const query = String(args.query ?? "").trim();
 const ranked = filterCatalog(catalog, { kind: args.kind })
  .map((item) => ({ item, score: searchScore(item, query) }))
  .filter((e) => e.score > 0)
  .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
  .map((e) => e.item);
 const page = paginate(ranked, args);
 return { query, total: ranked.length, limit: page.limit, offset: page.offset, hasMore: page.hasMore, nextOffset: page.nextOffset, availableKinds: availableKinds(catalog), items: page.items };
}

export async function getRegistryItem(reg, args = {}) {
 const name = String(args.name ?? "");
 const entries = await loadEntries(reg);
 const catalog = buildCatalog(entries);
 const item = catalog.find((e) => e.name === name);
 if (!item) throw new Error(`Registry item "${name}" was not found`);
 const entry = entries.find((e) => e.name === name);
 const itemUrl = reg.itemUrl(name);
 const detail = {
  ...item,
  install: { command: `npx shadcn@latest add "${itemUrl}"`, registryUrl: itemUrl },
  dependencies: entry.dependencies ?? [],
  registryDependencies: entry.registryDependencies ?? [],
 };
 const examples = exampleMap(entries);
 if (args.includeRelated) {
  const byName = new Map(catalog.map((e) => [e.name, e]));
  const names = item.kind === "component" ? examples.get(name) ?? [] : (entry.registryDependencies ?? []).map(regDepName).filter(Boolean);
  detail.relatedItems = names.flatMap((n) => (byName.has(n) ? [byName.get(n)] : []));
 }
 if (args.includeSource) {
  try {
   const full = await fetchJson(itemUrl, `registry item ${name}`);
   const source = filesSource(full.files);
   if (source) {
    detail.source = reg.withImportNote && item.kind === "component"
     ? `The code below is for context only. It helps you understand the component's props, types, and behavior. To actually install and use the component, refer to the install instructions above. After installing, the component will be available for import via: import { ${componentName(name)} } from "@/components/ui/${name}";${source}`
     : source;
   }
  } catch (e) {
   // The Magic UI package logs and goes on without source; do the same.
  }
 }
 if (args.includeExamples && item.kind === "component") {
  const results = await Promise.allSettled((examples.get(name) ?? []).map((n) => fetchJson(reg.itemUrl(n), `example ${n}`)));
  detail.examples = results.flatMap((r) => {
   if (r.status === "rejected") return [];
   const content = filesSource(r.value.files);
   if (!content) return [];
   return [{ name: r.value.name, title: r.value.title ?? displayName(r.value.name), description: r.value.description, content }];
  });
 }
 return detail;
}

const listSchema = {
 type: "object",
 properties: {
  kind: { type: "string", description: "Optional kind filter such as component, example, style, or a raw registry type like registry:ui." },
  query: { type: "string", description: "Optional text filter applied to names, titles, descriptions, and registry types." },
  limit: { type: "integer", minimum: 1, maximum: 150, description: "Maximum number of items to return. Defaults to 25." },
  offset: { type: "integer", minimum: 0, description: "Pagination offset for exhaustive registry browsing. Defaults to 0." },
 },
};
const searchSchema = {
 type: "object",
 properties: {
  query: { type: "string", minLength: 1, description: "Search query matched against names, titles, descriptions, and registry types." },
  kind: { type: "string", description: "Optional kind filter such as component, example, or style." },
  limit: { type: "integer", minimum: 1, maximum: 150, description: "Maximum number of results to return. Defaults to 25." },
  offset: { type: "integer", minimum: 0, description: "Pagination offset for stepping through ranked search results. Defaults to 0." },
 },
 required: ["query"],
};
const getSchema = {
 type: "object",
 properties: {
  name: { type: "string", description: "Exact registry item name, for example marquee." },
  includeSource: { type: "boolean", description: "Include the item's source code content." },
  includeExamples: { type: "boolean", description: "Include related example code when the item is a component." },
  includeRelated: { type: "boolean", description: "Include related registry items such as examples or dependencies." },
 },
 required: ["name"],
};

// Tool definitions for one registry. `call` returns a JSON value that the handler wraps as text content.
export function registryTools(id) {
 const reg = REGISTRIES[id];
 const L = reg.label;
 const N = reg.note || "";
 return [
  { name: "listRegistryItems", failure: "Failed to list registry items", description: `Lists ${L} registry items with optional filtering by kind, query, and limit.${N}`, inputSchema: listSchema, call: (a) => listRegistryItems(reg, a) },
  { name: "getRegistryItem", failure: "Failed to fetch registry item", description: `Gets detailed information for a single ${L} registry item. Set includeSource to get its source files.${N}`, inputSchema: getSchema, call: (a) => {
    if (typeof a.name !== "string" || !a.name) throw new Error("name is required");
    return getRegistryItem(reg, a);
   } },
  { name: "searchRegistryItems", failure: "Failed to search registry items", description: `Searches ${L} registry items by keyword or use case.${N}`, inputSchema: searchSchema, call: (a) => {
    if (typeof a.query !== "string" || !a.query.trim()) throw new Error("query is required");
    return searchRegistryItems(reg, a);
   } },
 ];
}
