// Usage estimates for parts run outside the owner's AI provider.
export const BYOK_MARKUP = 1.15;
// What 1Helm's own parts cost per use, for BYOK metering (nano$ before markup). Model calls are never in here: they're $0 to us.
export const METER = {
  embed_token: 12,           // Workers AI bge-m3: $0.012 per million input tokens
  search: 27_500,            // web_search on DuckDuckGo through Browser Run: ~1.1 s of browser time at $0.09/browser-hour
  page: 75_000,              // fetch_url rendered through Browser Run: ~3 s of browser time
  // Hindsight memory, re-measured 2026-10-14 from the memory box's own LLM request traces (the design notes has the method,
  // the raw numbers and how sure each one is). The old values (retain 120 nano per character, recall 50,000) priced only the characters
  // and ignored that every extraction call also sends Hindsight's long extraction prompt (about 2,600 input tokens), that every saved item
  // runs a consolidation call, and that mental models refresh after it. Price a send with hsRetainNano() or hsRetainBatchNano() below, never
  // with characters alone, and a recall with hsRecallNano().
  // Every price below is the list price of ONE pinned OpenRouter route (METER.md section 6.3 has the routes, the provider JSON and the date the
  // prices were read), because the Captain decided on 2026-10-14 that 1HC charges exactly the provider price plus BYOK_MARKUP. Recalibrate monthly:
  // read the endpoint prices again, and compare the tokens with the memory box's traces.
  hs_retain_char: 65,        // extraction, per character: 0.297 input tokens and 0.0695 output tokens per character at openai/gpt-6-luna pinned to Azure (provider tag azure, ZDR), $0.10 in and $0.50 out per million tokens
  hs_retain_call: 327_000,   // extraction, per call (one call per 3,000-character chunk) with a cold prompt cache, as in a lone save: the extraction prompt, 2,639 input tokens, and 126 output tokens
  hs_retain_char_warm: 58,   // per character when the prompt is cached (the measured slope: 0.222 uncached and 0.075 cached input tokens, 0.0695 output tokens, per character), cached input at $0.01 per million
  hs_retain_call_warm: 126_000, // per call when the prompt is cached: 398 uncached and 2,241 cached input tokens and 126 output tokens. Every call after the first in one send to Hindsight (a backfill, a rebuild) is priced this way; 3,009 measured calls, 78% of input cached in bursts
  hs_consolidate_call: 292_000, // one consolidation call at deepseek/deepseek-v4.1-flash pinned to relace, reasoning off, ZDR: 6,852 input tokens (no cache assumed) at $0.0201 and 256 output tokens at $0.60 per million. Hindsight consolidates 8 facts per call, and a send yields 1.31 facts per extraction call (measured on 3,038 calls)
  hs_raw_char: 83,           // a Bee recording kept as raw chunks (strategy raw-transcript, chunks mode), per character. No extraction call and local embeddings, so the only model cost is Hindsight's own consolidation of the chunk facts (observation scopes shared, as designed). Measured 2026-10-14 on a bank holding only raw chunks, 11 recordings, 130,399 characters, chunk size 800: 39 consolidation calls, 415,966 input and 4,046 output tokens at the consolidation route's $0.0201 and $0.60 per million (10.79 million nano$, no cache assumed), and no retain call. DESIGN 7.2a
  hs_refresh_run: 1_001_000, // one mental model refresh run at the same route with reasoning low: 22,300 input tokens at $0.0201 and 920 output tokens (800 visible and about 120 reasoning) at $0.60 per million. Charged per model, and only when a send can start one: the bank templates refresh a model on a cron twice a day (every 12 hours; before template p10-4 after each consolidation, at most once per 1,800 seconds), so the Resident charges a window of every template model (General and project channel counts: hindsight-template.js templateModelCount) at most once per 1,800 seconds (hsRetainHold in resident.js)
  hs_recall: 480_000,        // one recall on a bank of more than 250 nodes, or of unknown size (the top tier of HS_RECALL_TIERS): the reranker reads 300 candidates, mean 19,959 input tokens measured (maximum 33,537), at $0.02 per million (perplexity/pplx-decider-v1.1-27b has one provider endpoint, Perplexity), plus 20%
};
// What one send of items to Hindsight costs, in nano$ before markup. `lens` is the characters of each item. The first extraction call of the send
// pays the cold prompt (hs_retain_call), every later call pays the cached prompt (hs_retain_call_warm). Hindsight splits text into 3,000-character
// chunks, one call each. The whole send pays its consolidation calls (8 facts per call, 1.31 facts per extraction call, at least one), and
// `models` mental model refresh runs when the caller knows a refresh window opens with this send (0 when one is already paid for).
// An item with no characters costs nothing, and a send of only those costs nothing.
export const HS_CHUNK_CHARS = 3000, HS_FACTS_PER_CALL = 1.31, HS_CONSOLIDATE_FACTS = 8, HS_REFRESH_WINDOW_MS = 43200e3;   // = 12 hours, the gap between the two daily cron refreshes of every template mental model (refresh_cron "0 10,22 * * *"; test/hs-refresh-window.test.mjs checks it), so one charged window covers one refresh run per model
export const hsRetainBatchNano = (lens, models = 0) => {
  let calls = 0, total = 0;
  for (const len of lens) {
    const n = Math.floor(Number(len) || 0); if (!(n > 0)) continue;
    const chunks = Math.ceil(n / HS_CHUNK_CHARS), cold = calls === 0 ? 1 : 0;
    total += cold * METER.hs_retain_call + (chunks - cold) * METER.hs_retain_call_warm + n * (calls === 0 ? METER.hs_retain_char : METER.hs_retain_char_warm);
    calls += chunks;
  }
  if (!calls) return 0;
  return total + Math.max(1, Math.ceil(calls * HS_FACTS_PER_CALL / HS_CONSOLIDATE_FACTS)) * METER.hs_consolidate_call + Math.max(0, models) * METER.hs_refresh_run;
};
export const hsRetainNano = (chars, models = 0) => hsRetainBatchNano([chars], models);   // one item sent alone, as a chat turn is
// A Bee recording kept as raw chunks (strategy raw-transcript, chunks mode) makes no extraction call and embeds on our own server, so what it costs is the
// consolidation work its chunk facts cause, which grows with the text (METER.hs_raw_char). Measured 2026-10-14: DESIGN 7.2a.
export const hsRawNano = (chars) => { const n = Math.floor(Number(chars) || 0); return n > 0 ? n * METER.hs_raw_char : 0; };
// A recall costs the reranker's input tokens, which grow with the number of candidates, and that is the bank's size up to 300 (the cap).
// Tiers by the bank's node count (stats total_nodes), each priced at its measured worst case plus 20% for the provider's own token count, at
// $0.02 per million tokens (20 nano per token). Measured on 2026-10-14 (METER.md 3.4): 25 nodes 1,372 tokens, 103 nodes 7,038, 222 nodes 10,787,
// 300 candidates mean 19,959. A bank of unknown size is charged the top tier. The Resident reads the size at most once a day (hsRecallNano in resident.js).
export const HS_RECALL_TIERS = [[25, 33_000], [100, 170_000], [250, 312_000], [Infinity, METER.hs_recall]];
export const hsRecallNano = (nodes) => {
  const n = Number(nodes);
  if (nodes === null || nodes === undefined || nodes === "" || !Number.isFinite(n) || n < 0) return METER.hs_recall;
  for (const [max, nano] of HS_RECALL_TIERS) if (n <= max) return nano;
  return METER.hs_recall;
};
