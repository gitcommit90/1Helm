// 1Helm memory: what is left of the old local ledger. Hindsight is the memory (retain, recall, observations), so the ledger's rows,
// embeddings, rank fusion recall, supersede pass, segment summaries and "no record" check are gone. The old tables stay in storage and are not read.
// What stays: the receipts table (one row per memory recall the Resident makes, written by memory-use.js and the Hindsight writers).
import { scrubSecrets } from "./secrets-scrub.js";
const STOP = new Set("a an and are as at be but by can did do does for from had has have how i if in is it its me my of on or our so that the their them then there these they this to us was we were what when where which who why will with you your should would could about after before since just also into than only not no yes".split(" "));
export const terms = (s) => [...new Set(String(s).toLowerCase().match(/[a-z0-9][a-z0-9.$%+-]*[a-z0-9%]|[a-z0-9]/g) || [])].filter((w) => !STOP.has(w) && w.length > 1).slice(0, 24);

export class Memory {
  constructor(sql, env, meta = () => ({})) {
    this.sql = sql; this.env = env; this.meta = meta;
    sql.exec("CREATE TABLE IF NOT EXISTS mem_receipts (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, turn TEXT, session TEXT, mode TEXT, query TEXT, ids TEXT, top_sim REAL, ms INTEGER, chars INTEGER, error TEXT)");
  }
  receipt(r) { this.sql.exec("INSERT INTO mem_receipts (at,turn,session,mode,query,ids,top_sim,ms,chars,error) VALUES (?,?,?,?,?,?,?,?,?,?)", Date.now(), r.turn || null, r.session || null, r.mode, scrubSecrets(String(r.query || "")).slice(0, 500), JSON.stringify(r.ids || []), r.topSim ?? null, r.ms ?? null, r.chars ?? null, r.error || null); }
  stats() { return { receipts: this.sql.exec("SELECT id, at, turn, mode, query, ids, top_sim, ms, chars, error FROM mem_receipts ORDER BY id DESC LIMIT 10").toArray() }; }
}
export const PACK_HEADER = "(Memory recall for this message, not from the person: records from earlier work in this channel, oldest first, each with its date (the person's time zone) and source; relative words inside a record (\"yesterday\") have their real date in [brackets]. Newer dates win unless the question is about an earlier time. Use them when relevant and ignore the rest. If they don't hold the answer and recall_history can't find it either, say you have no record rather than guessing.)"
  + "\n(Connection-state exception: recalled SSH/Tailscale login and connection notes are historical, even the newest ones; this memory context has not checked current membership. Call native_network with operation status before claiming connected or not signed in. Unchecked or unavailable current state is unknown, not disconnected.)";
