// Runs inside the container. Diffs /workspace against the last committed state and lists what a save must include.
// usage: node snap.js scan  -> writes /tmp/1hc/changed (NUL list), /tmp/1hc/next.json; prints {changed,deleted,bytes}
//        node snap.js commit -> next.json becomes the committed baseline
//        node snap.js baseline -> record current tree as committed (after restore)
const fs = require("fs"), path = require("path");
const ROOT = "/workspace", DIR = "/tmp/1hc";
const SKIP = new Set(["node_modules", ".cache", ".npm", ".venv", "__pycache__"]);
const SKIP_PATHS = new Set([".home/.cache", ".home/.npm"]);
fs.mkdirSync(DIR, { recursive: true });
function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  let ents; try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP.has(e.name) || SKIP_PATHS.has(r)) continue;
    let st; try { st = fs.lstatSync(path.join(ROOT, r)); } catch { continue; }
    const kind = st.isDirectory() ? "d" : st.isSymbolicLink() ? "l" : st.isFile() ? "f" : null;
    if (!kind) continue;
    out[r] = [kind, kind === "d" ? 0 : st.size, Math.floor(st.mtimeMs), Math.floor(st.ctimeMs), st.mode];
    if (kind === "d") walk(r, out);
  }
}
const cmd = process.argv[2];
const now = {}; walk("", now);
if (cmd === "baseline") { fs.writeFileSync(`${DIR}/prev.json`, JSON.stringify(now)); console.log(JSON.stringify({ entries: Object.keys(now).length })); process.exit(0); }
if (cmd === "commit") { fs.renameSync(`${DIR}/next.json`, `${DIR}/prev.json`); console.log("{}"); process.exit(0); }
let prev = {}; try { prev = JSON.parse(fs.readFileSync(`${DIR}/prev.json`, "utf8")); } catch {}
const changed = [], deleted = []; let bytes = 0;
for (const [r, v] of Object.entries(now)) {
  const p = prev[r];
  if (!p || p[0] !== v[0] || p[1] !== v[1] || p[2] !== v[2] || p[3] !== v[3] || p[4] !== v[4]) { changed.push(r); if (v[0] === "f") bytes += v[1]; }
}
for (const r of Object.keys(prev)) if (!(r in now)) deleted.push(r);
fs.writeFileSync(`${DIR}/changed`, changed.map((r) => r + "\0").join(""));
fs.writeFileSync(`${DIR}/next.json`, JSON.stringify(now));
console.log(JSON.stringify({ changed: changed.length, deleted, bytes, full: Object.keys(prev).length === 0 }));
