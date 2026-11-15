# Changing an existing deck

You have the deck's folder (`/workspace/workspace/<slug>/`) and the change the person wants. Change that deck, and don't start a
new one from the request.

## Where the source is

- `.src/deck.json`: the template name, the title and the slides in order (`id`, `pattern`).
- `.src/slides/<id>.html`: one file for each slide.
- `.src/notes.json`: the speaker notes, one string for each slide, in the order of deck.json.
- `.src/media/`: the pictures, and `SOURCES.md` with their credits.
- `.src/template/<name>/`: the deck's own copy of its template. `head.html` holds the styles, `tail.html` the end of the page.
- `.src/slides.json`: the data file, only when the deck was started from one.
- `<slug>.html` and `.src/build/` are built from the files above, so an edit made there is lost on the next build.

`new_deck.mjs --redo` starts the deck again from slides.json and throws away every change made to the slide files. Once a deck's
slide files have been edited, edit the same source the deck was built from: the slide files, or slides.json together with `--redo`,
and not both. A deck with no `.src/deck.json` (a .pptx someone else made) has no source: say so, and rebuild it with the
presentation reference using the words, order and pictures you can read from the file (`readback.py` prints its text).

## Making the change

- **Colours**: the theme colours are CSS variables at the top of `.src/template/<name>/head.html` (for example `--coral`, in the
  `:root` block). Changing the accent there recolours everything that uses it. Some templates also write colours into slide SVGs
  and inline styles, so search the slide files for the old colour and change those too.
- **A different look** (also "Restyle this deck in the coral template", which the Change style button on a deck's card sends): start
  a new deck with another template (deck-templates) and carry the words over, and tell the person the look changed everywhere.
  A deck built from `.src/slides.json` with the shared patterns (`project`, `media`, or patterns whose names exist in both templates)
  re-skins with `new_deck.mjs <P> --template <new> --title "<title>" --data <P>/.src/slides.json --redo`; the data file keeps its
  words, and a "pattern" the new template lacks needs another one from `new_deck.mjs --patterns <new>` before the run. A deck
  written by hand gets its words carried into the new template's patterns: `new_deck.mjs --show <template> <pattern>...` prints a
  pattern's full markup, and `--patterns <new>` numbers the text of its cover and closing slides. Keep the `.src/media` pictures and
  the notes, rebuild with make_deck.sh and share the same file again.
- **One slide**: turn its number into an id with deck.json (slide 1 is the first entry), then edit that file.
- **Add**: `node /opt/1hc/skills/artifacts/scripts/new_deck.mjs <P> --add <pattern> --after <id>` copies the pattern in at that
  place; rewrite its words and add its note to notes.json at the same position.
- **Remove**: take the entry out of deck.json, delete its slide file, and drop the same entry from notes.json.
- **Reorder**: move the entries in deck.json (and in notes.json). The build renumbers page numbers.
- **A picture the person attached**: copy it into `.src/media/` and put an `<img src="media/<name>">` in the slide, in the
  screenshot box (the `data-slot="media"` element) or the template's picture area, with the same position and size as that box, and
  `object-fit:cover`. Remove the empty box. The build embeds the file. Add a row to `SOURCES.md` when it has a credit.
- **A chart**: change its numbers in the slide file.

## Rebuild and share again

Run `bash /opt/1hc/skills/artifacts/scripts/make_deck.sh <P>` (add `--pdf` or `--pptx` when the deck already had that copy). On
FAIL, fix what it names and run it again, at most three rounds. Then `share_file` the same path again: the Library file gets a new
version at the same links, and a published page at its link updates by itself.
