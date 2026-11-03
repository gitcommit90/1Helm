// node test/file-card-version.test.mjs: a reply's file card names the version that reply shared, so replacing the file later
// (same id, version 2) does not change the earlier message. The server serves a version with ?v=<n>.
import assert from "node:assert"; import { readFileSync } from "node:fs";
import { fileUrl as fileResUrl } from "../src/file-url.mjs";
const src = readFileSync(new URL("../src/v3.ts", import.meta.url), "utf8");
const line = src.split("\n").find(l => l.startsWith("const fileUrl = "));
assert.ok(line && /fileResUrl\(LIVE!\.api, slug, id, dl, ver\)/.test(line), "fileUrl passes the version to the escaping URL helper");
const fileUrl = (slug, id, dl = false, ver) => fileResUrl("/api", slug, id, dl, ver);
assert.equal(fileUrl("c", "f1"), "/api/res/c/files/f1", "no version: the current file, as before");
assert.equal(fileUrl("c", "f1", false, 1), "/api/res/c/files/f1?v=1", "the first reply's card asks for v1");
assert.equal(fileUrl("c", "f1", false, 2), "/api/res/c/files/f1?v=2", "the second reply's card asks for v2");
assert.equal(fileUrl("c", "f1", true, 1), "/api/res/c/files/f1?dl=1&v=1", "download keeps the version");
assert.notEqual(fileUrl("c", "f1", false, 1), fileUrl("c", "f1", false, 2), "two replies for one file id never share an image URL");
// Both message cards stay in their own message: the live "file" event replaces a card only inside the reply that shared it.
assert.ok(/ev\.t === "file"\)[^\n]*\n\s*const cs = \(reply\.cards \?\?= \[\]\)/.test(src), "the file event works on the current reply's own cards");
// Cards read the version from the file they hold, in the chat tile and in the File() card.
assert.ok(/fileUrl\(ch\.slug, f\.id, false, f\.version\)/.test(src), "the chat tile uses its file's version");
assert.ok(/ver: t\.version/.test(src) && /fileUrl\(ch\.slug, a\.fid!, false, ver\)/.test(src), "the File() card uses the claimed tile's version");
assert.ok(/data-fv="\$\{esc\(ch\.slug\)\}\|\$\{esc\(f\.id\)\}\$\{f\.version/.test(src), "the open link names the version so two cards of one file open their own version");
console.log("PASS file-card-version");
