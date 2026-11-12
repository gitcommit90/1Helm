# Places and maps

Read this when a file names places (a trip plan, a venue list, an office guide) or shows routes or data by location.

You have no map service: no place database, no map tiles, no static map images. So a file shows places as a well-made list with
links that open each place in the reader's own map app, and draws a map only when you hold trustworthy coordinates, plotted
yourself with no basemap. Don't fetch tiles or screenshots of map sites to paste in.

## Getting place facts right

- Look places up with `web_search` and read the place's own page or a reliable listing with `fetch_url`: the official site for
  hours and prices, a city or tourism board for transit. Take facts from what you read, not from memory.
- Record for each place what the file will show: name, street address, area, hours, price, nearest transit, phone, website.
  Leave a field out rather than guess it.
- Never invent an address, a neighbourhood, a drive or walk time, opening hours, or coordinates. Times between places come from a
  source you read, or they're left out.
- A place they named stays in, even if you couldn't confirm details: list it with what you know and a map search link.
- A place you found that turns out closed permanently or doesn't match the request is dropped, not plotted.
- Show scheduled hours as written ("Daily 6:00-18:00"), never "open now": a file goes stale, a schedule doesn't.
- Keep the data in `.src/places.json` (one object per place with the fields above plus the source URL), and build the file from
  it. A later edit reads it again instead of looking everything up afresh.

## Presenting places

- A numbered list or table: name, one line on why it's there, then the practical facts the reader needs on the day (address,
  hours, cost, transit). A travel guide gives complete addresses, hours, prices, nearest station and phone numbers as real text,
  not inside an image.
- A map link per place, built from the name and address, which every phone opens in its map app:
  `https://www.google.com/maps/search/?api=1&query=<URL-encoded name and address>`, or with coordinates
  `https://www.openstreetmap.org/?mlat=<lat>&mlon=<lng>#map=17/<lat>/<lng>`. In a PDF and a Word file the link sits on the
  place name or address; in a web page, on a small "Map" link next to it.
- Directions between two places: `https://www.google.com/maps/dir/?api=1&origin=<encoded>&destination=<encoded>` (add
  `&travelmode=transit` or `walking` when that's how they'll go).
- Photos of a place follow the image rules in the skill: real, free-licensed or theirs, credited.

## Drawing a map from coordinates

Only when you hold coordinates you can trust: from the person, from a file they gave you, or printed on the place's official page
(not guessed from a town name). Then draw a simple locator figure with matplotlib in `.src/`:

- Plot the points with numbered markers matching the list, keep latitude and longitude named in your data (`lat`, `lng`) and
  convert only at the plot (x = lng, y = lat), with an equal-area-looking aspect (`ax.set_aspect(1 / cos(mean_lat))`).
- Pad the bounds around the points, label each marker with its number (the names live in the list beside it), add a small scale
  note if distances matter, and no basemap. Optionally draw a route as a line in visiting order.
- Size and place it like a chart (the charts reference) and keep the place list beside it: the figure locates, the list informs.
- With no trustworthy coordinates, there's no figure: the list with map links is the whole answer, and that's fine.

## Data by location

For numbers tied to regions (sales by state, visitors by country), a ranked bar chart usually reads better than a map you'd have
to draw without boundaries. Use the charts reference. Say plainly in your reply if a proper shaded map would need a tool you don't
have, rather than approximating one.
