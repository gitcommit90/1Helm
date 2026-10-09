#!/usr/bin/env node
// Package the remote 1HC client without the retired local server, WSL, sidecars,
// or a build of the legacy UI. Signing and publishing are separate release steps.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { packager } from "@electron/packager";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const source = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;
if (!["darwin", "win32", "linux"].includes(platform)) throw new Error("Use darwin, win32, or linux as the platform");
if (!["x64", "arm64"].includes(arch)) throw new Error("Use x64 or arm64 as the architecture");
const stage = mkdtempSync(join(tmpdir(), "1helm-cloud-client-"));
const out = resolve(process.env.ONEHELM_CLIENT_OUTPUT_DIR || join(root, "dist", "cloud-clients"));

function copy(relative) {
  const dest = join(stage, relative);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(root, relative), dest);
}
function run(file, args) {
  const result = spawnSync(file, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${file} failed (${result.status})`);
}
async function icon() {
  if (platform === "win32") return join(root, "site", "public", "icons", "icon-sailboat.ico");
  const artwork = join(root, "desktop", "icons", "1helm-macos-app-logo.jpg");
  if (platform === "linux") {
    const target = join(stage, "1Helm.png");
    await sharp(artwork).resize(512, 512).png().toFile(target);
    return target;
  }
  const iconset = join(stage, "1Helm.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    run("sips", ["-z", String(size), String(size), artwork, "--setProperty", "format", "png", "--out", join(iconset, `icon_${size}x${size}.png`)]);
    run("sips", ["-z", String(size * 2), String(size * 2), artwork, "--setProperty", "format", "png", "--out", join(iconset, `icon_${size}x${size}@2x.png`)]);
  }
  const target = join(stage, "1Helm.icns");
  run("iconutil", ["-c", "icns", iconset, "-o", target]);
  return target;
}

try {
  for (const relative of ["desktop/cloud-main.cjs", "desktop/workspace-target.cjs",
    "desktop/gateway.html", "desktop/icons/1helm-macos-app-logo.jpg", "LICENSE", "NOTICE"]) copy(relative);
  writeFileSync(join(stage, "package.json"), JSON.stringify({
    name: "1helm-cloud-client", productName: "1Helm", version: source.version,
    main: "desktop/cloud-main.cjs", license: "AGPL-3.0-only",
  }, null, 2) + "\n");
  const iconPath = await icon();
  mkdirSync(out, { recursive: true });
  const results = await packager({
    dir: stage, out, name: "1Helm", executableName: "1Helm",
    appBundleId: "com.gitcommit90.1helm", appCategoryType: "public.app-category.productivity",
    appCopyright: "Copyright Joseph Yaksich", platform, arch, icon: iconPath,
    electronVersion: source.devDependencies.electron, asar: false, prune: true, overwrite: false,
    extendInfo: platform === "darwin" ? {
      CFBundleDisplayName: "1Helm",
      NSMicrophoneUsageDescription: "1Helm uses the microphone when you start speech-to-text.",
    } : undefined,
    win32metadata: platform === "win32" ? { CompanyName: "1Helm", FileDescription: "1Helm Cloud Client", ProductName: "1Helm" } : undefined,
  });
  for (const result of results) {
    const appRoot = platform === "darwin" ? join(result, "1Helm.app", "Contents", "Resources", "app") : join(result, "resources", "app");
    if (!existsSync(join(appRoot, "desktop", "cloud-main.cjs"))) throw new Error("Packaged client entrypoint is missing");
    for (const forbidden of ["src", "container", "cloudflare", "mobile-gateway", "desktop/main.cjs", "desktop/updater.cjs"]) {
      if (existsSync(join(appRoot, forbidden))) throw new Error(`Legacy server content entered the client: ${forbidden}`);
    }
    console.log(`Cloud client ready for local review: ${result}`);
  }
} finally { rmSync(stage, { recursive: true, force: true }); }
