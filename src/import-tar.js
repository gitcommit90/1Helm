// Inspect an imported gzip tar before the Computer extracts it under /workspace.
// The legacy workspace export contains regular files, directories, and sometimes
// hard links. Archive bytes are streamed; only one header or a bounded name
// extension is held in memory.
const BLOCK = 512;
const MAX_EXTENSION = 1024 * 1024;
const MAX_ENTRIES = 1000000;
const text = new TextDecoder("utf-8", { fatal: true });
const hex = (bytes) => Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, "0")).join("");

function field(bytes, start, length) {
  const part = bytes.subarray(start, start + length);
  const end = part.indexOf(0);
  return text.decode(end < 0 ? part : part.subarray(0, end));
}

function number(bytes, start, length) {
  const part = bytes.subarray(start, start + length);
  if (part[0] & 0x80) {
    if (part[0] & 0x40) throw new Error("negative tar number");
    let n = BigInt(part[0] & 0x3f);
    for (let i = 1; i < part.length; i++) n = (n << 8n) | BigInt(part[i]);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("tar number too large");
    return Number(n);
  }
  const raw = field(bytes, start, length).trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error("invalid tar number");
  const n = parseInt(raw, 8);
  if (!Number.isSafeInteger(n)) throw new Error("tar number too large");
  return n;
}

function safePath(path) {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0")) throw new Error("unsafe tar path");
  if (path === "." || path === "./") return ".";
  const parts = path.replace(/\/+$/, "").split("/");
  if (parts.some((part) => part === ".." || part === "")) throw new Error("unsafe tar path");
  const clean = parts.filter((part) => part !== ".").join("/");
  if (!clean || clean.length > 4096) throw new Error("unsafe tar path");
  return clean;
}

function paxPath(bytes) {
  let at = 0, path = null;
  while (at < bytes.length) {
    const space = bytes.indexOf(32, at);
    if (space < 0 || space - at > 10) throw new Error("invalid tar extension");
    const lenText = text.decode(bytes.subarray(at, space));
    if (!/^[1-9][0-9]*$/.test(lenText)) throw new Error("invalid tar extension");
    const end = at + Number(lenText);
    if (end > bytes.length || bytes[end - 1] !== 10 || space >= end - 1) throw new Error("invalid tar extension");
    const pair = text.decode(bytes.subarray(space + 1, end - 1));
    const equal = pair.indexOf("=");
    if (equal < 1) throw new Error("invalid tar extension");
    const key = pair.slice(0, equal), value = pair.slice(equal + 1);
    if (key === "path") path = value;
    else if (!/^(?:mtime|atime|ctime|uid|gid|uname|gname|comment|charset)$/.test(key)) throw new Error("unsupported tar extension");
    at = end;
  }
  return path;
}

class TarInspector {
  constructor() { this.state = "header"; this.buf = new Uint8Array(BLOCK); this.used = 0; this.left = 0; this.pad = 0; this.zeroes = 0; this.entries = 0; this.extension = null; this.pendingPath = null; this.extPending = false; }
  header(bytes) {
    if (bytes.every((b) => b === 0)) { this.zeroes++; if (this.zeroes >= 2) this.state = "end"; return; }
    if (this.zeroes) throw new Error("invalid tar ending");
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : bytes[i];
    if (sum !== number(bytes, 148, 8)) throw new Error("tar header checksum mismatch");
    const size = number(bytes, 124, 12), type = String.fromCharCode(bytes[156]);
    const prefix = field(bytes, 345, 155), rawName = field(bytes, 0, 100);
    let path = this.pendingPath ?? (prefix ? `${prefix}/${rawName}` : rawName);
    if (type === "x" || type === "L") {
      if (size > MAX_EXTENSION || this.extension) throw new Error("tar extension too large");
      this.extension = { type, bytes: new Uint8Array(size), used: 0 };
      this.extPending = true;
    } else {
      this.pendingPath = null; this.extPending = false;
      if (++this.entries > MAX_ENTRIES) throw new Error("too many tar entries");
      path = safePath(path);
      if (path === "." && type !== "5") throw new Error("unsafe tar path");
      if (type === "0" || type === "\0") { /* ordinary file */ }
      else if (type === "5") { if (size) throw new Error("invalid tar directory"); }
      else if (type === "1") {
        if (size) throw new Error("unsafe tar hard link");
        safePath(field(bytes, 157, 100));
      } else throw new Error("unsupported tar entry type");
    }
    this.left = size; this.pad = (BLOCK - size % BLOCK) % BLOCK;
    this.state = this.left ? "body" : this.pad ? "padding" : "header";
    if (!this.left && this.extension) this.finishExtension();
  }
  finishExtension() {
    const ext = this.extension;
    if (!ext) return;
    if (ext.type === "x") this.pendingPath = paxPath(ext.bytes) ?? this.pendingPath;
    else {
      const end = ext.bytes.indexOf(0);
      this.pendingPath = text.decode(end < 0 ? ext.bytes : ext.bytes.subarray(0, end));
    }
    this.extension = null;
  }
  push(chunk) {
    let at = 0;
    while (at < chunk.length) {
      if (this.state === "end") { if (chunk.subarray(at).some((b) => b !== 0)) throw new Error("data after tar ending"); return; }
      if (this.state === "header") {
        const n = Math.min(BLOCK - this.used, chunk.length - at);
        this.buf.set(chunk.subarray(at, at + n), this.used); this.used += n; at += n;
        if (this.used === BLOCK) { this.used = 0; this.header(this.buf); }
      } else if (this.state === "body") {
        const n = Math.min(this.left, chunk.length - at);
        if (this.extension) { this.extension.bytes.set(chunk.subarray(at, at + n), this.extension.used); this.extension.used += n; }
        this.left -= n; at += n;
        if (!this.left) { this.finishExtension(); this.state = this.pad ? "padding" : "header"; }
      } else {
        const n = Math.min(this.pad, chunk.length - at);
        if (chunk.subarray(at, at + n).some((b) => b !== 0)) throw new Error("invalid tar padding");
        this.pad -= n; at += n;
        if (!this.pad) this.state = "header";
      }
    }
  }
  finish() {
    if (this.state !== "end" || this.used || this.extension || this.extPending || !this.entries) throw new Error("incomplete tar layer");
  }
}

export async function verifyImportLayer(body, expectedSha, renew) {
  const digest = new crypto.DigestStream("SHA-256"), hashWriter = digest.getWriter(), inspector = new TarInspector();
  const source = body.getReader(), gzip = new DecompressionStream("gzip"), gzipWriter = gzip.writable.getWriter(), reader = gzip.readable.getReader();
  let renewed = Date.now();
  const pumping = (async () => {
    try {
      for (;;) {
        const { value, done } = await source.read(); if (done) break;
        await hashWriter.write(value);
        await gzipWriter.write(value);
        if (Date.now() - renewed >= 60000) { await renew(); renewed = Date.now(); }
      }
      await gzipWriter.close();
      await hashWriter.close();
    } catch (e) {
      await Promise.allSettled([gzipWriter.abort(e), hashWriter.abort(e)]);
      throw e;
    }
  })();
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; inspector.push(value); }
    await pumping;
    inspector.finish();
    if (hex(await digest.digest) !== expectedSha.toLowerCase()) throw new Error("checksum mismatch");
  } catch (e) {
    await Promise.allSettled([source.cancel(e), reader.cancel(e), gzipWriter.abort(e), hashWriter.abort(e)]);
    await pumping.catch(() => {});
    throw e;
  } finally {
    source.releaseLock(); gzipWriter.releaseLock(); reader.releaseLock(); hashWriter.releaseLock();
  }
}
