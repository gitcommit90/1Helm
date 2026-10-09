# PDFs

A new PDF is written as one HTML page with print CSS and rendered by Chrome through the render script. The HTML in
`.src/` is the editable truth for every later change; the PDF is always rendered again from it, never patched.

**The build, in order** (about ten steps; this page and pdf-design are all a new PDF needs):
1. Plan the sections from what the person asked; look up only what you don't know (well-known facts need no research).
2. In ONE step, side by side: the photos, in one command: `python3 /opt/1hc/skills/image-search/scripts/images.py fetch --to /workspace/workspace/<slug>/.src/media "hero=<exact subject>"`.
3. and `/workspace/workspace/<slug>/.src/page.html` in one `write_file` (the photo is `media/hero.jpg`; `.src/OUTLINE.md`, a few lines, is a third call in the same step; page setup below; one `.page` per sheet; images as `media/<file>`).
4. `bash /opt/1hc/skills/artifacts/scripts/make_pdf.sh /workspace/workspace/<slug>`: on FAIL fix what it names and run it again.
5. On PASS read the text it printed, then `share_file` the PDF.

| What you need | Read |
|---|---|
| How the page should look (type, colour, layout, images) | `read_skill("artifacts", "pdf-design")` |
| What the words say: outline, headings, tone, the read-back | `read_skill("artifacts", "prose")` |
| The document has a chart | `read_skill("artifacts", "charts")` |
| The document shows places or a map | `read_skill("artifacts", "maps")` |
| Reading, merging, splitting, filling or stamping a PDF that already exists | `read_skill("artifacts", "pdf-existing")` |
| The checks before sharing (every kind) | `read_skill("artifacts", "testing")` |

## The project folder

```
/workspace/workspace/<slug>/.src/page.html       the page you write (relative image paths: media/hero.jpg)
/workspace/workspace/<slug>/.src/index.html      page.html with every image embedded (made by embed_assets.py; never edit it)
/workspace/workspace/<slug>/.src/media/          photos, chart PNGs, SOURCES.md (where each photo came from, author, licence)
/workspace/workspace/<slug>/.src/OUTLINE.md      the argument, one claim per section (see prose)
/workspace/workspace/<slug>/.src/validate/       page PNGs from the last check (wiped and rewritten each time)
/workspace/workspace/<slug>/<slug>.pdf           the deliverable
```

When the page is built from data (a budget, a schedule, a price list), keep the data in a file in `.src/` and write a
small script that turns it into `page.html`, so every number on the page comes from that one file. Charts are made the same
way (matplotlib, from the same data file), saved as PNGs in `.src/media/`.

## Rules for the source

- Every image travels inside the file. Write ordinary relative paths in `page.html` (`<img src="media/hero.jpg">`,
  `url('media/texture.jpg')`), then embed them:
  `python3 /opt/1hc/skills/artifacts/scripts/embed_assets.py .src/page.html .src/index.html`. It turns each local image into
  a data: URI (photos are resized to at most 2000 px on the long side and saved as JPEG, so the PDF stays small) and inlines
  local stylesheets. No http(s) or file:// image references: download a picture into `.src/media/` first.
- Photos must stay sharp in print. The image gate fails a photo shown wider than its own pixels and warns below twice its
  shown width. A page-wide hero needs about 1400 px or more; find a bigger original rather than stretching a small one.
- One accurate image per idea. Leave an image out rather than reuse one that doesn't match.
- Real photos only, from the person or a free-licensed source, recorded in `.src/media/SOURCES.md` and credited on the page
  (author, licence, where from). Never a picture of a chart: charts are drawn from data (see charts).
- Before rendering, check completeness: if a table or schedule names six items, the body has six matching entries.
- No emoji: many PDF font stacks print them as boxes. Use plain hyphens instead of unusual dash characters (non-breaking
  hyphen and similar); en dashes in ranges are fine in Inter, Noto and Liberation, but confirm any unusual character in the
  page check, never assume it.
- Fonts are installed ones, checked with `fc-list : family`. Good choices: Inter, Noto Sans/Serif, Liberation Sans/Serif,
  IBM Plex Sans/Serif, Source Serif 4, and for headings Fraunces, Playfair Display, DM Serif Display, Space Grotesk. DejaVu
  is installed but plain; never name Arial, Calibri, Georgia or Times New Roman (they aren't there, and the page silently
  falls back), and never import Google Fonts.
- Never turn off TLS certificate checks to make a download work.

## Page setup

`page.html` has a doctype, `lang`, charset, viewport, a descriptive `<title>` (it becomes the PDF's title), and one print
`<style>` block. Start from this and change only what the design needs:

```css
@page { size: A4; margin: 0; }            /* Letter for US readers: size: letter, and min-height: 11in below */
* { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
body { margin: 0; font-family: 'Inter', 'Noto Sans', sans-serif; font-size: 10pt; }
.page { min-height: 297mm; padding: 14mm; }
.card, section, figure, table { break-inside: avoid; page-break-inside: avoid; }
img { display: block; width: 100%; max-width: 100%; height: auto; max-height: 8cm; object-fit: contain; }
.card, section { display: flow-root; }
```

- One `.page` element per sheet. Its padding is the margin: keep at least 12 mm between content and the paper edge, and
  don't add `@page` margins for it. The wrapper must fit the paper it declares (`min-height: 297mm` for A4, `11in` for
  Letter, with `box-sizing: border-box` so padding sits inside). For a fixed one-pager, set `height` too.
- Keep `object-fit: contain` for charts, maps, diagrams and screenshots. With a `max-height`, `cover` crops the image to fill
  its box and silently cuts off axes, labels and legends, and no gate notices, because a cropped image doesn't overflow.
  Use `cover` only for a decorative photo you mean to crop.
- Avoid full-bleed covers: they stretch small photos and crop content. Use an in-page hero unless the design really calls
  for bleed and the photo's pixels cover the whole page.
- Type: body 10pt or larger, nothing anywhere below 8pt, visible gaps between blocks (3 mm or more). When content doesn't
  fit, cut it or let it flow to another page; never shrink it.

## Build and check (one command)

```sh
bash /opt/1hc/skills/artifacts/scripts/make_pdf.sh /workspace/workspace/<slug>
```

It embeds every image (`.src/page.html` → `.src/index.html`), renders `<slug>.pdf` in Chrome with no network (the CSS
`@page` size, a tagged PDF with bookmarks from the headings), runs the PDF gates, checks the PDF itself and writes a PNG of
every page, runs the automatic look (page_check) and reads the text back. It ends with **PASS** (the file, the share line
and the text, page by page) or **FAIL** (the step, what failed, the fix). Options: `--fonts "Inter:400,Inter:600,Fraunces:600"`
(every family and weight the design uses; by default each family named in page.html at 400) and `--page-selector ".page"`
(your page wrapper). Never cat or sed the scripts; each prints its usage with `--help`.

What the gates fail on, and the fix:
- content overflows its canvas, or a page is taller than the page box: cut content, let it flow, or move a section to the
  next `.page`.
- text below the 8pt floor: you shrank text to fit; put it back and cut content or add a page.
- images render wider than their own pixels: find a larger image or show it smaller.
- a broken image, a console error or a missing local file: the message names it.
- page_check: a blank page (usually a trailing page break) or content cut off at the paper edge. Its warnings (a mostly
  empty page, an empty image box, two identical pages) are questions to answer: a flat box where a photo belongs is a
  missing image.

Advisories never block, but act on the real ones: a font that didn't render (misspelled or not installed; choose another
installed face), most text below the 10pt body target, markup printed as body text.

On PASS read the text it printed in full against `.src/OUTLINE.md` (see prose): every section present and saying what it
promised, headings that tell the argument, the right page count, page numbers and headers where the document type expects
them, names, numbers and dates matching the data, no tool names or process notes, nothing invented to fill a gap. A page
that passes every gate but reads badly has failed.

Common fixes: remove a trailing page break that makes a blank last page; raise or drop an image's `max-height` when a chart
prints too small to read; `display: flow-root` or a wrapper for collapsing margins; a CSS background for a cover image;
an installed family in place of a missing one. Content cut from the edges of an image (not the image split across pages)
is `object-fit: cover` cropping it.

The steps it runs, for reference (you don't run them by hand): /opt/1hc/skills/artifacts/scripts/embed_assets.py,
/opt/1hc/skills/artifacts/scripts/render_audit.mjs, /opt/1hc/skills/artifacts/scripts/validate_pdf.sh,
/opt/1hc/skills/artifacts/scripts/page_check.py, /opt/1hc/skills/artifacts/scripts/readback.py.

## The fix loop

Fix in `.src/page.html` (or the script that writes it) and run make_pdf.sh again. At most three rounds. If something still fails, don't share it: tell the person exactly what fails and ask how to go on (a shorter
version, two pages instead of one, dropping a part). Never share while a gate fails.

## Share

`share_file` with path `/workspace/workspace/<slug>/<slug>.pdf` and a readable name ("Kyoto trip plan.pdf"). One line about
what it is is enough.

## Revising a PDF you made

The PDF is a render, not the source. Open `.src/page.html` (and the data and scripts beside it), change what was asked there,
and run make_pdf.sh again. Carry every section the PDF has through the change unless they
asked to drop it. Cutting is a normal edit when they ask to shorten or hit a page count: remove whole sections on purpose and
keep the rest as it was. What is never acceptable is content lost because you rewrote the document from memory. Never write a
new document from scratch for an edit, and never put a second PDF beside the original: share the same path again so the
Library file gets a new version. If `.src/` is missing for that file, say so and ask; rebuilding from the PDF silently loses
whatever the source held. A PDF the person gave you has no `.src/`; that is `read_skill("artifacts", "pdf-existing")`.

## Content checks by type

Use only the ones that fit:
- **Reports:** a summary up front that states the findings, page numbers, readable charts, tables with headers.
- **Data exports:** the data source, when it was pulled, what filters were applied, and record counts. Spot-check values.
- **Invoices and receipts:** every required field, money to two decimals, subtotal, tax and total that add up.
- **Travel plans and guides:** full addresses, opening hours, costs and nearest transit where you have them, as real text.
- **Résumés:** selectable text in reading order; one column when it must pass applicant-tracking systems.
- **Manuals:** version and date, a table of contents, figure captions, code blocks that keep their indentation.
