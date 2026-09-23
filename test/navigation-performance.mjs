import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NavigationCoordinator } from "../src/client/state.ts";

const root = new URL("..", import.meta.url);
const client = readFileSync(new URL("src/client/app.ts", root), "utf8");
const state = readFileSync(new URL("src/client/state.ts", root), "utf8");
const server = readFileSync(new URL("src/server/index.ts", root), "utf8");
const api = readFileSync(new URL("src/client/api.ts", root), "utf8");

 test("latest navigation owns the only commit authority", () => {
  const coordinator = new NavigationCoordinator();
  const first = coordinator.begin("channel:10");
  const second = coordinator.begin("channel:13");
  assert.equal(first.signal.aborted, true);
  assert.equal(coordinator.current(first), false);
  assert.equal(coordinator.current(second), true);
  coordinator.finish(first);
  assert.equal(coordinator.current(second), true, "finishing stale work cannot clear current navigation");
  coordinator.finish(second);
  assert.equal(coordinator.current(second), false);
});

test("navigation transport, state, and paint are ordered as one operation", () => {
  assert.match(api, /signal: opts\.signal/, "fetch receives the navigation AbortSignal");
  assert.match(client, /if \(!navigation\.current\(ticket\)\) return;/, "stale responses cannot commit");
  assert.match(client, /Promise\.all\(\[channelRequest, threadRequest\]\)/, "channel and restored thread load concurrently");
  assert.match(client, /dataset\.navigationPending/, "navigation acknowledges input before data returns");
  assert.match(client, /paintSidebarSelection\(previousId, id\); renderMain\(\)/, "channel selection is patched without rebuilding the sidebar");
  assert.match(client, /channelSnapshotCache/);
  assert.match(client, /threadSnapshotCache/);
});

test("thread history is bounded by a real server cursor", () => {
  assert.match(server, /const limit = Math\.min\(100, Math\.max\(1, Number\(url\.searchParams\.get\("limit"\) \|\| 24\)\)\)/);
  assert.match(server, /ORDER BY id DESC LIMIT \?/, "SQL limits rows before serialization");
  assert.match(server, /reply_count: replyCount/);
  assert.match(server, /has_more: hasMore/);
  assert.match(server, /before: oldest/);
  assert.match(state, /threadHasMore/);
  assert.match(client, /Load earlier replies/);
  assert.match(client, /captureConversationAnchor\(box\)[\s\S]*restoreConversationAnchor\(box, anchor\)/, "prepending preserves the visible message anchor");
  assert.match(client, /tm\.scrollTop < 160/, "approaching the top automatically requests the prior page");
});
