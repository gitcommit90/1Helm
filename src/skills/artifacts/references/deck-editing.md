# Changing an existing deck

You have the deck's folder (`/workspace/workspace/<slug>/`) and the change the person wants. Change that deck; never
write a fresh one from the request.

## Read first, only what the change needs

The source is per slide under `.src/slides/`:

- `.src/slides/deck.json`: the slides in order. Read it first; it tells you which file is which slide.
- `.src/slides/deck.css`: the theme tokens and every shared rule, then the embedded fonts in a block at the end. Edit the
  rules above that block; leave the block alone.
- `.src/slides/<id>.html`: only the slide or slides you're about to change. Each holds one `<section class="slide">`;
  photos are `media/<file>` references (an older deck may have them embedded, with `data-media="<file>"` naming the file).
- `.src/deck_plan.md`: title, audience, arc, slide list.
- `.src/style_plan.json`: theme, palette, fonts, the layout for each slide, the two lockups.

Don't read or edit `.src/index.html`: it's built from the files above, reading it costs the whole deck to change one
slide, and the next assemble throws your edit away. To open a big slide file, search it first (`search_files` or `grep`)
rather than reading the embedded photo bytes.

**No `.src/slides/`, or a slide set the assemble step refuses for a reason older than your change:** there's no per-slide
source to edit. Rebuild the deck in the current format (the presentation reference), keeping the slug and carrying the
deck's own material forward so it stays the same deck: `deck_plan.md` for the arc and slides, `style_plan.json` for the
theme and layouts (not picked again), `.src/media/` for photos, and the old `index.html` for each slide's content. Make
the requested change as part of the rebuild, and tell the person the deck was rebuilt, since that rewrites slides they
didn't ask about. A deck with no `.src/` at all (a .pptx someone else made) can't be edited this way: say so and offer to
rebuild it from its content.

When you rewrite or add a slide, write it exactly as in a fresh build (the layout table and lockups in the presentation
reference; their markup is in /opt/1hc/skills/artifacts/scripts/deck_layouts.html) so it matches the slides around it.
Photo credits live in the speaker notes (make_deck.sh writes them from `.src/media/SOURCES.md`): a new photo needs its row
there, and an older deck's closing-slide `p.credits` line comes off when you touch that slide.

## Make the change by what was asked

- **Change or re-topic one slide** ("change slide 3 to...", "fix the last slide"): turn the slide number into an id with
  `deck.json` (slide 1 is the first entry), then edit only that `<id>.html`. No other slide file changes, and `deck.json`
  stays as it is.
- **Shorten** ("cut it to 5 slides", "tighter"): remove whole slides. Keep the strongest points and the arc, drop the
  weakest slides, and carry the survivors through unchanged with their existing photos (don't re-source photos or pick a
  new style plan). Remove each dropped slide from `deck.json` and delete its file; the survivors keep their ids. Never
  pad a deck with filler. Rewrite a survivor's copy only if the person also asked for that ("make it punchier").
- **Add a slide** ("add a slide on..."): write a new `<id>.html` that reuses a layout and the lockups already in the deck,
  and insert it in `deck.json` where it belongs. Give it a short, stable kebab-case id for what it's about, and leave every
  other id and file exactly as it is; ids never get renumbered to match positions. Don't run slide_style.mjs for it (that
  re-picks the whole theme). Add a photo only where it illustrates the new slide; a table, stat or comparison slide stays
  photo-free.
- **New look** ("darker", "more minimal", "a different feel"): get a fresh style plan for the new direction. Write a new
  `style-plan-input.json` with the existing title, the person's words about the look as the brief, and the existing slide
  ids, run `node /opt/1hc/skills/artifacts/scripts/slide_style.mjs plan --input <P>/.src/style-plan-input.json > <P>/.src/style_plan.json`. Then swap the `:root` block in `deck.css` for
  the new "css_root" block and nothing else; slide_style.mjs and embed_deck_fonts.mjs handle colours and fonts, so never
  pick them by hand. The slide files stay untouched. The photos were chosen for the old palette, so a change of hue (not
  just lighter or darker) can make photo slides look off: tell the person, and offer to look for photos that suit the new
  palette. Keep the cover photo's `--hero-scrim-color` taken from that photo.
- **Anything else** (reorder, swap one photo, resize): make the smallest change. Reorder means moving entries in
  `deck.json`; no slide file changes. Swapping a photo means finding a new one (the deck-images reference), saving it in
  `.src/media/` with its source in `SOURCES.md` (`images.py fetch --to <P>/.src/media "<id>=<subject>"` does both), and
  pointing that `<img>` at `src="media/<new file>"` (or `url('media/<new file>')` for a background). Updating a chart means changing the
  data file or chart script in `.src/`, re-running it, and swapping the chart image the same way. An aspect-ratio change is
  deck-wide: change `@page` and `.slide` in `deck.css`, then re-check overflow on every slide.

## Keep the look unless asked

For a content change (edit, shorten, add), don't run slide_style.mjs again and don't touch the `:root` block. Only a
request for a new look changes the theme. Restyling a deck during a content change is a bug.

## Rebuild, re-check, re-share

One command rebuilds and re-checks everything (embedding, assembly, the gates, page_check, the .pptx, the read-back):

```sh
bash /opt/1hc/skills/artifacts/scripts/make_deck.sh /workspace/workspace/<slug> --no-restraint
```

`--no-restraint` because the restraint gate reads every slide, including ones this change must leave alone, and a deck made
before that gate existed could fail on slides you weren't asked to touch. Fix furniture, uppercase and letter-spacing on the
slides you did edit; mention the untouched slides only if you actually found those styles on them. Add `--pdf` or `--html`
when the deck already had that copy. On FAIL fix what it names and run it again (at most three rounds).

Then share each format again from the same path with `share_file`, which updates the same Library file in place. After a
change that adds or removes slides, also bring the slide list in `deck_plan.md` (if there is one) and the layout list in
`style_plan.json` up to date (those lists only; the palette and fonts stay). The deck keeps its slug and its links.
