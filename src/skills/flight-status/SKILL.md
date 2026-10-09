---
name: flight-status
description: Use when the person asks about a specific flight's status or times ("is my flight on time?", "when does UA 4 land?", delays, gates, cancellations, where a plane is now), airport delays, or wants a booked flight watched for changes.
always: false
---
# Flight status

Answer about one exact flight on one exact date, from a current source, in plain words.

**Where the facts come from.** Live status comes from public sources{{#apps}} (live search, `search_web_vertical` kind flights, shows
which flights fly a route with their scheduled times and fares, but not a flight's live status){{/apps}}: the operating airline's own
flight-status page (it owns the facts), the departure and arrival airports' flight boards, and public flight trackers such as
FlightAware or Flightradar24, with `web_search`, `fetch_url` and, when a page needs it, the browser. If a source can't be
read right now, say so and try another; never ask the person for an API key.

## Pin down the flight first

- Airline and flight number, and the date (local departure date). "My flight" from memory or an earlier booking tells you
  which flight; it doesn't tell you its current schedule: always check live.
- **Look it up in this turn, every time.** Never state a flight's status, times, gate or whether it landed without a lookup
  in this turn: memory, an earlier answer or an earlier lookup (even from today) is old. If you can't check right now, say
  "I'd need to check" instead of stating it.
- One number can fly several legs a day, and codeshares carry several numbers for one plane. Pick the leg that matches
  their origin and destination; for a codeshare, check the operating airline's page.
- Ambiguous ("my Denver flight", two flights that day): ask which, or check both and say which is which.

## Read it right

- Report scheduled, estimated and actual times in each airport's local time, and say so ("lands 4:45 PM Denver time").
- Departure and arrival gate and terminal when published. A gate shown days ahead often changes; say it's subject to change.
- An estimated or predicted time is an estimate: say "expected", never present it as confirmed. Once it has landed, give
  the actual time and say it landed.
- A past flight ("was it delayed last Tuesday?"): history pages often list only actual times. State a delay only against
  that date's scheduled times from a source. If the only schedule you have is another day's, say so ("against its usual
  10:20 PM departure, it left 3 minutes early") or say the dated schedule isn't published.
- Cancellation is a big claim. Report it as confirmed only when the airline (or the airport) says so, or two independent
  sources agree. One tracker alone showing "cancelled": say it shows as cancelled there and the airline hasn't confirmed it
  yet, and keep checking.
- Where a plane is now: from a tracker's live position for that exact flight and date; never guess a position.
- No public data (blocked or private aircraft, a flight too far ahead): say so plainly; don't try to get around it.
- Airline policies (bags, rebooking rules, compensation) aren't flight status: answer from the airline's own pages with
  `web_search` and `fetch_url`, and say where it came from.

Reply about the flight, not about how you looked it up: no raw status codes, ids or tool talk. A link to the airline's status
page is useful so they can check it themselves.

## Airport delays and boards

For "are there delays at SFO?", read the airport's own site and a current official or tracker delay page; give the
departures and arrivals picture plainly. For "what's arriving from London today?", read one board or tracker page and list
the next ten or so (flight, time, status), with the source; then say how many more there are (earlier today, later) and ask
in one line whether they want those. Don't pull the whole day before asking.

## When it goes wrong

They can't board, the flight's cancelled, they need to rebook: help on the airline's website or app with their OK (the
booking skill's checkout rules apply to any change that costs money). You can't phone the airline or the airport; you can
find the right number or help desk and draft what to say.

## Watching a flight

Only when they ask ("keep an eye on my flight Friday"). Set it up with `schedule_workflow`, after `list_workflows` shows no
watch for it already:

- **The job's own words must stand alone**: the exact flight, date and route, the booked times (the baseline), the sources to
  read, what counts as a change, how to tell them (in the task, or by `text_person` only if they asked to be texted), and when
  to stop. Each run sees only that, not this conversation.
- **Cadence:** about daily while departure is more than 48 hours away, hourly from 48 hours to 6 hours out, every 15 minutes
  from 6 hours before departure until it lands. Update the job's schedule as it moves between bands, and end it with
  `set_workflow_status` after landing.
- **A gate** (`set_workflow_gate`) makes the quiet checks cost no AI: a small script saved in `/workspace/workspace/` that
  reads the status, compares it with the last reported one, and exits 0 when nothing changed, 3 when something did. Run it
  once yourself before relying on it.
- **Report only real changes:** a first delay of 30 minutes or more, a delay that crosses into a worse band (30–59, 60–119,
  120+ minutes) or moves by an hour, a confirmed cancellation, a diversion, a terminal or airport change, a gate change within
  24 hours of departure, an aircraft change that affects their seats. Stay quiet on on-time, boarding, taxiing, departure,
  in-flight progress, a first gate assignment, and a landing (unless they asked to hear it or someone's picking them up).
  Never report the same change twice; save what you reported with `save_run_notes`.
- An unconfirmed cancellation in a run: don't report it yet; check the airline's page on the next run and report once it's
  confirmed.
- After three failed checks in a row, tell them once that the watch can't read the status right now.

Describe it honestly: you check at those times; you don't see changes the moment they happen.
