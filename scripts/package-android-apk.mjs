#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { delimiter, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = String(pkg.version || "");
const canonical = join(root, "dist", `1Helm-${version}-universal.apk`);
const candidate = `${canonical}.candidate`;
const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || "";
const signing = process.env.HELM_ANDROID_SIGNING_PROPERTIES || "";
const releaseCertificateSha256 = "7b2d96ab21a242f9b17ddc7c65d133033bb9f0322158b6aab57bf8d46a7d27bf";
if (!sdkRoot) throw new Error("ANDROID_SDK_ROOT is required for a release APK.");
if (!signing) throw new Error("HELM_ANDROID_SIGNING_PROPERTIES is required for a signed release APK.");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env, ...options });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}.`);
}
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed.`);
  return String(result.stdout || "");
}
const buildTools = join(sdkRoot, "build-tools");
const latest = (await readdir(buildTools)).filter((name) => /^\d+(?:\.\d+)+$/.test(name)).sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).at(-1) || "";
if (!latest) throw new Error("Android SDK Build Tools are not installed.");
const apksigner = join(buildTools, latest, "apksigner");
const zipalign = join(buildTools, latest, "zipalign");

await mkdir(join(root, "dist"), { recursive: true });
await rm(candidate, { force: true });
run("npm", ["run", "mobile:sync"]);
run(join(root, "android", "gradlew"), ["--no-daemon", "assembleRelease"], { cwd: join(root, "android") });
const built = join(root, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
await copyFile(built, candidate);
run(zipalign, ["-c", "-P", "16", "-v", "4", candidate]);
const signature = capture(apksigner, ["verify", "--verbose", "--print-certs", candidate]);
process.stdout.write(signature);
const signerDigest = signature.match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-f]+)/i)?.[1]?.toLowerCase() || "";
if (signerDigest !== releaseCertificateSha256) throw new Error(`APK signer ${signerDigest || "is missing"}; expected the permanent 1Helm release certificate.`);

const analyzer = join(sdkRoot, "cmdline-tools", "latest", "bin", "apkanalyzer");
const badging = capture(analyzer, ["manifest", "application-id", candidate]).trim();
if (badging !== "com.gitcommit90.onehelm.mobile") throw new Error(`APK has unexpected application ID ${badging}.`);
const apkVersion = capture(analyzer, ["manifest", "version-name", candidate]).trim();
if (apkVersion !== version) throw new Error(`APK has version ${apkVersion}, expected ${version}.`);
const entries = capture("unzip", ["-Z1", candidate]);
if (/(^|\n)(?:AGENTS\.md|.*\/AGENTS\.md)(?:\n|$)/.test(entries)) throw new Error("Host-local AGENTS.md instructions leaked into the APK.");
const nativeAbis = [...entries.matchAll(/^lib\/([^/]+)\//gm)].map((entry) => entry[1]);
const uniqueAbis = [...new Set(nativeAbis)];
if (uniqueAbis.length && !["arm64-v8a", "armeabi-v7a", "x86", "x86_64"].every((abi) => uniqueAbis.includes(abi))) {
  throw new Error(`APK is not universal; native libraries cover only: ${uniqueAbis.join(", ")}.`);
}
await rm(canonical, { force: true });
await rename(candidate, canonical);
console.log(`Verified universal APK: ${canonical}`);
