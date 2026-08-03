#!/usr/bin/env node
import { chmodSync, cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
// `git archive` only carries tracked files, so every gitignored build output has
// to be injected into the staging tree the same way the sealed image already is.
// Shipping them means the end-user host never runs `npm run build`.
const builtFiles = [
  "public/bundle.js",
  "public/bundle.css",
  "public/app.css",
  "public/index.html",
  "desktop/photon-sidecar.bundle.mjs",
];
const builtTrees = ["public/excalidraw"];
// Native addons are compiled inside this image, never on the packaging host: it
// is the oldest glibc we support building against (Debian bookworm, glibc 2.36),
// so the resulting binaries stay forward-compatible with every newer target.
const nativeBuilderImage = process.env.HELM_LINUX_NATIVE_BUILDER_IMAGE || "docker.io/library/node:22";
const nativeArchitecture = "x64";
const nativeManifestPath = "resources/linux-native-modules.json";
const requiredNativeModule = "node_modules/node-pty/build/Release/pty.node";

const digestOf = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const symbolCeiling = (file, prefix) => {
  const found = new Set();
  const pattern = new RegExp(`${prefix}_([0-9][0-9.]*)`, "g");
  for (const match of readFileSync(file).toString("latin1").matchAll(pattern)) found.add(match[1]);
  const ranked = [...found].sort((left, right) => {
    const a = left.split(".").map(Number);
    const b = right.split(".").map(Number);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
    }
    return 0;
  });
  return ranked.at(-1) || "";
};
const nativeAddons = (directory, base = "") => {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) found.push(...nativeAddons(join(directory, entry.name), relative));
    else if (entry.isFile() && /\/build\/Release\/[^/]+\.node$/.test(`/${relative}`)) found.push(relative);
  }
  return found;
};

const repository = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
const repositoryRoot = repository.status === 0 ? resolve(String(repository.stdout || "").trim()) : "";
if (repositoryRoot !== root) {
  throw new Error("Linux packaging must run from the root of the exact Git checkout; a parent repository or source copy is not release authority");
}
const headPackage = spawnSync("git", ["show", "HEAD:package.json"], { cwd: root, encoding: "utf8" });
let headVersion = "";
try { headVersion = String(JSON.parse(String(headPackage.stdout || "{}")).version || "").trim(); } catch { }
if (headPackage.status !== 0 || headVersion !== version) {
  throw new Error("Linux packaging version does not match package.json at Git HEAD");
}
for (const rel of sealed.slice(0, 2)) {
  if (!existsSync(resolve(root, rel))) {
    throw new Error(`Linux packaging requires the sealed channel image at ${rel} (run scripts/build-oci-channel-image.sh on a builder host).`);
  }
}

if (process.platform !== "linux" || process.arch !== nativeArchitecture) {
  throw new Error(`Linux packaging must run on a linux-${nativeArchitecture} builder so the vendored native addons match the shipped architecture`);
}
const containerRuntime = ["podman", "docker"].find((candidate) => spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0);
if (!containerRuntime) {
  throw new Error("Linux packaging requires podman or docker so production dependencies compile against the oldest supported glibc");
}

// Build the client and sidecar bundles here, on the release builder, so the
// installed release is already runnable. Everything below only copies results.
const clientBuild = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
if (clientBuild.status !== 0) throw new Error("Could not build the Linux release client and sidecar bundles");
for (const rel of builtFiles) {
  const built = resolve(root, rel);
  if (!existsSync(built) || statSync(built).size === 0) throw new Error(`Linux packaging requires the built asset ${rel}`);
}
for (const rel of builtTrees) {
  const built = resolve(root, rel);
  if (!existsSync(built) || !statSync(built).isDirectory() || readdirSync(built).length === 0) {
    throw new Error(`Linux packaging requires the built asset tree ${rel}`);
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
  if (!archive.stdout?.length) throw new Error("Exact Git release source archive was empty");
  const extract = spawnSync("tar", ["-xf", "-", "-C", stage], { input: archive.stdout, stdio: ["pipe", "inherit", "inherit"] });
  if (extract.status !== 0) throw new Error("Could not extract the Git release source for packaging");

  const stagedPackage = resolve(stage, prefix, "package.json");
  if (!existsSync(stagedPackage) || String(JSON.parse(readFileSync(stagedPackage, "utf8")).version || "") !== version) {
    throw new Error("Exact Git release source archive is missing its versioned package contract");
  }

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

  for (const rel of builtFiles) {
    const destination = join(stage, prefix, rel);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(root, rel), destination);
  }
  for (const rel of builtTrees) {
    const destination = join(stage, prefix, rel);
    rmSync(destination, { recursive: true, force: true });
    cpSync(resolve(root, rel), destination, { recursive: true });
  }

  // Production dependencies are installed once, here, against the release
  // lockfile that `git archive` just staged. The end-user host therefore needs
  // neither a compiler nor npm registry access.
  const install = spawnSync(containerRuntime, [
    "run", "--rm", "--network=host",
    "-v", `${join(stage, prefix)}:/workspace`,
    "-w", "/workspace",
    "-e", "PUPPETEER_SKIP_DOWNLOAD=1",
    "-e", "ELECTRON_SKIP_BINARY_DOWNLOAD=1",
    "-e", "npm_config_audit=false",
    "-e", "npm_config_fund=false",
    "-e", "npm_config_update_notifier=false",
    nativeBuilderImage,
    "npm", "ci", "--omit=dev",
  ], { stdio: "inherit" });
  if (install.status !== 0) throw new Error("Could not install the Linux release production dependencies inside the native builder image");

  const stagedModules = join(stage, prefix, "node_modules");
  if (!existsSync(stagedModules)) throw new Error("The native builder image did not produce production node_modules");
  const stagedPty = join(stage, prefix, requiredNativeModule);
  if (!existsSync(stagedPty)) throw new Error(`The native builder image did not produce ${requiredNativeModule}; terminals would be unavailable on the target host`);
  const builderNode = spawnSync(containerRuntime, ["run", "--rm", nativeBuilderImage, "node", "-p", "process.versions.modules + ' ' + process.version"], { encoding: "utf8" });
  const [builderAbi = "", builderVersion = ""] = String(builderNode.stdout || "").trim().split(/\s+/);
  if (!/^\d+$/.test(builderAbi)) throw new Error("Could not read the native builder image Node ABI");
  const modules = nativeAddons(stagedModules).map((rel) => {
    const file = join(stagedModules, rel);
    return {
      path: `node_modules/${rel}`,
      sha256: digestOf(file),
      glibc: symbolCeiling(file, "GLIBC"),
      glibcxx: symbolCeiling(file, "GLIBCXX"),
    };
  });
  if (!modules.some((entry) => entry.path === requiredNativeModule)) throw new Error(`Could not fingerprint ${requiredNativeModule}`);
  const manifest = {
    version,
    platform: "linux",
    arch: nativeArchitecture,
    builderImage: nativeBuilderImage,
    builderNodeVersion: builderVersion,
    nodeAbi: builderAbi,
    modules,
  };
  const manifestFile = join(stage, prefix, nativeManifestPath);
  mkdirSync(dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const entry of modules) {
    console.log(`vendored ${entry.path} — max GLIBC ${entry.glibc || "none"} / GLIBCXX ${entry.glibcxx || "none"}`);
  }

  const pack = spawnSync("tar", ["-czf", output, "-C", stage, prefix], { stdio: "inherit" });
  if (pack.status !== 0) throw new Error("Could not write the Linux host archive");
} finally {
  rmSync(stage, { recursive: true, force: true });
}
const archiveDigest = digestOf(output);
writeFileSync(`${output}.sha256`, `${archiveDigest}  ${output.split("/").at(-1)}\n`);
console.log(`sha256 ${archiveDigest}`);
console.log(output);
