# Charts

Read this before writing any chart. First decide what the chart is: an image placed on a fixed page (deck, PDF, Word), a native
chart in a workbook, or live elements in a page that reflows (web page). That picks the technique section below; the data and
encoding rules apply to all of them.

## Where the numbers come from

- If the data already exists (a file they gave you, a document you just made, a workbook in the project), read it and build from
  it. Never produce "the same" numbers twice: two passes won't match and the person can't tell which is right.
- Never say two files show the same data unless one was built by reading the other, or both read one data file.
- Real data only. Never invent figures, dates, citations or sources, and never cite a chart you drew as a source. Estimates in
  an illustrative or planning file (SKILL.md rule 3) are data too: the chart reads them from the same cells or file, and the
  file says they're estimates.
- If a source's summary disagrees with its own rows, recompute from the rows and say so on the file.
- No randomness in a finished file. If sample data is genuinely needed, generate it once, save it to a file, and have everything
  read that file.

**Every number on display is computed from the plotted data.** That includes captions, headings, stat boxes, annotations and
summary lines; superlatives ("the busiest day", "the biggest cost"), which come from the maximum of the series, not from memory;
comparisons and counts in prose ("up 40%", "three days over budget"); and changes, whose two ends must both be in the data. A number
typed into prose goes stale the moment the data changes. Never floor or cap a statistic for display: `max(22, value)` guarantees a
number, not a fact. Never claim a reconciliation you didn't compute.

Totals and shares: a total is the sum of the parts shown beside it, never a figure from somewhere else. Percentages share one
denominator and the parts account for the whole; if they add to 90%, a part is missing or the total is wrong, and the file says
which. A count you state matches what you drew. A remainder gets a name ("Other, 4 items"); an unlabelled slice can't be read.

## How data maps to marks

These hold everywhere. Where you draw the chart yourself they're the arithmetic you write; where a library draws it, check its
output, because library defaults happily truncate a baseline or clip your data.

Axes:
- Take the range from the data; never type a limit. A fixed maximum will one day be smaller than the data, and points beyond it
  vanish without a warning. Check every value lands inside whatever range you set.
- Bars and areas start at zero: their length is the value, and a cut baseline misstates it. If the change only shows on a cut
  scale, use a line chart. If a cut is unavoidable, show it on the chart itself (a visible axis break), not in a sentence nearby.
- Fit the range to the question: so wide that real differences look equal, or so narrow that noise looks like a mountain range, both mislead.
- One labelled scale per measure. Two series in different units need two labelled axes or two charts; rescaling one so it fits the
  other's axis is the same fault in disguise.
- Every axis has readable ticks; value labels alone aren't a scale.

Labels:
- Never cut label text in code: "Accommodati" reads as data. Rotate, wrap, use smaller type, or show fewer ticks, after measuring
  the longest label against the space.
- Value labels on all bars or on none; dropping only the longest hides the biggest value.
- Check text against its own box (the card, the plot area, the hole of a donut), not just the page, and keep labels off each other
  and off the marks.

Legends and notes:
- Every series appears in the legend, its swatch made from the same colour value the chart uses; two series never share a colour.
- A reference line sits at its statistic: a line labelled "average" is at the average.
- Decorative marks are to scale, or they aren't marks.

Data shape:
- Missing data shows as a gap. Never draw a line across a hole: a reader can't tell missing from zero.
- Uneven intervals need a real time scale: 2021, 2023 and 2026 as three evenly spaced categories say the gaps were equal.
- Mark a partial period as partial, or it reads as a collapse.
- A part-to-whole chart shows every part; if you only list the biggest, still name and count the rest.
- Never clamp values to the top of a range: at a 100% cap, 108% and 166% look the same.

## Technique by kind

### Slide deck
- Draw the chart with matplotlib from the real data and place the PNG; never fake it with CSS shapes, styled boxes or hand-drawn SVG.
- Colour it from the deck: read the colours from the deck's style plan (primary, accent, ink, a muted tint) and pass them to the
  chart script, so the chart belongs to the deck. Set the chart's font to the deck's body font.
- Place it with `object-fit: contain`, never `cover`, which crops axes and labels.
- Render at least twice the size it shows on the slide (a 600 px-wide slot gets a 1200 px PNG, `dpi=200` or more) so it stays sharp.
- The one-fact-one-home rule and slide layout live in deck-authoring.

### PDF or Word document
- Draw it with matplotlib from a script in `.src/` and save the PNG to `.src/media/`. Never use a picture of a chart from somewhere else.
- Size it for the page: a full-width chart on A4 or Letter is about 16 cm wide, so draw at that size and `dpi=200`.
- In a PDF, placement (`object-fit`, `max-height`, the `cover` trap that crops axes while every check passes) is covered in the pdf
  reference. If a chart comes out too small to read, give it more height or drop it.
- In Word, add it with `doc.add_picture(path, width=Cm(16))` and a short caption paragraph under it when the chart needs one.

### Spreadsheet
- Use a native openpyxl chart (BarChart, LineChart, PieChart) whose data references point at the cells holding the values, so the
  chart follows when the person edits a number. Never paste a picture of a chart into a workbook.
- Point the chart at the cells with the formulas' results, give it a title and axis titles, and put it beside the table, not over it.

### Web page
- Draw the chart as inline SVG written into the page, not with a charting library loaded from the internet when the page opens:
  the chart then works offline and when published, and its correctness is in the file you wrote.
- Nothing computes scales, ticks or the legend for you, so every rule above is arithmetic you write: settle the range, the
  baseline, the labels, the legend and the note positions before drawing.
- Put the data in the page once, as one array; that array is the single source for the marks, labels, legend and any total shown.
- Use a `viewBox` and let the SVG scale with its container; check it at phone width (390 px) as well as desktop.
- Give the plot real height: squeezed into a wide, short box, a series goes flat.
- Colour with the page's CSS variables, set through `style` or CSS rules, not presentation attributes.

## Before you hand it over

Recompute each headline figure from the source and compare it with what the file shows: the total, the percentages, the named
extreme, any growth figure, any count. A number you can't reproduce from the data is wrong, and the fix is the number, not the
caption. Then read the chart as its reader will, with no interaction: a chart that only appears after a click hasn't been delivered.
