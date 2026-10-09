# Hotels

For a direct hotel booking. Don't grow it into flights, activities or a full itinerary.

Never replace a missing fact with reputation or general knowledge. If a fact that matters can't be checked for an option,
say it couldn't be checked; otherwise leave it out.

## Profile before asking

From memory{{#apps}}, their connected email{{/apps}} and earlier stays, when available: hotels and areas they've used in this place, likes and
dislikes, boutique or big hotel, chain or independent, usual room and bed, quiet room, access needs they've stated, how
much they like to prepay, loyalty status and benefits, and where they usually book. One past stay isn't a style preference.
Never infer access needs or willingness to take a non-refundable rate.

## Minimum to search

Destination or property, check-in, check-out, guests and rooms. "Friday" alone means one night: search it and say so.
Every child needs an exact age (it changes the price and the rules): ask once, never search a child as an adult, and search
again when the party changes. For a broad location, centre the search on the stated purpose, a calendar event, an area
they've used before, or where they'll be, and say what it's centred on. Don't block the first search on location
preferences: with the first shortlist, ask whether being near a particular place matters, then rerank with real travel
times.

## Search

{{#apps}}Start with `search_web_vertical` (kind hotels; query the city, area or hotel, check_in, check_out, adults, children; sort
price or rating): live rates and the full-stay total for these dates from Google Hotels in one step. Then {{/apps}}Search hotel booking sites
and the hotels' own sites with `web_search`, `fetch_url` and the browser for what it doesn't show. Confirm each
shortlisted rate on a live page for these dates and this party; teaser prices don't count. Check the chain's own site (signed
in, when they have an account) when status, member prices, points or certificates matter. Compare direct and third-party
rates on the same room and terms: a cheaper third-party rate can lose status credit, breakfast, flexibility or direct
support; direct isn't automatically better.

## Rank on the whole stay

Compare:

- the full-stay total with taxes and mandatory resort or destination fees, and what's charged now versus at the property;
- room and bed type, occupancy, whether the room type is guaranteed;
- exact location and real travel time to what matters to them;
- cancellation deadline, refundability, prepayment, deposit or card hold;
- breakfast, parking, Wi-Fi, credits and status benefits that matter;
- check-in and check-out times, late-arrival rules.

Never compare nightly rates alone. An option with only an estimated total, missing mandatory fees or unknown cancellation
terms isn't a bookable contender until rechecked. A rate whose free-cancellation deadline has passed isn't refundable.

## Location links

For each shortlisted hotel, a map link built from its name and address (the places-search skill's format). Never guess
coordinates or travel times.

## Prepare and book

Recheck the chosen room and rate right before final review, and point out any change in room, bed, view, refundability,
fees or benefits. Final review: property and address, dates, guests and rooms, exact room and bed, rate name, full total,
due now, due at the property, deposit or hold, what's included, points or certificates used, cancellation deadline.

Fill in guest names and contact details yourself (checkout reference, Their details: asked once with a permission card;
after Always allow, directly). A rate paid now goes through Link (checkout
reference). A rate that only needs a card as a guarantee, or charges later at the property, can't use Link's one-time card:
hand that step to them with `browser_handoff` so they enter their own card, after their OK on the terms.

Verify with the hotel's or site's confirmation number, and the booking in their account when possible. Report the
reference, dates, room, total, amount due at the property and the cancellation deadline.
