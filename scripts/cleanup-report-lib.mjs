import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

const BACKUP_PATTERN = /^agent\.ts\.bak-normal-terminal-\d{8}-\d{6}$/;

export function isGeneratedAgentBackup(name) {
  return BACKUP_PATTERN.test(String(name));
}

function emptyScan(label, path) {
  return { label, path, exists: false, fileCount: 0, bytes: 0, oldestMtimeMs: null, newestMtimeMs: null, incomplete: false };
}

function addFile(scan, stat) {
  scan.fileCount += 1;
  scan.bytes += stat.size;
  scan.oldestMtimeMs = scan.oldestMtimeMs === null ? stat.mtimeMs : Math.min(scan.oldestMtimeMs, stat.mtimeMs);
  scan.newestMtimeMs = scan.newestMtimeMs === null ? stat.mtimeMs : Math.max(scan.newestMtimeMs, stat.mtimeMs);
}

export async function scanDirectory(root, label, displayPath, dependencies = {}) {
  const lstatImpl = dependencies.lstatImpl || lstat;
  const readdirImpl = dependencies.readdirImpl || readdir;
  const scan = emptyScan(label, displayPath);
  let rootEntries;
  try {
    const rootStat = await lstatImpl(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      scan.exists = true;
      scan.incomplete = true;
      scan.notDirectory = true;
      return scan;
    }
    scan.exists = true;
    rootEntries = await readdirImpl(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") scan.incomplete = true;
    return scan;
  }
  const pending = rootEntries.map((entry) => ({ entry, parent: root }));
  while (pending.length) {
    const { entry, parent } = pending.pop();
    const path = join(parent, entry.name);
    if (entry.isDirectory()) {
      try {
        const children = await readdirImpl(path, { withFileTypes: true });
        pending.push(...children.map((child) => ({ entry: child, parent: path })));
      } catch { scan.incomplete = true; }
      continue;
    }
    try { addFile(scan, await lstatImpl(path)); } catch { scan.incomplete = true; }
  }
  return scan;
}

async function scanBackups(root) {
  const displayPath = "src/server/agent.ts.bak-normal-terminal-<timestamp>";
  const scan = emptyScan("Timestamped agent.ts backups", displayPath);
  const server = join(root, "src", "server");
  let entries;
  try { entries = await readdir(server, { withFileTypes: true }); }
  catch (error) {
    if (error?.code !== "ENOENT") scan.incomplete = true;
    return scan;
  }
  for (const entry of entries) {
    if (!isGeneratedAgentBackup(entry.name) || entry.isDirectory()) continue;
    scan.exists = true;
    try { addFile(scan, await lstat(join(server, entry.name))); } catch { scan.incomplete = true; }
  }
  return scan;
}

export async function collectCleanupReport(root, now = Date.now()) {
  const paths = await Promise.all([
    scanDirectory(join(root, ".release-tmp"), "Release scratch data", ".release-tmp/"),
    scanDirectory(join(root, ".native-test-data"), "Native test data", ".native-test-data/"),
    scanBackups(root),
  ]);
  return { checkedAt: new Date(now).toISOString(), readOnly: true, removed: false, paths };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function formatAge(timestamp, now) {
  if (timestamp === null) return "unknown";
  const hours = Math.max(0, Math.floor((now - timestamp) / 3_600_000));
  if (hours < 1) return "less than one hour";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

export function formatCleanupReport(report) {
  const now = Date.parse(report.checkedAt);
  const lines = [
    "1Helm generated-state cleanup report",
    `Checked: ${report.checkedAt}`,
    "Read-only report: this command has no removal mode and nothing was removed.",
  ];
  for (const path of report.paths) {
    lines.push("", path.label, `  Path: ${path.path}`);
    if (!path.exists) lines.push("  Status: not present");
    else if (path.notDirectory) lines.push("  Status: present but not scanned because it is not a normal directory");
    else if (path.fileCount === 0 && path.incomplete) lines.push("  Status: present, but contents could not be fully enumerated");
    else if (path.fileCount === 0) lines.push("  Status: present and empty");
    else {
      lines.push(`  Contents: ${path.fileCount} file${path.fileCount === 1 ? "" : "s"}, ${formatBytes(path.bytes)}`);
      lines.push(`  Oldest item age: ${formatAge(path.oldestMtimeMs, now)}`);
    }
    if (path.incomplete) lines.push("  Uncertainty: scan incomplete (some entries could not be read)");
  }
  const candidates = report.paths.filter((path) => path.exists && path.fileCount > 0).map((path) => path.path);
  lines.push("", candidates.length
    ? `Likely removable generated state (review first): ${candidates.join(", ")}`
    : "No generated files matching the known paths were found.");
  lines.push("Nothing was removed.");
  return `${lines.join("\n")}\n`;
}
