// node --import ./test/stubs/register.mjs test/computer-installs-kept.test.mjs
// pip and npm installs on a channel's computer must land under /workspace/.home (the only saved folder), with their download caches in /tmp.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ChannelComputer } from "../src/channel-computer.js";
import { COMPUTER_ENV, COMPUTER_SHELL_PREFIX } from "../src/computer-env.js";

assert.equal(COMPUTER_ENV.HOME, "/workspace/.home");
assert.equal(COMPUTER_ENV.PYTHONUSERBASE, "/workspace/.home/.local");
assert.equal(COMPUTER_ENV.npm_config_prefix, "/workspace/.home/.npm-global");
assert.equal(COMPUTER_ENV.PIP_NO_CACHE_DIR, "1");
assert.ok(COMPUTER_ENV.npm_config_cache.startsWith("/tmp/"), "npm cache stays out of /workspace");
assert.ok(!("PIP_USER" in COMPUTER_ENV), "PIP_USER would break --target and venvs");
assert.ok(!Object.values(COMPUTER_ENV).some((v) => /cache/i.test(v) && v.startsWith("/workspace")));

// The shell prefix, run in real bash against stub tools that print their arguments.
const dir = mkdtempSync(join(tmpdir(), "inst-"));
for (const n of ["pip", "pip3", "python3", "python"]) { writeFileSync(join(dir, n), `#!/bin/bash\necho "${n} $*"\n`); chmodSync(join(dir, n), 0o755); }
const run = (cmd, env = {}) => execFileSync("bash", ["-c", COMPUTER_SHELL_PREFIX + cmd], { env: { PATH: `${dir}:/usr/bin:/bin`, ...env }, encoding: "utf8" }).trim();
assert.equal(run("pip install six"), "pip install --user six");
assert.equal(run("pip3 install -q six requests"), "pip3 install --user -q six requests");
assert.equal(run("python3 -m pip install six"), "python3 -m pip install --user six");
assert.equal(run("python -m pip install --upgrade six"), "python -m pip install --user --upgrade six");
assert.equal(run("bash -c 'pip install six'"), "pip install --user six", "child shells keep it");
assert.equal(run("pip install --target /tmp/x six"), "pip install --target /tmp/x six");
assert.equal(run("pip install -t /tmp/x six"), "pip install -t /tmp/x six");
assert.equal(run("pip install --prefix=/tmp/x six"), "pip install --prefix=/tmp/x six");
assert.equal(run("pip install --user six"), "pip install --user six");
assert.equal(run("pip install six", { VIRTUAL_ENV: "/tmp/v" }), "pip install six", "inside a venv");
assert.equal(run("pip list"), "pip list");
assert.equal(run("python3 script.py a"), "python3 script.py a");
assert.equal(run("python3 -m venv /tmp/v"), "python3 -m venv /tmp/v");
// The user bin folders come after the image's PATH, so they shadow nothing.
const path = run('echo "$PATH"').split(":");
assert.ok(path.indexOf("/workspace/.home/.local/bin") > path.indexOf("/usr/bin"));
assert.ok(path.indexOf("/workspace/.home/.npm-global/bin") > path.indexOf("/bin"));

// Every command goes through ChannelComputer.sh, which passes the env and the prefix to container.exec.
const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) {
  if (!args.length && q.split(";").filter((s) => s.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q); const rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []);
  return { toArray: () => rows, one: () => rows[0] };
} };
let seen;
const container = { running: true, monitor: () => new Promise(() => {}), exec(argv, opts) { seen = { argv, opts }; return Promise.reject(new Error("stop")); } };
const ctx = { id: { toString: () => "id" }, exports: { ComputerLink: () => ({}), Sentinel: () => ({}) }, storage: { sql, getAlarm: async () => null, setAlarm: async () => {} }, container, waitUntil: () => {} };
const c = new ChannelComputer(ctx, {});
for (const o of [{}, { tag: "t1" }, { run: "r1", tag: "t2" }]) {
  seen = null; await c.sh("pip install six", { timeoutMs: 1000, ...o }).catch(() => {});
  for (const [k, v] of Object.entries(COMPUTER_ENV)) assert.equal(seen.opts.env[k], v, k);
  assert.ok(seen.opts.env.SSL_CERT_FILE, "the CA env is still there");
  assert.ok(seen.argv[2].startsWith(COMPUTER_SHELL_PREFIX)); assert.ok(seen.argv[2].includes("pip install six"));
}
console.log("computer-installs-kept ok");
