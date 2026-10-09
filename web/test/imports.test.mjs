// node test/imports.test.mjs: no file in src/ imports the same name twice.
// esbuild bundles a duplicate import without a word and keeps only one of them: in 2026-10 v3.ts imported cmInit from both
// ./contacts-merge and ./apps-mode, so the Contacts merge was never set up and every Merge button did nothing (the Captain:
// "the merge button is non responsive"). Also checks the built app wires the Contacts merge (cmInit gets the contact list).
import assert from "node:assert"; import { readFileSync, readdirSync } from "node:fs"; import { build } from "esbuild";

const src = new URL("../src/", import.meta.url).pathname;
const bad = [];
for (const f of readdirSync(src).filter((f) => /\.ts$/.test(f))) {
  const text = readFileSync(src + f, "utf8"), seen = new Map();
  for (const m of text.matchAll(/^import\s+(?!type\b)([\s\S]*?)\s+from\s+["']([^"']+)["']/gm)) {
    const what = m[1], from = m[2], names = [];
    const def = what.match(/^([A-Za-z_$][\w$]*)\s*(,|$)/); if (def) names.push(def[1]);
    const ns = what.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/); if (ns) names.push(ns[1]);
    const br = what.match(/\{([\s\S]*)\}/);
    if (br) for (const part of br[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      if (/^type\s/.test(part)) continue;
      const local = part.split(/\s+as\s+/).pop().trim(); names.push(local);
    }
    for (const n of names) { if (seen.has(n)) bad.push(`${f}: "${n}" imported from ${seen.get(n)} and ${from}`); else seen.set(n, from); }
  }
}
assert.deepEqual(bad, [], "duplicate imports:\n" + bad.join("\n"));
console.log("  ok no file in src/ imports the same name twice");

// The bundle: contacts-merge's cmInit is in it and is called with the Contacts deps (list + merge), apart from apps-mode's.
const r = await build({ entryPoints: [src + "v3.ts"], bundle: true, write: false, format: "esm", logLevel: "silent", external: ["/fonts/*", "/av/*", "/agent-avatars/*"], loader: { ".json": "json" } });
const js = r.outputFiles[0].text;
const merge = js.match(/function (cmInit\d*)\(d\) \{\s*(D\d*) = d;\s*\}\s*function numsOf/);
assert.ok(merge, "contacts-merge's cmInit is in the bundle");
assert.ok(new RegExp(`\\n${merge[1]}\\(\\{\\n\\s*list: \\(\\) => CT\\.list`).test(js), "contacts-merge's cmInit is called with the contact list");
console.log("  ok the app sets up the Contacts merge (cmInit with the contact list)");
