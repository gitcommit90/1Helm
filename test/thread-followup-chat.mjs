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

test("Scheduled Board cards cancel one wake without confirmation or agent invocation", () => {
  const board = readFileSync(new URL("src/client/channel.ts", root), "utf8");
  assert(server.includes("followups") && server.includes("cancelPendingFollowup"));
  assert.match(board, /"aria-label": "Cancel follow-up"/);
  assert.match(board, /}, "Cancel"\) as HTMLButtonElement/, "cancel action uses a compact visible label");
  assert.match(board, /mt-1\.5 flex flex-wrap items-center justify-between gap-2/, "narrow cards wrap actions instead of clipping Check now");
  assert.doesNotMatch(board, /Cancel Follow Up/, "oversized label cannot crowd Check now out of the card");
  assert.match(board, /\/api\/threads\/\$\{thread\.id\}\/followups\/\$\{f\.id\}\/cancel/);
  assert.doesNotMatch(board.match(/cancel\.onclick[\s\S]*?return h\("div"/)?.[0] || "", /appConfirm/);
  assert.match(board, /thread\.followup = result\.followup \|\| null; opts\?\.onCancelled\?\.\(\)/);
});
