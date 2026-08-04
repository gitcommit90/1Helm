#!/usr/bin/env node
import {
  chmodSync, closeSync, cpSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, readdirSync, readSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import {
  LINUX_SPLIT_KIND, LINUX_SPLIT_SCHEMA, normalizeChannelImageManifest, offlineBundleName, releasedChannelImageManifest,
} from "./artifact-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const packageValue = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = String(packageValue.version || "").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("package.json must contain a release version");
const dist = resolve(process.env.HELM_LINUX_DIST_DIR || join(root, "dist"));
const output = resolve(dist, `1Helm-${version}-linux-node.tgz`);
const offlineOutput = resolve(dist, offlineBundleName(version));
const splitOutput = resolve(dist, `1Helm-${version}-linux-split.json`);
const cloudflaredVersion = "2026.3.0";
const cloudflared = [
  { arch: "x64", asset: "cloudflared-linux-amd64", sha256: "4a9e50e6d6d798e90fcd01933151a90bf7edd99a0a55c28ad18f2e16263a5c30" },
  { arch: "arm64", asset: "cloudflared-linux-arm64", sha256: "0755ba4cbab59980e6148367fcf53a8f3ec85a97deefd63c2420cf7850769bee" },
];
const builtFiles = ["public/bundle.js", "public/bundle.css", "public/app.css", "public/index.html", "desktop/photon-sidecar.bundle.mjs"];
const builtTrees = ["public/excalidraw"];
const nativeBuilderImage = process.env.HELM_LINUX_NATIVE_BUILDER_IMAGE || "docker.io/library/node:22";
const nativeArchitecture = "x64";
const ociArchitecture = "amd64";
const nativeManifestPath = "resources/linux-native-modules.json";
const requiredNativeModule = "node_modules/node-pty/build/Release/pty.node";

function digestFile(file) {
  const hash = createHash("sha256");
  const fd = openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let count; while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { closeSync(fd); }
  return hash.digest("hex");
}
const digestBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digestText = (...values) => digestBytes(values.join("\n"));
const run = (file, args, options = {}) => spawnSync(file, args, { cwd: root, encoding: "utf8", ...options });

function copyRequired(sourceRoot, destinationRoot, rel) {
  const source = resolve(sourceRoot, rel);
  const confined = relative(sourceRoot, source);
  if (!confined || confined === ".." || confined.startsWith(`..${sep}`) || !existsSync(source) || lstatSync(source).isSymbolicLink()) {
    throw new Error(`Linux runtime allowlist entry is missing or unsafe: ${rel}`);
  }
  const destination = resolve(destinationRoot, rel);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: false, preserveTimestamps: false });
}

function symbolCeiling(file, prefix) {
  const found = new Set();
  for (const match of readFileSync(file).toString("latin1").matchAll(new RegExp(`${prefix}_([0-9][0-9.]*)`, "g"))) found.add(match[1]);
  return [...found].sort((left, right) => {
    const a = left.split(".").map(Number); const b = right.split(".").map(Number);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
    return 0;
  }).at(-1) || "";
}

function nativeAddons(directory, base = "") {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) found.push(...nativeAddons(join(directory, entry.name), rel));
    else if (entry.isFile() && /\/build\/Release\/[^/]+\.node$/.test(`/${rel}`)) found.push(rel);
  }
  return found.sort();
}

function slimDependencies(directory) {
  const excludedDirectories = new Set(runtimePackage.production_dependency_excludes.directory_names);
  const excludedFiles = new Set(runtimePackage.production_dependency_excludes.file_names);
  const excludedSuffixes = runtimePackage.production_dependency_excludes.file_suffixes;
  let files = 0; let bytes = 0;
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (excludedDirectories.has(entry.name)) { rmSync(path, { recursive: true, force: true }); continue; }
        walk(path);
      } else if (entry.isFile() && (excludedFiles.has(entry.name) || excludedSuffixes.some((suffix) => entry.name.endsWith(suffix)))) {
        bytes += statSync(path).size; files += 1; rmSync(path);
      }
    }
  }
  walk(directory);
  return { files, bytes };
}

function deterministicTar(sourceDirectory, prefix, destination) {
  const tar = spawnSync("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-cf", "-", "-C", sourceDirectory, prefix], {
    encoding: "buffer", maxBuffer: 1024 * 1024 * 1024,
  });
  if (tar.status !== 0) throw new Error(`Could not stage ${basename(destination)}`);
  const packed = spawnSync("gzip", ["-n", "-c"], { input: tar.stdout, encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
  if (packed.status === 0 && packed.stdout?.length) writeFileSync(destination, packed.stdout);
  if (packed.status !== 0) throw new Error(`Could not write ${basename(destination)}`);
}

const repository = run("git", ["rev-parse", "--show-toplevel"]);
const repositoryRoot = repository.status === 0 ? resolve(String(repository.stdout || "").trim()) : "";
if (repositoryRoot !== root) {
  throw new Error("Linux packaging must run from the root of the exact Git checkout; a parent repository or source copy is not release authority");
}
const headPackage = run("git", ["show", "HEAD:package.json"]);
let headVersion = "";
try { headVersion = String(JSON.parse(String(headPackage.stdout || "{}")).version || ""); } catch {}
if (headPackage.status !== 0 || headVersion !== version) throw new Error("Linux packaging version does not match package.json at Git HEAD");
const headSha = String(run("git", ["rev-parse", "HEAD"]).stdout || "").trim();
if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error("Could not resolve the exact Linux package source commit");
const runtimePackage = JSON.parse(readFileSync(join(root, "config", "linux-runtime-package.json"), "utf8"));

const candidateRequested = Boolean(process.env.HELM_CANDIDATE_BUILD_ID);
const candidateIdentity = candidateRequested ? {
  schema: 1, kind: "1helm-dress-rehearsal-candidate",
  repository: String(process.env.HELM_CANDIDATE_REPOSITORY || ""), ref: String(process.env.HELM_CANDIDATE_REF || ""),
  commit: String(process.env.HELM_CANDIDATE_COMMIT || ""), source_state: String(process.env.HELM_CANDIDATE_SOURCE_STATE || ""),
  build_identity: String(process.env.HELM_CANDIDATE_BUILD_ID || ""), created_at: String(process.env.HELM_CANDIDATE_CREATED_AT || ""),
  ci: { workflow: String(process.env.HELM_CANDIDATE_CI_WORKFLOW || ""), run_id: String(process.env.HELM_CANDIDATE_CI_RUN_ID || ""), conclusion: String(process.env.HELM_CANDIDATE_CI_CONCLUSION || "") },
  version,
} : null;
if (candidateIdentity) {
  const trustedMain = candidateIdentity.source_state === "trusted-main";
  const validCi = trustedMain
    ? candidateIdentity.ci.workflow === "CI" && /^\d+$/.test(candidateIdentity.ci.run_id) && candidateIdentity.ci.conclusion === "success"
    : candidateIdentity.ci.workflow === "local" && candidateIdentity.ci.run_id === "0" && candidateIdentity.ci.conclusion === "not_run";
  if (candidateIdentity.repository !== "gitcommit90/1Helm" || candidateIdentity.ref !== "refs/heads/main" || candidateIdentity.commit !== headSha
      || !["trusted-main", "local-worktree", "rollback-fixture"].includes(candidateIdentity.source_state)
      || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(candidateIdentity.build_identity)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(candidateIdentity.created_at) || !validCi) {
    throw new Error("Candidate packaging requires the exact trusted repository/ref/commit, successful CI identity, and bounded build identity");
  }
  const worktree = run("git", ["status", "--porcelain"]);
  if (worktree.status !== 0 || (trustedMain && String(worktree.stdout).trim())) throw new Error("Trusted-main candidate packaging requires a clean exact checkout");
}
if (process.platform !== "linux" || process.arch !== nativeArchitecture) throw new Error(`Linux packaging must run on linux-${nativeArchitecture}`);
const containerRuntime = ["podman", "docker"].find((name) => spawnSync(name, ["--version"], { stdio: "ignore" }).status === 0);
if (!containerRuntime) throw new Error("Linux packaging requires podman or docker for ABI-pinned production dependencies");

const imageTar = join(root, "container", "channel-machine.oci.tar");
const imageMetaPath = join(root, "container", "channel-machine.oci.json");
if (!existsSync(imageTar) || !existsSync(imageMetaPath)) throw new Error("Linux packaging requires the sealed channel image and manifest; run npm run package:channel-image");
const channelImage = normalizeChannelImageManifest(JSON.parse(readFileSync(imageMetaPath, "utf8")));
if (channelImage.architecture !== ociArchitecture || digestFile(imageTar) !== channelImage.sha256 || statSync(imageTar).size !== channelImage.bytes) {
  throw new Error("Sealed channel image bytes, architecture, or manifest do not match");
}

for (const path of [output, offlineOutput, splitOutput]) if (existsSync(path)) throw new Error(`Refusing to overwrite existing artifact: ${relative(root, path)}`);
const clientBuild = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
if (clientBuild.status !== 0) throw new Error("Could not build the Linux release client and sidecar bundles");
for (const rel of builtFiles) if (!existsSync(join(root, rel)) || statSync(join(root, rel)).size === 0) throw new Error(`Missing built asset ${rel}`);
for (const rel of builtTrees) if (!existsSync(join(root, rel)) || readdirSync(join(root, rel)).length === 0) throw new Error(`Missing built asset tree ${rel}`);

mkdirSync(dist, { recursive: true });
const stage = mkdtempSync(join(tmpdir(), "1helm-linux-pkg-"));
try {
  const prefix = `1Helm-${version}`;
  const sourceRoot = join(stage, "source");
  const releaseRoot = join(stage, "online", prefix);
  mkdirSync(sourceRoot, { recursive: true }); mkdirSync(releaseRoot, { recursive: true });
  let sourceArchive;
  if (["local-worktree", "rollback-fixture"].includes(candidateIdentity?.source_state)) {
    const listed = run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
    sourceArchive = spawnSync("tar", ["-cf", "-", "--null", "--files-from=-"], { cwd: root, input: listed.stdout, encoding: "buffer", maxBuffer: 512 * 1024 * 1024 });
  } else {
    sourceArchive = run("git", ["archive", "--format=tar", "HEAD"], { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 });
  }
  const archive = sourceArchive;
  if (archive.status !== 0 || !archive.stdout?.length) throw new Error("Could not create exact Git source identity archive");
  const sourceArchiveSha256 = digestBytes(sourceArchive.stdout);
  const extracted = spawnSync("tar", ["-xf", "-", "-C", sourceRoot], { input: sourceArchive.stdout, stdio: ["pipe", "inherit", "inherit"] });
  if (extracted.status !== 0) throw new Error("Could not inspect exact Git source archive");
  const stagedPackage = join(sourceRoot, "package.json");
  let stagedVersion = "";
  try { stagedVersion = String(JSON.parse(readFileSync(stagedPackage, "utf8")).version || "").trim(); } catch {}
  if (stagedVersion !== version) throw new Error("Git source archive is missing its versioned package contract");
  for (const rel of runtimePackage.source) copyRequired(sourceRoot, releaseRoot, rel);
  for (const rel of runtimePackage.built) copyRequired(root, releaseRoot, rel);

  const resourcesDir = join(releaseRoot, "resources");
  mkdirSync(resourcesDir, { recursive: true });
  const releasedImageManifest = releasedChannelImageManifest(channelImage);
  writeFileSync(join(resourcesDir, "channel-image.json"), `${JSON.stringify(releasedImageManifest, null, 2)}\n`);
  if (candidateIdentity) writeFileSync(join(resourcesDir, "candidate-build.json"), `${JSON.stringify({
    ...candidateIdentity, source_archive_sha256: sourceArchiveSha256, sealed_oci_sha256: channelImage.sha256,
    channel_image: releasedImageManifest, sealed_oci_cache: channelImage.cache,
  }, null, 2)}\n`);

  for (const connector of cloudflared) {
    const destination = join(resourcesDir, `cloudflared-linux-${connector.arch}`);
    const download = spawnSync("curl", ["-fsSL", "--proto", "=https", "--tlsv1.2", "--retry", "3", "-o", destination,
      `https://github.com/cloudflare/cloudflared/releases/download/${cloudflaredVersion}/${connector.asset}`], { stdio: "inherit" });
    if (download.status !== 0 || digestFile(destination) !== connector.sha256) throw new Error(`Pinned cloudflared digest mismatch for ${connector.arch}`);
    chmodSync(destination, 0o755);
  }

  const builderNode = spawnSync(containerRuntime, ["run", "--rm", nativeBuilderImage, "node", "-p", "process.versions.modules + ' ' + process.version"], { encoding: "utf8" });
  const [builderAbi = "", builderVersion = ""] = String(builderNode.stdout || "").trim().split(/\s+/);
  if (builderNode.status !== 0 || !/^\d+$/.test(builderAbi)) throw new Error("Could not read native builder Node ABI");
  const inspect = spawnSync(containerRuntime, ["image", "inspect", nativeBuilderImage, "--format", "{{.Digest}}"], { encoding: "utf8" });
  const builderDigestMatch = String(inspect.stdout || "").match(/^sha256:([a-f0-9]{64})\s*$/);
  if (!builderDigestMatch) throw new Error("Native builder image must resolve to an exact repository digest");
  const builderDigest = builderDigestMatch[1];
  const runtimePackageSha256 = digestFile(join(root, "config", "linux-runtime-package.json"));
  const dependencyCacheKey = digestText(digestFile(join(releaseRoot, "package-lock.json")), runtimePackageSha256,
    builderAbi, nativeArchitecture, builderDigest);
  const cacheRoot = resolve(process.env.HELM_PRODUCTION_CACHE_DIR || join(dist, "cache", "production-dependencies"));
  const cacheTar = join(cacheRoot, `${dependencyCacheKey}.tar`);
  const cacheMeta = join(cacheRoot, `${dependencyCacheKey}.json`);
  let dependencyCacheReused = false;
  if (existsSync(cacheTar) && existsSync(cacheMeta)) {
    const meta = JSON.parse(readFileSync(cacheMeta, "utf8"));
    if (meta.key === dependencyCacheKey && meta.node_abi === builderAbi && meta.architecture === nativeArchitecture
        && meta.builder_image_digest === builderDigest && meta.runtime_package_sha256 === runtimePackageSha256
        && meta.tar_sha256 === digestFile(cacheTar)) {
      const restore = spawnSync("tar", ["-xf", cacheTar, "-C", releaseRoot], { stdio: "inherit" });
      if (restore.status !== 0) throw new Error("Verified production dependency cache could not be extracted");
      dependencyCacheReused = true;
    }
  }
  if (!dependencyCacheReused) {
    const install = spawnSync(containerRuntime, [
      "run", "--rm", "--network=host", "-v", `${releaseRoot}:/workspace`, "-w", "/workspace",
      "-e", "PUPPETEER_SKIP_DOWNLOAD=1", "-e", "ELECTRON_SKIP_BINARY_DOWNLOAD=1",
      "-e", "npm_config_audit=false", "-e", "npm_config_fund=false", "-e", "npm_config_update_notifier=false",
      nativeBuilderImage, "npm", "ci", "--omit=dev",
    ], { stdio: "inherit" });
    if (install.status !== 0) throw new Error("Could not install production dependencies inside the native builder image");
    const pruning = slimDependencies(join(releaseRoot, "node_modules"));
    console.log(`runtime dependency allowlist excluded ${pruning.files} files / ${pruning.bytes} bytes`);
  }
  const stagedModules = join(releaseRoot, "node_modules");
  if (!existsSync(join(releaseRoot, requiredNativeModule))) throw new Error(`Production dependencies are missing ${requiredNativeModule}`);
  const modules = nativeAddons(stagedModules).map((rel) => {
    const file = join(stagedModules, rel);
    return { path: `node_modules/${rel}`, sha256: digestFile(file), glibc: symbolCeiling(file, "GLIBC"), glibcxx: symbolCeiling(file, "GLIBCXX") };
  });
  if (!modules.some((entry) => entry.path === requiredNativeModule)) throw new Error(`Could not fingerprint ${requiredNativeModule}`);
  const nativeManifest = {
    version, platform: "linux", arch: nativeArchitecture, builderImage: nativeBuilderImage,
    builderImageDigest: builderDigest, builderNodeVersion: builderVersion, nodeAbi: builderAbi, modules,
    cache: { key: dependencyCacheKey, reused: dependencyCacheReused },
  };
  writeFileSync(join(releaseRoot, nativeManifestPath), `${JSON.stringify(nativeManifest, null, 2)}\n`);
  if (!dependencyCacheReused) {
    mkdirSync(cacheRoot, { recursive: true });
    const cacheWrite = spawnSync("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-cf", cacheTar,
      "-C", releaseRoot, "node_modules", nativeManifestPath], { stdio: "inherit" });
    if (cacheWrite.status !== 0) throw new Error("Could not retain production dependency cache");
    writeFileSync(cacheMeta, `${JSON.stringify({ key: dependencyCacheKey, node_abi: builderAbi, architecture: nativeArchitecture,
      builder_image_digest: builderDigest, lockfile_sha256: digestFile(join(releaseRoot, "package-lock.json")),
      runtime_package_sha256: runtimePackageSha256, tar_sha256: digestFile(cacheTar) }, null, 2)}\n`);
  }

  deterministicTar(join(stage, "online"), prefix, output);
  const onlineDigest = digestFile(output);
  writeFileSync(`${output}.sha256`, `${onlineDigest}  ${basename(output)}\n`);

  const offlineRoot = join(stage, "offline", prefix);
  cpSync(releaseRoot, offlineRoot, { recursive: true, preserveTimestamps: false });
  mkdirSync(join(offlineRoot, "container"), { recursive: true });
  copyFileSync(imageTar, join(offlineRoot, "container", "channel-machine.oci.tar"));
  writeFileSync(join(offlineRoot, "container", "channel-machine.oci.sha256"), `${channelImage.sha256}\n`);
  copyFileSync(imageMetaPath, join(offlineRoot, "container", "channel-machine.oci.json"));
  deterministicTar(join(stage, "offline"), prefix, offlineOutput);
  const offlineDigest = digestFile(offlineOutput);
  writeFileSync(`${offlineOutput}.sha256`, `${offlineDigest}  ${basename(offlineOutput)}\n`);
  const split = {
    schema: LINUX_SPLIT_SCHEMA, kind: LINUX_SPLIT_KIND, version,
    app: { name: basename(output), sha256: onlineDigest, bytes: statSync(output).size, contains_channel_image: false },
    offline: { name: basename(offlineOutput), sha256: offlineDigest, bytes: statSync(offlineOutput).size, contains_channel_image: true },
    channel_image: releasedImageManifest,
    production_dependencies: { key: dependencyCacheKey, reused: dependencyCacheReused, node_abi: builderAbi,
      architecture: nativeArchitecture, builder_image_digest: builderDigest, runtime_package_sha256: runtimePackageSha256 },
  };
  writeFileSync(splitOutput, `${JSON.stringify(split, null, 2)}\n`);
  console.log(`online ${basename(output)} ${statSync(output).size} bytes sha256=${onlineDigest}`);
  console.log(`offline ${basename(offlineOutput)} ${statSync(offlineOutput).size} bytes sha256=${offlineDigest}`);
  console.log(`production dependency cache ${dependencyCacheReused ? "reused" : "created"} key=${dependencyCacheKey}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
