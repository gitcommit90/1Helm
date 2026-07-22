#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// node-pty 1.1.0's npm tarball ships Unix spawn-helper files as 0644. The
// native module loads successfully, but every PTY then fails at runtime with
// `posix_spawnp failed`. Restore the executable bit after every install so
// development, CI acceptance, and the packaged app all carry a runnable helper.
if (process.platform === "darwin") {
  const helper = path.join(__dirname, "..", "node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
  if (!fs.existsSync(helper)) throw new Error(`node-pty spawn helper is missing: ${helper}`);
  fs.chmodSync(helper, 0o755);
  const mode = fs.statSync(helper).mode & 0o777;
  if ((mode & 0o111) === 0) throw new Error(`node-pty spawn helper is not executable: ${helper}`);
}
