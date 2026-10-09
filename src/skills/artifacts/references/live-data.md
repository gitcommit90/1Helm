# Current data in a file or page

Read this only when they ask for real, current or exact figures, or the file is clearly meant to be factual (a report on real
data, a price comparison, today's rates). An illustrative or planning file (a sample budget, a small trip budget, an example plan)
uses reasonable estimates labelled as estimates instead (SKILL.md rule 3): build it without researching.

Every file you make is fixed when you build it, web pages included: a page you share or publish is static (a published page runs
in a sandbox; its scripts work, but there's no server behind it for you to keep data fresh). So current information appears as a
**dated snapshot**: real data you fetched while building, labelled with when it was fetched.

## Sourcing the snapshot

- Get the data while building: `web_search` for the facts, `fetch_url` for a specific page or a public JSON API (or `run_command`
  with curl and jq for a larger response you need to filter). Include the time frame in your search and check the dates on what
  comes back.
- Reduce what you fetched to the rows the file shows, keep the source names, and save them in `.src/data.json` with the fetch
  time. Build the file from that file.
- Show the time and the sources on the file: "Prices as of 6 Oct 2026, 14:00 PT. Source: …". The date is the contract: the reader
  knows what they're looking at.

## No fetching when the page opens

A static page doesn't call outside APIs when it's opened: no polling, no live feeds, no public proxy to get around a site that
blocks browsers. Every open-time dependency is a third party the reader silently relies on, and when it fails the page shows
nothing or something wrong. Fonts, libraries and images follow the web-page reference; this rule is about data.

If what they want genuinely needs data that's current at every open (a live scoreboard, a ticker), say that a page can't do that
here, and offer what works: a snapshot now, and if they want it kept fresh, a scheduled workflow (`schedule_workflow`) they set up
that rebuilds the page on a schedule and shares it again with `share_file` (the same Library file, the same share and published
links, new data). Set that up only when they ask for it.

## Refreshing

When they ask for newer numbers, fetch again, update `.src/data.json`, rebuild, re-run the checks, and share the same path again.
Update the "as of" time. Don't mix old and new fetches in one file without saying which is which.

## Never fake it

- Never simulate live data: no random-walk prices, no made-up numbers presented as current, no movement animated to look live.
- When a source fails, show the honest state: the last good data with its date, or "not available right now". An honest gap beats
  a convincing fake.
- Market hours, match times and schedules are computed in the venue's time zone (US stock markets: America/New_York), and the
  file says which time zone it shows.
