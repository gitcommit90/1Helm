#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const version = "3.14.0";
const pythonName = process.platform === "win32" ? join("Scripts", "python.exe") : join("bin", "python");
const candidates = [
  process.env.MNEMOSYNE_PYTHON || "",
  join(root, "data-refactored", "mnemosyne-runtime", "venv", pythonName),
].filter(Boolean);

const pinned = (candidate) => candidate && existsSync(candidate) && spawnSync(candidate, [
  "-c", `import mnemosyne; assert mnemosyne.__version__ == "${version}"`,
], { stdio: "ignore" }).status === 0;

let runtime = candidates.find(pinned) || "";
let disposableRoot = "";
if (!runtime) {
  disposableRoot = mkdtempSync(join(tmpdir(), "1helm-mnemosyne-test-"));
  const venv = join(disposableRoot, "venv");
  const installers = [...new Set([process.env.PYTHON || "", "python3", ...(process.platform === "darwin" ? ["/usr/bin/python3"] : [])].filter(Boolean))];
  for (const installer of installers) {
    // A failed interpreter can leave a partial venv whose Python symlinks
    // poison the next fallback attempt. Each interpreter must start from its
    // own clean disposable runtime, matching the production bootstrap.
    if (existsSync(venv)) rmSync(venv, { recursive: true, force: true });
    if (spawnSync(installer, ["-m", "venv", venv], { stdio: "ignore" }).status !== 0) continue;
    const candidate = join(venv, pythonName);
    const installed = spawnSync(candidate, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--ignore-requires-python", `mnemosyne-memory==${version}`], { stdio: "inherit" });
    if (installed.status === 0 && pinned(candidate)) { runtime = candidate; break; }
  }
  if (!runtime) {
    rmSync(disposableRoot, { recursive: true, force: true });
    throw new Error("The test suite could not prepare its pinned Mnemosyne runtime.");
  }
}

const env = { ...process.env, NODE_ENV: "test", MNEMOSYNE_PYTHON: runtime };
const suites = [
  ["test/native-world.mjs"],
  ["--test",
    "test/routing.mjs", "test/routing-disabled-account.mjs", "test/desktop.mjs", "test/update-service.mjs",
    "test/channel-computers.mjs", "test/channel-computers-isolated-backends.mjs", "test/channel-computers-backend-migration.mjs",
    "test/cloudflare-worker.mjs", "test/connectors.mjs", "test/chatgpt-image.mjs", "test/autonomy-platform.mjs",
    "test/feedback.mjs", "test/feedback-browser.mjs", "test/gmail.mjs", "test/photon.mjs", "test/site.mjs", "test/release-license.mjs", "test/release-governance.mjs",
    "test/channel-surfaces.mjs", "test/workspace-interactions.mjs", "test/sweep-fleet-telemetry.mjs", "test/sweep-server-integration.mjs", "test/thread-followup-chat.mjs",
    "test/notifications.mjs", "test/mobile-push.mjs", "test/terminal-reconnect-contract.mjs", "test/terminal-reconnect-browser.mjs", "test/mobile.mjs", "test/web-research.mjs", "test/workflows.mjs"],
];

let status = 0;
try {
  for (const args of suites) {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    if (result.status !== 0) { status = result.status || 1; break; }
  }
} finally {
  if (disposableRoot) rmSync(disposableRoot, { recursive: true, force: true });
}
process.exit(status);
