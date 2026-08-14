#!/usr/bin/env node
import { build } from "esbuild";
import { copyFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outdir = join(root, "public");
rmSync(join(outdir, "assets"), { recursive: true, force: true });
rmSync(join(outdir, "bundle.css"), { force: true });

await build({
  absWorkingDir: root,
  entryPoints: { bundle: "src/client/app.ts" },
  outdir,
  bundle: true,
  splitting: true,
  format: "esm",
  minify: true,
  sourcemap: false,
  metafile: true,
  loader: { ".css": "css" },
  entryNames: "[name]",
  chunkNames: "assets/chunks/[name]-[hash]",
  assetNames: "assets/files/[name]-[hash]",
  logLevel: "info",
});

copyFileSync(join(root, "node_modules", "@xterm", "xterm", "css", "xterm.css"), join(outdir, "xterm.css"));
// Kept for native/Linux packaging compatibility; no longer blocks first paint.
writeFileSync(join(outdir, "bundle.css"), "/* Feature styles load on demand. */\n");
