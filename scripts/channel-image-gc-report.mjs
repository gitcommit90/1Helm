#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(process.argv[2] || "/var/lib/1helm-oci-v1/shared-images/sha256");
const releases = resolve(process.argv[3] || "/opt/1helm/releases");
const referenced = new Set();
if (existsSync(releases)) {
  for (const entry of readdirSync(releases, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const manifest = join(releases, entry.name, "resources", "channel-image.json");
    if (!existsSync(manifest) || lstatSync(manifest).isSymbolicLink()) continue;
    try {
      const value = JSON.parse(readFileSync(manifest, "utf8"));
      if (/^[a-f0-9]{64}$/.test(String(value.sha256 || ""))) referenced.add(value.sha256);
    } catch {}
  }
}
const images = [];
if (existsSync(root)) for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
  const path = join(root, entry.name);
  const bytes = readdirSync(path, { withFileTypes: true }).reduce((sum, item) => item.isFile() && !item.isSymbolicLink() ? sum + statSync(join(path, item.name)).size : sum, 0);
  images.push({ sha256: entry.name, bytes, referenced_by_retained_release: referenced.has(entry.name), action: "retain" });
}
const report = {
  schema: 1, kind: "1helm-channel-image-gc-report", mode: "report-only", automatic_deletion: false,
  store: basename(root), images: images.sort((a, b) => a.sha256.localeCompare(b.sha256)),
  unreferenced_bytes: images.filter((image) => !image.referenced_by_retained_release).reduce((sum, image) => sum + image.bytes, 0),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
