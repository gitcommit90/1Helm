// An in-memory R2 bucket for tests: put, get (with range), head, list, delete and multipart uploads. Parts must be the same size except the last
// one, like the real bucket, so a writer that cuts parts wrongly fails here too.
export function fakeR2() {
  const objs = new Map(), uploads = new Map(); let n = 0;
  const bytesOf = (b) => typeof b === "string" ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(b);
  const obj = (key, v, range) => { const d = range ? v.data.subarray(range.offset ?? 0, range.length != null ? (range.offset ?? 0) + range.length : undefined) : v.data;
    return { key, size: v.data.length, httpEtag: `"${v.etag}"`, etag: v.etag, httpMetadata: v.meta, body: new Blob([d]).stream(), arrayBuffer: async () => d.slice().buffer, text: async () => new TextDecoder().decode(d), range }; };
  const WS = {
    objs, uploads,
    put: async (key, body, o = {}) => { const data = bytesOf(typeof body === "object" && body && body.getReader ? new Uint8Array(await new Response(body).arrayBuffer()) : body); const v = { data: data.slice(), etag: `e${++n}`, meta: o.httpMetadata }; objs.set(key, v); return { key, size: data.length }; },
    get: async (key, o = {}) => { const v = objs.get(key); if (!v) return null; let range = o.range && typeof o.range.offset === "number" ? o.range : null;
      if (o.range && typeof o.range.get === "function") { const m = /^bytes=(\d+)-(\d*)$/.exec(o.range.get("range") || ""); if (m) range = { offset: Number(m[1]), length: m[2] ? Number(m[2]) - Number(m[1]) + 1 : undefined }; }
      return obj(key, v, range); },
    head: async (key) => { const v = objs.get(key); return v ? { key, size: v.data.length, etag: v.etag } : null; },
    delete: async (k) => { for (const x of [].concat(k)) objs.delete(x); },
    list: async ({ prefix = "", cursor, limit = 1000 } = {}) => { const all = [...objs.keys()].filter((k) => k.startsWith(prefix)).sort(), s = Number(cursor || 0), page = all.slice(s, s + limit);
      return { objects: page.map((key) => ({ key, size: objs.get(key).data.length })), truncated: s + limit < all.length, cursor: String(s + limit) }; },
    createMultipartUpload: async (key) => { const id = `u${++n}`; uploads.set(id, { key, parts: new Map() }); return WS.resumeMultipartUpload(key, id); },
    resumeMultipartUpload: (key, uploadId) => ({ key, uploadId,
      uploadPart: async (pn, body) => { const u = uploads.get(uploadId); if (!u) throw new Error("no such upload"); const data = bytesOf(body).slice(); u.parts.set(pn, data); return { partNumber: pn, etag: `p${pn}-${data.length}` }; },
      abort: async () => { uploads.delete(uploadId); },
      complete: async (parts) => { const u = uploads.get(uploadId); if (!u) throw new Error("no such upload");
        const list = parts.map((p) => u.parts.get(p.partNumber)); if (list.some((x) => !x)) throw new Error("missing part");
        list.slice(0, -1).forEach((x) => { if (x.length !== list[0].length) throw new Error("R2 needs equal sized parts"); });
        const len = list.reduce((a, x) => a + x.length, 0), out = new Uint8Array(len); let p = 0; for (const x of list) { out.set(x, p); p += x.length; }
        objs.set(key, { data: out, etag: `c${++n}`, meta: undefined }); uploads.delete(uploadId); return { key, size: len }; } }),
  };
  return WS;
}
