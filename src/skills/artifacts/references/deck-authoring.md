# Writing the slides

A deck started with new_deck.mjs already has the layouts, lockups, type sizes and canvas below in its `deck.css`, and the
presentation reference covers writing its slides. Read this only to write a layout of your own or custom CSS in a slide.

Read this with `read_skill("artifacts", "deck-design-system")` (the tokens, canvas, layouts and lockups) and
`read_skill("artifacts", "deck-images")` (choosing photos). Each slide is one `section.slide` in its own file, pictures
embedded, checked by render_audit. The style plan already chose the theme, palette, fonts, a layout per slide and the
two lockups: use them. Don't pick colours or fonts of your own.

## What the slide says

- Decide what the slide says before how it looks. The content picks the layout.
- One message per slide. Put it in the heading as a **claim, not a topic**: "Lodging is half the budget", not "Budget
  overview". Then make the biggest thing on the slide the proof. If you can't name the one takeaway, the slide isn't
  ready.
- Headings are short and carry no figures. Text carries the meaning; the chart or photo carries the evidence.
- Give each fact one home. A number plotted in a chart isn't repeated as a stat card, a bar label and a legend entry.
- Show at most three headline numbers, chosen to build toward the point.
- Leave room: at most about five bullets of one or two lines, or three or four cards. More than that gets cut or split.
- Use only real figures from what the person gave you or sources you read. Never invent numbers, dates, quotes or source
  names. Cite a source at most once, as a small muted note, and never cite a chart you made yourself.

## Restraint

- **Never on a slide:** pills, subtitles, summary lines, eyebrows, kickers, badges, chips, tags, captions. Don't write CSS
  for them either; a `.kicker` rule nobody uses is dead weight in every deck.
- Every element earns its place and says something new. Information reads in one clear order.
- The cover has only the title over its hero photo.

## Layout

- Use the whole canvas, and vary the structure from slide to slide (the cover and closing are the exceptions). Guide the
  eye with type size and space.
- Build anything with more than one element as a CSS grid, and give every cell an explicit `grid-column` and `grid-row`,
  so nothing overlaps and nothing depends on auto-placement. No `position: absolute` for the main containers.
- Keep at least 16px between blocks and at least 48px between any content and every edge of the slide. No two boxes
  overlap, and text never sits on a busy part of a photo.
- Centre the content as a group (`align-content: center` on a grid, `justify-content: center` on a flex column) so spare
  space becomes even margins above and below. Don't stretch cards to fill height and don't leave one empty band at the
  bottom. A layout far shorter than 720px wants a bigger image, a larger type step or fewer columns.
- At most two columns of prose (about 460px each, 8 to 14 words a line). Three columns are only for short stat pairs (a
  number and a three-word label), never sentences.
- A numbered, ranked or step-by-step list is a **left-aligned vertical list**: one item per row, the number or time on the
  left, the heading left-aligned above. Never a centred block or a 2x2 grid. Centre only a single statement slide or the
  closing, never a list or a content slide's heading.
- Too much content means less content, never smaller type. Clipped text is never acceptable.

## Type and colour

- Content slides use these sizes: heading in the display font, 48 to 64px, bold, `var(--slide-fg)`; body in the body font,
  16 to 18px, line-height 1.4 to 1.5; a stat number in the display font, 48 to 72px, bold, `var(--slide-primary)`; a stat
  label in the body font, 11 to 13px, sentence case. A stat puts the number above its label, left-aligned, with at least
  24px between stats.
- Two neighbouring elements never share a font size; each level looks clearly different.
- **Sentence case everywhere.** No `text-transform: uppercase`, no `letter-spacing`.
- **All colours and fonts come from the tokens.** `var(--slide-bg)` for backgrounds, `var(--slide-fg)` for text,
  `var(--slide-primary)` for emphasis (titles, key numbers, borders, icons) used sparingly, `var(--slide-accent)` for
  support, `var(--slide-font-display)` for headings, `var(--slide-font-body)` for body. A see-through tint is
  `color-mix(in srgb, var(--slide-primary) 20%, transparent)`; a darker or lighter shade is
  `color-mix(in srgb, var(--slide-fg) 90%, black)` (or `white`). Two or three palette colours per slide.
- **A `#` colour or `rgb(` in a slide file is a bug**, with two exceptions only: the slide's own `--hero-scrim-color`
  (a dark tone taken from its photo), and `#fff` (or a fixed dark) for a cover title over a photo. That covers `style=`
  attributes, a slide's `<style>`, gradient stops, shadows and SVG fills, badges, borders, and colour-coded levels. In
  `deck.css` a `#` appears only in the one `:root` block, the `html, body` backdrop and the
  `var(--hero-scrim-color, #1a1a2e)` fallback. A dark card with light text is `background: var(--slide-fg)` with
  `color: var(--slide-bg)`, no new colour needed. A raw value looks right today and stays wrong when the theme changes.

  ```html
  <!-- wrong: these survive a theme change unchanged -->
  <strong style="color:#9a3412">
  <div style="border:1px solid rgba(154,52,18,0.12)">
  <div style="background:#FAF7F2">

  <!-- right -->
  <strong style="color:var(--slide-primary)">
  <div style="border:1px solid color-mix(in srgb, var(--slide-primary) 12%, transparent)">
  <div style="background:var(--slide-bg)">
  ```
- **Inline SVG takes colour through CSS, not attributes.** `fill="var(--slide-primary)"` doesn't resolve reliably; write
  `style="fill:var(--slide-primary)"` or put the rule in `deck.css`.
- Every `section.slide` has an opaque background (`var(--slide-bg)`, or the cover photo). Don't give the cover or closing a
  different flat colour; a different feel there comes from a photo or the layout.
- Readable text reaches 4.5:1 contrast against what's directly behind it (3:1 for text 24px and up, or bold 19px and up).
  **Never dim text with `opacity` or a see-through `rgba`/`hsla`**; it drops below that quietly. Use `var(--slide-muted)`.
  A bold lead-in and the text after its colon are the same tier at full contrast.
- Don't use `padding-bottom`; space things with `padding-top`, gaps and margins.

## Pictures

- Every deck has real photos: a cover hero and photos on the content slides they illustrate. Charts carry data, photos
  carry the idea. An all-type deck, or one that fills space with gradients and SVG shapes, is a miss unless no fitting
  photo exists or the person asked for no pictures (then `deck_plan.md` says so, see the presentation reference).
- Each section or idea that can be shown gets one photo that really shows it. **No** decorative photo on a number, stat or
  statement slide, and none dropped into a grid cell to fill it. A photo that doesn't illustrate is worse than space.
  At least two illustrative photos across the deck, only where they belong.
- Round the corners of photos (16 to 24px large, 12px small), except full-bleed and split-panel cover photos, which run to
  the edge with no radius.
- A photo that fills a cell uses `width: 100%; height: 100%; object-fit: cover`. **Never** give it a fixed height or
  `max-height` inside a flexible track (`1fr`, `height: 100%`, `flex: 1`): it can't fill the cell and leaves a band.
  Choose a photo whose shape matches the cell (tall for a tall cell). Use `object-fit: contain` on a `var(--slide-bg)`
  backdrop only for a picture with text in it or a diagram that must not be cropped.
- Reference photos as `media/<file>`; inline_media embeds them so each slide stands alone. Nothing else external: no
  `http(s)://`, `file://` or font URLs in any slide file. Leave a photo out rather than reuse one that doesn't fit.
- Text on a photo: best is the photo in its own panel and the text on a plain `var(--slide-bg)` panel. If text must sit
  on the photo, use a gradient scrim limited to the text band (never over the whole slide), a frosted card or a
  text-shadow. Never plain text straight on a photo.
- On content slides keep photo edges straight or rounded; no diagonal `clip-path` or `skew` cutting a text column (the
  diagonal split is a cover-only scaffold).
- Side-by-side panels never overlap: their widths add up to 100% or less.

## Charts and diagrams

- When a slide plots data, read `read_skill("artifacts", "charts")` first. Charts are matplotlib images in the deck
  palette, placed with `object-fit: contain`.
- Put a chart or photo beside its text, never stacked above or below it.

## Fitting the slide

- A slide is exactly 1280 x 720px with `overflow: hidden`, so anything past the edge is cut off without warning. You
  can't see it while writing, so plan the content to fit and rely on render_audit's overflow and fill checks.
- Budget first: about 620px of usable height, roughly a heading plus 10 to 12 lines of body or rows in total. The five
  bullet and three-to-four card limits are ceilings, not targets. A text column beside a photo holds a heading plus about
  three or four short lines; an intro paragraph plus four rows there will overflow.
- Text and stat cards **grow with their content** (`height: auto` or `min-height`). Never a fixed height or a line clamp
  on a card, and never text cut mid-line.
- Card grids: `align-items: stretch` with `grid-auto-rows: auto`, so cards in a row match the tallest without cropping.
  Keep `min-width: 0`; no `min-height: 0` on text cards, no `align-items: start`, no fixed-height tracks. If the tallest
  card won't fit, use fewer cards or shorter text.
- A bento is a balanced grid: neighbouring cells the same height, a feature or photo cell may span two rows or columns,
  the whole thing centred. Text cells size to their text; only photo cells fill with `object-fit: cover`.

## Layouts and lockups

- The style plan gives each slide a layout (cover, closing, or one of the eight content layouts in the design-system
  reference). Start from it, but let the content decide: a light slide takes a simpler layout rather than invented cards.
- The **closing** is centred text on one even background (one colour, or one photo across the full slide), never a panel
  that covers part of the height and leaves a two-tone strip.
- Text next to a photo always uses one of the deck's two lockups (L1, L2 or L4 from the style plan), with the photo
  filling its cell edge to edge. Don't invent another text-and-photo arrangement.
