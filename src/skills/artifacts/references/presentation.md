# Slide decks

A deck is one self-contained HTML file: a fixed 1920x1080 stage scaled to the window, arrow keys, tap and swipe, a full screen
button, a slide counter, and the speaker notes on the N key. Fonts and pictures are inside the file, so it works offline, in the
Library and as a published page. You start from one of 34 finished templates, so the look is already designed: your work is the
story and the words. A .pptx or a PDF is made from the same deck only when the person asks for it (see "Other formats").
Everything a deck needs is in this reference and in what `new_deck.mjs` prints (`new_deck.mjs --show <template> <pattern>...` prints a pattern's full slide markup). Never call a design, inspiration or photo tool, never write your own PowerPoint or PDF builder, and
never open a deck in LibreOffice (the build checks the deck and the PowerPoint itself).

## Steps (a deck of any length is five or six steps)

Folder: `/workspace/workspace/<slug>/` (short kebab-case, named for the deck). `P` below is that folder. A background helper
puts it inside its own work folder, `/workspace/workspace/helpers/<id>/<slug>/` (the only place its files are collected from).
Use full paths; a relative one works too, from the folder you run the command in.

1. **Read** in one step: this reference and `deck-templates` (the list of templates). Plan the deck in your head: one line per
   slide, a claim for each. Slide count: an exact number from the person is the count; a range means its midpoint, rounded down;
   otherwise what the content needs, usually 6 to 10. A chat request that attaches a file already holds its text: never `ls`, `cat` or re-read it. A background
   helper's job names files by path only: read each once, whole, with `file_text` (text, Word or PDF; never `cat`, `head` or a partial read, which cut it),
   and never again, since it stays in your context. Never check which fonts or tools exist.
2. **Pick the template** from the person's tone and occasion; never ask about taste. To show the styles, call `show_deck_styles`. Then, in one step, run
   `node /opt/1hc/skills/artifacts/scripts/new_deck.mjs --patterns <name>`. It lists the template's patterns and numbers the pieces of
   text of its cover and its closing slide, which is all you need to write those two slides.
3. **Write the slides** in one `write_file`: `P/.src/slides.json` = `{"slides": [ ... ]}`, one entry for each slide, in order:
   - the cover and the closing: `{"pattern": "<its pattern>", "text": ["one string for each numbered piece", "", ...], "notes": "..."}`.
     "text" needs exactly as many strings as the list has pieces; `""` removes a piece. Each piece is tagged: put the deck's title in the
     `[headline]` pieces (a title that is split over several headline pieces goes one part on each), a subtitle or one line of
     detail in a `[text]` piece, a short label (a date, "Executive roadshow") in a `[small label]` piece, and use `""` for the
     rest; the closing the same way (a thank-you line in the headline, a line of contact or follow-up in a text piece);
   - one slide for each project, item or point: `{"pattern": "project", "title": "Support reply assistant", "users": "Customer
     support, 120 agents", "problem": "one or two lines", "built": "one or two lines", "impact": [{"value": "38%", "label": "first response time"}, {"value": "9,400 hours", "label": "saved a year"}], "notes": "..."}`. Keep "users" under 40 characters,
     "problem" and "built" under 100, "value" under 18 and "label" under 30. "impact" has one or two figures taken from the person's
     own numbers. Each figure reads alone: the "value" is the whole figure the way a reader says it, with its unit and any before and
     after, and the "label" says only what it measures. Never split a figure between the two: "3 days → 4 hours" with the label
     "report time" (not "3 days" and "to 4 hours: report time cut"), "9 → 5 days" with "month-end close" (not "9 to 5" and "days: close
     shortened"), "2.4×" with "reported hazards" (not "2.4" and "times: reported hazards up"). Write "→" between a before and an after.
     A value may be words with no digit ("Days → seconds"); new_deck.mjs refuses a label that starts with part of the figure.
     Use `[]` when there is none. The slide leaves a dashed
     "Screenshot or GIF goes here" box empty for their own picture. A slide of a title and a few lines:
     `{"pattern": "media", "title": "...", "body": "...", "drop": "label of the empty box"}`;
   - any other pattern: `"text": [...]` as above, or `"replace": {"<sample words>": "<yours>"}` after `new_deck.mjs --patterns` showed them.
     A `[trend: N change figures]` pattern takes `"trend": ["up", "down", "flat" or "none", one per figure]` ("down good" if the data says good); unset, the sign sets the arrow, colour neutral.
   Titles and text shrink by themselves to fit their boxes (never write sizes); new_deck.mjs refuses only words that fit at no readable size. Every fact comes from the person's request or files. "notes" is the speaker note: who to ask, or what to say.
4. **Start and build** in one command (one step):
   `node /opt/1hc/skills/artifacts/scripts/new_deck.mjs P --template <name> --title "<deck title>" --data P/.src/slides.json && bash /opt/1hc/skills/artifacts/scripts/make_deck.sh P`
   and add `--pptx` to make_deck.sh when the person asked for PowerPoint or an editable deck, `--pdf` for a PDF. new_deck.mjs copies
   what the deck needs from the template into `P/.src/template`, so the deck never depends on a shared folder. make_deck.sh ends with
   PASS (the files and the slide text to read back against your plan) or FAIL (the slide, what is wrong, the fix). Run it as
   it is: never redirect its output to a file and never pipe it through `tail`, `head` or `grep`. After PASS the .html, .pdf and .pptx are built and checked: do not open, convert,
   render or inspect them again (no python-pptx, pdftotext, image viewing or validation scripts of your own), and do not run
   make_deck.sh again unless you changed a slide. Never copy or edit the skill's scripts or the shared template folder; they work from
   where they are.
5. **On FAIL**, change only what it names. A deck built from `slides.json` is changed there, then run the step 4 command again with `--redo`
   added to the `new_deck.mjs` call (it starts the deck again from the data file and throws away any edit made to its slide files). A deck
   you wrote or edited by hand is changed in its slide files, then run make_deck.sh again. At most three rounds; then tell the person
   exactly which slide fails which check and ask how to go on.
6. **Share**: `share_file` with the file names the PASS line printed, with readable names ("2026 AI impact report.html"). The .html, .pdf and .pptx of one deck always go to the person together, whichever one you name. One line: what the deck covers and how many slides. Offer a link to present
   from (`publish_page`) and say F is full screen and N shows the speaker notes.

The to-do list and the 👍 go next to the first call. A 33-project deck takes these steps: read the skill and the two references, `--patterns`, write slides.json, new_deck and make_deck, share.

## What goes on a slide

- **One idea per slide**, stated in the title as a claim ("Lodging is half the budget"), not a topic ("Budget").
- **Density**: at most 3 bullets, or 4 to 6 cards or steps, or one chart or table of at most 6 rows. Too much for one slide
  means two slides, never smaller type. Move detail to the speaker notes.
- **Type**: the template's own sizes; a check that reports text under the floor means shorten the words.
- **Vary the patterns**: never the same pattern three slides in a row (except a deliberate run, such as one "project" slide per
  project); use a cover, a section or statement slide to pace long decks, and end with a closing slide.
- **Stay inside the template**: its fonts, colours and decorations. When the person asks for a colour change, change the colours (deck-editing). No other fonts, emoji icons, or added
  accent lines or boxes. Don't mix patterns from two templates.
- **One visual per slide** where the pattern has a place for one: a big number, a chart, steps, a quote, a picture. A chart is
  inline SVG drawn from the data, coloured with the template's own CSS variables (see charts); a template that draws charts
  with Chart.js keeps its script, so change its data in place. A table is HTML. Never a screenshot of a chart.
- **Pictures**: only where the template's pattern has a picture box and the picture shows that slide's real subject; the
  person's own files first (copy them into `.src/media/<name>.jpg` and reference `media/<name>.jpg`), otherwise one command
  (deck-images). A deck about the person's own work needs none: the "project" and "media" patterns leave a dashed box empty for their own picture (an empty picture placeholder in the .pptx).
- **Facts**: every fact, number, date and quote comes from the person or a source you read; nothing invented to fill a slide.
  Numbers shown twice come from one place; estimates are labelled.
- **No making-of text** on a slide: no tool names, file paths, "as requested", template names or leftover sample words (the
  check fails on them). Sample page numbers like "04 / 12" are renumbered for you.

## Other formats

- **PowerPoint or an editable deck**: add `--pptx` to make_deck.sh. The .pptx has real text boxes, shapes and pictures you can
  edit, and an empty picture placeholder for each "media" box. What PowerPoint can't draw (gradients, background images, blurs,
  charts and other SVG, marks drawn by CSS) is kept as a picture; make_deck.sh lists those, and you tell the person which slides
  have them. The .pptx names only fonts every PowerPoint has (Arial, Arial Narrow, Times New Roman, Courier New): each of the
  template's fonts is mapped to the closest of the four, so the text keeps its place on any computer, but the letter shapes are not
  the HTML deck's. Say so, and offer the .html (or the PDF) for the exact look. Each "Screenshot or GIF goes here" box is a dashed frame
  with its label and an empty picture box on top, so a picture put in the box covers the label.
- **PDF**: add `--pdf` (one page per slide, text selectable, no arrow-key hint, counter or buttons) when they ask for a PDF or to print.
- The .html file prints only the slide on screen; for a printable copy use --pdf.

## When you need more

| Task | Read |
|---|---|
| Change an existing deck (from its slide files, never started again) | `read_skill("artifacts", "deck-editing")` |
| A slide plots numbers | `read_skill("artifacts", "charts")` |
| A slide shows places | `read_skill("artifacts", "maps")` |
| The deck needs real photos | `read_skill("artifacts", "deck-images")` |

## Scripts (run them; never cat or sed them; each has `--help`)

| Command | What it does |
|---|---|
| `node /opt/1hc/skills/artifacts/scripts/new_deck.mjs P --template <name> --title "..." (--slides a,b | --data file)` | Copies the template's slides into `.src/`; `--add <pattern> [--after <id>]` adds a slide; `--patterns <name>` lists a template's patterns; `--show <name> <pattern>...` prints each pattern's full slide markup |
| `bash /opt/1hc/skills/artifacts/scripts/make_deck.sh P [--pdf] [--pptx]` | Builds the deck file, steps through every slide at 1920x1080 checking it, exports, prints PASS or FAIL |

make_deck.sh runs the deck's other scripts (assemble, check, repair, export); never run them by hand.

## Done means all of this holds

- The slide count is the count you settled; the slides tell one story in order.
- make_deck.sh printed PASS after your last edit, and the file you share is the one it built.
- Every found photo has its row in `.src/media/SOURCES.md` (its credit lands in that slide's speaker notes, never on a slide);
  unused files in `.src/media/` are deleted.
