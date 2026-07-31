#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const stateRoot = process.env.HELM_OCI_STATE_ROOT_OVERRIDE || process.env.FAKE_OCI_STATE;
if (!stateRoot) process.exit(90);
const root = resolve(stateRoot);
const machines = join(root, "machines");
const channels = join(root, "channels");
const backups = join(root, "backups");
const fakeContainer = resolve(import.meta.dirname, "fake-container.mjs");
const args = process.argv.slice(2);
mkdirSync(machines, { recursive: true });
mkdirSync(channels, { recursive: true });
mkdirSync(backups, { recursive: true });
writeFileSync(join(root, "oci-calls.log"), `${JSON.stringify(args)}\n`, { flag: "a" });

const machineDir = (name) => join(machines, name);
const channelDir = (name) => join(channels, name);
const configPath = (name) => join(machineDir(name), "config.json");
const ownerPath = (name) => join(channelDir(name), "var-lib-1helm", "owner");
const networkPath = (name) => join(channelDir(name), "network.json");
const networkIdentity = (name, owner) => {
  const installation = owner.split(":", 1)[0];
  const digest = createHash("sha256").update(`${name}\0${owner}`).digest();
  return {
    container: name,
    owner,
    network: `1helm-${installation}`,
    subnet: "10.89.0.0/24",
    gateway: "10.89.0.1",
    ip: `10.89.0.${2 + (digest[0] % 253)}`,
    mac: `02:${[...digest.subarray(1, 6)].map((byte) => byte.toString(16).padStart(2, "0")).join(":")}`,
  };
};
const fail = (message, code = 1) => { process.stderr.write(`1Helm OCI runtime: ${message}\n`); process.exit(code); };
const valid = (name, owner) => /^1helm-[a-f0-9]{16}-channel-\d+$/.test(name) && /^[a-f0-9]{16}:\d+$/.test(owner);
const verify = (name, owner) => {
  if (!valid(name, owner)) fail("invalid container identity");
  if (!existsSync(configPath(name))) fail("container does not exist");
  if (!existsSync(ownerPath(name)) || readFileSync(ownerPath(name), "utf8").trim() !== owner) fail("ownership marker does not match");
  if (!existsSync(networkPath(name))) fail("network identity is missing");
  const actualNetwork = JSON.parse(readFileSync(networkPath(name), "utf8"));
  const expectedNetwork = networkIdentity(name, owner);
  if (JSON.stringify(actualNetwork) !== JSON.stringify(expectedNetwork)) fail("network identity does not match this channel");
  const config = JSON.parse(readFileSync(configPath(name), "utf8"));
  if (JSON.stringify(config.network) !== JSON.stringify(expectedNetwork)) fail("container static network creation contract does not match");
};
const invoke = (containerArgs, input) => {
  const result = spawnSync(process.execPath, [fakeContainer, ...containerArgs], {
    env: process.env, input, encoding: null, maxBuffer: 256 * 1024 ** 2,
  });
  if (result.stdout?.length) process.stdout.write(result.stdout);
  if (result.stderr?.length) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
};
const linkStorage = (name) => {
  const world = machineDir(name);
  const channel = channelDir(name);
  for (const [guest, authoritative] of [["workspace", "workspace"], ["home", "home"], [join("var", "lib", "1helm"), "var-lib-1helm"]]) {
    const target = join(world, guest);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(resolve(target, ".."), { recursive: true });
    const relative = resolve(channel, authoritative);
    const type = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(relative, target, type);
  }
  const files = join(channel, "workspace", "files");
  rmSync(files, { recursive: true, force: true });
  symlinkSync(resolve(channel, "files"), files, process.platform === "win32" ? "junction" : "dir");
};

const operation = args[0] || "";
if (operation === "version") { process.stdout.write("1helm-oci-runtime-v1\n"); process.exit(0); }
if (operation === "ready") { process.stdout.write('{"ready":true,"version":"1helm-oci-runtime-v1","engine":"fake"}\n'); process.exit(0); }
if (operation === "image-status") {
  const image = args[1] || "";
  const marker = join(root, "images", image.replaceAll("/", "_"));
  process.stdout.write(`${JSON.stringify({ exists: existsSync(marker), image })}\n`);
  process.exit(0);
}
if (operation === "image") {
  const image = args[1] || "";
  mkdirSync(join(root, "images"), { recursive: true });
  writeFileSync(join(root, "images", image.replaceAll("/", "_")), "1\n");
  process.exit(0);
}
if (operation === "create") {
  const [, name, owner, cpus, memoryMb] = args;
  if (!valid(name, owner)) fail("invalid create arguments");
  const channel = channelDir(name);
  for (const directory of ["workspace", "files", "home", "var-lib-1helm"]) mkdirSync(join(channel, directory), { recursive: true });
  mkdirSync(join(channel, "workspace", "files"), { recursive: true });
  writeFileSync(ownerPath(name), `${owner}\n`);
  const network = networkIdentity(name, owner);
  writeFileSync(networkPath(name), `${JSON.stringify(network)}\n`);
  const result = spawnSync(process.execPath, [fakeContainer, "machine", "create", "--name", name, "--cpus", cpus, "--memory", `${memoryMb}M`, "--home-mount", "none", "fake"], { env: process.env, encoding: null });
  if (result.status !== 0) fail(String(result.stderr || "create failed"));
  linkStorage(name);
  const config = JSON.parse(readFileSync(configPath(name), "utf8"));
  config.status = "running";
  config.network = network;
  writeFileSync(configPath(name), JSON.stringify(config));
  process.exit(0);
}
if (operation === "list") {
  const prefix = args[1] || "";
  const names = readdirSync(machines).filter((name) => name.startsWith(prefix) && existsSync(configPath(name)));
  process.stdout.write(`${JSON.stringify(names)}\n`);
  process.exit(0);
}
const name = args[1] || "", owner = args[2] || "";
if (operation === "inspect") {
  if (!existsSync(configPath(name))) { process.stdout.write("null\n"); process.exit(0); }
  verify(name, owner);
  const config = JSON.parse(readFileSync(configPath(name), "utf8"));
  process.stdout.write(`${JSON.stringify({ id: name, status: config.status, cpus: config.cpus, memory: config.memory, homeMount: "none" })}\n`);
  process.exit(0);
}
if (operation === "backups") {
  if (!valid(name, owner)) fail("invalid container identity");
  const rows = readdirSync(backups).filter((entry) => entry.startsWith(`${name}-`) && entry.endsWith(".fake"))
    .sort().reverse().map((backup) => ({ backup, sha256: readFileSync(join(backups, backup, "digest"), "utf8").trim() }));
  process.stdout.write(`${JSON.stringify(rows)}\n`);
  process.exit(0);
}
if (operation === "restore") {
  const backup = args[3], digest = args[4];
  if (!valid(name, owner) || !/^[a-f0-9]{64}$/.test(digest)) fail("invalid restore arguments");
  const source = join(backups, backup);
  if (!existsSync(source) || readFileSync(join(source, "digest"), "utf8").trim() !== digest) fail("backup digest does not match");
  cpSync(join(source, "channel"), channelDir(name), { recursive: true, preserveTimestamps: true });
  cpSync(join(source, "config.json"), configPath(name));
  linkStorage(name);
  verify(name, owner);
  const config = JSON.parse(readFileSync(configPath(name), "utf8"));
  config.status = "running";
  writeFileSync(configPath(name), JSON.stringify(config));
  process.stdout.write(`${JSON.stringify({ id: name, status: "running", cpus: config.cpus, memory: config.memory, homeMount: "none" })}\n`);
  process.exit(0);
}
verify(name, owner);
if (operation === "start") {
  const config = JSON.parse(readFileSync(configPath(name), "utf8")); config.status = "running"; writeFileSync(configPath(name), JSON.stringify(config)); process.exit(0);
}
if (operation === "stop") invoke(["machine", "stop", name]);
if (operation === "set") invoke(["machine", "set", "-n", name, `cpus=${args[3]}`, `memory=${args[4]}M`, "home-mount=none"]);
if (operation === "backup") {
  const backup = `${name}-${String(Date.now()).padStart(13, "0")}-000000000000.fake`;
  const destination = join(backups, backup);
  mkdirSync(destination, { recursive: true });
  cpSync(channelDir(name), join(destination, "channel"), { recursive: true, preserveTimestamps: true });
  cpSync(configPath(name), join(destination, "config.json"));
  const digest = "a".repeat(64);
  writeFileSync(join(destination, "digest"), digest);
  process.stdout.write(`${JSON.stringify({ backup, sha256: digest, path: destination })}\n`);
  process.exit(0);
}
if (operation === "delete") { rmSync(machineDir(name), { recursive: true, force: true }); rmSync(channelDir(name), { recursive: true, force: true }); process.exit(0); }
if (operation === "terminal") invoke(["machine", "run", "-it", "-n", name, "-w", "/workspace", "--", "/bin/bash", "-l"]);
if (operation === "exec") {
  const separator = args.indexOf("--");
  if (separator < 0) fail("missing argv separator");
  const workdir = args[4] || "/workspace";
  const input = readFileSync(0);
  invoke(["machine", "run", "-i", "-n", name, "-w", workdir, "--", ...args.slice(separator + 1)], input);
}
fail("unsupported operation");
