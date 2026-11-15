// A small zip reader for the editable Word view: the parts of a .docx it needs (the document, its styles, numbering and relationships, and the pictures), read in the
// browser with its own inflate (DecompressionStream). Nothing is written back here: a change goes to the server as paragraph ops, and the server rewrites the file.
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8), u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export type ZEntry = { name: string; method: number; csize: number; usize: number; raw: Uint8Array };
export function zipEntries(buf: ArrayBuffer | Uint8Array): ZEntry[] {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) { e = i; break; }
  if (e < 0) throw new Error("That isn't a Word document.");
  const n = u16(b, e + 10), cdOff = u32(b, e + 16), out: ZEntry[] = []; let p = cdOff;
  for (let i = 0; i < n; i++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new Error("That isn't a Word document.");
    const nl = u16(b, p + 28), el = u16(b, p + 30), cl = u16(b, p + 32), lho = u32(b, p + 42), csize = u32(b, p + 20), usize = u32(b, p + 24), flags = u16(b, p + 8);
    if (flags & 1) throw new Error("An encrypted document can't be opened here.");
    if (lho + 30 > b.length || u32(b, lho) !== 0x04034b50) throw new Error("That isn't a Word document.");
    const d = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28);
    if (d + csize > b.length) throw new Error("That isn't a Word document.");
    out.push({ name: new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl)), method: u16(b, p + 10), csize, usize, raw: b.subarray(d, d + csize) });
    p += 46 + nl + el + cl;
  }
  return out;
}
/** One part's bytes, inflated; a part bigger than cap is refused. */
export async function zipRead(en: ZEntry, cap: number): Promise<Uint8Array> {
  if (en.usize > cap) throw new Error("That document is too big to edit here.");
  if (en.method === 0) return en.raw.slice();
  if (en.method !== 8) throw new Error("That document uses a compression this view can't read.");
  const ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter(); void w.write(en.raw as BufferSource).then(() => w.close()).catch(() => {});
  const rd = ds.readable.getReader(), parts: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > cap) { try { await rd.cancel(); } catch { /* stopped */ } throw new Error("That document is too big to edit here."); } parts.push(value); }
  const o = new Uint8Array(n); let k = 0; for (const x of parts) { o.set(x, k); k += x.length; } return o;
}
