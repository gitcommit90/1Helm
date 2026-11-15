// node test/channel-delete-optimistic.test.mjs: deleting a channel (src/delete.ts) takes it off the screen at once, sends the delete in the
// background, holds the slug in a "deleting" set so a refresh can't bring it back, and puts it back with a toast when the request fails.
import assert from "node:assert/strict"; import { build } from "esbuild"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "cd-")), out = join(dir, "d.mjs"), stub = join(dir, "dialog.mjs");
writeFileSync(stub, "export const ask = async () => globalThis.__ask; export const tell = async (o) => { (globalThis.__tells ||= []).push(o.title); };");
await build({ entryPoints: [new URL("../src/delete.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error",
  plugins: [{ name: "stub", setup(b) { b.onResolve({ filter: /^\.\/dialog$/ }, () => ({ path: stub })); } }] });
const { delInit, deleteChannel, channelIsDeleting } = await import(out);
globalThis.document = { querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, removeEventListener() {} };
globalThis.window = { addEventListener() {} }; globalThis.window = { addEventListener() {} };
// Each case deletes its own slug (the "deleting" set keeps a slug for a while), from the list main, x, <slug>, z.
const mk = (apiImpl, exists) => {
  const channels = ["main", "x", "SLUG", "z"], log = [];
  const t = { channels, log, run: async slug => {
    channels[2] = slug;
    delInit({ api: apiImpl, note: (n, s) => log.push(["note", n, s]), chat: () => null, channelName: s => s.toUpperCase(), chatGone() {}, channelExists: exists ? async () => exists() : undefined,
      channelHide: sl => { const i = channels.indexOf(sl); channels.splice(i, 1); log.push(["hide", sl]); return () => { channels.splice(i, 0, sl); log.push(["restore", sl]); }; },
      channelGone: sl => { const i = channels.indexOf(sl); if (i >= 0) channels.splice(i, 1); log.push(["gone", sl]); } });
    await deleteChannel(slug); } };
  return t;
};
const noteOf = t => t.log.find(l => l[0] === "note")?.[1];
const tells = () => { const x = globalThis.__tells || []; globalThis.__tells = []; return x; };
const back = ["main", "x", "SLUG", "z"], gone = ["main", "x", "z"];
const backFor = slug => back.map(c => (c === "SLUG" ? slug : c));
let n = 0; const sl = () => `s${++n}`;
globalThis.__ask = true;
// 1. the channel is hidden before the request answers, stays in the deleting set until it does, and a second confirm does nothing
let release; const slow = new Promise(r => { release = r; });
let t = mk(() => slow.then(() => ({ ok: true })), null), s1 = sl();
const p = t.run(s1); await new Promise(r => setTimeout(r, 5));
assert.deepEqual(t.channels, gone); assert.equal(channelIsDeleting(s1), true); assert.equal(noteOf(t), undefined);
await deleteChannel(s1); release(); await p;
assert.deepEqual(t.channels, gone); assert.equal(t.log.filter(l => l[0] === "hide").length, 1); assert.equal(noteOf(t), undefined, "no toast on success"); assert.deepEqual(tells(), []);
// 2. refused before hiding (a refusal answer, or HTTP 4xx other than 404): put back in the same place with the "is back" toast
for (const impl of [async () => ({ error: "confirmation_required" }), async () => { throw new Error("HTTP 403"); }, async () => { throw new Error("HTTP 429"); }]) {
  const s = sl(); t = mk(impl); await t.run(s);
  assert.deepEqual(t.channels, backFor(s)); assert.equal(channelIsDeleting(s), false); assert.equal(noteOf(t), "Couldn't delete the channel"); assert.deepEqual(tells(), []);
}
// 3. the server answered with some other error (a 500, an unknown error): the delete started, so the channel stays hidden and the old message shows
for (const impl of [async () => { throw new Error("HTTP 500"); }, async () => ({ error: "boom" })]) {
  const s = sl(); t = mk(impl); await t.run(s);
  assert.deepEqual(t.channels, gone); assert.equal(channelIsDeleting(s), true); assert.equal(noteOf(t), undefined); assert.deepEqual(tells(), ["Couldn't finish deleting the channel"]);
}
// 4. no such channel: already gone, stays gone, no message
t = mk(async () => ({ error: "no such channel" })); await t.run(sl()); assert.deepEqual(t.channels, gone); assert.deepEqual(tells(), []); assert.equal(noteOf(t), undefined);
// 5. no answer at all: ask the server. Gone there: stays hidden, silent. Still there: put back. Can't tell: stays hidden with a message.
const offline = async () => { throw new TypeError("Failed to fetch"); };
let s = sl(); t = mk(offline, () => false); await t.run(s); assert.deepEqual(t.channels, gone); assert.equal(channelIsDeleting(s), true); assert.deepEqual(tells(), []); assert.equal(noteOf(t), undefined);
s = sl(); t = mk(offline, () => true); await t.run(s); assert.deepEqual(t.channels, backFor(s)); assert.equal(channelIsDeleting(s), false); assert.equal(noteOf(t), "Couldn't delete the channel");
s = sl(); t = mk(offline, () => null); await t.run(s); assert.deepEqual(t.channels, gone); assert.equal(tells().length, 1);
// 6. cancelled confirm and General do nothing
globalThis.__ask = false; t = mk(async () => ({ ok: true })); await t.run(sl()); assert.equal(t.log.length, 0);
globalThis.__ask = true; await t.run("main"); assert.equal(t.log.length, 0);
console.log("PASS channel-delete-optimistic"); process.exit(0);
