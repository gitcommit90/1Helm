# Spreadsheets

Use this when the deliverable is a spreadsheet, or the person names a spreadsheet file and wants something done to
it or made from it, including turning messy tabular data into a clean workbook. If the deliverable is a document, a
deck or a web page that merely contains a table, use that kind instead.

## How a workbook is made

Write a Python generator with `openpyxl` (installed) and keep it in the project's `.src/`:

```
/workspace/workspace/<slug>/.src/build_workbook.py   the editable source
/workspace/workspace/<slug>/<slug>.xlsx              the deliverable, always rebuilt by running the generator
```

To change the workbook later, change the generator and run it again. Never patch the .xlsx by hand: the next run
would undo the patch, and the generator stops describing the file.

| Job | How |
|---|---|
| Create, or edit with formulas and formatting | `openpyxl` in the generator |
| Glance at an existing sheet | `readback.py file.xlsx` (values per sheet, no cell addresses, so never plan edits from it; full path in the check below) |
| Read a workbook's model, formulas and their values | two `load_workbook(...)` passes; see `read_skill("artifacts", "spreadsheet-formulas")` |
| Bulk or messy tabular data in or out | the `csv` module; `python3 -m pip install pandas` only when a job truly needs it |
| Formulas, recalculation, editing someone's workbook | `read_skill("artifacts", "spreadsheet-formulas")` |

## Rules for every workbook you share

- Set `wb.properties.title` and give the file a readable name when you share it ("Kyoto trip budget.xlsx").
- Numbers come from what the person gave you or what you looked up and can point to. In an illustrative or planning
  workbook (a sample budget, a small trip budget) where they didn't ask for real figures, reasonable estimates are fine:
  label them as estimates in the sheet (a note or an "Estimate" column) and say so in your reply (SKILL.md rule 3).
  Any other value you don't have is a blank cell or a question to them, never a made-up number.
- Write formulas, not results you computed in Python: `ws["B10"] = "=SUM(B2:B9)"`, not the total. The sheet must
  still be right after they change an input.
- Follow their spec to the letter: their tab names, their column headers, the formula they spelled out. A cleverer
  layout that computes something else is a failure.
- No formula errors when you share it. Run the recalc gate below and fix every cell it names.
- Say where assumptions and typed-in numbers come from, where the reader will see it: a cell comment or a labelled
  cell next to the number. Name the real source when there is one; say plainly when the number came from the person.
- A workbook meant for someone to fill in gets a short legend saying which cells to edit and one example row with
  realistic values. Never add an example row to a file you were asked to edit.
- No typed totals in titles, labels or chart titles ("Where the $800 goes"): they go stale the moment an input
  changes. Put the figure in a formula cell, or leave it out of the label.

## Look and layout

What the person asked for about the look wins. Otherwise, before styling, check yourself against lazy defaults:
one accent colour on everything, one font doing every job, a title no bigger than the body, emoji as icons. Make each
choice because it suits this sheet.

- Don't apply a document or deck theme to a spreadsheet unless they asked.
- A visible title in the first rows, a clear header row, consistent spacing, restrained colour.
- Headers that read well, stable alignment (numbers right-aligned), number formats that fit the data, sensible
  column widths, frozen panes under the header on long sheets.
- Charts are built from the sheet's own cells (an openpyxl chart pointing at the data range), never a picture of
  numbers typed elsewhere. A bar chart's axis starts at zero (`chart.y_axis.scaling.min = 0`).
- For printing or a picture of the sheet, set landscape and fit-to-width on wide sheets.

### Model and calculator conventions

Use these unless the person says otherwise or the file you're editing already does something else:

- Colour by role: blue text for typed inputs and scenario levers, black for formulas, green for links to another
  sheet, red for links to another file, yellow fill for key assumptions and cells the person should fill in. Say so
  in a one-line legend near the top.
- Number formats: currency `$#,##0` with the unit in the header (`Revenue ($m)`); negatives in brackets and zero as a
  dash: `$#,##0;($#,##0);"-"`. Percentages as `0.0%`, stored as fractions (0.15 shows 15.0%; storing 15 shows
  1500.0%). Multiples as `0.0x`. Years as text, so 2024 never shows as 2,024.
- Structure: every assumption in its own labelled cell, and formulas point at it (`=B5*(1+$B$6)`, never
  `=B5*1.05`). The same formula across every period: one hand-edited cell in the middle of a row is the most common
  silent error. Guard any denominator that can be zero (`=IF($E$12=0,0,E6/$E$12)`).
- One plain, professional font throughout. Liberation Sans and Liberation Serif are installed as stand-ins for
  Arial and Times; Carlito matches Calibri's metrics.

## CSV and TSV

A CSV is plain data, not a formatted workbook: one header row, one record per row, no title rows, no totals rows
unless asked, no formulas. Write it with the `csv` module (it quotes commas and line breaks correctly), UTF-8, from a
generator in `.src/` like any other kind. Excel opens UTF-8 CSVs with non-ASCII text more reliably when written with
`encoding="utf-8-sig"`; use it when the person will open the file in Excel.

## Check before you share

Run all four in this order, from the project folder, every time you rebuild. Never skip the recalc: a workbook with
any formula fails `validate_xlsx.py` until `recalc_xlsx.py` has stored the results.

```sh
cd /workspace/workspace/<slug>
python3 .src/build_workbook.py
python3 /opt/1hc/skills/artifacts/scripts/recalc_xlsx.py <slug>.xlsx
python3 /opt/1hc/skills/artifacts/scripts/validate_xlsx.py <slug>.xlsx --json-out .src/validate/xlsx.json
python3 /opt/1hc/skills/artifacts/scripts/readback.py <slug>.xlsx
```

- `recalc_xlsx.py` has LibreOffice recalculate every formula, writes the results into the file in place (nothing
  else in the file changes) and prints JSON: a status (`"success"` or `"errors_found"`), the formula count,
  the error count and an error summary naming the cells. `"errors_found"` still exits 0, so read the JSON, not the exit
  code. An `"error"` key instead of a status means nothing was recalculated and the file was left as it was. Optional
  second argument: timeout in seconds (default 60).
- `validate_xlsx.py` reopens the file: real zip, every declared sheet present, populated cells and formulas counted,
  every formula has a stored result, openpyxl can load it. Non-zero exit means don't share; fix and run again (a
  formula with no stored result means the recalc didn't run: run it, then validate again). Pass `--allow-empty` only when a blank
  template is the request. Mention its sheet, cell and formula counts in your reply.
- `readback.py` prints each sheet's values (the cached results the person will see) and fails on leftover
  placeholders and error values shown as text.
- A CSV: `validate_xlsx.py file.csv` parses it back (header, row count, rows with the wrong number of fields), then
  `readback.py file.csv`.
- To get a picture of a sheet, `bash /opt/1hc/skills/artifacts/scripts/render_docx.sh <slug>.xlsx .src/validate`
  renders it to PDF and page PNGs; `page_check.py` then checks those pages (see `read_skill("artifacts", "testing")`).

A clean recalc proves the formulas evaluate, not that they are right. Before building out a whole grid, spot-check
two or three formulas against values you can work out by hand.

Then follow `read_skill("artifacts", "testing")` and share the file with `share_file` (path = the .xlsx, name = the
readable file name). Changing it later: rebuild from the generator, run the gates, and share the same path again,
which updates the same Library file.
