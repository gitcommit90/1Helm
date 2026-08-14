#!/usr/bin/env node
import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { constants } from "node:zlib";

const root = resolve(import.meta.dirname, "..", "public");
const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const compressible = /\.(?:html|js|css|json|webmanifest|svg|txt|xml)$/i;
let files = 0;
let sourceBytes = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (compressible.test(entry.name) && !/\.(?:br|gz)$/i.test(entry.name) && (await stat(path)).size >= 1024) {
      const source = await readFile(path);
      const [br, gz] = await Promise.all([
        brotli(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
        gzipAsync(source, { level: 9 }),
      ]);
      await Promise.all([writeFile(`${path}.br`, br), writeFile(`${path}.gz`, gz)]);
      files++; sourceBytes += source.length;
    }
  }
}

async function clearCompressed(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await clearCompressed(path);
    else if (/\.(?:br|gz)$/i.test(entry.name)) await rm(path, { force: true });
  }
}

await clearCompressed(root);
await walk(root);
console.log(`precompressed ${files} public assets (${(sourceBytes / 1024 / 1024).toFixed(2)} MiB source)`);
