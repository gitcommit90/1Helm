#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const dataRootArg = String(process.argv[2] || "");
const runtimeRootArg = String(process.argv[3] || "");
if (!path.isAbsolute(dataRootArg) || !path.isAbsolute(runtimeRootArg)) throw new Error("Exact Windows data roots are required.");
const dataRoot = path.resolve(dataRootArg);
const runtimeRoot = path.resolve(runtimeRootArg);
const database = path.join(dataRoot, "ctrl-pane.db");
if (!fs.existsSync(database)) process.exit(0);
const db = new DatabaseSync(database, { readOnly: true });
const installation = String(db.prepare("SELECT installation_id FROM workspace WHERE id=1").get()?.installation_id || "");
if (!/^[a-f0-9]{16}$/.test(installation)) throw new Error("Could not verify this installation's OCI runtime identity.");
const runtimeName = `1helm-${installation}-runtime`;
const prefix = `1helm-${installation}-channel-`;
const installDirectory = path.resolve(runtimeRoot, runtimeName);
if (path.dirname(installDirectory) !== runtimeRoot) throw new Error("Refusing a runtime directory outside 1Helm's private root.");
const wsl = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "wsl.exe") : "wsl.exe";

function run(args, timeout = 5 * 60_000) {
  return spawnSync(wsl, args, { encoding: "utf8", windowsHide: true, timeout });
}
function runtime(args, timeout) {
  return run(["--distribution", runtimeName, "--user", "root", "--exec", "/usr/libexec/1helm-oci-runtime", ...args], timeout);
}
function output(result) {
  return `${String(result.stdout || "")}\n${String(result.stderr || "")}`.replaceAll("\0", "").trim();
}
function removeInstallDirectory() {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; fs.existsSync(installDirectory) && attempt < 120; attempt++) {
    try { fs.rmSync(installDirectory, { recursive: true, force: true }); }
    catch (error) { if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(error?.code || ""))) throw error; }
    if (fs.existsSync(installDirectory)) Atomics.wait(pause, 0, 0, 250);
  }
  if (fs.existsSync(installDirectory)) throw new Error(`WSL released ${runtimeName}, but its private virtual disk remained locked.`);
}

const listed = run(["--list", "--quiet"], 90_000);
if (listed.status !== 0) throw new Error("Could not list WSL distributions during 1Helm removal.");
const names = String(listed.stdout || "").replaceAll("\0", "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
let deleted = 0;
if (names.includes(runtimeName)) {
  const version = runtime(["version"], 90_000);
  if (version.status !== 0 || output(version) !== "1helm-oci-runtime-v1") {
    throw new Error(`Refusing to remove ${runtimeName}: its installed OCI helper identity does not match.`);
  }
  const listedContainers = runtime(["list", prefix], 90_000);
  if (listedContainers.status !== 0) throw new Error(output(listedContainers) || "Could not list owned channel containers.");
  let containers;
  try { containers = JSON.parse(String(listedContainers.stdout || "[]")); }
  catch { throw new Error("The shared OCI runtime returned an unreadable channel-container list."); }
  if (!Array.isArray(containers)) throw new Error("The shared OCI runtime returned an invalid channel-container list.");
  for (const name of containers) {
    if (typeof name !== "string" || !name.startsWith(prefix) || !/^\d+$/.test(name.slice(prefix.length))) {
      throw new Error("Refusing an unsafe OCI channel-container cleanup target.");
    }
    const channelId = name.slice(prefix.length);
    const removed = runtime(["delete", name, `${installation}:${channelId}`]);
    if (removed.status !== 0) throw new Error(output(removed) || `Could not delete owned OCI container ${name}.`);
    deleted++;
  }
  const remaining = runtime(["list", prefix], 90_000);
  if (remaining.status !== 0 || String(remaining.stdout || "").trim() !== "[]") {
    throw new Error("Owned channel containers remained; the shared runtime was preserved.");
  }
  if (run(["--terminate", runtimeName], 90_000).status !== 0) throw new Error(`Could not stop shared runtime ${runtimeName}.`);
  if (run(["--unregister", runtimeName], 5 * 60_000).status !== 0) throw new Error(`Could not unregister shared runtime ${runtimeName}.`);
  removeInstallDirectory();
}
fs.mkdirSync(dataRoot, { recursive: true });
fs.writeFileSync(path.join(dataRoot, "windows-removal-status.json"), `${JSON.stringify({ deleted, runtime: runtimeName, at: Date.now() })}\n`, { mode: 0o600 });
