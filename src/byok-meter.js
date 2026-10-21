// Usage estimates for parts run outside the owner's AI provider.
import { EXTRACT_CHARS } from "./mem0-store.js";
export const BYOK_MARKUP = 1.15;
// What 1Helm's own parts cost per use, for BYOK metering (nano$ before markup). Model calls are never in here: they're $0 to us.
export const METER = {
  embed_token: 12,           // Workers AI bge-m3: $0.012 per million input tokens
  search: 27_500,            // web_search on DuckDuckGo through Browser Run: ~1.1 s of browser time at $0.09/browser-hour
  page: 75_000,              // fetch_url rendered through Browser Run: ~3 s of browser time
  // Mem0 memory (src/mem0.js). Every price is in nano$ before markup, and it is an ESTIMATE from the size of what is sent and the list price of the starting model, not a
  // measurement: Mem0's extraction prompt is about 25,000 characters (6,700 input tokens with the mission and the 10 nearest facts it shows the model), and the starting model
  // (~openai/gpt-luna-latest, Memory: extract) lists $0.10 in, $0.01 cached in and $0.50 out per million tokens. Compare with the AI Gateway log of the mem_extract job
  // (kind memory-extract) after the first real saves, and recalibrate. There is no consolidation, no refresh and no reranker, so a save is one extraction call per 12,000
  // characters plus embeddings (Workers AI bge-m3, embed_token above), and a search is one query embedding.
  mem_extract_call: 700_000,        // one extraction call with a cold prompt cache: 6,700 input tokens at $0.10 and about 400 output tokens at $0.50 per million
  mem_extract_call_warm: 175_000,   // the same call when the prompt is cached (6,200 of the input tokens at $0.01): every call after the first of one send
  mem_extract_char: 70,             // per character of the text sent: 0.3 input tokens ($0.10), 0.07 output tokens ($0.50) and the embeddings of it, about 5 nano$ (0.4 tokens at embed_token)
  mem_raw_char: 4,                  // text kept as chunks with no extraction call: only its embeddings, 0.3 tokens per character at embed_token
  mem_search: 1_000,                // one search: the query embedding (about 80 tokens at embed_token), no model call
};
// What one send of items to memory costs, in nano$ before markup. `lens` is the characters of each item. Mem0 reads at most EXTRACT_CHARS characters (mem0-store.js) in one extraction call,
// and the first call of a send pays the cold prompt, every later one the cached prompt. An item with no characters costs nothing.
export const hsRetainBatchNano = (lens) => {
  let calls = 0, total = 0;
  for (const len of lens) {
    const n = Math.floor(Number(len) || 0); if (!(n > 0)) continue;
    const chunks = Math.ceil(n / EXTRACT_CHARS), cold = calls === 0 ? 1 : 0;
    total += cold * METER.mem_extract_call + (chunks - cold) * METER.mem_extract_call_warm + n * METER.mem_extract_char; calls += chunks;
  }
  return total;
};
export const hsRetainNano = (chars) => hsRetainBatchNano([chars]);   // one item sent alone, as a chat turn is
// Text kept as chunks with no extraction call (a Bee recording, a long file): its embeddings only.
export const hsRawNano = (chars) => { const n = Math.floor(Number(chars) || 0); return n > 0 ? n * METER.mem_raw_char : 0; };
export const hsRecallNano = () => METER.mem_search;
