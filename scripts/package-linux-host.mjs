#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const version = String(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version || "").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("package.json must contain a release version");
const dist = resolve(root, "dist");
const output = resolve(dist, `1Helm-${version}-linux-node.tgz`);
const cloudflaredVersion = "2026.3.0";
const cloudflared = [
  {
    arch: "x64",
    asset: "cloudflared-linux-amd64",
    sha256: "4a9e50e6d6d798e90fcd01933151a90bf7edd99a0a55c28ad18f2e16263a5c30",
  },
  {
    arch: "arm64",
    asset: "cloudflared-linux-arm64",
    sha256: "0755ba4cbab59980e6148367fcf53a8f3ec85a97deefd63c2420cf7850769bee",
  },
];
const sealed = [
  "container/channel-machine.oci.tar",
  "container/channel-machine.oci.sha256",
  "container/channel-machine.oci.json",
];
for (const rel of sealed.slice(0, 2)) {
  if (!existsSync(resolve(root, rel))) {
    throw new Error(`Linux packaging requires the sealed channel image at ${rel} (run scripts/build-oci-channel-image.sh on a builder host).`);
  }
}

mkdirSync(dist, { recursive: true });
rmSync(output, { force: true });

const stage = mkdtempSync(join(tmpdir(), "1helm-linux-pkg-"));
try {
  const prefix = `1Helm-${version}`;
  const archive = spawnSync("git", ["archive", "--format=tar", `--prefix=${prefix}/`, "HEAD"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (archive.status !== 0) throw new Error("Could not package the exact Git release source");
  const extract = spawnSync("tar", ["-xf", "-", "-C", stage], { input: archive.stdout, stdio: ["pipe", "inherit", "inherit"] });
  if (extract.status !== 0) throw new Error("Could not extract the Git release source for packaging");

  const containerDir = join(stage, prefix, "container");
  mkdirSync(containerDir, { recursive: true });
  for (const rel of sealed) {
    const src = resolve(root, rel);
    if (!existsSync(src)) continue;
    copyFileSync(src, join(stage, prefix, rel));
  }

  const resourcesDir = join(stage, prefix, "resources");
  mkdirSync(resourcesDir, { recursive: true });
  for (const connector of cloudflared) {
    const destination = join(resourcesDir, `cloudflared-linux-${connector.arch}`);
    const url = `https://github.com/cloudflare/cloudflared/releases/download/${cloudflaredVersion}/${connector.asset}`;
    const download = spawnSync("curl", ["-fsSL", "--proto", "=https", "--tlsv1.2", "--retry", "3", "-o", destination, url], { stdio: "inherit" });
    if (download.status !== 0) throw new Error(`Could not download pinned cloudflared for Linux ${connector.arch}`);
    const digest = spawnSync("sha256sum", [destination], { encoding: "utf8" });
    const actual = digest.status === 0 ? String(digest.stdout || "").trim().split(/\s+/)[0] : "";
    if (actual !== connector.sha256) throw new Error(`Pinned cloudflared digest mismatch for Linux ${connector.arch} (got ${actual || "unavailable"})`);
    chmodSync(destination, 0o755);
  }

  const pack = spawnSync("tar", ["-czf", output, "-C", stage, prefix], { stdio: "inherit" });
  if (pack.status !== 0) throw new Error("Could not write the Linux host archive");
} finally {
  rmSync(stage, { recursive: true, force: true });
}
console.log(output);
