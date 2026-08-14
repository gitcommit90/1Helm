// Build post-step: hash public/bundle.js + public/app.css and stamp
// `?v=<hash>` into public/index.html so browsers fetch a fresh copy whenever
// the bundle changes. Idempotent — re-runs overwrite any prior ?v=.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

let html = readFileSync(join(PUBLIC, "index.html"), "utf-8");
const hash = (name) => createHash("sha256").update(readFileSync(join(PUBLIC, name))).digest("hex").slice(0, 12);
const bv = hash("bundle.js");
const cv = hash("app.css");

// strip any existing ?v=... on these two asset references, then re-stamp
html = html
  .replace(/<script type="module" src="[^"]*"><\/script>/, `<script type="module" src="/bundle.js?v=${bv}"></script>`)
  .replace(/(\/app\.css)(\?v=[0-9a-f]*)?/g, `$1?v=${cv}`);

writeFileSync(join(PUBLIC, "index.html"), html);
console.log(`stamped index.html → bundle.js?v=${bv} app.css?v=${cv}`);
