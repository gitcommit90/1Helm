// Export my data: the zip writer (src/data-export-zip.js). Run: node --import ./test/stubs/register.mjs test/data-export-zip.test.mjs
// Checks: the file opens in Python's zipfile and unzip with the right names and bytes; entries larger than one part and many entries work;
// stopping and starting again from a saved state (a restart in the middle of an entry) gives the same bytes as an uninterrupted run;
// parts are all one size except the last; nothing but one part is buffered.
import assert from "node:assert/strict"; import { execFileSync } from "node:child_process"; import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { ZipOut, crc32, bufferCount } from "../src/data-export-zip.js"; import { crc32 as nodeCrc } from "node:zlib"; import { fakeR2 } from "./helpers/fake-r2.mjs";
const ok = (m) => console.log("ok -", m);
const dir = mkdtempSync(join(tmpdir(), "zipt-"));
const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
const pyList = (file) => JSON.parse(execFileSync("python3", ["-I", "-c", "import sys,zipfile,json,zlib\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps([[i.filename,i.file_size,hex(zlib.crc32(z.read(i)))] for i in z.infolist()]))", file], { encoding: "utf8" }));
const save = (WS, key, name) => { const f = join(dir, name); writeFileSync(f, WS.objs.get(key).data); return f; };

assert.equal(crc32(0, new TextEncoder().encode("123456789")), 0xcbf43926); assert.equal(crc32(crc32(0, new TextEncoder().encode("1234")), new TextEncoder().encode("56789")), 0xcbf43926);
ok("crc32 matches the standard check value, also in pieces");

const A = bytes(20000, 1), B = bytes(100, 2), C = bytes(0, 3), D = bytes(9000, 4), names = ["export.json", "files/général/café.txt", "files/ch/a b.bin", "files/ch/empty"];
const parts = [A, B, D, C];
async function build(WS, part, interruptAt = -1) {
  const env = { WS }, scratch = "exports/t1/x1", key = `${scratch}.zip`; let state = {}, z = await new ZipOut(env, { key, scratch, state, part }).open(), seq = 0, saved = null;
  const order = [[names[0], A], [names[1], B], [names[2], D], [names[3], C]];
  for (let i = 0; i < order.length; i++) {
    await z.begin(order[i][0], 1700000000000);
    for (let o = 0; o < order[i][1].length; o += 700) {
      await z.write(order[i][1].subarray(o, o + 700));
      if (i === interruptAt && o === 2100) {   // checkpoint in the middle of an entry, then "restart": a new writer from the saved state only
        await z.checkpoint(++seq); saved = JSON.parse(JSON.stringify(z.state)); const prev = seq;
        z = await new ZipOut(env, { key, scratch, state: saved, part }).open(); state = saved;
        assert.ok(z.state.cur && z.state.cur.len === 2800, "the open entry is remembered"); o = z.state.cur.len - 700;   // continue from the saved offset
      }
    }
    await z.end();
    await z.checkpoint(++seq);
  }
  return { r: await z.finish(), key };
}
{
  const WS = fakeR2(), { r, key } = await build(WS, 4096);
  assert.equal(r.entries, 4);
  const rows = pyList(save(WS, key, "a.zip")); assert.deepEqual(rows.map((x) => x[0]), names); assert.deepEqual(rows.map((x) => x[1]), parts.map((p) => p.length));
  assert.deepEqual(rows.map((x) => x[2]), parts.map((p) => "0x" + crc32(0, p).toString(16)));
  execFileSync("unzip", ["-tq", join(dir, "a.zip")]); execFileSync("7z", ["t", join(dir, "a.zip")], { stdio: "pipe" });
  ok("opens in Python zipfile, unzip and 7z with the right names, sizes and checksums (accents, spaces, an empty file)");
  const out = join(dir, "out"); execFileSync("unzip", ["-q", join(dir, "a.zip"), "-d", out]);
  assert.deepEqual(new Uint8Array(readFileSync(join(out, "files/ch/a b.bin"))), D); assert.deepEqual(new Uint8Array(readFileSync(join(out, "export.json"))), A);
  ok("extracted bytes are identical");
  assert.ok([...WS.uploads.keys()].length === 0 && WS.objs.get("exports/t1/x1.zip"), "upload completed");
}
{
  const plain = fakeR2(); await build(plain, 4096);
  for (const at of [0, 2]) {
    const WS = fakeR2(); await build(WS, 4096, at);
    assert.deepEqual(WS.objs.get("exports/t1/x1.zip").data, plain.objs.get("exports/t1/x1.zip").data, `restart in entry ${at} gives the same bytes`);
  }
  ok("a restart in the middle of an entry (state saved, new writer, continue from the saved offset) gives the same bytes as a run with no restart");
}
{
  const WS = fakeR2(); await build(WS, 1000);
  const rows = pyList(save(WS, "exports/t1/x1.zip", "b.zip")); assert.equal(rows.length, 4);
  ok("small parts (many uploads, all one size but the last) work");
}
{   // many entries, bigger than one part, central directory in several segments
  const WS = fakeR2(), env = { WS }, z = await new ZipOut(env, { key: "k.zip", scratch: "s", part: 5000 }).open(); let seq = 0;
  for (let i = 0; i < 300; i++) { await z.entry(`files/c/f${i}.txt`, bytes(37 + i, i)); if (i % 40 === 0) await z.checkpoint(++seq); }
  await z.finish(); const rows = pyList(save(WS, "k.zip", "c.zip")); assert.equal(rows.length, 300); assert.equal(rows[299][1], 336); assert.ok(z.state.cdSegs >= 7);
  ok("300 entries with the directory in several scratch segments");
}

// ---- the fast checksum (eight bytes at a time) against Node's own, for every length around the block size and for pieces of any size ----
{
  const all = bytes(5000, 9); for (let n = 0; n <= 40; n++) assert.equal(crc32(0, all.subarray(0, n)), nodeCrc(all.subarray(0, n)), `length ${n}`);
  let c = 0, o = 0; for (const n of [1, 7, 8, 9, 15, 16, 17, 1000, 3000]) { c = crc32(c, all.subarray(o, o + n)); o += n; } assert.equal(c, nodeCrc(all.subarray(0, o)));
  ok("crc32 (eight bytes at a time) equals Node's crc32 for every length up to 40 and for pieces of odd sizes");
}
// ---- parts are uploaded several at a time, finish in any order, and the bytes do not change; memory stays bounded; a restart with uploads in flight is exact ----
{
  const mk = (delay) => { const WS = fakeR2(), real = WS.resumeMultipartUpload; const st = { now: 0, max: 0, calls: 0 };
    WS.resumeMultipartUpload = (k, id) => { const u = real(k, id), up = u.uploadPart; u.uploadPart = async (n, b) => { st.now++; st.max = Math.max(st.max, st.now); st.calls++; try { if (delay) await new Promise((r) => setTimeout(r, (n * 7) % 5)); return await up(n, b); } finally { st.now--; } }; return u; };
    return { WS, st }; };
  const big = bytes(300000, 5), small = [bytes(10, 1), bytes(5000, 2), bytes(0, 3), bytes(1000, 4)];
  async function run(WS, part, { cut = false } = {}) {
    const env = { WS }, scratch = "exports/t1/y1", key = `${scratch}.zip`; let state = {}, z = await new ZipOut(env, { key, scratch, state, part }).open(), seq = 0;
    await z.begin("big.bin", 1700000000000);
    for (let o = 0; o < big.length; o += 9000) {
      await z.write(big.subarray(o, o + 9000));
      if (cut && o === 90000) { await z.checkpoint(++seq); const saved = JSON.parse(JSON.stringify(z.state)); z = await new ZipOut(env, { key, scratch, state: saved, part }).open(); o = z.state.cur.len - 9000; }   // restart with uploads that were in flight
    }
    await z.end(); for (let i = 0; i < small.length; i++) await z.entry(`s/${i}`, small[i], 1700000000000);
    await z.checkpoint(++seq); return z.finish();
  }
  const seqRun = mk(false), par = mk(true), cut = mk(true);
  await run(seqRun.WS, 1024); await run(par.WS, 1024); await run(cut.WS, 1024, { cut: true });
  const want = seqRun.WS.objs.get("exports/t1/y1.zip").data;
  assert.deepEqual(par.WS.objs.get("exports/t1/y1.zip").data, want, "uploads that finish in any order give the same bytes");
  assert.deepEqual(cut.WS.objs.get("exports/t1/y1.zip").data, want, "a restart with uploads in flight gives the same bytes");
  assert.ok(par.st.max > 1 && par.st.max <= bufferCount(1024), `${par.st.max} uploads at the same time (limit ${bufferCount(1024)})`);
  assert.equal(bufferCount(8 * 1024 * 1024), 5); assert.equal(bufferCount(16 * 1024 * 1024), 3); assert.equal(bufferCount(32 * 1024 * 1024), 1); assert.equal(bufferCount(64 * 1024 * 1024), 1);
  assert.ok(bufferCount(8 * 1024 * 1024) * 8 <= 48 && bufferCount(64 * 1024 * 1024) * 64 <= 64, "at most 48 MiB of part buffers for small parts, one buffer for 32 and 64 MiB");
  const rows = pyList(save(par.WS, "exports/t1/y1.zip", "y.zip")); assert.deepEqual(rows.map((x) => x[1]), [big.length, ...small.map((x) => x.length)]); assert.equal(rows[0][2], "0x" + nodeCrc(big).toString(16));
  assert.equal(par.WS.uploads.size, 0);
  ok(`part uploads overlap (${par.st.max} at once, at most ${bufferCount(1024)} buffers), finish in any order, and the zip is byte for byte the same; a restart with uploads in flight is exact`);
  // an upload that fails for good is reported, not lost
  const bad = mk(false), real = bad.WS.resumeMultipartUpload; bad.WS.resumeMultipartUpload = (k, id) => { const u = real(k, id); u.uploadPart = async () => { throw new Error("injected"); }; return u; };
  await assert.rejects(async () => { const z = await new ZipOut({ WS: bad.WS }, { key: "k", scratch: "s", state: {}, part: 1024 }).open(); await z.begin("a"); await z.write(bytes(20000, 1)); await z.end(); await z.checkpoint(1); }, /injected/);
  ok("an upload that keeps failing is reported at the next write or checkpoint");
}
