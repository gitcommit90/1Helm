# Flights

For a direct flight booking. It doesn't turn the request into a trip plan.

## Profile before asking

From memory{{#apps}}, their connected email{{/apps}} and earlier bookings, when available: airlines or alliances they prefer or avoid, aisle or
window, cabin and whether basic economy is acceptable, home and alternate airports, loyalty programmes and status (the
airline and tier name only, never the number), credits or vouchers and their expiry. Mention relevant status before the
shortlist.

## Minimum to search

Origin, destination, date, one-way or return, and travellers. "Me" with one date means one adult, one way: search that and
say so. Children need their ages (age on the last travel date); ask once. Ask whether an infant under two sits on a lap or
in their own seat; don't guess. Use exact airport codes, not city codes. A city with several airports (New York: JFK, EWR, LGA): search
every sensible one and compare them in the results instead of asking which ("JFK or Newark?" is the question not to ask);
ask only when they named one or the choice really matters (a far-off airport, a different city).
Set the real party in the search itself (KAYAK's link takes it as /2adults; Google Flights and airline sites have a
passengers picker), so every price you read is already for all of them; a 1-traveller price is not their total.
Resolve relative dates in the origin's time zone. Check their calendar for hard conflicts{{#apps}} (`calendar_events`){{/apps}}, but never move
the date they gave.

## Search

{{#apps}}Start with `search_web_vertical` (kind flights; from and to as airport codes, date, return_date for a round trip, adults,
children, cabin): live Google Flights fares and times in one step, priced for everyone searched. Search each sensible airport of
a multi-airport city. Then confirm the chosen itinerary on the airline's or seller's site. The sources below are for what it
can't answer (fare brands, bags, member prices, an airline missing from its results, unusual routings).

{{/apps}}Good sources, in the browser{{#browser_task}} (`browser_task` handles a search
site's forms well: give it the link, airports, dates, travellers, cabin and "search only, buy nothing, report each
itinerary"){{/browser_task}}:

- a flight search site (Google Flights, Kayak, Skyscanner) for coverage across airlines;
- the airline's own site for the bookable price, fare brands, bags and rules, and whenever status, credits or member
  prices could change the result;
- ITA Matrix for unusual routings (travel-planning's flights reference).

Search the whole itinerary together (return or multi-city as one search). Unless they say otherwise, optimize first for
total journey time, then show a meaningfully cheaper longer option if one exists. A missing airline in one site's results
isn't proof that airline doesn't fly the route: check its own site when it matters (a preferred airline, or the one you'd
expect on that route). Prices on a search site are indicative; the bookable price is the one the airline's or seller's
checkout shows for this exact itinerary and party.

## Rank on the whole journey

Lead with the shortest reasonable itinerary (nonstop over connections, usually), judged by the actual durations you read
(Delta 5h 20m is faster than JetBlue 5h 32m), never by impression. Then a cheaper longer option and other
real tradeoffs (their preferred airline, a flexible fare). Don't fill the list with near-duplicates. Compare:

- full total for the whole party, including bags and seat fees they'd need;
- operating airline and flight numbers;
- airports (terminals when relevant) and local times, with +1 for next-day arrival;
- stops, connection airports and layover lengths, total duration;
- cabin and fare brand;
- bags included;
- refund, change and credit rules: yes, no, or not stated (never guess "non-refundable" from a missing fact).

Reject unsafe connections and airport changes. Don't call a fare cheapest when the bags or seats they need make it dearer.
Calculate layovers from the times at the same airport; if you can't, write "layover not stated".

## Prepare and book

Recheck the chosen itinerary's price on the booking page right before the final review, and point out any change in fare,
seats, bags, airports, schedule or operating airline. If status, points or credits could apply, ask once whether to sign
in to the airline's site (with `browser_fill_login` for a saved login, otherwise `browser_handoff`) to compare cash and
points. Never transfer points or use a certificate without their explicit choice at final review.

Fill in passenger names, dates of birth and contact details yourself (checkout reference, Their details: directly on Standard; on Careful or
Locked down 1Helm asks first with a permission card). Passport and loyalty numbers go in by the person: `browser_handoff` at that
page, telling them exactly which fields to fill, then continue once they hand back. Separate tickets for one trip
(self-transfer) only with their agreement, after saying that each has its own price, approval and rules, nothing holds the
later ones while the first is bought, and a missed connection isn't protected.

Final review: travellers, exact itinerary, cabin and fare brand, seats, bags, total, points or credits used, amount charged,
fare rules. Payment through Link (checkout reference); a party total over $500 can't go through Link in one purchase, so say
so and offer to hand them the prepared checkout to pay themselves.

Verify with the airline's confirmation (booking reference). Report route, dates, flight numbers, seats, total and the
reference; never show full loyalty, passport or card numbers.
