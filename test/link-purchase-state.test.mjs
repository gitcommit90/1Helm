// node --import ./test/stubs/register.mjs test/link-purchase-state.test.mjs
// What the Wallet and check_purchase say about a Link purchase uses only recorded facts: "approved" never reads as "paid".
import assert from "node:assert"; import { DatabaseSync } from "node:sqlite"; import { readFileSync } from "node:fs";
import { purchaseOutcome } from "../src/ee/purchase-state.js";
import { linkNoteFill, linkNoteHandoff, linkListPurchases } from "../src/ee/link.js";

const base = { merchant_name: "Toll Authority", merchant_url: "https://www.tolls.example.com/pay" };
const o = (extra) => purchaseOutcome({ ...base, ...extra });
const PAID = /(^|[^t] )paid|charged to|payment (went|is complete)/i;   // a positive claim of payment

// Link's own states
assert.equal(o({ status: "created" }).state, "waiting");
assert.equal(o({ status: "pending_approval" }).state, "waiting");
assert.equal(o({ status: "denied" }).state, "declined");
assert.equal(o({ status: "canceled" }).state, "canceled");
assert.equal(o({ status: "expired" }).state, "expired");
assert.match(o({ status: "expired" }).text, /Nothing charged/);
assert.equal(o({ status: "something_new" }).state, "unknown");
// Approved, then what 1Helm did
assert.equal(o({ status: "approved" }).state, "approved_unused");
assert.equal(o({ status: "approved", card_filled_at: 10, card_filled_host: "tolls.example.com" }).state, "card_filled");
assert.equal(o({ status: "approved", card_filled_at: 10, handoff_at: 20 }).state, "card_filled_handed_off");
assert.equal(o({ status: "approved", handoff_at: 20 }).state, "handed_off");
assert.equal(o({ status: "approved", fill_failed_at: 10 }).state, "fill_failed");
// A later success replaces an earlier failure, and a later failure replaces an earlier success
assert.equal(o({ status: "approved", fill_failed_at: 10, card_filled_at: 20 }).state, "card_filled");
assert.equal(o({ status: "approved", card_filled_at: 10, fill_failed_at: 20 }).state, "fill_failed");
// The Live case: approved, the fill failed, the checkout was handed to the person: not paid
const live = o({ status: "approved", fill_failed_at: 100, fill_failed_why: "secure iframe", handoff_at: 200 });
assert.equal(live.state, "fill_failed_handed_off");
assert.match(live.text, /Not paid/); assert.match(live.text, /not filled in/); assert.match(live.text, /Handed to you/);
assert.doesNotMatch(live.text, /^Approved\.?$/);
// No state says paid unless a recorded fact says so, and none does yet
for (const extra of [{ status: "approved" }, { status: "approved", card_filled_at: 1 }, { status: "approved", card_filled_at: 1, handoff_at: 2 }, { status: "approved", fill_failed_at: 1, handoff_at: 2 }, { status: "weird" }])
  assert.doesNotMatch(o(extra).text.replace(/Not (confirmed )?paid/g, ""), PAID, o(extra).text);
// Plain words: no status codes
for (const extra of [{ status: "pending_approval" }, { status: "approved" }, { status: "denied" }, { status: "expired" }, { status: "x_y" }])
  assert.doesNotMatch(o(extra).text, /pending_approval|_/);

// Recording the facts in a real table
const db = new DatabaseSync(":memory:");
for (const f of ["db/migrations/0001_012_full_schema_dev.sql", "db/migrations/0066_link_purchase_facts.sql"]) {
  const sql = readFileSync(new URL("../" + f, import.meta.url), "utf8");
  db.exec(f === "db/migrations/0001_012_full_schema_dev.sql" ? sql.split("\n").filter((l) => /link_purchases/.test(l)).join("\n") : sql);
}
const env = { DB: { prepare: (q) => { const s = db.prepare(q); return { bind: (...a) => ({ run: async () => s.run(...a), all: async () => ({ results: s.all(...a) }), first: async () => s.get(...a) ?? null }) }; } } };
const ins = db.prepare("INSERT INTO link_purchases (id,tenant_id,channel,amount,currency,merchant_name,merchant_url,context,test,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
ins.run("lsrq_1", "t1", "main", 2655, "usd", "Toll Authority", base.merchant_url, "ctx", 0, "approved", Date.now(), Date.now());
await linkNoteFill(env, "t1", "lsrq_1", { ok: false, why: "card field is a secure iframe" });
await linkNoteHandoff(env, "t1", "main");
let rows = await linkListPurchases(env, "t1");
assert.equal(rows.length, 1); assert.equal(rows[0].outcome.state, "fill_failed_handed_off");
assert.equal("fill_failed_why" in rows[0], false);   // the list sends the plain line, not the raw reason
// Another tenant's or channel's purchase is not touched
await linkNoteFill(env, "t2", "lsrq_1", { ok: true, host: "x.com" });
await linkNoteHandoff(env, "t1", "other");
assert.equal(db.prepare("SELECT card_filled_at FROM link_purchases WHERE id='lsrq_1'").get().card_filled_at, null);
// A later successful fill is recorded with the site
await linkNoteFill(env, "t1", "lsrq_1", { ok: true, host: "tolls.example.com" });
rows = await linkListPurchases(env, "t1");
assert.equal(rows[0].outcome.state, "card_filled");   // the fill came after the handoff
// A purchase that is only waiting has no handoff recorded on it
ins.run("lsrq_2", "t1", "main2", 100, "usd", "Shop", "https://shop.example.com", "ctx", 0, "pending_approval", Date.now(), Date.now());
await linkNoteHandoff(env, "t1", "main2");
assert.equal(db.prepare("SELECT handoff_at FROM link_purchases WHERE id='lsrq_2'").get().handoff_at, null);
console.log("link-purchase-state ok");
