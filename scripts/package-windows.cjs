#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PRODUCT = "1Helm";
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = String(pkg.version || "").trim();
const REQUIRE_SIGNATURE = process.env.HELM_REQUIRE_WINDOWS_SIGNATURE === "1";
const CERT_SHA1 = String(process.env.WINDOWS_SIGN_CERT_SHA1 || "").replace(/\s+/g, "").toUpperCase();
// Keep the Windows connector pin in lockstep with package-mac-dmg.cjs.
const CLOUDFLARED_VERSION = "2026.3.0";
const CLOUDFLARED_URL = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe`;
const CLOUDFLARED_SHA256 = "59b12880b24af581cf5b1013db601c7d843b9b097e9c78aa5957c7f39f741885";
// Electron Packager evaluates directories before their children. Keep the
// scripts directory itself traversable, then retain only the three runtime
// files below; otherwise the exact-file exceptions can never be reached.
const IGNORE_NON_RUNTIME_ROOTS = /^\/(?!package\.json$|LICENSE$|NOTICE$|desktop(?:$|\/)|container(?:$|\/(?:Containerfile\.oci|channel-machine\.oci\.(?:tar|sha256|json))$)|deploy(?:$|\/1helm-oci-runtime-v1\.conf$)|src(?:$|\/)|public(?:$|\/)|scripts(?:$|\/(?:1helm-oci-runtime|mnemosyne-bridge\.py|install-wsl-runtime\.ps1|windows-removal\.cjs)$)|node_modules(?:$|\/))/;
// Excalidraw is compiled into public/bundle.js. Shipping its source package as
// well adds deeply nested Radix paths that legacy Squirrel/NuGet cannot
// releasify under Windows' 260-character path limit.
const IGNORE_CLIENT_BUILD_MODULES = /^\/node_modules\/@excalidraw(?:$|\/)/;
// Some production dependencies publish maintainer instruction files. They are
// useful in source checkouts but are not runtime assets and must not enter an
// installed app or release package.
const IGNORE_INSTRUCTION_FILES = /\/AGENTS\.md$/;

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows packaging must run on Windows x64.");
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) throw new Error("package.json must contain a release version.");
if (REQUIRE_SIGNATURE && !CERT_SHA1) throw new Error("Release packaging requires WINDOWS_SIGN_CERT_SHA1 from the Windows certificate store.");

function run(command, args, options = {}) {
  const safe = args.map((arg, index) => index && args[index - 1] === "/sha1" ? "<certificate-thumbprint>" : arg);
  process.stdout.write(`$ ${command} ${safe.join(" ")}\n`);
  const result = spawnSync(command, args, { stdio: "inherit", encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${command}`);
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function sign(target) {
  if (!CERT_SHA1) return;
  run("signtool.exe", ["sign", "/sha1", CERT_SHA1, "/fd", "SHA256", "/tr", "http://timestamp.digicert.com", "/td", "SHA256", target]);
  run("signtool.exe", ["verify", "/pa", "/v", target]);
}

function signPackagedExecutables(appDir) {
  if (!CERT_SHA1) return;
  const executable = /\.(?:exe|dll|node)$/i;
  const pending = [appDir];
  const targets = [];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && executable.test(entry.name)) targets.push(target);
    }
  }
  for (const target of targets.sort()) sign(target);
}

function prepareCloudflared(destination) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "1helm-cloudflared-win-"));
  const binary = path.join(root, "cloudflared.exe");
  run("curl.exe", ["-fsSL", CLOUDFLARED_URL, "-o", binary]);
  const digest = capture("certutil.exe", ["-hashfile", binary, "SHA256"]).split(/\r?\n/).find((line) => /^[a-f0-9 ]{64,}$/i.test(line.trim()))?.replaceAll(" ", "").toLowerCase() || "";
  if (digest !== CLOUDFLARED_SHA256) throw new Error(`Bundled cloudflared digest mismatch (got ${digest || "unavailable"}).`);
  fs.copyFileSync(binary, destination);
  fs.rmSync(root, { recursive: true, force: true });
}

async function main() {
  fs.mkdirSync(DIST, { recursive: true });
  const iconRoot = fs.mkdtempSync(path.join(os.tmpdir(), "1helm-win-icon-"));
  // Squirrel 1.x expands every package file through legacy .NET APIs limited
  // to 260-character paths. A short release directory alone is insufficient:
  // its packages/app-version staging tree still includes the packaged app's
  // full relative paths. Build both the app and installer in one fresh,
  // drive-root scratch directory, then retain only canonical artifacts.
  const windowsScratch = fs.mkdtempSync(path.join(path.parse(ROOT).root, "1hw-"));
  const ico = path.join(iconRoot, "1Helm.ico");
  try {
    const pngToIco = require("png-to-ico").default;
    const iconBuffer = await pngToIco([
      path.join(ROOT, "public", "icons", "icon-sailboat-192.png"),
      path.join(ROOT, "public", "icons", "icon-sailboat-512.png"),
    ]);
    fs.writeFileSync(ico, iconBuffer);
    const { packager } = require("@electron/packager");
    const [appDir] = await packager({
      dir: ROOT, name: PRODUCT, executableName: PRODUCT, appCopyright: "Copyright (c) 2026 Joseph Yaksich",
      win32metadata: { CompanyName: "Joseph Yaksich", FileDescription: PRODUCT, OriginalFilename: "1Helm.exe", ProductName: PRODUCT, InternalName: PRODUCT },
      platform: "win32", arch: "x64", out: windowsScratch, overwrite: true, prune: true, asar: false, icon: ico,
      ignore: [IGNORE_NON_RUNTIME_ROOTS, IGNORE_CLIENT_BUILD_MODULES, IGNORE_INSTRUCTION_FILES, /\.DS_Store$/, /\.log$/],
    });
    const appExe = path.join(appDir, "1Helm.exe");
    if (!fs.existsSync(appExe)) throw new Error("Packaged Windows application is missing 1Helm.exe.");
    const cloudflared = path.join(appDir, "resources", "cloudflared.exe");
    prepareCloudflared(cloudflared);
    if (!fs.existsSync(cloudflared)) throw new Error("Packaged Windows app is missing cloudflared.exe.");
    signPackagedExecutables(appDir);
    const pty = path.join(appDir, "resources", "app", "node_modules", "node-pty", "prebuilds", "win32-x64", "pty.node");
    if (!fs.existsSync(pty)) throw new Error("Packaged Windows app is missing the x64 terminal module.");
    if (capture("where.exe", ["dumpbin.exe"])) {
      const headers = capture("dumpbin.exe", ["/headers", appExe]);
      if (!/machine \(x64\)/i.test(headers)) throw new Error("Packaged Windows application is not x64.");
    }
    if (capture("where.exe", ["powershell.exe"])) {
      const script = path.join(appDir, "resources", "app", "scripts", "install-wsl-runtime.ps1");
      if (!fs.existsSync(script)) throw new Error("Packaged Windows app is missing its WSL setup script.");
      for (const required of [
        path.join(appDir, "resources", "app", "scripts", "1helm-oci-runtime"),
        path.join(appDir, "resources", "app", "deploy", "1helm-oci-runtime-v1.conf"),
        path.join(appDir, "resources", "app", "container", "Containerfile.oci"),
        path.join(appDir, "resources", "app", "container", "channel-machine.oci.tar"),
        path.join(appDir, "resources", "app", "container", "channel-machine.oci.sha256"),
      ]) if (!fs.existsSync(required)) throw new Error(`Packaged Windows app is missing ${path.basename(required)}.`);
    }

    const installerDir = path.join(windowsScratch, "w");
    const { createWindowsInstaller } = require("electron-winstaller");
    await createWindowsInstaller({
      appDirectory: appDir,
      outputDirectory: installerDir,
      authors: "Joseph Yaksich",
      exe: "1Helm.exe",
      name: "1Helm",
      title: "1Helm",
      description: pkg.description,
      setupExe: `1Helm-${VERSION}-windows-x64-setup.exe`,
      setupIcon: ico,
      iconUrl: "https://1helm.com/icons/icon-sailboat.ico",
      noMsi: true,
      loadingGif: undefined,
      signWithParams: CERT_SHA1 ? `/sha1 ${CERT_SHA1} /fd SHA256 /tr http://timestamp.digicert.com /td SHA256` : undefined,
    });
    const setup = path.join(installerDir, `1Helm-${VERSION}-windows-x64-setup.exe`);
    const nupkg = fs.readdirSync(installerDir).map((name) => path.join(installerDir, name)).find((name) => name.endsWith("-full.nupkg"));
    const releases = path.join(installerDir, "RELEASES");
    if (!fs.existsSync(setup) || !nupkg || !fs.existsSync(releases)) throw new Error("Windows installer/update artifacts are incomplete.");
    sign(setup);
    const finalSetup = path.join(DIST, path.basename(setup));
    // update.electronjs.org fetches an asset literally named RELEASES, then
    // rewrites the unchanged .nupkg basename embedded inside it to the GitHub
    // release download URL. Renaming either artifact breaks Squirrel updates.
    const finalNupkg = path.join(DIST, path.basename(nupkg));
    const finalReleases = path.join(DIST, "RELEASES");
    for (const target of [finalSetup, finalNupkg, finalReleases]) fs.rmSync(target, { force: true });
    fs.copyFileSync(setup, finalSetup);
    fs.copyFileSync(nupkg, finalNupkg);
    fs.copyFileSync(releases, finalReleases);
    for (const target of [finalSetup, finalNupkg, finalReleases]) {
      process.stdout.write(`${target}\nSHA-256 ${capture("certutil.exe", ["-hashfile", target, "SHA256"]).split(/\r?\n/).find((line) => /^[a-f0-9 ]{64,}$/i.test(line.trim()))?.replaceAll(" ", "") || "unavailable"}\n`);
    }
  } finally {
    fs.rmSync(iconRoot, { recursive: true, force: true });
    fs.rmSync(windowsScratch, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : error); process.exit(1); });
