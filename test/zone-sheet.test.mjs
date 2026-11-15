// node --import ./test/stubs/register.mjs test/zone-sheet.test.mjs
// Spreadsheets in the Zone, server side (src/zone-sheet.js, ExcelJS; reply-to.js and zone-marks.js for the pin and the marks). Synthetic workbooks, no model is called.
import assert from "node:assert/strict";
import "../src/resident.js";   // first: resume.js and resident.js import each other
import ExcelJS from "exceljs"; import JSZip from "jszip";
import { applyXlsxEdits, applyCsvEdits, applySheetEdits, cleanEdit, parseRef, readonlyReason, isSheet } from "../src/zone-sheet.js";
import { zoneEditsLine } from "../src/zone-edit.js";
import { replyRef, replyLine } from "../src/reply-to.js";
import { cleanZone, marksNote } from "../src/zone-marks.js";

let n = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++n} - ${name}`); };
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
async function book() {
  const wb = new ExcelJS.Workbook(), a = wb.addWorksheet("Budget"), b = wb.addWorksheet("Rates");
  a.columns = [{ width: 26 }, { width: 14 }]; a.mergeCells("A1:B1"); a.getCell("A1").value = "Title"; a.getCell("A1").fill = fill("FFFFE08A");
  a.getCell("A2").value = "Units"; a.getCell("B2").value = 2; a.getCell("B2").numFmt = "0.00"; a.getCell("B3").value = { formula: "B2*3", result: 6 }; a.getCell("B3").numFmt = "$#,##0.00"; a.getCell("B3").fill = fill("FFC6EFCE");
  a.getCell("B4").value = { formula: "B3+Rates!A1", result: 7 }; b.getCell("A1").value = 1;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const load = async (bytes) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes); return wb; };

await test("addresses: cells are A1 style, within the sheet limits", () => {
  assert.deepEqual(parseRef("B4"), { r: 4, c: 2 }); assert.equal(parseRef("A0"), null); assert.equal(parseRef("XFE1"), null); assert.equal(parseRef("b4"), null);
  assert.ok(isSheet("a.xlsx") && isSheet("B.CSV") && !isSheet("a.xls") && !isSheet("a.html"));
});
await test("an edit is checked: sheet, cell, value, formula", () => {
  assert.throws(() => cleanEdit({ op: "text" })); assert.throws(() => cleanEdit({ op: "cell", sheet: "", ref: "A1", v: 1 })); assert.throws(() => cleanEdit({ op: "cell", sheet: "S", ref: "ZZZZ1", v: 1 }));
  assert.throws(() => cleanEdit({ op: "cell", sheet: "S", ref: "A1", v: { x: 1 } })); assert.throws(() => cleanEdit({ op: "cell", sheet: "S", ref: "A1", v: NaN }));
  assert.equal(cleanEdit({ op: "cell", sheet: "S", ref: "A1", f: "=SUM(B1:B2)" }).f, "SUM(B1:B2)");
  assert.equal(cleanEdit({ op: "cell", sheet: "S", ref: "A1", v: "x", results: [{ sheet: "S", ref: "bad", v: 1 }, { sheet: "S", ref: "B1", v: 2 }] }).results.length, 1);
});
await test("save: the value, the formulas' new results, styles, widths, merges and fullCalcOnLoad", async () => {
  const out = await applyXlsxEdits(await book(), [{ op: "cell", sheet: "Budget", ref: "B2", v: 5, was: "2", results: [{ sheet: "Budget", ref: "B3", v: 15 }, { sheet: "Budget", ref: "B4", v: 16 }] }]);
  const wb = await load(out.bytes), a = wb.getWorksheet("Budget");
  assert.equal(a.getCell("B2").value, 5); assert.equal(a.getCell("B3").value.formula, "B2*3"); assert.equal(a.getCell("B3").value.result, 15); assert.equal(a.getCell("B4").value.result, 16);
  assert.equal(a.getCell("B2").numFmt, "0.00"); assert.equal(a.getCell("B3").numFmt, "$#,##0.00"); assert.equal(a.getCell("B3").fill.fgColor.argb, "FFC6EFCE"); assert.equal(a.getCell("A1").fill.fgColor.argb, "FFFFE08A");
  assert.equal(a.getColumn(1).width, 26); assert.ok(a.getCell("B1").isMerged && a.getCell("B1").master.address === "A1");
  const xml = await (await JSZip.loadAsync(out.bytes)).file("xl/workbook.xml").async("string"); assert.match(xml, /<calcPr[^>]*fullCalcOnLoad="1"/);
  assert.equal(out.recs[0].sheetEdit, true);
});
await test("save: a typed formula becomes a formula, and it can be cleared", async () => {
  let out = await applyXlsxEdits(await book(), [{ op: "cell", sheet: "Rates", ref: "B1", f: "A1+1", results: [{ sheet: "Rates", ref: "B1", v: 2 }] }]);
  let wb = await load(out.bytes); assert.equal(wb.getWorksheet("Rates").getCell("B1").value.formula, "A1+1"); assert.equal(wb.getWorksheet("Rates").getCell("B1").value.result, 2);
  out = await applyXlsxEdits(out.bytes, [{ op: "cell", sheet: "Rates", ref: "B1", v: null }]); wb = await load(out.bytes); assert.equal(wb.getWorksheet("Rates").getCell("B1").value, null);
});
await test("save: a merged cell's covered cells and unknown sheets are refused", async () => {
  await assert.rejects(applyXlsxEdits(await book(), [{ op: "cell", sheet: "Budget", ref: "B1", v: 1 }]), /merged/);
  await assert.rejects(applyXlsxEdits(await book(), [{ op: "cell", sheet: "Nope", ref: "A1", v: 1 }]), /no sheet named/);
});
await test("read-only: charts, pivot tables, pictures and macros are refused, plain data is not", async () => {
  assert.equal(readonlyReason(["xl/worksheets/sheet1.xml", "xl/styles.xml"]), ""); assert.equal(readonlyReason(["xl/charts/chart1.xml"]), "charts"); assert.equal(readonlyReason(["xl/pivotTables/p.xml"]), "pivot tables"); assert.equal(readonlyReason(["xl/media/image1.png"]), "pictures"); assert.ok(readonlyReason(["xl/vbaProject.bin"]));
  const z = await JSZip.loadAsync(await book()); z.file("xl/charts/chart1.xml", "<c/>");
  await assert.rejects(applyXlsxEdits(new Uint8Array(await z.generateAsync({ type: "uint8array" })), [{ op: "cell", sheet: "Budget", ref: "B2", v: 1 }]), /charts/);
  await assert.rejects(applyXlsxEdits(new TextEncoder().encode("not a zip at all, just text"), [{ op: "cell", sheet: "Budget", ref: "B2", v: 1 }]));
});
await test("csv: only the changed cell differs, formulas are saved as values", () => {
  const src = 'a,b\r\n"x, y",2\r\nz,3\r\n', buf = new TextEncoder().encode(src);
  assert.equal(new TextDecoder().decode(applyCsvEdits(buf, [{ op: "cell", sheet: "Sheet1", ref: "B2", v: "9" }]).bytes), 'a,b\r\n"x, y",9\r\nz,3\r\n');
  assert.equal(new TextDecoder().decode(applyCsvEdits(buf, [{ op: "cell", sheet: "Sheet1", ref: "B3", f: "B2*2", results: [{ sheet: "Sheet1", ref: "B3", v: 4 }] }]).bytes), 'a,b\r\n"x, y",2\r\nz,4\r\n');
  const bom = applyCsvEdits(new TextEncoder().encode("\ufeffa;b\n1;2"), [{ op: "cell", sheet: "Sheet1", ref: "B2", v: 5 }]).bytes;
  assert.deepEqual([...bom.slice(0, 3)], [0xef, 0xbb, 0xbf]); assert.equal(new TextDecoder().decode(bom), "a;b\n1;5");   // the byte order mark and the ; delimiter stay
});
await test("the helper is told about a spreadsheet edit before it rebuilds the file", async () => {
  const out = await applySheetEdits(await book(), "b.xlsx", [{ op: "cell", sheet: "Budget", ref: "B2", v: 5, was: "2" }]);
  const store = new Map(); const R = { getRaw: (k) => store.get(k), put: (k, v) => store.set(k, v), sql: { exec: () => ({ toArray: () => [{ version: 2, name: "b.xlsx" }] }) } };
  store.set("zone_edits:11111111-1111-1111-1111-111111111111", JSON.stringify({ v: 2, deck: false, sheet: true, at: 1, edits: out.recs }));
  const line = zoneEditsLine(R, "11111111-1111-1111-1111-111111111111"); assert.match(line, /spreadsheet/); assert.match(line, /cell B2 of the sheet "Budget"/); assert.match(line, /is now "5"/);
});
await test("the pin: sheet, range and cells reach the helper as one plain line", () => {
  const ref = replyRef({ role: "zone", text: "Budget · B3:C4", zone: { file: "11111111-1111-1111-1111-111111111111", name: "b.xlsx", kind: "sheet", sheet: "Budget", range: "B3:C4", text: "B3 = 20; C3 = 1200" } });
  assert.equal(ref.zone.kind, "sheet"); assert.equal(ref.zone.range, "B3:C4"); assert.match(replyLine(ref), /^\(The person has this selected in the canvas: cells B3:C4 of the sheet "Budget" of the spreadsheet "b\.xlsx" \(Library file 1111/);
  assert.equal(replyRef({ role: "zone", text: "x", zone: { file: "11111111-1111-1111-1111-111111111111", name: "b.xlsx", kind: "sheet", sheet: "S", range: "A1" } }).zone.range, "A1");
  assert.equal(replyRef({ role: "zone", text: "x", zone: { file: "11111111-1111-1111-1111-111111111111", name: "b.xlsx", kind: "sheet", sheet: "S", range: "A1;x" } }).zone.range, null);
});
await test("the Pencil: marks on a sheet are accepted and named by sheet and cells", () => {
  const z = cleanZone({ kind: "sheet", name: "b.xlsx", of: 3, units: [{ unit: 2, w: 900, h: 500 }] }); assert.equal(z.kind, "sheet");
  const note = marksNote({ source: "s", marked: "m", zone: z, marks: [{ n: 1, color: "#d6293e", note: "Check", kind: "box", unit: 2, x: 100, y: 50, w: 200, h: 60, pct: { x: 11, y: 10, w: 22, h: 12 }, el: [{ tag: "cells", label: "cells B3:C4", text: "B3 = 20" }] }] }, { id: "1", name: "b.xlsx" }, { id: "2" });
  assert.match(note, /on sheet 2/); assert.match(note, /the cells B3:C4, reading "B3 = 20"/);
});
console.log(`${n} tests passed`);
