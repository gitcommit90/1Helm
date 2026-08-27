import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const client = readFileSync(new URL("src/client/app.ts", root), "utf8");
const server = readFileSync(new URL("src/server/index.ts", root), "utf8");
const followups = readFileSync(new URL("src/server/followups.ts", root), "utf8");
const styles = readFileSync(new URL("src/client/styles.css", root), "utf8");

test("open chat threads present the persisted Board follow-up as a live countdown", () => {
  assert.match(server, /followup: threadFollowupView\(Number\(threadId\)\)/, "thread API uses the persisted follow-up view");
  assert.match(client, /S\.threadFollowup = data\.followup \|\| null/, "thread open hydrates the persisted wake");
  assert.match(client, /will check back in/, "banner tells the Captain when the resident will return");
  assert.match(client, /data(?:set)?: \{ threadFollowupCountdown: "" \}/, "countdown has a surgical live-update target");
  assert.match(client, /window\.setInterval\(tickThreadFollowup, 1000\)/, "countdown ticks once per second from due_at");
  assert.match(client, /Number\(e\.rootMessageId\) === Number\(S\.threadRoot\.id\)/, "follow-up events update only the matching open thread");
  assert.match(client, /S\.threadFollowup = e\.followup \|\| null;[\s\S]*paintThreadFollowup\(\)/, "live events update or remove the banner without reopening the thread");
  assert.match(client, /\["pending", "running"\]\.includes\(followup\.status\)/, "a claimed wake stays present instead of disappearing while the agent checks");
  assert.match(client, /is checking now/, "running wakes explicitly tell the Captain work is happening now");
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


test("narrow thread headers preserve Back and Close navigation ahead of usage metadata", () => {
  assert.match(client, /thread-ctx min-w-0[^`]*overflow-hidden text-ellipsis/, "usage chip is allowed to shrink and truncate");
  assert.match(client, /class: "flex min-w-0 items-center gap-1\.5 sm:gap-2"[\s\S]*?ctxChip/, "usage-side header group can shrink around the fixed close button");
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.thread-topbar \.thread-ctx \{ display: none; \}/, "small screens hide secondary usage metadata before it can cover Back");
  assert.match(client, /aria-label": "Close thread and return to channel"/, "Back remains an explicit navigation control");
});


test("scheduled wakes continue the requested outcome after intermediate jobs finish or fail", () => {
  assert.match(followups, /not necessarily completion of the Captain's requested outcome/, "runtime distinguishes a finished check from the requested outcome");
  assert.match(followups, /If it failed, inspect the failure, fix or retry it autonomously, and continue/, "failed CI or subprocesses trigger recovery rather than abandonment");
  assert.match(followups, /Never stop merely because one intermediate operation ended/, "wake cannot convert an intermediate result into a terminal hand-back");
});
