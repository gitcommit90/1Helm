import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

test("desktop saves only a completed hosted handoff and blocks foreign redirects", async () => {
  const data = mkdtempSync(join(tmpdir(), "onehelm-cloud-desktop-"));
  const windows = [];
  const app = new EventEmitter();
  app.getPath = (name) => name === "userData" ? app.userData : data;
  app.setPath = (_name, value) => { assert.equal(existsSync(value), true, "Electron requires the data path to exist"); app.userData = value; };
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  class Window extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
      this.webContents.getURL = () => this.url || "";
      this.webContents.setWindowOpenHandler = () => {};
      windows.push(this);
    }
    loadFile(file) { this.url = pathToFileURL(file).href; return Promise.resolve(); }
    loadURL(url) {
      if (url === "https://app.1helm.com") {
        this.webContents.emit("will-redirect", { preventDefault() { throw new Error("handoff rejected"); } }, "https://owner.1helm.com/auth/handoff?token=secret");
        this.url = "https://owner.1helm.com/w/owner/app";
      } else this.url = url;
      this.webContents.emit("did-navigate", {}, this.url);
      return Promise.resolve();
    }
    isDestroyed() { return false; }
    show() {}
    focus() {}
    close() { this.emit("closed"); }
  }
  const electron = { app, BrowserWindow: Window, shell: { openExternal() {} }, systemPreferences: {},
    session: { defaultSession: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} } } };
  const Module = require("node:module"), oldLoad = Module._load, oldFetch = globalThis.fetch;
  try {
    Module._load = function (name, ...args) { return name === "electron" ? electron : oldLoad.call(this, name, ...args); };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ product: "1Helm", mobile_api: 1, has_users: true, setup_complete: true }) });
    require("../desktop/cloud-main.cjs");
    await new Promise(setImmediate);
    const main = windows[0];
    assert.ok(main, "the Cloud gateway opens");
    const action = { prevented: false, preventDefault() { this.prevented = true; } };
    main.webContents.emit("will-navigate", action, "https://desktop-action.1helm.invalid/connect?origin=https%3A%2F%2Fapp.1helm.com");
    await new Promise(setImmediate);
    assert.equal(action.prevented, true);
    const saved = join(app.userData, "remote-workspace");
    assert.equal(readFileSync(saved, "utf8").trim(), "https://owner.1helm.com", "loadURL's final handoff destination becomes the saved workspace");

    writeFileSync(saved, "https://app.1helm.com\n");
    main.webContents.emit("will-navigate", { preventDefault() { throw new Error("hosted app rejected"); } }, "https://other.1helm.com/w/other/app");
    main.webContents.emit("did-navigate", {}, "https://other.1helm.com/w/other/app");
    assert.equal(readFileSync(saved, "utf8").trim(), "https://app.1helm.com", "a hosted app link alone cannot replace the default host");
    main.webContents.emit("will-navigate", { preventDefault() { throw new Error("handoff start rejected"); } }, "https://app.1helm.com/auth/to?next=%2Fw%2Fowner%2Fapp");
    main.webContents.emit("did-navigate", {}, "https://owner.1helm.com/w/owner/app");
    assert.equal(readFileSync(saved, "utf8").trim(), "https://owner.1helm.com", "a browser-driven handoff saves its final workspace");

    main.webContents.emit("will-navigate", { preventDefault() { throw new Error("hosted link rejected"); } }, "https://other.1helm.com/p/unsafe/");
    main.webContents.emit("did-navigate", {}, "https://other.1helm.com/p/unsafe/");
    assert.equal(readFileSync(saved, "utf8").trim(), "https://owner.1helm.com", "a hosted page cannot replace the selected workspace");

    let prevented = false;
    main.webContents.emit("will-redirect", { preventDefault() { prevented = true; } }, "https://login.example.com/");
    assert.equal(prevented, true, "a server redirect cannot load an outside site in the main app window");
    assert.equal(windows.length, 2, "outside sign-in opens a separate window");
  } finally {
    Module._load = oldLoad;
    globalThis.fetch = oldFetch;
    rmSync(data, { recursive: true, force: true });
  }
});
