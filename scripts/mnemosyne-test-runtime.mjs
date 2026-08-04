import { existsSync, mkdirSync, mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export const MNEMOSYNE_VERSION = "3.14.0";

export function pythonRelativePath(platform = process.platform) {
  return platform === "win32" ? join("Scripts", "python.exe") : join("bin", "python");
}

export function mnemosyneTestPaths(root, platform = process.platform) {
  const environmentRoot = join(root, ".test-state", "mnemosyne", MNEMOSYNE_VERSION);
  return {
    cacheParent: dirname(environmentRoot),
    environmentRoot,
    cachePython: join(environmentRoot, "venv", pythonRelativePath(platform)),
  };
}

export function selectMnemosyneRuntime({ explicitPython, cachePython, mode, validity }) {
  if (explicitPython && validity.explicit) return { action: "reuse", runtime: explicitPython, source: "MNEMOSYNE_PYTHON" };
  if (mode === "cache" && cachePython && validity.cache) return { action: "reuse", runtime: cachePython, source: "generated test cache" };
  return { action: mode === "disposable" ? "prepare-disposable" : "prepare-cache", runtime: null, source: null };
}

function pinned(candidate, dependencies = {}) {
  const exists = dependencies.existsSync || existsSync;
  const spawn = dependencies.spawnSync || spawnSync;
  return Boolean(candidate) && exists(candidate) && spawn(candidate, [
    "-c", `import mnemosyne; assert mnemosyne.__version__ == "${MNEMOSYNE_VERSION}"`,
  ], { stdio: "ignore" }).status === 0;
}

function modeFromEnvironment(env) {
  const requested = String(env.HELM_TEST_MNEMOSYNE_MODE || "").trim().toLowerCase();
  if (requested && !["cache", "disposable"].includes(requested)) {
    throw new Error("HELM_TEST_MNEMOSYNE_MODE must be either cache or disposable.");
  }
  return requested || (env.CI ? "disposable" : "cache");
}

export function prepareMnemosyneTestRuntime(root, env = process.env, platform = process.platform, dependencies = {}) {
  const exists = dependencies.existsSync || existsSync;
  const mkdir = dependencies.mkdirSync || mkdirSync;
  const rename = dependencies.renameSync || renameSync;
  const makeTemp = dependencies.mkdtempSync || mkdtempSync;
  const spawn = dependencies.spawnSync || spawnSync;
  const mode = modeFromEnvironment(env);
  const pythonName = pythonRelativePath(platform);
  const paths = mnemosyneTestPaths(root, platform);
  const explicitPython = env.MNEMOSYNE_PYTHON || "";
  const decision = selectMnemosyneRuntime({
    explicitPython,
    cachePython: paths.cachePython,
    mode,
    validity: {
      explicit: pinned(explicitPython, { existsSync: exists, spawnSync: spawn }),
      cache: pinned(paths.cachePython, { existsSync: exists, spawnSync: spawn }),
    },
  });
  if (decision.action === "reuse") return { ...decision, cleanupRoot: "" };

  let disposableRoot = "";
  if (decision.action === "prepare-cache") {
    mkdir(paths.cacheParent, { recursive: true });
    if (exists(paths.environmentRoot)) {
      const quarantined = `${paths.environmentRoot}.invalid-${Date.now()}-${process.pid}`;
      rename(paths.environmentRoot, quarantined);
      process.stdout.write(`Pinned Mnemosyne cache was invalid; preserved it at ${quarantined}.\n`);
    }
  } else {
    disposableRoot = makeTemp(join(tmpdir(), "1helm-mnemosyne-test-"));
  }

  const installers = [...new Set([env.PYTHON || "", "python3", ...(platform === "darwin" ? ["/usr/bin/python3"] : [])].filter(Boolean))];
  for (let index = 0; index < installers.length; index += 1) {
    const attemptRoot = decision.action === "prepare-cache"
      ? `${paths.environmentRoot}.install-${Date.now()}-${process.pid}-${index}`
      : join(disposableRoot, `attempt-${index}`);
    const venv = join(attemptRoot, "venv");
    mkdir(attemptRoot, { recursive: true });
    if (spawn(installers[index], ["-m", "venv", venv], { stdio: "ignore" }).status !== 0) continue;
    const candidate = join(venv, pythonName);
    const installed = spawn(candidate, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--ignore-requires-python", `mnemosyne-memory==${MNEMOSYNE_VERSION}`], { stdio: "inherit" });
    if (installed.status !== 0 || !pinned(candidate, { existsSync: exists, spawnSync: spawn })) continue;
    if (decision.action === "prepare-cache") {
      try { rename(attemptRoot, paths.environmentRoot); }
      catch (error) {
        if (!pinned(paths.cachePython, { existsSync: exists, spawnSync: spawn })) throw error;
      }
      return { action: "prepared", runtime: paths.cachePython, source: "generated test cache", cleanupRoot: "" };
    }
    return { action: "prepared", runtime: candidate, source: "disposable runtime", cleanupRoot: disposableRoot };
  }
  throw new Error("The test suite could not prepare its pinned Mnemosyne runtime.");
}
