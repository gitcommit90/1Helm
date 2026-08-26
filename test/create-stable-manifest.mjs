import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { validateStableManifest } from "../scripts/stable-manifest-lib.mjs";

test("creates a validated schema-3 manifest from exact artifact bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "1helm-manifest-"));
  const version = "9.8.7";
  for (const name of [`1Helm-${version}-arm64.dmg`, `1Helm-${version}-mac-arm64.zip`, `1Helm-${version}-linux-node.tgz`]) {
    writeFileSync(join(root, name), `bytes for ${name}`);
  }
  const script = resolve(import.meta.dirname, "../scripts/create-stable-manifest.mjs");
  execFileSync(process.execPath, [script, version, "a".repeat(40), "12345", root]);
  const manifest = JSON.parse(readFileSync(join(root, `1Helm-${version}-stable.json`), "utf8"));
  const valid = validateStableManifest(manifest);
  assert.equal(valid.schema, 3);
  assert.equal(valid.publication.workflow_run_id, "12345");
  assert.deepEqual(valid.artifacts.map((entry) => entry.bytes), valid.artifacts.map((entry) => Buffer.byteLength(`bytes for ${entry.name}`)));
});
