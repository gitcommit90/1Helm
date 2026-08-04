#!/usr/bin/env node
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareMnemosyneTestRuntime } from "./mnemosyne-test-runtime.mjs";

const root = resolve(import.meta.dirname, "..");
const prepared = prepareMnemosyneTestRuntime(root);
process.stdout.write(`Using pinned Mnemosyne 3.14.0 from ${prepared.source}.\n`);

const env = { ...process.env, NODE_ENV: "test", MNEMOSYNE_PYTHON: prepared.runtime };
const suites = [
  ["test/native-world.mjs"],
  ["--test",
    "test/routing.mjs", "test/routing-disabled-account.mjs", "test/routing-antigravity.mjs", "test/desktop.mjs", "test/update-service.mjs",
    "test/channel-computers.mjs", "test/channel-computers-isolated-backends.mjs", "test/event-loop-unblocking.mjs",
    "test/cloudflare-worker.mjs", "test/connectors.mjs", "test/chatgpt-image.mjs", "test/autonomy-platform.mjs",
    "test/feedback.mjs", "test/feedback-browser.mjs", "test/cowork-browser.mjs", "test/files-latency.mjs", "test/gmail.mjs", "test/photon.mjs", "test/site.mjs", "test/release-license.mjs", "test/release-governance.mjs",
    "test/channel-surfaces.mjs", "test/workspace-interactions.mjs", "test/sweep-fleet-telemetry.mjs", "test/sweep-server-integration.mjs", "test/thread-followup-chat.mjs",
    "test/notifications.mjs", "test/mobile-push.mjs", "test/terminal-reconnect-contract.mjs", "test/terminal-reconnect-browser.mjs", "test/mobile.mjs", "test/web-research.mjs", "test/workflows.mjs",
    "test/delivery-status.mjs", "test/cleanup-report.mjs", "test/delivery-governance.mjs", "test/phase1-tools.mjs", "test/phase2-candidate.mjs", "test/phase3-promotion.mjs", "test/site-stable-manifest.mjs"],
];

let status = 0;
try {
  for (const args of suites) {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    if (result.status !== 0) { status = result.status || 1; break; }
  }
} finally {
  if (prepared.cleanupRoot) rmSync(prepared.cleanupRoot, { recursive: true, force: true });
}
process.exit(status);
