import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "1helm-feedback-"));
process.env.CTRL_DATA_DIR = root;
process.env.HELM_FEEDBACK_URL = "https://feedback.test/v1/feedback";
const { db, q1, run, seed, now, UPLOAD_DIR } = await import("../src/server/db.ts");
const feedback = await import("../src/server/feedback.ts");
seed();
const userId = run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('feedback-admin','test','Feedback Admin',1,?)", now()).lastInsertRowid;
const botId = run("INSERT INTO bots (name,model,created) VALUES ('feedback-agent','mock',?)", now()).lastInsertRowid;
const agentId = run("INSERT INTO agents (bot_id,kind,name,status,created) VALUES (?,'skipper','feedback-agent','ready',?)", botId, now()).lastInsertRowid;

test("feedback defaults to the host-controlled central collector", () => {
  assert.equal(feedback.DEFAULT_FEEDBACK_COLLECTOR, "https://1helm.com/api/feedback");
});

test("feedback diagnostics are opt-in, privacy-bounded, and attachments are durable", () => {
  const token = "a".repeat(40);
  writeFileSync(join(UPLOAD_DIR, token), "image");
  run("INSERT INTO tool_actions (agent_id,thread_id,tool,input_summary,result_summary,status,created) VALUES (?,NULL,'connect_google_workspace','private input','private output','failed',?)", agentId, now());
  const report = feedback.createFeedback({
    userId,
    comment: "The button failed",
    sendDiagnostics: true,
    uploads: [{ token, name: "shot.png", mime: "image/png", size: 5 }],
    appRoot: process.cwd(),
  });
  assert.equal(report.diagnostics.failed_capabilities[0].capability, "connect_google_workspace");
  const encoded = JSON.stringify(report.diagnostics);
  assert.doesNotMatch(encoded, /private input|private output|message|prompt|token|secret|oauth/i);
  assert.equal(report.attachments.length, 1);
  assert.equal(existsSync(join(UPLOAD_DIR, token)), true);
});

test("feedback relay retries durable reports and never sends omitted diagnostics", async (t) => {
  const report = feedback.createFeedback({ userId, comment: "No diagnostics", sendDiagnostics: false, uploads: [], appRoot: process.cwd() });
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(String(init.body)));
    return Response.json({ id: sent.at(-1).public_id }, { status: 202 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  await feedback.drainFeedback();
  const relayed = sent.find((payload) => payload.public_id === report.public_id);
  assert.deepEqual(relayed.diagnostics, {});
  assert.equal(q1("SELECT state FROM feedback_reports WHERE public_id=?", report.public_id).state, "delivered");
});

test("feedback rejects oversized attachment boundaries", () => {
  const token = "b".repeat(40);
  writeFileSync(join(UPLOAD_DIR, token), Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.throws(() => feedback.createFeedback({
    userId,
    comment: "large",
    sendDiagnostics: true,
    uploads: [{ token, name: "large.bin", mime: "application/octet-stream", size: 0 }],
    appRoot: process.cwd(),
  }), /5 MB/i);
});

test.after(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});
