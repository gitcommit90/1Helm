import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ChannelComputer } from "../src/channel-computer.js";

globalThis.FixedLengthStream ??= class extends TransformStream {
  constructor(size) { let count = 0; super({ transform(chunk, ctl) { count += chunk.length; ctl.enqueue(chunk); }, flush() { assert.equal(count, size); } }); }
};

const root = mkdtempSync(join(tmpdir(), "onehelm-secure-copy-"));
try {
  const site = join(root, "site"), outside = join(root, "outside.txt"), script = new URL("../image/opt/1hc/secure-file.py", import.meta.url).pathname;
  mkdirSync(site); writeFileSync(join(site, "index.html"), "approved page"); writeFileSync(outside, "outside secret");
  symlinkSync("outside.txt", join(root, "linked.txt"));
  symlinkSync("../outside.txt", join(site, "swapped.html"));
  symlinkSync("site", join(root, "linked-site"));
  const objects = new Map();
  const computer = Object.create(ChannelComputer.prototype);
  computer.ensureRunning = async () => {};
  computer.put = () => {};
  computer.env = { WS: {
    async put(key, body) { const bytes = new Uint8Array(await new Response(body).arrayBuffer()); objects.set(key, bytes); return { size: bytes.length }; },
    async head(key) { const bytes = objects.get(key); return bytes ? { size: bytes.length } : null; },
    async delete(keys) { for (const key of keys) objects.delete(key); },
  } };
  computer.ctx = { container: { async exec(args) {
    assert.deepEqual(args.slice(0, 2), ["python3", "/opt/1hc/secure-file.py"]);
    const child = spawn("python3", [script, ...args.slice(2), root], { stdio: ["ignore", "pipe", "ignore"] });
    const stdout = Readable.toWeb(child.stdout), exitCode = new Promise((resolve) => child.on("close", resolve));
    return { stdout, exitCode, kill: () => child.kill("SIGKILL"),
      output: async () => ({ stdout: new Uint8Array(await new Response(stdout).arrayBuffer()), exitCode: await exitCode }) };
  } } };
  const good = await computer.fileToR2("site/index.html", "unit/good", 100, { noSymlink: true, expectedSize: 13 });
  assert.deepEqual(good, { ok: true, bytes: 13 });
  assert.equal(new TextDecoder().decode(objects.get("unit/good")), "approved page");
  const shared = await computer.fileToR2("site/index.html", "unit/shared", 100);
  assert.deepEqual(shared, { ok: true, bytes: 13 }, "Library shares use the descriptor-based workspace reader too");
  assert.deepEqual(await computer.readFile("site/index.html", 100), { ok: true, bytes: new TextEncoder().encode("approved page") }, "app attachments read the same workspace file");
  writeFileSync(join(site, "empty.css"), "");
  assert.deepEqual(await computer.fileToR2("site/empty.css", "unit/empty", 100, { noSymlink: true, expectedSize: 0 }), { ok: true, bytes: 0 });
  assert.equal(objects.get("unit/empty").length, 0);
  writeFileSync(join(site, "large.js"), "x".repeat(200000));
  assert.deepEqual(await computer.fileToR2("site/large.js", "unit/large", 200000, { noSymlink: true, expectedSize: 200000 }), { ok: true, bytes: 200000 });
  assert.equal(objects.get("unit/large").length, 200000);
  for (const path of ["site/swapped.html", "linked-site/index.html", "linked.txt", "../outside.txt", "/outside.txt"]) {
    const key = `unit/rejected-${objects.size}`;
    const result = await computer.fileToR2(path, key, 100, { noSymlink: true });
    assert.equal(result.ok, false, `${path} must not copy`);
    assert.equal(objects.has(key), false);
    const shareKey = `unit/shared-rejected-${objects.size}`;
    assert.equal((await computer.fileToR2(path, shareKey, 100)).ok, false, `${path} must not be shared from the computer`);
    assert.equal(objects.has(shareKey), false);
    assert.equal((await computer.readFile(path, 100)).ok, false, `${path} must not be attached to an app action`);
  }
  writeFileSync(join(site, "index.html"), "changed page");
  const changed = await computer.fileToR2("site/index.html", "unit/changed", 100, { noSymlink: true, expectedSize: 13 });
  assert.equal(changed.ok, false, "a different file size after listing must be refused");
  assert.equal(objects.has("unit/changed"), false);
  // The source process may fail after the declared bytes have reached R2.
  // Its exit status must still prevent a partially trusted page asset going live.
  computer.ctx.container.exec = async () => ({
    stdout: new ReadableStream({ start(ctl) { ctl.enqueue(new TextEncoder().encode("3\nabc")); ctl.close(); } }),
    exitCode: Promise.resolve(1), kill() {},
  });
  const failed = await computer.fileToR2("site/index.html", "unit/failed", 100, { noSymlink: true, expectedSize: 3 });
  assert.equal(failed.ok, false);
  assert.equal(objects.has("unit/failed"), false, "an object uploaded before a failed reader exit must be deleted");
  computer.ctx.container.exec = async () => ({
    stdout: new ReadableStream({ start(ctl) { ctl.enqueue(new TextEncoder().encode("5\nabc")); ctl.close(); } }),
    exitCode: Promise.resolve(1), kill() {},
  });
  const short = await computer.fileToR2("site/index.html", "unit/short", 100, { noSymlink: true, expectedSize: 5 });
  assert.equal(short.ok, false);
  assert.equal(objects.has("unit/short"), false, "a short file stream must not leave an R2 object");
  assert.equal(readFileSync(outside, "utf8"), "outside secret");
  console.log("ok - published page copy reads one open file descriptor and refuses symlinks and changed sizes");
} finally { rmSync(root, { recursive: true, force: true }); }
