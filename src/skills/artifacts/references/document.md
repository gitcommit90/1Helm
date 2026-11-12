# Word documents

Use this when the deliverable is a Word file: the person asks for a Word doc, a .docx or .dotx, or a document they
will edit in Word or Google Docs. To change, extract from, redline or comment on an existing .docx, also read
`read_skill("artifacts", "document-editing")`. Not for PDFs (`read_skill("artifacts", "pdf")`), spreadsheets or
Google Docs in their Drive.

**The build, in order** (about ten steps; this page is all a new Word document needs, plus prose for a text-heavy one):
1. Plan the sections from what the person asked; look up only what you don't know (well-known facts need no research).
2. In ONE step, side by side: the photos, in one command: `python3 /opt/1hc/skills/image-search/scripts/images.py fetch --to /workspace/workspace/<slug>/.src/media "hero=<exact subject>"`.
3. and `/workspace/workspace/<slug>/.src/build_doc.py` in one `write_file` (it reads the photo from `.src/media/hero.jpg`, runs from the project folder, and saves `/workspace/workspace/<slug>/<slug>.docx`).
4. `bash /opt/1hc/skills/artifacts/scripts/make_docx.sh /workspace/workspace/<slug>`: on FAIL fix what it names and run it again.
5. On PASS read the text it printed, then `share_file` the .docx.

| What you need | Read |
|---|---|
| What the words say: outline, headings, tone, the read-back | `read_skill("artifacts", "prose")` |
| Tables, lists and emphasis in the content | `read_skill("artifacts", "markdown")` |
| A chart in the document | `read_skill("artifacts", "charts")` |
| A place or a map | `read_skill("artifacts", "maps")` |
| Changing an existing or uploaded .docx, tracked changes, comments, reading one, a legacy .doc | `read_skill("artifacts", "document-editing")` |

## How a document is made

Write a Python generator with `python-docx` (installed) and keep it, with its media, in the project's `.src/`:

```
/workspace/workspace/<slug>/.src/build_doc.py     the editable source
/workspace/workspace/<slug>/.src/OUTLINE.md       the argument, section by section (see prose)
/workspace/workspace/<slug>/.src/media/           photos, chart images, SOURCES.md
/workspace/workspace/<slug>/<slug>.docx           the deliverable, always rebuilt by running the generator
```

A later change goes into the generator, then you run it again. Never patch the .docx itself.

Charts are drawn by the generator with matplotlib from the same data the text quotes, saved into `.src/media/` and
inserted with `add_picture(...)`. Photos are real, free-licensed images you downloaded into `.src/media/`, recorded in
`.src/media/SOURCES.md` and credited in a caption (author, licence, where from).

## Never fake structure

Word and screen readers see the structure you build, not the one you draw:

- Set the title property: `doc.core_properties.title = "..."`, never empty. Give the visible title the Title or
  Heading 1 style and share the file under a readable name ("Kyoto trip plan.docx").
- Headings use real heading styles (Heading 1, 2, 3), so the navigation pane and a table of contents see them. Never
  a bold Normal paragraph posing as a heading.
- Lists use real list styles (List Bullet, List Number) or real numbering. Never type a "•", "-" or "1." at the
  start of a paragraph.
- A horizontal rule is a bottom border on a paragraph. Never a one-row table, never a line of underscores.
- Separate paragraphs, not line breaks inside one run, and space with paragraph spacing, not empty paragraphs.
- Tables have a header row; set column widths on the table grid and on every cell with autofit off, or LibreOffice
  and Word will each pick their own.
- Page size and margins are set on the section (Letter for US readers, A4 elsewhere, unless asked).

## How it should look

What the person asked for about the look wins. Otherwise, before styling, check yourself against lazy defaults: one
accent colour on everything, one font doing all the work, a title no bigger than the body, emoji as icons. Choose
each thing because it fits this document.

- This section covers the look; `read_skill("artifacts", "prose")` covers the words. A Word document is mostly text,
  so read both.
- A visible title, a clear hierarchy (title, headings, body), consistent spacing, restrained colour: one accent at
  most, used for headings or small highlights.
- Body text 10 to 12 pt in an installed font. Liberation Sans/Serif match Arial/Times metrics, Carlito matches
  Calibri, Caladea matches Cambria; Inter, IBM Plex and Noto Sans/Serif are also installed. A font the computer
  doesn't have renders in a stand-in, so check with `fc-list`.
- Tables: readable header, aligned columns, numbers right-aligned, no cramped cells.
- Images earn their place. A decorative photo supports the subject (everyday-life documents such as travel or food
  feel unfinished without real photos of what they name); charts and diagrams come from data, drawn by code.
- When a page count is set ("one page"), the content budget gives way, not the type size: cut the weakest material
  or tighten wording.

## Check before you share (one command)

```sh
bash /opt/1hc/skills/artifacts/scripts/make_docx.sh /workspace/workspace/<slug>
```

It runs `.src/build_doc.py` from the project folder (the generator must save `/workspace/workspace/<slug>/<slug>.docx`),
checks the file opens and has a title property, renders it with headless LibreOffice (how most readers' apps lay it out)
to a PNG per page in `.src/validate`, runs page_check (blank pages, content cut off at the edge, near-empty pages, empty
image boxes) and reads the text back in order (body, tables, headers, footers), failing on leftover placeholders. It ends
with **PASS** (the file, the share line, the text) or **FAIL** (the step, what failed, the fix). Never cat or sed the
scripts; each prints its usage with `--help`. (Under the hood: /opt/1hc/skills/artifacts/scripts/render_docx.sh,
/opt/1hc/skills/artifacts/scripts/page_check.py, /opt/1hc/skills/artifacts/scripts/readback.py.)

On PASS do the prose read-back from the printed text against `.src/OUTLINE.md`: the page count against what was asked,
every section of the outline there. On FAIL fix the generator and run it again: at most three rounds, then tell the person
exactly what still fails. Share with `share_file` (path = the .docx, name = the readable name). To change it later, edit the
generator, run make_docx.sh again, and share the same path again; that updates the same Library file instead of adding a copy.
When the message says a paragraph or page of the document is selected in the canvas, change that text in `build_doc.py`, run make_docx.sh and share the same path, and keep any hand edits a note in the message lists.

Photos: `python3 /opt/1hc/skills/image-search/scripts/images.py fetch --to /workspace/workspace/<slug>/.src/media "<name>=<exact subject>" ...`
downloads JPEGs Word can use, writes `SOURCES.md` and prints the credit for each caption.
