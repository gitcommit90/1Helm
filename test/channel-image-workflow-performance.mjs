import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const app = readFileSync(new URL("src/client/app.ts", ROOT), "utf8");
const workflows = readFileSync(new URL("src/client/workflows.ts", ROOT), "utf8");
const server = readFileSync(new URL("src/server/index.ts", ROOT), "utf8");

test("channel timeline omits root images while thread images use lazy thumbnails", () => {
  assert.match(app, /attachments\(m, opts\.inThread\)/);
  assert.match(app, /inThread \? m\.attachments : m\.attachments\.filter\(\(attachment\) => !attachment\.mime\.startsWith\("image\/"\)\)/);
  assert.match(app, /\?thumbnail=1&token=/);
  assert.match(app, /loading: "lazy", decoding: "async"/);
  assert.match(server, /url\.searchParams\.get\("thumbnail"\) === "1"/);
  assert.match(server, /resize\(\{ width: 720, height: 480, fit: "inside", withoutEnlargement: true \}\)/);
  assert.match(server, /webp\(\{ quality: 70, effort: 4 \}\)/);
});

test("workflow history loads a bounded recent page and fetches older runs explicitly", () => {
  assert.match(server, /Math\.min\(100, Number\(url\.searchParams\.get\("limit"\)\) \|\| 50\)/);
  assert.match(server, /ORDER BY id DESC LIMIT \?/);
  assert.match(server, /has_more: hasMore/);
  assert.match(workflows, /\/runs\?limit=50`/);
  assert.match(workflows, /Load 50 older runs/);
  assert.match(workflows, /\/runs\?limit=50&before=\$\{before\}/);
  assert.doesNotMatch(server, /SELECT id FROM messages WHERE workflow_id=\? AND parent_id IS NULL ORDER BY id"/);
});
