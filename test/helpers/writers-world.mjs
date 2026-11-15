// A deploy-harness world whose memory is the Mem0 memory: the migration in the world's D1, the index fake and the saved model settings. Embeddings answer from the AI fake;
// every other AI call still goes to the world's scripted model. The extraction model (a prompt with "## New Messages") answers W.facts(prompt), a list of { text, category }.
import { readFileSync } from "node:fs";
import { world } from "../deploy-harness.mjs";
import { fakeIndex, embedding } from "./mem0-fakes.mjs";
process.env.MEM0_TELEMETRY = "false";
export function memWorld(opts = {}) {
  const W = world({ ...opts, openrouter: true }), index = fakeIndex(), run = W.env.AI.run;
  W.d1.exec(readFileSync(new URL("../../db/migrations/0063_memory.sql", import.meta.url), "utf8"));
  W.d1.exec("ALTER TABLE tenants ADD COLUMN owner_user_id TEXT; UPDATE tenants SET owner_user_id='u1'; CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT); INSERT INTO users VALUES ('u1','chk+x@example.com');");   // a test account: no automatic rebuild, writes go straight in
  W.env.DB.batch = async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; };
  W.env.MEMORY_INDEX = index;
  const prompt = (i) => (i.messages || []).map((m) => (typeof m.content === "string" ? m.content : (m.content || []).map((c) => c.text).join(""))).join("\n");
  W.env.AI = { run: (m, i) => (i?.text ? { data: i.text.map(embedding), usage: {} } : /## New Messages/.test(prompt(i)) ? { response: JSON.stringify({ memory: W.facts(prompt(i)).map((f, n) => ({ id: String(n), attributed_to: "user", ...f })) }) } : run(m, i)) };
  W.index = index; W.facts = () => [];
  return W;
}
