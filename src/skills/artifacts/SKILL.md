---
name: artifacts
description: Use when the person wants a file made, changed or checked: a Word document, PDF, slide deck, spreadsheet or CSV, Markdown file or web page (report, plan, letter, invoice, budget, one-pager), or an existing PDF, Word file or workbook filled in, merged or edited.
always: false
---
# Making files people can use

A file you make is finished when it opens cleanly, says what the person needs, and looks designed. That takes the same steps
every time: plan it, build it from a source you keep, render it fresh, check it with the gates, read it back, fix what failed,
then share it. This skill holds the recipe for each kind of file and the scripts that check them.

A new file is a long job: start with a 👍 (`react`) and a short to-do list (`update_todos`: plan, build, check and share) so the
person sees it's under way, then do the work in this same turn without narrating, and hand the file over at the end.

**Every step does real work.** Each step is a full model call, so a file should take about 10 to 20 of them:
- Send the 👍 and the to-do list in the same step as your first real call, and later to-do updates only next to another call
  (the share is a good moment), never as a step of their own.
- Put independent calls in one step: all the slide files, or the source and its data file, as several `write_file` calls in the
  same message.
- After a PASS, don't re-check what the build command already checked; read the text it printed and share.

## Pick the kind, then read only its references

| They want | Kind | Read these (`read_skill` with slug artifacts and this ref) |
|---|---|---|
| A Word document (.docx, .dotx), or one to edit | document | document (editing an existing one: document-editing) |
| A PDF: report, guide, one-pager, invoice, flyer, printable | pdf | pdf and pdf-design, both in one step (an existing PDF: pdf-existing) |
| Slides, a deck, a presentation (.pptx by default) | presentation | presentation (it has everything a new deck needs: read nothing else, not even the image-search skill; editing one: deck-editing) |
| A spreadsheet (.xlsx), a budget, a tracker, a model, or a CSV | spreadsheet | spreadsheet, then spreadsheet-formulas |
| Notes, a README, minutes, text they'll paste elsewhere (.md) | markdown | markdown |
| A web page to open in a browser or publish (to put a site live on their own domain, read the business-setup skill first) | web page | web-page |

Shared references, read only when they apply: prose (what the words say: any document whose value is its text), charts (the file
has a chart), maps (places, routes, addresses), live-data (only when they want real, current numbers: see rule 3), testing (the
checks before sharing; a deck, PDF or Word file's one build command already runs them, so those skip it).

**Read only what this file needs, in one step** (several `read_skill` calls in the same message). The photo command below is all you need for pictures: don't read the image-search skill for a file. Everything you read stays in your context and is paid for again on every later step, and the
references together are far longer than any one file needs. Read your kind's row, plus a shared reference only when it applies,
once each: a spreadsheet budget with a chart is spreadsheet, spreadsheet-formulas, charts and testing, nothing else. Don't read
another kind's references, or one you've already read in this task, "just in case".

**A file is a build, not a research project.** A trip, a plan or a place written up as a file needs this skill and the kind's
references, not travel-planning or places-search (those are for planning the trip itself). What you know well (famous sights,
which area they're in, a sensible order) goes straight in; look up only what you don't know or what changes (hours, prices), with
one `web_search` and at most two pages, read once. Don't browse other projects' folders, earlier tasks or the work log for
material; start this file's own folder. Then build: the kind's one command does the rest.

When the person names a format, make that format. When they don't, pick the one that fits how they'll use it: something to
print or send as is → PDF; something they'll edit → Word; numbers they'll work with → spreadsheet; something to present →
deck; something to open on a phone or share as a link → web page. Ask only when the choice really changes the result.

## Rules for every file

1. **One folder per file.** Work in `/workspace/workspace/<slug>/` (slug: short, lowercase, hyphens, named for what it is).
   Sources go in `/workspace/workspace/<slug>/.src/`; the finished file is `/workspace/workspace/<slug>/<slug>.<ext>`.
2. **Keep the source, rebuild the file.** The generator script (python-docx, openpyxl), the HTML (PDF, deck, page) or the
   Markdown in `.src/` is the editable truth. Every change goes into the source and the file is rebuilt from it. Never patch the
   finished binary, and never rebuild from memory: a change starts from the source that's there.
3. **Real content, and estimates said to be estimates.** Facts about the person and the world (names, dates, addresses,
   quotes, results) come from the person, their files, or a source you actually read; one you don't have is a blank, a question,
   or a visible "not known yet", never a plausible guess.
   - An **illustrative or planning file** ("a sample budget", "a small trip budget", a template, an example plan) where they
     didn't ask for real or current figures: use reasonable estimates from what you know, label them as estimates on the file (a
     note under the table, an "estimate" column or a cell comment), and build the file first. Don't research prices for it. Say
     in your reply which numbers are estimates, and offer to swap in real ones. A guide, itinerary or plan from a brief ("a
     relaxed 3-day Kyoto trip") is a planning file too: well-known facts (famous sights, which area they're in, a sensible
     order) need no source and no research; hours and prices are left out or marked approximate.
   - **Real numbers**: look up live data (the live-data reference) only when they ask for real, current or exact figures, or the
     file is clearly meant to be factual (a report on real data, a price comparison, today's rates).
   - Numbers shown in two places (a table and a chart, a deck and a sheet) come from one data file that both read.
4. **Their direction wins.** Colours, fonts, length, tone, page size, file name: what they asked for beats every default here.
5. **Check before sharing.** Run the kind's gates, then the look and the read-back from the testing reference. Never share a
   file while a gate fails. Fix and re-run at most three times; if it still fails, tell them exactly what fails and ask how to
   go on (a shorter version, a different format, dropping a part).
6. **Share it with `share_file`.** Give the finished file's path and a human file name, e.g. name "Kyoto trip plan.pdf". Saving
   it on your computer alone shows them nothing. One line about what it is is enough; don't paste its contents.
7. **Update, don't duplicate.** When they ask for a change, edit the source, rebuild, re-check, and share the same path again:
   the Library file gets a new version at the same links. Make a separate copy only when they ask for one.
8. **Images are real.** There is no image generator. Use their own photos, or real photos from free-licensed sources,
   in one command: `python3 /opt/1hc/skills/image-search/scripts/images.py fetch --to /workspace/workspace/<slug>/.src/media "<name>=<exact subject>" ...`
   (it searches Openverse and Wikimedia Commons, downloads `<name>.jpg`, writes `.src/media/SOURCES.md` and prints a credits
   line). Credit each photo where the licence asks: on a deck in that slide's speaker notes (make_deck.sh does it from
   SOURCES.md), never on the slide; on a PDF, document or page in a small caption. Charts are drawn from data with matplotlib or SVG, never faked.
9. **Fonts are local.** Use fonts installed on your computer (`fc-list : family` lists them). Reliable: Liberation Sans/Serif,
   Noto Sans/Serif, Inter, IBM Plex Sans/Serif, Carlito and Caladea (stand-ins for Calibri and Cambria), and for display type
   Fraunces, Playfair Display, DM Serif Display, Space Grotesk, Manrope, Source Serif 4, Lora, Work Sans, Outfit, Bricolage
   Grotesque, DM Sans, Archivo Black. Never rely on a web font loading or on Microsoft fonts.
10. **Nothing about the making on the page.** No tool names, file paths, prompts, "as requested", notes about your checks, or
   placeholder text. The file reads as if a careful person wrote it for its reader.
11. **Design sources for designed work.** A web page, deck or designed PDF starts from references, and the kind's reference file gives the steps (pick one direction, build from it, compare your screenshots with the references before sharing). The design brief command and the sources are listed below. Use them without mentioning them to the person. If one errors or finds nothing, go on without it. Port any component source into the page's own HTML, CSS and JS, so the page stays one self-contained file (rewrite a React component as plain markup, CSS and script, and embed any library it needs).

The design brief comes first. `python3 /opt/1hc/skills/artifacts/scripts/design_mcp.py brief "<what it is, who it is for, the mood>"` makes one call that gathers the sources below and prints one compact answer: three to five Inspo references (name, URL, screenshot, palette and fonts), one direction, a `:root{}` block of design tokens, a few rules, and components with the command that fetches each one's source. Build from it and paste its `:root` tokens into the page. If you don't run it, 1Helm appends the same brief to the result of the first `.html` file you write in a task. Anything you want beyond the brief comes from the five sources, each called with the same script:

- **Inspo** (same script, server `inspo`): references captured from real production websites: screens, components, color palettes, typography and page structure. Call `recommend` with a `brief` that says what it is, who it is for and the mood. Other tools find components by type (hero, pricing), find sites near a hex color, and return one reference's palette, fonts and type sizes from its slug; `design_mcp.py inspo tools` lists them with their inputs. Use for: choosing a direction, and seeing how strong real sites handle a hero, pricing, navigation or a footer.
- **Better Design** (`python3 /opt/1hc/skills/artifacts/scripts/design_mcp.py better-design tools` lists its tools, and `... better-design <tool> '<json args>'` calls one): more than 30 complete design systems as kits of tokens and components (`find-design-system`, then `get-design-system-kit` with target html, whose output is large, so send it to a file and read only what you use), plus UI and UX principles (`get-ui-principle`, `get-ux-principle`), a motion guide, icons (`find-icons`), review rules, and `extract-from-url`, which pulls the design system out of an existing site. Use for: a coherent set of tokens and components, the spacing, hierarchy and color rules before you style, matching a person's existing brand site with `extract-from-url`, and a review pass (`get-review-rules`) before sharing.
- **Magic UI** (same script, server `magicui`): about 250 items, mostly animated React and Tailwind components and effects such as marquees, bento grids, number tickers and shimmer buttons. Call `searchRegistryItems` with a `query`, then `getRegistryItem` with a `name` and `includeSource` true. Use for: polished section components and small motion details.
- **React Bits** (server `reactbits`, same two tools): about 1,270 items, which are about 320 components in four variants each (animated backgrounds, text animations, cursor and hover effects, and ordinary components). Use for: a hero background or a text effect. Read the `-JS-CSS` variant for a plain HTML page.
- **Canvas UI** (server `canvasui`, same two tools): about 420 canvas, WebGL and 3D components, one variant per framework. Use for: one striking interactive visual (particles, shaders, 3D) when the page calls for it. Read the `-vanilla` variant.

## What's on your computer

Python 3 with python-docx, openpyxl, python-pptx, matplotlib, numpy, pypdf and Pillow; LibreOffice without a screen (`soffice
--headless`); poppler (pdftoppm, pdfinfo, pdftotext, pdfimages, pdfunite, pdfseparate, pdffonts); Chrome, driven by the render
script; Node. For web requests and HTML in your own Python, use the standard library (`urllib.request`, `json`,
`html.parser`), not requests or BeautifulSoup; photos come from images.py, never a hand-written scraper. Anything else
(pandas, say): `python3 -m pip install <name>` when a task really needs it.

## Scripts

Full paths below; each reference gives the exact command lines. **Never cat, sed or head a script to learn how to use it**:
run it with `--help` (a `.py` with python3, a `.mjs` with node, a `.sh` with bash), or follow the reference's command.

A deck, a PDF and a Word document each build and check in ONE command, which prints PASS or FAIL with the fix:

| Command | Kind |
|---|---|
| `node /opt/1hc/skills/artifacts/scripts/new_deck.mjs <P> --title "..." --slides cover,...,closing` then `bash /opt/1hc/skills/artifacts/scripts/make_deck.sh <P>` | presentation |
| `bash /opt/1hc/skills/artifacts/scripts/make_pdf.sh <P>` (after writing `<P>/.src/page.html`) | pdf |
| `bash /opt/1hc/skills/artifacts/scripts/make_docx.sh <P>` (after writing `<P>/.src/build_doc.py`) | document |

The pieces they run, and the rest:

| Script | What it does |
|---|---|
| /opt/1hc/skills/artifacts/scripts/deck_template.css | The design system new_deck.mjs writes into a deck's deck.css (all layouts, lockups, cover, closing) |
| /opt/1hc/skills/artifacts/scripts/deck_layouts.html | The skeleton markup of each slide layout, copied by new_deck.mjs |
| /opt/1hc/skills/artifacts/scripts/render_audit.mjs | Renders HTML in Chrome to PDF and/or PNGs and runs the layout gates (overflow, fonts, page geometry, text size, image sharpness, deck structure); JSON report |
| /opt/1hc/skills/artifacts/scripts/validate_pdf.sh | PDF integrity, page facts, embedded images, and a PNG of every page |
| /opt/1hc/skills/artifacts/scripts/embed_assets.py | Turns an HTML source's local images and stylesheets into one self-contained file (photos shrunk to 2000 px) |
| /opt/1hc/skills/artifacts/scripts/inline_media.py | Embeds a deck's photos from .src/media into the slide files, in place, as data: URIs |
| /opt/1hc/skills/artifacts/scripts/slide_style.mjs | Picks a deck's style plan (palette, fonts, layouts) from the brief |
| /opt/1hc/skills/artifacts/scripts/embed_deck_fonts.mjs | Embeds the deck's fonts into its stylesheet |
| /opt/1hc/skills/artifacts/scripts/assemble_deck.mjs | Checks the slide files against the deck manifest and builds the one combined deck page |
| /opt/1hc/skills/artifacts/scripts/build_pptx.py | Builds the .pptx from the checked slide images |
| /opt/1hc/skills/artifacts/scripts/render_docx.sh | Word, PowerPoint or Excel file → PDF → page PNGs, through LibreOffice |
| /opt/1hc/skills/artifacts/scripts/lo_impress_ui.sh | Lets LibreOffice open slide decks here (render_docx.sh runs it; run it before your own `soffice` on a .pptx) |
| /opt/1hc/skills/artifacts/scripts/recalc_xlsx.py | Recalculates a workbook through LibreOffice and lists every formula error; always runs before validate_xlsx.py |
| /opt/1hc/skills/artifacts/scripts/validate_xlsx.py | Reads a workbook back: archive, sheets, cells, formulas; fails on a formula with no stored result (recalc first) |
| /opt/1hc/skills/artifacts/scripts/page_check.py | The automatic look at page images: blank pages, content cut at the edge, empty slots, duplicates |
| /opt/1hc/skills/artifacts/scripts/readback.py | Prints the finished file's text for the read-back and fails on leftover placeholders |

Modules the scripts load (you don't run these): /opt/1hc/skills/artifacts/scripts/browser_runtime.mjs (starts Chrome),
/opt/1hc/skills/artifacts/scripts/deck_asset_scope.mjs (keeps a render to the file's own folder),
/opt/1hc/skills/artifacts/scripts/pdf_geometry_probe.mjs, /opt/1hc/skills/artifacts/scripts/pdf_geometry_gate.mjs,
/opt/1hc/skills/artifacts/scripts/pdf_text_floor.mjs, /opt/1hc/skills/artifacts/scripts/pdf_image_resolution.mjs (the PDF gates),
/opt/1hc/skills/artifacts/scripts/xlsx_formula_cache.py (keeps formula results after a recalculation).

Renders and recalculations take seconds to a minute. Always pass the report-file option a script offers and read that file:
if a command is cut off, the file says what happened, and silence never means it passed.
