// node --import ./test/stubs/register.mjs test/zone-marks.test.mjs
// Pencil marks on any file in the Zone (src/zone-marks.js, image-gen.js prepareImageSend / cleanAnnotations, tracker.js annotationsOut). No model is called.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../src/resident.js";   // first: resume.js and resident.js import each other
import { DatabaseSync } from "node:sqlite";
import { prepareImageSend, cleanAnnotations, imageModeOf, ANNOTATION_TAG } from "../src/ee/image-gen.js";
import { annotationsOut } from "../src/tracker.js";
import { markWhere, marksNote } from "../src/zone-marks.js";

let n = 0; const test = async (name, fn) => { await fn(); console.log(`ok ${++n} - ${name}`); };
const U = (k) => `00000000-0000-4000-8000-00000000000${k}`;
function world() {
  const db = new DatabaseSync(":memory:"), sql = { exec(q, ...a) { const s = db.prepare(q), rows = /^\s*SELECT/i.test(q) ? s.all(...a) : (s.run(...a), []); return { toArray: () => rows }; } };
  sql.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, image_mode TEXT)"); sql.exec("INSERT INTO sessions (id,title) VALUES ('s1','t')");
  sql.exec("CREATE TABLE files (id TEXT PRIMARY KEY, name TEXT, mime TEXT, deleted INTEGER DEFAULT 0, tags TEXT DEFAULT '[]')");
  const add = (id, name, mime) => sql.exec("INSERT INTO files (id,name,mime) VALUES (?,?,?)", id, name, mime);
  add(U(1), "Q3 plan.html", "text/html"); add(U(2), "marked.png", "image/png"); add(U(3), "ridge.png", "image/png"); add(U(4), "report.pdf", "application/pdf");
  return { R: { sql }, sql };
}
const dot = { n: 1, color: "#d6293e", note: "make this bigger", kind: "point", unit: 2, x: 640.04, y: 312, w: 0, h: 0, pct: { x: 33.333, y: 28.889, w: 0, h: 0 }, el: [{ slot: "title", n: 0, tag: "h1", label: "Title", text: "Q3 plan" }] };
const box = { n: 2, color: "#2563eb", note: "", kind: "box", unit: 2, x: 100, y: 400, w: 500, h: 200, pct: { x: 5.21, y: 37.04, w: 26.04, h: 18.52 }, el: [{ sel: "0/2/1", tag: "p", text: 'says "hi"' }] };
const deckZone = { kind: "deck", name: "Q3 plan.html", of: 5, units: [{ unit: 2, w: 1920, h: 1080 }] };
const body = (over = {}) => ({ source: U(1), marked: U(2), marks: [dot, box], zone: deckZone, ...over });

await test("the route keeps the coordinates, the kind, the elements and the file facts, and rejects wrong ones", () => {
  const c = cleanAnnotations(body());
  assert.deepEqual(c.marks[0], { n: 1, color: "#d6293e", note: "make this bigger", kind: "point", unit: 2, x: 640, y: 312, w: 0, h: 0, pct: { x: 33.33, y: 28.89, w: 0, h: 0 }, el: [{ tag: "h1", slot: "title", n: 0, label: "Title", text: "Q3 plan" }] });
  assert.equal(c.marks[1].kind, "box"); assert.equal(c.marks[1].el[0].sel, "0/2/1"); assert.equal(c.marks[1].el[0].text, "says 'hi'");
  assert.deepEqual(c.zone, { kind: "deck", name: "Q3 plan.html", of: 5, units: [{ unit: 2, w: 1920, h: 1080 }] });
  assert.equal(cleanAnnotations(body({ marks: [{ ...dot, kind: "blob" }] })), null, "an unknown kind");
  assert.equal(cleanAnnotations(body({ marks: [{ ...dot, x: "far" }] })), null, "a coordinate that is not a number");
  assert.equal(cleanAnnotations(body({ marks: [{ ...dot, x: NaN }] })), null);
  assert.equal(cleanAnnotations(body({ zone: { ...deckZone, kind: "movie" } })), null);
  assert.deepEqual(cleanAnnotations({ source: U(1), marked: U(2), marks: [{ n: 1, color: "red" }] }).marks, [{ n: 1, color: "red", note: "" }], "an old image-editor mark stays as it was");
});

await test("a deck: no image mode, the marked screenshot is attached and tagged, and the helper gets plain lines with point, box, slide, pixels, percent and elements", () => {
  const w = world(), r = prepareImageSend(w.R, "s1", { files: [], annotations: cleanAnnotations(body()) }, true);
  assert.equal(r.error, undefined); assert.equal(imageModeOf(w.sql, "s1"), null, "marking a deck never turns image mode on");
  assert.deepEqual(r.opts.files, [U(2)]); assert.deepEqual(JSON.parse(w.sql.exec("SELECT tags FROM files WHERE id=?", U(2)).toArray()[0].tags), [ANNOTATION_TAG]);
  const lines = r.opts.note.split("\n");
  assert.match(lines[0], /The person marked up the file Q3 plan\.html \(Library file 00000000-0000-4000-8000-000000000001, 5 slides\)/);
  assert.match(lines[0], /screenshot of what they were looking at/); assert.match(lines[0], /a slide is 1920 by 1080/);
  assert.equal(lines[1], 'Mark 1, a point on slide 2 at x 640, y 312 (33.33% across, 28.89% down). Note: "make this bigger". Under it: the Title (data-slot "title"), reading "Q3 plan".');
  assert.equal(lines[2], "Mark 2, a box on slide 2 from x 100, y 400, 500 wide and 200 tall (5.21% across and 37.04% down, 26.04% wide and 18.52% tall). No note. Inside it: a p (path 0/2/1), reading \"says 'hi'\".");
  assert.equal(r.opts.marksOut.marks.length, 2); assert.equal(r.opts.marksOut.zone.kind, "deck");
});

await test("the same send works on a plan without image generation (imageOk false), for a picture too, and a missing file is a 404", () => {
  const w = world(), pic = body({ source: U(3), zone: { kind: "image", name: "ridge.png", of: null, units: [{ unit: 1, w: 1200, h: 800 }] }, marks: [{ ...dot, unit: 1, el: undefined }] });
  const r = prepareImageSend(w.R, "s1", { annotations: cleanAnnotations(pic) }, false);
  assert.equal(r.error, undefined); assert.equal(imageModeOf(w.sql, "s1"), null); assert.doesNotMatch(r.opts.note, /image_edit/); assert.match(r.opts.note, /a point at x 640, y 312/);
  const on = prepareImageSend(w.R, "s1", { annotations: cleanAnnotations(pic) }, true);
  assert.equal(imageModeOf(w.sql, "s1"), "on", "with image generation the picture editor works as before"); assert.match(on.opts.note, /Make the change with image_edit/); assert.match(on.opts.note, /1 \(#d6293e\): make this bigger; a point at x 640/); assert.ok(on.opts.imageEdit.zone);
  assert.equal(prepareImageSend(w.R, "s1", { annotations: { source: U(9), marked: U(2), marks: [] } }, false).status, 404);
  assert.equal(prepareImageSend(w.R, "s1", { annotations: { source: U(1), marked: U(4), marks: [] } }, false).status, 404, "the marked screenshot has to be a picture");
});

await test("a page and a document use the unit words, and the stored message keeps every field", () => {
  const z = { kind: "report", name: "r.pdf", of: 3, units: [{ unit: 3, w: 612, h: 792 }] };
  assert.equal(markWhere({ kind: "point", unit: 3, x: 10, y: 20 }, z), "a point on page 3 at x 10, y 20");
  assert.equal(markWhere({ kind: "box", unit: 1, x: 1, y: 2, w: 3, h: 4 }, { kind: "page" }), "a box from x 1, y 2, 3 wide and 4 tall");
  assert.match(marksNote({ source: U(4), marked: U(2), zone: z, marks: [] }, { id: U(4), name: "r.pdf" }, { id: U(2) }), /3 pages\)/);
  const out = annotationsOut(cleanAnnotations(body()));
  assert.equal(out.marks[0].x, 640); assert.equal(out.marks[1].h, 200); assert.equal(out.zone.of, 5); assert.equal(out.marks[0].el[0].slot, "title");
  assert.equal(annotationsOut({ source: "x", marked: "y", marks: [] }), null);
});

await test("the chat route lets marks through on every plan: only image: true needs image generation", () => {
  const src = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
  assert.match(src, /if \(opts\.image && !imgOk\) return \{ error: "Image generation isn't available on this plan\."/);
  assert.doesNotMatch(src, /\(opts\.image \|\| opts\.annotations\) && !\(await imageAllowed/);
  assert.match(src, /prepareImageSend\(this, s\.id, opts, imgOk\)/);
});
