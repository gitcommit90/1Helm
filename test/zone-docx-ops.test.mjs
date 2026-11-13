// node --import ./test/stubs/register.mjs test/zone-docx-ops.test.mjs
// Word documents in the Zone, the ops by paragraph index (src/zone-docx.js): set the runs of a paragraph, insert one after another, delete one, toggle bold, italic and underline on a
// character range. Generated .docx files only. Every other part of the zip stays byte for byte, every other part of word/document.xml stays as it was, protected paragraphs are refused,
// and each result is a valid zip whose XML a real XML parser (python's) accepts.
import assert from "node:assert"; import { execFileSync } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { readZip, entryBytes, writeZip, newEntry, applyDocxEdits, inspectParagraphs, composeRpr, PART, OPS_MAX } from "../src/zone-docx.js";
let n = 0; const ok = (m) => { n++; console.log("ok " + m); };
const enc = new TextEncoder(), dec = new TextDecoder();
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const r = (t, rpr = "") => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const BODY = [
  /*0*/ `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${r("Quarterly report")}</w:p>`,
  /*1*/ `<w:p w:rsidR="00AA">${r("Spending was ", '<w:rFonts w:ascii="Arial"/><w:sz w:val="24"/>')}${r("up four percent", '<w:b/><w:sz w:val="24"/>')}${r(" on plan.", '<w:sz w:val="24"/>')}</w:p>`,
  /*2*/ `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${r("Travel")}</w:p>`,
  /*3*/ `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${r("Hiring")}</w:p>`,
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p>${r("Cell A")}</w:p></w:tc><w:tc><w:tcPr/><w:p>${r("Cell B")}</w:p><w:p>${r("Cell B2")}</w:p></w:tc></w:tr></w:tbl>`,   // 4, 5, 6
  /*7*/ `<w:p>${r("Name")}<w:r><w:tab/></w:r>${r("Date")}</w:p>`,
  /*8*/ `<w:p><w:r><w:drawing><wp:inline><a:graphic/></wp:inline></w:drawing></w:r></w:p>`,
  /*9*/ `<w:p>${r("See ")}<w:hyperlink r:id="rId9">${r("the site")}</w:hyperlink></w:p>`,
  /*10*/ `<w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing><wp:anchor><a:txbx><w:txbxContent><w:p>${r("In a box")}</w:p></w:txbxContent></a:txbx></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p>${r("In a box")}</w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`,   // 10 (outer), 11 (the box's)
  /*12*/ `<w:p><w:bookmarkStart w:id="1" w:name="x"/>${r("Marked")}<w:bookmarkEnd w:id="1"/></w:p>`,
  /*13*/ `<w:p/>`,
  /*14*/ `<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>${r("Last of section")}</w:p>`,
  /*15*/ `<w:p>${r("Fish &amp; chips &lt;3")}</w:p>`,
].join("");
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${BODY}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;
const STYLES = `<w:styles ${W}><w:style w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;
const mk = async (xml = XML) => writeZip(await Promise.all(Object.entries({ "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>', "_rels/.rels": "<Relationships/>", "word/styles.xml": STYLES, "word/numbering.xml": `<w:numbering ${W}/>`, "word/media/pic.png": "PNGDATA", [PART]: xml }).map(([name, t]) => newEntry({ name, made: 20, flags: 0x800, time: 0, date: 0x21, iattr: 0, eattr: 0 }, enc.encode(t)))));
const partOf = async (bytes, name = PART) => dec.decode(await entryBytes(readZip(bytes).find((e) => e.name === name)));
const run = async (edits, xml = XML) => { const out = await applyDocxEdits(await mk(xml), edits); return { ...out, xml: await partOf(out.bytes) }; };
const refuse = async (edits, re, xml) => { await assert.rejects(() => run(edits, xml), (e) => { assert.ok(re.test(e.message), `message "${e.message}" should match ${re}`); return true; }); };
const wellFormed = (xml) => { const d = mkdtempSync(join(tmpdir(), "zdx-")); const f = join(d, "d.xml"); writeFileSync(f, xml); execFileSync("python3", ["-I", "-c", "import sys,xml.dom.minidom as m;m.parse(sys.argv[1])", f]); };
const texts = (xml) => inspectParagraphs(xml).map((p) => p.text);
const base = inspectParagraphs(XML);

// ---- numbering and protection ----
assert.equal(base.length, 16, "the index counts every w:p in document order, table cells and a text box's paragraph included, the mc:Fallback copy not");
assert.deepEqual(base.map((p) => p.editable), [true, true, true, true, true, true, true, true, false, false, false, false, true, true, false, true]);
assert.ok(/hyperlink/.test(base[9].why) && /inside/.test(base[11].why) && /section/.test(base[14].why) && /drawing/.test(base[8].why));
assert.equal(base[7].text, "Name\tDate"); assert.equal(base[15].text, "Fish & chips <3");
ok("index: paragraphs are numbered in document order; pictures, links, text boxes and section breaks are protected, tabs are text");

// ---- runs ----
{
  const o = await run([{ op: "runs", p: 1, runs: [{ t: "Spending was ", r: '<w:rFonts w:ascii="Arial"/><w:sz w:val="24"/>' }, { t: "up five", r: '<w:b/><w:sz w:val="24"/>' }, { t: " percent & more", r: '<w:sz w:val="24"/>' }] }]);
  wellFormed(o.xml);
  const keep = (a, b) => assert.equal(a, b);
  const i1 = XML.indexOf('<w:p w:rsidR="00AA">'), e1 = XML.indexOf("</w:p>", i1) + 6, j1 = o.xml.indexOf('<w:p w:rsidR="00AA">');
  keep(o.xml.slice(0, j1), XML.slice(0, i1)); keep(o.xml.slice(o.xml.indexOf("</w:p>", j1) + 6), XML.slice(e1));
  assert.ok(o.xml.includes('<w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>up five</w:t>') && o.xml.includes("percent &amp; more"));
  assert.deepEqual(texts(o.xml).map((t, i) => (i === 1 ? "" : t)), base.map((p, i) => (i === 1 ? "" : p.text)));
  assert.equal(texts(o.xml)[1], "Spending was up five percent & more"); assert.equal(o.recs.length, 1); assert.equal(o.recs[0].now, "Spending was up five percent & more");
  ok("runs: only that paragraph changes, its attributes, run formatting and the XML around it are kept, text is escaped");
  const z = readZip(o.bytes), a = readZip(await mk());
  for (const e of z) if (e.name !== PART) { const q = a.find((x) => x.name === e.name); assert.deepEqual([...e.raw], [...q.raw]); assert.equal(e.crc, q.crc); }
  ok("zip: every other part is copied byte for byte");
}
{
  const o = await run([{ op: "runs", p: 7, runs: [{ t: "Name\tDate\nNext", r: "" }] }, { op: "runs", p: 12, runs: [{ t: "Marked up", r: "" }] }, { op: "runs", p: 13, runs: [{ t: "was empty", r: "" }] }, { op: "runs", p: 2, runs: [] }]);
  wellFormed(o.xml);
  assert.ok(o.xml.includes("<w:tab/>") && o.xml.includes("<w:br/>")); assert.deepEqual(texts(o.xml).slice(7, 8), ["Name\tDate\nNext"]);
  assert.ok(o.xml.includes('<w:bookmarkStart w:id="1" w:name="x"/><w:r><w:t>Marked up</w:t></w:r><w:bookmarkEnd w:id="1"/>'), "bookmarks stay around the new runs");
  assert.equal(texts(o.xml)[13], "was empty"); assert.equal(texts(o.xml)[2], "");
  assert.ok(o.xml.includes('<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>'), "emptying a paragraph keeps its properties");
  ok("runs: tabs and line breaks, bookmarks kept, an empty paragraph filled and a full one emptied");
}
await refuse([{ op: "runs", p: 8, runs: [{ t: "x" }] }], /can't be edited/); await refuse([{ op: "runs", p: 9, runs: [{ t: "x" }] }], /hyperlink/);
await refuse([{ op: "runs", p: 10, runs: [{ t: "x" }] }], /can't be edited/); await refuse([{ op: "runs", p: 11, runs: [{ t: "x" }] }], /inside/); await refuse([{ op: "runs", p: 14, runs: [{ t: "x" }] }], /section/);
await refuse([{ op: "runs", p: 16, runs: [] }], /isn't in the document/); await refuse([{ op: "runs", p: -1, runs: [] }], /isn't in the document/); await refuse([{ op: "runs", p: 1.5, runs: [] }], /isn't in the document/); await refuse([{ op: "runs", p: "1", runs: [] }], /isn't in the document/);
await refuse([{ op: "runs", p: 1, runs: "x" }], /list/); await refuse([{ op: "runs", p: 1, runs: [{ t: 5 }] }], /text/);
await refuse([{ op: "runs", p: 1, runs: [{ t: "x", r: "<w:b/><w:t>boom</w:t>" }] }], /formatting/); await refuse([{ op: "runs", p: 1, runs: [{ t: "x", r: '<w:b w:val="1" onclick="x"/><w:i>t</w:i>' }] }], /formatting/);
await refuse([{ op: "runs", p: 1, runs: [{ t: "x", r: '<w:color w:val="a>b"/>' }] }], /formatting/); await refuse([{ op: "runs", p: 1, runs: [{ t: "x", r: "</w:rPr><w:p>" }] }], /formatting/);
await refuse([{ op: "runs", p: 1, runs: [{ t: "x".repeat(20001) }] }], /too much/);
ok("runs: protected paragraphs, bad indexes, bad runs, foreign formatting and oversize text are refused");

// ---- insert ----
{
  const o = await run([{ op: "insert", after: 6, runs: [{ t: "In the cell" }] }, { op: "insert", after: 3 }, { op: "insert", after: 1, runs: [{ t: "A new paragraph", r: '<w:sz w:val="24"/>' }] }, { op: "insert", after: 0, runs: [] }]);
  wellFormed(o.xml);
  const t = texts(o.xml); assert.equal(t.length, 20);
  assert.equal(t[2], "Spending was up four percent on plan."); assert.equal(t[3], "A new paragraph"); assert.equal(t[1], "");
  assert.ok(o.xml.includes('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>'), "a paragraph after a heading copies the heading's properties");
  assert.ok(o.xml.includes('</w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>'), "a list paragraph copies its list");
  assert.ok(o.xml.includes('<w:p><w:r><w:t>In the cell</w:t></w:r></w:p></w:tc>'), "after the last paragraph of a cell stays in the cell");
  const q = await run([{ op: "insert", after: 1, runs: [] }]); assert.ok(q.xml.includes('</w:p><w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/></w:rPr></w:r></w:p>'), "an empty new paragraph carries the first run's formatting");
  const before = XML.slice(0, XML.indexOf('<w:p w:rsidR="00AA">')), after = XML.slice(XML.indexOf("</w:p>", XML.indexOf('<w:p w:rsidR="00AA">')) + 6);
  assert.ok(q.xml.startsWith(before) && q.xml.endsWith(after.slice(after.indexOf("<w:p>")))); assert.equal(o.recs.length, 2);
  ok("insert: after a paragraph, copies its properties and the first run's formatting, stays inside a table cell");
}
await refuse([{ op: "insert", after: 11 }], /can't be added/); await refuse([{ op: "insert", after: 10 }], /can't be added/); await refuse([{ op: "insert", after: 14 }], /can't be added/); await refuse([{ op: "insert", after: 99 }], /isn't in the document/);
{ const o = await run([{ op: "insert", after: 9, runs: [{ t: "after the link" }] }, { op: "insert", after: 8, runs: [{ t: "after the picture" }] }]); wellFormed(o.xml); assert.equal(texts(o.xml)[9], "after the picture"); assert.equal(texts(o.xml)[11], "after the link"); ok("insert: a paragraph can follow a protected one that has nothing nested in it"); }

// ---- delete ----
{
  const o = await run([{ op: "delete", p: 12 }, { op: "delete", p: 5 }, { op: "delete", p: 3 }]);   // Marked, Cell B, Hiring
  wellFormed(o.xml); const t = texts(o.xml); assert.equal(t.length, 13); assert.ok(!t.includes("Hiring") && !t.includes("Marked") && !t.includes("Cell B") && t.includes("Cell B2") && t.includes("Cell A"));
  const q = await run([{ op: "delete", p: 6 }]); wellFormed(q.xml); assert.ok(!texts(q.xml).includes("Cell B2") && texts(q.xml).includes("Cell B"));
  ok("delete: removes that paragraph and nothing else; later ops see the new numbering");
}
await refuse([{ op: "delete", p: 4 }], /table cell keeps/); await refuse([{ op: "delete", p: 8 }], /can't be removed/); await refuse([{ op: "delete", p: 14 }], /can't be removed/); await refuse([{ op: "delete", p: 11 }], /can't be removed/);
await refuse([{ op: "delete", p: 0 }], /keeps at least/, `<?xml version="1.0"?><w:document ${W}><w:body><w:p>${r("Only")}</w:p><w:sectPr/></w:body></w:document>`);
ok("delete: the last paragraph of a cell or of the body, protected paragraphs and bad indexes are refused");

// ---- format ----
{
  const o = await run([{ op: "format", p: 1, from: 13, to: 18, b: true }]);   // "up fo" is inside the bold run: already bold, nothing to do
  assert.equal(o.xml, XML, "asking for what is already so changes nothing");
  const q = await run([{ op: "format", p: 1, from: 0, to: 8, i: true, u: true }]);   // "Spending"
  wellFormed(q.xml); assert.equal(texts(q.xml)[1], base[1].text);
  assert.ok(q.xml.includes('<w:rPr><w:rFonts w:ascii="Arial"/><w:i/><w:sz w:val="24"/><w:u w:val="single"/></w:rPr><w:t>Spending</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve"> was </w:t>'), "the run is split in two, and elements go in the order Word expects");
  assert.ok(q.xml.slice(q.xml.indexOf("up four percent")).includes("up four percent</w:t>"));
  const t = await run([{ op: "format", p: 1, from: 9, to: 37, b: "toggle" }]);   // " was up four percent on plan." spans plain and bold runs: not all bold, so bold goes on
  assert.equal((t.xml.match(/<w:b\/>/g) || []).length, 3, "toggle turns bold on for the whole range when part of it isn't bold");  // heading in styles isn't in the XML: 1 original + 3 now
  const t2 = await run([{ op: "format", p: 1, from: 9, to: 37, b: "toggle" }, { op: "format", p: 1, from: 9, to: 37, b: "toggle" }]);
  assert.ok(t2.xml.includes('<w:b w:val="0"/>') && texts(t2.xml)[1] === base[1].text, "toggling twice turns it off again");
  const mid = await run([{ op: "format", p: 1, from: 16, to: 19, b: "toggle" }]);   // "r f" inside the bold run: all bold, so it goes off for those characters only
  assert.ok(mid.xml.includes('<w:b w:val="0"/>') && mid.xml.includes(">up fou<") === false && texts(mid.xml)[1] === base[1].text);
  const tab = await run([{ op: "format", p: 7, from: 2, to: 7, b: true }]); assert.equal(texts(tab.xml)[7], "Name\tDate"); assert.ok(tab.xml.includes("<w:tab/>"));
  const rs = await run([{ op: "format", p: 1, from: 2, to: 5, b: false }]); wellFormed(rs.xml); assert.ok(rs.xml.includes('<w:b w:val="0"/>') && texts(rs.xml)[1] === base[1].text, "turning bold off writes an explicit off");
  ok("format: splits runs at the range, keeps element order, toggles by the range's current state, tabs count as one character");
}
await refuse([{ op: "format", p: 1, from: 5, to: 5, b: true }], /Select some text/); await refuse([{ op: "format", p: 1, from: 0, to: 999, b: true }], /Select some text/); await refuse([{ op: "format", p: 1, from: 0, to: 4 }], /Say which/);
await refuse([{ op: "format", p: 1, from: 0, to: 4, b: "yes" }], /toggle/); await refuse([{ op: "format", p: 9, from: 0, to: 2, b: true }], /can't be formatted/);
ok("format: empty ranges, ranges outside the text, no flags and protected paragraphs are refused");

// ---- batches and the old op ----
{
  const o = await run([{ op: "text", page: 1, was: "Travel", n: null, text: "Travel and lodging" }, { op: "insert", after: 2, runs: [{ t: "Training" }] }, { op: "runs", p: 0, runs: [{ t: "Quarterly results" }] }]);
  wellFormed(o.xml); assert.equal(texts(o.xml)[2], "Travel and lodging"); assert.equal(texts(o.xml)[3], "Training"); assert.equal(texts(o.xml)[0], "Quarterly results"); assert.equal(o.recs.length, 3);
  ok("batch: ops apply in order, one new document for the lot, and the older text-match op still works beside them");
}
await refuse(Array.from({ length: OPS_MAX + 1 }, () => ({ op: "format", p: 1, from: 0, to: 2, b: true })), /up to 400/); await refuse([{ op: "style", css: {} }], /Only text/); await refuse([null], /Only text/);
await refuse([{ op: "runs", p: 1, runs: Array.from({ length: 101 }, () => ({ t: "x".repeat(19999) })) }], /too much/);
ok("batch: too many ops, other ops and oversize batches are refused");

// ---- the formatting helper the app mirrors ----
assert.equal(composeRpr("", { b: true }), "<w:b/>"); assert.equal(composeRpr('<w:sz w:val="24"/>', { b: true, i: true, u: true }), '<w:b/><w:i/><w:sz w:val="24"/><w:u w:val="single"/>');
assert.equal(composeRpr('<w:b w:val="0"/>', { b: true }), "<w:b/>"); assert.equal(composeRpr("<w:b/>", { b: true }), "<w:b/>"); assert.equal(composeRpr('<w:u w:val="double"/>', { u: true }), '<w:u w:val="double"/>');
assert.equal(composeRpr('<w:u w:val="double"/>', { u: false }), '<w:u w:val="none"/>'); assert.equal(composeRpr("<w:b/>", {}), "<w:b/>"); assert.equal(composeRpr("<w:b/>", { b: false }), '<w:b w:val="0"/>');
assert.throws(() => composeRpr("<w:p/>", { b: true }));
ok("composeRpr: the rule the app uses to write bold, italic and underline");

// ---- a large document stays quick ----
{
  const many = Array.from({ length: 3000 }, (_, i) => `<w:p>${r("Paragraph number " + i)}</w:p>`).join(""), X = `<?xml version="1.0"?><w:document ${W}><w:body>${many}<w:sectPr/></w:body></w:document>`;
  const t0 = Date.now(), o = await run(Array.from({ length: 60 }, (_, i) => ({ op: "insert", after: i * 40, runs: [{ t: "new " + i }] })), X); const ms = Date.now() - t0;
  assert.equal(texts(o.xml).length, 3060); assert.ok(ms < 8000, `60 inserts into 3000 paragraphs took ${ms} ms`);
  ok(`a 3000 paragraph document takes 60 inserts in ${ms} ms`);
}
console.log(`zone-docx-ops: ${n} groups passed`);
