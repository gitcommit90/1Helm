# Editing Word documents that already exist

A .docx (and a .dotx template, handled the same way) is a ZIP of XML parts. Pick the route by what the edit needs:

| Edit | Route |
|---|---|
| Changing a document you made | edit its generator in `.src/` and rebuild (see `read_skill("artifacts", "document")`) |
| Simple content changes in their document | open it with python-docx, change it, save to the deliverable path |
| Tracked changes (redlines), comments, edits that must keep every bit of formatting | raw XML: unpack, edit `word/document.xml`, repack (python-docx can't express these) |
| Reading or pulling content out | `python3 /opt/1hc/skills/artifacts/scripts/readback.py file.docx` for the text in order; python-docx when you need the structure |
| Legacy .doc, .rtf or .odt | convert first: `soffice --headless --convert-to docx file.doc`, then treat it as a .docx |

Always keep their original untouched: copy it into the project's `.src/` as `original.docx`, and write the edited
file to the deliverable path. Put the edit itself in a script in `.src/`, so it can be rerun from the original.

## The raw-XML round trip

```bash
cd /workspace/workspace/<slug>/.src
rm -rf unpacked && mkdir unpacked && unzip -q original.docx -d unpacked
find unpacked -type l -delete      # a ZIP from outside can contain symlinks; remove them before touching anything
# edit unpacked/word/document.xml in place
(cd unpacked && rm -f ../../<slug>.docx && zip -Xqr ../../<slug>.docx .)
```

- Never pretty-print or re-indent the XML. Added whitespace becomes text where `xml:space` is preserved and changes
  what renders.
- Zip from inside the unpacked folder, so parts sit at the archive root (`word/document.xml`, not
  `unpacked/word/document.xml`). Word refuses an archive with a folder prefix.
- Delete the output first: `zip` adds to an existing archive, so a part you removed would survive. `-X` leaves out
  owner and timestamp extras.
- Unpacking in Python instead: reject symlink entries (`stat.S_ISLNK(info.external_attr >> 16)`) and any entry whose
  path resolves outside the target folder.

## Text split across runs

Word breaks visible text into many `<w:r>` runs (revision ids, spell-check marks, editing history). A phrase you can
read in the document often isn't one string in the XML, and a find-and-replace silently misses it.

Before a text edit, merge neighbouring runs whose `<w:rPr>` are byte-for-byte identical (or both absent): that can't
change how anything looks. `rsid*` attributes and `<w:proofErr>` elements are only bookkeeping and safe to drop.
Never merge across two different `<w:ins>`/`<w:del>` wrappers: that rewrites the change history and fuses separate
revisions.

## Tracked changes (redlining)

Wrap each change in `<w:ins>` or `<w:del>`, each with `w:id`, `w:author` and `w:date`.

- Inside `<w:del>` the text element is `<w:delText>`, never `<w:t>`; a field instruction becomes `<w:delInstrText>`.
- A deleted paragraph mark (`<w:pPr><w:rPr><w:del .../></w:rPr></w:pPr>`) means "join this paragraph to the next".
  Deleting a whole paragraph takes both that mark and a `<w:del>` around every run in it; either half alone is a
  different edit.
- In `w:rPr`, the `<w:del/>` child comes first; child order inside rPr is fixed by the schema.
- Rejecting someone else's insertion: nest your `<w:del>` inside their `<w:ins>`; never edit or unwrap their wrapper.
  Restoring their deletion: add your own `<w:ins>` after their `<w:del>`. A change is identified by kind, author,
  date and text, so touching someone else's wrapper shows up as a brand-new change.
- The silent failure is an edit made outside any wrapper: invisible when changes are shown, recorded nowhere. After
  redlining, compare against the original and confirm every text difference sits inside a `<w:ins>` or `<w:del>` you
  wrote. That discipline applies to the body; headers, footers and footnotes are separate parts, so check them too if
  you touched them.

### Handing back a clean copy

To give back a version with every change accepted, do it in the XML with a small script in `.src/`, working on an
unpacked copy:

- remove every `<w:del>` element with everything inside it (including `<w:delText>`);
- unwrap every `<w:ins>`: keep its children in place, drop the wrapper;
- for a paragraph whose mark is deleted (`<w:pPr><w:rPr><w:del .../>`), move its runs to the start of the next
  paragraph and remove the now-empty paragraph;
- drop `<w:rPrChange>`, `<w:pPrChange>` and similar change records, keeping the current formatting.

Do the same in headers, footers and footnotes if they carry changes. Repack, then confirm: `unzip -p` the result and
grep that no `w:ins`, `w:del` or `Change` element is left, and run the render gate below. Watch for a fully deleted
paragraph followed by an empty spacer paragraph: done carelessly it leaves an empty paragraph, which shows as a stray
bullet in a numbered list. Judge paragraph deletions in the XML, not only in the picture.

## Comments

A comment touches six places that refer to each other: `word/comments.xml`, `word/commentsExtended.xml`,
`word/commentsIds.xml`, `word/commentsExtensible.xml`, four `Relationship` entries in
`word/_rels/document.xml.rels`, and four `Override` entries in `[Content_Types].xml`.

The id chain: each `w:comment` has a `w:id` and a paragraph `w14:paraId`; commentsExtended is keyed on that paraId;
commentsIds maps the paraId to a `durableId`; commentsExtensible is keyed on the durableId.

- The parts alone show nothing. Anchor the comment in the body with `<w:commentRangeStart w:id="N"/>` ...
  `<w:commentRangeEnd w:id="N"/>` and a run holding `<w:commentReference w:id="N"/>`. The range markers are direct
  children of `<w:p>`, never inside a `<w:r>`.
- A reply's `w15:commentEx` sets `w15:paraIdParent` to the parent comment's paraId, and its markers sit inside the
  parent's range.
- Limits: `w14:paraId` is hex below `0x80000000`; `durableId` below `0x7FFFFFFF`. Generate with
  `random.randint(0, 0x7FFFFFFE)` formatted as `%08X`. durableId is decimal in `numbering.xml` and hex everywhere
  else.
- Declare the full set of Word namespaces (and `mc:Ignorable`) on the root of each new part up front, so children you
  add never hit an undeclared prefix.

## Check before you share

Every edit ends with the same gate as a new document:

```sh
bash /opt/1hc/skills/artifacts/scripts/render_docx.sh <slug>.docx .src/validate
python3 /opt/1hc/skills/artifacts/scripts/page_check.py --kind doc .src/validate
python3 /opt/1hc/skills/artifacts/scripts/readback.py <slug>.docx
```

Also read back the original the same way and compare: everything you weren't asked to change should still be there.
Then follow `read_skill("artifacts", "testing")` and share the edited file with `share_file`. If they attached the
original, share the edited one under a name that says what changed ("Lease, with my edits.docx"), unless they asked
you to replace it.
