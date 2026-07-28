import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createServer as createHttpServer } from "node:http";
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
  const [config, mobile, api, app, notifications, androidManifest, androidBuild, androidRules, androidPackage, androidStyles, androidLaunch, iosInfo, iosProject, iosLaunch, privacy, packageJson, iosPackage, gatewayHtml, gatewayError, androidGateway, androidActivity, iosGateway] = await Promise.all([
    read("capacitor.config.json"), read("src/client/mobile.ts"), read("src/client/api.ts"), read("src/client/app.ts"),
    read("src/client/notifications.ts"),
    read("android/app/src/main/AndroidManifest.xml"), read("android/app/build.gradle"), read("android/app/src/main/res/xml/data_extraction_rules.xml"), read("scripts/package-android-apk.mjs"),
    read("android/app/src/main/res/values/styles.xml"), read("android/app/src/main/res/layout/launch_screen.xml"), read("ios/App/App/Info.plist"), read("ios/App/App.xcodeproj/project.pbxproj"), read("ios/App/App/Base.lproj/LaunchScreen.storyboard"),
    read("ios/App/App/PrivacyInfo.xcprivacy"), read("package.json"), read("scripts/package-ios-ipa.mjs"),
    read("mobile-gateway/index.html"), read("mobile-gateway/error.html"), read("android/app/src/main/java/com/gitcommit90/onehelm/mobile/InstanceGatewayPlugin.java"), read("android/app/src/main/java/com/gitcommit90/onehelm/mobile/MainActivity.java"), read("ios/App/App/GatewayViewController.swift"),
  ]);
  const parsed = JSON.parse(config);
  assert.equal(parsed.appId, "com.gitcommit90.onehelm.mobile");
  assert.equal(parsed.server.androidScheme, "https");
  assert.equal(parsed.server.cleartext, false);
  assert.equal(parsed.webDir, "mobile-gateway", "the app packages only the connection and recovery shell");
  assert.equal(parsed.server.url, undefined, "the exact selected server is injected natively at launch, never as a wildcard build-time origin");
  assert.equal(parsed.server.allowNavigation, undefined, "no wildcard navigation grant can broaden native bridge access");
  assert.equal(parsed.server.errorPath, "error.html");
  assert.equal(parsed.loggingBehavior, "none");
  assert.equal(parsed.android.buildOptions.releaseType, "APK");
  assert.equal(parsed.android.webContentsDebuggingEnabled, false);
  assert.equal(parsed.ios.preferredContentMode, "mobile");
  assert.equal(parsed.ios.webContentsDebuggingEnabled, false);
  assert.equal(parsed.plugins.StatusBar.overlaysWebView, false, "iOS reserves the system status area before the packaged UI paints");
  assert.equal(parsed.plugins.StatusBar.backgroundColor, "#111318", "the native status area matches the dark header surface before first paint");
  assert.deepEqual(parsed.plugins.PushNotifications.presentationOptions, [], "foreground live events remain the one notification surface while background pushes use the system UI");
  assert.equal(parsed.plugins.SplashScreen.launchAutoHide, false, "native launch art remains only until the first real screen paints");
  assert.ok(parsed.plugins.SplashScreen.launchShowDuration <= 500, "launch has no artificial logo hold");
  assert.equal(parsed.plugins.SplashScreen.launchFadeOutDuration, 180);
  assert.equal(parsed.plugins.SplashScreen.androidScaleType, "CENTER_INSIDE");
  assert.equal(parsed.plugins.SplashScreen.layoutName, "launch_screen");
  for (const gatewayPage of [gatewayHtml, gatewayError]) {
    assert.match(gatewayPage, /requestAnimationFrame\(\(\)\s*=>\s*requestAnimationFrame/, "standalone gateway screens wait for their first paint before releasing the native splash");
    assert.match(gatewayPage, /SplashScreen[\s\S]*hide\(\{\s*fadeOutDuration:\s*180\s*\}\)/, "standalone gateway screens release the native splash");
  }

  assert.match(mobile, /SecureStorage/);
  assert.match(mobile, /KeychainAccess\.whenUnlockedThisDeviceOnly/);
  assert.match(mobile, /parsed\.protocol !== "https:"/);
  assert.match(mobile, /persistSecureSession/);
  assert.match(mobile, /removeSecureSession/);
  assert.match(mobile, /SplashScreen\.hide\(\{ fadeOutDuration: 180 \}\)/);
  assert.match(mobile, /requestAnimationFrame\(\(\) => requestAnimationFrame/, "launch fades only after the gateway or workspace paints");
  assert.match(mobile, /StatusBar\.setOverlaysWebView\(\{ overlay: platform !== "ios" \}\)/, "iOS keeps every full-screen header below the Dynamic Island while Android retains edge-to-edge rendering");
  assert.match(mobile, /StatusBar\.setBackgroundColor\(\{ color: surface \}\)/, "native status chrome follows the computed header surface");
  assert.match(mobile, /contains\("light"\) \? Style\.Light : Style\.Dark/, "status indicators stay legible when the user switches theme");
  assert.match(mobile, /App\.getLaunchUrl/, "a cold-start OAuth callback is retained");
  assert.match(mobile, /registerPlugin<InstanceGateway>\("InstanceGateway"\)/);
  assert.match(mobile, /location\.origin !== serverOrigin/, "the live frontend rejects a bridge injected onto any origin other than the selected instance");
  assert.match(mobile, /target\.protocol = target\.protocol === "https:" \? "wss:" : "ws:"/,
    "same-origin WebSockets preserve ws:// for HTTP browser instances and use wss:// for HTTPS/native gateways");
  assert.doesNotMatch(api, /let token = localStorage\.getItem/, "the session is not eagerly copied out of native secure storage");
  assert.match(app, /if \(isNativeMobile\(\) && !getToken\(\)\) return renderAuth\(\)/, "the gateway never opens host onboarding");
  assert.match(app, /src: serverAssetUrl\(avatarValue\)/, "server-hosted custom avatars resolve against the selected host");

  assert.match(androidManifest, /android:allowBackup="false"/);
  assert.match(androidManifest, /android:usesCleartextTraffic="false"/);
  assert.match(androidManifest, /android\.permission\.INTERNET/);
  assert.match(androidManifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(androidManifest, /android:scheme="onehelm" android:host="openrouter"/);
  assert.match(androidGateway, /parsed\.protocol|"https"\.equalsIgnoreCase|validOrigin/);
  assert.match(androidGateway, /shouldOverrideLoad[\s\S]*sameOrigin[\s\S]*https:\/\/localhost/, "Android rejects in-WebView HTTP(S) navigation outside the exact local or selected origin");
  assert.match(androidActivity, /registerPlugin\(InstanceGatewayPlugin\.class\)[\s\S]*setServerUrl\(selected\)[\s\S]*setErrorPath\("error\.html"\)/, "Android builds a bridge for exactly the selected HTTPS origin");
  assert.match(androidBuild, /versionName oneHelmVersion/);
  assert.match(androidBuild, /HELM_ANDROID_SIGNING_PROPERTIES/);
  assert.match(androidBuild, /signingConfig signingConfigs\.release/);
  assert.match(androidBuild, /minifyEnabled true/);
  assert.match(androidRules, /exclude domain="sharedpref"/);
  assert.match(androidPackage, /7b2d96ab21a242f9b17ddc7c65d133033bb9f0322158b6aab57bf8d46a7d27bf/);
  assert.match(androidPackage, /expected the permanent 1Helm release certificate/);
  assert.match(androidStyles, /windowSplashScreenBackground">@color\/launch_background/);
  assert.match(androidStyles, /windowSplashScreenAnimatedIcon">@drawable\/splash_android12/);
  assert.doesNotMatch(androidStyles, /android:background">@drawable\/splash/);
  assert.match(androidLaunch, /android:layout_width="96dp"/);
  assert.match(androidLaunch, /android:layout_height="96dp"/);
  assert.match(androidLaunch, /android:src="@drawable\/splash_mark"/);

  assert.match(iosInfo, /com\.gitcommit90\.onehelm\.mobile/);
  assert.match(iosInfo, /<string>onehelm<\/string>/);
  assert.match(iosInfo, /NSMicrophoneUsageDescription/);
  assert.match(iosInfo, /NSCameraUsageDescription/);
  assert.match(iosInfo, /NSPhotoLibraryUsageDescription/);
  assert.match(iosInfo, /Take Photo or Video/, "the protected camera path explains the exact user-triggered attachment action");
  assert.match(iosInfo, /NSSpeechRecognitionUsageDescription/);
  assert.match(iosInfo, /ITSAppUsesNonExemptEncryption/);
  assert.match(iosProject, /PRODUCT_BUNDLE_IDENTIFIER = com\.gitcommit90\.onehelm\.mobile/);
  assert.match(iosProject, /GatewayViewController\.swift in Sources/);
  assert.match(iosGateway, /descriptor\.errorPath = "error\.html"[\s\S]*descriptor\.serverURL = origin[\s\S]*registerPluginInstance\(InstanceGatewayPlugin\(\)\)/, "iOS builds a bridge for exactly the selected HTTPS origin");
  assert.match(iosGateway, /shouldOverrideLoad[\s\S]*sameOrigin[\s\S]*scheme\?\.lowercased\(\)[\s\S]*host\?\.lowercased\(\)/, "iOS rejects in-WebView HTTP(S) navigation outside an exact scheme, host, and port match");
  assert.match(iosProject, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(iosProject, /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements/);
  assert.match(notifications, /mobilePlatform\(\) !== "ios"/, "the current release offers push only on the platform with a complete APNs delivery path");
  assert.match(iosLaunch, /contentMode="scaleAspectFit"/);
  assert.match(iosLaunch, /firstAttribute="width" constant="88"/);
  assert.match(iosLaunch, /firstAttribute="height" constant="88"/);
  assert.doesNotMatch(iosLaunch, /contentMode="scaleAspectFill"/, "launch mark never fills or crops to the screen");
  assert.match(privacy, /NSPrivacyTracking[\s\S]*<false\/>/);
  assert.match(iosPackage, /copyFile\(join\(exported, ipaName\), candidate\)/, "IPA packaging supports a separate APFS release volume");

  const pkg = JSON.parse(packageJson);
  for (const dependency of ["@capacitor/core", "@capacitor/android", "@capacitor/ios", "@aparajita/capacitor-secure-storage"]) assert.ok(pkg.dependencies[dependency]);
  assert.ok(pkg.scripts["mobile:sync"] && pkg.scripts["package:android:release"] && pkg.scripts["package:ios:release"]);

  assert.match(gatewayHtml, /Connect to 1Helm[\s\S]*api\/mobile\/compatibility[\s\S]*selectServer/);
  assert.match(gatewayHtml, /<img[^>]+src="1helm-logo\.png"[^>]+alt="1Helm">/, "the native connection screen uses the real product logo");
  assert.doesNotMatch(gatewayHtml, /⛵/, "the native connection screen has no emoji placeholder logo");
  assert.match(gatewayHtml, /\.1helm\.com[\s\S]*Connect to a different url\?[\s\S]*Connect to 1Helm URL\?/, "the primary workspace-name field can switch to the existing custom-URL flow and back");
  assert.match(gatewayHtml, /customUrl \? normalize\(input\.value\) : workspaceOrigin\(input\.value\)/, "workspace names resolve only beneath 1helm.com while custom URLs retain strict validation");
  assert.match(gatewayError, /Instance unavailable[\s\S]*Retry[\s\S]*Change instance/);
  for (const frozenAsset of ["bundle.js", "app.css", "excalidraw"]) {
    assert.doesNotMatch(gatewayHtml + gatewayError, new RegExp(frozenAsset.replace(".", "\\."), "i"), `gateway contains no frozen ${frozenAsset}`);
  }

  const iosIcon = await sharp(join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")).metadata();
  assert.equal(iosIcon.width, 1024); assert.equal(iosIcon.height, 1024);
  const iosLaunchMark = await sharp(join(root, "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png")).metadata();
  assert.equal(iosLaunchMark.width, 512); assert.equal(iosLaunchMark.height, 512); assert.equal(iosLaunchMark.hasAlpha, true);
  const androidLaunchMark = await sharp(join(root, "android/app/src/main/res/drawable-nodpi/splash_mark.png")).metadata();
  assert.equal(androidLaunchMark.width, 256); assert.equal(androidLaunchMark.height, 256); assert.equal(androidLaunchMark.hasAlpha, true);
  const android12LaunchMark = await sharp(join(root, "android/app/src/main/res/drawable-nodpi/splash_android12.png")).metadata();
  assert.equal(android12LaunchMark.width, 256); assert.equal(android12LaunchMark.height, 256); assert.equal(android12LaunchMark.hasAlpha, true);
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
  const gatewayHtml = await read("mobile-gateway/index.html");
  const port = await freePort();
  const gatewayServer = createHttpServer((request, response) => {
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(gatewayHtml); return;
    }
    if (request.url === "/capacitor.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(`window.Capacitor={Plugins:{InstanceGateway:{getServer:async()=>({origin:""}),selectServer:async({origin})=>({origin})}}};`); return;
    }
    response.writeHead(404); response.end("not found");
  });
  await new Promise((resolveListen, reject) => {
    gatewayServer.once("error", reject);
    gatewayServer.listen(port, "127.0.0.1", resolveListen);
  });
  let browser;
  try {
    const base = `http://127.0.0.1:${port}`;
    browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base, { waitUntil: "networkidle0" });
    await page.waitForSelector('input[placeholder="your-workspace"]');
    const screen = await page.evaluate(() => {
      const card = document.querySelector("main");
      const inputs = [...document.querySelectorAll("input")];
      return {
        body: card?.textContent || "",
        serverType: inputs[0]?.getAttribute("type"),
        suffix: document.querySelector(".suffix")?.textContent || "",
        inputCount: inputs.length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cardFits: card ? card.getBoundingClientRect().top >= 0 && card.getBoundingClientRect().bottom <= innerHeight : false,
      };
    });
    assert.match(screen.body, /Connect to 1Helm/);
    assert.match(screen.body, /Enter your workspace name/);
    assert.doesNotMatch(screen.body, /Create the Captain account/);
    assert.doesNotMatch(screen.body, /password|Sign in/i);
    assert.equal(screen.serverType, "text");
    assert.equal(screen.suffix, ".1helm.com");
    assert.equal(screen.inputCount, 1, "the packaged gateway asks only for the selected instance");
    assert.ok(screen.overflowX <= 0, `phone gateway has ${screen.overflowX}px horizontal overflow`);
    assert.equal(screen.cardFits, true, "the connection card fits the phone viewport");
    await page.click("#alternate");
    await page.waitForSelector('input[placeholder="https://your-1helm-server.com"]');
    assert.equal(await page.$eval("#alternate", (button) => button.textContent?.trim()), "Connect to 1Helm URL?");
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    await new Promise((resolveClose) => gatewayServer.close(resolveClose));
  }
});
