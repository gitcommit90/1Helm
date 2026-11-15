import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Loads the Mac shell with a fake Electron and returns the handlers it registered.
async function loadShell(selected) {
  const data = mkdtempSync(join(tmpdir(), "onehelm-display-"));
  const app = new EventEmitter();
  app.getPath = () => data;
  app.setPath = (_n, v) => { app.userData = v; };
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.webContents.getURL = () => this.url || ""; this.webContents.setWindowOpenHandler = () => {}; }
    loadFile() { return Promise.resolve(); }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    isDestroyed() { return false; } show() {} focus() {} close() {}
  }
  const got = {};
  const electron = { app, BrowserWindow: Window, shell: { openExternal() {} }, systemPreferences: { askForMediaAccess: async () => { got.askedMic = true; return true; } }, desktopCapturer: {},
    session: { defaultSession: { setPermissionCheckHandler(h) { got.check = h; }, setPermissionRequestHandler(h) { got.request = h; }, setDisplayMediaRequestHandler(h) { got.display = h; } } } };
  const Module = require("node:module"), oldLoad = Module._load, oldFetch = globalThis.fetch;
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "darwin" });
  Module._load = function (name, ...args) { return name === "electron" ? electron : oldLoad.call(this, name, ...args); };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ product: "1Helm", mobile_api: 1, has_users: true, setup_complete: true }) });
  try {
    writeFileSync(join(data, "remote-workspace"), selected + "\n");
    const path = require.resolve("../desktop/cloud-main.cjs");
    delete require.cache[path];
    require(path);
    await new Promise(setImmediate);
  } finally { Module._load = oldLoad; globalThis.fetch = oldFetch; }
  got.cleanup = () => { Object.defineProperty(process, "platform", platform); rmSync(data, { recursive: true, force: true }); };
  return got;
}

test("the Mac shell grants meeting sound only to the selected app page", async () => {
  const got = await loadShell("https://owner.1helm.com");
  try {
    assert.equal(typeof got.display, "function");
    const frame = { url: "https://owner.1helm.com/w/owner/app", parent: null };
    let result;
    got.display({ frame, securityOrigin: "https://owner.1helm.com/", audioRequested: true, videoRequested: true }, (r) => { result = r; });
    assert.deepEqual(result, { video: frame, audio: "loopback" }, "sound with the app page as the video");
    got.display({ frame: { url: "https://evil.example/w/x/app", parent: null }, securityOrigin: "https://evil.example", audioRequested: true }, (r) => { result = r; });
    assert.deepEqual(result, {}, "a foreign page gets nothing");
    got.display({ frame: { url: frame.url, parent: {} }, securityOrigin: "https://owner.1helm.com", audioRequested: true }, (r) => { result = r; });
    assert.deepEqual(result, {}, "an embedded frame gets nothing");
    // display-capture is allowed for the app page only, and never asks for the microphone.
    const contents = (url) => ({ getURL: () => url });
    assert.equal(got.check(contents(frame.url), "display-capture", "", {}), true);
    assert.equal(got.check(contents("https://evil.example/w/x/app"), "display-capture", "", {}), false);
    let allowed;
    await got.request(contents(frame.url), "display-capture", (v) => { allowed = v; }, {});
    assert.equal(allowed, true);
    assert.equal(got.askedMic, undefined);
    // getDisplayMedia arrives as "media" with no media types: no microphone prompt either.
    await got.request(contents(frame.url), "media", (v) => { allowed = v; }, { mediaTypes: [] });
    assert.equal(allowed, true);
    assert.equal(got.askedMic, undefined, "a display request never asks for the microphone");
    await got.request(contents(frame.url), "media", (v) => { allowed = v; }, { mediaTypes: ["audio"] });
    assert.equal(got.askedMic, true, "a real microphone request still asks");
    await got.request(contents("https://evil.example/w/x/app"), "display-capture", (v) => { allowed = v; }, {});
    assert.equal(allowed, false);
  } finally { got.cleanup(); }
});
