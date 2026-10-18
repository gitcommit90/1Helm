# Web pages

A web page here is static: one HTML file (or a folder with an index.html) that you build, check, and share. There is no server
behind it, so everything it shows is in the file when you share it (current data is a dated snapshot: the live-data reference).

This reference is for a page you share from here. When the person wants a website or landing page live on their own domain (a domain they bought or own, or a public address of their own), read the `business-setup` skill first and do the hosting through Cloudflare MCP as it says; use this reference only for building the page itself. Never use GitHub or an API-key Cloudflare toolkit for that.

## Build

1. Project folder `/workspace/workspace/<slug>/`. You write `.src/page.html`, with data in `.src/data.json` when there are
   numbers or lists and photos in `.src/media/` (real and credited, per the skill's image rule), linked by relative paths.
2. The page you ship is one self-contained file: the CSS in a `<style>` block, any script in a `<script>` block, images embedded
   as data: URIs. `python3 /opt/1hc/skills/artifacts/scripts/embed_assets.py .src/page.html .src/index.html` (run in the
   project folder) builds `.src/index.html` from your page, embedding its local images and stylesheets and shrinking photos to
   2000 px (`--max-px 1600` for a lighter page). Edit `page.html`, never `index.html`, and run it again after every change. A
   page over about 5 MB is too heavy to open on a phone.
3. The page includes `<!doctype html>`, `<html lang>`, `<meta charset="utf-8">`, `<meta name="viewport"
   content="width=device-width, initial-scale=1">`, a real `<title>`, and a short `<meta name="description">`.
4. Design for the phone first, then widen: one column under about 700 px, `max-width` on text (about 70 characters a line),
   images `max-width: 100%`, tap targets at least 44 px, no horizontal scrolling at 390 px wide. Define colours and fonts once as
   CSS variables on `:root` and use them everywhere; give `body` an explicit background and text colour.
5. Fonts: name an installed family first and end the stack with a generic one, e.g. `font-family: Inter, "Noto Sans",
   system-ui, sans-serif`. A reader's phone won't have Inter, so either accept the fallback or embed the font file into the page
   as an `@font-face` with a data: URI (only for one or two faces; each costs 50-300 KB).
6. Charts are inline SVG built from the page's one data array (the charts reference). Maps are a place list with map links (the
   maps reference).
7. Scripts are fine for interaction (tabs, a filter, a toggle), but the page must be complete with no interaction: everything the
   person asked for is visible on first load. A published page runs sandboxed: no cookies or localStorage, so don't build anything
   that needs them to remember state.
8. No data fetched when the page opens, no trackers, no analytics, no third-party widgets. A video from YouTube can be embedded with
   its official `https://www.youtube.com/embed/<id>` iframe; anything else from a social site gets a plain link out instead.

## Check

Render the page at desktop and phone width and run the gates:

```sh
S=/opt/1hc/skills/artifacts/scripts; D=/workspace/workspace/<slug>
node $S/render_audit.mjs --html $D/.src/index.html --full-page --viewport 1280x800 --png-dir $D/.src/validate/desktop \
  --require-text-floor --hermetic --gate --report-out $D/.src/validate/desktop.json
node $S/render_audit.mjs --html $D/.src/index.html --full-page --viewport 390x844 --png-dir $D/.src/validate/phone \
  --require-text-floor --hermetic --gate --report-out $D/.src/validate/phone.json
python3 $S/page_check.py --kind web $D/.src/validate/desktop $D/.src/validate/phone
python3 $S/readback.py $D/.src/index.html
```

`--hermetic` blocks every network request, which is how the page must work: if something only shows when the network is on, it
isn't embedded yet. A failing report lists console errors, broken images and elements wider than the screen; fix them in the
source and run again. At phone width, a page that scrolls sideways usually means a fixed width, a wide table or a long
unbroken word: let tables scroll inside their own box (`overflow-x: auto` on a wrapper) and give long words `overflow-wrap: anywhere`.
At most three fix rounds, as in the testing reference.

## Share

Copy the checked file (the built `index.html`) to the deliverable path and share it:

```sh
cp /workspace/workspace/<slug>/.src/index.html /workspace/workspace/<slug>/<slug>.html
```

Then `share_file` with that path and a human name ("Kyoto trip plan.html"). Its card in the chat offers Share file and Publish:
Publish puts it live at the person's own web address, and nothing is public until they tap it. You can mention that in one line.
If the page loads files from its folder instead of embedding them, share the folder's page and use `publish_page` on the folder.
When you change a published page, share the same path again: the Library file and its live page both update at the same links.
