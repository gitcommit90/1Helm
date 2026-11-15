// Exercise the page staging shell commands against real symlinks, outside the channel-computer fixture.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageFromComputer } from "../src/publish.js";

const root = mkdtempSync(join(tmpdir(), "onehelm-publish-source-"));
try {
  const site = join(root, "site"); mkdirSync(site);
  writeFileSync(join(site, "index.html"), "<title>Safe page</title>");
  writeFileSync(join(site, "style.css"), "body { color: green }");
  writeFileSync(join(site, "résumé.js"), "export default 1");
  writeFileSync(join(root, "private.html"), "<title>Private</title>");
  symlinkSync("../private.html", join(site, "secret.html"));
  symlinkSync("site", join(root, "shortcut"));
  const copied = [], objects = new Map();
  const C = {
    async exec(command) {
      const result = spawnSync("bash", ["-c", command], { cwd: root, encoding: "utf8" });
      return { code: result.status ?? 1, out: result.stdout || result.stderr || "" };
    },
    async fileToR2(path, key, max, opts) {
      const bytes = readFileSync(join(root, path)); copied.push(path); objects.set(key, bytes);
      assert.equal(opts?.noSymlink, true, "page assets use the link-safe copy path");
      assert.equal(opts.expectedSize, bytes.length, "page assets match the listed size");
      return { ok: true, bytes: bytes.length };
    },
  };
  const env = { WS: { async get(key) { const bytes = objects.get(key); return bytes ? { arrayBuffer: async () => Uint8Array.from(bytes).buffer } : null; } } };
  const staged = await stageFromComputer(env, "tenant", C, "site");
  assert.equal(staged.files, 3, JSON.stringify(staged));
  assert.deepEqual(new Set(copied), new Set(["site/index.html", "site/style.css", "site/résumé.js"]));
  for (const path of ["site/secret.html", "shortcut", "../private.html", "/etc/passwd", "site/../../private.html", ".hidden.html"]) {
    const result = await stageFromComputer(env, "tenant", C, path);
    assert.ok(result.error, `${path} must not stage`);
  }
  rmSync(join(site, "index.html")); symlinkSync("../private.html", join(site, "index.html"));
  assert.ok((await stageFromComputer(env, "tenant", C, "site")).error, "a linked index.html must not stage");
  assert.equal(copied.length, 3, "rejected paths must copy no bytes");
  rmSync(join(site, "index.html")); writeFileSync(join(site, "index.html"), "<title>Safe page</title>");
  writeFileSync(join(site, "line\nbreak.js"), "bad name");
  assert.match((await stageFromComputer(env, "tenant", C, "site")).error, /file name/);
  assert.equal(copied.length, 3, "a newline in a file name must not change the copied manifest");
  rmSync(join(site, "line\nbreak.js"));
  for (let i = 0; i < 80; i++) writeFileSync(join(site, `asset-${String(i).padStart(2, "0")}-${"x".repeat(170)}.js`), "x");
  assert.match((await stageFromComputer(env, "tenant", C, "site")).error, /unusually long file names/);
  assert.equal(copied.length, 3, "a manifest near the command output cap must not be truncated and published");
  console.log("ok - page staging excludes nested symlinks and rejects linked or escaping source paths");
} finally { rmSync(root, { recursive: true, force: true }); }
