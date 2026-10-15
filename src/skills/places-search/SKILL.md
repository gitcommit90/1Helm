---
name: places-search
description: Use when the person wants real places found, compared or checked: restaurants, cafes, bars, hotels, parks, trails, sights, shops, clinics or local services near them or in a named area, or a known place's hours, address or details.
always: false
---
# Finding places

Find real places that fit, check them, and hand back a short answer with links that open each place in the person's own map
app. Not for building a trip (travel-planning), choosing between cities, dated events or showtimes, or booking a table
(booking).

**What you have.** {{#apps}}Start with live search: `search_web_vertical` with kind places (query: the kind of place or its name; near: a
place name, or "me" for where they are now) returns Google Maps results in one step: rating, reviews, price level, address,
hours and open now, phone, website and a map link. Things to do and sights: kind tripadvisor. Use `web_search` and `fetch_url`
only for what it doesn't show (a menu, a booking page, a local guide's "best of"), or when it found nothing. Built in, no sign-in,
straight with `app_run`: reviews or Yelp named → `YELP_SEARCH_BUSINESSES` (term, location, limit), then `YELP_GET_BUSINESS_DETAILS`
for hours; hikes and trails → `ALLTRAILS_MCP_SEARCH_TRAILS_BY_NAME` or `ALLTRAILS_MCP_FIND_TRAILS_NEAR_LOCATION` (length, gain,
difficulty, rating; `ALLTRAILS_MCP_GET_TRAIL_WEATHER_OVERVIEW` for the trailhead forecast).{{/apps}}{{^apps}}You find places with `web_search`, check them
on their own sites or reliable listings with `fetch_url`, and give map links built from the name and address.{{/apps}} There's no
map widget or routing: directions are links that open their map app (below).

## Where

Search a named area. "Near me", "nearby" and "in my city" mean the place you already know for them. Look before you ask,
in this order:

1. this message or this conversation (a place they named, where they said they are now);
2. the location line that comes with every message: their device's location right now
   (about 1 km, with its time), which "near me", "nearby" and "here" use;
3. what you remember, already in front of you: the pinned notes and the Memory recall that came with this message (home,
   home address, neighborhood, where they're staying this week; "near my house" and "near home" use home); if none of it has a place, look it up with
   `memory_explain` (about: "where they live") before going further;
4. the time zone's region from that same line, as a stated assumption ("Assuming you're around Los Angeles:").

Use what you find and say which area you searched ("Seafood near Rockridge:"), so they can correct it. Where they're
staying now beats home for "near me", and a fresh device location beats both; anything about their home uses home. Put the area's name in the search, never "near me".
Never ask "where are you?" in prose. Ask only when none of these has a location, and then{{#cards}} with the one-tap
Button("Share my location", "share_location", "primary") (their next message's location line has the place){{/cards}}{{^cards}}
in one short line{{/cards}}; never guess a city beyond what these give you. With only a time zone, search its main city, say
so, and offer that button too. One search covers one area: several neighbourhoods or cities get a search each, and each gets
covered in the answer.

## Finding them

- Put the whole intent in the search: the kind of place or its exact name, the area, the radius, and what "good" means
  here ("quiet cafes with wifi in the Mission", "urgent care open Sunday in Bellevue").
- For "best", trending or insider asks, use a few reputable sources (local guides, recent reviews, the city's own pages)
  and ground every named place in a page you read.
- A follow-up like "anything cheaper?" or "Italian instead?" refines the last search.
- Judge the results, don't take the rank blindly: drop the wrong kind of place or the wrong area; if the set is weak, search
  again with an exact name, a narrower type or a clearer area.
- Leave out places closed for good or for now, unless they asked about one.

## Checking the details

{{#apps}}A live search result already holds what you need for each place (name, address, hours, price level, phone, website, map
link): use it as read. {{/apps}}For anything it doesn't show, open the place's own site or a reliable listing with `fetch_url` and take what matters: exact name,
street address, area, opening hours, price level, phone, website. Facts come from what you read, never from memory. Leave a
field out rather than guess it. Hours are as published ("Mon–Sat 8:00–18:00"): say "open now" only after comparing them with
the local time, and say they're the published hours. Dynamic claims (waits, crowds, availability) need a current source;
without one, say they couldn't be checked. A subjective ask ("least crowded", "quietest") is still answered: rank by what
reviews and local guides you read report, and say so ("reported as quieter on weekdays", with the source), rather than
leaving the ranking open. Never invent a travel time or distance: give one only from a source (a transit
operator, a route you looked up).

## Answering

- Match the ask: a recommendation gets two or three; a broad ask gets a few as a starting point, with an offer to narrow.
- One short line framing the answer, then each place on its own line: **its name linked to its official page (or a map
  link)**, and a sentence or two on why it fits. Every place you name, including the "also nearby" ones, gets a link, and
  each gets a map link built from its name and address (below) so it opens in their map app.
- A reported quality (quiet, crowded, kid-friendly) is stated only as the source says it, with that source's link next to it.
- Keep addresses, ratings and review counts out of the text unless they asked; the link carries the details.
- Close by noting there's more if they want it, without listing it.
- Name only places you found and checked in this task.
- State only what a page you read in this task shows: an age range, price, hours, schedule or rule that no page showed stays
  out, or say "not stated on their site". A detail from a similar place, a snippet or memory isn't a fact about this one.
- **Before you send, check it once:** each fact you state (ages, prices, hours, "open now") against the page you read it on.

## Map links

Build them from the name and address you read, URL-encoded:

- one place: `https://www.google.com/maps/search/?api=1&query=<name, street address, city>`
- directions: `https://www.google.com/maps/dir/?api=1&origin=<encoded>&destination=<encoded>` (add `&travelmode=walking`,
  `transit` or `bicycling` when that's how they'll go)
- with coordinates from the place's own page: `https://www.openstreetmap.org/?mlat=<lat>&mlon=<lng>#map=17/<lat>/<lng>`

Never guess coordinates. Don't write turn-by-turn directions: the directions link opens their map app for that. For a list of
places in a file (a guide, an itinerary), the artifacts skill's maps reference covers layout and a drawn locator map.

## A place from a photo

If they attach a photo and ask where it is, describe what you see (signs, landmarks, style) and search for it; offer
candidates with how sure you are, and never claim a match you can't support. Never try to identify a person.
