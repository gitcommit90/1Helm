# Checking a file before you share it

One rule covers every kind: you check what the person will receive, freshly rendered from the finished file, not the code
that made it. The code says what you meant; the render says what happened. Never share while a check below fails. After
three fix attempts that still fail, stop, tell the person exactly what fails, and ask how they want to go on.

A deck, a PDF and a Word document run every check on this page in one command, `make_deck.sh`, `make_pdf.sh` or
`make_docx.sh` (paths and options in their references), which ends with PASS or FAIL and the fix. For those kinds this page
explains what the checks mean; you don't run the steps one by one.

## 1. Gates: the kind's own checks

| Kind | Gate |
|---|---|
| pdf | `make_pdf.sh` (render_audit with the PDF gates, then validate_pdf.sh, which writes a PNG of every page) |
| presentation | `make_deck.sh` (assemble_deck, then render_audit with the deck gates, a PNG per slide) |
| document (.docx) | `make_docx.sh` (render_docx.sh: LibreOffice turns it into a PDF, then a PNG per page) |
| spreadsheet (.xlsx) | always in this order: `python3 /opt/1hc/skills/artifacts/scripts/recalc_xlsx.py <file>.xlsx`, then `python3 /opt/1hc/skills/artifacts/scripts/validate_xlsx.py <file>.xlsx` (it fails on a formula the recalc hasn't filled in); `render_docx.sh` for page images when the layout matters |
| csv | read it back with Python's csv module: the row count, the same number of columns on every row, the header you meant |
| markdown | read the whole file back |
| web page | `render_audit.mjs` full-page shots at 1280 and 390 px wide (the web-page reference has the command) |

All the scripts are listed with their full paths in the skill itself. A gate's report is JSON: read the verdict (`"ok"`, the failures list)
from the report file the command wrote, not from the exit code alone, and never assume a backgrounded or cut-off run passed.

## 2. Render fresh

Every check runs on a render made after your last change. A PNG from an earlier attempt shows an earlier file: delete the old
page images (the gates clear their own output folder) and render again after every fix.

## 3. The look

You can't see the page images, so the look is done by a script and by reading:

```sh
python3 /opt/1hc/skills/artifacts/scripts/page_check.py --kind doc --json-out <folder>/.src/validate/page_check.json <png folder>
```

Use `--kind deck` for slides and `--kind web` for page screenshots. It fails on a blank page and on content cut off at the
paper edge, and warns about a mostly empty page (a stray page break), a big flat box (an image slot that never filled) and
two identical pages in a row. Treat a warning as a question you answer: a mostly empty last page usually means a stray break
or a section that should be pulled back; a flat box on a page that should show a photo is a missing image.

The gates catch what can be measured: overflow, clipped text, missing fonts, text below the readable size, blurry images,
broken image links, page counts that don't match. Together with page_check that covers the faults a glance would catch first.
What no script judges is taste and fit, so be strict where you can be: follow the kind's design rules while building, keep to
the type sizes and spacing they give, and don't ship a layout you only hope works.

If the person tells you something looks wrong, believe them over the gates: re-render the pages they mean, re-run the checks,
and fix the source. Don't guess at a visual fault you can't confirm; ask them what they see.

## 4. The read-back and the placeholder scan

```sh
python3 /opt/1hc/skills/artifacts/scripts/readback.py /workspace/workspace/<slug>/<slug>.<ext> --out /workspace/workspace/<slug>/.src/validate/readback.txt
```

It prints the finished file's text the way the reader gets it (a PDF page by page, a Word file in order with its tables, a
workbook sheet by sheet, a deck slide by slide) and exits 1 when leftover scaffolding is in it: unfinished-work markers (to-do, TBD, FIXME), lorem ipsum,
"placeholder", [insert …], xxx runs, template variables, "image goes here", formula errors shown as text, broken Word fields.
Anything it finds is fixed in the source, never shipped. Then read the text yourself, all of it, and check:

- Everything the person asked for is there, in the order and with the names they used.
- Sample rows, example values and filler you added for testing are gone (an example row belongs only in a template they asked for).
- Every number matches its data file, and totals add up from the parts shown.
- For a document whose value is its words, the prose reference's read-back: the claims, the headings read alone, one voice.
- Nothing about how you made it reached the page.

A deck exported as slide images has no text layer in the .pptx: run readback.py on the deck's `.src/index.html` instead. A long
file prints in parts: the full text is in the `--out` file; read it with `read_file`.

## 5. Fix, at most three times

Each failed check goes back to the source (the generator, the HTML, the slide file), then rebuild, re-render and re-run every
check, not only the one that failed: a fix for overflow can create an empty page. Count the attempts. After the third failed
attempt, stop and tell the person what is still wrong, specifically ("page 2's table runs past the bottom edge at this font
size"), with the choices you see (cut the notes column, go to two pages, smaller type in the table only). Don't share a file
that fails, and don't keep iterating past three.

## 6. Share

Only now: `share_file` with the finished file's path and a human file name. One short line about what it is. If a check passed
only after you changed something they asked for (cut a section to fit one page, say), tell them in that line.
