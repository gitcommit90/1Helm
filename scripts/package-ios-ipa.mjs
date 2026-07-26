#!/usr/bin/env node
import { copyFile, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "darwin") throw new Error("The iOS release must be built on macOS with full Xcode.");
const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = String(pkg.version || "");
const team = process.env.APPLE_TEAM_ID || process.env.REROUTED_TEAM_ID || "";
if (!team) throw new Error("APPLE_TEAM_ID is required for an App Store-signed iOS release.");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env, ...options });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}.`);
}
const xcode = spawnSync("xcodebuild", ["-version"], { encoding: "utf8" });
if (xcode.status !== 0 || !/^Xcode /m.test(xcode.stdout || "")) throw new Error("Full Xcode is required; Command Line Tools alone cannot archive iOS apps.");

const scratch = await mkdtemp(join(tmpdir(), `1helm-ios-${version}-`));
const archive = join(scratch, `1Helm-${version}.xcarchive`);
const exported = join(scratch, "export");
const options = join(scratch, "ExportOptions.plist");
const canonical = join(root, "dist", `1Helm-${version}-ios.ipa`);
const candidate = `${canonical}.candidate`;
try {
  await mkdir(join(root, "dist"), { recursive: true });
  await rm(candidate, { force: true });
  run("npm", ["run", "mobile:sync"]);
  run("xcodebuild", [
    "-project", "ios/App/App.xcodeproj", "-scheme", "App", "-configuration", "Release",
    "-destination", "generic/platform=iOS", "-archivePath", archive,
    `DEVELOPMENT_TEAM=${team}`, "CODE_SIGN_STYLE=Automatic", "-allowProvisioningUpdates", "archive",
  ]);
  await writeFile(options, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>signingStyle</key><string>automatic</string><key>teamID</key><string>${team}</string><key>manageAppVersionAndBuildNumber</key><false/><key>stripSwiftSymbols</key><true/><key>uploadSymbols</key><true/></dict></plist>\n`, { mode: 0o600 });
  run("xcodebuild", ["-exportArchive", "-archivePath", archive, "-exportPath", exported, "-exportOptionsPlist", options, "-allowProvisioningUpdates"]);
  const ipaName = (await readdir(exported)).find((name) => name.endsWith(".ipa"));
  if (!ipaName) throw new Error("Xcode did not produce an IPA.");
  // Xcode's temp directory and a release volume can be different filesystems.
  // Copy into the release directory before the same-volume atomic rename.
  await copyFile(join(exported, ipaName), candidate);
  const entries = spawnSync("unzip", ["-Z1", candidate], { encoding: "utf8" });
  if (entries.status !== 0 || /(^|\n)(?:AGENTS\.md|.*\/AGENTS\.md)(?:\n|$)/.test(entries.stdout || "")) throw new Error("The IPA is invalid or contains host-local instructions.");
  await rm(canonical, { force: true });
  await rename(candidate, canonical);
  console.log(`Verified App Store IPA: ${canonical}`);
} finally {
  await rm(candidate, { force: true });
  await rm(scratch, { recursive: true, force: true });
}
