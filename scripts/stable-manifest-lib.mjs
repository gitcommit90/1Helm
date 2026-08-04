import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";

export const STABLE_MANIFEST_KIND = "1helm-promoted-stable";
export const STABLE_REPOSITORY = "gitcommit90/1Helm";
export const STABLE_ARTIFACT_ROLES = Object.freeze(["mac_dmg", "mac_updater_zip", "linux_tgz"]);

const VERSION = /^\d+\.\d+\.\d+$/;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export function sha256File(path) {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let length;
    while ((length = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
  } finally { closeSync(descriptor); }
  return hash.digest("hex");
}

export function stableArtifactNames(version) {
  return {
    mac_dmg: `1Helm-${version}-arm64.dmg`,
    mac_updater_zip: `1Helm-${version}-mac-arm64.zip`,
    linux_tgz: `1Helm-${version}-linux-node.tgz`,
  };
}

function refuse(message) {
  throw new Error(`Stable manifest refused: ${message}`);
}

export function validateStableManifest(value) {
  if (!value || Array.isArray(value) || value.schema !== 1 || value.kind !== STABLE_MANIFEST_KIND) {
    refuse("schema or kind mismatch");
  }
  if (value.repository !== STABLE_REPOSITORY || value.ref !== "refs/heads/main") {
    refuse("repository or ref mismatch");
  }
  const version = String(value.version || "");
  const commit = String(value.commit || "");
  if (!VERSION.test(version) || value.tag !== `v${version}` || !HEX40.test(commit)) refuse("version, tag, or commit is invalid");
  if (!ISO_TIME.test(String(value.promoted_at || ""))) refuse("promotion time is invalid");
  const promotion = value.promotion || {};
  if (!/^\d+$/.test(String(promotion.candidate_workflow_run_id || ""))
      || !/^\d+$/.test(String(promotion.candidate_artifact_id || ""))
      || !HEX64.test(String(promotion.manifest_sha256 || ""))) {
    refuse("promotion identity is incomplete");
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== STABLE_ARTIFACT_ROLES.length) {
    refuse("desktop artifact matrix is incomplete");
  }
  const names = stableArtifactNames(version);
  const byRole = new Map();
  for (const artifact of value.artifacts) {
    const role = String(artifact?.role || "");
    if (!STABLE_ARTIFACT_ROLES.includes(role) || byRole.has(role)) refuse("desktop artifact roles are invalid or duplicated");
    const digest = String(artifact.sha256 || "");
    const expectedUrl = `https://github.com/${STABLE_REPOSITORY}/releases/download/v${version}/${names[role]}`;
    if (artifact.name !== names[role] || !HEX64.test(digest) || artifact.url !== expectedUrl) {
      refuse(`${role} name, digest, or URL mismatch`);
    }
    if (artifact.bytes != null && (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1)) {
      refuse(`${role} byte count is invalid`);
    }
    byRole.set(role, { ...artifact, sha256: digest });
  }
  return {
    ...value,
    version,
    commit,
    promotion: {
      candidate_workflow_run_id: String(promotion.candidate_workflow_run_id),
      candidate_artifact_id: String(promotion.candidate_artifact_id),
      manifest_sha256: String(promotion.manifest_sha256),
    },
    artifacts: STABLE_ARTIFACT_ROLES.map((role) => byRole.get(role)),
  };
}

export function parseStableManifest(text) {
  let value;
  try { value = JSON.parse(String(text)); } catch { refuse("JSON is invalid"); }
  return validateStableManifest(value);
}

export function readStableManifest(path) {
  return parseStableManifest(readFileSync(path, "utf8"));
}

export function validateManifestRelease(manifestValue, release) {
  const manifest = validateStableManifest(manifestValue);
  if (!release || release.draft || release.prerelease || release.tag_name !== manifest.tag) {
    refuse("GitHub Release identity is not the promoted stable tag");
  }
  const releaseAssets = Array.isArray(release.assets) ? release.assets : [];
  for (const artifact of manifest.artifacts) {
    const matches = releaseAssets.filter((asset) => asset?.name === artifact.name);
    if (matches.length !== 1 || matches[0].digest !== `sha256:${artifact.sha256}`
        || matches[0].browser_download_url !== artifact.url) {
      refuse(`GitHub Release does not match ${artifact.role}`);
    }
  }
  return manifest;
}

export function manifestAssetForRelease(release) {
  const version = String(release?.tag_name || "").replace(/^v/, "");
  if (!VERSION.test(version)) refuse("GitHub Release tag is invalid");
  const expected = `1Helm-${version}-stable.json`;
  const matches = (Array.isArray(release.assets) ? release.assets : []).filter((asset) => asset?.name === expected);
  if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(String(matches[0].digest || ""))) {
    refuse("GitHub Release has no unique digest-qualified stable manifest asset");
  }
  return matches[0];
}

export function validateDownloadedManifest(body, release) {
  const asset = manifestAssetForRelease(release);
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  if (sha256(bytes) !== asset.digest.slice(7)) refuse("downloaded manifest digest does not match GitHub");
  return validateManifestRelease(parseStableManifest(bytes.toString("utf8")), release);
}
