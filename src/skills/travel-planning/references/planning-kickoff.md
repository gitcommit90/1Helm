# Starting a substantial plan

Use this once the request is clearly trip planning. A bounded booking should already have gone to the booking skill.

## Learn before asking

Build the first brief from what's already known for this trip:

1. Their message, this conversation, and memory (saved preferences, people they travel with, home).
{{#apps}}2. Their calendar, when one is connected: `calendar_events` over the candidate dates for fixed commitments, travel and
   time off.
3. Their email, when it's connected and it would really help: a few narrow, read-only `gmail_search` queries for recent
   confirmations in only the categories that matter now. For example:
   - flights: airlines they keep using, home airports, cabin, seats they chose;
   - stays: brands or styles they return to, room type, how they handle cancellation;
   - rental cars: company, size, automatic or manual;
   - rail, transfers or dining only when they matter for this trip.
   A quick read like this isn't a reason to ask them to connect email: if it isn't connected, skip it, don't show a connect
   card and don't pause the trip. Offer to connect only when they ask to use their email.
{{/apps}}{{^apps}}2. What they've told you about past trips.
{{/apps}}
Then summarize the usable brief in three groups: what they said, patterns you're fairly sure of, and what's still open.
Ask them to correct any inferred default that matters, and offer a plausible direction they can react to.

## Inferring preferences carefully

- Base a preference on repeated, recent, comparable choices, never one old booking.
- Make sure it was their choice, not a partner's, a colleague's or a guest's who appears in their inbox.
- A seat, a hotel or a car class may reflect price, availability, someone else or a one-off. One occurrence is a hint for
  the search, not a standing preference.
- Keep a pattern tied to the place or group it came from.
- Never show unrelated email, or any confirmation, ticket, loyalty or booking number you came across while doing this.
- Don't search the whole inbox: every query has a reason tied to this trip.
- Access to their accounts is never permission to book or spend.

When they tell you a lasting preference outright ("I always want an aisle", "no red-eyes"), save it with `remember`. Don't
save identity details (legal names, dates of birth, passport, loyalty or traveller numbers) to memory or files.

## Ask little, and well

Ask only for the smallest set of missing facts that really changes the plan, in one short message, with a sensible default
where you can offer one. No fixed questionnaire. If they asked to be interviewed about the trip, use `interview`.

## Places worth showing

When you recommend a real destination, area, hotel, restaurant, sight or venue, pin down the exact place first (the
places-search skill), and link its name to its official page or a map link. In a file, a photo per recommended place helps,
following the artifacts skill's photo rules: the exact place, real, free-licensed or the venue's own, credited. A photo is
mood, never evidence of hours, condition, availability or price. When no trustworthy photo exists, leave it out.
