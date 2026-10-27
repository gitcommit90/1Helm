// node --import ./test/stubs/register.mjs test/browser-upload.test.mjs
// browser_act upload kind and the visible wait cap: tool schema and description, what reaches the browser, the notes line in the result,
// and the browser server's code (file checks, file input path, file chooser path, shortened-wait note).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SEED } from "./helpers/seed-settings.mjs";
import { Resident } from "../src/resident.js";
import { classifySteps } from "../src/personal-fill.js";

const ok = (n) => console.log("  ok", n);
const db = new DatabaseSync(":memory:");
const sql = { exec(q, ...args) { if (!args.length && q.split(";").filter((x) => x.trim()).length > 1) { db.exec(q); return { toArray: () => [], one: () => undefined }; }
  const st = db.prepare(q), rows = /^\s*(SELECT|WITH|PRAGMA)/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => rows, one: () => rows[0] }; } };
const env = { MODEL_SETTINGS: SEED, MEMORY: "off", GENUI: "off", WORKMEM: "off", PROMPT_CACHE: "off", NO_TOLERANT_STUBS: true,
  DB: { prepare: (query) => { const q = { bind: () => q, first: async () => (query.includes("SELECT level FROM perm_prefs") ? { level: "standard" } : null), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }; return q; } } };
const R = new Resident({ storage: { sql, getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {} }, waitUntil: () => {} }, env);
R.put("tenant", "t1"); R.put("channel", "main"); R.arm = async () => {};
R.computer = () => ({ browser: async (op, body) => { ops.push([op, body]); return { ok: true, url: "https://x.example/c", title: "Compose", snapshot: '[e1] button "Add photos or video"', completed: 2, page_changed: true, notes }; } });
const mkTc = () => ({ kind: "chat", session: "s1", turn: "t1", emit: () => {}, inTool: 1, extraCharge: 0 });
const ops = []; let notes = ["attached 1 file through the file chooser that e1 opened"];

{
  const t = Object.fromEntries(R.tools().map((x) => [x.function.name, x.function])).browser_act, props = t.parameters.properties.actions.items.properties;
  assert.ok(props.kind.enum.includes("upload")); assert.equal(props.path.type, "string"); assert.equal(props.paths.type, "array");
  assert.match(t.description, /upload \{ref, path\}/); assert.match(t.description, /at most 10000 ms/);
  assert.match(readFileSync(new URL("../src/prompt/07-tools.md", import.meta.url), "utf8"), /`upload \{ref, path\}`/);
  ok("schema, description and prompt name upload and the 10 s wait cap");
}
{
  const step = [{ kind: "upload", ref: "e1", path: "files/clip.mp4" }, { kind: "wait", ms: 35000 }];
  assert.deepEqual(classifySteps(step, "", {}), { what: [] }, "upload types nothing, so no personal-fill gate applies");
  const r = await R.browserToolInner("browser_act", { actions: step }, mkTc());
  assert.equal(r.code, 0); assert.deepEqual(ops.at(-1), ["act", { actions: step }]);
  assert.match(r.out, /Notes: attached 1 file through the file chooser that e1 opened\. /);
  notes = []; assert.doesNotMatch((await R.browserToolInner("browser_act", { actions: step }, mkTc())).out, /Notes:/);
  ok("upload steps reach the browser as given and the server's notes appear in the result");
}
{
  const src = readFileSync(new URL("../image/opt/1hc-browser/server.mjs", import.meta.url), "utf8");
  assert.match(src, /kind === "upload"/); assert.match(src, /DOM\.setFileInputFiles", \{ files, objectId/); assert.match(src, /Page\.setInterceptFileChooserDialog/); assert.match(src, /Page\.fileChooserOpened/);
  assert.match(src, /no file at \$\{x\} on the computer/); assert.match(src, /is not an upload control/);
  assert.match(src, /wait shortened from \$\{want\} to \$\{WAIT_MAX\} ms/); assert.match(src, /WAIT_MAX = 10e3/);
  assert.match(src, /\(click, click_at, fill, type, select, press, scroll, wait, upload\)/);
  assert.match(src, /uploaded = true;/); assert.match(src, /const changed = uploaded \|\|/);
  ok("the browser server has the upload paths, the errors and the shortened-wait note");
}
console.log("browser-upload: all ok");
