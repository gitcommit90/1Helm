import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const client = readFileSync(new URL("src/client/app.ts", root), "utf8");
const server = readFileSync(new URL("src/server/index.ts", root), "utf8");

test("open chat threads present the persisted Board follow-up as a live countdown", () => {
  assert.match(server, /followup: threadFollowupView\(Number\(threadId\)\)/, "thread API uses the persisted follow-up view");
  assert.match(client, /S\.threadFollowup = data\.followup \|\| null/, "thread open hydrates the persisted wake");
  assert.match(client, /will check back in/, "banner tells the Captain when the resident will return");
  assert.match(client, /data(?:set)?: \{ threadFollowupCountdown: "" \}/, "countdown has a surgical live-update target");
  assert.match(client, /window\.setInterval\(tickThreadFollowup, 1000\)/, "countdown ticks once per second from due_at");
  assert.match(client, /Number\(e\.rootMessageId\) === Number\(S\.threadRoot\.id\)/, "follow-up events update only the matching open thread");
  assert.match(client, /S\.threadFollowup = e\.followup \|\| null;[\s\S]*paintThreadFollowup\(\)/, "live events update or remove the banner without reopening the thread");
});
