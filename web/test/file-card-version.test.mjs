// node test/file-card-version.test.mjs: a file card, link, thumbnail and the viewer always ask for the file's CURRENT version.
// The URL carries ?c=<current version> only as a cache-buster (the server ignores it and sends the current bytes); nothing asks for an older version with ?v=.
import assert from "node:assert"; import { readFileSync } from "node:fs";
import { fileUrl as fileResUrl } from "../src/file-url.mjs";
const src = readFileSync(new URL("../src/v3.ts", import.meta.url), "utf8");
const grab = (start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf("\n", i)); };
const strip = (t) => t.replace(/: string|: number|\?: number|: boolean|!/g, "");
const FVER = new Map();
const fileBase = new Function("LIVE", "fileResUrl", strip(grab("const fileBase = ").replace("const fileBase = ", "return ")))({ api: "/api" }, fileResUrl);
const fileUrl = new Function("LIVE", "FVER", "fileResUrl", strip(grab("const fileUrl = ").replace("const fileUrl = ", "return ")))({ api: "/api" }, FVER, fileResUrl);
assert.equal(fileBase("c", "f1"), "/api/res/c/files/f1", "the base URL has no version");
assert.equal(fileUrl("c", "f1"), "/api/res/c/files/f1", "version not known yet: the plain URL, which the server answers with the current file");
FVER.set("c|f1", 1); assert.equal(fileUrl("c", "f1"), "/api/res/c/files/f1?c=1");
FVER.set("c|f1", 2); assert.equal(fileUrl("c", "f1"), "/api/res/c/files/f1?c=2", "after the file goes to version 2 every card asks for version 2");
assert.equal(fileUrl("c", "f1", true), "/api/res/c/files/f1?dl=1&c=2", "download keeps the current version");
assert.ok(!/[?&]v=\$\{/.test(grab("const fileUrl = ")), "fileUrl never asks the server for an older version");
// Cards no longer read the version their reply shared.
assert.ok(!/f\.version/.test(grab("function fileCard(")) && !/f\.version/.test(src.slice(src.indexOf("function fileCard("), src.indexOf("function fileCard(") + 3000).split("\nif (LIVE)")[0]), "the chat tile does not use its own version");
assert.ok(!/ver: t\.version/.test(src), "the File() card does not use the claimed tile's version");
assert.ok(!/data-fv="\$\{esc\(ch\.slug\)\}\|\$\{esc\(f\.id\)\}\$\{f\.version/.test(src), "the open link does not name a version");
// A new version reaches the app from the stream event and from the list poll.
assert.ok(/noteVer\(ch\.slug, ev\.file\); fileBumped\(ch\.slug, \[ev\.file\], false\)/.test(src), "the file event records the version and refreshes every card");
assert.ok(/const bumped = files\.filter\(f => noteVer\(ch\.slug, f\)\)/.test(src) && /fileBumped\(ch\.slug, bumped, true\)/.test(src), "the list poll records versions and repaints");
console.log("PASS file-card-version");
