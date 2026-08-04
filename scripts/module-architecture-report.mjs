#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(join(root, "config", "module-budgets.json"), "utf8"));
const sourceRoots = ["src", "scripts", "cloudflare", "desktop"];
const extensions = new Set([".ts", ".mjs", ".js", ".cjs"]);
const generated = new Set(["desktop/photon-sidecar.bundle.mjs"]);
const files = [];

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (extensions.has(extname(path)) && !generated.has(relative(root, path))) files.push(relative(root, path));
  }
}
for (const directory of sourceRoots) if (existsSync(join(root, directory))) collect(join(root, directory));
files.sort();

const fileSet = new Set(files);
const graph = new Map(files.map((file) => [file, new Set()]));
const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function resolveImport(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = normalize(join(dirname(from), specifier));
  const candidates = [base, ...[".ts", ".mjs", ".js", ".cjs"].map((suffix) => base + suffix),
    ...["index.ts", "index.mjs", "index.js", "index.cjs"].map((name) => join(base, name))];
  return candidates.find((candidate) => fileSet.has(candidate)) || null;
}

const lines = new Map();
for (const file of files) {
  const source = readFileSync(join(root, file), "utf8");
  lines.set(file, source === "" ? 0 : source.split(/\r?\n/).length - (source.endsWith("\n") ? 1 : 0));
  for (const match of source.matchAll(importPattern)) {
    const target = resolveImport(file, match[1] || match[2]);
    if (target) graph.get(file).add(target);
  }
}

const fanIn = new Map(files.map((file) => [file, 0]));
for (const targets of graph.values()) for (const target of targets) fanIn.set(target, fanIn.get(target) + 1);

let nextIndex = 0;
const indices = new Map(), low = new Map(), stack = [], stacked = new Set(), cycles = [];
function connect(file) {
  indices.set(file, nextIndex); low.set(file, nextIndex); nextIndex++; stack.push(file); stacked.add(file);
  for (const target of graph.get(file)) {
    if (!indices.has(target)) { connect(target); low.set(file, Math.min(low.get(file), low.get(target))); }
    else if (stacked.has(target)) low.set(file, Math.min(low.get(file), indices.get(target)));
  }
  if (low.get(file) !== indices.get(file)) return;
  const component = [];
  while (stack.length) {
    const item = stack.pop(); stacked.delete(item); component.push(item);
    if (item === file) break;
  }
  if (component.length > 1 || graph.get(component[0]).has(component[0])) cycles.push(component.sort());
}
for (const file of files) if (!indices.has(file)) connect(file);

function status(kind, file, value) {
  const budget = config.legacy[kind]?.[file];
  if (budget == null) return "NEW";
  return value > budget ? "REGRESSION" : "legacy";
}

const large = files.filter((file) => lines.get(file) > config.thresholds.lines)
  .sort((a, b) => lines.get(b) - lines.get(a));
const highFanIn = files.filter((file) => fanIn.get(file) > config.thresholds.fanIn)
  .sort((a, b) => fanIn.get(b) - fanIn.get(a));
const highFanOut = files.filter((file) => graph.get(file).size > config.thresholds.fanOut)
  .sort((a, b) => graph.get(b).size - graph.get(a).size);

process.stdout.write("1Helm first-party module architecture report (advisory only)\n");
process.stdout.write(`Scanned ${files.length} modules and ${[...graph.values()].reduce((sum, targets) => sum + targets.size, 0)} internal import edges.\n`);
process.stdout.write(`Budgets: >${config.thresholds.lines} lines, >${config.thresholds.fanIn} importers, >${config.thresholds.fanOut} internal imports.\n\n`);
process.stdout.write("Large modules\n");
for (const file of large) process.stdout.write(`  [${status("lines", file, lines.get(file))}] ${String(lines.get(file)).padStart(5)}  ${file}\n`);
process.stdout.write("High fan-in\n");
for (const file of highFanIn) process.stdout.write(`  [${status("fanIn", file, fanIn.get(file))}] ${String(fanIn.get(file)).padStart(5)}  ${file}\n`);
process.stdout.write("High fan-out\n");
for (const file of highFanOut) process.stdout.write(`  [${status("fanOut", file, graph.get(file).size)}] ${String(graph.get(file).size).padStart(5)}  ${file}\n`);
process.stdout.write("Import cycles\n");
const knownCycles = new Set(config.legacy.cycles.map((cycle) => [...cycle].sort().join(" -> ")));
if (!cycles.length) process.stdout.write("  none\n");
for (const cycle of cycles) {
  const key = cycle.join(" -> ");
  process.stdout.write(`  [${knownCycles.has(key) ? "legacy" : "NEW"}] ${key}\n`);
}
const flags = [
  ...large.filter((file) => status("lines", file, lines.get(file)) !== "legacy"),
  ...highFanIn.filter((file) => status("fanIn", file, fanIn.get(file)) !== "legacy"),
  ...highFanOut.filter((file) => status("fanOut", file, graph.get(file).size) !== "legacy"),
].length + cycles.filter((cycle) => !knownCycles.has(cycle.join(" -> "))).length;
process.stdout.write(`\n${flags ? `Attention: ${flags} new or regressed budget flag(s).` : "No new or regressed budget flags."}\n`);
process.stdout.write("This report never changes the exit status. Ratchet a legacy budget down after an extraction; do not raise it to accommodate unrelated growth.\n");
