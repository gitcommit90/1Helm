# The deck's design system

new_deck.mjs writes all of this into `.src/slides/deck.css` for you (from /opt/1hc/skills/artifacts/scripts/deck_template.css).
Read this only to change `deck.css` itself: a new aspect ratio, a layout of your own, a different cover scaffold.

Everything here lives in the deck's own `.src/slides/deck.css`, which every slide file links. No outside CSS framework
and no font URLs. The style plan supplies the token values (its "css_root" block), picks each slide's layout and the
deck's two lockups.

## Tokens (`:root`)

Write the style plan's "css_root" block exactly as given, as the one `:root` rule, then use the variables everywhere.
Never write a theme colour or font family anywhere else, and never redefine a token. (The page backdrop, the scrim
fallback and the cover title colour below are the only planned literal colours.)

```css
:root {
  --slide-bg: <paper>;          /* slide background */
  --slide-fg: <ink>;            /* main text */
  --slide-primary: <primary>;   /* emphasis: titles, key numbers, borders, icons; sparingly */
  --slide-accent: <accent>;     /* supporting elements */
  --slide-muted: color-mix(in srgb, var(--slide-fg) 80%, var(--slide-bg));   /* quieter text; never opacity */
  --slide-font-display: <display family>, <generic>;   /* headings */
  --slide-font-body: <body family>, <generic>;         /* body */
}
```

`--hero-scrim-color` is set only on a slide with a full-bleed photo (a dark tone taken from that photo), in that slide's
own `<style>`, never in `:root`. The fallback in `var(--hero-scrim-color, #1a1a2e)` keeps an unset value safe.

## Fonts

The style plan only names font families installed on your computer (check with `fc-list : family` if in doubt). Name
them in the two `:root` tokens and nowhere else. Write **no `@import`, no `<link>` to a font service and no font URL**,
in `deck.css` or any slide. embed_deck_fonts.mjs reads the two token names, finds the installed font files, cuts them to
the characters the slides use and appends them to `deck.css` as embedded faces, so the deck renders the same anywhere,
offline.

- Keep the plan's family first in each token. A generic fallback (`serif`, `sans-serif`) may follow, but swapping the
  primary family for another one hides a problem instead of fixing it.
- Weights come from the CSS you write: `font-weight: 600` gets the 600 face (variable fonts cover every weight).
- Never write an `@font-face` rule or its base64 yourself. The embedded block at the end of `deck.css` (between the
  embedded-fonts markers) belongs to the script; edit the rules above it.
- The render check runs with `--require-webfonts`, so a face only counts when it came from the embedded block. If
  "fonts.missing" names a face, check the family spelling in `:root`, run embed_deck_fonts.mjs, assemble and render again.

## Canvas

```css
@page { size: 13.333in 7.5in; margin: 0; }
* { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
html, body { margin: 0; background: #111; }
section.slide {
  width: 1280px; height: 720px;   /* 13.333in x 7.5in at 96 dpi; never min-height */
  overflow: hidden;               /* clips silently: budget about 620px of content */
  position: relative;
  background: var(--slide-bg);    /* opaque; an unset background shows grey and looks broken */
  color: var(--slide-fg);
  font-family: var(--slide-font-body);
  page-break-after: always; break-after: page;
}
section.slide:last-child { page-break-after: auto; break-after: auto; }
```

Put the layout class on the section: `<section class="slide slide-hero-stats" id="budget">`. Another aspect ratio, when
the person asks: change `@page` and the `.slide` width and height together.

## Content layouts

Eight content layouts, plus `cover` and `closing`. The style plan gives one per slide; treat it as the default and let the
content make the final call. Build each with CSS Grid, sizes from the type rules in the authoring reference.

| Class | For |
|---|---|
| `slide-two-column` | two columns side by side: prose and prose, or prose and a photo |
| `slide-bento` | a balanced grid of mixed cells (a stat, some text, a photo) |
| `slide-hero-stats` | up to three big numbers, each over its label (often beside a chart) |
| `slide-headline-bullets` | a heading and at most five bullets |
| `slide-steps` | an ordered, left-aligned vertical sequence (times, steps, phases) |
| `slide-comparison` | before and after, or option A against option B |
| `slide-statement` | one centred statement |
| `slide-gallery` | two or three photos in a row that fill their cells |

`slide-statement`, `slide-hero-stats`, the cover and the closing use large, editorial sizes; the rest use the content sizes.

## Cover scaffolds

The cover holds the photo and the title only. Pick the scaffold that suits the photo. The photo fills edge to edge: never
letterboxed, and no radius, border, shadow or padding on it.

**Full-bleed** (a wide photo, the usual choice; the title sits in the photo's calm area). Shared part, in `deck.css`:

```css
section.slide.cover { background-color: var(--slide-bg); background-size: cover; background-position: center; }
section.slide.cover::after {              /* a scrim on the bottom band only, never the whole slide */
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 55%;
  background: linear-gradient(transparent, color-mix(in srgb, var(--hero-scrim-color, #1a1a2e) 90%, transparent));
  z-index: 1;
}
.cover .title-block { position: absolute; bottom: 48px; left: 56px; right: 56px; z-index: 2; color: #fff; }
```

The photo and its scrim tone belong to the cover alone, so they go in the cover file's own `<style>`, scoped to its id:

```html
<style>
  #cover { background-image: url('media/kiyomizu.jpg'); --hero-scrim-color: #2a1d17; }
</style>
```

**Split panel** (a tall photo; photo half, text on its own panel). Shared part, in `deck.css`:

```css
section.slide.cover { display: flex; padding: 0; }
.cover .image-panel { flex: 0 0 50%; position: relative; background-size: cover; background-position: center; }
.cover .text-panel {
  flex: 0 0 50%; background: var(--slide-bg); color: var(--slide-fg);
  display: flex; flex-direction: column; justify-content: center; padding: 64px 56px;
}
```

In the cover file: `#cover .image-panel { background-image: url('media/<photo>'); }`. Put `.text-panel` first in the
markup to move the photo to the right. No separate accent-bar element.

**Diagonal split** (one clean full-height diagonal; text on the plain background). Shared part, in `deck.css`:

```css
section.slide.cover { position: relative; padding: 0; background: var(--slide-bg); }
.cover .image-panel {
  position: absolute; inset: 0; background-size: cover; background-position: center;
  clip-path: polygon(0 0, 58% 0, 42% 100%, 0 100%);
}
.cover .text-panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: 42%; z-index: 2; color: var(--slide-fg);
  display: flex; flex-direction: column; justify-content: center; padding: 56px 60px 56px 40px;
}
```

In the cover file: `#cover .image-panel { background-image: url('media/<photo>'); }`. Give `.text-panel` no background or
border of its own (that makes a second straight edge).

Every scaffold splits the same way: structure in `deck.css`, the photo in the cover's own scoped `<style>`. A photo in
`deck.css` would ride along on every slide, and an unscoped rule in a slide file is refused by the assemble step.

## Lockups (text and a photo on a content slide)

Use only the deck's two lockups from the style plan. The photo fills its cell edge to edge
(`width: 100%; height: 100%; object-fit: cover; border-radius: 20px`), so no empty band shows.

- **L1, photo-led left**: `grid-template-columns: 55fr 45fr; grid-template-rows: auto 1fr;` photo cell in column 1, text
  cell in column 2, vertically centred (`align-self: center`).
- **L2, photo-led right**: L1 mirrored (text in column 1, photo in column 2).
- **L4, asymmetric** (the strongest; prefer it): a 60/40 grid, the photo fills its cell, the text sits inset with 56px of
  padding.

## Closing

Centred text on one even background (see the authoring reference). No scrim unless the text sits on a full-slide photo.
