// Integration hint + one gentle nudge (a question about the cost of a TaskRabbit cleaning was once
// answered from TaskRabbit's web cost guide, and the built-in Taskrabbit integration was used only after the person asked about it). With ~1,500 integrations the helper can't see most of them up front, so:
//
// 1. The hint. Each chat turn's own words are matched against the integrations catalog (the same cached list find_app and the Apps
//    popup use: connect-offer.js appCatalog) plus our own Gmail / Calendar tools. Lexical only, no model call, no embedding:
//    - brand names: a 1–4 word window of the message, letters and digits only, equal to an app's name ("TaskRabbit", "task rabbit"
//      via ALIASES, "Hacker News", "Seat Geek") or its id ("taskrabbit_mcp" → taskrabbit); a bare domain ("monday.com") too.
//      URLs and email addresses are left out (a link to read isn't a request to use that service).
//    - names that are ordinary words ("Box", "Close", "Monday", "Here", "Make", "Linear", "Square"): only with "app" / "account" /
//      "integration" right after them, or as a bare domain. A name counts as an ordinary word when it's on the COMMON list or shows up
//      in lower case in two or more other apps' descriptions (the catalog's own text tells "make" from "Taskrabbit").
//    - a few very specific intents (INTENTS: "handyman" / "Tasker" → Taskrabbit, "hiking trails" → AllTrails…).
//    Generic requests match nothing and get no hint. At most 3 apps. Composio's own web search / code tools and Soon or retired apps
//    are never hinted. The hint is ONE line in this turn's message, next to the time and location lines (never the system prompt, so
//    the cached prefix stays the same, and never saved with the message):
//      (Relevant integrations: Taskrabbit [taskrabbit_mcp] (no sign-in needed): find and book local services…. Connected: Gmail
//       (gmail_search, gmail_read; 2 accounts). Try the integration first: app_actions finds its actions, and app_proxy calls the app's own API for anything they don't cover. The web is for what the app can't do.)
// 2. The nudge. If this turn's hint named app X and, before any integration tool has run in the turn, the helper's web step is
//    about X (web_search naming X or the words that matched; fetch_url / browser_navigate / browser_task opening X's site), that call
//    answers once "X has an integration (…). Use it, or say briefly why the web is better and call this again." and runs nothing.
//    The very next identical call runs. Once per app per task (kept in the Resident's kv, so a later turn of the task isn't nudged
//    again). Never for generic searches (no hint → no nudge), never when the person asked for the web or the website. The nudged call
//    didn't run, so it isn't counted by the runaway watch (spendguard.js guardTools skips it) and it isn't a "no progress" sign.
import { appCatalog, statusFor, connectKind, oneLine, withConnectedTwin } from "./connect-offer.js";
import { twinKept } from "./app-visibility.js";
import { BUILTIN_APPS_LATEST, isHiddenApp, builtinApps } from "./builtin-apps.js";
import { askedForWebsite, connectedServiceFor, callKey, addAppNote } from "./appfirst.js";
import { personWords } from "../person-asked.js";
import { customMentions, customKeys, displayOf } from "./custom-mcp.js";

// Never hinted: Composio's own general tools (they're the web search / code runner the helper already has) and test toolkits.
const SKIP = new Set(["composio", "codeinterpreter", "test_app", "jev", "googlesuper"]);
// Names that are ordinary words: catalog names found in an English word list (offline, 10-08), minus the ones that nearly always mean
// the brand in a request (Slack, Notion, Stripe, Discord, Telegram, Viator…), plus days and months. Besides these, a word the
// catalog's own descriptions use in lower case (2+ other apps) or of 3 letters or less counts as ordinary too.
const COMMON = new Set(("ably abstract affinity alchemy alpaca amara amplitude apollo april arena asana august bart basin beamer bench blackboard blitz bonsai borneo bouncer  " +
  "box braze breeze bubble buffer cal candid canny canvas captions carbone cats ceramic certifier chameleon chaser clarify clay close clover coda cohere  " +
  "conductor consensus contacts convex conveyor copper countdown craft crisp cults currents cursor daily dart december delighted dice dictionary doppler  " +
  "dovetail draftable dub engage enigma enrich eraser excel exist extrovert faceup fairing faraday fathom feathery february felt fidel fingertip  " +
  "fireflies fixer float fly folk friday gamma gemini gender gist gong goody granola granted greenhouse grist gusto handwrite harness harvest heartbeat  " +
  "here hex hive honcho honeycomb hunter instantly intercom iterable iterate jam january jobber july june kernel keyword kit knack lever lilt line  " +
  "linear lob lucid magnetic make march may mem mercury metaphor missive modem moderation monday motion mural needle neon neutrino news november  " +
  "nutshell octagon october ordinal outline outlook parallel parma persona piggy pinata pinecone placid plaid plain pneumatic polygon poof postman  " +
  "postmark postpone pushover pylon quo radar railway raindrop ramp refiner render replicate reply resend retable retailed rev revolt roam runway sanity  " +
  "saturday scorecard seam search sec segment sender sentry september shortcut sideshow snowflake specific splice square sunday tally teamwork temporal  " +
  "thursday tidy timely tisane tuesday twenty twitter typecast vantage vibe wednesday wise workable workday writer zoom").trim().split(/\s+/));
// Multi-word names made of everyday words: same rule as COMMON.
const COMMON_PHRASES = new Set(["text to pdf", "just one", "browser tool", "code interpreter", "magic hour", "check cherry", "order desk", "resource planner",
  "engage platform", "kanban tool", "conversion tools", "the companies", "beach day", "the odds", "the org", "world news", "remote retrieval", "postal data",
  "agent mail", "common room", "upload to url", "html to image", "parallel task", "simple analytics", "bug recorder", "page x", "more trees", "short menu",
  "drop to cdn", "deadline funnel", "process street", "token metrics", "read ai", "async interview", "hub planner", "twelve data", "better proposals",
  "magic patterns", "artificial analysis", "company url finder", "plate recognizer", "invalid bounce", "easy email verification", "bulk email checker",
  "campaign cleaner", "ideal postcodes", "viral loops", "happy scribe", "mighty networks", "listen notes", "census bureau", "control d", "job search",
  "financial datasets ai", "legal data hunter", "human approval", "digital humani", "web3 career", "html css to image", "bread butter", "fish audio",
  "pdf vector", "pdf blocks", "pdf munk", "eagle doc", "ocr web service", "scrape do", "page x", "data247", "the odds api", "better stack", "new relic"]
  .map((s) => s.replace(/[^a-z0-9]/g, "")));
// Nicknames and spellings → app id (only used when that id is in the catalog). Brand-specific only: "calendar" or "docs" alone is no hint.
export const ALIASES = {
  "task rabbit": "taskrabbit_mcp", taskrabbit: "taskrabbit_mcp", gmail: "gmail", "google mail": "gmail", gcal: "googlecalendar", gdrive: "googledrive",
  "google doc": "googledocs", "google sheet": "googlesheets", gsheets: "googlesheets", "google slide": "googleslides", "google photo": "googlephotos",
  youtube: "youtube", "you tube": "youtube", yt: "youtube", insta: "instagram", instagram: "instagram", facebook: "facebook", fb: "facebook",
  twitter: "twitter", "x.com": "twitter", "ms teams": "microsoft_teams", "microsoft teams": "microsoft_teams", hotmail: "outlook", "outlook.com": "outlook",
  "microsoft outlook": "outlook", "outlook email": "outlook", "outlook calendar": "outlook", onedrive: "one_drive", "one drive": "one_drive", quickbooks: "quickbooks", "quick books": "quickbooks",
  "all trails": "alltrails_mcp", alltrails: "alltrails_mcp", trivago: "trivago_mcp", viator: "viator_mcp",
  godaddy: "godaddy_mcp", "go daddy": "godaddy_mcp", cloudflare: "cloudflare_mcp", "cloudflare mcp": "cloudflare_mcp", malwarebytes: "malwarebytes_mcp", deepwiki: "deepwiki_mcp", "hacker news": "hackernews",
  "zoom meeting": "zoom", "zoom meetings": "zoom", "zoom call": "zoom", "zoom calls": "zoom", "monday.com": "monday_mcp", "notion page": "notion_mcp", "notion pages": "notion_mcp",
  "notion doc": "notion_mcp", "notion database": "notion_mcp", "outlook inbox": "outlook", "stripe dashboard": "stripe_mcp", "stripe payments": "stripe_mcp", "square pos": "square",
  "linear issue": "linear_mcp", "linear issues": "linear_mcp", "linear ticket": "linear_mcp", "linear tickets": "linear_mcp", "excel online": "excel",
};
// Very specific intents → app id. Whole words, case-insensitive. Kept short on purpose: anything vaguer is a generic request.
export const INTENTS = [
  [/\b(taskers?|handym[ae]n|handy (?:man|person))\b/i, "taskrabbit_mcp"],
  [/\b(hiking|hike|biking|trail running|mountain bike) trails?\b/i, "alltrails_mcp"],
  [/\b(?:is|are) (?:the )?domains? [a-z0-9-]+\.[a-z]{2,} (?:available|taken|free)\b|\bdomain (?:name )?availability\b/i, "godaddy_mcp"],
  [/\bcve-\d{4}-\d{3,}\b/i, "osv"],
];
// ---- built-in routes: "if X, start with Y" ----
// Strong, shaped intents only (guard rules from the audit): a bare everyday word ("hike", "tour") never routes; a
// narrative or past-tense sentence ("we hiked…", "my tour yesterday") never routes; "search the web" / "on their website" wins. Each route names the exact action and its
// main inputs, so the helper can app_run it directly (no app_actions step). Deny-listed apps (builtin-apps.js) are never routed.
const NARRATIVE = /\b(?:i|we|my|our)\b.{0,25}\b(?:hiked|went|did|was|were|had|saw|stayed|took|booked|visited|yesterday|last (?:week|weekend|month|year|night|time))\b/i;
const PRICEQ = /\b(price|prices|cost|costs|how much|cheap|cheapest|tickets? (?:cost|prices?))\b/i;
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
export const ROUTES = [
  { id: "home-service-price", app: "taskrabbit_mcp", test: (t) => /\b(house ?clean(?:ing|ers?)|clean(?:ing)? (?:my|the|our) (?:house|home|apartment|place|condo)|(?:house|home|apartment|place|condo) (?:\\w+ )?(?:cleaned|cleaning)|furniture assembly|assembl(?:e|ing) (?:my |an? )?(?:ikea|furniture|desk|bed)|tv mounting|mount(?:ing)? (?:a|my|the) tv|help(?: me)? move|movers?|moving help|yard work|handym[ae]n)\b/i.test(t) && PRICEQ.test(t),
    start: 'app_run TASKRABBIT_MCP_CHECK_SERVICE_AVAILABILITY with {"service": "<their words>", "postalCode": "<ZIP>"} (or "city" and "state")', note: "real local hourly rates and available Taskers" },
  { id: "tours", app: "viator_mcp", test: (t) => /\b(tours?|excursions?|day trips?|cooking class(?:es)?|wine tasting|food tour|walking tour|boat trip)\b/i.test(t) && /\b(?:in|near|around|from) [A-Z]/.test(t) && !/\btour dates\b|\bon tour\b/i.test(t),
    start: 'app_run VIATOR_MCP_SEARCH_EXPERIENCES with {"searchTerm": "<what and where>", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "sessionId": "<any text>", "limit": 5}', note: "price, rating, duration and free cancellation; the person books" },
  { id: "trails", app: "alltrails_mcp", test: (t) => /\b(hikes?|hiking|trails?|trailheads?)\b/i.test(t) && (/\b(?:near|in|around|close to|outside) (?:me\b|[A-Z])/.test(t) || /\b(nearby|near me|dog[- ]friendly|easy|moderate|hard|loop|miles?|elevation|forecast|weather)\b/i.test(t)) && !/\bpaper trail|trail mix|trailer|audit trail\b/i.test(t),
    start: 'app_run ALLTRAILS_MCP_SEARCH_TRAILS_BY_NAME with {"input": {"search_query": "<trail or area>"}} (or ALLTRAILS_MCP_FIND_TRAILS_NEAR_LOCATION with {"input": {"latitude", "longitude", "max_radius": 15000}})', note: "length, gain, difficulty, rating; ALLTRAILS_MCP_GET_TRAIL_WEATHER_OVERVIEW with {\"input\": {\"trail_id\"}} gives the 7-day trailhead forecast" },
  { id: "cheapest-month", app: "trivago_mcp", test: (t) => new RegExp(`\\b(cheapest|best|least expensive|cheaper) (?:month|time|season|week) (?:to|for) (?:visit|go|stay|travel|book)|\\bwhen (?:are|is) (?:the )?hotels? (?:cheapest|cheaper)|\\bhotel prices? in [A-Z]\\w+ in (?:${MONTHS})\\b`, "i").test(t),
    start: 'app_run TRIVAGO_MCP_TRIVAGO_DESTINATION_PRICE_TRENDS with {"query": "<city>"}', note: "average, lowest and highest nightly rate by month; live rates for dates need the web" },
  { id: "domain-check", app: "godaddy_mcp", raw: true, test: (t) => /\b(?:is|are) (?:the )?(?:domains? )?[a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2})? (?:still )?(?:available|taken|free|registered|for sale)\b|\bdomain (?:name )?availability\b|\bcan i (?:get|register|buy) (?:the domain )?[a-z0-9-]+\.[a-z]{2,}\b/i.test(t),
    start: 'app_run GODADDY_MCP_DOMAINS_CHECK_AVAILABILITY with {"domains": "<name.tld>"}', note: "exact match only; never suggest look-alike names" },
];
// Words in a web search that mean it's about the routed thing (the nudge), per route.
const ROUTE_KEYS = { "home-service-price": ["cleaning", "handyman", "movers", "assembly"],
  tours: ["tour", "tours", "excursion", "daytrip"], trails: ["hike", "hikes", "trail", "trails", "hiking"], "cheapest-month": ["cheapestmonth", "besttimetovisit"], "domain-check": ["domain", "whois"] };
// Sites that mean the web step is about the routed thing (the nudge's "opening its site").
const ROUTE_HOSTS = { tours: ["getyourguide.com", "tripadvisor.com"], trails: ["hikingproject.com", "trailforks.com"], "domain-check": ["whois.com", "rdap.verisign.com", "who.is", "namecheap.com"], "cheapest-month": ["kayak.com/hotels", "hotels.com"] };
// The same start actions when the person names the app itself (an unambiguous main action only: trivago's depends on the question).
const BY_NAME = Object.fromEntries(ROUTES.filter((r) => !["trivago_mcp", "alltrails_mcp"].includes(r.app)).map((r) => [r.app, r]));
// → [{ slug, route, at }] for the shaped intents in this text (raw: the text with its domains kept).
export function matchRoutes(text, raw = text) {
  const t = String(text || ""); if (!t.trim() || WEB_ASK.test(t) || NARRATIVE.test(t)) return [];
  const out = []; for (const r of ROUTES) if (!isHiddenApp(r.app) && r.test(r.raw ? String(raw || "") : t)) out.push({ slug: r.app, route: r, at: 0 });
  return out;
}
const SUFFIX = new Set(["app", "apps", "account", "accounts", "integration", "integrations", "workspace", "mcp"]);
// Our own tools for these apps (composio.js GOOGLE_TOOLS): named in the hint instead of app_actions.
const OWN_TOOLS = { gmail: "gmail_search, gmail_read", googlecalendar: "calendar_events, calendar_add" };
// Sites whose host doesn't carry the app's name (the nudge's "opening its site").
const HOSTS = { hackernews: ["news.ycombinator.com", "hn.algolia.com"], osv: ["osv.dev"], deepwiki_mcp: ["deepwiki.com"] };
const APP_TOOLS = new Set(["app_actions", "app_run", "app_proxy", "find_app", "offer_connect", "gmail_search", "gmail_read", "gmail_draft", "gmail_send", "calendar_events", "calendar_add"]);
const WEB_TOOLS = new Set(["web_search", "fetch_url", "browser_navigate", "browser_task"]);
const WEB_ASK = /\b(search (?:the )?(?:web|internet|online)|web search|google (?:it|that|this)|look (?:it )?up online|on (?:the|their) (?:web ?site|site)|(?:the|their) web ?site|online reviews)\b/i;

const compact = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const strip = (n) => String(n || "").replace(/\s*\((?:[^)]*)\)\s*$/, "").replace(/\s+(mcp|api)$/i, "").trim();
const words = (s) => String(s || "").toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z0-9]+/).filter(Boolean);

// ---- the index (cached per catalog list) ----
let IDX = null;   // { list, keys: Map(compactKey → { slug list, n: Set(word counts), common }), bySlug }
export function buildIndex(list = []) {
  const bySlug = new Map(); for (const a of list) if (a?.s && !bySlug.has(a.s)) bySlug.set(a.s, a);
  // How often each lower-case word appears in the catalog's descriptions (one count per app): everyday words show up a lot.
  const df = new Map();
  for (const a of list) for (const w of new Set(String(a.d || "").split(/[^A-Za-z0-9]+/).filter((w) => /^[a-z0-9]+$/.test(w)))) df.set(w, (df.get(w) || 0) + 1);
  const keys = new Map();
  const add = (key, slug, n, common) => {
    if (!key || key.length < 2) return;
    const e = keys.get(key) || { slugs: [], n: new Set(), common: false };
    if (!e.slugs.includes(slug)) e.slugs.push(slug); e.n.add(n); e.common ||= common; keys.set(key, e);
  };
  for (const a of list) {
    if (!a?.s || SKIP.has(a.s) || a.x) continue;
    const name = strip(a.n || a.s), ws = words(name), own = new Set(String(a.d || "").split(/[^A-Za-z0-9]+/).filter((w) => /^[a-z0-9]+$/.test(w)));
    const everyday = (w) => COMMON.has(w) || (df.get(w) || 0) - (own.has(w) ? 1 : 0) >= 2 || w.length <= 3;
    const common = ws.length === 1 ? everyday(ws[0]) : COMMON_PHRASES.has(ws.join("")) || ws.every((w) => everyday(w) || /^(ai|io|hr|crm|api|app|pdf|the|to|of|and|by)$/.test(w));
    if (ws.length) add(ws.join(""), a.s, ws.length, common);
    const sl = compact(a.s.replace(/_(mcp|api)$/, ""));
    if (sl && sl !== ws.join("")) add(sl, a.s, 1, sl.length <= 3 || COMMON.has(sl));
  }
  for (const [k, slug] of Object.entries(ALIASES)) if (slug && bySlug.has(slug) && !SKIP.has(slug)) {
    const n = k.includes(".") ? 1 : k.split(" ").length, key = compact(k);
    const e = keys.get(key) || { slugs: [], n: new Set(), common: false };
    e.slugs = [slug, ...e.slugs.filter((s) => s !== slug)]; e.n.add(n); e.common = false; e.alias = true; keys.set(key, e);
  }
  return { list, keys, bySlug };
}
const indexFor = (list) => (IDX && IDX.list === list ? IDX : (IDX = buildIndex(list)));

// ---- their apps (apps-used.js) ----
const LEAD = new Set(["my", "our", "in", "on", "from", "to", "via", "with", "into", "through", "using"]);
const CALENDAR_WORD = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)$/;
// A plain kind of thing → their apps of that kind, in this order. Only what is clearly in an outside app: never 1Helm's own tasks,
// to-dos, notes, files or Notebook ("my tasks", "my notes", "my files" say nothing about which app).
const MY = "(?:my|our)";
export const PRIORS = [
  [new RegExp(`\\b${MY} (?:e-?mails?|inbox(?:es)?|mail)\\b|\\b(?:e-?mail|reply to|forward) (?:from|to) \\w+`, "i"), ["gmail", "outlook"]],
  [new RegExp(`\\b${MY} (?:calendars?|schedule|meetings?|appointments?)\\b|\\b(?:on|to|in|from) my calendar\\b`, "i"), ["googlecalendar", "outlook"]],
  [new RegExp(`\\b${MY} (?:drive|shared drive|cloud (?:storage|drive))\\b`, "i"), ["googledrive", "one_drive", "dropbox"]],
  [new RegExp(`\\b${MY} (?:spreadsheets?|sheets?)\\b`, "i"), ["googlesheets", "excel", "airtable"]],
  [new RegExp(`\\b${MY} (?:slide decks?|slides|presentations?)\\b`, "i"), ["googleslides", "canva"]],
  [new RegExp(`\\b${MY} (?:team chat|work chat|chat channels?|team channels?|dms)\\b|\\bmessage (?:my|the) team\\b`, "i"), ["slack", "microsoft_teams"]],
  [/\b(?:video call|video meeting|meeting link|call link)s?\b/i, ["zoom", "microsoft_teams"]],
  [new RegExp(`\\b${MY} (?:boards?|tickets?|sprints?|backlog|kanban)\\b`, "i"), ["trello", "jira", "asana", "monday", "clickup"]],
  [/\b(?:design|make|create) (?:a |an |the )?(?:flyer|poster|banner|graphic|thumbnail|logo|invitation|social post)\b/i, ["canva", "figma"]],
  [new RegExp(`\\b${MY} (?:payments?|payouts?|charges|subscribers|revenue|refunds?)\\b`, "i"), ["stripe", "shopify"]],
  [new RegExp(`\\b${MY} (?:store|shop|online orders?|products|inventory)\\b`, "i"), ["shopify"]],
  [new RegExp(`\\b${MY} (?:books|bookkeeping|accounting|invoices?|expenses|p&l)\\b`, "i"), ["quickbooks", "stripe"]],
  [new RegExp(`\\b${MY} (?:crm|leads|deals|sales pipeline|pipeline)\\b`, "i"), ["hubspot", "salesforce"]],
  [new RegExp(`\\b${MY} (?:followers|feed|page|business page)\\b|\\b(?:post|share|publish) (?:this |it |that )?(?:on|to) (?:our|my) (?:social|socials|page)\\b`, "i"), ["instagram", "facebook", "linkedin"]],
  [new RegExp(`\\b${MY} (?:repos?|repository|repositories|pull requests?|prs|issues on github)\\b`, "i"), ["github", "jira"]],
  [new RegExp(`\\b${MY} (?:booking link|scheduling link|availability)\\b`, "i"), ["calendly"]],
  [new RegExp(`\\b${MY} (?:videos|channel|subscribers)\\b`, "i"), ["youtube"]],
];

// ---- matching ----
const URLS = /\b(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
const DOMAIN = /\b([a-z0-9][a-z0-9-]*)\.(com|io|ai|co|so|app|dev|org|net|us)\b/gi;
// → [{ slug, via, how: "name" | "alias" | "domain" | "intent", at }] in the order they appear, one per app.
// used: the slugs on their "Apps I use" list (apps-used.js), a prior: an ordinary-word name of one of THEIR apps ("Zoom", "my outlook",
// "in Teams") matches when it's capitalized or follows my/our/in/on/from/to/via/with/into, and a few plain kinds of thing ("my inbox",
// "our Instagram followers", "my repos") point at their app of that kind (how "prior": a softer line of its own, never a nudge).
export function matchIntegrations(text, list, { max = 3, exclude = null, used = null } = {}) {
  const ix = indexFor(list), out = [], seen = new Set();
  const push = (slug0, via, how, at) => { const slug = twinKept(slug0) || slug0; if (!slug || seen.has(slug) || !ix.bySlug.has(slug) || SKIP.has(slug) || isHiddenApp(slug) || exclude?.has?.(slug)) return; seen.add(slug); out.push({ slug, via, how, at }); };
  const s0 = String(text || "").replace(URLS, " ");
  for (const m of s0.matchAll(DOMAIN)) {
    const full = compact(m[0]), label = compact(m[1]), e = ix.keys.get(full) || ix.keys.get(label);
    if (e) push(e.slugs[0], m[0].toLowerCase(), "domain", m.index);
  }
  const s = s0.replace(DOMAIN, " "), toks = [];
  for (const m of s.replace(/[’']s\b/gi, "").matchAll(/[A-Za-z0-9]+/g)) toks.push({ w: m[0].toLowerCase(), raw: m[0], at: m.index });
  const theirs = (e, i) => !!used?.has?.(e.slugs[0]) && !CALENDAR_WORD.test(toks[i].w) && (/^[A-Z]/.test(toks[i].raw) || LEAD.has(toks[i - 1]?.w));
  const taken = new Array(toks.length).fill(false);
  for (let n = 4; n >= 1; n--) for (let i = 0; i + n <= toks.length; i++) {
    if (taken.slice(i, i + n).some(Boolean)) continue;
    const key = toks.slice(i, i + n).map((t) => t.w).join(""), e = ix.keys.get(key);
    if (!e || !e.n.has(n)) continue;
    if (e.common && !e.alias && !SUFFIX.has(toks[i + n]?.w) && !theirs(e, i)) continue;
    for (let k = i; k < i + n; k++) taken[k] = true;
    push(e.slugs[0], toks.slice(i, i + n).map((t) => t.w).join(" "), e.alias ? "alias" : "name", toks[i].at);
  }
  for (const [re, slug] of INTENTS) { const m = re.exec(s); if (m) push(slug, m[0].toLowerCase(), "intent", m.index); }
  if (used?.size) { let n = 0; for (const [re, slugs] of PRIORS) { const m = re.exec(s); if (!m) continue; for (const sl of slugs) if (used.has(sl) && n < 2 && !seen.has(sl)) { push(sl, m[0].toLowerCase(), "prior", s.length + m.index); n++; } } }
  for (const r of matchRoutes(s, s0)) { if (seen.has(r.slug)) { const x = out.find((o) => o.slug === r.slug); if (x) x.route = r.route; continue; } push(r.slug, r.route.id.replace(/-/g, " "), "route", s.length); const x = out.at(-1); if (x?.slug === r.slug) x.route = r.route; }
  return out.sort((a, b) => a.at - b.at).slice(0, max);
}

// ---- the hint line ----
const shortWhat = (a) => { let d = oneLine(a).replace(/^Find and book local Taskrabbit services/i, "Find and book local services"); if (d.length > 90) d = d.slice(0, 88).replace(/[\s,;:]+\S*$/, "") + "…"; return d.replace(/\.$/, ""); };
export const displayName = (a) => strip(BUILTIN_APPS_LATEST.get(a.s) || a.n || a.s).replace(/\s*\(.*$/, "");
// One app's state for this person: builtin | connected | expired | connect | null (Soon / retired: never hinted).
export function hintState(a, conns = []) {
  const st = statusFor(a.s, conns), kind = connectKind(a, st.status === "connected"); if (kind === "soon" || kind === "retired") return null;
  if (kind === "builtin") return { state: "builtin" };
  return st.status === "connected" ? { state: "connected", accounts: st.accounts.length } : st.status === "expired" ? { state: "expired" } : { state: "connect" };
}
const tag = (a) => OWN_TOOLS[a.s] || a.s;
// items: [{ a (catalog row), state, accounts }] → the one line (empty when there's nothing).
export function hintLine(items = []) {
  if (!items.length) return "";
  const g = (k) => items.filter((x) => x.state === k), parts = [];
  for (const x of g("builtin")) { const r = x.route || BY_NAME[x.a.s];
    parts.push(`${displayName(x.a)} [${x.a.s}] (no sign-in needed): ${shortWhat(x.a)}.${r ? ` Start with ${r.start} (${r.note}).` : ""}`); }
  for (const x of g("custom")) parts.unshift(`Their own custom MCP server ${x.a.n} [${x.a.s}], connected: it is the server they added in Settings → Advanced, separate from any built-in app with a similar name, so don't call it expired or not connected. Use app_actions with app "${x.a.s}".`);
  const on = g("connected"); if (on.length) parts.push(`Connected: ${on.map((x) => `${displayName(x.a)} (${tag(x.a)}${x.accounts > 1 ? `; ${x.accounts} accounts` : ""})`).join(", ")}.`);
  const need = g("connect"); if (need.length) parts.push(`Needs connecting (offer_connect shows the Connect card): ${need.map((x) => `${displayName(x.a)} [${x.a.s}]${x.used ? " (on their Apps they use list)" : ""}: ${shortWhat(x.a)}`).join("; ")}.`);
  const exp = g("expired"); if (exp.length) parts.push(`Connection expired (offer_connect to reconnect): ${exp.map((x) => `${displayName(x.a)} [${x.a.s}]`).join(", ")}.`);
  return `(Relevant integrations: ${parts.join(" ")} Try the integration first: app_actions finds its actions, and app_proxy calls the app's own API for anything they don't cover. The web is for what the app can't do.)`;
}
// Their own apps that may fit this message (a kind of thing, not a name): softer than the hint, and never a nudge.
export function priorLine(items = []) {
  if (!items.length) return "";
  const one = (x) => `${displayName(x.a)} [${x.a.s}] (${x.state === "connected" ? `connected: ${tag(x.a)}` : x.state === "expired" ? "connection expired: offer_connect to reconnect" : x.state === "builtin" ? "no sign-in needed" : "not connected: offer_connect shows the Connect card"})`;
  return `(Apps they use that may fit this: ${items.map(one).join(", ")}. If the request is about one of them, use it, or offer to connect it; if not, ignore this line.)`;
}
// The hint for one message: → { line, items } (line "" when nothing strong matched). res: the Resident (conns()); list: the catalog.
export async function integrationHint(res, text, list = null) {
  if (!res?.env?.COMPOSIO_KEY || !String(text || "").trim()) return { line: "", items: [] };
  // The person's own custom MCP servers that their words name (display name or host): listed first, beside any built-in app of that name.
  let custom = []; try { custom = (await customMentions(res.env, res.get("tenant"), text)).map((r) => ({ a: { s: r.slug.toLowerCase(), n: displayOf(r) }, state: "custom", how: "custom", keys: [...customKeys(r)] })); } catch (e) { console.log("custom hint", String(e?.message || e).slice(0, 80)); }
  const both = (items0) => { const items = [...custom, ...items0]; const apps = items.filter((x) => x.how !== "prior");
    return { line: [hintLine(apps), priorLine(items.filter((x) => x.how === "prior"))].filter(Boolean).join(" "), items }; };
  try {
    list ||= await appCatalog(res.env); if (!list?.length) return both([]);
    const used = res._usedSlugs instanceof Set ? res._usedSlugs : null;
    let ms = matchIntegrations(text, list, { used });
    if (!ms.length) return both([]);
    let conns = []; try { if (ms.length) conns = await res.conns(); } catch {}
    const ix = indexFor(list), items = [];
    for (const m of ms) { const a = withConnectedTwin(ix.bySlug.get(m.slug), conns), st = a && hintState(a, conns); if (!st) continue;
      const route = m.route && st.state === "builtin" && builtinApps(res.env).has(m.slug) ? m.route : null;   // a route names its action only where the app is built in
      if (m.how === "route" && !route) continue;
      items.push({ a, ...st, via: m.via, how: m.how, keys: m.how === "prior" ? keysOf(ix, m.slug, a.n) : [...keysOf(ix, m.slug, m.via), ...(route ? ROUTE_KEYS[route.id] || [] : [])], ...(route ? { route, hosts: ROUTE_HOSTS[route.id] || [] } : {}), ...(used?.has(m.slug) ? { used: true } : {}) }); }
    return both(items);
  } catch (e) { console.log("integration hint", String(e?.message || e).slice(0, 120)); return both([]); }
}
// Everything that names this app in a search: its keys in the index, plus the words that matched (an intent's "handyman").
function keysOf(ix, slug, via) { const out = new Set([compact(via)]); for (const [k, e] of ix.keys) if (e.slugs[0] === slug && k.length >= 4) out.add(k); return [...out].filter(Boolean); }

// ---- the nudge ----
const kvKey = (session) => `ihint:${session}`;
const nudgedIn = (res, tc) => { if (!tc?.session) return new Set(tc?.hintNudgedLocal || []); try { return new Set(JSON.parse(res.get(kvKey(tc.session)) || "[]")); } catch { return new Set(); } };
const markNudged = (res, tc, slug) => { const s = nudgedIn(res, tc); s.add(slug); if (tc?.session) { try { res.put(kvKey(tc.session), JSON.stringify([...s])); } catch {} } else (tc.hintNudgedLocal ||= []).push(slug); };
// Does this call name / open the app? keys: compact names; text compared with every 1–4 word window of the call's words.
export function mentions(item, name, a = {}) {
  const keys = new Set(item.keys || []), hitText = (t) => { const ws = words(String(t || "").replace(URLS, " ")); for (let n = 1; n <= 4; n++) for (let i = 0; i + n <= ws.length; i++) if (keys.has(ws.slice(i, i + n).join(""))) return true; return false; };
  const hitUrl = (u) => {
    let h = ""; try { h = new URL(/^[a-z][a-z0-9+.-]*:/i.test(String(u)) ? String(u) : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
    const labels = h.split("."); if (labels.slice(0, -1).some((l) => keys.has(compact(l)))) return true;
    if ((HOSTS[item.a.s] || []).some((x) => h === x || h.endsWith(`.${x}`))) return true;
    if (item.hosts?.length) { let hp = h; try { hp = `${h}${new URL(/^[a-z][a-z0-9+.-]*:/i.test(String(u)) ? String(u) : `https://${u}`).pathname}`; } catch {}
      if (item.hosts.some((x) => x.includes("/") ? hp.startsWith(x) || hp.startsWith(`www.${x}`) : h === x || h.endsWith(`.${x}`))) return true; }
    return !!connectedServiceFor(u, [{ app: item.a.s, status: "connected", name: item.a.s }]);   // Google's own sites for Gmail, Calendar…
  };
  if (name === "web_search") return hitText(a.query);
  if (name === "fetch_url" || name === "browser_navigate") return hitUrl(a.url);
  if (name === "browser_task") return (a.url && hitUrl(a.url)) || hitText(a.task);
  return false;
}
export const nudgeText = (x) => `${displayName(x.a)} has an integration (${x.state === "builtin" ? (x.route || BY_NAME[x.a.s] ? `no sign-in needed: ${(x.route || BY_NAME[x.a.s]).start}` : `no sign-in needed: app_actions with app "${x.a.s}", then app_run`) : x.state === "connected" ? `connected: ${OWN_TOOLS[x.a.s] || `app_actions with app "${x.a.s}", then app_run`}` : x.state === "expired" ? "its connection expired: offer_connect shows the Reconnect card" : "not connected yet: offer_connect shows the Connect card"}). Use it, or say briefly why the web is better and call this again. Nothing was run.`;
// The one-line note that rides on a site call's result.
export const noteText = (x) => `Note: ${displayName(x.a)} has an integration (${nudgeText(x).replace(/^[^(]*\(/, "").replace(/\)\. Use it,.*$/, "")}); it can do the same thing without the website.`;
// Before a tool call (both engines): the nudge text, or null: the call always runs, and the note rides on its result (see addAppNote).
export function hintNudge(res, tc, name, a = {}) {
  if (!tc) return null;
  if (APP_TOOLS.has(name)) { tc.hintAppUsed = true; return null; }
  if (!tc.hint?.length || tc.hintAppUsed || !WEB_TOOLS.has(name)) return null;
  const words0 = personWords(tc);
  if (words0.some((w) => WEB_ASK.test(String(w))) || (name !== "web_search" && askedForWebsite(words0, a.url || ""))) return null;
  const done = nudgedIn(res, tc);
  const x = tc.hint.find((h) => h.how !== "prior" && h.state !== "custom" && !done.has(h.a.s) && mentions(h, name, a)); if (!x) return null;
  markNudged(res, tc, x.a.s);
  (tc.hintNudges ||= []).push({ tool: name, app: x.a.s });
  // Every call runs: the app's one-line note is added to its result, once per app per task.
  addAppNote(tc, noteText(x)); return null;
}
