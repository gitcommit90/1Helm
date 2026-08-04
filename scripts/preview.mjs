#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as esbuild from "esbuild";
import {
  assertPortAvailable,
  assertSafePreviewData,
  previewConfig,
  ServerRestarter,
  watchDirectoryTree,
} from "./preview-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const HELP = `Usage: npm run preview -- [--port 8124] [--data-dir .preview-data]

Launch the private development preview. It uses loopback and generated preview
data only; Stable port 8123 and normal app data paths are refused.
`;
if (process.argv.slice(2).some((argument) => argument === "--help" || argument === "-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

let config;
const children = new Set();
const intentionalServerStops = new WeakSet();
let esbuildContext;
let closeServerWatch = () => {};
let restarter;
let closing = false;

function startChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    detached: process.platform !== "win32",
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => {
    const timer = setTimeout(resolveExit, timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolveExit(); });
  });
}

function signalChild(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function stopChild(child) {
  signalChild(child, "SIGTERM");
  await waitForExit(child, 5_000);
  if (child.exitCode === null && child.signalCode === null) {
    signalChild(child, "SIGKILL");
    await waitForExit(child, 1_000);
  }
}

async function prepareExcalidrawAssets() {
  const source = join(root, "node_modules", "@excalidraw", "excalidraw", "dist", "prod");
  const target = join(root, "public", "excalidraw");
  await mkdir(target, { recursive: true });
  await copyFile(join(source, "index.css"), join(target, "index.css"));
  await cp(join(source, "fonts"), join(target, "fonts"), { recursive: true, force: true });
}

function startTailwindWatcher() {
  const child = startChild(join(root, "node_modules", ".bin", "tailwindcss"), [
    "-i", "src/client/styles.css", "-o", "public/app.css", "--watch=always",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolveReady, reject) => {
    let ready = false;
    const inspect = (chunk, output) => {
      output.write(chunk);
      if (!ready && /Done in/.test(String(chunk))) { ready = true; resolveReady(child); }
    };
    child.stdout.on("data", (chunk) => inspect(chunk, process.stdout));
    child.stderr.on("data", (chunk) => inspect(chunk, process.stderr));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (!ready) reject(new Error(`Tailwind preview watcher exited before its initial build${signal ? ` (${signal})` : ` (exit ${code})`}.`));
    });
  });
}

async function localizeExcalidrawFonts() {
  const bundle = join(root, "public", "bundle.js");
  const source = await readFile(bundle, "utf8");
  const pattern = /`https:\/\/esm\.sh\/\$\{.*?\}\/dist\/prod\/`/g;
  const matches = source.match(pattern) || [];
  if (matches.length !== 1) throw new Error(`Expected one Excalidraw CDN fallback in preview bundle.js, found ${matches.length}.`);
  await writeFile(bundle, source.replace(pattern, 'window.location.origin+"/excalidraw/"'));
}

async function startClientWatcher() {
  esbuildContext = await esbuild.context({
    entryPoints: [join(root, "src", "client", "app.ts")],
    bundle: true,
    format: "esm",
    outfile: join(root, "public", "bundle.js"),
    loader: { ".css": "css" },
    plugins: [{
      name: "preview-self-host-excalidraw",
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length === 0) await localizeExcalidrawFonts();
        });
      },
    }],
  });
  await esbuildContext.rebuild();
  await esbuildContext.watch();
}

function serverEnvironment() {
  const environment = {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(config.port),
    HELM_HOST: "127.0.0.1",
    HELM_APP_ROOT: root,
    CTRL_DATA_DIR: config.dataDir,
    HELM_CHANNEL_COMPUTER_BACKEND: "native",
    HELM_OCI_HOST_STATE_ROOT: join(config.dataDir, "runtime", "oci-host"),
    HELM_OCI_STATE_ROOT: join(config.dataDir, "runtime", "oci"),
    ONEHELM_GOOGLE_CONNECTION_DIR: join(config.dataDir, "connections", "gmail"),
    ONEHELM_GOOGLE_TOKENS_DIR: join(config.dataDir, "connections", "gmail", "tokens"),
  };
  delete environment.HELM_ROUTER_PORT;
  delete environment.HELM_OCI_STATE_ROOT_OVERRIDE;
  return environment;
}

function startServer() {
  process.stdout.write("Preview server source ready; starting the isolated preview.\n");
  const child = startChild(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], { env: serverEnvironment() });
  child.once("exit", (code, signal) => {
    if (!closing && !intentionalServerStops.has(child)) {
      process.stderr.write(`Preview server stopped unexpectedly${signal ? ` (${signal})` : ` (exit ${code})`}. See the startup error above.\n`);
      void shutdown(1);
    }
  });
  return child;
}

async function stopServer(child) {
  intentionalServerStops.add(child);
  await stopChild(child);
}

async function waitUntilReady(child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`The preview server exited before opening ${config.url}. The port or startup error is shown above.`);
    }
    try {
      const response = await fetch(`${config.url}/api/setup/status`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* startup is still in progress */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`The preview did not become ready at ${config.url} within 20 seconds.`);
}

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  closeServerWatch();
  if (restarter) await restarter.close().catch(() => undefined);
  const remaining = [...children];
  await Promise.all(remaining.map((child) => stopChild(child).catch(() => undefined)));
  if (esbuildContext) await esbuildContext.dispose().catch(() => undefined);
  process.stdout.write("Private preview stopped. Stable was untouched.\n");
  process.exitCode = code;
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });

try {
  config = previewConfig(root, process.argv.slice(2));
  await assertSafePreviewData(config);
  await assertPortAvailable(config.port);
  await mkdir(config.dataDir, { recursive: true });
  await prepareExcalidrawAssets();
  await Promise.all([startClientWatcher(), startTailwindWatcher()]);

  restarter = new ServerRestarter({ start: startServer, stop: stopServer });
  const server = await restarter.start();
  closeServerWatch = await watchDirectoryTree(join(root, "src", "server"), (path, event, error) => {
    if (event === "watch-error") {
      process.stderr.write(`Preview server watcher error at ${path}: ${error?.message || error}\n`);
      return;
    }
    if (/\.(?:ts|mjs|js|cjs|json)$/.test(path)) {
      process.stdout.write(`Server source changed (${path.slice(root.length + 1)}); restarting the preview server only.\n`);
      restarter.changed();
    }
  });
  await waitUntilReady(server);
  process.stdout.write(`\nPRIVATE PREVIEW: ${config.url}\n`);
  process.stdout.write(`Preview data: ${config.dataDir}\n`);
  process.stdout.write("Stable is untouched: this preview uses a different port and separate test data.\n");
  process.stdout.write("Client and server changes are watched. Refresh the private page manually after a change.\n");
  process.stdout.write("Press Ctrl+C to stop the preview and all of its child processes.\n\n");
} catch (error) {
  process.stderr.write(`Preview could not start: ${error.message}\n`);
  await shutdown(1);
}
