// Usage estimates for parts run outside the owner's AI provider.
export const BYOK_MARKUP = 1.15;
// What 1Helm's own parts cost per use, for BYOK metering (nano$ before markup). Model calls are never in here: they're $0 to us.
export const METER = {
  embed_token: 12,           // Workers AI bge-m3: $0.012 per million input tokens
  search: 27_500,            // web_search on DuckDuckGo through Browser Run: ~1.1 s of browser time at $0.09/browser-hour
  page: 75_000,              // fetch_url rendered through Browser Run: ~3 s of browser time
  hs_retain_char: 120,       // Hindsight retain (our memory box extracts facts with its own model): ~$0.0003 per 2,500 characters
  hs_recall: 50_000,         // Hindsight recall (embeddings + reranker on our box)
};
