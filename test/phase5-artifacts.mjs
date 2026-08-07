import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  channelImageArtifactName, normalizeChannelImageManifest, validateSplitArtifactManifest,
} from "../scripts/artifact-contract.mjs";

const root = join(import.meta.dirname, "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => readFileSync(join(root, path), "utf8");
const imageBytes = Buffer.from("phase5 sealed image");
const imageDigest = sha(imageBytes);

function imageManifest(overrides = {}) {
  const architecture = overrides.architecture || "amd64";
  const digest = overrides.sha256 || imageDigest;
  const tag = `channel-image-v1-${architecture}-${digest}`;
  const name = channelImageArtifactName({ architecture, sha256: digest });
  return {
    schema: 1, kind: "1helm-sealed-channel-image", version: "1", architecture, sha256: digest,
    bytes: imageBytes.length, artifact: {
      name, url: `https://github.com/gitcommit90/1Helm/releases/download/${tag}/${name}`,
      manifest_url: `https://github.com/gitcommit90/1Helm/releases/download/${tag}/${name.replace(/\.oci\.tar$/, ".json")}`,
    },
    inputs: { containerfile_sha256: "a".repeat(64), context_sha256: "b".repeat(64), base_image_digest: "c".repeat(64) },
    cache: { key: "d".repeat(64), reused: false }, platforms: ["linux", "windows-wsl"],
  };
}

function fixture() {
  const scratch = mkdtempSync(join(tmpdir(), "1helm-phase5-"));
  const prefix = join(scratch, "online", "1Helm-1.2.3");
  const offlinePrefix = join(scratch, "offline", "1Helm-1.2.3");
  const image = imageManifest();
  for (const dir of [prefix, offlinePrefix]) {
    mkdirSync(join(dir, "resources"), { recursive: true }); mkdirSync(join(dir, "container"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    writeFileSync(join(dir, "resources", "channel-image.json"), JSON.stringify(image));
  }
  writeFileSync(join(offlinePrefix, "container", "channel-machine.oci.tar"), imageBytes);
  writeFileSync(join(offlinePrefix, "container", "channel-machine.oci.sha256"), `${image.sha256}\n`);
  const online = join(scratch, "1Helm-1.2.3-linux-node.tgz");
  const offline = join(scratch, "1Helm-1.2.3-linux-node-offline.tgz");
  execFileSync("tar", ["-czf", online, "-C", join(scratch, "online"), "1Helm-1.2.3"]);
  execFileSync("tar", ["-czf", offline, "-C", join(scratch, "offline"), "1Helm-1.2.3"]);
  const split = join(scratch, "split.json");
  writeFileSync(split, JSON.stringify({
    schema: 1, kind: "1helm-linux-split-artifacts", version: "1.2.3",
    app: { name: "1Helm-1.2.3-linux-node.tgz", sha256: sha(readFileSync(online)), bytes: statSync(online).size, contains_channel_image: false },
    offline: { name: "1Helm-1.2.3-linux-node-offline.tgz", sha256: sha(readFileSync(offline)), bytes: statSync(offline).size, contains_channel_image: true },
    channel_image: image,
    production_dependencies: { key: "1".repeat(64), reused: false, node_abi: "127", architecture: "x64", builder_image_digest: "2".repeat(64) },
  }));
  return { scratch, online, offline, split, image };
}

test("online candidate excludes OCI bytes while offline bundle includes exact bytes", () => {
  const item = fixture();
  try {
    const onlineEntries = execFileSync("tar", ["-tzf", item.online], { encoding: "utf8" });
    assert.doesNotMatch(onlineEntries, /channel-machine\.oci\.tar/);
    const offlineBytes = execFileSync("tar", ["-xOzf", item.offline, "1Helm-1.2.3/container/channel-machine.oci.tar"]);
    assert.equal(sha(offlineBytes), imageDigest);
  } finally { rmSync(item.scratch, { recursive: true, force: true }); }
});

test("immutable image manifests do not change when a later candidate reuses the same bytes", async () => {
  const { releasedChannelImageManifest } = await import("../scripts/artifact-contract.mjs");
  const created = imageManifest();
  const reused = { ...created, cache: { ...created.cache, reused: true } };
  assert.deepEqual(releasedChannelImageManifest(created), releasedChannelImageManifest(reused));
  assert.equal(releasedChannelImageManifest(reused).cache.reused, false);
});

test("image digest, architecture, and cache input mismatches fail closed", () => {
  assert.throws(() => normalizeChannelImageManifest({ ...imageManifest(), sha256: "0".repeat(64) }, { requireUrl: true }), /artifact name/);
  assert.throws(() => normalizeChannelImageManifest({ ...imageManifest(), architecture: "s390x" }), /architecture/);
  const missingInput = imageManifest(); delete missingInput.inputs.context_sha256;
  assert.throws(() => normalizeChannelImageManifest(missingInput), /context_sha256/);
});

test("cache keys cover exact architecture, ABI, lockfile, builder, and Containerfile inputs", () => {
  const packager = read("scripts/package-linux-host.mjs");
  const imageBuilder = read("scripts/build-oci-channel-image.sh");
  assert.match(packager, /digestText\(digestFile\(join\(releaseRoot, "package-lock\.json"\)\), runtimePackageSha256,[\s\S]*builderAbi, nativeArchitecture, builderDigest\)/);
  assert.match(imageBuilder, /ARCH.*BASE_DIGEST.*CONTAINERFILE_SHA.*CONTEXT_SHA/s);
  assert.match(packager, /dependencyCacheReused = true/);
  assert.match(imageBuilder, /CACHE_REUSED=true/);
  assert.doesNotMatch(imageBuilder, /VERSION=.*package\.json/);
});

test("legacy complete bundles remain supported and image GC is report-only", () => {
  const installer = read("site/public/install-oci-runtime.sh");
  assert.match(installer, /legacy sealed channel image digest does not match/);
  assert.match(installer, /shared-images\/sha256/);
  const scratch = mkdtempSync(join(tmpdir(), "1helm-phase5-gc-"));
  try {
    const image = join(scratch, "images", imageDigest); mkdirSync(image, { recursive: true }); writeFileSync(join(image, "image.oci.tar"), imageBytes);
    const output = execFileSync(process.execPath, [join(root, "scripts", "channel-image-gc-report.mjs"), join(scratch, "images"), join(scratch, "releases")], { encoding: "utf8" });
    const report = JSON.parse(output); assert.equal(report.mode, "report-only"); assert.equal(report.automatic_deletion, false); assert.equal(report.images[0].action, "retain");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("artifact report tolerates missing platform artifacts and emits deterministic general paths", () => {
  const scratch = mkdtempSync(join(tmpdir(), "1helm-phase5-report-"));
  try {
    const output = join(scratch, "report.json");
    const emptyVendored = join(scratch, "vendored"); const emptyClient = join(scratch, "client");
    mkdirSync(emptyVendored); mkdirSync(emptyClient);
    const result = spawnSync(process.execPath, [join(root, "scripts", "artifact-size-report.mjs"), "--json", output,
      "--linux-app", join(scratch, "missing.tgz"), "--linux-offline", join(scratch, "missing-offline.tgz"),
      "--oci", join(scratch, "missing.oci.tar"), "--mac-dmg", join(scratch, "missing.dmg"), "--mac-zip", join(scratch, "missing.zip"),
      "--vendored", emptyVendored, "--client", emptyClient], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); const report = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(report.artifacts.mac_dmg.status, "missing"); assert.doesNotMatch(JSON.stringify(report), /\/tmp\//);
    assert.match(result.stdout, /mac_dmg: not present/);
    const checked = spawnSync(process.execPath, [join(root, "scripts", "artifact-size-report.mjs"), "--json", output, "--check",
      "--linux-app", join(scratch, "missing.tgz"), "--linux-offline", join(scratch, "missing-offline.tgz"),
      "--oci", join(scratch, "missing.oci.tar"), "--mac-dmg", join(scratch, "missing.dmg"), "--mac-zip", join(scratch, "missing.zip"),
      "--vendored", emptyVendored, "--client", emptyClient], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("artifact report distinguishes cold online transfer from an unchanged-image app update", () => {
  const item = fixture();
  try {
    const output = join(item.scratch, "report.json");
    const oci = join(item.scratch, "image.oci.tar"); writeFileSync(oci, imageBytes);
    const vendored = join(item.scratch, "vendored"); const client = join(item.scratch, "client");
    mkdirSync(vendored); mkdirSync(client);
    const result = spawnSync(process.execPath, [join(root, "scripts", "artifact-size-report.mjs"), "--json", output,
      "--linux-app", item.online, "--linux-offline", item.offline, "--oci", oci,
      "--mac-dmg", join(item.scratch, "missing.dmg"), "--mac-zip", join(item.scratch, "missing.zip"),
      "--vendored", vendored, "--client", client], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(output, "utf8"));
    const cold = report.baseline_comparison.linux_online_cold_vs_legacy_complete;
    assert.equal(cold.bytes, report.artifacts.linux_app_tgz.bytes + report.artifacts.sealed_oci_image.bytes);
    assert.match(result.stdout, /Linux cold online total \(app \+ image\)/);
  } finally { rmSync(item.scratch, { recursive: true, force: true }); }
});
