// design_brief: one call that gathers design direction from every source and returns ONE compact plain-text answer (about 8 KB at most).
// Sources run in parallel and each has its own time limit. A source that errors or times out is left out without a word.
//   Inspo (public MCP, no key)           3 to 5 real-site references (name, URL, screenshot, palette, type) and a layout direction
//   Better Design (BETTER_DESIGN_KEY)    one matching design system as a ready-to-paste :root block, plus UI rules
//   Magic UI, React Bits, Canvas UI      3 to 6 component suggestions with the command that fetches their source
import { REGISTRIES, searchRegistryItems } from "./registry.js";

export const INSPO_URL = "https://inspomcp.dev/api/mcp";
export const BETTER_DESIGN_URL = "https://better-design.com/api/mcp";
export const BRIEF_MAX = 8000;
const SOURCE_MS = 6000;
const PROTOCOL = "2025-06-18";
const SCRIPT = "python3 /opt/1hc/skills/artifacts/scripts/design_mcp.py";

const clip = (s, n) => {
 const t = String(s ?? "").replace(/\s+/g, " ").trim();
 return t.length > n ? t.slice(0, n - 1).trimEnd() + "..." : t;
};

function withTimeout(fn, ms) {
 const ac = new AbortController();
 let timer;
 const slow = new Promise((_, reject) => { timer = setTimeout(() => { ac.abort(); reject(new Error("timed out")); }, ms); });
 return Promise.race([fn(ac.signal), slow]).finally(() => clearTimeout(timer));
}

// One JSON-RPC request to a streamable HTTP MCP server. Returns { result, session }. JSON and event-stream bodies both work.
async function rpc(url, headers, id, method, params, signal) {
 const res = await fetch(url, {
  method: "POST",
  signal,
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL, ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
 });
 if (!res.ok) throw new Error(`${url} answered ${res.status}`);
 const raw = await res.text();
 let msg;
 if (/text\/event-stream/.test(res.headers.get("content-type") || "")) {
  for (const block of raw.replace(/\r\n/g, "\n").split("\n\n")) {
   const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
   if (!data) continue;
   try { const m = JSON.parse(data); if (m && m.id === id) msg = m; } catch { /* ignore */ }
  }
 } else msg = JSON.parse(raw);
 if (!msg) throw new Error("no response");
 if (msg.error) throw new Error(String(msg.error.message || "error"));
 return { result: msg.result || {}, session: res.headers.get("mcp-session-id") };
}

const textOf = (result) => (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

// A small client for one upstream server: initialize once, then call tools. Each call has its own abort time.
function connect(url, headers = {}) {
 let session = null, next = 1, ready = null;
 const h = () => ({ ...headers, ...(session ? { "mcp-session-id": session } : {}) });
 const start = () => (ready ||= (async () => {
  const r = await withTimeout((signal) => rpc(url, headers, next++, "initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "1helm-design-brief", version: "1.0" } }, signal), SOURCE_MS);
  session = r.session;
  try { await withTimeout((signal) => fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...h() }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }).then((x) => x.arrayBuffer()), 2000); } catch { /* optional */ }
 })());
 return {
  async list() { await start(); return (await withTimeout((signal) => rpc(url, h(), next++, "tools/list", {}, signal), SOURCE_MS)).result.tools || []; },
  async call(name, args) {
   await start();
   const { result } = await withTimeout((signal) => rpc(url, h(), next++, "tools/call", { name, arguments: args }, signal), SOURCE_MS);
   const text = textOf(result);
   if (result.isError) throw new Error(clip(text, 120) || "tool error");
   return text;
  },
 };
}

const asJson = (t) => { try { return JSON.parse(t); } catch { return null; } };

// ---- Inspo ----
// References come from Inspo's own search: the subject's words as the query plus the filters (industry, vibe, style, color) that match values
// listed by get_filters, so a restaurant brief returns food and beverage sites. recommend supplies the layout direction, and its exemplars are
// used only when the search finds too few.
const STOP = new Set("a an the and or for of to in on at by with from into that this these those is are be it its as who what where when how site page website web single one two run runs ran made make build built about our your their my we you they".split(" "));
const words = (text) => [...new Set(String(text).toLowerCase().match(/[a-z]{3,}/g) || [])].filter((w) => !STOP.has(w));

// Words that name a kind of business, mapped to the industry value they belong to (used only when get_filters lists that value).
const INDUSTRY_WORDS = {
 "food-beverage": "food restaurant sushi ramen cafe bakery bread pastry coffee bar pub menu chef kitchen drink drinks beverage tea wine pizza bistro diner burger bbq catering brewery brewing bakery dessert icecream cocktail deli grill noodle taco seafood",
 fashion: "fashion clothing apparel boutique wear jewelry jewellery",
 travel: "travel hotel hostel tour trip vacation resort flights",
 health: "health clinic fitness wellness yoga dentist doctor gym therapy medical",
 education: "education school course class tutoring academy university learning",
 music: "music band album concert record label",
 furniture: "furniture decor interior home lighting",
 architecture: "architecture architect building construction",
 automotive: "car cars auto automotive motorcycle bike",
 ecommerce: "shop store ecommerce retail marketplace",
 gaming: "game games gaming esports",
 "non-profit": "charity nonprofit foundation donate volunteer",
 portfolio: "portfolio photographer designer illustrator artist",
 creator: "creator podcast newsletter youtuber",
 media: "magazine news media publication",
 fintech: "fintech banking payments invoice finance",
 saas: "saas software dashboard platform app",
 "developer-tools": "developer api sdk cli devtools",
 crypto: "crypto blockchain token wallet",
 ai: "ai assistant model agent",
 culture: "museum gallery theatre theater festival cinema",
};
// Which of Inspo's listed filter values the description names. Only values that appear in `filters` are ever returned.
export function inspoFilters(description, filters) {
 const ws = words(description), has = (k, v) => Array.isArray(filters && filters[k]) && filters[k].includes(v);
 const out = {};
 const industry = Object.keys(INDUSTRY_WORDS).find((v) => has("industry", v) && INDUSTRY_WORDS[v].split(" ").some((w) => ws.includes(w) || ws.some((x) => x.length > 4 && w.startsWith(x))));
 if (industry) out.industry = industry;
 else { const direct = ws.find((w) => has("industry", w)); if (direct) out.industry = direct; }
 for (const k of ["vibe", "style", "color"]) { const v = ws.find((w) => has(k, w)); if (v) out[k] = v; }
 return out;
}

async function inspoPart(description) {
 const c = connect(INSPO_URL);
 const filters = asJson(await c.call("get_filters", {}).catch(() => "")) || {};
 const want = inspoFilters(description, filters);
 const query = words(description).join(" ").slice(0, 200) || description;
 const attempts = [
  { query, ...want, pageType: "landing" },
  ...(want.industry ? [{ query, industry: want.industry, pageType: "landing" }, { industry: want.industry, ...(want.vibe ? { vibe: want.vibe } : {}), pageType: "landing" }] : []),
  { query, pageType: "landing" },
 ];
 let found = [], used = null;
 for (const a of attempts) {
  const r = asJson(await c.call("search_screens", { ...a, limit: 8 }).catch(() => ""));
  const rows = r && Array.isArray(r.results) ? r.results : [];
  if (rows.length >= 3 || (rows.length && a === attempts[attempts.length - 1])) { found = rows; used = a; break; }
 }
 const rec = asJson(await c.call("recommend", { brief: description, pageType: "landing", ...(want.vibe ? { vibe: want.vibe } : {}), ...(want.color ? { color: want.color } : {}) }).catch(() => "")) || {};
 const recRows = Array.isArray(rec.exemplars) ? rec.exemplars : [];
 // A search that found nothing leaves recommend's own picks; a search that found some keeps them first.
 const top = (found.length ? found : recRows).slice(0, 5);
 if (!top.length) throw new Error("no references");
 const base = /(https:\/\/\S+?\/captures\/)<slug>(\/hero[^\s)]*)/.exec(String((found.length ? "" : rec.images) || ""));
 const detail = await Promise.all(top.slice(0, 4).map((e) => c.call("get_screen", { slug: e.slug }).then(asJson).catch(() => null)));
 const refs = top.map((e, i) => {
  const d = detail[i] || {};
  const shot = d.image ? String(d.image).replace(/\?.*$/, "") : base ? base[1] + e.slug + base[2] : `https://0nme3pk5am3urwa9.public.blob.vercel-storage.com/captures/${e.slug}/hero.1440.webp`;
  return { title: e.title, url: d.sourceUrl || "", shot, palette: (e.palette || []).slice(0, 5), fonts: (e.fonts || []).slice(0, 3), mode: e.mode, note: e.northstar, tags: e.tags };
 });
 const ev = rec.evidence || {};
 const direction = [
  rec.pick?.macrostructure?.label ? `Layout: ${rec.pick.macrostructure.label}${rec.shortlist?.[1] ? ` (other options: ${rec.shortlist.slice(1, 3).map((s) => s.label).join(", ")})` : ""}.` : "",
  used && used.industry ? `References are ${used.industry} sites${used.vibe ? ` with a ${used.vibe} feel` : ""}.` : "",
  ev.paperBand?.consensus && !found.length ? `Most references are ${ev.paperBand.consensus} backgrounds with ${ev.displayClass?.consensus || "sans"} display type; take a position with it or against it.` : "",
  rec.heroGuidance ? `Hero: ${clip(rec.heroGuidance, 320)}` : "",
  rec.spacingGuidance ? `Spacing: ${clip(rec.spacingGuidance, 320)}` : "",
  rec.htmlNote ? clip(rec.htmlNote, 200) : "",
 ].filter(Boolean);
 const palette = found.length ? [...new Set(found.slice(0, 3).flatMap((e) => (e.palette || []).slice(0, 3)))].slice(0, 6) : (Array.isArray(rec.paletteSuggestion) ? rec.paletteSuggestion.slice(0, 6) : []);
 return { refs, direction, palette, fonts: [...new Set(top.flatMap((e) => e.fonts || []))].slice(0, 3) };
}

// ---- Better Design ----
const NAME_KEYS = ["query", "description", "brief", "prompt", "search", "text", "keywords", "personality", "style", "industry"];
const ERROR_TEXT = /^\s*(error|failed|invalid|missing|unknown|unauthori[sz]ed|forbidden|not found|pass either|you must|please provide)\b|pass either '/i;
// Better Design's own session notes and tool-call reminders are not design rules.
const META_LINE = /\bsession\b|loaded design guidance|not reviewed|pass either|get-review-rules|check-comprehension|inspect-spacing|\bcall `|\bnext step/i;

// A tool's arguments from its own schema. `extra` pins values (topic, target, an id). A string property with an enum gets the value the
// description names (an industry or a personality), or the first value when it is required. topic and query are never sent together.
function argsFor(tool, description, extra = {}, ref = null) {
 const props = tool?.inputSchema?.properties || {};
 const required = new Set(tool?.inputSchema?.required || []);
 const ws = words(description), out = {};
 for (const [k, spec] of Object.entries(props)) {
  const type = Array.isArray(spec.type) ? spec.type[0] : spec.type;
  if (k in extra) { out[k] = extra[k]; continue; }
  if (type !== "string") continue;
  if (Array.isArray(spec.enum)) {
   const pick = spec.enum.find((v) => String(v).toLowerCase().split(/[^a-z]+/).some((p) => p && (ws.includes(p) || ws.some((w) => w.length > 3 && p.startsWith(w)))))
    || (/industry|category/i.test(k) ? spec.enum.find((v) => Object.entries(INDUSTRY_WORDS).some(([ind, list]) => String(v).toLowerCase().includes(ind.split("-")[0]) && ws.some((w) => list.split(" ").includes(w)))) : null);
   if (pick !== undefined && pick !== null) out[k] = pick; else if (required.has(k)) out[k] = spec.enum[0];
   continue;
  }
  if (ref && /^(id|slug|designSystemId|designSystem)$/.test(k)) { out[k] = ref; continue; }   // the catalog id only; projectId is for generated systems
  if (NAME_KEYS.includes(k) || required.has(k)) out[k] = clip(description, 300);
 }
 for (const [k, v] of Object.entries(extra)) if (!(k in out) && (k in props || !Object.keys(props).length)) out[k] = v;
 if ("topic" in props && "query" in props) { if (out.topic !== undefined) delete out.query; else if (out.query !== undefined) delete out.topic; }
 return out;
}

// The matches in a find-design-system answer, in the order listed: "### [Name](url)", a description line, "_tags_ · id: `id`".
export function catalogMatches(text) {
 const out = [];
 for (const m of String(text).matchAll(/###\s*\[([^\]]+)\]\([^)]*\)\s*\n([\s\S]*?)(?:\n_([^\n]*?)_)?\s*·?\s*id:\s*`([a-z0-9][a-z0-9-]*)`/g)) {
  out.push({ id: m[4], name: m[1].trim(), description: m[2].trim(), tags: String(m[3] || "") });
 }
 return out;
}

const MOODS = new Set("playful warm editorial minimal minimalist bold luxe calm retro friendly elegant modern dark light quirky soft raw".split(" "));
const TECHNICAL = /developer|docs|documentation|\bapi\b|dashboard|analytics|console|admin|saas|terminal|desktop|macos|window chrome|fintech|trading|enterprise|cli\b/i;
const CONSUMER_FIT = /restaurant|food|hospitality|editorial|poster|photograph|warm|ecommerce|retail|boutique|magazine|brand|cafe|menu|hand-built|friendly|colorful|colourful/gi;

// The best catalog match for the subject and mood. The catalog's own order counts a little; words the description shares with the match, mood words,
// and consumer-facing words count more; a developer, dashboard or desktop-app system is penalised unless the request is technical.
export function pickSystem(matches, description) {
 const ws = words(description), technical = TECHNICAL.test(description);
 let best = null;
 matches.forEach((m, i) => {
  const text = `${m.name} ${m.description} ${m.tags}`.toLowerCase();
  let score = (matches.length - i) * 0.5;
  for (const w of ws) if (w.length > 3 && text.includes(w)) score += MOODS.has(w) ? 2 : 3;
  if (!technical) {
   score -= 4 * ((text.match(new RegExp(TECHNICAL.source, "gi")) || []).length > 0 ? 1 : 0);
   score += 1.5 * new Set((text.match(CONSUMER_FIT) || []).map((x) => x.toLowerCase())).size;
  }
  if (!best || score > best.score) best = { ...m, score };
 });
 return best;
}

// A system from a find-design-system answer: the best catalog match, or (older JSON or loose text) the first id found.
function systemIn(text, description = "") {
 const ms = catalogMatches(text);
 if (ms.length) { const b = pickSystem(ms, description); return { id: b.id, name: b.name }; }
 const f = firstWithId(asJson(text));
 if (f) return f;
 const m = /(?:designSystemId|\bid|\bslug)["']?\s*[:=]\s*["'`]?([a-z0-9]+(?:-[a-z0-9]+)*)/i.exec(text) || /`([a-z0-9]+(?:-[a-z0-9]+)+)`/.exec(text);
 return m ? { id: m[1], name: "" } : null;
}

function jsonStrings(v, out = [], depth = 0) {
 if (typeof v === "string") out.push(v);
 else if (v && typeof v === "object" && depth < 8) for (const x of Object.values(v)) jsonStrings(x, out, depth + 1);
 return out;
}

function firstWithId(v, depth = 0) {
 if (!v || typeof v !== "object" || depth > 4) return null;
 if (Array.isArray(v)) {
  for (const x of v) { const f = firstWithId(x, depth + 1); if (f) return f; }
  return null;
 }
 const id = v.designSystemId || v.id || v.slug;
 if (typeof id === "string" && (v.name || v.title || v.designSystemId || v.slug)) return { id, name: v.name || v.title || id };
 for (const x of Object.values(v)) { const f = firstWithId(x, depth + 1); if (f) return f; }
 return null;
}

function rootBlock(text) {
 const j = asJson(text);
 const all = j ? jsonStrings(j).join("\n") + "\n" + String(text) : String(text);
 const blocks = [...all.matchAll(/:root\s*\{[^}]*\}/g)].map((m) => m[0]);
 if (blocks.length) {
  const out = []; let used = 0;
  for (const b of blocks) { if (used + b.length > 1800) break; out.push(b); used += b.length; }
  return out.join("\n") || clip(blocks[0], 1800);
 }
 const vars = [...new Set([...all.matchAll(/^\s*(--[\w-]+\s*:\s*[^;\n]+;)/gm)].map((m) => m[1].trim()))].slice(0, 40);
 return vars.length ? `:root{\n${vars.map((v) => "  " + v).join("\n")}\n}` : "";
}

const SYSTEM_FONT = /^(sans-serif|serif|monospace|system-ui|inherit|var\(|ui-|-apple-system|blinkmacsystemfont|segoe ui|helvetica|arial|roboto mono|sfmono|menlo|monaco|consolas|liberation|georgia|cambria|times|courier|apple )/i;

// The fonts a kit really uses: the Google Fonts families in its @import line first, then font-family names. System stacks are left out.
// Also returns a stylesheet link for the Google families, so the page can load them.
export function fontsIn(text) {
 const names = [], google = [];
 const imp = /@import\s+url\(\s*["']?(https:\/\/fonts\.googleapis\.com\/css2\?[^"')]+)/.exec(String(text));
 if (imp) {
  for (const part of imp[1].replace(/^[^?]*\?/, "").split("&")) {
   if (!part.startsWith("family=")) continue;
   const fam = decodeURIComponent(part.slice(7).replace(/\+/g, " "));
   const name = fam.split(":")[0].trim();
   if (name && !SYSTEM_FONT.test(name) && !names.includes(name)) { names.push(name); google.push(part); }
  }
 }
 for (const m of google.length ? [] : String(text).matchAll(/font-family\s*:\s*([^;}\n]+)/g)) {
  for (const part of m[1].split(",")) {
   const n = part.trim().replace(/^['"]|['"]$/g, "");
   if (n && !SYSTEM_FONT.test(n) && !names.includes(n)) names.push(n);
  }
 }
 return { names: names.slice(0, 4), link: google.length ? `https://fonts.googleapis.com/css2?${google.join("&")}&display=swap` : "" };
}

export function ruleLines(text, n) {
 const out = [];
 for (const raw of String(text).split("\n")) {
  if (!/^\s*(?:[-*]|\d+[.)])\s+\S/.test(raw)) continue;   // bullets and numbered points only; headings, Topic and Aliases lines are not rules
  const l = raw.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  if (l.length > 24 && !META_LINE.test(l) && !/ = /.test(l) && !/^(topic|aliases?)\s*:/i.test(l) && !out.includes(l)) out.push(l);
  if (out.length >= n) break;
 }
 return out.map((l) => "- " + clip(l, 170));
}

async function betterDesignPart(description, env, trace = null) {
 const key = env && env.BETTER_DESIGN_KEY;
 if (!key) throw new Error("no key");
 const c = connect(BETTER_DESIGN_URL, { authorization: `Bearer ${key}` });
 const tools = await c.list();
 const tool = (n) => tools.find((t) => t.name === n);
 const ok = (t) => (t && !ERROR_TEXT.test(t) ? t : "");
 const callTool = (n, a) => (tool(n) ? c.call(n, a).then((t) => { trace?.push(`${n} ${JSON.stringify(a).slice(0, 160)} -> ${ok(t) ? "ok" : "error text"}: ${clip(t, 160)}`); return ok(t); }).catch((e) => { trace?.push(`${n} ${JSON.stringify(a).slice(0, 160)} -> failed: ${clip(e.message, 160)}`); return ""; }) : (trace?.push(`${n} -> not offered (tools: ${tools.map((t) => t.name).join(", ").slice(0, 300)})`), Promise.resolve("")));
 const ui = (topic) => callTool("get-ui-principle", argsFor(tool("get-ui-principle"), "", { topic }));   // topic only, never with query
 const [found, ui1, ui2] = await Promise.all([
  callTool("find-design-system", argsFor(tool("find-design-system"), description)),
  ui("hierarchy"),
  ui("color"),
 ]);
 let sys = found ? systemIn(found, description) : null;
 if (!sys && tool("find-design-system")) {   // a second try on the subject words alone
  const again = await callTool("find-design-system", argsFor(tool("find-design-system"), words(description).slice(0, 4).join(" ") || description));
  sys = again ? systemIn(again, description) : null;
 }
 let system = null;
 if (sys && tool("get-design-system-kit")) {
  const kit = await callTool("get-design-system-kit", argsFor(tool("get-design-system-kit"), description, { target: "html", designSystemId: sys.id }, sys.id));
  const root = rootBlock(kit);
  if (root) { const f = fontsIn(kit); system = { name: sys.name || sys.id, root, fonts: f.names, fontsLink: f.link }; }
 }
 const rules = [...new Set([...ruleLines(ui1, 3), ...ruleLines(ui2, 3)])];
 if (!system && !rules.length) throw new Error("nothing usable");
 return { system, rules };
}

// ---- component registries ----
const COMPONENT_STOP = new Set(["restaurant"]);
const componentWords = (text) => words(text).filter((w) => !COMPONENT_STOP.has(w) && w.length > 3).slice(0, 8);

const PICKS = [
 ["magicui", 2, null, ["marquee", "card", "grid", "text"]],
 ["reactbits", 2, /-JS-CSS$/, ["background", "text", "hover"]],
 ["canvasui", 2, /-vanilla$/, ["particles", "shader", "3d"]],
];

async function componentsPart(description) {
 const ws = componentWords(description);
 const lists = await Promise.all(PICKS.map(async ([id, want, variant, fallback]) => {
  const reg = REGISTRIES[id];
  const found = [];
  const add = (items) => { for (const it of items) if (found.length < want && (!variant || variant.test(it.name)) && !found.some((f) => f.name === it.name) && it.kind !== "style") found.push(it); };
  for (const q of [...ws, ...fallback]) {
   if (found.length >= want) break;
   try { add((await searchRegistryItems(reg, { query: q, limit: variant ? 40 : 6 })).items); } catch { return []; }
  }
  return found.map((it) => ({ id, label: reg.label, name: it.name, line: clip(it.description || it.title || "", 110) }));
 }));
 const flat = lists.flat();
 if (!flat.length) throw new Error("no components");
 return flat.slice(0, 6);
}

// ---- assembly ----
export function renderBrief(description, p) {
 const sections = [];
 sections.push({ keep: true, text: `DESIGN BRIEF for: ${clip(description, 220)}` });
 if (p.inspo) {
  sections.push({ keep: true, text: "DIRECTION\n" + p.inspo.direction.join("\n") });
  sections.push({ keep: true, text: "REFERENCES (real sites; study their palette, type and layout)\n" + p.inspo.refs.map((r, i) =>
   `${i + 1}. ${r.title}${r.url ? ` ${r.url}` : ""}${r.shot ? `\n   screenshot: ${r.shot}` : ""}\n   palette: ${r.palette.join(" ") || "n/a"}; fonts: ${r.fonts.join(", ") || "n/a"}; ${r.mode || ""}${r.note ? `\n   ${clip(r.note, 150)}` : ""}`).join("\n") });
 }
 const sys = p.better && p.better.system;
 if (sys) sections.push({ keep: true, text: `DESIGN SYSTEM TOKENS (${sys.name}${sys.fonts.length ? `; fonts: ${sys.fonts.join(", ")}` : ""}). Paste this into the page's <style>:\n${sys.root}${sys.fontsLink ? `\nLoad the fonts with: <link rel="stylesheet" href="${sys.fontsLink}">` : ""}` });
 else if (p.inspo && p.inspo.palette.length) {
  const f = p.inspo.fonts[0];
  sections.push({ keep: true, text: `STARTING TOKENS (palette from the references${f ? `, display font ${f}` : ""}). Paste this into the page's <style> and adjust to the mood:\n:root{\n${p.inspo.palette.map((c, i) => `  --color-${i + 1}: ${c};`).join("\n")}\n}` });
 }
 if (p.better && p.better.rules.length) sections.push({ text: "RULES\n" + p.better.rules.join("\n") });
 if (p.components && p.components.length) {
  sections.push({ text: "COMPONENTS (optional; port into plain HTML, CSS and JS, and fetch the source with the command)\n" + p.components.map((c) =>
   `- ${c.label} ${c.name}: ${c.line}\n  ${SCRIPT} ${c.id} getRegistryItem '{"name":"${c.name}","includeSource":true}'`).join("\n") });
 }
 const drop = sections.map((s, i) => i).filter((i) => !sections[i].keep).reverse();
 let out = sections.map((s) => s.text).join("\n\n");
 for (const i of drop) { if (out.length <= BRIEF_MAX) break; sections[i].text = ""; out = sections.map((s) => s.text).filter(Boolean).join("\n\n"); }
 return out.length > BRIEF_MAX ? out.slice(0, BRIEF_MAX - 1) + "\n" : out;
}

export async function designBrief(args, env) {
 const description = clip(args && args.description, 600);
 if (!description) throw new Error("description is required");
 const trace = args && args.debug ? [] : null;
 // skip: sources the caller does not want used, by name ("better-design"). Optional; without it every source runs, as before. 1Helm passes it for an
 // account that has not allowed Better Design (it keeps tool inputs and may train on them), so the description is never sent there.
 const skip = new Set((Array.isArray(args && args.skip) ? args.skip : []).map((x) => String(x).toLowerCase()));
 const run = (fn) => withTimeout(() => fn(), SOURCE_MS + 1000).catch(() => null);
 const [inspo, better, components] = await Promise.all([
  run(() => inspoPart(description)),
  skip.has("better-design") ? Promise.resolve(null) : run(() => betterDesignPart(description, env, trace)),
  run(() => componentsPart(description)),
 ]);
 if (!inspo && !better && !components) throw new Error("no design source answered");
 const text = renderBrief(description, { inspo, better, components });
 return trace ? `${text}\n\nDEBUG (Better Design calls)\n${trace.join("\n") || "(none)"}` : text;
}

export const briefTools = [{
 name: "design_brief",
 failure: "Could not build the design brief",
 text: true,
 description: "One call that returns a compact design brief for a page, site, deck or designed PDF: real-site references (Inspo), one design system as a ready-to-paste :root block (Better Design), a few UI rules, and component suggestions (Magic UI, React Bits, Canvas UI) with the command that fetches each one's source. Sources that fail are skipped.",
 inputSchema: { type: "object", properties: { description: { type: "string", description: "What it is, who it is for, and the mood." }, debug: { type: "boolean", description: "Append what each Better Design call returned." }, skip: { type: "array", items: { type: "string" }, description: "Sources not to use, by name. The only name is \"better-design\"; the description is then never sent to Better Design." } }, required: ["description"] },
 call: (a, env) => designBrief(a, env),
}];
