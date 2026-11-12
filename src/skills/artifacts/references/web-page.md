# Web pages

A web page here is one HTML file (or a folder with an index.html) that you build, check, and share. Its design and text are in the
file. When the person publishes it, the page can also save and load data of its own (orders, games, sign-ups), as the "Saving data"
section below describes. Current outside facts are still a dated snapshot in the file (the live-data reference).

This reference is for a page you share from here. When the person wants a website or landing page live on their own domain (a domain they bought or own, or a public address of their own), read the `business-setup` skill first and do the hosting through Cloudflare MCP as it says; use this reference only for building the page itself. The page goes live as a Worker script with the finished page embedded, written as a file on your computer and sent with `code: {"file_text": "<path>"}` to `CLOUDFLARE_MCP_EXECUTE`, as business-setup describes. Never paste the page into a code string and never pass a path as content. Never use GitHub or an API-key Cloudflare toolkit for that.

## Build

0. **Design sources.** First call the design tools: `inspo_recommend` with a brief of what it is, who it is for and the mood returns real-site references (with URLs and screenshots) and one direction, and the tools below give `:root{}` tokens, a few rules and component source. Choose one direction, paste its `:root` tokens into the page, and build from it. 1Helm also appends a design brief to the result of your first `write_file` of an `.html` file, so read it too. Before sharing, compare your desktop and phone screenshots with those references and fix what is weaker. If a tool errors or returns nothing, build without it and don't mention it to the person.
   Use the other sources as the artifacts skill's list describes: {{#better_design}}Better Design for a design system (`better_design_find_design_system`), `better_design_get_ux_principle` and `better_design_get_ui_principle` before you style, `better_design_get_motion_guide` for animation, `better_design_find_icons` for icons and `better_design_get_review_rules` to check the page before sharing, and {{/better_design}}Magic UI, React Bits and Canvas UI (`magicui_searchRegistryItems` then `magicui_getRegistryItem`, and the same two tools with the `reactbits_` and `canvasui_` prefixes) for component and animation source to port into the page. Inspo has its own tools too (`inspo_search_screens`, `inspo_get_screen`). All of them are in your tool list; call them directly.
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
   person asked for is visible on first load. A published page runs sandboxed: no cookies or localStorage. When the page has to
   remember something (a game, an order list), save it with the page's own data address, as the "Saving data" section says.
8. No outside data fetched when the page opens (the page's own saved data from `./_data/` is the one exception), no trackers, no analytics, no third-party widgets. A video from YouTube can be embedded with
   its official `https://www.youtube.com/embed/<id>` iframe; anything else from a social site gets a plain link out instead.

## Saving data (published pages only)

A published page has a small data store of its own. Anyone who has the page link can read and write it, like a Google Form: there is
no sign-in and no passcode, so never save anything secret and never trust what is loaded (put it on the page with `textContent`,
never `innerHTML`). It works only after the person taps Publish, at the page's own address. Use relative addresses so it works at
any link. A collection is a name you choose (lowercase letters, numbers, dashes), and each entry is any JSON up to 64 KB:

```js
const API = "./_data/orders";                                   // collection "orders"
const list = async () => (await (await fetch(API)).json()).entries;   // [{ id, data, created_at, updated_at }], oldest first
const add = (data) => fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json());   // returns { id, data, ... }
const put = (id, data) => fetch(`${API}/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });       // your own id, e.g. a game code
const get = async (id) => { const r = await fetch(`${API}/${id}`); return r.ok ? (await r.json()).data : null; };                                     // 404 when nothing is saved
const del = (id) => fetch(`${API}/${id}`, { method: "DELETE" });
```

- Check `r.ok` on every save and show `(await r.json()).error` in plain words to the visitor (too big, too many saves in a minute, page full).
- Show a clear empty state when nothing is saved ("No orders yet"). The render check below has no network (`--hermetic`), so the page must also look right when `fetch` fails or returns nothing: catch the error and show the same empty state.
- Load the data when the page opens. For two people watching the same game or list, poll every 3 to 5 seconds with `setInterval` and redraw only when it changed. No websockets.
- A game saved so it can be reopened: `put(code, state)` with a short code the visitor sees, and `get(code)` when they type it in.
- Limits: 64 KB per entry, 5000 entries and 25 MB per page, 20 collections, 60 saves a minute from one address.
- The person sees the number of saved entries on the page's card in the Library and can download them or clear them. You can read them with the `page_data` tool when they ask who ordered what.

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
isn't embedded yet (saved data from `./_data/` is the one thing that loads later, so the page shows its empty state in this check). A failing report lists console errors, broken images and elements wider than the screen; fix them in the
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
