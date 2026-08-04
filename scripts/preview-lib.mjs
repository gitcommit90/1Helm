import { createServer } from "node:net";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const DEFAULT_PREVIEW_PORT = 8124;
export const DEFAULT_STABLE_PORT = 8123;
export const PREVIEW_DATA_DIRECTORY = ".preview-data";

function portNumber(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`${label} must be an integer from 1024 to 65535.`);
  }
  return port;
}

function optionValue(args, index, name) {
  const argument = args[index];
  if (argument === name) {
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} requires a value.`);
    return { value: args[index + 1], consumed: 2 };
  }
  if (argument.startsWith(`${name}=`)) return { value: argument.slice(name.length + 1), consumed: 1 };
  return null;
}

function within(parent, child) {
  const suffix = relative(parent, child);
  return suffix === "" || (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix));
}

export function previewConfig(root, args = [], env = process.env) {
  let portValue = env.HELM_PREVIEW_PORT || DEFAULT_PREVIEW_PORT;
  let dataValue = env.HELM_PREVIEW_DATA_DIR || PREVIEW_DATA_DIRECTORY;
  for (let index = 0; index < args.length;) {
    const port = optionValue(args, index, "--port");
    if (port) { portValue = port.value; index += port.consumed; continue; }
    const data = optionValue(args, index, "--data-dir");
    if (data) { dataValue = data.value; index += data.consumed; continue; }
    throw new Error(`Unknown preview option: ${args[index]}`);
  }

  const port = portNumber(portValue, "Preview port");
  const stablePort = portNumber(env.HELM_STABLE_PORT || DEFAULT_STABLE_PORT, "Stable port");
  if (port === DEFAULT_STABLE_PORT || port === stablePort) {
    throw new Error(`Preview refuses Stable port ${port}. Choose another port with --port (for example, 8124).`);
  }

  const projectRoot = resolve(root);
  const generatedRoot = join(projectRoot, PREVIEW_DATA_DIRECTORY);
  const dataDir = resolve(projectRoot, String(dataValue));
  if (!within(generatedRoot, dataDir)) {
    throw new Error(`Preview data must stay inside ${generatedRoot}; normal app and production data paths are refused.`);
  }
  return { root: projectRoot, port, stablePort, dataDir, generatedRoot, url: `http://127.0.0.1:${port}` };
}

export async function assertSafePreviewData(config, dependencies = {}) {
  const lstatImpl = dependencies.lstatImpl || lstat;
  const realpathImpl = dependencies.realpathImpl || realpath;
  const projectRoot = await realpathImpl(config.root);
  const generatedRoot = join(projectRoot, PREVIEW_DATA_DIRECTORY);
  const relativeData = relative(config.root, config.dataDir);
  const segments = relativeData.split(sep).filter(Boolean);
  let candidate = projectRoot;
  for (const segment of segments) {
    candidate = join(candidate, segment);
    try {
      const stat = await lstatImpl(candidate);
      if (stat.isSymbolicLink()) throw new Error(`Preview data path contains a symbolic link: ${candidate}`);
      if (!stat.isDirectory()) throw new Error(`Preview data path is not a directory: ${candidate}`);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  if (!within(generatedRoot, join(projectRoot, relativeData))) {
    throw new Error("Preview data resolved outside the generated preview-data directory.");
  }
}

export function assertPortAvailable(port, host = "127.0.0.1", createServerImpl = createServer) {
  return new Promise((resolveAvailable, reject) => {
    const probe = createServerImpl();
    probe.unref?.();
    probe.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        reject(new Error(`Preview port ${port} is already occupied. Stop that process or run npm run preview -- --port <another-port>.`));
      } else {
        reject(new Error(`Preview cannot use ${host}:${port}: ${error?.message || error}`));
      }
    });
    probe.listen(port, host, () => probe.close((error) => error ? reject(error) : resolveAvailable()));
  });
}

export class ServerRestarter {
  constructor({ start, stop, delayMs = 120, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.startChild = start;
    this.stopChild = stop;
    this.delayMs = delayMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.child = null;
    this.timer = null;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  async start() {
    if (this.closed) throw new Error("Preview server restarter is closed.");
    this.child = await this.startChild();
    return this.child;
  }

  changed() {
    if (this.closed) return;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.queue = this.queue.then(async () => {
        if (this.child) await this.stopChild(this.child);
        if (!this.closed) this.child = await this.startChild();
      });
    }, this.delayMs);
  }

  async close() {
    this.closed = true;
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    await this.queue;
    if (this.child) { await this.stopChild(this.child); this.child = null; }
  }
}

export async function watchDirectoryTree(root, onChange, dependencies = {}) {
  const readdirImpl = dependencies.readdirImpl || readdir;
  const watchImpl = dependencies.watchImpl || (await import("node:fs")).watch;
  const watchers = new Map();
  let closed = false;

  const add = async (directory) => {
    if (closed || watchers.has(directory)) return;
    const entries = await readdirImpl(directory, { withFileTypes: true }).catch(() => []);
    const watcher = watchImpl(directory, (event, filename) => {
      if (!filename) return;
      const path = join(directory, String(filename));
      onChange(path, event);
      if (event === "rename") void scan(directory);
    });
    watcher.on?.("error", (error) => onChange(directory, "watch-error", error));
    watchers.set(directory, watcher);
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => add(join(directory, entry.name))));
  };
  const scan = async (directory) => {
    const entries = await readdirImpl(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => add(join(directory, entry.name))));
  };
  await add(root);
  return () => {
    closed = true;
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}
