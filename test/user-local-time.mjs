import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-user-local-time-"));
process.env.CTRL_DATA_DIR = dataDir;
const { q1, run } = await import("../src/server/db.ts");
const { captureUserTimeZone, normalizeUserTimeZone, userLocalTimeContext } = await import("../src/server/user-local-time.ts");
const { runtimePromptTiersForChannel } = await import("../src/server/bots.ts");

test("authenticated browser time zones are validated, canonicalized, and persisted", () => {
  const stamp = Date.now();
  const userId = Number(run("INSERT INTO users (username,pass,display,is_admin,created) VALUES (?,?,?,?,?)", `tz-${stamp}`, "x", "Time User", 1, stamp).lastInsertRowid);
  assert.equal(normalizeUserTimeZone("Not/A_Real_Zone"), "");
  assert.equal(captureUserTimeZone(userId, "Not/A_Real_Zone"), "");
  assert.equal(q1("SELECT time_zone FROM users WHERE id=?", userId).time_zone, "");

  assert.equal(captureUserTimeZone(userId, "America/Los_Angeles"), "America/Los_Angeles");
  assert.equal(q1("SELECT time_zone FROM users WHERE id=?", userId).time_zone, "America/Los_Angeles");

  const context = userLocalTimeContext(userId, Date.parse("2026-09-10T20:15:30.000Z"));
  assert.match(context, /timezone="America\/Los_Angeles"/);
  assert.match(context, /Thursday, September 10, 2026 at 1:15:30 PM GMT-07:00/);
  assert.match(context, /2026-09-10T20:15:30\.000Z/);
  assert.match(context, /channel computer's clock or time zone is not the user's time zone/);
});

test("each resident prompt receives current requesting-user local time in volatile turn context", () => {
  const stamp = Date.now();
  const userId = Number(run("INSERT INTO users (username,pass,display,is_admin,created,time_zone) VALUES (?,?,?,?,?,?)", `prompt-tz-${stamp}`, "x", "Prompt User", 1, stamp, "America/New_York").lastInsertRowid);
  const channelId = Number(run("INSERT INTO channels (name,slug,kind,topic,purpose,status,created_by,created) VALUES (?,?,?,?,?,'active',?,?)", `tz-${stamp}`, `tz-${stamp}`, "channel", "", "Time-aware work", userId, stamp).lastInsertRowid);
  const botId = Number(run("INSERT INTO bots (name,model,created) VALUES (?,?,?)", `tz-agent-${stamp}`, "mock", stamp).lastInsertRowid);
  const agentId = Number(run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'channel',?,'ready',?)", botId, `tz-agent-${stamp}`, stamp).lastInsertRowid);
  run("INSERT INTO agent_channels (agent_id,channel_id,bound_at) VALUES (?,?,?)", agentId, channelId, stamp);

  const prompt = runtimePromptTiersForChannel(botId, channelId, false, "What is due today?", userId);
  assert.match(prompt.context, /<user-local-time timezone="America\/New_York">/);
  assert.match(prompt.context, /Current date and time for the requesting user:/);
  assert.match(prompt.context, /Use the user's time zone for dates, deadlines, and relative phrases/);
  assert.doesNotMatch(prompt.identity, /user-local-time/);
  assert.doesNotMatch(prompt.operating, /Current date and time for the requesting user/);
});

test("the web client sends its detected zone and native CORS admits the header", () => {
  const apiSource = readFileSync(new URL("../src/client/api.ts", import.meta.url), "utf8");
  const httpSource = readFileSync(new URL("../src/server/http.ts", import.meta.url), "utf8");
  const indexSource = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");
  assert.match(apiSource, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.match(apiSource, /"x-1helm-time-zone": browserTimeZone/);
  assert.match(httpSource, /X-1Helm-Time-Zone/);
  assert.match(indexSource, /captureUserTimeZone\(Number\(user\.id\), req\.headers\["x-1helm-time-zone"\], user\.time_zone\)/);
});

test.after(() => rmSync(dataDir, { recursive: true, force: true }));
