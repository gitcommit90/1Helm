// Picture holds are sized by picture count, and a refusal while other holds are open waits instead of showing "out of time". Needs: node --import ./test/stubs/register.mjs
import assert from "node:assert/strict"; import { DatabaseSync } from "node:sqlite";
import { Ledger } from "../src/index.js"; import { estTokens, reserveWaiting } from "../src/spendguard.js";
const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...a) { if (!a.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => rows }; } };
const L = new Ledger({ storage: { sql, transactionSync: (f) => f() } }, {}); await L.grant("g", 1e9, "topup");
const pic = { type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(1.4e6) } };
const tok = estTokens([{ role: "user", content: [{ type: "text", text: "hi" }, pic, pic, pic] }]);
assert.ok(tok > 4800 && tok < 5000, "three 1.4 MB pictures count as about 1600 tokens each, not by base64 length");
const hold = Math.ceil(tok * 3e3 * 1.25 * 1.15) + 50e6;   // input at $3 per million with the cache and markup factors, plus a 50 cent-ish output share
assert.ok(hold < 0.1e9, "a few cents");
assert.deepEqual(await reserveWaiting(L, "a", hold, 5), { ok: true });
assert.deepEqual(await reserveWaiting(L, "b", hold, 5), { ok: true }, "a second concurrent call is admitted");
// The whole balance held: a second call waits, and is admitted when the first settles.
await L.reserve("big", L.totals().balance_nano, { fit: true });
const p = reserveWaiting(L, "c", hold, 5); setTimeout(() => L.settle("big", 1e6), 20); assert.equal((await p).ok, true, "waits for the open hold to settle");
// Truly spent: refused at once with out_of_credits (the out-of-time reply).
await L.settle("a", 0); await L.settle("b", 0); await L.settle("c", 0); await L.setBalance(0);
assert.equal((await reserveWaiting(L, "d", hold, 5)).reason, "out_of_credits");
console.log("  ok image hold");
