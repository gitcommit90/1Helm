# Working with existing PDFs

For PDFs the person already has: uploads and attachments in /workspace/files, or files you downloaded. A new PDF is still
written as HTML and rendered (`read_skill("artifacts", "pdf")`); this is for operating on PDFs that exist. Poppler and pypdf
are installed.

| Task | How |
|---|---|
| Read the text | `python3 /opt/1hc/skills/artifacts/scripts/readback.py file.pdf --out /tmp/text.txt` (page by page), or `pdftotext -layout file.pdf -`; `pdftotext -bbox-layout` when you need each word's position as XML |
| Get page facts | `pdfinfo file.pdf` (pages, size, title), `pdffonts file.pdf` (fonts, embedded or not) |
| Page images | `pdftoppm -png -r 150 file.pdf /tmp/pages/page`; `-f N -l M` limits the range, `-r 300` for fine print |
| List or pull out embedded images | `pdfimages -list file.pdf`; `pdfimages -all file.pdf out/img` |
| Merge | `pdfunite a.pdf b.pdf out.pdf` |
| Split or keep a range | `pdfseparate -f 2 -l 5 file.pdf page-%d.pdf`, then `pdfunite` the pages you keep |
| Fill a form, stamp an overlay, crop, open with a known password | pypdf (below) |

Text extraction never proves layout. Whether a value really landed in its box, or what sits next to what, shows only on the
rendered page: rasterize the pages and run page_check on them, and compare the text positions from `pdftotext -bbox-layout`.
read_file reads text files only; for a PDF use the commands above.

Write results into `/workspace/workspace/<slug>/` and keep the person's original untouched. Share the result with
`share_file` under a readable name ("Lease application, filled.pdf").

## Filling a form

First find out whether the PDF has real fillable (AcroForm) fields, and look at both places a value can live: the form's field
tree (`/AcroForm/Fields`) and each page's widget annotations (follow `/Parent` and `/Kids`). A widget can paint a value from
its own appearance while the real field is missing or holds an old value, so a clean-looking page never proves a fill.

```python
from pypdf import PdfReader
reader = PdfReader("form.pdf")
fields = reader.get_fields()          # the field tree
widgets = [a for page in reader.pages for a in (page.get("/Annots") or [])
           if a.get_object().get("/Subtype") == "/Widget"]
```

**Fillable fields.** Keep the result fillable by default. Flatten only when they ask for a finished, non-editable form, and
never flatten a signed PDF without their explicit say-so. Keep the original, and keep an unflattened copy if they may change
answers later. Check each field's type and states before writing: a text field takes a string; a checkbox must get its own
"on" value (read the field's states: `/Off` is unchecked, the other one, often `/Yes` or `/On`, checks it); a radio group
takes one of its options' values.

Call `writer.reattach_fields()` only when a field you expect is really missing from the field list, never as routine
repair. It treats any widget carrying a field type that isn't in the top-level field list as an orphan, without following
`/Kids`, so on a healthy form it promotes properly parented kid widgets (every radio button, say) to the top level and you
ship a broken field tree that a value check alone won't catch. If a widget and a field share a name but are separate objects
with no parent link, reattach neither: report the ambiguity, or deliver a flattened copy instead.

Two flattening traps in pypdf: the kids of a radio group share one flattened appearance name, so a flattened radio group
paints every position like the first one and the chosen answer is lost; and flattening crashes on a button widget with no
appearance stream (allowed when the form sets NeedAppearances). Flatten only forms with no radio groups whose buttons all
have appearances; otherwise deliver the fillable version and say why.

```python
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

writer = PdfWriter()
writer.clone_document_from_reader(PdfReader(input_pdf))
fields = writer.get_fields() or {}
if set(values) - set(fields):
    writer.reattach_fields()            # only for genuinely orphaned widgets
    fields = writer.get_fields() or {}
missing = set(values) - set(fields)
if missing:
    raise ValueError(f"fields not found: {sorted(missing)}")

to_write = dict(values)
if flatten:
    # paint every existing value too, before the widgets are removed below
    to_write = {name: f.get("/V", "/Off" if f.get("/FT") == "/Btn" else "") for name, f in fields.items()} | values

# auto_regenerate=None leaves the file's NeedAppearances flag as it was; True or False overwrite it,
# and clearing it can stop untouched pre-filled values from showing in strict viewers.
writer.update_page_form_field_values(None, to_write, auto_regenerate=None, flatten=flatten)
if flatten:
    writer.remove_annotations(subtypes="/Widget")      # flatten=True paints but leaves the widgets
    writer.root_object.pop(NameObject("/AcroForm"), None)
with open(output_pdf, "wb") as fh:
    writer.write(fh)
```

**Check the reopened file, not the writer.** For a fillable result: every expected field is in `get_fields()` with the
expected value; every widget's effective value (its own or its parent's) agrees; each updated widget has a non-empty
appearance (`/AP` `/N`); and no top-level field has a `/Parent` (that is the reattach damage above). Then rasterize every page,
run page_check, and compare the text read-back with what you filled. Neither NeedAppearances nor a clean page image proves
the field data changed; the reopened field tree does. For a flattened result: no widget annotations and no form tree remain,
and every value, radio choices above all, shows in the page text and images.

**No fillable fields.** The form is just printed page content, so put text on top of it:

1. Find each blank. `pdftotext -bbox-layout` gives every label's position (origin top-left, in PDF points); the space to fill
   starts where the label ends and runs to the next label or line. For a scan with no text layer, rasterize at 300 dpi and
   find the lines by pixel rows with PIL; convert pixels to points by the ratio of page size to image size.
2. Build a transparent overlay: one HTML page per form page, sized exactly to the PDF page (`@page { size: 612pt 792pt }`,
   for example), each value absolutely positioned. Render it with the normal render script.
3. Stamp it: for each page, `page.merge_page(overlay_page)` with pypdf, then write.
4. Rasterize the result and check it with page_check and the text read-back (`pdftotext -bbox-layout` shows where each value
   landed). Text on the wrong line or over a label means the coordinates need fixing, not the approach.

Never guess an answer onto a form: fill what the person gave you and leave the rest blank, then tell them which fields are
still empty.

## Encrypted or damaged files

`reader.is_encrypted` plus `reader.decrypt(password)` opens a file whose password the person gave you. Never try to get around
a password they don't have. If poppler rejects a file as damaged, say so and ask for a fresh export rather than repairing the
bytes by hand.

## Before sharing

Any PDF you produced or changed ends with the checks in `read_skill("artifacts", "testing")`: rasterize every page, run
page_check, and read the text back.
