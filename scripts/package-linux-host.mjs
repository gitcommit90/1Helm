#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const version = String(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version || "").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("package.json must contain a release version");
const dist = resolve(root, "dist");
const output = resolve(dist, `1Helm-${version}-linux-node.tgz`);
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

  const pack = spawnSync("tar", ["-czf", output, "-C", stage, prefix], { stdio: "inherit" });
  if (pack.status !== 0) throw new Error("Could not write the Linux host archive");
} finally {
  rmSync(stage, { recursive: true, force: true });
}
console.log(output);
