import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseStableManifest, readStableManifest, validateDownloadedManifest, validateManifestRelease } from "../scripts/stable-manifest-lib.mjs";

const root = join(import.meta.dirname, "..");
const stablePath = join(root, "site", "stable-manifest.json");

function releaseFor(manifest) {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    tag_name: manifest.tag, draft: false, prerelease: false,
    assets: [
      ...manifest.artifacts.map((artifact) => ({ name: artifact.name, digest: `sha256:${artifact.sha256}`, browser_download_url: artifact.url })),
      { name: `1Helm-${manifest.version}-stable.json`, digest: `sha256:${createHash("sha256").update(text).digest("hex")}`, browser_download_url: `https://github.com/gitcommit90/1Helm/releases/download/${manifest.tag}/1Helm-${manifest.version}-stable.json` },
    ],
  };
}

test("source-controlled stable metadata is machine-readable and contains the last known complete release", () => {
  const manifest = readStableManifest(stablePath);
  assert.equal(manifest.version, "0.0.41");
  assert.equal(manifest.artifacts.length, 3);
  assert.ok(manifest.artifacts.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));
  const server = readFileSync(join(root, "site", "server.mjs"), "utf8");
  assert.doesNotMatch(server, /RELEASE_FALLBACK_TAG|const RELEASE_FALLBACK/);
  assert.match(server, /lastKnownStableManifest/);
  assert.match(server, /retainStableManifest/);
  assert.match(server, /GitHub Stable manifest would move or rewrite Stable/);
});

test("digest-qualified remote stable manifests must match every GitHub Release asset", () => {
  const manifest = readStableManifest(stablePath);
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  const release = releaseFor(manifest);
  assert.equal(validateDownloadedManifest(body, release).commit, manifest.commit);
  const mismatched = structuredClone(release);
  mismatched.assets[0].digest = `sha256:${"f".repeat(64)}`;
  assert.throws(() => validateManifestRelease(manifest, mismatched), /does not match mac_dmg/);
  assert.throws(() => validateDownloadedManifest(`${body} `, release), /downloaded manifest digest/);
});

test("invalid last-known-good manifests fail closed instead of inventing metadata", () => {
  const manifest = JSON.parse(readFileSync(stablePath, "utf8"));
  manifest.artifacts.pop();
  assert.throws(() => parseStableManifest(JSON.stringify(manifest)), /artifact matrix is incomplete/);
  manifest.artifacts = readStableManifest(stablePath).artifacts;
  manifest.artifacts[2].url = "https://example.invalid/fake.tgz";
  assert.throws(() => parseStableManifest(JSON.stringify(manifest)), /name, digest, or URL mismatch/);
});
