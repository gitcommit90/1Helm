---
name: google-calendar
description: Use when the person wants their Google Calendar read or changed: what's on, when they're free, adding, moving, changing or deleting an event, inviting people.
always: false
---
# Google Calendar

{{^apps}}Connected apps aren't switched on here, so you have no access to their calendar. Say so in one line.{{/apps}}{{#apps}}
`app_actions` for googlecalendar returns Composio's plan and pitfalls (time formats, paging, recurring events): follow them. This
skill adds 1Helm's defaults and rules on top. Where they disagree, this wins.

## First
- Connected? Go by the connected apps line. Expired: `offer_connect` for googlecalendar, one short line, stop. No calendar app
  connected: if they said Google Calendar (or memory says they use it), `offer_connect` for googlecalendar, one short line, stop.
  If they only said "my calendar", ask which calendar they use{{#cards}} with a small card (Google Calendar, Outlook, iCloud, Other){{/cards}}{{^cards}} (Google Calendar, Outlook, iCloud or another){{/cards}} and end your turn.
- They asked you to add, move or change an event: pass it as the card's `draft` {title, start, end, timezone, calendar, guests}
  (the Defaults below: 30 minutes, their main calendar, their time zone; start and end with their offset), so they see it under
  Connect. Connecting supplies access, not new authorization. If they already requested this exact event, check that time
  and create it without a second yes; ask only if a consequential detail is missing or changed.
- Which account: as for every app (their words, memory, the account notes; ASK FIRST means ask and end your turn).

## Which tool
- What's on, am I free: `calendar_events` (from and to with their offset).
- A plain new event: `calendar_add`. Always pass their time zone as its time zone input.
- Moving, changing, deleting, other calendars, free-slot search, reminders, video links, repeating events: `app_actions` with app
  googlecalendar, then `app_run`.

## Defaults (use them, and say so in your reply)
- No length given: 30 minutes. No calendar named: their main one.
- Their time zone (from your instructions), even for an event about another place, unless they name a zone or say they'll be there
  (then say which zone you used).
- "Tomorrow", "next Friday": from the current-time tag; check the weekday with `date` on your computer when it matters.

## Before you change anything
- Look first. Check that time with `calendar_events` and mention a clash ("you already have Dentist 3:00–3:30") when you ask.
- Moving, changing or deleting: find the exact event first and act on that one, on the calendar it's on (not the main one by
  default). Several matches: show them and ask which. A repeating event: ask whether they mean this one or the whole series.
- Their explicit request authorizes creating the intended event, with or without guests, and requested changes or deletions.
  Do not require another yes or confirm card. Use the defaults above for ordinary omitted details; ask about a real clash or ambiguity.
- Guests get emails from Google: inviting someone, changing an event that has
  guests, or deleting it notifies them. Say so in your line. Don't switch notifications off unless they ask, and then say guests
  won't see the change.
- Adding or removing one guest: read the event and send back the whole guest list with that change. Sending only the new guest
  drops the others.
- A block, hold or focus time shows as busy. An all-day event uses dates, and its end is the day after the last day.

## After
Say what the tool returned: the saved title, the day and time in their zone, the guests, and the event's link only if one came
back. If the saved time looks shifted, fix that event; don't add a second one. Plain words: no event or calendar ids, no raw JSON.
{{/apps}}
