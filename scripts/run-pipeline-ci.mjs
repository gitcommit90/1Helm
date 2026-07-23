#!/usr/bin/env node
/**
 * Self-contained CI runner for test/pipeline.mjs:
 * - mock OpenAI on 9099
 * - 1Helm on ephemeral port + clean CTRL_DATA_DIR
 * - runs pipeline; tears down processes
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = mkdtempSync(join(tmpdir(), "1helm-ci-"));
const mockPort = 9099;
const appPort = Number(process.env.CI_PORT || 18123);
const base = `127.0.0.1:${appPort}`;

const kids = [];

function run(cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  kids.push(child);
  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => process.stderr.write(d));
  return child;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHttp(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status < 500) return;
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function killAll() {
  for (const c of kids) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

process.on("exit", killAll);
process.on("SIGINT", () => {
  killAll();
  process.exit(130);
});

run(process.execPath, [join(root, "test/mock-openai.mjs"), String(mockPort)]);
await sleep(300);

run(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", join(root, "src/server/index.ts")],
  {
    PORT: String(appPort),
    CTRL_DATA_DIR: dataDir,
    NODE_ENV: "test",
  },
);

await waitHttp(`http://${base}/api/setup/status`);

const pipeline = spawn(process.execPath, [join(root, "test/pipeline.mjs")], {
  cwd: root,
  env: { ...process.env, BASE: base },
  stdio: "inherit",
});

const code = await new Promise((resolve) => pipeline.on("close", resolve));
killAll();
process.exit(code ?? 1);
