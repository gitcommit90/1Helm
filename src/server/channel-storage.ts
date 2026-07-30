import { platform } from "node:os";
import { join } from "node:path";
import { DATA_DIR, q1 } from "./db.ts";

export const hostChannelRoot = (channelId: number): string => join(DATA_DIR, "channels", String(channelId));

export function installationScopedRuntimeName(): string {
  const installationId = String(q1("SELECT installation_id FROM workspace WHERE id=1")?.installation_id || "");
  if (!/^[a-f0-9]{16}$/.test(installationId)) throw new Error("1Helm installation identity is not ready.");
  return `1helm-${installationId}-runtime`;
}

function channelMachineId(channelId: number): string {
  const stored = String(q1("SELECT machine_id FROM channel_computers WHERE channel_id=?", channelId)?.machine_id || "");
  if (/^1helm-[a-f0-9]{16}-channel-\d+$/.test(stored)) return stored;
  const installationId = String(q1("SELECT installation_id FROM workspace WHERE id=1")?.installation_id || "");
  if (!/^[a-f0-9]{16}$/.test(installationId)) throw new Error("1Helm installation identity is not ready.");
  return `1helm-${installationId}-channel-${channelId}`;
}

function effectiveBackend(channelId: number): string {
  if (String(q1("SELECT name FROM channels WHERE id=?", channelId)?.name || "") === "main") return "native";
  const stored = String(q1("SELECT backend FROM channel_computers WHERE channel_id=?", channelId)?.backend || "");
  if (stored) return stored;
  const configured = String(process.env.HELM_CHANNEL_COMPUTER_BACKEND || "");
  if (configured) return configured;
  return platform() === "darwin" ? "apple" : "oci";
}

export function ociHostStateRoot(): string {
  if (process.env.HELM_OCI_HOST_STATE_ROOT) return process.env.HELM_OCI_HOST_STATE_ROOT;
  if (platform() === "win32") {
    return `\\\\wsl.localhost\\${installationScopedRuntimeName()}\\var\\lib\\1helm-oci-v1\\runtime\\oci`;
  }
  return process.env.HELM_OCI_STATE_ROOT || join(DATA_DIR, "runtime", "oci");
}

/**
 * Runtime-owned workspace storage is authoritative for OCI channels. Apple
 * retains its narrow host mirror, and development backends use the ordinary
 * data tree.
 */
export function channelFilesystemRoot(channelId: number): string {
  if (effectiveBackend(channelId) !== "oci") return hostChannelRoot(channelId);
  return join(ociHostStateRoot(), "channels", channelMachineId(channelId));
}

export function channelUsesRuntimeStorage(channelId: number): boolean {
  return effectiveBackend(channelId) === "oci";
}

export const channelWorkspacePath = (channelId: number): string => join(channelFilesystemRoot(channelId), "workspace");
export const channelFilesPath = (channelId: number): string => join(channelFilesystemRoot(channelId), "files");
