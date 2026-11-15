# Formulas, recalculation and editing workbooks

## Why the recalc is not optional

openpyxl saves a formula as text with no result stored next to it. Until a real spreadsheet engine recalculates the
file, every formula cell reads back empty: in file previews, in pandas, in `load_workbook(path, data_only=True)`. A
workbook shared straight from openpyxl looks blank to whoever opens it in anything but a full spreadsheet app.

So after every save that touches formulas, run the recalc, always before the validate (which fails on any formula
with no stored result):

```sh
python3 /opt/1hc/skills/artifacts/scripts/recalc_xlsx.py <file>.xlsx
python3 /opt/1hc/skills/artifacts/scripts/validate_xlsx.py <file>.xlsx --json-out .src/validate/xlsx.json
```

It has headless LibreOffice recalculate the workbook and copies only the results back into your file (styles, charts
and everything else stay as you wrote them). It prints JSON:

- `"status": "success"` or `"errors_found"`, plus the formula count and the error count;
- an error summary listing the cells for each error type. Each list stops at 100 cells and says how many it left
  out, so trust the error count, not the length of the list;
- `"errors_found"` exits 0. Read the JSON, not the exit code;
- an `"error"` key and exit 1 mean nothing was recalculated and the file is untouched.

Never share while it reports errors. Never blame an error on the original file without proof: open the original with
`load_workbook(path, data_only=True)` and look at that cell first.

### A workbook linked to another file

If the workbook pulls cells from another workbook, that other file is not on your computer: the cached values are
the only copy of that data, and saving with openpyxl strips them. Recalculating would then turn every linked cell
into an error. The recalc script refuses such a file and lists the cells; copy those values out of the original
before you save over it. `--force` recalculates anyway and accepts the loss; use it only when the person agrees.

## Formulas that survive

The engine here is LibreOffice. It knows fewer functions than current Excel, and a function it can't evaluate ships
as a literal `#NAME?`.

- Prefer the classic set: SUM, SUMIFS, COUNTIFS, AVERAGEIFS, INDEX, MATCH, IF, IFERROR, ROUND, SUMPRODUCT and
  their relatives.
- Functions added after Excel 2007 are stored with a prefix, and openpyxl writes your text exactly as given, so write
  the prefix yourself: `_xlfn.TEXTJOIN`, `_xlfn.CONCAT`, `_xlfn.IFS`, `_xlfn.SWITCH`, `_xlfn.MAXIFS`,
  `_xlfn.MINIFS`. Without it each one comes back `#NAME?`.
- Never use the spilling array functions: XLOOKUP, XMATCH, SORT, FILTER, UNIQUE, SEQUENCE. Even where an engine
  evaluates them, a file written by openpyxl has no spill information, so only the top-left cell gets a value and the
  recalc gate sees the cut-down result as zero errors. Look things up with INDEX/MATCH, and sort, filter and
  de-duplicate in Python before writing the cells.
- Quote a sheet name that contains a space: `='Assumptions Inputs'!$B$5`. Unquoted, it is an error.
- Guard every division that can hit zero: `=IF($B$12=0,0,B6/$B$12)`.

## openpyxl traps

- Reading a model takes two loads. `data_only=True` gives the cached values with the formulas gone; the default gives
  the formula text with no values. One load never gives both.
- A workbook loaded with `data_only=True` must never be saved: it has no formulas left, so saving replaces every one
  with a fixed number.
- `data_only=True` on a file openpyxl just wrote returns `None` for every formula: recalculate first. A formula whose
  result is an empty string also reads back as `None`, so `None` alone proves nothing.
- Merged ranges: write only the top-left cell; the rest of the range is read-only.
- An .xlsm loses its macros unless you load it with `keep_vba=True` and save it as .xlsm.
- Charts read their ranges; check the range covers the rows you wrote, header included when you use
  `titles_from_data=True`.

## Editing someone's workbook

Their file's conventions beat every guideline in these references.

- Find the input cells first. They are usually marked by a different font colour, a fill, or a legend. Write only
  there.
- Leave every existing formula alone unless the request is to change it. Never overwrite a formula with a value.
- Match their number formats, fonts and colours rather than restyling.
- Don't add example rows, legends or new tabs they didn't ask for.
- Workflow: copy the original into the project's `.src/` as `original.xlsx`, write a small edit script in `.src/`
  that loads it with openpyxl (the default load, never `data_only=True`), makes only the requested change and saves
  to the deliverable path. Then recalc, validate and read back exactly as for a new workbook, and compare the values
  you didn't touch against the original's (they should not have moved).
- If openpyxl would drop something the file depends on (pivot tables, slicers, form controls, external data
  connections), say so before editing, and offer to give back the changed values for them to paste in instead.
