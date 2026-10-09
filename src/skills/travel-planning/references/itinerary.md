# The itinerary

Use this when a trip spans several days, an existing itinerary is being revised, logistics or pass money need checking, or
the plan will become a file. Early inspiration can stay light; apply all of this before calling a plan workable.

## One plan, kept in one place

Keep one active plan. Don't make the person reconcile several chat answers. For a trip that runs over several turns, keep it
in `/workspace/workspace/<trip-slug>/plan.md` and update it as you go (read it again before every change; a later turn or a
restart starts from it). It holds only what changes the result:

- home, current location (from the location line with their message, never asked), bases, local time zones, travel dates (with the year);
- travellers, children's ages, mobility or access needs, documents when relevant;
- budget and currency, pace, interests, diet, must-dos, exclusions, transport preferences;
- fixed anchors, open choices, confirmed bookings, dependencies;
- every item with its decision (proposed / selected / rejected), evidence (unchecked / estimated / verified, with source and
  date) and booking state, kept apart;
- a short change log with the previous values, so a change can be compared or undone.

Never put identity or payment details in it (legal names beyond first names, dates of birth, passport, loyalty or card
numbers, confirmation codes the person didn't ask you to keep).

Record a selection only from their explicit choice or a choice they clearly handed you. A rejected item leaves the active
plan but stays in the file as rejected, so it doesn't creep back. "Build me an itinerary" lets you arrange grounded
recommendations into a proposed schedule; those items stay visibly tentative.

## The list of what's open

For a trip with several parts, keep one list of every open outcome inside the plan, each with:

- **Outcome:** what has to become true ("Tokyo hotel booked for 3 nights").
- **Owner:** planning (research you can do), booking (a live check or purchase), or the person (a decision, a private
  detail, an approval, or something no tool here can do, like renewing a passport).
- **Status:** investigating, needs a decision, ready to book, booking under way, waiting on the person, blocked, booked,
  confirmed, done, or dropped.
- **Next step**, **evidence** (unchecked / estimated / verified) and **deadline** (a date, unknown, or none).

Mark something dropped only when the person removes it. Never call the trip done while anything required is still
investigating, waiting, ready to book, under way or blocked.

In chat, show the list as a compact table after the first trip shape, after a real change, or when they ask what's left;
not after every small exchange:

| Part | Current plan | Status | Next step |
|---|---|---|---|

Translate the internal fields into plain words in those four columns. For a long multi-step stretch of work you're doing
right now, `update_todos` can show your own steps; it doesn't replace this list.

A booking they confirmed stays fixed: plan around it, and change or cancel it only through the booking skill with their
OK. One they report but you haven't seen stays fixed too, without claiming you verified it. Never downgrade, duplicate or
silently rebook it.

## Revising without drift

Apply each edit to the one plan:

- **Move:** same item, same decision; recheck hours, travel, tickets and everything downstream of the new time.
- **Replace:** the old item becomes rejected or removed as asked; the new one starts proposed unless they chose it.
- **Remove:** only that item; note what gap or broken dependency it leaves.
- **Undo:** restore the previous plan state. Undo never reverses a real booking, purchase, cancellation or message.

Keep unrelated days, constraints, rejections and confirmed items untouched. Don't add a restaurant, sight, city or detour to
make the result look fuller. After a real change, say what moved, what was added or removed, and what now needs
rechecking. Show full side-by-side versions only when they ask.

## Building a day

Pin down the exact local dates (with the year) and where each night is spent before calling a day workable. Dates given
without a year that have already passed this year (Oct 5 when it's Oct 7) mean next year or a mistake: ask which, don't
assume; anything that depends on the weekday (opening days, timetables) stays conditional until they answer. If something's
missing, give a conditional sketch from what you know, ask for the one blocking detail, and say the schedule isn't confirmed.

For each day, a realistic local-time sequence, with only what makes it usable:

- a time or honest window, the place and area, how long it takes;
- how they get there from the previous stop, with a travel time you actually found (or "not checked");
- a real buffer for transfers, queues, check-in or recovery;
- meal, rest, medication or nap windows where they shape the day;
- known cost and booking state;
- one line on why it fits;
- a backup where weather, scarcity, closure or a tight connection makes it fragile. A backup is a proposal, not a second
  selected item.

Check opening days and hours, last entry, ticket windows, arrival and departure times, check-in, and connections. Take
travel times from the operator's timetable or a route you looked up, and label them estimates when that's what they are;
recheck seasonal timetables nearer the date. Never present a guessed travel time as checked.

Carry the group's limits through every day: age rules and child prices, stroller or step-free practicality, walking load,
rest, meal times, the pace they asked for. Flag an overloaded day and offer the smallest fix; never compress activities into
impossible timings.

## Grounding the facts

Each source proves only what it owns:

1. A supplier's confirmation proves an existing booking.
2. A live booking page proves current availability and terms (the booking skill).
3. The official venue, event, operator or government page supports identity, operation, schedules, closures, rules and
   published prices.
4. Search results, guides, reviews and posts support discovery and fit; check any operational claim from them against
   another source.

Open each important booking or information link and make sure it reaches the right official item, date or product. A dead
link, or a redirect to something else, is a failed source: find the current official page or mark the item unverified. A
dead link isn't evidence of closure, and a working page isn't evidence of dated availability. An official published price is
fine for planning; the date-specific total, fees and refund terms come from the live check. When sources disagree, prefer
the one that owns the fact and say what's unresolved. Never fill a gap with a plausible venue, time, price or link.

## Trip money, in the open

For a pass, bundle or real cost comparison, check the exact current product first, then lay out:

- product, duration, validity pattern, class or zone, who qualifies, official price today;
- each journey or entry, its normal price, and whether the product covers it fully, discounts it, needs a reservation or
  supplement, or doesn't cover it;
- adult and child counts and their rules;
- currency, known taxes or fees, and unknowns; the exchange rate's source and date if you convert;
- the arithmetic: point-to-point total, product total, uncovered extras, the difference.

Never interpolate a duration that isn't sold, infer coverage from a product's name, or call something cheaper while fares,
supplements, eligibility or prices are missing. When the numbers can't support a savings figure, show the known parts and
what's unresolved. A small calculation is easiest to get right with `run_command` (python3).

## The itinerary file

When they ask for it, or accept your offer at a natural stopping point, make one itinerary file (`read_skill` with slug
artifacts: a PDF to print, a web page for phones, a Word file to edit). It holds:

- a day-by-day view in local times with travel, buffers, costs, booking state, why each item is there, and backups;
- confirmed bookings set apart from selected items, and a clear "still open" section for proposed (undecided) items only;
  rejected items are left out of the file entirely: not in the schedule, not under "still open", not as a note;
- official, source or booking links, and when consequential facts were checked;
- map links per place (the places-search skill), and a photo per recommended place only when a trustworthy one exists.

Later changes update that same file and share it again at the same path. It's private: a share link or a published page is
a separate step, only when they ask. If they want to send it to someone, a downloaded copy or a share link they make
themselves are the options; don't promise a private, invite-only share.
