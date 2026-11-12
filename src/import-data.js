// Bounds for a legacy Cloud archive import. Large files remain streamable; one
// malformed compressed object cannot grow a Worker buffer without a limit.
export const IMPORT_MAX_EXPANDED = 1024 * 1024 * 1024;
export const IMPORT_MAX_LINE = 4 * 1024 * 1024;
export const IMPORT_MAX_MANIFEST = 1024 * 1024;
const BATCH_MAX_CHARS = 8 * 1024 * 1024;
const NAME = /^[a-z0-9._-]{1,80}$/;
const SHA = /^[0-9a-f]{64}$/i;
// The app uses channel slugs in URL paths and HTML attributes. A legacy archive is untrusted input,
// even when its importer has a valid owner token; reject rows that cannot be routed safely.
const CHANNEL_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const record = (r) => r && typeof r === "object" && !Array.isArray(r);

export async function readImportManifest(req) {
  const claimed = req.headers.get("content-length");
  if (claimed != null && (!Number.isSafeInteger(Number(claimed)) || Number(claimed) > IMPORT_MAX_MANIFEST || Number(claimed) < 0))
    throw new Error("import manifest exceeds 1 MiB");
  if (!req.body) throw new Error("import manifest is missing");
  const reader = req.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMPORT_MAX_MANIFEST) throw new Error("import manifest exceeds 1 MiB");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("invalid import manifest JSON"); }
}

export function validateImportManifest(manifest) {
  if (!record(manifest) || !record(manifest.objects) || !record(manifest.rows)) return "invalid import manifest";
  const objects = Object.entries(manifest.objects), rows = Object.entries(manifest.rows);
  if (!objects.length || !rows.length || !Object.hasOwn(manifest.objects, "data.jsonl.gz")) return "import manifest is incomplete";
  if (objects.length > 1000 || rows.length > 64) return "import manifest has too many entries";
  for (const [name, spec] of objects) {
    if (!NAME.test(name) || !record(spec) || !Number.isSafeInteger(spec.bytes) || spec.bytes < 0 ||
        !SHA.test(String(spec.sha256 || "")) || spec.kind !== (name === "data.jsonl.gz" ? "data" : "files")) return `invalid import object: ${name}`;
    if (spec.kind === "files" && (spec.files != null && (!Number.isSafeInteger(spec.files) || spec.files < 0)))
      return `invalid file layer: ${name}`;
  }
  for (const [table, count] of rows)
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(table) || !Number.isSafeInteger(count) || count < 0) return `invalid row count: ${table}`;
  return null;
}

const validRow = (r) => record(r) && /^[a-z][a-z0-9_]{0,63}$/.test(r.t) && record(r.r) &&
  (typeof (r.r.id ?? r.r.agent_id) === "string" || typeof (r.r.id ?? r.r.agent_id) === "number") &&
  (r.r.channel_id == null || typeof r.r.channel_id === "string" || typeof r.r.channel_id === "number") &&
  (r.t !== "channels" || r.r.kind === "dm" || (typeof (r.r.slug || r.r.name) === "string" && CHANNEL_SLUG.test(r.r.slug || r.r.name)));

export async function readImportRows(body, onBatch, expectedSha) {
  if (!body) throw new Error("import data is missing");
  let digest, hashWriter;
  if (expectedSha) {
    digest = new crypto.DigestStream("SHA-256");
    hashWriter = digest.getWriter();
    body = body.pipeThrough(new TransformStream({
      async transform(chunk, controller) { await hashWriter.write(chunk); controller.enqueue(chunk); },
      async flush() { await hashWriter.close(); },
    }));
  }
  const reader = body.pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream("utf-8", { fatal: true })).getReader();
  let buf = "", batch = [], batchChars = 0, expanded = 0, loaded = 0;
  const flush = async () => { if (!batch.length) return; await onBatch(batch); loaded += batch.length; batch = []; batchChars = 0; };
  const lineIn = async (line) => {
    if (!line.trim()) return;
    if (line.length > IMPORT_MAX_LINE) throw new Error("import record exceeds 4 MiB");
    const row = JSON.parse(line);
    if (!validRow(row)) throw new Error("invalid import record");
    batch.push(row); batchChars += line.length;
    if (batch.length >= 400 || batchChars >= BATCH_MAX_CHARS) await flush();
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) {
        expanded += value.length;
        if (expanded > IMPORT_MAX_EXPANDED) throw new Error("import data exceeds 1 GiB expanded");
        buf += value;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) { await lineIn(buf.slice(0, i)); buf = buf.slice(i + 1); }
        if (buf.length > IMPORT_MAX_LINE) throw new Error("import record exceeds 4 MiB");
      }
      if (done) break;
    }
    if (buf.trim()) await lineIn(buf);
    await flush();
    if (digest) {
      const got = Array.from(new Uint8Array(await digest.digest), (x) => x.toString(16).padStart(2, "0")).join("");
      if (got !== expectedSha.toLowerCase()) throw new Error("import data checksum mismatch");
    }
    return loaded;
  } finally { if (hashWriter) await hashWriter.abort().catch(() => {}); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
