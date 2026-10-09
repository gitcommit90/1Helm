# Restaurants

For booking a table, whether they name the restaurant or want a recommendation.

## Profile before asking

From memory{{#apps}} and their connected email{{/apps}}, when available: restaurants they've booked and gone back to, which booking site worked for a
particular place, cuisines and price comfort, usual dining time, areas, indoor or outdoor, bar or table, quiet or lively, and
any diet or access needs they've stated. Never infer allergies, diet or access needs from a menu choice or one old booking.
Don't recite their history; use it to choose well.

## Minimum to search

Date, party size and a usable time window. A named restaurant with several branches needs the right one. "Tomorrow" with no
time: search their usual time or a reasonable dinner window and say so; ask only if there's no sensible default or the time
really changes the answer. For an unnamed restaurant, take the area from context, cuisine and price from known preferences,
and timing from their calendar where useful; state the assumption with the recommendation.

## Search

{{#apps}}Find candidates with `search_web_vertical` (kind places: rating, price level, hours, address, phone, website) first. {{/apps}}Tables
are checked and booked on the web:

- **A named restaurant:** its own reservation link first (on its site, often through a booking platform such as OpenTable,
  Resy, Tock or SevenRooms), or the platform that worked for them there before.
- **Then** other reputable platforms that list it, through the browser.
- **An unnamed restaurant:** find candidates with `web_search` (reviews, guides), then check live tables on their booking
  pages. Rank only tables that fit the date, party, area and time.

{{#apps}}If your connected apps line lists a restaurant or reviews app (built in or connected), use it with `app_actions` for discovery
and details; the table is still checked and booked on the restaurant's booking page.

{{/apps}}One platform's miss isn't proof the restaurant can't be booked: try the restaurant's own link and another platform before
saying it's full. If no online path has a table, give them the restaurant's phone number (from its own site) and the details to ask for
(date, time, party, a waitlist or cancellations), along with the nearest times you did find; you can't
call. Don't create accounts or join paid memberships without their OK.

## Rank on the actual table

Compare: the exact time and seating type, fit with their tastes, any deposit, prepaid minimum, service charge or
cancellation and no-show fee, price level or menu format, location and travel time when it matters, and special terms (set
menu, outdoor, age limit, time limit). If the exact time is gone, show the nearest times. Never silently book an adjacent
slot, another branch, the bar, outdoors or a waitlist.

## Prepare and book

Final review: restaurant and address, local date and time, party size, seating, deposit or prepayment, cancellation and
no-show terms, and any special request being sent (only requests they gave you; a "special occasion" note promises
nothing). Get their OK on those terms before pressing the final button.

Fill in the guest name, phone and email on the booking form yourself (checkout reference, Their details: the first time
1Helm asks them with a permission card; after Always allow, fill them in directly), unless they're already filled from
their signed-in account on that site. A deposit or prepayment goes
through Link (checkout reference). Parties beyond what the site allows: tell them to arrange it with the restaurant; never
split the group.

Before booking, make sure the same table isn't already booked through another path in this conversation; never make a
second reservation for the same restaurant, date, time and party. Verify with the confirmation page or the booking in their
account; a confirmation number on an unclear page isn't proof. Report restaurant, address, date and time, party, seating,
reference and cancellation deadline. Offer a reminder (`schedule_followup`) only if they'd like one.
