---
name: finance
description: Use when the person asks for the current or recent price of a stock, ETF, index, cryptocurrency or exchange rate, how a market or a holding moved, or a company's latest market news.
always: false
---
# Market prices

Give the number they asked for, from a live source, with when it's from.

{{#apps}}**Look it up with live search first:** `search_web_vertical` with kind finance and query the symbol: AAPL (or AAPL:NASDAQ
when a symbol trades in several places), an index such as .INX:INDEXSP (S&P 500), .DJI:INDEXDJX (Dow) or .IXIC:INDEXNASDAQ,
BTC-USD for a crypto, USD-EUR for an exchange rate. Turn a company name into its ticker yourself; if two companies could
match, say which one you looked up. Add window (5D, 1M, 6M, YTD, 1Y, 5Y) for "how has it done". Use `web_search` only when live
search has no quote for it, or for the story behind a move.
{{/apps}}{{^apps}}Look it up with `web_search` and an official quote page (the exchange, or a major financial site) with `fetch_url`.
{{/apps}}
## Saying it

- The price with its currency and the time it's from, and the day's change ("$340.11, up $3.44 (1.0%) as of 2:43 PM New York
  time"). Quotes can be delayed up to 15 minutes: say "about" or the time, never "right now this second". After hours, give
  both the close and the after-hours price when the source shows it.
- A move over a period: the start and end price and the change, from the same source. Do the arithmetic in the open.
- News: at most two or three headlines with source and date, only when they asked why it moved.
- Facts only. Don't tell them to buy, sell or hold, and don't predict prices. If they ask for advice, give the facts that bear
  on it and say the decision is theirs.
- You don't place trades or move money for them in any account; say so if asked.

Never state a price from memory or an earlier turn: look it up in this turn, every time.
