# Markdown files

A Markdown deliverable is plain text you write directly with `write_file` and fix with `edit_file`. There is no build step: the
file at `/workspace/workspace/<slug>/<slug>.md` is the deliverable and its own source. Write a long file in sections (several
smaller writes or edits) rather than one huge write, so a mistake costs one section.

Let the content set the structure: real Markdown headings, real list syntax, a table only where rows and columns genuinely line
up. The file is the person's own text from now on, so it carries no build notes, no HTML unless they asked for it, and no
closing commentary that isn't part of the document.

## Formatting

These rules also apply to Markdown you write as a step toward a PDF or a Word file.

**Tables**
- Keep cells short: about 25 characters. Put longer detail in a note under the table.
- Values and short phrases in cells, not sentences, and no URLs: links go in a Sources list below.
- Three or four columns at most. Split a wider table in two, or use a list of label: value pairs.
- Right-align number columns (`---:`) so they scan.

**Lists**
- A blank line between top-level items when each has a description or runs past a few words; none between sub-items.
- Start an item with its point in bold, then the detail: `**Ferry times**: every 40 minutes until 22:00`.
- Two levels of nesting at most. Needing a third means the content wants sections with headings.

**Headings and emphasis**
- Sentence case for headings (`## Key findings`), title case only for a real title.
- Plain-text headings, no emoji in them.
- `---` between major sections gives the page room to breathe.

**Emoji and callouts**
- No emoji in a file that may become a PDF or Word document: most PDF fonts draw them as empty boxes. Use words instead:
  `**Note:**`, `**Warning:**`, `->` for a flow.
- GitHub-style callouts (`> [!NOTE]`) only when the file lives on GitHub; elsewhere a bold `**Note:**` works everywhere.

## Check and share

Read the whole file back with `read_file` (or `python3 /opt/1hc/skills/artifacts/scripts/readback.py <file>`, which also scans for
leftover placeholders) and check that the headings, lists and tables are what you meant and nothing from your drafting is left.
Then `share_file` it with a human name ("Kyoto trip notes.md"). If they'll paste it somewhere that doesn't render Markdown (a text
message, a plain email), say so and offer the text without the markup.
