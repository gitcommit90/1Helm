// design_brief: one call that gathers design direction from every source and returns ONE compact plain-text answer (about 8 KB at most).
// Sources run in parallel and each has its own time limit. A source that errors or times out is left out without a word.
//   Inspo (public MCP, no key)           3 to 5 real-site references (name, URL, screenshot, palette, type) and a layout direction
//   Built-in theme catalog (catalog.js)  one matching design theme as a ready-to-paste :root block, its fonts, and our own UI rules; no network call
//   Magic UI, React Bits, Canvas UI      3 to 6 component suggestions with the command that fetches their source
import { REGISTRIES, searchRegistryItems } from "./registry.js";
import { CATALOG } from "./catalog.js";

export const INSPO_URL = "https://inspomcp.dev/api/mcp";
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

// ---- Design theme ----
const MOODS = new Set("playful warm editorial minimal minimalist bold luxe calm retro friendly elegant modern dark light quirky soft raw".split(" "));
const TECHNICAL = /developer|docs|documentation|\bapi\b|dashboard|analytics|console|admin|saas|terminal|desktop|macos|window chrome|fintech|trading|enterprise|cli\b/i;

// The best catalog theme for the subject and mood: words the description shares with a theme's name and tag line count (mood words a little less),
// and a theme tagged for developers or dashboards is penalised unless the request is technical. The first theme wins a tie.
export function pickSystem(matches, description) {
 const ws = words(description), technical = TECHNICAL.test(description);
 let best = null;
 for (const m of matches) {
  const text = `${m.name} ${m.tags}`.toLowerCase();
  let score = 0;
  for (const w of ws) if (w.length > 3 && text.includes(w)) score += MOODS.has(w) ? 2 : 3;
  if (!technical && TECHNICAL.test(text)) score -= 4;
  if (!best || score > best.score) best = { ...m, score };
 }
 return best;
}

// Short rules on hierarchy, color, spacing and type, written for this brief.
const RULES = [
 "Give each screen one focal point, usually the page title or the main action, and make it clearly the largest or highest contrast element.",
 "Use at most three type sizes per section (title, body, caption), and change size or weight, not both together, to show rank.",
 "Keep body text near 16 px with a line height of 1.5, and limit lines to about 65 characters.",
 "Use the primary color only for the main action and for links, so it stays rare enough to guide the eye.",
 "Draw neutral surfaces, borders and secondary text from the muted and border variables rather than new greys.",
 "Check contrast: body text needs at least 4.5 to 1 against its background, and large text needs 3 to 1.",
 "Never use color alone for meaning. Pair it with a label, an icon or a shape.",
 "Space things on one scale (for example 4, 8, 16, 24, 48 px), and put more space between groups than inside a group.",
 "Align elements to a shared left edge or grid, and keep padding equal on matching cards and sections.",
 "Use a single radius and a single shadow from the tokens for every card and button.",
 "Keep each section to one message with a short heading, and cut any text that repeats the heading.",
].map((r) => "- " + r);

// The theme that best fits the description: scores the catalog's names and tag lines, with no network call and no model.
export function themeFor(description) {
 const t = pickSystem(CATALOG, description);
 const block = (vars) => Object.entries(vars).map(([k, v]) => `  --${k}:${v};`).join("\n");
 const family = (stack) => /^"([^"]+)"/.exec(stack)[1];
 const root = `:root{\n${block(t.light)}\n  --radius:${t.radius};\n  --shadow:${t.shadow};\n${Object.entries(t.fonts).map(([k, v]) => `  --font-${k}:${v};`).join("\n")}\n}\n.dark{\n${block(t.dark)}\n}`;
 return { id: t.id, name: t.name, root, fonts: [...new Set(Object.values(t.fonts).map(family))] };
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
 const sys = p.theme;
 if (sys) sections.push({ keep: true, text: `DESIGN THEME TOKENS (${sys.name}; fonts: ${sys.fonts.join(", ")}, installed on your computer). Paste this into the page's <style>. Style with var(--background), var(--primary) and the other names; add class="dark" on <html> for the dark version:\n${sys.root}` });

 sections.push({ text: "RULES\n" + RULES.join("\n") });
 if (p.components && p.components.length) {
  sections.push({ text: "COMPONENTS (optional; port into plain HTML, CSS and JS, and fetch the source with the command)\n" + p.components.map((c) =>
   `- ${c.label} ${c.name}: ${c.line}\n  ${SCRIPT} ${c.id} getRegistryItem '{"name":"${c.name}","includeSource":true}'`).join("\n") });
 }
 const drop = sections.map((s, i) => i).filter((i) => !sections[i].keep).reverse();
 let out = sections.map((s) => s.text).join("\n\n");
 for (const i of drop) { if (out.length <= BRIEF_MAX) break; sections[i].text = ""; out = sections.map((s) => s.text).filter(Boolean).join("\n\n"); }
 return out.length > BRIEF_MAX ? out.slice(0, BRIEF_MAX - 1) + "\n" : out;
}

export async function designBrief(args) {
 const description = clip(args && args.description, 600);
 if (!description) throw new Error("description is required");
 const run = (fn) => withTimeout(() => fn(), SOURCE_MS + 1000).catch(() => null);
 const [inspo, components] = await Promise.all([run(() => inspoPart(description)), run(() => componentsPart(description))]);
 return renderBrief(description, { inspo, theme: themeFor(description), components });
}

export const briefTools = [{
 name: "design_brief",
 failure: "Could not build the design brief",
 text: true,
 description: "One call that returns a compact design brief for a page, site, deck or designed PDF: real-site references (Inspo), one built-in design theme as a ready-to-paste :root block with its fonts, a few UI rules, and component suggestions (Magic UI, React Bits, Canvas UI) with the command that fetches each one's source. Sources that fail are skipped.",
 inputSchema: { type: "object", properties: { description: { type: "string", description: "What it is, who it is for, and the mood." } }, required: ["description"] },
 call: (a) => designBrief(a),
}];
