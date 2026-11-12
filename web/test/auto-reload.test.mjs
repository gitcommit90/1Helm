// node test/auto-reload.test.mjs: a new build reloads the open tab silently at a safe moment (src/auto-reload.ts).
// Checks: a different x-app-v marks a reload due and it happens when safe; the same build or a missing header does nothing;
// unsent text, a modal, typing, a running upload or recording block it; one reload per build, no loop; a newer build later reloads once more.
import assert from "node:assert"; import { build } from "esbuild"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const out = join(mkdtempSync(join(tmpdir(), "ar-")), "auto-reload.mjs");
await build({ entryPoints: [new URL("../src/auto-reload.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "warning" });
const { createReloader, pageSafe } = await import(out);
const ok = (n) => console.log("  ok", n);
const mk = (loaded = "266") => { const st = { v: null, safe: true, reloads: 0 }; const r = createReloader({ loaded, safe: () => st.safe, reload: () => { st.reloads++; }, get: () => st.v, set: (v) => { st.v = v; } }); return { st, r }; };

let { st, r } = mk();
assert.equal(r.seen("266"), false); assert.equal(r.seen(null), false); assert.equal(r.seen(""), false); assert.equal(r.tick(), false); assert.equal(st.reloads, 0);
ok("same build or no header: nothing due, no reload");

({ st, r } = mk()); assert.equal(r.seen("267"), true); assert.equal(r.tick(), true); assert.equal(st.reloads, 1); assert.equal(st.v, "267");
ok("a different build reloads when safe");

({ st, r } = mk()); st.safe = false; r.seen("267"); assert.equal(r.tick(), false); assert.equal(st.reloads, 0); assert.equal(r.due(), "267");
st.safe = true; assert.equal(r.tick(), true); assert.equal(st.reloads, 1);
ok("an unsafe moment waits, then reloads at the next safe one");

// the reloaded page (new reloader, same sessionStorage value) still sees a different build: stop
({ st, r } = mk("266")); st.v = "267"; assert.equal(r.seen("267"), false); assert.equal(r.tick(), false); assert.equal(st.reloads, 0);
ok("no loop: a page that already reloaded for this build never reloads for it again");
({ st, r } = mk("266")); st.v = "267"; r.seen("268"); assert.equal(r.tick(), true); assert.equal(st.v, "268");
ok("a newer build after that reloads once more");
({ st, r } = mk()); r.seen("267"); r.tick(); r.seen("267"); assert.equal(r.tick(), false); assert.equal(st.reloads, 1);
ok("repeated responses for one build reload once");

// pageSafe against a tiny fake document
const el = (o) => ({ readOnly: false, disabled: false, getAttribute: () => null, value: "", textContent: "", matches: () => true, ...o });
const doc = ({ fields = [], open = false, active = null } = {}) => ({ body: {}, activeElement: active, querySelectorAll: () => fields, querySelector: () => (open ? {} : null) });
assert.equal(pageSafe(doc(), () => false), true, "empty page is safe");
assert.equal(pageSafe(doc({ fields: [el({ value: "   " })] }), () => false), true, "blank text is not a draft");
assert.equal(pageSafe(doc({ fields: [el({ value: "half a message" })] }), () => false), false, "unsent text blocks");
assert.equal(pageSafe(doc({ fields: [el({ value: "x", readOnly: true })] }), () => false), true, "read-only field ignored");
assert.equal(pageSafe(doc({ open: true }), () => false), false, "a modal or sheet blocks");
assert.equal(pageSafe(doc({ active: el({}) }), () => false), true, "an empty focused composer does not block (typing is the idle wait)");
assert.equal(pageSafe(doc(), () => true), false, "an upload or recording blocks");
ok("pageSafe: draft, modal, upload/recording block; blank, read-only or empty focused fields do not");
