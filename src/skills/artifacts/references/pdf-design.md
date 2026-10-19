# How a PDF should look

What the person asked for about the look (in this request or earlier in the conversation) wins over everything here. Before
you style, take one pass against lazy defaults: one accent colour on everything, a single font doing all the work, a title
barely bigger than the body, emoji as icons. Make each choice because it fits this document, not because it is the easiest.

## Settle the system first

When the person gave no complete look and the file is a designed one (a flyer, a one-pager, a report cover, an invoice with a brand), run `python3 /opt/1hc/skills/artifacts/scripts/design_mcp.py brief "<what it is, who it is for, the mood>"` first for design references, tokens and rules. Pull from it a few references that match the kind of thing and the audience, choose one direction (layout, palette, type pairing), and build from it. When the page images are rendered, compare them with those references. If the brief is empty or errors, build without it and don't mention it to the person. (1Helm also appends the same brief to the result of your first `.html` write.)

{{#better_design}}Better Design gives a palette and type pairing (`find-design-system`), hierarchy, spacing and type rules (`get-ui-principle`), and a check before you finish (`get-review-rules`), as the artifacts skill's list describes.{{/better_design}}

- If they gave a complete look (brand colours, fonts, a reference document), use it. If they gave a direction ("warm",
  "minimal", "like a magazine"), turn it into a small system that matches. If they said nothing, choose a system that suits the
  document. Write the choices at the top of the `<style>` block as CSS variables (colours, the two families, the spacing
  step) and use only those below.
- Map every requested font to an installed family, checked with `fc-list : family`. A PDF must never depend on Google Fonts
  or Microsoft fonts. Close stand-ins: Arial or Helvetica → Liberation Sans or Inter; Times → Liberation Serif; Calibri →
  Carlito; Cambria → Caladea; Georgia → Source Serif 4 or Lora.
- Use one system on every page: the same fonts, the same spacing scale, the same treatment for the same kind of element. Someone
  flicking through shouldn't be able to tell where you stopped and started. Readable contrast, deliberate whitespace and a
  restrained hierarchy beat generic cards and decorative filler. Whitespace is part of the system: when space is tight, cut
  content, never the gaps.

## Design to the type of document

- A form, an invoice, a CV, a manual, a research paper, a brochure and a photo gallery each have conventions their reader
  expects. Follow the one that fits the request, not a generic report template.
- The page background is one of those conventions. Invoices, forms and papers sit on plain white; take that as the default and
  change it only with a reason.
- So are decorative accents. Invoices, forms, data tables and papers normally carry no coloured top band or side stripe; their
  structure comes from type and alignment, with thin neutral rules where needed. Keep bands and stripes for genres where
  branding is the point (a flyer, a brochure, a menu).
- A standard page size in portrait with print-safe margins, unless asked otherwise: A4, or Letter for US readers. Keep
  anything important out of the outer margin.
- On dense pages, use headings and bullets, styled so the same level always looks the same. Leave them out where a page carries
  little.

## Every element earns its place

- A chart or diagram belongs only when it carries information the text can't. Charts are drawn from data (see
  `read_skill("artifacts", "charts")`).
- Photos: documents about everyday life (travel, food, places, events) feel unfinished without real photos of the places and
  things they name; dense data and utility documents read better without images. Photos are real and free-licensed, with a
  credit (see `read_skill("artifacts", "pdf")`).
- Treat an area that feels empty as a layout problem to solve (rebalance columns, enlarge the chart, move a section up), not as
  a cue to add a card, a chip or a stock illustration.
- Full-bleed images only for a deliberate cover. Reports, guides, manuals and data documents use ordinary in-page images that
  don't compete with the content.

`read_skill("artifacts", "pdf")` covers the HTML, page breaks, rendering and checks.

## When they report a visual problem

Render the affected pages again (`validate_pdf.sh` writes fresh page PNGs), run page_check on them and read the text back
before you change anything. Don't guess at a layout fault without evidence from the render.
