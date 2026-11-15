import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

globalThis.document = { addEventListener() {}, getElementById() { return null; } };
globalThis.window = { addEventListener() {} };
const dir = mkdtempSync(join(tmpdir(), "onehelm-storage-test-"));
try {
  const make = async (name) => {
    const out = join(dir, `${name.replaceAll("/", "-")}.mjs`);
    await build({ entryPoints: [new URL(`../src/${name}.ts`, import.meta.url).pathname], outfile: out, bundle: true, format: "esm", platform: "browser", logLevel: "silent" });
    return import(pathToFileURL(out).href);
  };
  const data = { used: 85e9, limit: 100e9, pct: 85, full: false, by: { files: 80e9, computer: 5e9, pages: 0, other: 0 },
    included_gb: 100, blocks: 0, block_gb: 100, block_usd: 2, plan: "byok", plans: [{ key: "byok", name: "Bring your own key", price: 10, usage: 0, storage_text: "100 GB" }] };
  const core = await make("storage");
  core.storInit({ api: null, boot: () => data, repaint() {}, openUsage() {} });
  const publicCard = core.storCard();
  assert.match(publicCard, /85 GB of 100 GB/);
  assert.match(publicCard, /server&#39;s storage limit/);
  assert.doesNotMatch(publicCard, /Add storage|data-stadd|\$2|plan/i);

  const billing = await make("ee/storage-billing");
  billing.storInit({ api: () => Promise.resolve(data), boot: () => data, repaint() {}, openUsage() {}, note() {}, planName: () => "Plus", reload() {} });
  const billingCard = billing.storCard();
  assert.match(billingCard, /data-stadd/);
  assert.match(billingCard, /Add storage/);
} finally { rmSync(dir, { recursive: true, force: true }); }
