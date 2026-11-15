import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { newerRelease, isNewer, createMacUpdater, feedJson, releaseVersion, updatesSupported, appMenuTemplate, FEED_URL, ZIP_URL, CHECK_INTERVAL_MS } = require("../desktop/mac-update.cjs");

function setup({ packaged = true, platform = "darwin", response = 0, feed = feedJson("1.6.7"), feedError = null } = {}) {
  const app = { isPackaged: packaged, getVersion: () => "1.6.6", name: "1Helm" };
  const autoUpdater = Object.assign(new EventEmitter(), {
    feed: null, checks: 0, installs: 0,
    setFeedURL(o) { this.feed = o; },
    checkForUpdates() { this.checks++; },
    quitAndInstall() { this.installs++; },
  });
  const shown = [];
  const dialog = { showMessageBox: async (...args) => { const o = args.at(-1); shown.push(o); return { response }; } };
  let template = null;
  const Menu = { buildFromTemplate: (t) => (template = t), setApplicationMenu() {} };
  const fetches = [];
  const fetchFeed = async () => { fetches.push(1); if (feedError) throw feedError; return feed; };
  const updater = createMacUpdater({ app, autoUpdater, dialog, Menu, platform, fetchFeed, firstDelayMs: 1e9, intervalMs: 1e9 });
  return { app, autoUpdater, dialog, shown, updater, fetches, template: () => template };
}
const tick = () => new Promise(setImmediate);

test("the feed is the static JSON file on 1helm.com and names the zip of the same version", () => {
  assert.equal(FEED_URL, "https://1helm.com/download/mac-update.json");
  assert.equal(ZIP_URL("1.6.6"), "https://1helm.com/download/1Helm-1.6.6-mac.zip");
  assert.equal(CHECK_INTERVAL_MS, 4 * 60 * 60 * 1000);
  const feed = feedJson("1.6.6", { pubDate: "2026-11-09T00:00:00.000Z" });
  assert.equal(feed.currentRelease, "1.6.6");
  assert.deepEqual(feed.releases, [{ version: "1.6.6", updateTo: { version: "1.6.6", pub_date: "2026-11-09T00:00:00.000Z", notes: "", name: "1.6.6", url: "https://1helm.com/download/1Helm-1.6.6-mac.zip" } }]);
});

test("only the packaged app on macOS checks for updates", () => {
  assert.equal(updatesSupported({ app: { isPackaged: true }, platform: "darwin" }), true);
  assert.equal(updatesSupported({ app: { isPackaged: false }, platform: "darwin" }), false);
  assert.equal(updatesSupported({ app: { isPackaged: true }, platform: "linux" }), false);
  assert.equal(updatesSupported({ app: { isPackaged: true }, platform: "win32" }), false);
  const dev = setup({ packaged: false });
  assert.equal(dev.updater.start(), false);
  assert.equal(dev.updater.check({ interactive: true }), false);
  assert.equal(dev.autoUpdater.feed, null);
  assert.equal(dev.autoUpdater.checks, 0);
  assert.equal(dev.template(), null, "the default menu stays");
  const linux = setup({ platform: "linux" });
  assert.equal(linux.updater.start(), false);
});

test("start sets the json feed once and adds Check for Updates to the app menu", () => {
  const t = setup();
  assert.equal(t.updater.start(), true);
  t.updater.stop();
  assert.deepEqual(t.autoUpdater.feed, { url: FEED_URL, serverType: "json" });
  const items = t.template()[0].submenu.map((i) => i.label || i.role);
  assert.ok(items.indexOf("Check for Updates…") === items.indexOf("about") + 1);
  assert.deepEqual(appMenuTemplate("1Helm", () => {}).slice(1).map((m) => m.role), ["editMenu", "viewMenu", "windowMenu"]);
});

test("a background check is silent when current, on errors and on a missing feed", async () => {
  const same = setup({ feed: { currentRelease: "1.6.0", releases: [] } });
  same.updater.check(); await tick();
  assert.equal(same.autoUpdater.checks, 0, "nothing newer: Squirrel is not asked");
  assert.equal(same.shown.length, 0);
  const gone = setup({ feedError: new Error("feed 404") });
  gone.updater.check(); await tick();
  gone.updater.check(); await tick();
  assert.equal(gone.fetches.length, 2, "a failed check does not block the next one");
  assert.equal(gone.autoUpdater.checks, 0);
  assert.equal(gone.shown.length, 0);
  const squirrel = setup();
  squirrel.updater.check(); await tick();
  assert.equal(squirrel.autoUpdater.checks, 1, "a newer release starts the Squirrel download");
  squirrel.autoUpdater.emit("error", new Error("404 https://1helm.com/x.zip"));
  await tick();
  assert.equal(squirrel.shown.length, 0);
});

test("a feed that names the running version or an older one means no update", () => {
  assert.equal(newerRelease(feedJson("1.6.6"), "1.6.6"), null);
  assert.equal(newerRelease(feedJson("1.6.5"), "1.6.6"), null);
  assert.equal(newerRelease({ currentRelease: "1.6.0", releases: [] }, "1.6.6"), null);
  assert.equal(newerRelease({ currentRelease: "1.6.7", releases: [] }, "1.6.6"), null);
  assert.equal(newerRelease(null, "1.6.6"), null);
  assert.equal(newerRelease(feedJson("1.6.7"), "1.6.6").url, "https://1helm.com/download/1Helm-1.6.7-mac.zip");
  assert.equal(isNewer("1.10.0", "1.9.9"), true);
  assert.equal(isNewer("1.6.6", "1.6.6"), false);
});

test("a check is not repeated while one is running", async () => {
  const t = setup();
  t.updater.check(); t.updater.check(); await tick();
  assert.equal(t.fetches.length, 1);
  assert.equal(t.autoUpdater.checks, 1);
});

test("a manual check says you're up to date, or reports an error", async () => {
  const t = setup({ feed: feedJson("1.6.6") });
  t.updater.check({ interactive: true });
  await tick();
  assert.equal(t.shown.length, 1);
  assert.equal(t.shown[0].message, "You're up to date.");
  const bad = setup({ feedError: new Error("offline") });
  bad.updater.check({ interactive: true });
  await tick();
  assert.equal(bad.shown[0].message, "Couldn't check for updates.");
});

test("a downloaded update asks once to restart, and Restart installs it", async () => {
  const t = setup({ response: 0 });
  t.updater.check(); await tick();
  t.autoUpdater.emit("update-downloaded", {}, "", "1.6.7");
  await tick();
  assert.equal(t.shown.length, 1);
  assert.equal(t.shown[0].message, "1Helm 1.6.7 is ready. Restart to update.");
  assert.deepEqual(t.shown[0].buttons, ["Restart", "Later"]);
  assert.equal(t.autoUpdater.installs, 1);
});

test("Later does not install and the background check does not ask again", async () => {
  const t = setup({ response: 1 });
  t.updater.check(); await tick();
  t.autoUpdater.emit("update-downloaded", {}, "", "1.6.7");
  await tick();
  assert.equal(t.autoUpdater.installs, 0);
  t.updater.check();
  await tick();
  assert.equal(t.autoUpdater.checks, 1, "no new download check while an update is waiting");
  assert.equal(t.shown.length, 1, "no second prompt");
  t.updater.check({ interactive: true });
  await tick();
  assert.equal(t.shown.length, 2, "a manual check offers the waiting update again");
});

test("release names give the version", () => {
  assert.equal(releaseVersion("1.6.7"), "1.6.7");
  assert.equal(releaseVersion("v1.6.7-beta.1"), "1.6.7-beta.1");
  assert.equal(releaseVersion(""), null);
});
