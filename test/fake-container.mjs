#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const stateRoot = process.env.FAKE_CONTAINER_STATE;
if (!stateRoot) process.exit(90);
mkdirSync(join(stateRoot, "machines"), { recursive: true });
const args = process.argv.slice(2);
writeFileSync(join(stateRoot, "calls.log"), `${JSON.stringify(args)}\n`, { flag: "a" });

const machineDir = (name) => join(stateRoot, "machines", name);
const configPath = (name) => join(machineDir(name), "config.json");
const systemStatusPath = join(stateRoot, "system-status");
const readConfig = (name) => existsSync(configPath(name)) ? JSON.parse(readFileSync(configPath(name), "utf8")) : null;
const writeConfig = (name, value) => writeFileSync(configPath(name), JSON.stringify(value));
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
};
const machineName = () => valueAfter("-n") || valueAfter("--name") || (["inspect", "stop", "rm", "delete"].includes(args[1]) ? args[2] : "");
const fail = (message, code = 1) => { process.stderr.write(`${message}\n`); process.exit(code); };

if (args[0] === "system" && args[1] === "version") {
  process.stdout.write(JSON.stringify([
    { version: "1.1.0", buildType: "release", commit: "fake", appName: "container" },
    { version: "container-apiserver version 1.1.0 (build: release, commit: fake)", buildType: "release", commit: "fake", appName: "container-apiserver" },
  ]));
  process.exit(0);
}
if (args[0] === "system" && args[1] === "status") {
  process.stdout.write(JSON.stringify({ status: existsSync(systemStatusPath) ? readFileSync(systemStatusPath, "utf8").trim() : "running" }));
  process.exit(0);
}
if (args[0] === "system" && args[1] === "stop") {
  writeFileSync(systemStatusPath, "stopped\n");
  process.exit(0);
}
if (args[0] === "system" && args[1] === "start") {
  const status = existsSync(systemStatusPath) ? readFileSync(systemStatusPath, "utf8").trim() : "running";
  if (status === "unregistered" && !args.includes("--enable-kernel-install")) {
    fail("unregistered container system requires --enable-kernel-install");
  }
  writeFileSync(systemStatusPath, "running\n");
  for (const entry of readdirSync(join(stateRoot, "machines"))) rmSync(join(stateRoot, "machines", entry, ".network-down"), { force: true });
  process.exit(0);
}
if (args[0] === "image" && args[1] === "inspect") {
  process.stdout.write(JSON.stringify({ reference: args[2] }));
  process.exit(0);
}
if (args[0] === "build") process.exit(0);

if (args[0] !== "machine") fail(`unsupported fake container command: ${args.join(" ")}`);
const action = args[1];
if (action === "list" || action === "ls") {
  const machinesRoot = join(stateRoot, "machines");
  const rows = existsSync(machinesRoot) ? readdirSync(machinesRoot).map((entry) => readConfig(entry)).filter(Boolean) : [];
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}
const name = machineName();
if (action === "create") {
  if (!name || readConfig(name)) fail("machine already exists");
  const cpus = Number(valueAfter("--cpus") || 2);
  const memoryText = valueAfter("--memory") || "2048M";
  const memory = Number(memoryText.replace(/[^0-9]/g, "")) * 1024 ** 2;
  const root = machineDir(name);
  mkdirSync(join(root, "workspace", "files"), { recursive: true });
  mkdirSync(join(root, "var", "lib", "1helm"), { recursive: true });
  writeFileSync(join(root, "var", "lib", "1helm", "image-contract"), "1helm-channel-machine-v1\n");
  writeFileSync(join(root, ".setup-transport-transient"), "1");
  writeConfig(name, { id: name, status: "stopped", cpus, memory, diskSize: 20 * 1024 ** 3, homeMount: valueAfter("--home-mount") || "none" });
  process.exit(0);
}
const config = readConfig(name);
if (!config) fail(`machine ${name} not found`);
if (action === "inspect") {
  const delay = Math.max(0, Number(process.env.FAKE_CONTAINER_INSPECT_DELAY_MS || 0));
  if (delay) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
  process.stdout.write(JSON.stringify(config));
  process.exit(0);
}
if (action === "stop") {
  config.status = "stopped";
  writeConfig(name, config);
  process.exit(0);
}
if (action === "set") {
  for (const arg of args.slice(3)) {
    if (arg.startsWith("cpus=")) config.cpus = Number(arg.slice(5));
    if (arg.startsWith("memory=")) config.memory = Number(arg.slice(7).replace(/[^0-9]/g, "")) * 1024 ** 2;
    if (arg.startsWith("home-mount=")) config.homeMount = arg.slice("home-mount=".length);
  }
  writeConfig(name, config);
  process.exit(0);
}
if (action === "rm" || action === "delete") {
  rmSync(machineDir(name), { recursive: true, force: true });
  process.exit(0);
}
if (action !== "run") fail(`unsupported machine action: ${action}`);
config.status = "running";
writeConfig(name, config);
if (args.includes("-it")) {
  const terminal = spawnSync("/bin/bash", [], { cwd: join(machineDir(name), "workspace"), stdio: "inherit" });
  process.exit(terminal.status ?? 0);
}
const separator = args.indexOf("--");
const decodeGuestWord = (word) => word.startsWith("'") && word.endsWith("'")
  ? word.slice(1, -1).replaceAll(`'"'"'`, "'")
  : word;
const command = separator >= 0 ? args.slice(separator + 1).map(decodeGuestWord) : [];
const root = machineDir(name);
const loginCommandIndex = command.indexOf("-lc");
const script = loginCommandIndex >= 0 ? command[loginCommandIndex + 1] || "" : "";

if (command[0] === "/bin/cat" && command[1] === "/var/lib/1helm/owner") {
  const owner = join(root, "var", "lib", "1helm", "owner");
  if (!existsSync(owner)) fail("owner missing");
  process.stdout.write(readFileSync(owner));
  process.exit(0);
}
if (script.includes("image-contract") && script.includes("/var/lib/1helm/owner")) {
  const transient = join(root, ".setup-transport-transient");
  if (existsSync(transient)) {
    rmSync(transient, { force: true });
    fail("Error: The operation couldn’t be completed. Operation not supported on socket");
  }
  mkdirSync(join(root, "workspace", "files"), { recursive: true });
  const ownerValue = command.at(-1);
  writeFileSync(join(root, "var", "lib", "1helm", "owner"), `${ownerValue}\n`);
  process.exit(0);
}
if ((command[0] === "/bin/tar" && command.includes("-cf")) || (script.includes("find -P workspace") && script.includes("--no-recursion"))) {
  const delay = Math.max(0, Number(process.env.FAKE_CONTAINER_EXPORT_DELAY_MS || 0));
  if (delay) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
  const listed = spawnSync("find", ["-P", "workspace", "-xdev", "(", "-type", "d", "-o", "-type", "f", ")", "-print0"], { cwd: root });
  if (listed.status !== 0) fail(String(listed.stderr || "fake workspace listing failed"));
  const tar = spawnSync("tar", ["-C", root, "--null", "--no-recursion", "-T", "-", "-cf", "-"], { input: listed.stdout, maxBuffer: 256 * 1024 ** 2 });
  if (tar.status !== 0) fail(String(tar.stderr || "fake export failed"));
  process.stdout.write(tar.stdout);
  process.exit(0);
}
if (args.includes("-i") && script.includes("tar -xf -")) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = Buffer.concat(chunks);
  if (script.includes("find /workspace") || script.includes("rm -rf /workspace")) {
    rmSync(join(root, "workspace"), { recursive: true, force: true });
    rmSync(join(root, "files"), { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const extracted = spawnSync("tar", ["-C", root, "-xf", "-"], { input });
    if (extracted.status !== 0) fail(String(extracted.stderr || "fake import failed"));
    mkdirSync(join(root, "workspace", "files"), { recursive: true });
    const importedFiles = join(root, "files");
    if (existsSync(importedFiles)) {
      const copied = spawnSync("cp", ["-a", `${importedFiles}/.`, join(root, "workspace", "files")]);
      if (copied.status !== 0) fail("fake files copy failed");
      rmSync(importedFiles, { recursive: true, force: true });
    }
  } else {
    const parent = command.at(-4);
    mkdirSync(join(root, parent.replace(/^\/+/, "")), { recursive: true });
    const extracted = spawnSync("tar", ["-C", join(root, parent.replace(/^\/+/, "")), "-xf", "-"], { input });
    if (extracted.status !== 0) fail(String(extracted.stderr || "fake incremental import failed"));
  }
  process.exit(0);
}
if (command[0] === "/bin/rm") {
  const target = command.at(-1).replace(/^\/+/, "");
  rmSync(join(root, target), { recursive: true, force: true });
  process.exit(0);
}
if (script.includes("SERVICES=") || script.includes("MemAvailable")) {
  if (existsSync(join(root, ".uncertain-quiescence"))) fail("inspection unavailable");
  const timer = existsSync(join(root, ".resident-runtime")) ? 1 : 0;
  process.stdout.write(`SERVICES=0\nTIMERS=${timer}\nCRON=0\nJOBS=0\nSOCKETS=0\nPATHS=0\nLOAD1=0.01\nMEM_AVAILABLE_KB=1048576\nDISK_USED_PERCENT=1\n`);
  process.exit(0);
}
if (script.includes("/sys/class/net/eth0/operstate") && script.includes("ip route show default")) {
  if (existsSync(join(root, ".network-down"))) fail("guest network link is down");
  process.exit(0);
}
if (script.includes("apt-get update") && script.includes("DEBIAN_FRONTEND")) {
  process.stdout.write("fake unattended update complete\n");
  process.exit(0);
}
if (script.includes("test ! -e /mnt/c") && script.includes("id -u agent")) process.exit(0);
if (command[0] === "/bin/bash" && command[1] === "-lc") {
  const cwd = valueAfter("-w") === "/workspace" ? join(root, "workspace") : root;
  const result = spawnSync("/bin/bash", ["-lc", command[2]], { cwd, encoding: null, maxBuffer: 16 * 1024 ** 2 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
if (script.includes("mkdir -p /workspace/files") || script.includes("test -d /workspace")) {
  mkdirSync(join(root, "workspace", "files"), { recursive: true });
  process.exit(0);
}
fail(`unsupported fake machine run: ${args.join(" ")}`);
