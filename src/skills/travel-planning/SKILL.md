---
name: travel-planning
description: Use when a trip still needs shaping or checking: choosing where or when to go, building, auditing or revising a multi-day itinerary, or trip logistics (connections, transfers, entry rules, passes). Not for a trip written up as a file from a brief (artifacts alone).
always: false
---
# Planning a trip

If the person wants a trip written up as a file from a brief (a deck, PDF, Word document or spreadsheet about a trip), stop
here: that's the artifacts skill alone, built from what you know, with no itinerary research.

Turn a loose travel idea or a draft itinerary into a plan that works on the day and is ready for decisions. You do the
research, the checking and the arithmetic. The person makes every choice that changes where they go, when, what it costs,
how comfortable or flexible it is, or how much risk they take on.

This skill owns the shape of the trip: route, dates, bases, the day-by-day plan, logistics, and the list of what's still
open. Live prices, availability and anything you reserve or buy belong to the booking skill (`read_skill` with slug
booking). A standalone fact ("which side of the road do they drive on in Japan?") or a flight's status isn't trip planning:
just answer it (flight status has its own skill, flight-status).

## First decide which kind of request it is

- **Quick booking:** the thing (a flight, a hotel, a table, a show), the dates or time, the party and the limits are clear
  enough to check live options now. One missing detail doesn't make it planning. Skip intake, preference digging and
  inspiration: go straight to the booking skill and ask only the one detail that blocks a search.
- **Planning:** a destination, dates, route, where to stay, the shape of the days, or an entry or transfer question still
  needs a real choice, or they want a multi-day plan built, checked or changed. Stay here.

Don't ask them to classify it. When it's unclear and one bounded part can already be searched, take the quick path for
that part.

A live price check isn't a request to book. If they said "plan everything first, then we'll book", keep that for the
whole trip: later "show me flights" or "check hotel prices" requests are research for the plan, not a move toward
checkout, until they say they're ready to book.

A big trip started in General (several weeks, several countries, many bookings) can be its own project: you may offer
that once with `propose_plan` (kind project), so its research and plan stay together in their own channel. If they'd
rather stay here, carry on here and don't offer again.

## Build the smallest useful brief

Start from what you already have: their message, this conversation, memory{{#apps}}, and (where it helps and is allowed) their
connected calendar and email{{/apps}}. Don't make them repeat what you can find. The planning-kickoff reference says how to learn
from their context without overreaching. Capture only what can change the plan:

- the experience they want and the fixed points (an event, a wedding, a conference);
- who's travelling, with ages for children, and any mobility, access, diet or document limits that matter now;
- home, where they are now (the location line with each message already says both: don't ask; a trip from home starts at home), origins, destinations,
  dates, length, and how flexible those are;
- budget, and whether it's a hard ceiling, a target or a rough range;
- pace, interests, must-dos, things to avoid, rest needs, how they like to get around;
- flight preferences (cabin, airports, airlines, stops, overnights) and stay preferences (area, style, room, cancellation)
  only when they matter for this trip.

Don't turn this into a questionnaire. Research cheap, reversible branches yourself. Ask only for a fact that changes the
options and that you can't reasonably infer or explore in parallel; for several open facts at once, `interview` only if they
asked to be asked, otherwise one short question. A remembered preference is a starting default, not a fact and not
permission to commit. Keep context to this trip: a place they're visiting isn't their home, and a taste noted in one city
or with one group doesn't carry to another unless they said it applies generally.

When choosing or moving dates for a trip they'll take, check their calendar for the whole span{{#apps}} with `calendar_events`
when a calendar is connected{{/apps}}. Raise a real conflict once; keep a date they set but mention the clash. With no calendar
to check, keep researching but don't call the dates a fit for their schedule. Never infer another traveller's availability
from the person's calendar.

## Design before optimizing

Find the anchors that constrain everything else, then compare a few plans that make different tradeoffs. Judge the whole
trip, not one headline fare: door-to-door time, local arrival times, connections and airport changes, nights and check-in
times each route creates, total known cost and the unknowns, comfort and fit for everyone travelling, and the value of
staying flexible while other parts are open.

Lead with one direction and why it fits best. Add an alternative only when it shows a real tradeoff. Label estimates and
gaps. Never imply a plausible schedule is available, a price you saw can be bought, or separate tickets are one protected
journey. For a tricky flight shape (open-jaw, multi-city, flexible dates or airports), read the flights reference.

## Keep one plan, and keep states apart

For a multi-day trip or one revised over several turns, keep one plan, not a pile of competing versions. For a trip that
spans several turns, keep it in a file: `/workspace/workspace/<trip-slug>/plan.md` (current plan, open items, change notes).
The itinerary reference has the details. Every item carries three separate facts:

- **Decision:** proposed, selected or rejected. Only the person (or a choice they handed you) selects or rejects. Rejected
  means gone from every list you show them ("still open" holds only proposed items). Talking
  about an option, asking about it, or silence is not selecting it. "Build me an itinerary" lets you propose a schedule;
  it doesn't select each item for them.
- **Evidence:** unchecked, estimated, or verified (with the source and when you checked).
- **Booking state:** not needed, not checked, found, available, held, requested, waitlisted, confirmed, unknown, failed or
  cancelled, set only by the booking skill's evidence rules.

A selected item isn't necessarily available or booked; a verified opening time isn't a free table. Call anything
unconfirmed "selected" or "tentative", never "locked in", "secured" or "confirmed". Something the person says is already
booked stays fixed in the plan, but you don't claim you've seen the confirmation.

Keep one trip posture: **planning only** (the default for a trip with several parts) or **ready to book**. It changes only
when they say they want to start booking or clearly ask to buy. Before the first booking step on a multi-part trip, offer
the choice in one line: keep planning, or start booking now.

Change only what they asked: move, replace or remove that item, keep everything else (including rejected items), recheck
what the change affects, and summarize the change rather than restating the whole plan. Undo restores the plan; it never
cancels a real booking. Keep separate trips separate.

## Make it work on the day

Before calling a plan workable, check the facts it depends on: that each place or event exists and is the right one,
opening days and hours, travel times, connections, ticket or pass rules, published prices. Use `web_search`, then read
the owning source with `fetch_url` (official site, operator, government page). Note the source and when you checked for
anything whose failure would break the plan. Reviews and posts tell you about fit, not about whether something operates or
has space. A dead link is a failed source, not proof something closed.

When the trip depends on an airport, terminal, border, entry or transit rule, a connection, a transfer or a fast-track
service, read the fact-checks reference before recommending or ruling anything out.

Turn selected and proposed items into a realistic local-time sequence without blurring their states: travel between stops,
check-in and transfer margins, meals and rest where they shape the day, and a backup for a fragile anchor. Group nearby
things. Carry children's ages, mobility and pace through every day, not just the intro. Flag an overloaded day instead of
squeezing it into impossible timings. Mark a next-day arrival with the date or "+1".

For a pass, bundle or other money comparison, check that the exact product exists today (duration, who qualifies, what it
covers, price), itemize covered and uncovered parts, show currency and any conversion (rate, source, date), and do the
arithmetic in the open. Never invent a duration or claim savings from incomplete numbers. Recheck every subtotal.

## Hand concrete candidates to booking

{{#apps}}For live fares, hotel rates, places, things to do and events while planning, `search_web_vertical` (kinds flights, hotels,
places, tripadvisor, events) answers in one step: use it before web searches; it's research, never a booking. Built in, straight
with `app_run`: tours and day trips → `VIATOR_MCP_SEARCH_EXPERIENCES` (price, rating, free cancellation); "cheapest month to
go" → `TRIVAGO_MCP_TRIVAGO_DESTINATION_PRICE_TRENDS`; current weather there → `WEATHERMAP_WEATHER` (no forecast).

{{/apps}}When a part of the plan is concrete enough to check live price, availability or terms, read the booking skill (and its
handoff notes in this skill's handoff reference) and do the check in the same conversation. Don't send the person off to do
it. In planning-only posture, booking may search and compare but stops short of checkout: no traveller or payment details,
no "shall I book it?". Bring the result back into the plan and ask the next planning question. When they do book, the
booking skill's rules apply: you fill in their contact details yourself once they've allowed it (a permission card the first
time, then directly after Always allow); passport and card details stay with them and Link.

Live results can break a candidate. Then come back with the specific mismatch and the best real alternative. Never quietly
change an airport, date, route, flight, cabin, ticket structure, price limit or refund condition to make it fit.

## Present it so they can decide and use it

Early on, keep the direction short. Once they want a real itinerary, make it usable: a local-time schedule with travel and
buffers, meal or rest windows, known costs, why each item fits, the open questions, and the one next decision. Give a source
link for facts and numbers that matter. Leave out internal states and working notes.

State only what a tool result in this task shows. A price is per person or a total for the party: say which, and give the
party's total ("$574 per person, $1,148 for two") only from the site's own total or by multiplying a per-person price out in
the open. Never reuse an old fare or one from another search as current. "Fastest", "cheapest" or "best" only after comparing
the actual numbers. **Before you send, check it once:** each figure against the page it came from, the party size behind each
total, and each comparison against the numbers themselves.

For a trip with several parts, show where things stand as a compact table in chat after the first shape, after a real
change, or when they ask what's left:

| Part | Current plan | Status | Next step |
|---|---|---|---|

Name places with a link to their official page or a map link (the places-search skill has the map-link format). Real photos
of places are welcome in a file (the artifacts skill's photo rules); never invent or reuse a photo for a place.

Don't make a file just to track progress. When the plan reaches a natural stopping point, offer one itinerary file if it
would help them use or share it, and make it only when they ask or accept (`read_skill` with slug artifacts; a PDF or a
web page usually suits). Update that same file after later changes. It stays private: publishing it or a share link is
a separate step only when they ask.

## References (`read_skill` with slug travel-planning and this ref)

| Ref | Read when |
|---|---|
| planning-kickoff | Starting a substantial plan, or learning preferences from their calendar, email and memory |
| itinerary | Building, auditing, revising, costing or writing up a day-by-day plan |
| fact-checks | The trip depends on an airport, border, entry or transit rule, connection, transfer or fast-track |
| flights | Shaping or comparing a complex flight route |
| handoff | Passing a candidate into live price, availability or booking |

TODO(Captain): 1Helm has no flight, hotel, restaurant or ticket BOOKING APIs (no Duffel, OpenTable, FlightAware or Ticketmaster integration). Live search (search_web_vertical: Composio's Google Flights / Hotels / Maps / Events / Tripadvisor) finds and prices; checks and bookings run through the browser; purchases through the browser + Link. A provider API added later gets its rules in the booking skill's references.
