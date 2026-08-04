import { basename } from "node:path";

export const CHANNEL_IMAGE_KIND = "1helm-sealed-channel-image";
export const CHANNEL_IMAGE_SCHEMA = 1;
export const CHANNEL_IMAGE_CONTRACT_VERSION = "1";
export const LINUX_SPLIT_KIND = "1helm-linux-split-artifacts";
export const LINUX_SPLIT_SCHEMA = 1;

const HEX64 = /^[a-f0-9]{64}$/;
const ARCHITECTURES = new Set(["amd64", "arm64"]);

export function channelImageArtifactName({ architecture, sha256 }) {
  return `1Helm-channel-machine-v${CHANNEL_IMAGE_CONTRACT_VERSION}-${architecture}-${sha256}.oci.tar`;
}

export function channelImageManifestName({ architecture, sha256 }) {
  return `1Helm-channel-machine-v${CHANNEL_IMAGE_CONTRACT_VERSION}-${architecture}-${sha256}.json`;
}

export function channelImageProvenanceName({ architecture, sha256 }) {
  return `1Helm-channel-machine-v${CHANNEL_IMAGE_CONTRACT_VERSION}-${architecture}-${sha256}.provenance.json`;
}

export function channelImageReleaseTag({ architecture, sha256 }) {
  return `channel-image-v${CHANNEL_IMAGE_CONTRACT_VERSION}-${architecture}-${sha256}`;
}

export function offlineBundleName(version) {
  return `1Helm-${version}-linux-node-offline.tgz`;
}

export function normalizeChannelImageManifest(value, { requireUrl = false } = {}) {
  if (!value || Array.isArray(value) || value.schema !== CHANNEL_IMAGE_SCHEMA || value.kind !== CHANNEL_IMAGE_KIND) {
    throw new Error("sealed channel image manifest schema or kind mismatch");
  }
  const version = String(value.version || "");
  const architecture = String(value.architecture || "");
  const sha256 = String(value.sha256 || "");
  const bytes = Number(value.bytes);
  if (version !== CHANNEL_IMAGE_CONTRACT_VERSION) throw new Error("sealed channel image contract version mismatch");
  if (!ARCHITECTURES.has(architecture)) throw new Error("sealed channel image architecture is unsupported");
  if (!HEX64.test(sha256)) throw new Error("sealed channel image SHA-256 is invalid");
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error("sealed channel image byte count is invalid");
  const expectedName = channelImageArtifactName({ architecture, sha256 });
  if (value.artifact?.name !== expectedName || basename(String(value.artifact?.name || "")) !== expectedName) {
    throw new Error("sealed channel image artifact name is not digest-addressed");
  }
  const url = value.artifact?.url == null ? null : String(value.artifact.url);
  const manifestName = channelImageManifestName({ architecture, sha256 });
  const releaseTag = channelImageReleaseTag({ architecture, sha256 });
  const expectedUrl = `https://github.com/gitcommit90/1Helm/releases/download/${releaseTag}/${expectedName}`;
  const manifestUrl = value.artifact?.manifest_url == null ? null : String(value.artifact.manifest_url);
  const expectedManifestUrl = `https://github.com/gitcommit90/1Helm/releases/download/${releaseTag}/${manifestName}`;
  if (requireUrl && (url !== expectedUrl || manifestUrl !== expectedManifestUrl)) {
    throw new Error("sealed channel image release URLs are not immutable digest-addressed URLs");
  }
  if (url != null && url !== expectedUrl) throw new Error("sealed channel image artifact URL mismatch");
  if (manifestUrl != null && manifestUrl !== expectedManifestUrl) throw new Error("sealed channel image manifest URL mismatch");
  const inputs = value.inputs || {};
  for (const field of ["containerfile_sha256", "context_sha256", "base_image_digest"]) {
    if (!HEX64.test(String(inputs[field] || ""))) throw new Error(`sealed channel image ${field} is invalid`);
  }
  const cache = value.cache || {};
  if (!HEX64.test(String(cache.key || "")) || typeof cache.reused !== "boolean") {
    throw new Error("sealed channel image cache provenance is incomplete");
  }
  if (!Array.isArray(value.platforms) || value.platforms.length !== 2
      || value.platforms[0] !== "linux" || value.platforms[1] !== "windows-wsl") {
    throw new Error("sealed channel image platform contract is incomplete");
  }
  return {
    schema: CHANNEL_IMAGE_SCHEMA,
    kind: CHANNEL_IMAGE_KIND,
    version,
    architecture,
    sha256,
    bytes,
    artifact: { name: expectedName, ...(url ? { url, manifest_url: manifestUrl } : {}) },
    platforms: ["linux", "windows-wsl"],
    inputs: {
      containerfile_sha256: String(inputs.containerfile_sha256),
      context_sha256: String(inputs.context_sha256),
      base_image_digest: String(inputs.base_image_digest),
    },
    cache: { key: String(cache.key), reused: cache.reused },
  };
}

export function releasedChannelImageManifest(value) {
  const manifest = normalizeChannelImageManifest(value);
  const architecture = manifest.architecture;
  const sha256 = manifest.sha256;
  const tag = channelImageReleaseTag({ architecture, sha256 });
  return normalizeChannelImageManifest({
    ...manifest,
    // Reuse is a property of a particular candidate build, not of the sealed
    // bytes. Keep the immutable release manifest canonical and record the
    // actual build reuse alongside candidate provenance instead.
    cache: { ...manifest.cache, reused: false },
    artifact: {
      name: channelImageArtifactName({ architecture, sha256 }),
      url: `https://github.com/gitcommit90/1Helm/releases/download/${tag}/${channelImageArtifactName({ architecture, sha256 })}`,
      manifest_url: `https://github.com/gitcommit90/1Helm/releases/download/${tag}/${channelImageManifestName({ architecture, sha256 })}`,
    },
  }, { requireUrl: true });
}

export function validateSplitArtifactManifest(value, { version, architecture } = {}) {
  if (!value || value.schema !== LINUX_SPLIT_SCHEMA || value.kind !== LINUX_SPLIT_KIND) {
    throw new Error("Linux split artifact manifest schema or kind mismatch");
  }
  if (version && value.version !== version) throw new Error("Linux split artifact version mismatch");
  const app = value.app || {};
  const offline = value.offline || {};
  if (!/^\d+\.\d+\.\d+$/.test(String(value.version || ""))
      || app.name !== `1Helm-${value.version}-linux-node.tgz`
      || offline.name !== offlineBundleName(value.version)
      || !HEX64.test(String(app.sha256 || "")) || !HEX64.test(String(offline.sha256 || ""))
      || !Number.isSafeInteger(app.bytes) || app.bytes < 1
      || !Number.isSafeInteger(offline.bytes) || offline.bytes < 1) {
    throw new Error("Linux split artifact byte identities are incomplete");
  }
  const channelImage = normalizeChannelImageManifest(value.channel_image);
  if (architecture && channelImage.architecture !== architecture) throw new Error("Linux split channel image architecture mismatch");
  return { ...value, app: { ...app }, offline: { ...offline }, channel_image: channelImage };
}
