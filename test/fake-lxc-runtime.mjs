#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.env.FAKE_CONTAINER_STATE;
if (!root) process.exit(90);
const fakeContainer = resolve(import.meta.dirname, "fake-container.mjs");
const args = process.argv.slice(2);
mkdirSync(join(root, "machines"), { recursive: true });
writeFileSync(join(root, "lxc-calls.log"), `${JSON.stringify(args)}\n`, { flag: "a" });

const machineDir = (name) => join(root, "machines", name);
const configPath = (name) => join(machineDir(name), "config.json");
const ownerPath = (name) => join(machineDir(name), "var", "lib", "1helm", "owner");
const fail = (message, code = 1) => { process.stderr.write(`1Helm LXC runtime: ${message}\n`); process.exit(code); };
const verify = (name, owner) => {
  if (!existsSync(configPath(name))) fail("container does not exist");
  if (!existsSync(ownerPath(name)) || readFileSync(ownerPath(name), "utf8").trim() !== owner) fail("ownership marker does not match");
};
const invoke = (containerArgs, input) => {
  const result = spawnSync(process.execPath, [fakeContainer, ...containerArgs], {
    env: process.env, input, encoding: null, maxBuffer: 256 * 1024 ** 2,
  });
  if (result.stdout?.length) process.stdout.write(result.stdout);
  if (result.stderr?.length) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
};

const operation = args[0] || "";
if (operation === "version") { process.stdout.write("1helm-lxc-runtime-v1\n"); process.exit(0); }
if (operation === "ready") { process.stdout.write('{"ready":true,"version":"1helm-lxc-runtime-v1"}\n'); process.exit(0); }
if (operation === "create") {
  const [, name, owner, cpus, memoryMb] = args;
  const result = spawnSync(process.execPath, [fakeContainer, "machine", "create", "--name", name, "--cpus", cpus, "--memory", `${memoryMb}M`, "--home-mount", "none", "fake"], { env: process.env, encoding: null });
  if (result.status !== 0) fail(String(result.stderr || "create failed"));
  const createDelay = Math.max(0, Math.min(5_000, Number(process.env.FAKE_LXC_CREATE_DELAY_MS || 0)));
  if (createDelay) await new Promise((resolveDelay) => setTimeout(resolveDelay, createDelay));
  mkdirSync(join(machineDir(name), "var", "lib", "1helm"), { recursive: true });
  writeFileSync(ownerPath(name), `${owner}\n`);
  const config = JSON.parse(readFileSync(configPath(name), "utf8"));
  config.status = "running";
  writeFileSync(configPath(name), JSON.stringify(config));
  process.exit(0);
}
if (operation === "list") {
  const prefix = args[1] || "";
  const names = readdirSync(join(root, "machines")).filter((name) => name.startsWith(prefix) && existsSync(configPath(name)));
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
verify(name, owner);
if (operation === "stop") invoke(["machine", "stop", name]);
if (operation === "set") invoke(["machine", "set", "-n", name, `cpus=${args[3]}`, `memory=${args[4]}M`, "home-mount=none"]);
if (operation === "delete") { rmSync(machineDir(name), { recursive: true, force: true }); process.exit(0); }
if (operation === "terminal") invoke(["machine", "run", "-it", "-n", name, "-w", "/workspace", "--", "/bin/bash", "-l"]);
if (operation === "exec") {
  const separator = args.indexOf("--");
  if (separator < 0) fail("missing argv separator");
  const workdir = args[4] || "/workspace";
  const input = readFileSync(0);
  invoke(["machine", "run", "-i", "-n", name, "-w", workdir, "--", ...args.slice(separator + 1)], input);
}
fail("unsupported operation");
