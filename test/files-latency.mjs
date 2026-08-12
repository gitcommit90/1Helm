import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("Files directory reads stay responsive while an explicit VM refresh is slow", async (t) => {
  const testRoot = mkdtempSync(join(tmpdir(), "1helm-files-latency-"));
  t.after(() => rmSync(testRoot, { recursive: true, force: true }));
  const dataDir = join(testRoot, "data");
  const fakeState = join(testRoot, "fake-state");
  const fakeCli = join(testRoot, "container");
  await mkdir(fakeState, { recursive: true });
  await writeFile(fakeCli, `#!/bin/sh\nexec "${process.execPath}" "${join(root, "test", "fake-container.mjs")}" "$@"\n`, { mode: 0o700 });
  await chmod(fakeCli, 0o700);

  process.env.CTRL_DATA_DIR = dataDir;
  process.env.HELM_CHANNEL_COMPUTER_BACKEND = "apple";
  process.env.HELM_CONTAINER_CLI = fakeCli;
  process.env.FAKE_CONTAINER_STATE = fakeState;
  process.env.HELM_FLEET_INTERVAL_MS = "600000";
  process.env.HELM_FLEET_INITIAL_MS = "600000";

  const db = await import("../src/server/db.ts");
  db.seed();
  const agents = await import("../src/server/agents.ts");
  const computers = await import("../src/server/channel-computers.ts");
  const userId = db.run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('captain','x','Captain',1,?)", Date.now()).lastInsertRowid;
  db.run("INSERT INTO providers (name,base_url,api_key,kind,created) VALUES ('test','http://127.0.0.1','x','openai',?)", Date.now());
  const provisioned = await agents.provisionChannel({ name: "latency", purpose: "Prove cached Files navigation.", userId });
  const store = await import("../src/server/store.ts");
  db.run("UPDATE users SET avatar=? WHERE id=?", `data:image/png;base64,${"a".repeat(30_000)}`, userId);
  const messageId = store.createMessage({ channelId: provisioned.channelId, parentId: null, userId, body: "Compact navigation payload" });
  assert.equal(Object.hasOwn(store.serializeMessage(messageId).author, "avatar"), false, "message history references the already-loaded user record instead of repeating its avatar per message");
  db.run("INSERT INTO artifacts (channel_id,path,kind,created_by,created) VALUES (?,?, 'file','agent',?)", provisioned.channelId, "workspace/node_modules/dependency.js", Date.now());
  db.run("INSERT INTO artifacts (channel_id,path,kind,created_by,created) VALUES (?,?, 'file','agent',?)", provisioned.channelId, "workspace/attached.md", Date.now());
  db.run("INSERT INTO artifacts (channel_id,path,kind,created_by,created) VALUES (?,?, 'upload','user',?)", provisioned.channelId, "files/upload.txt", Date.now());
  db.run("INSERT INTO attachments (message_id,name,mime,size,path,workspace_path) VALUES (?,?,?,?,?,?)", messageId, "attached.md", "text/markdown", 7, "token", "workspace/attached.md");
  db.migrate();
  assert.equal(db.q1("SELECT COUNT(*) n FROM artifacts WHERE channel_id=? AND path='workspace/node_modules/dependency.js'", provisioned.channelId).n, 0, "upgrade migration removes recursively indexed workspace internals");
  assert.equal(db.q1("SELECT COUNT(*) n FROM artifacts WHERE channel_id=? AND path IN ('workspace/attached.md','files/upload.txt')", provisioned.channelId).n, 2, "upgrade migration preserves explicit attachments and uploads");
  const computer = await computers.provisionChannelComputer(provisioned.channelId);
  agents.createWorkspaceFile(provisioned.channelId, "", "cached.txt", "cached");
  agents.createWorkspaceDirectory(provisioned.channelId, "", "large-project");
  agents.createWorkspaceDirectory(provisioned.channelId, "large-project", "node_modules");
  agents.createWorkspaceDirectory(provisioned.channelId, "large-project/node_modules", "dependency");
  const navigation = agents.listWorkspaceDirectories(provisioned.channelId);
  assert.ok(navigation.some((entry) => entry.path === "large-project/node_modules"), "the navigation rail includes one useful nested level");
  assert.equal(navigation.some((entry) => entry.path === "large-project/node_modules/dependency"), false, "the navigation rail never recursively walks an unbounded dependency tree");
  await computers.ensureChannelComputerRunning(provisioned.channelId, "latency fixture");
  writeFileSync(join(fakeState, "machines", computer.machine_id, "workspace", "guest-only.txt"), "guest");

  // Make the guest tar export observably slow. Cached listing must remain a
  // local host operation while one coalesced refresh runs in the background.
  process.env.FAKE_CONTAINER_EXPORT_DELAY_MS = "900";
  const refreshOne = computers.refreshChannelWorkspaceMirror(provisioned.channelId);
  const refreshTwo = computers.refreshChannelWorkspaceMirror(provisioned.channelId);
  const started = performance.now();
  const cached = agents.listWorkspaceDirectory(provisioned.channelId, "");
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 150, `cached Files listing took ${elapsed.toFixed(1)}ms`);
  assert.ok(cached.files.some((entry) => entry.name === "cached.txt"));
  await Promise.all([refreshOne, refreshTwo]);
  assert.ok(agents.listWorkspaceDirectory(provisioned.channelId, "").files.some((entry) => entry.name === "guest-only.txt"));

  const server = await readFile(join(root, "src", "server", "index.ts"), "utf8");
  const filesRoute = server.slice(server.indexOf('if (action === "files"'), server.indexOf('if (action === "memory"'));
  assert.doesNotMatch(filesRoute, /syncWorkspaceArtifacts|SELECT \* FROM artifacts/, "Files navigation never writes or returns the entire workspace artifact table");
});
