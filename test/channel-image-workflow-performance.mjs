import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("..", import.meta.url);
const app = readFileSync(new URL("src/client/app.ts", ROOT), "utf8");
const attachments = readFileSync(new URL("src/client/message-attachments.ts", ROOT), "utf8");
const http = readFileSync(new URL("src/server/http.ts", ROOT), "utf8");
const workflows = readFileSync(new URL("src/client/workflows.ts", ROOT), "utf8");
const workflowServer = readFileSync(new URL("src/server/workflows.ts", ROOT), "utf8");
const server = readFileSync(new URL("src/server/index.ts", ROOT), "utf8");

test("channel timeline omits root images while thread images use lazy thumbnails", () => {
  assert.match(app, /renderMessageAttachments\(m, opts\.inThread\)/);
  assert.match(attachments, /inThread \? message\.attachments : message\.attachments\.filter\(\(attachment\) => !attachment\.mime\.startsWith\("image\/"\)\)/);
  assert.match(attachments, /\?thumbnail=1&token=/);
  assert.match(attachments, /loading: "lazy", decoding: "async"/);
  assert.match(server, /url\.searchParams\.get\("thumbnail"\) === "1"/);
  assert.match(http, /resize\(\{ width: 720, height: 480, fit: "inside", withoutEnlargement: true \}\)/);
  assert.match(http, /webp\(\{ quality: 70, effort: 4 \}\)/);
});

test("workflow history loads a bounded recent page and fetches older runs explicitly", () => {
  assert.match(workflowServer, /Math\.min\(100, Number\(limitValue\) \|\| 50\)/);
  assert.match(workflowServer, /ORDER BY id DESC LIMIT \?/);
  assert.match(workflowServer, /has_more: hasMore/);
  assert.match(workflows, /\/runs\?limit=50`/);
  assert.match(workflows, /Load 50 older runs/);
  assert.match(workflows, /\/runs\?limit=50&before=\$\{before\}/);
  assert.doesNotMatch(server, /SELECT id FROM messages WHERE workflow_id=\? AND parent_id IS NULL ORDER BY id"/);
});
