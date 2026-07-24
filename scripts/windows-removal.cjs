#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const dataRootArg = String(process.argv[2] || "");
const wslRootArg = String(process.argv[3] || "");
if (!path.isAbsolute(dataRootArg) || !path.isAbsolute(wslRootArg)) throw new Error("Exact Windows data roots are required.");
const dataRoot = path.resolve(dataRootArg);
const wslRoot = path.resolve(wslRootArg);
const database = path.join(dataRoot, "ctrl-pane.db");
if (!fs.existsSync(database)) process.exit(0);
const db = new DatabaseSync(database, { readOnly: true });
const installation = String(db.prepare("SELECT installation_id FROM workspace WHERE id=1").get()?.installation_id || "");
if (!/^[a-f0-9]{16}$/.test(installation)) throw new Error("Could not verify this installation's WSL identity.");
const prefix = `1helm-${installation}-channel-`;
const wsl = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "wsl.exe") : "wsl.exe";

function run(args, opts = {}) {
  return spawnSync(wsl, args, { encoding: "utf8", windowsHide: true, timeout: 90_000, ...opts });
}
function removeInstallDir(name) {
  if (!name.startsWith(prefix) || !/^\d+$/.test(name.slice(prefix.length))) throw new Error("Refusing an unsafe WSL install-directory cleanup target.");
  const installDir = path.resolve(wslRoot, name);
  if (path.dirname(installDir) !== wslRoot) throw new Error("Refusing a WSL install directory outside 1Helm's private root.");
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; fs.existsSync(installDir) && attempt < 120; attempt++) {
    try { fs.rmSync(installDir, { recursive: true, force: true }); }
    catch (error) { if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(error?.code || ""))) throw error; }
    if (fs.existsSync(installDir)) Atomics.wait(pause, 0, 0, 250);
  }
  if (fs.existsSync(installDir)) throw new Error(`WSL released ${name}, but its private virtual-disk directory remained locked.`);
}
const listed = run(["--list", "--quiet"]);
if (listed.status !== 0) throw new Error("Could not list WSL distributions during 1Helm removal.");
const decoded = String(listed.stdout || "").replaceAll("\0", "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
let deleted = 0;
for (const name of decoded) {
  if (!name.startsWith(prefix) || !/^\d+$/.test(name.slice(prefix.length))) continue;
  const channelId = name.slice(prefix.length);
  const ownership = run(["--distribution", name, "--user", "root", "--cd", "/", "--exec", "/bin/cat", "/var/lib/1helm/owner"]);
  if (ownership.status !== 0 || String(ownership.stdout || "").trim() !== `${installation}:${channelId}`) {
    throw new Error(`Refusing to unregister ${name}: its owner marker does not match exactly.`);
  }
  if (run(["--terminate", name]).status !== 0) throw new Error(`Could not stop owned WSL distribution ${name}.`);
  if (run(["--unregister", name]).status !== 0) throw new Error(`Could not unregister owned WSL distribution ${name}.`);
  removeInstallDir(name);
  deleted++;
}
fs.mkdirSync(dataRoot, { recursive: true });
fs.writeFileSync(path.join(dataRoot, "windows-removal-status.json"), `${JSON.stringify({ deleted, at: Date.now() })}\n`, { mode: 0o600 });
