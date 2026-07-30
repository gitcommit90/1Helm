#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PRODUCT = "1Helm";
const APP_ID = "com.gitcommit90.1helm";
const EXECUTABLE = "1Helm";
const ARCH = "arm64";
const MACOS_APP_ICON_SOURCE = path.join(ROOT, "desktop", "icons", "1helm-macos-app-logo.jpg");
const CLOUDFLARED_VERSION = "2026.3.0";
const CLOUDFLARED_ARCHIVE_URL = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-darwin-arm64.tgz`;
const CLOUDFLARED_ARCHIVE_SHA256 = "2aae4f69b0fc1c671b8353b4f594cbd902cd1e360c8eed2b8cad4602cb1546fb";
const CLOUDFLARED_BINARY_SHA256 = "633cee0fd41fd2020e17498beecc54811bf4fc99f891c080dc9343eb0f449c60";
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = String(pkg.version || "").trim();
const REQUIRE_NOTARIZATION = process.env.HELM_REQUIRE_NOTARIZATION === "1";
const TEAM_ID = String(process.env.APPLE_TEAM_ID || "").trim().toUpperCase();
const NOTARY_PROFILE = String(process.env.APPLE_NOTARY_PROFILE || "").trim();
const CONFIGURED_IDENTITY = String(process.env.APPLE_SIGN_IDENTITY || "").trim();
// Electron Packager evaluates directories before their children. Keep the
// scripts directory itself traversable so the required Mnemosyne bridge can
// survive the otherwise root-level release filter.
const IGNORE_NON_RUNTIME_ROOTS =
  /^\/(?!package\.json$|LICENSE$|NOTICE$|desktop(?:$|\/)|container(?:$|\/)|src(?:$|\/)|public(?:$|\/)|scripts(?:$|\/mnemosyne-bridge\.py$)|node_modules(?:$|\/))/;

if (!VERSION) throw new Error("package.json must define a version");

function run(command, args, options = {}) {
  const displayArgs = args.map((arg, index) => {
    if (command === "codesign" && args[index - 1] === "--sign") return "<signing-identity>";
    if (command === "xcrun" && args[index - 1] === "--keychain-profile") return "<notary-profile>";
    return arg;
  });
  console.log(`$ ${command} ${displayArgs.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${command}`);
  return result;
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function commandExists(command) {
  return Boolean(capture("which", [command]));
}

function developerIdIdentities() {
  const output = capture("security", ["find-identity", "-v", "-p", "codesigning"]);
  const identities = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(Developer ID Application:[^"]+)"/);
    if (match) identities.push({ hash: match[1], name: match[2] });
  }
  return identities;
}

function resolveIdentity() {
  if (!TEAM_ID && !CONFIGURED_IDENTITY) return null;
  const configured = CONFIGURED_IDENTITY.toUpperCase();
  const identity = developerIdIdentities().find((candidate) => {
    const identityMatches = !configured || candidate.hash === configured || candidate.name === CONFIGURED_IDENTITY;
    const teamMatches = !TEAM_ID || candidate.name.toUpperCase().endsWith(`(${TEAM_ID})`);
    return identityMatches && teamMatches;
  });
  if (!identity) throw new Error("The configured Apple team/signing identity does not match an available Developer ID Application certificate.");
  return identity;
}

function notarize(file) {
  run("xcrun", ["notarytool", "submit", file, "--keychain-profile", NOTARY_PROFILE, "--wait"]);
}

function createIcon() {
  const source = MACOS_APP_ICON_SOURCE;
  if (!fs.existsSync(source)) throw new Error("desktop/icons/1helm-macos-app-logo.jpg is required");
  const iconRoot = fs.mkdtempSync(path.join(os.tmpdir(), "1helm-icon-"));
  const iconset = path.join(iconRoot, "1Helm.iconset");
  fs.mkdirSync(iconset);
  const sizes = [
    ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
  ];
  for (const [name, size] of sizes) run("sips", ["-z", String(size), String(size), source, "--setProperty", "format", "png", "--out", path.join(iconset, name)]);
  const icon = path.join(iconRoot, "1Helm.icns");
  run("iconutil", ["-c", "icns", iconset, "-o", icon]);
  return { icon, iconRoot };
}

function installProductIcon(appPath, icon) {
  const resources = path.join(appPath, "Contents", "Resources");
  const plist = path.join(appPath, "Contents", "Info.plist");
  fs.copyFileSync(icon, path.join(resources, "1Helm.icns"));
  run("plutil", ["-replace", "CFBundleIconFile", "-string", "1Helm.icns", plist]);
}

function verifyProductIcon(appPath) {
  const plist = path.join(appPath, "Contents", "Info.plist");
  const iconFile = capture("plutil", ["-extract", "CFBundleIconFile", "raw", plist]);
  const iconPath = path.join(appPath, "Contents", "Resources", iconFile);
  if (iconFile !== "1Helm.icns" || !fs.existsSync(iconPath) || fs.statSync(iconPath).size === 0) {
    throw new Error("Packaged app is missing the 1Helm product icon");
  }
}

function prepareCloudflared() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "1helm-cloudflared-"));
  const archive = path.join(root, "cloudflared.tgz");
  run("curl", ["--fail", "--location", "--retry", "3", "--output", archive, CLOUDFLARED_ARCHIVE_URL]);
  if (capture("shasum", ["-a", "256", archive]).split(/\s+/)[0] !== CLOUDFLARED_ARCHIVE_SHA256) throw new Error("Cloudflared archive checksum does not match the release pin");
  run("tar", ["-xzf", archive, "-C", root]);
  const binary = path.join(root, "cloudflared");
  if (!fs.existsSync(binary)) throw new Error("Cloudflared archive did not contain the connector binary");
  if (capture("shasum", ["-a", "256", binary]).split(/\s+/)[0] !== CLOUDFLARED_BINARY_SHA256) throw new Error("Cloudflared binary checksum does not match the release pin");
  if (!capture("file", [binary]).includes("arm64")) throw new Error("Cloudflared connector is not Apple Silicon arm64");
  fs.chmodSync(binary, 0o755);
  return { binary, root };
}

function verifyApp(appPath, expectTicket) {
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  const plist = path.join(appPath, "Contents", "Info.plist");
  if (capture("plutil", ["-extract", "CFBundleIdentifier", "raw", plist]) !== APP_ID) throw new Error("Packaged app has the wrong bundle identifier");
  if (capture("plutil", ["-extract", "CFBundleShortVersionString", "raw", plist]) !== VERSION) throw new Error("Packaged app has the wrong version");
  const executableInfo = capture("file", [path.join(appPath, "Contents", "MacOS", EXECUTABLE)]);
  if (!executableInfo.includes("arm64")) throw new Error(`Packaged app is not arm64: ${executableInfo}`);
  const nativePty = capture("find", [path.join(appPath, "Contents", "Resources"), "-path", "*/node-pty/prebuilds/darwin-arm64/pty.node", "-print", "-quit"]);
  if (!nativePty || !capture("file", [nativePty]).includes("arm64")) throw new Error("Packaged app is missing the darwin-arm64 terminal module");
  const ptyHelper = capture("find", [path.join(appPath, "Contents", "Resources"), "-path", "*/node-pty/prebuilds/darwin-arm64/spawn-helper", "-print", "-quit"]);
  if (!ptyHelper || !capture("file", [ptyHelper]).includes("arm64") || !fs.statSync(ptyHelper).mode.toString(8).endsWith("755")) {
    throw new Error("Packaged app is missing an executable darwin-arm64 terminal spawn helper");
  }
  const cloudflared = path.join(appPath, "Contents", "Resources", "cloudflared");
  if (!fs.existsSync(cloudflared) || !capture("file", [cloudflared]).includes("arm64")) {
    throw new Error("Packaged app is missing the pinned arm64 Cloudflared connector");
  }
  // The exact upstream SHA-256 is verified in prepareCloudflared before this
  // executable enters the bundle. Developer ID signing then changes the
  // Mach-O bytes, so the sealed app must verify its signature—not the
  // pre-signing whole-file hash.
  run("codesign", ["--verify", "--strict", "--verbose=2", cloudflared]);
  verifyProductIcon(appPath);
  if (expectTicket) {
    run("xcrun", ["stapler", "validate", appPath]);
    run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
  }
  const forbidden = capture("find", [appPath, "-name", "AGENTS.md", "-print", "-quit"]);
  if (forbidden) throw new Error("Host-local instruction files must not ship in the app");
  const launchAgent = capture("find", [path.join(appPath, "Contents"), "-path", "*/Library/LaunchAgents/*", "-print", "-quit"]);
  if (launchAgent) throw new Error("1Helm must not ship a legacy LaunchAgent that macOS attributes to the certificate publisher");
}

async function main() {
  if (process.platform !== "darwin" || process.arch !== ARCH) throw new Error("macOS packaging must run on an Apple Silicon Mac");
  for (const command of ["hdiutil", "codesign", "sips", "iconutil", "plutil", "ditto", "spctl", "xcrun"]) {
    if (!commandExists(command)) throw new Error(`${command} is required`);
  }
  if (REQUIRE_NOTARIZATION && (!TEAM_ID || !NOTARY_PROFILE)) {
    throw new Error("Release builds require APPLE_TEAM_ID and APPLE_NOTARY_PROFILE");
  }
  const identity = resolveIdentity();
  if (REQUIRE_NOTARIZATION && !identity) throw new Error("A matching Developer ID Application identity is required");

  fs.mkdirSync(DIST, { recursive: true });
  const dmg = path.join(DIST, `${PRODUCT}-${VERSION}-${ARCH}.dmg`);
  const candidate = path.join(DIST, `${PRODUCT}-${VERSION}-${ARCH}.candidate.dmg`);
  const updaterZip = path.join(DIST, `${PRODUCT}-${VERSION}-mac-${ARCH}.zip`);
  const updaterCandidate = path.join(DIST, `${PRODUCT}-${VERSION}-mac-${ARCH}.candidate.zip`);
  for (const target of [dmg, candidate, updaterZip, updaterCandidate]) if (fs.existsSync(target)) fs.unlinkSync(target);

  const { icon, iconRoot } = createIcon();
  const cloudflared = prepareCloudflared();
  let appPath = "";
  try {
    console.log("Packaging the complete local 1Helm runtime…");
    const { packager } = require("@electron/packager");
    const [appDir] = await packager({
      dir: ROOT,
      name: PRODUCT,
      executableName: EXECUTABLE,
      appBundleId: APP_ID,
      appCategoryType: "public.app-category.productivity",
      platform: "darwin",
      arch: ARCH,
      out: DIST,
      overwrite: true,
      prune: true,
      asar: false,
      ignore: [IGNORE_NON_RUNTIME_ROOTS, /\/AGENTS\.md$/, /\.DS_Store$/, /\.log$/],
      extendInfo: {
        CFBundleDisplayName: PRODUCT,
        CFBundleName: PRODUCT,
        NSMicrophoneUsageDescription: "1Helm uses the microphone only when you start speech-to-text in a message composer.",
        NSHighResolutionCapable: true,
        NSSupportsAutomaticGraphicsSwitching: true,
      },
    });
    appPath = path.join(appDir, `${PRODUCT}.app`);
    if (!fs.existsSync(appPath)) throw new Error(`App not found at ${appPath}`);
    installProductIcon(appPath, icon);
    fs.copyFileSync(cloudflared.binary, path.join(appPath, "Contents", "Resources", "cloudflared"));
    fs.chmodSync(path.join(appPath, "Contents", "Resources", "cloudflared"), 0o755);
    verifyProductIcon(appPath);

    if (identity) {
      console.log("Signing 1Helm with the matching Developer ID Application identity.");
      const { sign } = require("@electron/osx-sign");
      await sign({ app: appPath, identity: identity.hash, platform: "darwin" });
    } else {
      console.log("Signing an ad-hoc local build (not for distribution)." );
      run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
    }
    verifyApp(appPath, false);

    if (identity && NOTARY_PROFILE) {
      const notaryZip = path.join(DIST, `${PRODUCT}-${VERSION}-${ARCH}-app-notary.zip`);
      try {
        if (fs.existsSync(notaryZip)) fs.unlinkSync(notaryZip);
        run("ditto", ["-c", "-k", "--keepParent", appPath, notaryZip]);
        notarize(notaryZip);
        run("xcrun", ["stapler", "staple", appPath]);
        verifyApp(appPath, true);
      } finally {
        if (fs.existsSync(notaryZip)) fs.unlinkSync(notaryZip);
      }
    }

    if (REQUIRE_NOTARIZATION) {
      console.log("Creating the native updater ZIP from the notarized and stapled app…");
      run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, updaterCandidate]);
      const verifyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "1helm-update-verify-"));
      try {
        run("ditto", ["-x", "-k", updaterCandidate, verifyRoot]);
        const extractedApp = path.join(verifyRoot, `${PRODUCT}.app`);
        if (!fs.existsSync(extractedApp)) throw new Error("Updater ZIP does not contain 1Helm.app");
        verifyApp(extractedApp, true);
      } finally {
        fs.rmSync(verifyRoot, { recursive: true, force: true });
      }
      fs.renameSync(updaterCandidate, updaterZip);
    }

    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "1helm-dmg-"));
    try {
      run("ditto", [appPath, path.join(stage, `${PRODUCT}.app`)]);
      run("ln", ["-s", "/Applications", path.join(stage, "Applications")]);
      fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(stage, "LICENSE.txt"));
      fs.copyFileSync(path.join(ROOT, "NOTICE"), path.join(stage, "NOTICE.txt"));
      fs.writeFileSync(path.join(stage, "Install.txt"), [
        "1Helm", "", "Drag 1Helm.app to Applications, then open it.", "",
        "1Helm runs its workspace, terminals, agents, and data locally on this Mac.",
        "Persistent data: ~/Library/Application Support/1Helm-OCI-v1", "",
      ].join("\n"));
      run("hdiutil", ["create", "-volname", `${PRODUCT} ${VERSION}`, "-srcfolder", stage, "-ov", "-format", "UDZO", candidate]);
      if (identity) {
        run("codesign", ["--force", "--sign", identity.hash, "--timestamp", candidate]);
      } else {
        run("codesign", ["--force", "--sign", "-", candidate]);
      }
      run("codesign", ["--verify", "--strict", "--verbose=2", candidate]);
      if (identity && NOTARY_PROFILE) {
        notarize(candidate);
        run("xcrun", ["stapler", "staple", candidate]);
        run("xcrun", ["stapler", "validate", candidate]);
        run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", candidate]);
      }
      fs.renameSync(candidate, dmg);
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
    }

    run("codesign", ["--verify", "--strict", "--verbose=2", dmg]);
    const mountOutput = capture("hdiutil", ["attach", dmg, "-nobrowse"]);
    const mountLine = mountOutput.split("\n").find((line) => line.includes("/Volumes/"));
    const mount = mountLine ? mountLine.slice(mountLine.indexOf("/Volumes/")).trim() : "";
    if (!mount) throw new Error("Could not mount the final DMG for verification");
    try {
      verifyApp(path.join(mount, `${PRODUCT}.app`), Boolean(identity && NOTARY_PROFILE));
    } finally {
      run("hdiutil", ["detach", mount]);
    }
    if (identity && NOTARY_PROFILE) {
      run("xcrun", ["stapler", "validate", dmg]);
      run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", dmg]);
    }
    const digest = capture("shasum", ["-a", "256", dmg]).split(/\s+/)[0];
    console.log(`DMG ready: ${dmg}`);
    console.log(`SHA-256: ${digest}`);
    if (fs.existsSync(updaterZip)) {
      console.log(`Updater ZIP ready: ${updaterZip}`);
      console.log(`Updater ZIP SHA-256: ${capture("shasum", ["-a", "256", updaterZip]).split(/\s+/)[0]}`);
    }
  } finally {
    fs.rmSync(iconRoot, { recursive: true, force: true });
    fs.rmSync(cloudflared.root, { recursive: true, force: true });
    if (fs.existsSync(updaterCandidate)) fs.unlinkSync(updaterCandidate);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
