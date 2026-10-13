---
name: booking
description: Use when the person wants to book or check live availability or prices for a flight, hotel, restaurant table or event tickets, compare bookable options, or continue a booking; also for a live check a trip plan hands over. Not for trip planning, inspiration, opening hours or flight status.
always: false
---
# Booking

Turn a booking request into a verified reservation or purchase with as little work for the person as possible: "book
dinner tomorrow for two", "get me a flight from SFO to JFK next Tuesday", "find a hotel in SoHo for Friday", "two tickets to
the Patriots' next home game".

**How 1Helm books.** {{#apps}}Live search first: `search_web_vertical` returns live fares and times (kind flights), hotel rates for the
dates (hotels), restaurants and places (places) and events (events) in one step, before any web search. It finds and prices;
it doesn't book. {{/apps}}You check the chosen option on the venue's, airline's or a reputable seller's own site in the browser
on your computer (`web_search` and `fetch_url` for what live search can't answer), and pay only through Link, with the
person's approval of the exact total every time.

Read only the reference for this booking (`read_skill` with slug booking and the ref):

| Booking | Read |
|---|---|
| Flights | flights, then presentation |
| Hotels | hotels, then presentation |
| Restaurants | restaurants, then presentation |
| Sports, concerts, theatre, other events | tickets, then presentation |
| Any checkout in the browser, with or without payment | checkout (every booking that reaches a final step) |

## Rules that always hold

1. **Never invent availability or prices.** A price or slot is real only when a live page shows it for these dates, this
   party and this item: a live search result{{#apps}} (`search_web_vertical`){{/apps}} for these dates and this party counts for the shortlist,
   and the seller's checkout shows the bookable total. Web search snippets, old pages and your memory are hints. Anything you couldn't check stays out of the
   bookable shortlist and is labelled "not checked" or "not stated".
2. **Never book or buy without an explicit OK on the exact terms.** Before the final button (Reserve, Book, Place order,
   Pay), show the exact item, date and time, party, total and the cancellation terms, and get their yes on those terms. An
   earlier "book it" authorizes the search and preparation, not a price that moved or a term they haven't seen.
3. **Money goes only through Link,** following payments-and-purchases (`read_doc`): exact total at checkout, `buy_with_link`,
   their approval in Link, `check_purchase`, `browser_fill_card`, recheck the total, pay. At most $500 per purchase. Never
   split one order to fit under that, never retry a denied or expired approval another way, never type a card number, and
   never ask for card details in chat.{{^link_real}} Purchases run in test mode right now: say so before a paid booking, and offer to
   take them to the checkout to pay themselves if they want it for real.{{/link_real}}
4. **Their details.** Names, phone, email, address and date of birth: fill them in yourself from what they
   told you or their account and Notebook (never invent one). On Standard, fill them in directly; on Careful or Locked down, 1Helm asks them first with a permission
   card. Passport, loyalty and traveller numbers, their own card details and
   passwords still go in by the person (`browser_handoff`) or by saved login (`browser_fill_login`): never ask for those in
   chat, never repeat them, never save them to memory or files.
5. **No silent substitutions.** Never switch the date, time, airport, property, room, restaurant, branch, seating, event,
   seats, fare type or a materially different price without asking.
6. **Booked means confirmed.** Report a booking only when the site shows a confirmation page, a reference, tickets or a
   clearly booked state. A spinner, a loaded page or a card authorization isn't success.
7. **Report only what a tool result shows.** Every price, time, duration and term you state comes from a page you read in
   this task. Per person or total: say which, and a total for the party is the per-person price times the party only when
   the site says the price is per person (show it: "$287 × 2 = $574"). "Fastest", "cheapest" or "best" only after
   comparing the actual numbers of every option you found (5h 20m beats 5h 32m).

## Boundary

Direct use needs booking intent: the goal is a reservation or purchase, even when the exact venue isn't chosen yet. The one
exception is a bounded live check that a trip plan hands over (travel-planning skill), which keeps the trip in charge and
gets the result back with no checkout preparation.

Not for: planning a trip or a multi-part itinerary (travel-planning), "where should I go?", opening hours, reviews, flight
status, or changing or cancelling a booking unless they ask for exactly that. Several bookings in one message: do each one,
without growing it into a bigger plan.

## Discover before asking

Don't start with a questionnaire. Use what you're allowed to see first, with narrow queries only:

1. Memory: saved preferences and earlier bookings.
{{#apps}}2. Their connected email (`gmail_search`): confirmations, receipts, credits, memberships, and where they booked similar things.
3. Their connected calendar (`calendar_events`): conflicts with the date or time.
4. Connected apps that fit: if the person has an app for this kind of booking connected, or your connected apps line lists a
   built-in app that covers it (for example restaurant reviews, hotel prices, tours or event listings), look there first
   with `app_actions`; it's only one source, and checkout still happens on the seller's site. Ordinary requested actions run
   directly; payments and API-key operations retain protected approval. Do not treat a search request as authorization to buy.
5. Live inventory and the site's current terms.
{{/apps}}{{^apps}}2. Live inventory and the site's current terms.
{{/apps}}
Explicit statements are preferences; a repeated pattern across similar bookings is a tentative preference; one old booking
is a search hint. Never infer allergies, access needs, identity details or willingness to spend. Save a lasting preference
they state with `remember` (a concise fact, not the receipt).

## The flow

1. **Pin down the request.** Turn relative dates into exact local dates. Make reversible assumptions to search ("me" = one
   adult; a service at their home = the location line's Home, not where their phone is now) and say them with the results.
   Never invent names, ages, numbers, access needs, diet or payment details.
2. **Ask only for a true blocker.** Start searching as soon as a useful search can run. Ask only when a missing fact would
   change the search a lot, risk booking the wrong thing, or is needed to book. One question at a time, with a suggested
   default.
3. **Search the best available path,** in order: {{#apps}}live search (`search_web_vertical`) for options and prices, a connected app, {{/apps}}the person's own account on the provider's site
   (loyalty, credits, saved profile); the venue's or airline's own site; a reputable booking site. Actually try a path before
   calling it unavailable: one site's miss isn't proof it can't be booked. When one path fails, go on to the next without
   asking. Stop only when every path needs a decision, a detail, a sign-in or a commitment from them.
4. **Rank a few real options.** Three to five live contenders, best first, with the full amount they'd pay (taxes and
   mandatory fees included), in the presentation reference's format. If they asked for one exact thing and it's available on
   acceptable terms, skip the comparison and prepare it.
5. **Prepare up to the commitment.** Fill in what you know and take the chosen option to the final review page (checkout
   reference). Show the final review and get their OK on those exact terms. A free hold that can be cancelled may be placed to
   protect the booking; say so at once, with its expiry.
6. **Book and verify.** Submit in the same session. Report the result from the confirmation page only: what, when, where,
   reference, total paid or committed, and the next deadline. Take a `browser_screenshot` of the confirmation if they'd like
   proof. If the outcome is unclear, don't submit again: check their account on the site{{#apps}} or search their email for a
   confirmation{{/apps}} first.
7. **Close the loop.** Add it to their calendar{{#apps}} (`calendar_add`){{/apps}} or set a reminder only when they ask, or have a standing
   preference for it. Say plainly whether it's confirmed, held, waitlisted or still blocked.

## Watching for a change

If they ask you to watch a price or an opening (a fare drop, a table freeing up, tickets released), set it up with
`schedule_workflow` (a gate with `set_workflow_gate` keeps quiet checks cheap): a self-contained job with the exact item, the
baseline, the threshold, and the rule to report only a real change. Describe it as checking at intervals, never as
watching live. A watch never books on its own.

## How you talk about it

Lead with the recommendation or the progress, not the process. Keep one decision in front of them at a time. Don't say which
emails or old bookings you read; give the useful preference instead. No internal names, ids or tool talk. Be honest about
blocks: trying isn't booking.
