import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
      last = new Error(`HTTP ${response.status}`);
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw last || new Error(`Timed out waiting for ${url}`);
}

async function api(base, path, token, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.body != null && !(options.body instanceof Uint8Array) && !Buffer.isBuffer(options.body)
        ? { "content-type": "application/json" }
        : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body != null && typeof options.body !== "string" && !(options.body instanceof Uint8Array) && !Buffer.isBuffer(options.body)
      ? JSON.stringify(options.body)
      : options.body,
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

test("server sweep seams stay scoped, human-only, Unicode-safe, and least-arsenal", { timeout: 60_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "1helm-sweep-server-"));
  const port = await freePort();
  const token = "captain-sweep-token";
  const logs = [];
  let app;
  try {
    const seeded = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", `
      const db = await import('./src/server/db.ts');
      db.seed();
      const userId = db.run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('captain','unused','Captain',1,?)", db.now()).lastInsertRowid;
      const main = db.q1("SELECT id FROM channels WHERE kind='channel' AND name='main' ORDER BY id LIMIT 1");
      db.run("UPDATE channels SET created_by=?,personal_main_owner_id=? WHERE id=?", userId, userId, main.id);
      db.run("INSERT INTO members (channel_id,user_id) VALUES (?,?)", main.id, userId);
      db.run("UPDATE workspace SET setup_complete=1 WHERE id=1");
      const botId = db.run("INSERT INTO bots (name,provider_id,model,prompt,avatar,base_url,api_key,created) VALUES ('skipper',NULL,'','Workspace-wide chief of staff.','color:#4F6D7A','','',?)", db.now()).lastInsertRowid;
      const agents = await import('./src/server/agents.ts');
      await agents.ensureSkipperAgent(botId, Number(main.id));
      const legacy = await agents.provisionChannel({ name: 'legacy-research', purpose: 'Legacy resident migration fixture.', userId, templateSlug: 'research' });
      for (const skill of db.q("SELECT id FROM skills WHERE status='active' AND slug<>'image-generation'")) {
        db.run("INSERT INTO agent_skills (agent_id,skill_id,provisioned_by,reason,permanent,created) " +
          "VALUES (?,?,NULL,'Part of the safe built-in resident arsenal.',1,?) " +
          "ON CONFLICT(agent_id,skill_id) DO UPDATE SET reason=excluded.reason", legacy.agentId, skill.id, db.now());
      }
      db.run("INSERT INTO sessions (token,user_id,created) VALUES (?,?,?)", ${JSON.stringify(token)}, userId, db.now());
    `], { cwd: ROOT, env: { ...process.env, CTRL_DATA_DIR: dataDir, HELM_CHANNEL_COMPUTER_BACKEND: "native" }, encoding: "utf8" });
    assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout);

    app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/index.ts"], {
      cwd: ROOT,
      env: { ...process.env, CTRL_DATA_DIR: dataDir, PORT: String(port), HELM_HOST: "127.0.0.1", HELM_CHANNEL_COMPUTER_BACKEND: "native" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    app.stdout.on("data", (chunk) => logs.push(chunk.toString()));
    app.stderr.on("data", (chunk) => logs.push(chunk.toString()));
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/api/setup/status`);

    const crew = await api(base, "/api/admin/users", token, { method: "POST", body: { username: "crew", display: "Crew Member", password: "crew-password" } });
    assert.equal(crew.status, 201);
    const crewLogin = await api(base, "/api/auth/login", "", { method: "POST", body: { username: "crew", password: "crew-password" } });
    assert.equal(crewLogin.status, 200);
    const crewToken = crewLogin.body.token;

    const createdHuman = await api(base, "/api/human-channels", token, {
      method: "POST",
      body: { name: "Launch Room", purpose: "Coordinate the humans only.", member_ids: [crew.body.user.id] },
    });
    assert.equal(createdHuman.status, 201);
    assert.equal(createdHuman.body.channel.kind, "human");
    assert.equal(createdHuman.body.channel.agent, null);
    assert.equal(createdHuman.body.channel.computer, null);
    assert.deepEqual(createdHuman.body.channel.members.map((member) => member.username), ["captain", "crew"]);

    const db = new DatabaseSync(join(dataDir, "ctrl-pane.db"));
    const humanId = Number(createdHuman.body.channel.id);
    assert.deepEqual(db.prepare("SELECT user_id FROM members WHERE channel_id=? ORDER BY user_id").all(humanId).map((row) => Number(row.user_id)), [1, Number(crew.body.user.id)]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_channels WHERE channel_id=?").get(humanId).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM channel_computers WHERE channel_id=?").get(humanId).n, 0);
    const crewHuman = (await api(base, "/api/channels", crewToken)).body.channels.find((channel) => channel.id === humanId);
    assert.deepEqual(crewHuman.members.map((member) => member.username), ["captain", "crew"]);

    const favorite = await api(base, `/api/channels/${humanId}/favorite`, token, { method: "POST", body: { favorite: true } });
    assert.equal(favorite.status, 200);
    assert.equal(favorite.body.channel.favorite, true);
    assert.equal((await api(base, "/api/channels", token)).body.channels.find((channel) => channel.id === humanId).favorite, true);
    assert.equal((await api(base, "/api/channels", crewToken)).body.channels.find((channel) => channel.id === humanId).favorite, false);
    assert.equal((await api(base, `/api/channels/${humanId}/favorite`, token, { method: "DELETE" })).body.favorite, false);

    const emojiName = "🧭".repeat(101);
    const renamed = await api(base, "/api/workspace", token, { method: "PATCH", body: { name: emojiName, theme: "graphite" } });
    assert.equal(renamed.status, 200);
    assert.equal(Array.from(renamed.body.workspace.name).length, 100);
    assert.throws(() => db.prepare("UPDATE workspace SET name=? WHERE id=1").run(emojiName), /100 Unicode code points/);

    const project = await api(base, "/api/channels", token, { method: "POST", body: { name: "sweep-project", purpose: "Verify the sweep integration seams.", template: "project" } });
    assert.equal(project.status, 201);
    const channelId = Number(project.body.channel.id);
    assert.deepEqual(project.body.channel.members.map((member) => member.username), ["captain"]);

    const createdNote = await api(base, `/api/channels/${channelId}/notes`, token, { method: "POST", body: { name: "plan.md", content: "# Plan" } });
    assert.equal(createdNote.status, 201);
    assert.equal((await api(base, `/api/channels/${channelId}/notes/plan.md`, token)).body.note.content, "# Plan");
    const savedNote = await api(base, `/api/channels/${channelId}/notes/plan.md`, token, { method: "PATCH", body: { content: "# Updated" } });
    assert.equal(savedNote.body.note.content, "# Updated");
    const renamedNote = await api(base, `/api/channels/${channelId}/notes/plan.md`, token, { method: "PATCH", body: { name: "launch.md" } });
    assert.equal(renamedNote.body.note.name, "launch.md");
    assert.equal((await api(base, `/api/channels/${channelId}/notes`, token)).body.notes[0].name, "launch.md");
    assert.equal((await api(base, `/api/channels/${channelId}/notes`, crewToken)).status, 403);

    const folder = await api(base, `/api/channels/${channelId}/files/directories`, token, { method: "POST", body: { path: "", name: "briefs" } });
    assert.equal(folder.status, 201);
    const rawUpload = await fetch(`${base}/api/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain", "x-filename": "brief.txt" },
      body: "bounded file",
    });
    const upload = await rawUpload.json();
    const imported = await api(base, `/api/channels/${channelId}/files/upload`, token, { method: "POST", body: { ...upload, path: "briefs" } });
    assert.equal(imported.status, 201);
    assert.equal(imported.body.path, "workspace/briefs/brief.txt");
    const listing = await api(base, `/api/channels/${channelId}/files?path=briefs`, token);
    assert.deepEqual(listing.body.files.map((file) => file.name), ["brief.txt"]);
    assert.equal((await api(base, `/api/channels/${channelId}/files/refresh`, token, { method: "POST" })).status, 200);
    assert.equal((await api(base, `/api/channels/${channelId}/files/refresh`, crewToken, { method: "POST" })).status, 403);
    const opened = await fetch(`${base}/api/channels/${channelId}/files/content?path=briefs%2Fbrief.txt`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(await opened.text(), "bounded file");
    assert.equal((await api(base, `/api/channels/${channelId}/files/entries`, token, { method: "POST", body: { parent: "briefs", name: "launch.md", content: "# Launch\n\n**Ready** for review.\n\n- First step" } })).status, 201);
    const docx = await fetch(`${base}/api/channels/${channelId}/files/docx?path=briefs%2Flaunch.md`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(docx.status, 200);
    assert.equal(docx.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.match(docx.headers.get("content-disposition") || "", /attachment; filename\*=UTF-8''launch\.docx/);
    const docxBytes = Buffer.from(await docx.arrayBuffer());
    assert.equal(docxBytes.subarray(0, 2).toString(), "PK", "DOCX is an Office Open XML ZIP, not renamed Markdown");
    const docxPath = join(dataDir, "launch.docx"); writeFileSync(docxPath, docxBytes);
    const documentXml = spawnSync("unzip", ["-p", docxPath, "word/document.xml"], { encoding: "utf8" });
    assert.equal(documentXml.status, 0, documentXml.stderr);
    assert.match(documentXml.stdout, /Launch/); assert.match(documentXml.stdout, /Ready/); assert.match(documentXml.stdout, /First step/);
    assert.equal((await api(base, `/api/channels/${channelId}/files/docx?path=briefs%2Fbrief.txt`, token)).status, 400);
    assert.equal((await api(base, `/api/channels/${channelId}/files/docx?path=briefs%2Flaunch.md`, crewToken)).status, 403);
    assert.equal((await api(base, `/api/channels/${channelId}/files/directories`, token, { method: "POST", body: { path: "../", name: "escape" } })).status, 400);

    const catalog = await api(base, "/api/skills", token);
    const residentSkills = await api(base, `/api/agents/${project.body.channel.agent.id}/skills`, token);
    const main = (await api(base, "/api/channels", token)).body.channels.find((channel) => channel.personal_main);
    const skipperSkills = await api(base, `/api/agents/${main.agent.id}/skills`, token);
    const residentSlugs = new Set(residentSkills.body.skills.map((skill) => skill.slug));
    const availableCatalog = catalog.body.skills.filter((skill) => !skill.arsenal_locked);
    assert.ok(residentSlugs.has("outcome-ownership") && residentSlugs.has("project-planning"));
    assert.equal(residentSlugs.has("research"), false);
    assert.ok(residentSkills.body.skills.length < availableCatalog.length);
    assert.equal(skipperSkills.body.skills.length, availableCatalog.length);
    assert.equal(db.prepare("SELECT template_slug FROM agents WHERE id=?").get(project.body.channel.agent.id).template_slug, "project");
    const legacy = (await api(base, "/api/channels", token)).body.channels.find((channel) => channel.name === "legacy-research");
    const migratedSkills = await api(base, `/api/agents/${legacy.agent.id}/skills`, token);
    const migratedSlugs = new Set(migratedSkills.body.skills.map((skill) => skill.slug));
    assert.ok(migratedSlugs.has("research") && migratedSlugs.has("browser-operations"));
    assert.equal(migratedSlugs.has("email-operations"), false);
    assert.equal(db.prepare("SELECT template_slug FROM agents WHERE id=?").get(legacy.agent.id).template_slug, "research");
    db.close();
  } catch (error) {
    error.message += `\nServer logs:\n${logs.join("").slice(-12_000)}`;
    throw error;
  } finally {
    if (app && app.exitCode == null) {
      app.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => app.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      if (app.exitCode == null) app.kill("SIGKILL");
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
