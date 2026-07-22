import { readFileSync } from "node:fs";
import { join } from "node:path";

export const UPDATE_REPOSITORY = "gitcommit90/1Helm";
export const UPDATE_MANIFEST_URL = String(process.env.HELM_UPDATE_MANIFEST_URL || "https://demo.1helm.com/api/app/update/latest");

type UpdateManifest = { version?: unknown };

const versionParts = (value: string): number[] | null => {
  const match = value.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
};

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw new Error("Could not compare the installed and released 1Helm versions.");
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function installedAppVersion(appRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { version?: unknown };
    const version = String(pkg.version || "").trim();
    if (versionParts(version)) return version;
  } catch { /* use the explicit unknown state below */ }
  return "unknown";
}

export async function appUpdateStatus(appRoot: string): Promise<{
  current_version: string;
  latest_version: string;
  status: "latest" | "available";
  release_url: string;
  download_url: string;
}> {
  const currentVersion = installedAppVersion(appRoot);
  if (currentVersion === "unknown") throw new Error("Could not read this 1Helm installation's version.");

  let response: Response;
  try {
    response = await fetch(UPDATE_MANIFEST_URL, {
      headers: { accept: "application/json", "user-agent": "1Helm-update-check" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Could not reach 1Helm's update service. Check your connection and try again.");
  }
  if (!response.ok) throw new Error(`Could not check 1Helm updates (HTTP ${response.status}).`);

  const manifest = await response.json() as UpdateManifest;
  const latestVersion = String(manifest.version || "").trim().replace(/^v/i, "");
  if (!versionParts(latestVersion)) {
    throw new Error("1Helm's update service returned an invalid version.");
  }

  const releaseUrl = `https://github.com/${UPDATE_REPOSITORY}/releases/tag/v${latestVersion}`;
  const downloadUrl = `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${latestVersion}/1Helm-${latestVersion}-arm64.dmg`;
  return {
    current_version: currentVersion,
    latest_version: latestVersion,
    status: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "latest",
    release_url: releaseUrl,
    download_url: downloadUrl,
  };
}
