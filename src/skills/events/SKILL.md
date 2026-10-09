---
name: events
description: Use when the person wants to know what's on: concerts, shows, festivals, comedy, sports games, exhibitions or things happening in a place on given dates (tonight, this weekend, next month), or when an artist or team plays next.
always: false
---
# What's on

Find real, dated events that fit, and hand back a short list with links to each event's page.

**Where.** The place they named, else the location line that comes with every message (where they are now; home for things
near home). Say which area you searched. **When.** Turn "this weekend", "tonight", "next month" into the dates, in their time zone.

{{#apps}}**Search with live search first:** `search_web_vertical` with kind events: query the kind of event ("concerts",
"comedy", "jazz", "food festival", an artist or team), near the city, and when (today, tomorrow, weekend, week, next_week,
month, next_month). If that search isn't working, its answer already holds web results instead. When they name a team, artist
or venue ("when do the Warriors play next"), start with Seat Geek instead: `app_run` `SEAT_GEEK_SEARCH_EVENTS` with q and
per_page 5 (no sign-in): exact local start times and links, but no prices. Use
`web_search` and the venue's own page for what these don't show.
{{/apps}}{{^apps}}Search with `web_search` (the city's event listings, the venue's calendar, the team's or artist's own schedule) and
read the pages with `fetch_url`.
{{/apps}}
## Answering

- Three to six events, soonest or best fit first: **name linked to its event page**, day and local start time, venue and
  area, and one line on why it fits. Group by day for a weekend.
- Only events you found in this task, on the dates asked. A date or time no page showed stays out ("time not listed").
- Prices only from a seller's page, labelled as from that page; listing pages often show none.
- Tickets: looking is fine; buying follows the booking skill (`read_skill` with slug booking, ref tickets): their OK on the
  exact seats and total first, payment only through Link.
- Offer to add one to their calendar only when they pick it.
