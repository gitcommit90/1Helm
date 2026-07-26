#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const version = String(pkg.version || "");
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!match) throw new Error(`Mobile releases require a three-part semantic package version; received ${version || "empty"}.`);
const build = Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3]);
if (!Number.isSafeInteger(build) || build < 1) throw new Error("The package version cannot be represented as a native build number.");

const projectPath = resolve(root, "ios", "App", "App.xcodeproj", "project.pbxproj");
let project = await readFile(projectPath, "utf8");
project = project.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
project = project.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
await writeFile(projectPath, project);
console.log(`Synced native mobile version ${version} (build ${build}).`);
