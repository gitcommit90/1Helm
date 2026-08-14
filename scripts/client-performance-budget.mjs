#!/usr/bin/env node
import { brotliCompressSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const entry = resolve(import.meta.dirname, "..", "public", "bundle.js");
if (!existsSync(entry)) throw new Error("Build the client before checking its performance budget.");
const visited = new Set();
const sources = [];
function visit(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const source = readFileSync(path, "utf8");
  sources.push(source);
  for (const match of source.matchAll(/(?:from\s*|import\s*)["'](\.\/?[^"']+\.js)["']/g)) {
    visit(resolve(dirname(path), match[1]));
  }
}
visit(entry);
const combined = Buffer.from(sources.join("\n"));
const brotliBytes = brotliCompressSync(combined).length;
const rawLimit = 750 * 1024;
const brotliLimit = 250 * 1024;
if (combined.length > rawLimit || brotliBytes > brotliLimit) {
  throw new Error(`Critical JS graph is ${(combined.length / 1024).toFixed(1)} KiB raw / ${(brotliBytes / 1024).toFixed(1)} KiB Brotli; budgets are 750 / 250 KiB.`);
}
for (const forbidden of ["node_modules/@excalidraw", "node_modules/@xterm", "node_modules/pdf-lib", "node_modules/codemirror"]) {
  if (combined.includes(forbidden)) throw new Error(`Critical JS graph unexpectedly includes ${forbidden}.`);
}
console.log(`critical JS: ${(combined.length / 1024).toFixed(1)} KiB raw, ${(brotliBytes / 1024).toFixed(1)} KiB Brotli, ${visited.size} files`);
