# Slide decks

A deck is one small HTML file per slide plus a shared `deck.css` and a `deck.json` listing the slides in order. Two
commands do all the machinery: `new_deck.mjs` sets the deck up (style plan, the whole design system, one skeleton file per
slide), and `make_deck.sh` builds, checks and exports it. Your work is the content: the plan, the photos, the words on each
slide. This page is all a new deck needs; don't read the scripts (each prints its usage with `--help`).

## Three rules for every slide

1. **Sentence case everywhere**, stat labels included. No `text-transform: uppercase`, no `letter-spacing`.
2. **No slide furniture.** Pills, subtitles, summary lines, eyebrows, kickers, badges, chips, tags and captions don't go on
   a slide. The point of a slide goes in its heading.
3. **The cover is the deck title over its hero photo, and nothing else.** No subtitle, date, tagline, logo row or button.

## The build: five steps

Folder: `/workspace/workspace/<slug>/` (short kebab-case, named for the deck: `kyoto-in-three-days`). `P` below is that
folder. Slide count: an exact number from the person is the count; a range means its midpoint, rounded down; no number:
what the content needs, usually 6 to 10. The cover and the closing count as slides.

### 1. Plan, then set up (one command)

Before the plan, call the design tools (`inspo_recommend` with a brief of what it is, who it is for and the mood for references, and the artifacts skill's other design tools for tokens and rules). Pull a few references that match the kind of thing and the audience, choose one direction (layout, palette, type pairing), and build from it. Put the direction you chose (its mood, palette and type) in the `--brief` below, and when the slides are built, compare the rendered slide images with those references. If a tool errors or returns nothing, build without it and don't mention it to the person. (1Helm also appends a design brief to the result of your first `.html` slide write.)

{{#better_design}}Use Better Design for a palette and type pairing (`better_design_find_design_system`), `better_design_get_ux_principle` for how to lay out a slide's message, `better_design_get_motion_guide` for any animation and `better_design_get_review_rules` before you finish, and React Bits or Canvas UI (`reactbits_searchRegistryItems`, `canvasui_searchRegistryItems`, then the matching `getRegistryItem`) for a background or text effect to port into the slides' own HTML and CSS. All of them are tools in your tool list, as the artifacts skill's list describes.{{/better_design}}{{^better_design}}Use React Bits or Canvas UI (`reactbits_searchRegistryItems`, `canvasui_searchRegistryItems`, then the matching `getRegistryItem`) for a background or text effect to port into the slides' own HTML and CSS. They are tools in your tool list, as the artifacts skill's list describes.{{/better_design}}

Decide the arc first: one line per slide, its id and the claim it makes, the cover first and the closing last. Every fact
comes from the person or a source you actually read; nothing is invented to fill a slide. Then:

```sh
node /opt/1hc/skills/artifacts/scripts/new_deck.mjs /workspace/workspace/<slug> --title "<deck title>" --brief "<their request, plus any look they asked for>" --slides cover,<id>,<id>,...,closing
```

Ids are kebab-case (`day-1`, `budget`), never `index`. It picks the style plan (theme, palette, the two fonts, a layout per
slide, two lockups) into `.src/style_plan.json`, writes `.src/slides/deck.css` (the theme and every layout, finished: don't
rewrite it), `.src/slides/deck.json`, and a skeleton `.src/slides/<id>.html` per slide, and prints each skeleton. Words in
the brief steer the theme ("dark", "minimal", "playful", the topic).

### 2 and 3 go in ONE step: the photo command and every slide's `write_file`, side by side

The photo names are fixed by the skeletons, so the slides can be written while the photos download. If a photo can't be
found, make_deck.sh names it in step 4: fetch it with other words, or drop that `<img>`.

### 2. Photos (one command)

Every deck has real photos: the cover hero and a photo on each content slide it really illustrates. Name each file after
its slide, as the skeletons do (`media/<id>.jpg`; a gallery `media/<id>-1.jpg`, `-2`, `-3`):

```sh
python3 /opt/1hc/skills/image-search/scripts/images.py fetch --to /workspace/workspace/<slug>/.src/media "cover=<the deck's main subject>" "<id>=<exact subject>" ...
```

It searches openly licensed collections, picks the best-matching wide photo (the cover at 1600 px or more), downloads it as
`<name>.jpg`, and records each photo's credit in `.src/media/SOURCES.md`. Photo credits go in the speaker notes, never on
a slide: make_deck.sh puts each photo's credit in the notes of the slide that shows it. Use exact subjects ("Kiyomizu-dera Kyoto",
not "temple"). A name it can't fill: try other words once, or drop that photo from the slide. The person's own photos
(`/workspace/files`) come first when they fit: copy them into `.src/media/` under the slide's name (no credit needed).

### 3. Write each slide (replace every FILL IN), in the same step as the photos

Write every slide file in ONE step: one `write_file` per `.src/slides/<id>.html`, all in the same message, each in full, keeping
the skeleton's head, class names and `media/` names. No credits line on any slide.
Everything you need is in what new_deck.mjs printed: don't open deck.css, deck.json or style_plan.json.

What goes on a slide:
- One message per slide, stated in the heading as a **claim, not a topic** ("Lodging is half the budget", not "Budget").
  Headings are short and carry no figures. The biggest thing on the slide is the proof.
- At most about five bullets of one line each, or three or four cards or steps. More gets cut or split, never shrunk.
- At most three headline numbers, only real ones. Never invent numbers, dates, quotes or source names.
- Colours and fonts come only from `deck.css` (the `--slide-*` tokens). No `style=` colours, no `#` colours or `rgb(` in a
  slide file except the cover's `--hero-scrim-color` (a dark tone from its photo). No scripts, iframes, forms or links.
- A slide's own `<style>` (rare) has every selector start with the slide's id (`#budget .chart`); everything else is refused.

The layouts (the skeleton already has the one the plan chose; switch when the content wants another, copying its markup):

| Section class | Holds |
|---|---|
| `cover` | the title over the photo set in the cover's own `<style>` (`background-image: url('media/cover.jpg')`) |
| `slide-steps` | `.text` → `h2` + `ol.steps` of `li` = `span.when` + `div` (`h3` + one-line `p`); a time or step order, left-aligned |
| `slide-two-column` | `img.photo` + `.text` (`h2`, `p.lead`, `ul.points`) with a lockup class; without a photo, `.text` → `h2` + `div.cols` of two `div`s |
| `slide-headline-bullets` | `.text` → `h2` + `ul.points` (at most five) |
| `slide-hero-stats` | `.text` → `h2` + `div.stats` of up to three `div.stat` (`b` number, `span` label); add `has-chart` and an `img.chart` beside it |
| `slide-comparison` | `.text` → `h2` + `div.cols` of two `div`s (`h3` + `ul.points`) |
| `slide-statement` | `.text` → one `h2` statement + an optional `p.lead`; centred |
| `slide-gallery` | `.text` → `h2`, then `div.photos` of two or three `img.photo` |
| `slide-bento` | `.text` → `h2`, then `div.bento`: one `img.photo` + two to four `div.cell` (`h3` + `p`, or `b` number + `p`) |
| `closing` | `.text` → `h2` + `p.lead` |

**Lockups** put a photo beside text on any content layout: add `lockup-l1` (photo left), `lockup-l2` (photo right) or
`lockup-l4` (a 60/40 photo panel, edge to edge) to the section, with an `<img class="photo" src="media/<id>.jpg" alt="...">`
next to the `.text` div. Use the two the plan names. Photos go only where they show the slide's subject: no photo on a
number, statement or money slide. Five or more slides use at least three layouts, and at most 40% are a heading plus one list.

A chart: a matplotlib script in `.src/` that reads the data file and the palette from `.src/style_plan.json` and saves
`.src/media/<id>-chart.png`, shown as `<img class="chart" src="media/<id>-chart.png" alt="...">` (see the charts reference).
Never a CSS- or SVG-drawn chart.

### 4. Build and check (one command)

```sh
bash /opt/1hc/skills/artifacts/scripts/make_deck.sh /workspace/workspace/<slug>
```

It embeds photos and fonts, assembles `.src/index.html`, renders every slide and runs the gates (overflow, fill, the
restraint rules, the cover photo, text size, fonts), the automatic look (page_check), exports `<slug>.pptx` and reads the
text back. It ends with **PASS** (the file, the share line, the slide text) or **FAIL** (the step, the slide, the fix).
On FAIL change only what it names in the slide file, then run the same command again; at most three rounds, then tell the
person exactly which slide fails which check and ask how to go on. `--pdf` or `--html` also writes a PDF or an HTML copy,
only when the person asked for one. `--no-cover-image` only when no fitting cover photo exists (say so in your reply).

On PASS, read the slide text it printed against your plan: the right count, every planned claim, headings that read as the
argument in order, no repeated point, no invented fact.

### 5. Share

`share_file` with path `/workspace/workspace/<slug>/<slug>.pptx` and a readable name ("Three days in Kyoto.pptx"). One line:
what the deck covers and how many slides. The slides are pictures of the checked render, so their text isn't editable in
PowerPoint: say so if they expect to edit it, and offer to make changes for them. A later change edits the slide files,
runs make_deck.sh again and shares the same path (see deck-editing). If the .pptx can't be built, say so and ask whether a
PDF or a web page would do; don't quietly hand over another format.

## When you need more

| Task | Read |
|---|---|
| Change an existing deck | `read_skill("artifacts", "deck-editing")` |
| A slide plots numbers | `read_skill("artifacts", "charts")` |
| A slide shows places | `read_skill("artifacts", "maps")` |
| A layout the table above doesn't cover (custom CSS in a slide) | `read_skill("artifacts", "deck-authoring")` and `read_skill("artifacts", "deck-design-system")` |
| Choosing between photos with care | `read_skill("artifacts", "deck-images")` |

## The scripts (run them; never cat or sed them; each has `--help`)

| Command | What it does |
|---|---|
| `node /opt/1hc/skills/artifacts/scripts/new_deck.mjs <P> --title "..." --slides ...` | Style plan, deck.css from /opt/1hc/skills/artifacts/scripts/deck_template.css, deck.json and skeletons from /opt/1hc/skills/artifacts/scripts/deck_layouts.html |
| `python3 /opt/1hc/skills/image-search/scripts/images.py fetch --to <P>/.src/media "<name>=<subject>" ...` | Finds, downloads and credits the photos |
| `bash /opt/1hc/skills/artifacts/scripts/make_deck.sh <P>` | Everything from embedding to the .pptx and the read-back, with PASS/FAIL |

make_deck.sh runs, in order: /opt/1hc/skills/artifacts/scripts/inline_media.py, /opt/1hc/skills/artifacts/scripts/embed_deck_fonts.mjs,
/opt/1hc/skills/artifacts/scripts/assemble_deck.mjs, /opt/1hc/skills/artifacts/scripts/render_audit.mjs,
/opt/1hc/skills/artifacts/scripts/page_check.py, /opt/1hc/skills/artifacts/scripts/build_pptx.py and
/opt/1hc/skills/artifacts/scripts/readback.py. You don't run those by hand for a deck.

## Done means all of this holds

- The slide count is the count you settled; the slides tell one story in order.
- Every slide except an appendix has something to look at: a photo, a chart, steps, big numbers or a strong type layout.
- Every photo is embedded and has its row in `.src/media/SOURCES.md` (its credit lands in that slide's speaker notes; none
  is printed on a slide); unused files in `.src/media/` are deleted.
- make_deck.sh printed PASS after your last edit, and the .pptx you share is the one it built.
