// An AmbientStore on in-memory SQLite with a fake ledger, privacy check and embedder. Used by the search tests.
import { SEED } from "./seed-settings.mjs";
import { DatabaseSync } from "node:sqlite";
import { retainReview } from "../ambient-review-stub.mjs";
import { AmbientStore } from "../../src/ee/ambient.js";
import { fakeAI } from "./fake-embedder.mjs";

export const T = Date.UTC(2026, 9, 11, 15);
export function makeStore({ ai = true, extract = null } = {}) {
  const db = new DatabaseSync(":memory:"), kv = new Map([["tenant", "test"], ["status", "active"]]);
  db.exec("CREATE TABLE convs(id INTEGER PRIMARY KEY,start_time INTEGER,r2_key TEXT)");
  const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) { db.exec(q); return { toArray: () => [] }; } const s = db.prepare(q); const rows = /^\s*(SELECT|PRAGMA|WITH)/i.test(q) ? s.all(...args) : (s.run(...args), []); return { toArray: () => rows }; } };
  const F = { db, kv, memory: true, hidden: "", reserved: [], settled: [], allowSpend: true, aiCalls: [], failAI: 0, state: {} };
  const aiBase = fakeAI(F.aiCalls);
  const env = { MODEL_SETTINGS: SEED, MODEL_SETTINGS_REVISION: 1, OPENROUTER_API_KEY: "test",
    DB: { prepare() { return { bind() { return { first: async () => ({ status: "active", plan: "plus" }) }; } }; } },
    RESIDENT: { idFromName: (x) => x, get() { return { ambientPrivacy: async (texts) => ({ mode: F.memory ? "on" : "off", allowed: texts.flatMap((s, i) => F.hidden && s.includes(F.hidden) ? [] : [i]) }) }; } }, WS: { get: async () => null } };
  if (ai) env.AI = { run: async (...a) => { if (F.failAI > 0) { F.failAI--; throw new Error("embedding provider down"); } return aiBase.run(...a); } };
  const host = { sql, ctx: { storage: { transactionSync(fn) { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } } }, gen: 0, env,
    get: (k) => kv.get(k), put: (k, v) => v == null ? kv.delete(k) : kv.set(k, String(v)), tid: () => kv.get("tenant"), arm: async () => {}, bump() {},
    ledger: () => ({ reserve: async (id, n) => { F.reserved.push([id, n]); return { ok: F.allowSpend, reason: "credits" }; }, settle: async (id, n) => { F.settled.push([id, n]); } }) };
  const store = new AmbientStore(host); store.review = retainReview;
  store.extract = extract || (async (lines) => ({ items: [] }));
  Object.assign(F, { host, store, env });
  F.conv = (id, texts, { speaker = { name: "Ana", id: "s1", is_user: true }, location = null, at = T, gap = 240000 } = {}) => ({ id, start_time: at - 864e5, end_time: at + 60000, updated_at: 1, ...(location ? { primary_location: location } : {}), transcriptions: [{ realtime: false, utterances: texts.map((text, i) => ({ id: `u${id}-${i}`, text, speaker, spoken_at: at + i * gap })) }] });
  return F;
}
