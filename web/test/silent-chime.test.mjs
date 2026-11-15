// node test/silent-chime.test.mjs: notification sounds follow the phone's silent setting (src/silent.ts).
// Checks: Android ringer mode silent/vibrate skips the chime and normal plays it; a ringer change event applies at once; audioSession is
// "ambient" around a chime and back to "auto" afterwards and before the microphone starts; with the microphone busy the session is left alone
// and the chime is skipped only inside the native app; browsers without audioSession or a plugin are unchanged.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const out = join(mkdtempSync(join(tmpdir(), "sc-")), "silent.mjs");
await build({ entryPoints: [new URL("../src/silent.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
const ok = (n) => console.log("  ok", n);
let n = 0;
async function fresh({ plugin, session, native = true } = {}) {
  globalThis.window = { Capacitor: native ? { isNativePlatform: () => true, Plugins: plugin ? { InstanceGateway: plugin } : {} } : undefined };
  Object.defineProperty(globalThis, "navigator", { value: session ? { audioSession: session } : {}, configurable: true });
  const m = await import(out + "?" + ++n); await new Promise((z) => setTimeout(z, 5)); return m;
}
const gw = (mode) => { const g = { mode, fire: null, getRingerMode: async () => ({ mode: g.mode }), addListener: (e, f) => { if (e === "ringerModeChange") g.fire = f; } }; return g; };

for (const mode of ["silent", "vibrate"]) { const g = gw(mode), m = await fresh({ plugin: g }); m.silentInit(); await new Promise((z) => setTimeout(z, 5)); assert.equal(m.soundOk(), false, mode); }
ok("ringer mode silent or vibrate: no chime");
{ const g = gw("normal"), m = await fresh({ plugin: g }); m.silentInit(); await new Promise((z) => setTimeout(z, 5)); assert.equal(m.soundOk(), true);
  g.fire({ mode: "vibrate" }); assert.equal(m.soundOk(), false); g.fire({ mode: "normal" }); assert.equal(m.soundOk(), true); }
ok("normal plays, and a ringer change event applies at once");
{ const m = await fresh({ native: false }); assert.equal(m.soundOk(), true); }
{ const m = await fresh({ plugin: {} }); assert.equal(m.soundOk(), true); }
ok("browser, or an older app without getRingerMode: unchanged");
{ const s = { type: "auto" }, m = await fresh({ session: s }); assert.equal(m.soundOk(100), true); assert.equal(s.type, "ambient");
  await new Promise((z) => setTimeout(z, 1200)); assert.equal(s.type, "auto"); }
ok("audioSession is ambient for a chime and back to auto after it");
{ const s = { type: "auto" }, m = await fresh({ session: s }); m.soundOk(5000); assert.equal(s.type, "ambient"); m.silentRelease(); assert.equal(s.type, "auto"); }
ok("the microphone path releases the session at once");
{ const s = { type: "play-and-record" }, m = await fresh({ session: s }); m.silentMicBusy(() => true); assert.equal(m.soundOk(), false); assert.equal(s.type, "play-and-record"); }
{ const s = { type: "auto" }, m = await fresh({ session: s, native: false }); m.silentMicBusy(() => true); assert.equal(m.soundOk(), true); assert.equal(s.type, "auto"); }
ok("recording: session untouched, chime skipped only in the app");
{ const s = { set type(v) { throw new Error("x"); }, get type() { return "auto"; } }, m = await fresh({ session: s }); assert.equal(m.soundOk(), true); m.silentRelease(); }
ok("a throwing audioSession never breaks the chime");
console.log("PASS silent chime");
