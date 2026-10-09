// Live vertical search (Captain 10-08: Composio's search toolkit, composio_search, "is excellent"): flights, hotels, places and
// restaurants, Amazon, Walmart, shopping, finance, events and Tripadvisor as ONE compact tool, search_web_vertical.
//
// Why one tool and not app_actions → app_run with app "composio_search" (both work; this is the door the hint and skills name):
//   - one step instead of two, and no input names to get right: Composio's own inputs differ per tool (q vs query, departure_id,
//     check_in_date, amazon_domain, htichips…); here every kind takes the same few plain fields and this file maps them;
//   - an enum `kind` is the most dependable way for any model to pick a tool (no slug to remember or guess);
//   - the version is pinned here (VS_VERSION): Composio's pinned "00000000_00" toolkit has no flights, hotels, Amazon, Walmart or
//     Tripadvisor at all, and the slugs changed between versions (…_SHOPPING_SEARCH → …_SHOPPING);
//   - results are lean per kind (hotels came back at 159k chars raw, shopping 288k, finance 174k: ~1–3k here), with the link to
//     check on the site itself, so a turn's cost stays small and stable;
//   - one place for the meter and the guards; read-only search only (never Composio's workbench, bash or connections).
// Cost: ~540 tokens of schema in each turn's (cached) tool list (test/vertical-search.test.mjs measures it).
// app_run on one of these slugs still works (composio.js) and gets the same lean result (leanFor).
//
// Billing: Composio counts each execute as one tool call. composio_search isn't one of Composio's "Instant" (pass-through provider)
// toolkits, and its pricing page (10-08) lists no premium multiplier: Pro includes 100k calls a month, then $0.0003 per call (the
// builtins audit 10-08 found the same). The dev key can't read usage (composio-api.js refuses those routes), so the per-call figure is
// the published one; re-check on the Composio dashboard. Each answered search is charged to the turn like web_search's paid fallback:
// VS_NANO × MARKUP (resident.js), about $0.00035.
import { composioRequest } from "./composio-api.js";
import { stripDirectives } from "./lean.js";

export const VS_VERSION = "20260903_00";   // composio_search's version these slugs, inputs and results were checked on (10-08)
export const VS_NANO = 300_000;            // $0.0003 per search, before markup (Composio's published per-call price past the included 100k)
export const VS_TOOL_NAME = "search_web_vertical";

const s = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : undefined; };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
const cut = (v, n) => { const t = s(v); return t.length > n ? `${t.slice(0, n - 1)}…` : t || undefined; };
const mins = (m) => (Number.isFinite(Number(m)) ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : undefined);
const IATA = /^[A-Za-z]{3}$/;

// kind → Composio tool, where the results come from, and what the helper reads.
export const KINDS = {
  flights: { slug: "COMPOSIO_SEARCH_FLIGHTS", src: "Google Flights", what: "live fares and schedules" },
  hotels: { slug: "COMPOSIO_SEARCH_HOTELS", src: "Google Hotels", what: "live rates for your dates" },
  places: { slug: "COMPOSIO_SEARCH_GOOGLE_MAPS", src: "Google Maps", what: "places with ratings, hours, address, phone" },
  restaurants: { slug: "COMPOSIO_SEARCH_GOOGLE_MAPS", src: "Google Maps", what: "restaurants with ratings, hours, price level", as: "places" },
  amazon: { slug: "COMPOSIO_SEARCH_AMAZON", src: "Amazon", what: "Amazon listings and prices" },
  walmart: { slug: "COMPOSIO_SEARCH_WALMART", src: "Walmart", what: "Walmart listings and prices" },
  shopping: { slug: "COMPOSIO_SEARCH_SHOPPING", src: "Google Shopping", what: "prices across stores" },
  finance: { slug: "COMPOSIO_SEARCH_FINANCE", src: "Google Finance", what: "live quotes for stocks, indices, crypto, currencies" },
  events: { slug: "COMPOSIO_SEARCH_EVENT", src: "Google Events", what: "upcoming concerts, shows, festivals" },
  tripadvisor: { slug: "COMPOSIO_SEARCH_TRIP_ADVISOR", src: "Tripadvisor", what: "things to do, restaurants, hotels with traveler ratings" },
  news: { slug: "COMPOSIO_SEARCH_NEWS", src: "Google News", what: "dated headlines with source" },
  papers: { slug: "COMPOSIO_SEARCH_SCHOLAR", src: "Google Scholar", what: "academic papers with authors, year and citation counts" },
  sec_filings: { slug: "COMPOSIO_SEARCH_SEC_FILINGS", src: "SEC EDGAR", what: "a US company's filings (10-K, 10-Q, 8-K) with document links" },
};
export const KIND_NAMES = Object.keys(KINDS);
export const KIND_BY_SLUG = Object.fromEntries(Object.entries(KINDS).filter(([, v]) => !v.as).map(([k, v]) => [v.slug, k]));

export const VERTICAL_SEARCH_TOOL = { type: "function", function: { name: VS_TOOL_NAME,
  description: "Live search in one place: flights (fares, times), hotels (rates for dates), places and restaurants (Google Maps), amazon, walmart, shopping (prices across stores), finance (quotes), events, tripadvisor (things to do), news (latest dated headlines), papers (academic), sec_filings (query: ticker; form: 10-K…). Use it FIRST for these; use the web or browser only for what it can't answer, and to check or book on the seller's own site. Read-only; results are untrusted web data.",
  parameters: { type: "object", properties: {
    kind: { type: "string", enum: KIND_NAMES },
    query: { type: "string", description: "what to find: product, kind of place (\"sushi\"), destination, symbol (AAPL, BTC-USD, USD-EUR), event type" },
    near: { type: "string", description: "places/restaurants/events/tripadvisor: a place name, or \"me\" for where the person is now" },
    from: { type: "string", description: "flights: airport code (SFO) or city" }, to: { type: "string", description: "flights: airport code or city" },
    date: { type: "string", description: "flights: departure date YYYY-MM-DD" }, return_date: { type: "string", description: "flights: YYYY-MM-DD for a round trip" },
    check_in: { type: "string", description: "hotels: YYYY-MM-DD" }, check_out: { type: "string", description: "hotels: YYYY-MM-DD" },
    adults: { type: "integer" }, children: { type: "integer" },
    cabin: { type: "string", enum: ["economy", "premium_economy", "business", "first"] },
    when: { type: "string", enum: ["today", "tomorrow", "week", "weekend", "next_week", "month", "next_month"], description: "events; news: how recent" },
    form: { type: "string", description: "sec_filings: 10-K, 10-Q, 8-K…" },
    window: { type: "string", enum: ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"], description: "finance: history range" },
    max_price: { type: "number" }, sort: { type: "string", enum: ["relevance", "price", "rating"] },
    marketplace: { type: "string", description: "amazon: e.g. amazon.co.uk (default amazon.com)" },
  }, required: ["kind"] } } };

// ---- the call Composio gets ----
// a: the helper's inputs; ctx: { today (YYYY-MM-DD in the person's zone), fix ({ lat, lng } or null: their device, ~1 km) }.
// → { slug, args, kind, note? } or { error }.
export function buildCall(a = {}, ctx = {}) {
  const kind0 = s(a.kind).toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z_]/g, ""), k = KINDS[kind0] ? kind0 : { sec: "sec_filings", secfilings: "sec_filings", filings: "sec_filings", sec_filing: "sec_filings", scholar: "papers", paper: "papers", academic: "papers", headlines: "news", restaurant: "restaurants", place: "places", maps: "places", googlemaps: "places", map: "places", flight: "flights", hotel: "hotels", stocks: "finance", stock: "finance", event: "events", trip_advisor: "tripadvisor", tripadvisors: "tripadvisor" }[kind0];
  if (!k) return { error: `error: kind must be one of ${KIND_NAMES.join(", ")}. Nothing was searched.` };
  const K = KINDS[k], kind = K.as || k, q = s(a.query), near = s(a.near), today = ctx.today || new Date().toISOString().slice(0, 10);
  const dateOk = (v, name, need) => {
    const d = s(v); if (!d) return need ? `error: ${name} is needed (YYYY-MM-DD). Nothing was searched.` : null;
    if (!DATE.test(d)) return `error: ${name} must be a date as YYYY-MM-DD (turn "next Friday" into the date first). Nothing was searched.`;
    if (d < today) return `error: ${name} ${d} is in the past (today is ${today}). Nothing was searched.`;
    return null;
  };
  const adults = int(a.adults, 1, 9), children = int(a.children, 0, 8);
  if (kind === "flights") {
    const from = s(a.from), to = s(a.to);
    for (const [v, n, need] of [[a.date, "date", false], [a.return_date, "return_date", false]]) { const e = dateOk(v, n, need); if (e) return { error: e }; }
    if (a.return_date && a.date && s(a.return_date) < s(a.date)) return { error: "error: return_date is before date. Nothing was searched." };
    const cabin = { economy: 1, premium_economy: 2, business: 3, first: 4 }[s(a.cabin).toLowerCase()];
    const base = clean({ adults, children, travel_class: cabin, return_date: s(a.return_date) || undefined, currency: s(a.currency).toUpperCase() || undefined });
    if (IATA.test(from) && IATA.test(to)) return { kind, slug: K.slug, args: { departure_id: from.toUpperCase(), arrival_id: to.toUpperCase(), ...(a.date ? { outbound_date: s(a.date) } : {}), ...base } };
    const nl = from && to ? `${from} to ${to}${a.date ? ` on ${s(a.date)}` : ""}` : q;
    if (!nl) return { error: "error: flights need from and to (airport codes like SFO, or cities). Nothing was searched." };
    return { kind, slug: K.slug, args: { query: nl, ...(a.date ? { outbound_date: s(a.date) } : {}), ...base } };
  }
  if (kind === "hotels") {
    const where = q || near; if (!where) return { error: "error: hotels need query: the city, area or hotel name. Nothing was searched." };
    for (const [v, n] of [[a.check_in, "check_in"], [a.check_out, "check_out"]]) { const e = dateOk(v, n, true); if (e) return { error: e }; }
    if (s(a.check_out) <= s(a.check_in)) return { error: "error: check_out must be after check_in. Nothing was searched." };
    const sort = { price: 3, rating: 8 }[s(a.sort)];
    return { kind, slug: K.slug, args: clean({ q: where, check_in_date: s(a.check_in), check_out_date: s(a.check_out), adults: adults ?? 2, children, sort_by: sort, max_price: int(a.max_price, 1, 1e6), currency: s(a.currency).toUpperCase() || undefined }) };
  }
  if (kind === "places") {
    if (!q) return { error: "error: places need query: what to find (\"sushi\", \"pharmacy open now\"). Nothing was searched." };
    const meRe = /\b(near|around|close to) me\b|\bnearby\b|\bnear here\b|\baround here\b/i, me = /^(me|here|my location|current location)$/i.test(near) || (!near && meRe.test(q));
    if (me) {
      const f = ctx.fix;
      if (!f || !Number.isFinite(Number(f.lat))) return { kind, slug: K.slug, args: { q: q.replace(meRe, "").trim() || q }, note: "Their device location isn't known, so this searched without one: say which area you assumed, or ask (the Share my location button)." };
      return { kind, slug: K.slug, args: { q: q.replace(meRe, "").replace(/\s+/g, " ").trim() || q, ll: `@${Number(f.lat).toFixed(2)},${Number(f.lng).toFixed(2)},14z` }, note: `Searched around their device location (${f.place || "about 1 km"}).` };
    }
    return { kind, slug: K.slug, args: { q: near && !q.toLowerCase().includes(near.toLowerCase()) ? `${q} near ${near}` : q } };
  }
  if (kind === "amazon") {
    if (!q) return { error: "error: amazon needs query: the product. Nothing was searched." };
    const dom = s(a.marketplace).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    return { kind, slug: K.slug, args: clean({ query: q, amazon_domain: /^amazon\.[a-z.]{2,8}$/.test(dom) ? dom : undefined }) };
  }
  if (kind === "walmart") {
    if (!q) return { error: "error: walmart needs query: the product. Nothing was searched." };
    return { kind, slug: K.slug, args: clean({ query: q, max_price: num(a.max_price) }) };
  }
  if (kind === "shopping") {
    if (!q) return { error: "error: shopping needs query: the product. Nothing was searched." };
    return { kind, slug: K.slug, args: clean({ query: q, max_price: int(a.max_price, 1, 1e7), sort_by: s(a.sort) === "price" ? 1 : undefined, location: near && !/^me$/i.test(near) ? near : undefined }) };
  }
  if (kind === "finance") {
    if (!q) return { error: "error: finance needs query: a symbol like AAPL (or AAPL:NASDAQ), .INX:INDEXSP, BTC-USD or USD-EUR. Nothing was searched." };
    const sym = /^\$?[A-Za-z.]{1,6}(:[A-Za-z]+)?$/.test(q) ? q.replace(/^\$/, "").toUpperCase() : q;
    const win = s(a.window).toUpperCase(); return { kind, slug: K.slug, args: { query: sym, ...(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"].includes(win) ? { window: win } : {}) } };
  }
  if (kind === "events") {
    if (!q && !near) return { error: "error: events need query: the kind of event (\"concerts\", \"comedy\", \"food festival\"). Nothing was searched." };
    const chip = { today: "date:today", tomorrow: "date:tomorrow", week: "date:week", weekend: "date:weekend", next_week: "date:next_week", month: "date:month", next_month: "date:next_month" }[s(a.when)];
    const where = near && !/^me$/i.test(near) ? near.replace(/,.*$/, "") : ctx.fix?.place ? String(ctx.fix.place).replace(/,.*$/, "") : undefined;
    return { kind, slug: K.slug, args: clean({ query: q || "events", location: where, htichips: chip }) };
  }
  if (kind === "tripadvisor") {
    const where = [q, near && !/^me$/i.test(near) && !q.toLowerCase().includes(near.toLowerCase()) ? near : ""].filter(Boolean).join(" in ");
    if (!where) return { error: "error: tripadvisor needs query: what and where (\"things to do in Kyoto\"). Nothing was searched." };
    const ssrc = /\b(restaurants?|food|eat|dining)\b/i.test(where) ? "r" : /\b(hotels?|stay)\b/i.test(where) ? "h" : /\b(things? to do|attractions?|sights?|tours?|activities|museums?|see)\b/i.test(where) ? "A" : undefined;
    return { kind, slug: K.slug, args: clean({ query: where, ssrc, limit: 10 }) };
  }
  if (kind === "news") {
    if (!q) return { error: "error: news needs query: the topic. Nothing was searched." };
    const w = { today: "d", tomorrow: "d", week: "w", weekend: "w", next_week: "w", month: "m", next_month: "m" }[s(a.when)];
    return { kind, slug: K.slug, args: clean({ query: q, when: w }) };
  }
  if (kind === "papers") { if (!q) return { error: "error: papers needs query: the topic or title. Nothing was searched." }; return { kind, slug: K.slug, args: { query: q } }; }
  if (kind === "sec_filings") {
    const t = q.replace(/^\$/, "").trim(); if (!t) return { error: "error: sec_filings needs query: the ticker (AAPL) or 10-digit CIK. Nothing was searched." };
    const forms = s(a.form).toUpperCase().split(/[,\s]+/).filter((f) => /^[0-9A-Z-]{2,8}$/.test(f));
    return { kind, slug: K.slug, args: clean({ ticker_or_cik: /^\d{1,10}$/.test(t) ? t : t.toUpperCase(), form_types: forms, limit: 5, include_document_links: true }) };
  }
  return { error: "error: unknown kind. Nothing was searched." };
}

// ---- what comes back: lean per kind ----
const res = (d) => d?.results ?? d ?? {};
const leg = (f) => clean({ flight: f.flight_number, airline: f.airline, from: f.departure_airport?.id, depart: f.departure_airport?.time, to: f.arrival_airport?.id, arrive: f.arrival_airport?.time, duration: mins(f.duration), cabin: f.travel_class, aircraft: f.airplane, overnight: f.overnight || undefined });
const LEAN = {
  flights(d) {
    const r = res(d), all = [...(r.best_flights || []).map((x) => ({ ...x, best: true })), ...(r.other_flights || [])];
    const p = r.search_parameters || {}, pi = r.price_insights || {};
    const options = all.slice(0, 8).map((o) => clean({ price: o.price, best: o.best || undefined, type: o.type, total: mins(o.total_duration), stops: Math.max(0, (o.flights || []).length - 1),
      legs: (o.flights || []).map(leg), layovers: (o.layovers || []).map((l) => `${l.id} ${mins(l.duration)}${l.overnight ? " overnight" : ""}`), notes: (o.extensions || []).slice(0, 2) }));
    return { searched: clean({ from: p.departure_id, to: p.arrival_id, date: p.outbound_date, return_date: p.return_date, adults: p.adults, children: p.children || undefined, currency: p.currency || "USD" }),
      prices: clean({ lowest: pi.lowest_price, level: pi.price_level, typical: Array.isArray(pi.typical_price_range) ? pi.typical_price_range.join("–") : undefined }),
      options, check_at: r.search_metadata?.google_flights_url, note: "price = total for all the passengers searched, one way unless type says round trip (a round trip's price covers both ways). Fares move: confirm on the airline's or seller's site before booking." };
  },
  hotels(d) {
    const r = res(d), p = r.search_parameters || {};
    const list = [...(r.properties || [])].slice(0, 8).map((h) => clean({ name: h.name, type: h.type !== "hotel" ? h.type : undefined, stars: h.extracted_hotel_class, rating: h.overall_rating, reviews: h.reviews,
      per_night: h.rate_per_night?.lowest, total: h.total_rate?.lowest, location_rating: h.location_rating, amenities: (h.amenities || []).slice(0, 5), near: (h.nearby_places || []).slice(0, 2).map((n) => `${n.name} (${n.transportations?.[0]?.duration || "?"} ${String(n.transportations?.[0]?.type || "").toLowerCase()})`),
      deal: h.deal_description || h.deal, free_cancellation: h.free_cancellation || undefined, link: h.link, map: h.gps_coordinates ? `https://www.google.com/maps/search/?api=1&query=${h.gps_coordinates.latitude},${h.gps_coordinates.longitude}` : undefined }));
    return { searched: clean({ where: p.q, check_in: p.check_in_date, check_out: p.check_out_date, adults: p.adults, children: p.children || undefined, currency: p.currency }), hotels: list,
      check_at: r.search_metadata?.google_hotels_url, note: "total = the whole stay for these dates and guests, before fees a site adds at checkout. Confirm the rate on the hotel's or booking site before booking." };
  },
  places(d) {
    const r = res(d), one = r.place_results ? [r.place_results] : [], list = [...one, ...(r.local_results || [])].slice(0, 8);
    return { places: list.map((x) => clean({ name: x.title, type: x.type, rating: x.rating, reviews: x.reviews, price: x.price, address: x.address, open: x.open_state || x.hours, status: x.business_status && x.business_status !== "OPERATIONAL" ? x.business_status : undefined,
      phone: x.phone, website: x.website, review: cut(x.user_review, 140), map: x.place_id ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${x.title || ""} ${x.address || ""}`.trim())}&query_place_id=${x.place_id}` : undefined })),
      check_at: r.search_metadata?.google_maps_url, note: "Hours and \"open\" are as Google Maps shows them now." };
  },
  amazon(d) {
    const r = d || {}, list = (r.products || r.results?.organic_results || []).slice(0, 8);
    return { products: list.map((x) => clean({ title: cut(x.title, 140), price: x.price || (x.extracted_price != null ? `$${x.extracted_price}` : "not shown in search"), was: x.old_price, rating: x.rating, reviews: x.reviews, prime: x.is_prime || undefined, bought: x.bought_last_month, link: x.link, asin: x.asin })),
      note: "Prices are Amazon's search listing; \"not shown in search\" means open the link for the price. Sponsored or third-party sellers can differ." };
  },
  walmart(d) {
    const r = res(d), list = (r.organic_results || r.shopping_results || d?.products || []).slice(0, 8);
    return { products: list.map((x) => clean({ title: cut(x.title, 140), price: x.primary_offer?.offer_price ?? x.price ?? x.extracted_price, currency: x.primary_offer?.currency, rating: x.rating, reviews: x.reviews, seller: x.seller_name, out_of_stock: x.out_of_stock || undefined, sponsored: x.sponsored || undefined, link: x.product_page_url || x.link })),
      store: r.search_information?.location ? clean({ city: r.search_information.location.city, zip: r.search_information.location.postal_code }) : undefined, note: "Walmart's listing price for that store area." };
  },
  shopping(d) {
    const r = res(d), list = (r.shopping_results || []).slice(0, 8);
    return { products: list.map((x) => clean({ title: cut(x.title, 140), price: x.price, store: x.source, condition: x.second_hand_condition, rating: x.rating, reviews: x.reviews, delivery: x.delivery, link: x.product_link || x.link })),
      check_at: r.search_metadata?.google_shopping_url, note: "Prices as Google Shopping lists them; confirm on the store's page before buying." };
  },
  finance(d) {
    const r = res(d), sm = r.summary || {}, g = Array.isArray(r.graph) ? r.graph.filter((x) => Number.isFinite(Number(x.price))) : [];
    const pm = sm.price_movement || {}, mk = sm.market;
    const range = g.length ? { from: g[0].date, to: g.at(-1).date, open: g[0].price, last: g.at(-1).price, low: Math.min(...g.map((x) => x.price)), high: Math.max(...g.map((x) => x.price)) } : undefined;
    return { quote: clean({ name: sm.title, symbol: sm.stock, exchange: sm.exchange, price: sm.extracted_price ?? sm.price, currency: sm.currency || r.currency, change: pm.value != null ? `${pm.movement === "Down" ? "-" : "+"}${Number(pm.value).toFixed(2)} (${pm.movement === "Down" ? "-" : "+"}${Number(pm.percentage).toFixed(2)}%)` : undefined, as_of: sm.date,
      after_hours: mk?.extracted_price != null ? clean({ price: mk.extracted_price, change: mk.price_movement ? `${mk.price_movement.movement === "Down" ? "-" : "+"}${Number(mk.price_movement.value).toFixed(2)} (${Number(mk.price_movement.percentage).toFixed(2)}%)` : undefined }) : undefined }),
      range, news: (r.news_results || []).slice(0, 3).map((n) => clean({ title: cut(n.title || n.snippet, 120), source: n.source, date: n.date, link: n.link })),
      note: "Quote as Google Finance shows it (may be delayed by up to 15 minutes). Not investment advice." };
  },
  events(d) {
    const r = res(d), list = (r.events_results || []).slice(0, 8);
    return { events: list.map((e) => clean({ title: e.title, when: e.date?.when || e.date?.start_date, where: (e.address || []).join(", ") || e.venue?.name, venue: e.venue?.name, tickets: (e.ticket_info || []).slice(0, 2).map((t) => t.link), link: e.link, about: cut(e.description, 140) })),
      note: list.length ? "Check times and tickets on the event's own page." : "No events found for that; try a broader kind of event or a nearby city." };
  },
  tripadvisor(d) {
    const r = res(d), list = (r.places || r.locations || []).slice(0, 10);
    return { results: list.map((x) => clean({ title: x.title, type: String(x.place_type || "").toLowerCase().replace(/_/g, " ") || undefined, rating: x.rating, reviews: x.reviews, location: x.location, about: cut(x.description, 160), link: x.link })),
      check_at: r.search_metadata?.tripadvisor_url };
  },
};
Object.assign(LEAN, {
  news(d) {
    const r = d?.news_results ? d : res(d), list = (r.news_results || []).slice(0, 10);
    return { news: list.map((n) => clean({ title: cut(n.title, 160), source: typeof n.source === "object" ? n.source?.name : n.source, published: n.published_at || n.date, link: n.link, snippet: cut(n.snippet, 180) })),
      note: list.length ? "Dated headlines from Google News; open an article with fetch_url for details." : "No news found; try broader words or a longer time window." };
  },
  papers(d) {
    const r = d?.articles ? d : res(d), list = (r.articles || r.organic_results || []).slice(0, 8);
    return { papers: list.map((p) => clean({ title: cut(p.title, 180), authors: (p.authors || []).map((x) => x?.name || x).filter(Boolean).slice(0, 4).join(", ") || undefined, year: p.publication_year || p.year,
      cited_by: p.citation_count ?? p.inline_links?.cited_by?.total, where: p.source || p.publication_info?.summary, link: p.link, pdf: p.pdf_link || undefined, snippet: cut(p.snippet, 200) })), total: r.total_results };
  },
  sec_filings(d) {
    const r = d?.filings ? d : res(d), list = (r.filings || []).slice(0, 10);
    return { company: r.company_name, ticker: r.ticker, cik: r.cik, filings: list.map((f) => clean({ form: f.form_type, filed: f.filing_date, period: f.report_date, document: f.primary_document_url, index: f.index_url })) };
  },
});
// The lean result for one kind (or one composio_search slug). null when it isn't one of ours.
export function leanFor(kindOrSlug, data) {
  const k = KINDS[kindOrSlug] ? (KINDS[kindOrSlug].as || kindOrSlug) : KIND_BY_SLUG[String(kindOrSlug || "").toUpperCase()];
  if (!k || !LEAN[k]) return null;
  try { return LEAN[k](data); } catch (e) { return null; }
}
// How many results a lean answer holds (0 = nothing found).
export const countOf = (lean) => { if (!lean) return 0; for (const k of ["options", "hotels", "places", "products", "events", "results", "news", "papers", "filings"]) if (Array.isArray(lean[k])) return lean[k].length; return lean.quote?.price != null ? 1 : 0; };

// Composio's events engine (SerpApi google_events) answered "Unsupported `google_events` search engine" for every query on 10-08.
export const ENGINE_DOWN = /unsupported .{0,4}google_events|unsupported .{0,20}search engine/i;
const fallbackHint = (kind) => kind === "events" ? "Seat Geek (app_actions with app \"seat_geek\", no sign-in) or web_search" : kind === "places" ? "web_search (or Yelp with app_actions, app \"yelp\")" : "web_search, then the site itself in the browser";

// Run one search. env: the Worker env (COMPOSIO_KEY); tenantId; a: the helper's inputs; o: { today, fix, request (tests), web (async (query) → text, for the events fallback) }.
// → { out, ok, kind, count }. ok: Composio answered with results (the call is charged).
export async function verticalSearch(env, tenantId, a = {}, o = {}) {
  const c = buildCall(a, o);
  if (c.error) return { out: c.error, ok: false, kind: s(a.kind) };
  const K = KINDS[c.kind], request = o.request || composioRequest, head = `Live search (${c.kind}, ${K.src})`;
  let d, err = null;
  try {
    d = await request(env, `/tools/execute/${c.slug}`, { method: "POST", retry: "read", body: JSON.stringify({ user_id: `1hc:${tenantId}`, arguments: c.args, version: VS_VERSION }) });
    if (!d?.successful) err = String(d?.error || "no answer").slice(0, 240);
  } catch (e) { err = String(e?.message || e).slice(0, 240); }
  if (err) {
    // Events: Composio's engine is down → the same question as one web search, said plainly (any model handles this the same way).
    if (c.kind === "events" && typeof o.web === "function" && (ENGINE_DOWN.test(err) || /search request failed/i.test(err))) {
      const w = await o.web(`${c.args.query} ${c.args.location || ""} ${a.when ? String(a.when).replace("_", " ") : "upcoming"}`.replace(/\s+/g, " ").trim()).catch(() => "");
      if (w && !/^error|busy/i.test(w)) return { out: `${head}: the events search isn't working at Composio right now, so this is a web search instead (open the event pages for dates and tickets; Seat Geek through app_actions, app "seat_geek", lists ticketed events):\n${w}`, ok: false, kind: c.kind, count: 0, web: true };
    }
    return { out: `error: ${head} failed: ${err}. Nothing is wrong with what you asked; use ${fallbackHint(c.kind)} instead.`, ok: false, kind: c.kind };
  }
  const lean = leanFor(c.kind, stripDirectives(d.data?.response_data ?? d.data).value);   // no provider prompt text (lean.js)
  if (!lean) return { out: `error: ${head} came back in a shape 1Helm doesn't read. Use ${fallbackHint(c.kind)} instead.`, ok: true, kind: c.kind };
  const n = countOf(lean);
  const body = JSON.stringify(clean({ ...lean, ...(c.note ? { location_note: c.note } : {}), ...(n ? {} : { found: "nothing: try broader words, other dates, or a nearby place" }) }));
  return { out: `${head} ok (${n} result${n === 1 ? "" : "s"}):\n${body}`, ok: true, kind: c.kind, count: n };
}

// ---- the loop guard's view of a call (spendguard.js argWords) ----
// Changing a real field (date, airports, place, kind) is a new search, not a loop: those fields become one heavy token (5 copies), so
// two calls that differ in one of them are < 0.7 similar. Rewording only the query stays similar, so 4 rewordings in a turn pause.
export function loopWords(a = {}) {
  let x = a; if (typeof x === "string") { try { x = JSON.parse(x || "{}"); } catch { x = {}; } }
  const { query, step_title, fresh, ...rest } = x || {};
  const key = JSON.stringify(Object.keys(rest).sort().map((k) => [k, String(rest[k]).toLowerCase()]));
  const out = new Set([`kind=${String(rest.kind || "").toLowerCase()}`]);
  for (let i = 0; i < 5; i++) out.add(`f${i}=${key}`);
  for (const w of String(query || "").toLowerCase().split(/[^a-z0-9.$:-]+/).filter(Boolean)) out.add(w);
  return out;
}
// Same kind, same real fields, only the query reworded: the note on the 3rd such search in a turn. And a turn's 8th live search.
export const VS_NOTES = { reworded: 3, many: 8 };
export function searchNote(tc, a = {}) {
  if (!tc) return "";
  const st = (tc.vsNotes ||= { n: 0, by: {}, said: new Set() });
  st.n++;
  const k = [...loopWords(a)].filter((w) => /^(kind|f0)=/.test(w)).join("|"); st.by[k] = (st.by[k] || 0) + 1;
  if (st.by[k] === VS_NOTES.reworded && !st.said.has(k)) { st.said.add(k); return `\n[1Helm: that's ${st.by[k]} ${s(a.kind)} searches with only the words changed. Rewording rarely changes these results: answer from what you have, or change something real (the place, dates, a filter).]`; }
  if (st.n === VS_NOTES.many) return `\n[1Helm: ${st.n} live searches in this turn. Answer from what you have now unless the person asked for more.]`;
  return "";
}
