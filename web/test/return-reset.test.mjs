// node test/return-reset.test.mjs: src/return-reset.ts clears a busy "Opening…" state when the outside sign-in window closes or the app comes back.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "rr-")), out = join(dir, "rr.mjs");
await build({ entryPoints: [new URL("../src/return-reset.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error" });
const L = {}; const doc = { visibilityState: "visible", addEventListener: (t, f) => (L[t] = f), removeEventListener: (t) => delete L[t] };
globalThis.document = doc; globalThis.window = { addEventListener: (t, f) => (L["w" + t] = f), removeEventListener: (t) => delete L["w" + t], setTimeout, clearTimeout, setInterval, clearInterval };
const { resetWhenBack } = await import(out); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0; const win = { closed: false };
resetWhenBack(win, () => n++, 40, 10); await wait(60); assert.equal(n, 0, "open popup keeps busy");
win.closed = true; await wait(30); assert.equal(n, 0, "grace period"); await wait(40); assert.equal(n, 1, "closed popup clears once");
n = 0; resetWhenBack(null, () => n++, 40); L.wfocus(); L.visibilitychange(); await wait(70); assert.equal(n, 1, "focus clears once"); assert.ok(!L.wfocus, "listeners removed");
n = 0; const stop = resetWhenBack(null, () => n++, 40); L.wfocus(); stop(); await wait(70); assert.equal(n, 0, "stop wins over grace");
n = 0; doc.visibilityState = "hidden"; resetWhenBack(null, () => n++, 10); L.visibilitychange(); await wait(30); assert.equal(n, 0, "hidden does not clear"); doc.visibilityState = "visible"; L.visibilitychange(); await wait(30); assert.equal(n, 1);
console.log("return-reset ok");
