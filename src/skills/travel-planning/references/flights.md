# Shaping a complex flight route

Use this to find a good route shape before live booking checks, when dates, airports, stops or the order of several cities
are still open (open-jaw, multi-city, flexible dates or nearby airports, stopover tradeoffs, airline or alliance limits,
times that must fit a fixed event). For a simple route with set dates and travellers, skip it and go to the booking skill.

{{#apps}}Start with `search_web_vertical` (kind flights) for each candidate shape: live fares and times in one step. {{/apps}}Then public
sources: the airlines' own sites and flight search sites in the browser, and `web_search`. Every price is a planning signal until a
checkout page shows the total.

## Where to look

- **ITA Matrix** (`https://matrix.itasoftware.com/search`): good for exploring routings, connection points, flexible dates
  and fare patterns. It's research only: it sells nothing, holds nothing, and its fares may not be bookable now.
- **A flight search site** (Google Flights, Kayak, Skyscanner) for a broad view of schedules and indicative prices.
- **The airline's own site** for its schedule, fare brands and the price you could actually book.

These are interactive sites: drive them in the browser{{#browser_task}} (`browser_task` with the start link, the exact airports, dates,
travellers, cabin and limits, and an instruction to research only, buy nothing and report each itinerary's details){{/browser_task}}{{^browser_task}} (`browser_navigate`, then `browser_act`){{/browser_task}}.
Don't type names, documents or payment details into a research search; it needs none of them. `fetch_url` on a site's
search-results link sometimes returns readable results; treat them the same way.

## Record each candidate exactly

For every segment, in order: local departure date and time, origin and destination airport codes, marketing airline and
flight number, operating airline and flight number when different, local arrival date and time (with +1 for next day),
connection airport and layover length, cabin (and whether it changes by segment), and whether it looks like one ticket or
that's unknown. Also keep the search inputs, the source, when you looked, and any fare shown, labelled as indicative.

A flight number alone isn't an itinerary: codeshares, operating airlines, repeated numbers, date lines, airport swaps and
schedule changes all make similar-looking results different.

## A short candidate set

Return two to four candidates that show real tradeoffs, not a dump. For each: the whole route with key local times, total
journey time, connections, overnight or airport-change risk, why it fits the trip better or worse, the indicative price with
currency and when you saw it, and what stays unknown until a live check. Don't call one cheaper when fees, ticket structure
or the full-party total are unclear. Don't call a fare refundable or changeable from a cabin name or brand label.

## When a source fails

A CAPTCHA, bot wall, broken date picker, partial result or lost session is a failed source, not proof no flight exists.
Don't loop on the same broken step: try another source, or say plainly what you couldn't check. Never hand the search back
to the person to redo; when they pick a candidate, or price decides it, go on with the handoff reference.
