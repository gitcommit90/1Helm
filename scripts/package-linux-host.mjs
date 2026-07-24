#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const version = String(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version || "").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("package.json must contain a release version");
const dist = resolve(root, "dist");
const output = resolve(dist, `1Helm-${version}-linux-node.tgz`);
mkdirSync(dist, { recursive: true });
rmSync(output, { force: true });
const result = spawnSync("git", ["archive", "--format=tar.gz", `--prefix=1Helm-${version}/`, "-o", output, "HEAD"], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) throw new Error("Could not package the exact Git release source");
console.log(output);
