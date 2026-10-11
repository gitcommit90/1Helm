// Portable row pages for SQLite-backed Durable Objects. The caller is
// responsible for freezing writes and storing every page and its manifest.
// Identifiers come from sqlite_master and are checked again on restore.
const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
const FTS_SHADOWS = new Set(["mem_fts", "mem_fts_data", "mem_fts_idx", "mem_fts_content", "mem_fts_docsize", "mem_fts_config"]);
const q = (name) => {
  if (!IDENT.test(name)) throw new Error("invalid snapshot identifier");
  return `"${name}"`;
};

const binary = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unbinary = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const pack = (value) => value instanceof ArrayBuffer ? { blob: binary(new Uint8Array(value)) }
  : ArrayBuffer.isView(value) ? { blob: binary(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) } : value;
const unpack = (value) => {
  if (value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (value && typeof value === "object" && Object.keys(value).length === 1 && typeof value.blob === "string" &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value.blob)) return unbinary(value.blob);
  throw new Error("invalid snapshot cell");
};

export function snapshotTables(sql) {
  const entries = sql.exec("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").toArray();
  const virtual = entries.filter((row) => /^CREATE VIRTUAL TABLE\b/i.test(row.sql || ""));
  if (virtual.some((row) => row.name !== "mem_fts")) throw new Error("unsupported virtual snapshot table");
  // Workerd stores platform metadata in _cf_METADATA and synchronous KV in
  // _cf_KV (older runtimes may expose __cf_kv). Local Miniflare also stores
  // its object name in __miniflare_do_name. KV is checked separately;
  // platform tables must never be copied into another object's SQL storage.
  const tables = entries.map((row) => row.name).filter((name) => !name.startsWith("sqlite_") &&
    name !== "_cf_METADATA" && name !== "_cf_KV" && name !== "__cf_kv" &&
    name !== "__miniflare_do_name" && !FTS_SHADOWS.has(name));
  if (tables.some((name) => !IDENT.test(name))) throw new Error("unsupported snapshot table name");
  return tables;
}

export function snapshotColumns(sql, table) {
  if (!snapshotTables(sql).includes(table)) throw new Error("unknown snapshot table");
  const columns = sql.exec(`PRAGMA table_info(${q(table)})`).toArray().map((row) => row.name);
  if (columns.some((name) => !IDENT.test(name))) throw new Error("unsupported snapshot column name");
  return columns;
}

export function readSnapshotPage(sql, table, after = null, limit = 100) {
  const columns = snapshotColumns(sql, table);
  if (!columns.length) throw new Error("snapshot table has no columns");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("invalid snapshot page size");
  if (after !== null && !Number.isSafeInteger(after)) throw new Error("invalid snapshot cursor");
  const rows = sql.exec(`SELECT rowid AS snapshot_rowid, * FROM ${q(table)} ${after === null ? "" : "WHERE rowid > ?"} ORDER BY rowid LIMIT ?`,
    ...(after === null ? [] : [after]), limit).toArray();
  const values = rows.map((row) => {
    if (!Number.isSafeInteger(row.snapshot_rowid)) throw new Error("snapshot rowid exceeds JavaScript integer precision");
    return { rowid: row.snapshot_rowid, values: columns.map((name) => pack(row[name])) };
  });
  return { table, columns, rows: values, next: rows.length === limit ? rows.at(-1).snapshot_rowid : null };
}

function readBoundedSnapshotPage(sql, table, columns, after) {
  const rowids = sql.exec(`SELECT rowid AS snapshot_rowid FROM ${q(table)} ${after === null ? "" : "WHERE rowid > ?"} ORDER BY rowid LIMIT 500`, ...(after === null ? [] : [after])).toArray();
  const rows = [];
  let bytes = encoder.encode(JSON.stringify({ table, columns, rows: [], next: null })).length;
  for (const item of rowids) {
    const rowid = item.snapshot_rowid;
    if (!Number.isSafeInteger(rowid)) throw new Error("snapshot rowid exceeds JavaScript integer precision");
    const source = sql.exec(`SELECT * FROM ${q(table)} WHERE rowid=?`, rowid).toArray()[0];
    if (!source) throw new Error("snapshot row changed during backup");
    const value = { rowid, values: columns.map((name) => pack(source[name])) };
    const added = encoder.encode(JSON.stringify(value)).length + (rows.length ? 1 : 0);
    if (bytes + added > MAX_OBJECT_BYTES - 128) {
      if (!rows.length) throw new Error("snapshot row exceeds page limit");
      break;
    }
    rows.push(value); bytes += added;
  }
  const next = rows.length && (rows.length < rowids.length || rowids.length === 500) ? rows.at(-1).rowid : null;
  return { table, columns, rows, next };
}

export function restoreSnapshotPage(storage, page, after = null) {
  if (!page || typeof page !== "object" || !Array.isArray(page.rows) || !Array.isArray(page.columns) || page.rows.length > 500) throw new Error("invalid snapshot page");
  const { sql } = storage;
  const columns = snapshotColumns(sql, page.table);
  if (JSON.stringify(columns) !== JSON.stringify(page.columns)) throw new Error("snapshot schema differs from destination");
  // Replaying a page after its SQL commit but before the progress object was
  // written must be safe. Restores only run behind maintenance mode.
  const insert = `INSERT OR REPLACE INTO ${q(page.table)} (rowid, ${columns.map(q).join(", ")}) VALUES (${Array(columns.length + 1).fill("?").join(", ")})`;
  return storage.transactionSync(() => {
    for (const row of page.rows) {
      if (!Number.isSafeInteger(row.rowid) || !Array.isArray(row.values) || row.values.length !== columns.length) throw new Error("invalid snapshot row");
      sql.exec(insert, row.rowid, ...row.values.map(unpack));
    }
    after?.();
    return page.rows.length;
  });
}

export function snapshotSequences(sql) {
  return sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").toArray().length
    ? sql.exec("SELECT name,seq FROM sqlite_sequence ORDER BY name").toArray().filter((row) => IDENT.test(row.name)) : [];
}

export function restoreSnapshotSequences(storage, rows) {
  if (!Array.isArray(rows)) throw new Error("invalid snapshot sequences");
  const tables = new Set(snapshotTables(storage.sql));
  return storage.transactionSync(() => {
    for (const row of rows) {
      if (!tables.has(row.name) || !Number.isSafeInteger(row.seq) || row.seq < 0) throw new Error("invalid snapshot sequence");
      storage.sql.exec("DELETE FROM sqlite_sequence WHERE name=?", row.name);
      storage.sql.exec("INSERT INTO sqlite_sequence (name,seq) VALUES (?,?)", row.name, row.seq);
    }
    return rows.length;
  });
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const digest = async (bytes) => hex(await crypto.subtle.digest("SHA-256", bytes));
const snapshotPrefix = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value)) throw new Error("invalid snapshot prefix");
  return value;
};
const putJson = async (bucket, key, value) => {
  const bytes = encoder.encode(JSON.stringify(value));
  if (bytes.length > MAX_OBJECT_BYTES) throw new Error("snapshot metadata exceeds page limit");
  await bucket.put(key, bytes, { httpMetadata: { contentType: "application/json" } });
};

// One page per RPC call keeps CPU bounded. The progress object is written
// after its page, so retrying an interrupted call safely overwrites that page.
export async function writeSnapshotStepToR2(storage, bucket, prefix, identity) {
  prefix = snapshotPrefix(prefix);
  if (!identity?.kind || !identity?.name) throw new Error("missing snapshot identity");
  if (!storage.kv?.list) throw new Error("snapshot backup requires SQLite Durable Object KV");
  for (const [key] of storage.kv.list()) if (!key.startsWith("onehelm:restore:")) throw new Error("unsupported Durable Object KV data in snapshot");
  const finalKey = `${prefix}/manifest.json`;
  const finished = await bucket.get(finalKey);
  if (finished) {
    const manifest = await readSnapshotManifest(bucket, finalKey);
    if (manifest.identity?.kind !== identity.kind || manifest.identity?.name !== identity.name) throw new Error("snapshot identity mismatch");
    return { done: true, key: finalKey, kind: identity.kind, name: identity.name };
  }
  const stateKey = `${prefix}/progress.json`;
  let state;
  const old = await bucket.get(stateKey);
  if (old) state = JSON.parse(decoder.decode(await readObject(bucket, stateKey, MAX_OBJECT_BYTES)));
  else state = { format: "onehelm-sqlite-progress-v1", identity, manifest: { format: "onehelm-sqlite-v1", identity,
    tables: snapshotTables(storage.sql).map((name) => ({ name, columns: snapshotColumns(storage.sql, name), pages: [], rows: 0 })),
    sequences: snapshotSequences(storage.sql), alarm: await storage.getAlarm() }, table: 0, after: null };
  if (state.format !== "onehelm-sqlite-progress-v1" || state.identity?.kind !== identity.kind || state.identity?.name !== identity.name ||
      !Array.isArray(state.manifest?.tables) || !Number.isSafeInteger(state.table) || state.table < 0 || state.table > state.manifest.tables.length ||
      state.after !== null && !Number.isSafeInteger(state.after))
    throw new Error("invalid snapshot progress");
  if (JSON.stringify(state.manifest.tables.map((entry) => entry.name)) !== JSON.stringify(snapshotTables(storage.sql))) throw new Error("snapshot table list changed");
  if (state.table === state.manifest.tables.length) {
    await putJson(bucket, finalKey, state.manifest);
    return { done: true, key: finalKey, kind: identity.kind, name: identity.name };
  }
  const entry = state.manifest.tables[state.table];
  if (JSON.stringify(entry.columns) !== JSON.stringify(snapshotColumns(storage.sql, entry.name)) || !Array.isArray(entry.pages)) throw new Error("snapshot schema changed");
  const page = readBoundedSnapshotPage(storage.sql, entry.name, entry.columns, state.after);
  const bytes = encoder.encode(JSON.stringify(page));
  if (bytes.length > MAX_OBJECT_BYTES) throw new Error("snapshot page exceeds limit");
  if (page.rows.length) {
    const key = `${prefix}/${entry.name}/${String(entry.pages.length).padStart(8, "0")}.json`;
    await bucket.put(key, bytes, { httpMetadata: { contentType: "application/json" } });
    entry.pages.push({ key, sha256: await digest(bytes), bytes: bytes.length, rows: page.rows.length });
    entry.rows += page.rows.length;
  }
  if (page.next === null) { state.table++; state.after = null; }
  else state.after = page.next;
  await putJson(bucket, stateKey, state);
  return { done: false, kind: identity.kind, name: identity.name, table: state.table, pages: state.manifest.tables.reduce((n, item) => n + item.pages.length, 0) };
}

// Writes the manifest last. The caller must exclude incomplete prefixes from
// recovery and keep the application quiescent until all stores are copied.
export async function writeSnapshotToR2(storage, bucket, prefix, identity) {
  prefix = snapshotPrefix(prefix);
  if (!identity || typeof identity !== "object") throw new Error("missing snapshot identity");
  const manifest = { format: "onehelm-sqlite-v1", identity, tables: [], sequences: snapshotSequences(storage.sql), alarm: await storage.getAlarm() };
  for (const table of snapshotTables(storage.sql)) {
    const entry = { name: table, columns: snapshotColumns(storage.sql, table), pages: [], rows: 0 };
    let after = null, part = 0, pageSize = 32;
    while (true) {
      const page = readSnapshotPage(storage.sql, table, after, pageSize);
      if (page.rows.length) {
        const bytes = encoder.encode(JSON.stringify(page));
        if (bytes.length > MAX_OBJECT_BYTES) {
          if (pageSize === 1) throw new Error("snapshot row exceeds page limit");
          pageSize = Math.max(1, Math.floor(pageSize / 2));
          continue;
        }
        const key = `${prefix}/${table}/${String(part).padStart(8, "0")}.json`;
        await bucket.put(key, bytes, { httpMetadata: { contentType: "application/json" } });
        entry.pages.push({ key, sha256: await digest(bytes), bytes: bytes.length, rows: page.rows.length });
        entry.rows += page.rows.length;
        part++;
        if (bytes.length < MAX_OBJECT_BYTES / 4 && pageSize < 100) pageSize = Math.min(100, pageSize * 2);
      }
      if (page.next === null) break;
      after = page.next;
    }
    manifest.tables.push(entry);
  }
  const key = `${prefix}/manifest.json`;
  const bytes = encoder.encode(JSON.stringify(manifest));
  if (bytes.length > MAX_OBJECT_BYTES) throw new Error("snapshot manifest exceeds page limit");
  await bucket.put(key, bytes, { httpMetadata: { contentType: "application/json" } });
  return { key, manifest };
}

async function readObject(bucket, key, maxBytes) {
  const object = await bucket.get(key);
  if (!object) throw new Error(`missing snapshot object: ${key}`);
  if (object.size > maxBytes) throw new Error("snapshot object too large");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error("snapshot object too large");
  return bytes;
}

export async function readSnapshotManifest(bucket, key) {
  if (typeof key !== "string" || !key.endsWith("/manifest.json") || !snapshotPrefix(key.slice(0, -"/manifest.json".length))) throw new Error("invalid snapshot manifest key");
  const manifest = JSON.parse(decoder.decode(await readObject(bucket, key, MAX_OBJECT_BYTES)));
  if (manifest?.format !== "onehelm-sqlite-v1" || !Array.isArray(manifest.tables) || !Array.isArray(manifest.sequences)) throw new Error("unsupported snapshot manifest");
  return manifest;
}

export async function readVerifiedSnapshotPage(bucket, descriptor) {
  if (!descriptor || typeof descriptor.key !== "string" || !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
      !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 0 || descriptor.bytes > MAX_OBJECT_BYTES) throw new Error("invalid snapshot descriptor");
  const bytes = await readObject(bucket, descriptor.key, descriptor.bytes);
  if (bytes.length !== descriptor.bytes || await digest(bytes) !== descriptor.sha256) throw new Error("snapshot page checksum mismatch");
  return JSON.parse(decoder.decode(bytes));
}

// Restore only into a quiescent, isolated destination. Preflight every page
// before clearing tables; a retry clears partial data left by an interrupted
// restore. The caller must restart the Durable Object after this completes.
export async function restoreSnapshotFromR2(storage, bucket, manifestKey, expectedIdentity) {
  const manifest = await readSnapshotManifest(bucket, manifestKey);
  if (!expectedIdentity || manifest.identity?.kind !== expectedIdentity.kind || manifest.identity?.name !== expectedIdentity.name) throw new Error("snapshot identity mismatch");
  const prefix = manifestKey.slice(0, -"/manifest.json".length);
  const tables = snapshotTables(storage.sql);
  if (JSON.stringify(manifest.tables.map((entry) => entry.name)) !== JSON.stringify(tables)) throw new Error("snapshot table list differs from destination");
  if (manifest.alarm !== null && (!Number.isSafeInteger(manifest.alarm) || manifest.alarm < 0)) throw new Error("invalid snapshot alarm");
  if (manifest.sequences.some((row) => !tables.includes(row.name) || !Number.isSafeInteger(row.seq) || row.seq < 0)) throw new Error("invalid snapshot sequence");
  for (const entry of manifest.tables) {
    if (JSON.stringify(entry.columns) !== JSON.stringify(snapshotColumns(storage.sql, entry.name)) || !Array.isArray(entry.pages) || !Number.isSafeInteger(entry.rows) || entry.rows < 0) throw new Error("invalid snapshot table entry");
    let count = 0, last = null;
    for (const [part, descriptor] of entry.pages.entries()) {
      if (descriptor.key !== `${prefix}/${entry.name}/${String(part).padStart(8, "0")}.json`) throw new Error("snapshot page outside table");
      const page = await readVerifiedSnapshotPage(bucket, descriptor);
      if (page.table !== entry.name || JSON.stringify(page.columns) !== JSON.stringify(entry.columns) || !Array.isArray(page.rows) ||
          page.rows.length !== descriptor.rows || !page.rows.length || page.rows.length > 500) throw new Error("invalid snapshot page contents");
      for (const row of page.rows) {
        if (!Number.isSafeInteger(row.rowid) || (last !== null && row.rowid <= last)) throw new Error("snapshot row order invalid");
        if (!Array.isArray(row.values) || row.values.length !== entry.columns.length) throw new Error("invalid snapshot row");
        row.values.forEach(unpack);
        last = row.rowid;
      }
      count += page.rows.length;
    }
    if (count !== entry.rows) throw new Error("snapshot row count mismatch");
  }
  storage.transactionSync(() => {
    for (const table of tables) {
      storage.sql.exec(`DELETE FROM ${q(table)}`);
      if (manifest.sequences.some((row) => row.name === table)) storage.sql.exec("DELETE FROM sqlite_sequence WHERE name=?", table);
    }
  });
  for (const entry of manifest.tables) for (const descriptor of entry.pages) {
    const page = await readVerifiedSnapshotPage(bucket, descriptor);
    restoreSnapshotPage(storage, page);
  }
  restoreSnapshotSequences(storage, manifest.sequences);
  const hasMemoryFts = storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mem_fts'").toArray().length;
  if (hasMemoryFts) storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM mem_fts");
    storage.sql.exec("INSERT INTO mem_fts (text,id) SELECT COALESCE(source,'') || ' ' || text,id FROM mem_rows");
  });
  if (manifest.alarm === null) await storage.deleteAlarm();
  else await storage.setAlarm(manifest.alarm);
  return { tables: tables.length, rows: manifest.tables.reduce((sum, entry) => sum + entry.rows, 0), alarm: manifest.alarm };
}

// The restore cursor lives in this Durable Object's synchronous KV storage,
// not in the copied R2 bucket. SQL pages and cursor advances commit together.
// A fresh target therefore starts at preflight even if the source was restored
// from the same backup at an earlier time.
export async function restoreSnapshotStepFromR2(storage, bucket, manifestKey, expectedIdentity) {
  const manifest = await readSnapshotManifest(bucket, manifestKey);
  if (!expectedIdentity || manifest.identity?.kind !== expectedIdentity.kind || manifest.identity?.name !== expectedIdentity.name) throw new Error("snapshot identity mismatch");
  const prefix = manifestKey.slice(0, -"/manifest.json".length);
  const tables = snapshotTables(storage.sql);
  if (JSON.stringify(manifest.tables.map((entry) => entry.name)) !== JSON.stringify(tables)) throw new Error("snapshot table list differs from destination");
  if (manifest.alarm !== null && (!Number.isSafeInteger(manifest.alarm) || manifest.alarm < 0)) throw new Error("invalid snapshot alarm");
  if (manifest.sequences.some((row) => !tables.includes(row.name) || !Number.isSafeInteger(row.seq) || row.seq < 0)) throw new Error("invalid snapshot sequence");
  if (!storage.kv?.get || !storage.kv?.put) throw new Error("snapshot restore requires SQLite Durable Object KV");
  const hash = await digest(encoder.encode(JSON.stringify(manifest)));
  const stateKey = `onehelm:restore:${manifestKey}`;
  const state = storage.kv.get(stateKey) || { hash, phase: "preflight", table: 0, page: 0, count: 0, last: null };
  if (state.hash !== hash || !["preflight", "clear", "apply", "finish", "alarm", "done"].includes(state.phase) ||
      !Number.isSafeInteger(state.table) || state.table < 0 || state.table > tables.length ||
      !Number.isSafeInteger(state.page) || state.page < 0 ||
      state.phase === "preflight" && (!Number.isSafeInteger(state.count) || state.count < 0 || state.last !== null && !Number.isSafeInteger(state.last)))
    throw new Error("invalid snapshot restore progress");
  const result = { done: false, phase: state.phase, table: state.table, page: state.page };
  if (state.phase === "done") return { done: true, tables: tables.length, rows: manifest.tables.reduce((sum, entry) => sum + entry.rows, 0), alarm: manifest.alarm };
  if (state.phase === "preflight") {
    if (state.table === tables.length) { storage.kv.put(stateKey, { hash, phase: "clear", table: 0, page: 0 }); return { ...result, phase: "clear" }; }
    const entry = manifest.tables[state.table];
    if (JSON.stringify(entry.columns) !== JSON.stringify(snapshotColumns(storage.sql, entry.name)) || !Array.isArray(entry.pages) ||
        !Number.isSafeInteger(entry.rows) || entry.rows < 0) throw new Error("invalid snapshot table entry");
    if (state.page === entry.pages.length) {
      if (state.count !== entry.rows) throw new Error("snapshot row count mismatch");
      storage.kv.put(stateKey, { hash, phase: "preflight", table: state.table + 1, page: 0, count: 0, last: null });
      return result;
    }
    if (state.page > entry.pages.length) throw new Error("invalid snapshot restore cursor");
    const descriptor = entry.pages[state.page];
    if (descriptor.key !== `${prefix}/${entry.name}/${String(state.page).padStart(8, "0")}.json`) throw new Error("snapshot page outside table");
    const page = await readVerifiedSnapshotPage(bucket, descriptor);
    if (page.table !== entry.name || JSON.stringify(page.columns) !== JSON.stringify(entry.columns) || !Array.isArray(page.rows) ||
        page.rows.length !== descriptor.rows || !page.rows.length || page.rows.length > 500) throw new Error("invalid snapshot page contents");
    let last = state.last;
    for (const row of page.rows) {
      if (!Number.isSafeInteger(row.rowid) || (last !== null && row.rowid <= last) || !Array.isArray(row.values) ||
          row.values.length !== entry.columns.length) throw new Error("invalid snapshot row");
      row.values.forEach(unpack); last = row.rowid;
    }
    storage.kv.put(stateKey, { hash, phase: "preflight", table: state.table, page: state.page + 1, count: state.count + page.rows.length, last });
    return result;
  }
  if (state.phase === "clear") {
    storage.transactionSync(() => {
      for (const table of tables) storage.sql.exec(`DELETE FROM ${q(table)}`);
      storage.kv.put(stateKey, { hash, phase: "apply", table: 0, page: 0 });
    });
    return { ...result, phase: "apply" };
  }
  if (state.phase === "apply") {
    if (state.table === tables.length) { storage.kv.put(stateKey, { hash, phase: "finish", table: state.table, page: 0 }); return { ...result, phase: "finish" }; }
    const entry = manifest.tables[state.table];
    if (!Array.isArray(entry.pages) || state.page > entry.pages.length) throw new Error("invalid snapshot restore cursor");
    if (state.page === entry.pages.length) {
      storage.kv.put(stateKey, { hash, phase: "apply", table: state.table + 1, page: 0 });
      return result;
    }
    const descriptor = entry.pages[state.page];
    if (descriptor.key !== `${prefix}/${entry.name}/${String(state.page).padStart(8, "0")}.json`) throw new Error("snapshot page outside table");
    const page = await readVerifiedSnapshotPage(bucket, descriptor);
    if (page.table !== entry.name || JSON.stringify(page.columns) !== JSON.stringify(entry.columns) || page.rows.length !== descriptor.rows) throw new Error("invalid snapshot page contents");
    restoreSnapshotPage(storage, page, () => storage.kv.put(stateKey, { hash, phase: "apply", table: state.table, page: state.page + 1 }));
    return result;
  }
  if (state.phase === "finish") {
    storage.transactionSync(() => {
      for (const row of manifest.sequences) {
        storage.sql.exec("DELETE FROM sqlite_sequence WHERE name=?", row.name);
        storage.sql.exec("INSERT INTO sqlite_sequence (name,seq) VALUES (?,?)", row.name, row.seq);
      }
      if (storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mem_fts'").toArray().length) {
        storage.sql.exec("DELETE FROM mem_fts");
        storage.sql.exec("INSERT INTO mem_fts (text,id) SELECT COALESCE(source,'') || ' ' || text,id FROM mem_rows");
      }
      storage.kv.put(stateKey, { hash, phase: "alarm", table: tables.length, page: 0 });
    });
    return { ...result, phase: "alarm" };
  }
  if (manifest.alarm === null) await storage.deleteAlarm();
  else await storage.setAlarm(manifest.alarm);
  storage.kv.put(stateKey, { hash, phase: "done", table: tables.length, page: 0 });
  return { done: true, tables: tables.length, rows: manifest.tables.reduce((sum, entry) => sum + entry.rows, 0), alarm: manifest.alarm };
}

// RPC is reachable only through a Worker binding. The gateway must validate
// the backup token, enumerate known object names, and keep writes stopped.
export function installSnapshotRpc(Class, kind, busy = () => false) {
  Class.prototype.snapshotBackupStep = async function (prefix, name) {
    if (this.env?.ENV_NAME !== "selfhost" || this.env?.BACKUP_MAINTENANCE !== "1" || !this.env.WS) throw new Error("snapshot unavailable");
    if ((kind === "Computer" || kind === "ChannelComputer" || kind === "NativeTransport") &&
        !(await this.env.WS.get(`${prefix}/progress.json`)) && !(await this.env.WS.get(`${prefix}/manifest.json`))) await this.snapshotPrepare();
    if (busy(this)) throw new Error("object is busy; stop writes and retry backup");
    return writeSnapshotStepToR2(this.ctx.storage, this.env.WS, prefix, { kind, name });
  };
  Class.prototype.snapshotRestoreStep = async function (key, name) {
    if (this.env?.ENV_NAME !== "selfhost" || this.env?.BACKUP_MAINTENANCE !== "1" || this.env?.BACKUP_RESTORE_MODE !== "1" || !this.env.WS) throw new Error("snapshot unavailable");
    if (busy(this)) throw new Error("object is busy; stop writes and retry restore");
    return restoreSnapshotStepFromR2(this.ctx.storage, this.env.WS, key, { kind, name });
  };
}
