#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.env.FAKE_CONTAINER_STATE;
if (!root) process.exit(90);
const fakeContainer = resolve(import.meta.dirname, "fake-container.mjs");
const args = process.argv.slice(2);
const machines = join(root, "machines");
mkdirSync(machines, { recursive: true });
writeFileSync(join(root, "wsl-calls.log"), `${JSON.stringify(args)}\n`, { flag: "a" });
const configPath = (name) => join(machines, name, "config.json");
const invoke = (containerArgs, input) => {
  const result = spawnSync(process.execPath, [fakeContainer, ...containerArgs], { env: process.env, input, encoding: null, maxBuffer: 256 * 1024 ** 2 });
  if (result.stdout?.length) process.stdout.write(result.stdout);
  if (result.stderr?.length) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
};

if (args[0] === "--version") { process.stdout.write("WSL version: 2.5.10.0\nKernel version: 6.6.87.2\n"); process.exit(0); }
if (args[0] === "--status") { process.stdout.write("Default Version: 2\n"); process.exit(0); }
if (args[0] === "--list") {
  const runningOnly = args.includes("--running");
  const names = readdirSync(machines).filter((name) => {
    if (!existsSync(configPath(name))) return false;
    const config = JSON.parse(readFileSync(configPath(name), "utf8"));
    return !runningOnly || config.status === "running";
  });
  process.stdout.write(names.length ? `${names.join("\n")}\n` : "");
  process.exit(0);
}
if (args[0] === "--terminate") invoke(["machine", "stop", args[1]]);
if (args[0] === "--unregister") { rmSync(join(machines, args[1]), { recursive: true, force: true }); process.exit(0); }
if (args[0] === "--import") {
  const name = args[1];
  invoke(["machine", "create", "--name", name, "--cpus", "2", "--memory", "2048M", "--home-mount", "none", "fake"]);
}
if (args[0] === "--distribution") {
  const name = args[1];
  const workdirIndex = args.indexOf("--cd");
  const separator = args.indexOf("--exec") >= 0 ? args.indexOf("--exec") : args.indexOf("--");
  if (separator < 0) process.exit(2);
  const input = readFileSync(0);
  invoke(["machine", "run", "-i", "-n", name, "-w", workdirIndex >= 0 ? args[workdirIndex + 1] : "/workspace", "--", ...args.slice(separator + 1)], input);
}
process.stderr.write(`unsupported fake WSL command: ${args.join(" ")}\n`);
process.exit(2);
