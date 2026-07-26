import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import puppeteer from "puppeteer";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(join(root, path), "utf8");

async function browserExecutable() {
  const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH || ""];
  try { candidates.push(puppeteer.executablePath()); } catch { /* no bundled browser */ }
  candidates.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  for (const candidate of candidates.filter(Boolean)) {
    try { await access(candidate, fsConstants.X_OK); return candidate; } catch { /* try next */ }
  }
  return null;
}
const executablePath = await browserExecutable();

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close((error) => error ? reject(error) : resolvePort(typeof address === "object" && address ? address.port : 0));
    });
  });
}

async function waitFor(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.status < 500) return response; } catch { /* starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test("mobile compatibility is explicit and CORS is confined to packaged Capacitor origins", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "1helm-mobile-test-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
    cwd: root,
    env: { ...process.env, CTRL_DATA_DIR: dataDir, PORT: String(port), HELM_CHANNEL_COMPUTER_BACKEND: "native" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; }); child.stderr.on("data", (chunk) => { logs += chunk; });
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/api/setup/status`);
    const compatible = await fetch(`${base}/api/mobile/compatibility`, { headers: { origin: "capacitor://localhost" } });
    assert.equal(compatible.status, 200);
    assert.equal(compatible.headers.get("access-control-allow-origin"), "capacitor://localhost");
    assert.equal(compatible.headers.get("vary"), "Origin");
    assert.deepEqual(await compatible.json(), {
      product: "1Helm", mobile_api: 1, version: JSON.parse(await read("package.json")).version,
      has_users: false, setup_complete: false, requires_https: true,
    });

    const android = await fetch(`${base}/api/mobile/compatibility`, { headers: { origin: "https://localhost" } });
    assert.equal(android.headers.get("access-control-allow-origin"), "https://localhost");
    const hostile = await fetch(`${base}/api/mobile/compatibility`, { headers: { origin: "https://evil.example" } });
    assert.equal(hostile.headers.has("access-control-allow-origin"), false);

    const preflight = await fetch(`${base}/api/auth/login`, {
      method: "OPTIONS",
      headers: { origin: "https://localhost", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers") || "", /Authorization/);
    const blockedPreflight = await fetch(`${base}/api/auth/login`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    assert.equal(blockedPreflight.status, 403);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolveWait) => child.once("exit", resolveWait));
    await rm(dataDir, { recursive: true, force: true });
  }
  assert.doesNotMatch(logs, /(?:token|password|secret)=/i);
});

test("Capacitor shells keep sessions native, connections HTTPS-only, and release identities stable", async () => {
  const [config, mobile, api, app, androidManifest, androidBuild, androidRules, androidPackage, iosInfo, iosProject, privacy, packageJson] = await Promise.all([
    read("capacitor.config.json"), read("src/client/mobile.ts"), read("src/client/api.ts"), read("src/client/app.ts"),
    read("android/app/src/main/AndroidManifest.xml"), read("android/app/build.gradle"), read("android/app/src/main/res/xml/data_extraction_rules.xml"), read("scripts/package-android-apk.mjs"),
    read("ios/App/App/Info.plist"), read("ios/App/App.xcodeproj/project.pbxproj"), read("ios/App/App/PrivacyInfo.xcprivacy"), read("package.json"),
  ]);
  const parsed = JSON.parse(config);
  assert.equal(parsed.appId, "com.gitcommit90.onehelm.mobile");
  assert.equal(parsed.server.androidScheme, "https");
  assert.equal(parsed.server.cleartext, false);
  assert.equal(parsed.server.url, undefined, "release app packages the audited local UI instead of navigating a wildcard remote WebView");
  assert.equal(parsed.loggingBehavior, "none");
  assert.equal(parsed.android.buildOptions.releaseType, "APK");
  assert.equal(parsed.android.webContentsDebuggingEnabled, false);
  assert.equal(parsed.ios.preferredContentMode, "mobile");
  assert.equal(parsed.ios.webContentsDebuggingEnabled, false);

  assert.match(mobile, /SecureStorage/);
  assert.match(mobile, /KeychainAccess\.whenUnlockedThisDeviceOnly/);
  assert.match(mobile, /parsed\.protocol !== "https:"/);
  assert.match(mobile, /persistSecureSession/);
  assert.match(mobile, /removeSecureSession/);
  assert.match(mobile, /App\.getLaunchUrl/, "a cold-start OAuth callback is retained");
  assert.doesNotMatch(mobile, /destination\.origin === serverOrigin/, "server links cannot replace the audited packaged WebView");
  assert.doesNotMatch(api, /let token = localStorage\.getItem/, "the session is not eagerly copied out of native secure storage");
  assert.match(app, /if \(isNativeMobile\(\) && !getToken\(\)\) return renderAuth\(\)/, "the gateway never opens host onboarding");
  assert.match(app, /src: serverAssetUrl\(avatarValue\)/, "server-hosted custom avatars resolve against the selected host");

  assert.match(androidManifest, /android:allowBackup="false"/);
  assert.match(androidManifest, /android:usesCleartextTraffic="false"/);
  assert.match(androidManifest, /android\.permission\.INTERNET/);
  assert.match(androidManifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(androidManifest, /android:scheme="onehelm" android:host="openrouter"/);
  assert.match(androidBuild, /versionName oneHelmVersion/);
  assert.match(androidBuild, /HELM_ANDROID_SIGNING_PROPERTIES/);
  assert.match(androidBuild, /signingConfig signingConfigs\.release/);
  assert.match(androidBuild, /minifyEnabled true/);
  assert.match(androidRules, /exclude domain="sharedpref"/);
  assert.match(androidPackage, /7b2d96ab21a242f9b17ddc7c65d133033bb9f0322158b6aab57bf8d46a7d27bf/);
  assert.match(androidPackage, /expected the permanent 1Helm release certificate/);

  assert.match(iosInfo, /com\.gitcommit90\.onehelm\.mobile/);
  assert.match(iosInfo, /<string>onehelm<\/string>/);
  assert.match(iosInfo, /NSMicrophoneUsageDescription/);
  assert.match(iosInfo, /NSSpeechRecognitionUsageDescription/);
  assert.match(iosInfo, /ITSAppUsesNonExemptEncryption/);
  assert.match(iosProject, /PRODUCT_BUNDLE_IDENTIFIER = com\.gitcommit90\.onehelm\.mobile/);
  assert.match(iosProject, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(privacy, /NSPrivacyTracking[\s\S]*<false\/>/);

  const pkg = JSON.parse(packageJson);
  for (const dependency of ["@capacitor/core", "@capacitor/android", "@capacitor/ios", "@aparajita/capacitor-secure-storage"]) assert.ok(pkg.dependencies[dependency]);
  assert.ok(pkg.scripts["mobile:sync"] && pkg.scripts["package:android:release"] && pkg.scripts["package:ios:release"]);

  const iosIcon = await sharp(join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")).metadata();
  assert.equal(iosIcon.width, 1024); assert.equal(iosIcon.height, 1024);
  assert.ok((await stat(join(root, "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png"))).size > 10_000);
});

test("mobile server addresses normalize to an HTTPS origin and reject ambiguous input", async () => {
  const { normalizeServerOrigin } = await import("../src/client/mobile.ts");
  assert.equal(normalizeServerOrigin("helm.example.com/"), "https://helm.example.com");
  assert.equal(normalizeServerOrigin(" https://helm.example.com:8443 "), "https://helm.example.com:8443");
  for (const value of ["", "http://helm.example.com", "https://user:pass@helm.example.com", "https://helm.example.com/path", "https://helm.example.com?query=1", "https://helm.example.com/#fragment"]) {
    assert.throws(() => normalizeServerOrigin(value));
  }
});

test("the packaged phone gateway opens a fitting connection screen instead of host setup", {
  skip: executablePath ? false : "No local Chrome executable; native-shell and transport contracts still run independently.",
}, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "1helm-mobile-ui-test-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
    cwd: root,
    env: { ...process.env, CTRL_DATA_DIR: dataDir, PORT: String(port), HELM_CHANNEL_COMPUTER_BACKEND: "native" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let browser;
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/api/setup/status`);
    browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => {
      // Minimal Capacitor Android bridge contract. Native methods resolve as
      // they do on-device, while secure storage begins empty for this test.
      Object.defineProperty(window, "androidBridge", { value: {}, configurable: true });
      const promiseMethods = (names) => names.map((name) => ({ name, rtype: "promise" }));
      window.Capacitor = {
        PluginHeaders: [
          { name: "SecureStorage", methods: promiseMethods(["setSynchronizeKeychain", "internalGetItem", "internalSetItem", "internalRemoveItem", "clearItemsWithPrefix", "getPrefixedKeys"]) },
          { name: "StatusBar", methods: promiseMethods(["setStyle", "setOverlaysWebView"]) },
          { name: "Keyboard", methods: promiseMethods(["setResizeMode"]) },
          { name: "App", methods: [{ name: "addListener", rtype: "callback" }, ...promiseMethods(["removeListener", "getLaunchUrl"]) ] },
          { name: "Browser", methods: promiseMethods(["open", "close"]) },
        ],
        nativePromise(plugin, method) {
          if (plugin === "SecureStorage" && method === "internalGetItem") return Promise.resolve({ data: null });
          if (plugin === "SecureStorage" && method === "internalRemoveItem") return Promise.resolve({ success: false });
          if (plugin === "SecureStorage" && method === "getPrefixedKeys") return Promise.resolve({ keys: [] });
          return Promise.resolve({});
        },
        nativeCallback() { return Promise.resolve("mobile-test-listener"); },
      };
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base, { waitUntil: "networkidle0" });
    await page.waitForSelector('input[placeholder="https://your-1helm-server.com"]');
    const screen = await page.evaluate(() => {
      const stage = document.querySelector(".auth-stage");
      const inputs = [...document.querySelectorAll("input")];
      return {
        body: document.body.textContent || "",
        serverType: inputs[0]?.getAttribute("type"),
        passwordType: inputs.at(-1)?.getAttribute("type"),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        stageOverflowY: stage ? stage.scrollHeight - stage.clientHeight : -1,
        nativePlatform: document.documentElement.dataset.nativeMobile,
      };
    });
    assert.match(screen.body, /Connect to your 1Helm/);
    assert.match(screen.body, /must already be set up and reachable over HTTPS/);
    assert.doesNotMatch(screen.body, /Create the Captain account/);
    assert.equal(screen.serverType, "url");
    assert.equal(screen.passwordType, "password");
    assert.equal(screen.nativePlatform, "android");
    assert.ok(screen.overflowX <= 0, `phone gateway has ${screen.overflowX}px horizontal overflow`);
    assert.ok(screen.stageOverflowY <= 0, `phone connection card has ${screen.stageOverflowY}px vertical overflow`);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    child.kill("SIGTERM");
    await new Promise((resolveWait) => child.once("exit", resolveWait));
    await rm(dataDir, { recursive: true, force: true });
  }
});
