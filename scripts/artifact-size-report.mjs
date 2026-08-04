#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync, lstatSync, mkdtempSync, openSync, closeSync, readFileSync, readSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const budgets = JSON.parse(readFileSync(join(root, "config", "artifact-budgets.json"), "utf8"));
const version = String(pkg.version);
const argv = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : String(argv[index + 1] || "");
};
const jsonOutput = resolve(option("--json", join(root, "dist", "artifact-size-report.json")));
const textOutput = option("--text") ? resolve(option("--text")) : "";
const checkBudgets = argv.includes("--check");
const inputs = {
  linux_app_tgz: option("--linux-app", join(root, "dist", `1Helm-${version}-linux-node.tgz`)),
  linux_offline_tgz: option("--linux-offline", join(root, "dist", `1Helm-${version}-linux-node-offline.tgz`)),
  sealed_oci_image: option("--oci", join(root, "container", "channel-machine.oci.tar")),
  mac_dmg: option("--mac-dmg", join(root, "dist", `1Helm-${version}-arm64.dmg`)),
  mac_zip: option("--mac-zip", join(root, "dist", `1Helm-${version}-mac-arm64.zip`)),
  vendored_dependencies: option("--vendored", join(root, "node_modules")),
  client_assets: option("--client", join(root, "public")),
};

function digestFile(path) {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let count; while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { closeSync(fd); }
  return hash.digest("hex");
}

function files(directory, base = "") {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) result.push(...files(path, rel));
    else if (entry.isFile()) result.push({ path, relative: rel, bytes: statSync(path).size });
  }
  return result;
}

function directoryRecord(path, budgetKey) {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) return { status: "missing" };
  const records = files(path);
  const bytes = records.reduce((sum, file) => sum + file.bytes, 0);
  return {
    status: "present", bytes, files: records.length,
    budget: comparison(bytes, budgets.budgets[budgetKey]),
  };
}

function comparison(actual, ceiling) {
  if (!Number.isSafeInteger(ceiling)) return null;
  return { ceiling, delta: actual - ceiling, passed: actual <= ceiling };
}

function compositionFor(directory) {
  const groups = { sealed_oci: 0, vendored_dependencies: 0, client_assets: 0, other_runtime: 0 };
  let count = 0;
  for (const file of files(directory)) {
    count += 1;
    const rel = file.relative.replace(/^[^/]+\//, "");
    if (rel === "container/channel-machine.oci.tar" || rel.endsWith("/container/channel-machine.oci.tar")) groups.sealed_oci += file.bytes;
    else if (rel.startsWith("node_modules/") || rel.includes("/node_modules/")) groups.vendored_dependencies += file.bytes;
    else if (rel.startsWith("public/") || rel.includes("/public/") || rel === "desktop/photon-sidecar.bundle.mjs" || rel.endsWith("/desktop/photon-sidecar.bundle.mjs")) groups.client_assets += file.bytes;
    else groups.other_runtime += file.bytes;
  }
  return { files: count, unpacked_bytes: Object.values(groups).reduce((sum, value) => sum + value, 0), groups };
}

function archiveRecord(path, type, budgetKey) {
  if (!existsSync(path) || !lstatSync(path).isFile()) return { status: "missing" };
  const bytes = statSync(path).size;
  const record = { status: "present", name: basename(path), bytes, sha256: digestFile(path), budget: comparison(bytes, budgets.budgets[budgetKey]) };
  if (type === "tgz") {
    const scratch = mkdtempSync(join(tmpdir(), "1helm-composition-"));
    try {
      const extract = spawnSync("tar", ["-xzf", path, "-C", scratch], { stdio: "pipe", maxBuffer: 16 * 1024 * 1024 });
      if (extract.status !== 0) throw new Error(`tar refused ${basename(path)}: ${String(extract.stderr || "").trim()}`);
      record.composition = compositionFor(scratch);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  } else if (type === "oci") {
    const listing = spawnSync("tar", ["-tf", path], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    record.composition = listing.status === 0 ? {
      entries: String(listing.stdout).trim().split("\n").filter(Boolean).length,
      blobs: String(listing.stdout).trim().split("\n").filter((entry) => /(^|\/)blobs\/sha256\/[a-f0-9]{64}$/.test(entry)).length,
    } : { status: "unreadable" };
  } else if (type === "zip") {
    const scratch = mkdtempSync(join(tmpdir(), "1helm-zip-composition-"));
    try {
      const extract = spawnSync("unzip", ["-qq", path, "-d", scratch], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      record.composition = extract.status === 0 ? compositionFor(scratch) : { status: "unavailable" };
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  } else if (type === "dmg") {
    const scratch = mkdtempSync(join(tmpdir(), "1helm-dmg-composition-"));
    const mount = join(scratch, "mount");
    let attached = false;
    try {
      const attach = spawnSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, path], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      attached = attach.status === 0;
      record.composition = attached ? compositionFor(mount) : { status: "unavailable" };
    } finally {
      if (attached) spawnSync("hdiutil", ["detach", mount], { stdio: "ignore" });
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return record;
}

function duplicateRecord(paths) {
  const candidates = [];
  for (const [scope, path] of Object.entries(paths)) {
    if (!existsSync(path) || !lstatSync(path).isDirectory()) continue;
    for (const file of files(path)) if (file.bytes > 0) candidates.push({ ...file, scope });
  }
  const bySize = new Map();
  for (const file of candidates) {
    const group = bySize.get(file.bytes) || [];
    group.push(file); bySize.set(file.bytes, group);
  }
  const duplicates = [];
  for (const [bytes, group] of bySize) {
    if (group.length < 2) continue;
    const hashes = new Map();
    for (const file of group) {
      const digest = digestFile(file.path);
      const matches = hashes.get(digest) || [];
      matches.push(file); hashes.set(digest, matches);
    }
    for (const [sha256, matches] of hashes) if (matches.length > 1) duplicates.push({
      sha256, bytes_each: bytes, copies: matches.length, duplicate_bytes: bytes * (matches.length - 1),
      files: matches.map((file) => `${file.scope}/${file.relative}`).sort(),
    });
  }
  duplicates.sort((a, b) => b.duplicate_bytes - a.duplicate_bytes || a.sha256.localeCompare(b.sha256));
  const duplicateBytes = duplicates.reduce((sum, item) => sum + item.duplicate_bytes, 0);
  return { bytes: duplicateBytes, groups: duplicates.length, largest_groups: duplicates.slice(0, 20), budget: comparison(duplicateBytes, budgets.budgets.duplicate_bytes) };
}

const artifacts = {
  linux_app_tgz: archiveRecord(inputs.linux_app_tgz, "tgz", "linux_app_tgz"),
  linux_offline_tgz: archiveRecord(inputs.linux_offline_tgz, "tgz", "linux_offline_tgz"),
  sealed_oci_image: archiveRecord(inputs.sealed_oci_image, "oci", "sealed_oci_image"),
  mac_dmg: archiveRecord(inputs.mac_dmg, "dmg", "mac_dmg"),
  mac_zip: archiveRecord(inputs.mac_zip, "zip", "mac_zip"),
};
let trees;
let duplicates;
if (artifacts.linux_app_tgz.status === "present") {
  const scratch = mkdtempSync(join(tmpdir(), "1helm-packaged-trees-"));
  try {
    const extract = spawnSync("tar", ["-xzf", inputs.linux_app_tgz, "-C", scratch], { stdio: "pipe", maxBuffer: 16 * 1024 * 1024 });
    if (extract.status !== 0) throw new Error(`tar refused ${basename(inputs.linux_app_tgz)}`);
    const top = readdirSync(scratch, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    if (top.length !== 1) throw new Error("Linux app archive must have exactly one top-level directory");
    const packaged = join(scratch, top[0].name);
    trees = {
      vendored_dependencies: directoryRecord(join(packaged, "node_modules"), "linux_unpacked_node_modules"),
      client_assets: directoryRecord(join(packaged, "public"), "linux_client_assets"),
    };
    duplicates = duplicateRecord({ vendored_dependencies: join(packaged, "node_modules"), client_assets: join(packaged, "public") });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
} else {
  trees = {
    vendored_dependencies: directoryRecord(inputs.vendored_dependencies, "linux_unpacked_node_modules"),
    client_assets: directoryRecord(inputs.client_assets, "linux_client_assets"),
  };
  duplicates = duplicateRecord({ vendored_dependencies: inputs.vendored_dependencies, client_assets: inputs.client_assets });
}
const baselineComparison = {
  linux_online_cold_vs_legacy_complete: artifacts.linux_app_tgz.status === "present" && artifacts.sealed_oci_image.status === "present" ? {
    baseline: budgets.baselines.legacy_linux_complete_tgz,
    bytes: artifacts.linux_app_tgz.bytes + artifacts.sealed_oci_image.bytes,
    delta: artifacts.linux_app_tgz.bytes + artifacts.sealed_oci_image.bytes - budgets.baselines.legacy_linux_complete_tgz,
    savings: budgets.baselines.legacy_linux_complete_tgz - artifacts.linux_app_tgz.bytes - artifacts.sealed_oci_image.bytes,
    savings_percent: Number((((budgets.baselines.legacy_linux_complete_tgz - artifacts.linux_app_tgz.bytes - artifacts.sealed_oci_image.bytes) / budgets.baselines.legacy_linux_complete_tgz) * 100).toFixed(2)),
  } : null,
  linux_app_vs_legacy_complete: artifacts.linux_app_tgz.status === "present" ? {
    baseline: budgets.baselines.legacy_linux_complete_tgz,
    delta: artifacts.linux_app_tgz.bytes - budgets.baselines.legacy_linux_complete_tgz,
    savings: budgets.baselines.legacy_linux_complete_tgz - artifacts.linux_app_tgz.bytes,
    savings_percent: Number((((budgets.baselines.legacy_linux_complete_tgz - artifacts.linux_app_tgz.bytes) / budgets.baselines.legacy_linux_complete_tgz) * 100).toFixed(2)),
  } : null,
  linux_offline_vs_legacy_complete: artifacts.linux_offline_tgz.status === "present" ? {
    baseline: budgets.baselines.legacy_linux_complete_tgz,
    delta: artifacts.linux_offline_tgz.bytes - budgets.baselines.legacy_linux_complete_tgz,
    savings: budgets.baselines.legacy_linux_complete_tgz - artifacts.linux_offline_tgz.bytes,
    savings_percent: Number((((budgets.baselines.legacy_linux_complete_tgz - artifacts.linux_offline_tgz.bytes) / budgets.baselines.legacy_linux_complete_tgz) * 100).toFixed(2)),
  } : null,
};
const report = { schema: 1, kind: "1helm-artifact-size-report", version, artifacts, trees, duplicates, baseline_comparison: baselineComparison, baselines: budgets.baselines, budgets: budgets.budgets };
const lines = ["1Helm artifact size report", `  Version: ${version}`];
for (const [name, record] of Object.entries(artifacts)) lines.push(`  ${name}: ${record.status === "present" ? `${record.bytes.toLocaleString("en-US")} bytes${record.budget ? ` (${record.budget.passed ? "within" : "OVER"} budget)` : ""}` : "not present"}`);
for (const [name, record] of Object.entries(trees)) lines.push(`  ${name}: ${record.status === "present" ? `${record.bytes.toLocaleString("en-US")} unpacked bytes${record.budget ? ` (${record.budget.passed ? "within" : "OVER"} budget)` : ""}` : "not present"}`);
lines.push(`  duplicate_bytes: ${duplicates.bytes.toLocaleString("en-US")} bytes across ${duplicates.groups} content groups (${duplicates.budget.passed ? "within" : "OVER"} budget)`);
if (baselineComparison.linux_online_cold_vs_legacy_complete) lines.push(`  Linux cold online total (app + image): ${baselineComparison.linux_online_cold_vs_legacy_complete.bytes.toLocaleString("en-US")} bytes; saving vs v0.0.41 complete: ${baselineComparison.linux_online_cold_vs_legacy_complete.savings.toLocaleString("en-US")} bytes (${baselineComparison.linux_online_cold_vs_legacy_complete.savings_percent}%)`);
if (baselineComparison.linux_app_vs_legacy_complete) lines.push(`  Linux online saving vs v0.0.41 complete: ${baselineComparison.linux_app_vs_legacy_complete.savings.toLocaleString("en-US")} bytes (${baselineComparison.linux_app_vs_legacy_complete.savings_percent}%)`);
if (baselineComparison.linux_offline_vs_legacy_complete) lines.push(`  Linux offline saving vs v0.0.41 complete: ${baselineComparison.linux_offline_vs_legacy_complete.savings.toLocaleString("en-US")} bytes (${baselineComparison.linux_offline_vs_legacy_complete.savings_percent}%)`);
const plain = `${lines.join("\n")}\n`;
const parent = resolve(jsonOutput, "..");
if (!existsSync(parent)) throw new Error(`report output directory does not exist: ${relative(root, parent).split(sep).join("/")}`);
writeFileSync(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
if (textOutput) writeFileSync(textOutput, plain);
process.stdout.write(plain);
if (checkBudgets) {
  const records = [...Object.values(artifacts), ...Object.values(trees), duplicates];
  const failed = records.filter((record) => record?.status !== "missing" && record?.budget && !record.budget.passed);
  if (failed.length) {
    process.stderr.write(`${failed.length} present artifact/composition budget(s) exceeded.\n`);
    process.exitCode = 1;
  }
}
