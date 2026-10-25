// node --import ./test/stubs/register.mjs test/deck-route.test.mjs
// The deck route (deck-route.js): HTML unless the person names a tool now or named one earlier in this channel; Google Slides also depends on
// whether it is connected (a connected Gmail doesn't count) and whether they declined its Connect card. App facts only, never model wording.
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite";
import { deckPlan, deckAsk, deckTool, rememberedTool, slidesState, slidesLine, slidesGate, namesGoogleSlides, messageWords } from "../src/deck-route.js";
import { connectOfferInit, offerAct } from "../src/ee/connect-offer.js";
import { Resident } from "../src/resident.js";
import { readSkill } from "../src/skills/index.js";

const db = new DatabaseSync(":memory:");
const sql = { exec: (q, ...a) => { const st = db.prepare(q); const r = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => r, one: () => r[0] }; } };
sql.exec("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
sql.exec("CREATE TABLE turns (id TEXT, session TEXT, kind TEXT, user_text TEXT, at INTEGER)");
connectOfferInit(sql);
const GMAIL = { id: "c1", app: "gmail", status: "connected", email: "a@gmail.com" }, SLIDES = { id: "c2", app: "googleslides", status: "connected", email: "a@gmail.com" };
let CONNS = [], OFFERS_OFF = false;
const res = { env: { COMPOSIO_KEY: "k", ONEHELM_EE: "1hc", DB: { prepare: () => ({ bind: () => ({ first: async () => (OFFERS_OFF ? { v: "off" } : null) }) }) } }, sql, get: () => "t1", conns: async () => CONNS };
const offer = (session, status) => { sql.exec("DELETE FROM connect_offers WHERE session=?", session); sql.exec("INSERT INTO connect_offers (at,session,app,name,status) VALUES (1,?,?,?,?)", session, "googleslides", "Google Slides", status); };
const ask = (t) => [t];

// ---- what the person named ----
assert.equal(deckTool("create a slide deck in Google slides about dryers"), "google");
assert.equal(deckTool("make me a PowerPoint"), "pptx");
assert.equal(deckTool("an HTML deck please"), "html");
assert.equal(deckTool("slides as a pdf"), "html");
assert.equal(deckTool("a Keynote deck"), "html");
assert.equal(deckTool("make a deck in Canva"), "html");
assert.equal(deckTool("design a Canva poster"), null, "Canva with no deck word names no deck tool");
assert.equal(deckTool("make me a deck about lint collectors"), null);
assert.deepEqual(deckAsk(ask("make me a deck about lint collectors")), { tool: "html", named: false }, "nothing named, nothing earlier: HTML");
assert.deepEqual(deckAsk(ask("make me a deck"), "google"), { tool: "google", named: false }, "the earlier choice is used");
assert.deepEqual(deckAsk(["actually do it in Google Slides", "make me a PowerPoint"], "html"), { tool: "google", named: true }, "the newest named tool wins");
assert.equal(deckAsk(ask("what's the weather"), "google"), null);
assert.ok(namesGoogleSlides("a deck in Google Slides") && !namesGoogleSlides("a deck"));

// ---- the route ----
const P = (t, s, r = null) => deckPlan(ask(t), r, s)?.route;
for (const st of [{ status: "connected" }, { status: "not connected" }, { status: "expired" }, { status: "connected", offer: "pending" }])
  assert.equal(P("make a deck", st), "html", "no tool named and no earlier choice: HTML, whatever Google Slides is");
assert.equal(P("make a deck", { status: "not connected" }, "html"), "html");
assert.equal(P("in Google Slides", { status: "connected" }), "slides");
assert.equal(P("in Google Slides", { status: "not connected" }), "card", "named Google Slides, not connected: card");
assert.equal(P("in Google Slides", { status: "expired" }), "card");
assert.equal(P("in Google Slides", { status: "not connected", offer: "pending" }), "wait");
assert.equal(P("in Google Slides", { status: "not connected", offer: "dismissed" }), "html", "declined: HTML");
assert.equal(P("in Google Slides", { status: "not connected", off: true }), "html", "suggestions off: HTML");
assert.equal(P("make a deck", { status: "connected" }, "google"), "slides", "earlier Google Slides choice, connected");
assert.equal(P("make a deck", { status: "not connected" }, "google"), "card");
assert.equal(P("make a PowerPoint", { status: "connected" }, "google"), "pptx", "a tool named now beats the earlier one");
assert.equal(P("make a deck", { status: "connected" }, "pptx"), "pptx");
assert.equal(deckPlan(ask("hello"), "google", { status: "connected" }), null);

// ---- a message, end to end: kv, connections and the Connect card of the task ----
const kv = () => rememberedTool(res), clearKv = () => sql.exec("DELETE FROM kv");
CONNS = [GMAIL];
assert.equal((await slidesState(res, "s1")).status, "not connected", "a connected Gmail is not Google Slides");
assert.equal(await slidesLine(res, "s1", "make me a deck about lint", "t0"), "", "nothing named, not connected: HTML, no card");
CONNS = [GMAIL, SLIDES];
assert.equal(await slidesLine(res, "s1", "make me a deck about lint", "t0"), "", "nothing named, Slides connected: HTML, no Slides note");
assert.equal(kv(), null, "a message that names no tool remembers nothing");
CONNS = [GMAIL];
let line = await slidesLine(res, "s1", "create a slide deck in Google slides about lint", "t0");
assert.match(line, /offer_connect with app googleslides/); assert.doesNotMatch(line, /read_skill google-slides/);
assert.equal(kv(), "google", "naming Google Slides is remembered");
CONNS = [GMAIL, SLIDES];
line = await slidesLine(res, "s1", "create a slide deck in Google slides about lint", "t0");
assert.match(line, /build the deck in Google Slides yourself/); assert.match(line, /read_skill google-slides/);
// the earlier choice: a later task in the same channel, nothing named
assert.match(await slidesLine(res, "s9", "make me a deck about tides", "t1"), /build the deck in Google Slides yourself/, "earlier choice of Google Slides: the Slides route");
CONNS = [GMAIL];
assert.match(await slidesLine(res, "s9", "make me a deck about tides", "t1"), /offer_connect with app googleslides/, "earlier choice, no longer connected: the card");
// naming another tool later replaces it
CONNS = [GMAIL, SLIDES];
assert.equal(await slidesLine(res, "s9", "make me an HTML deck about tides", "t2"), "");
assert.equal(kv(), "html"); assert.equal(await slidesLine(res, "s9", "another deck about wind", "t3"), "", "HTML named later: back to HTML, no Slides note");
// declining the card: the channel's choice becomes HTML until Google Slides is named again
clearKv(); CONNS = [GMAIL];
assert.match(await slidesLine(res, "d1", "a deck in Google Slides about ants", "t0"), /offer_connect with app googleslides/); assert.equal(kv(), "google");
offer("d1", "pending"); const oid = sql.exec("SELECT id FROM connect_offers WHERE session='d1'").toArray()[0].id;
assert.equal(offerAct(res, oid, "dismiss").ok, true);
assert.equal(kv(), "html", "declining the card sets the deck choice to html");
assert.equal(await slidesLine(res, "d2", "make me a deck about bees", "t1"), "", "later task, nothing named: HTML, no card");
assert.equal((await slidesGate(res, { session: "d2" }, "Build a slide deck about bees", ask("make me a deck about bees"))), null, "no card gate either");
offerAct(res, oid, "dismiss"); assert.equal(kv(), "html");
assert.match(await slidesLine(res, "d3", "now a deck in Google Slides about wasps", "t2"), /offer_connect with app googleslides/, "naming Google Slides again: google and the card again");
assert.equal(kv(), "google");
assert.match(await slidesLine(res, "d4", "make me a deck about moths", "t3"), /offer_connect with app googleslides/, "and it stays google");
offer("d4", "pending"); offerAct(res, sql.exec("SELECT id FROM connect_offers WHERE session='d4'").toArray()[0].id, "dismiss");
assert.equal(await slidesLine(res, "d5", "a PowerPoint about moths", "t4"), ""); assert.equal(kv(), "pptx", "naming PowerPoint still works");
sql.exec("DELETE FROM connect_offers"); clearKv();
// PowerPoint
assert.equal(await slidesLine(res, "s9", "make me a PowerPoint about wind", "t4"), "", "named now: the artifacts skill's own --pptx rule applies");
assert.equal(kv(), "pptx");
assert.match(await slidesLine(res, "s9", "make me a deck about sun", "t5"), /--pptx/, "an earlier PowerPoint choice: --pptx");
clearKv();
assert.equal(await slidesLine(res, "s1", "what's the weather", "t0"), "", "not a deck"); assert.equal(kv(), null);
assert.equal(await slidesLine(res, "s1", "email me this PowerPoint's notes", "t0") === "", true); clearKv();
// a declined or pending card in this task
CONNS = [GMAIL]; offer("s2", "pending");
assert.match(await slidesLine(res, "s2", "a deck in Google Slides", "t0"), /Connect card for Google Slides is on screen/);
offer("s2", "dismissed");
assert.equal(await slidesLine(res, "s2", "a deck in Google Slides", "t0"), "", "declined: HTML, no Slides note");
// a follow-up in the task counts the deck ask and the named tool from earlier messages
clearKv(); sql.exec("INSERT INTO turns VALUES ('a','s3','chat','make me a deck about lint in Google Slides',1)");
CONNS = [SLIDES]; assert.match(await slidesLine(res, "s3", "yes go ahead", "t9"), /build the deck in Google Slides yourself/);
assert.deepEqual(messageWords(res, "s3", "yes go ahead", "t9"), ["yes go ahead", "make me a deck about lint in Google Slides"]);
assert.equal(await slidesLine({ ...res, env: {} }, "s3", "a deck in Google Slides", "t0"), "", "apps off: nothing");

// ---- start_helper gate: only a Google Slides deck job (or one waiting for the card) is refused ----
const tc = (s) => ({ session: s });
const JOB = "Build a slide deck about dryer lint collectors";
clearKv(); CONNS = [SLIDES];
assert.equal(await slidesGate(res, tc("s1"), JOB, ask("make a deck about lint")), null, "nothing named: an HTML deck may go to a helper, even with Slides connected");
assert.match(await slidesGate(res, tc("s1"), JOB, ask("make a deck about lint in Google Slides")), /built in Google Slides, by you/);
CONNS = [GMAIL]; assert.match(await slidesGate(res, tc("s1"), JOB, ask("a deck in Google Slides")), /offer_connect with app googleslides first/);
offer("s2", "dismissed"); assert.equal(await slidesGate(res, tc("s2"), JOB, ask("a deck in Google Slides")), null, "declined: a helper may build the HTML deck");
CONNS = [SLIDES]; assert.equal(await slidesGate(res, tc("s1"), JOB, ask("make me a PowerPoint")), null, "named PowerPoint: a helper may build it");
assert.equal(await slidesGate(res, tc("s1"), "Research how lint collectors work", ask("a deck about lint in Google Slides")), null, "a research job isn't a deck job");
sql.exec("INSERT INTO kv VALUES ('deck_tool','google')");
assert.match(await slidesGate(res, tc("s1"), JOB, ask("make a deck")), /built in Google Slides, by you/, "earlier Google Slides choice: no helper");
clearKv();

// ---- the deck recipe isn't attached to a Google Slides job (Resident.helperRecipe), and still is for a built-in deck ----
const rec = (task) => Resident.prototype.helperRecipe.call({ docFlags: () => ({}) }, { name: "Deck", task });
assert.equal(rec("Build a slide deck in Google Slides about lint"), null);
assert.equal(rec("Build an HTML slide deck about lint")?.kind, "presentation");

// ---- the skills point the right way ----
const gs = readSkill({ slug: "google-slides" }, { apps: true }), art = readSkill({ slug: "artifacts" }, { apps: true });
assert.match(gs, /GOOGLESLIDES_CREATE_SLIDES_MARKDOWN/); assert.match(gs, /offer_connect/); assert.match(gs, /Not now/);
assert.match(art, /HTML deck by default/); assert.doesNotMatch(art, /google-slides skill first/); assert.doesNotMatch(gs, /Google Slides first/);
console.log("PASS deck-route");
