import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dataDir = process.env.CTRL_DATA_DIR;
if (!dataDir) throw new Error("CTRL_DATA_DIR is required");
await writeFile(join(dataDir, "chatgpt-secret"), "test-secret");
await mkdir(join(dataDir, "routing"), { recursive: true });
await writeFile(join(dataDir, "routing", "config.json"), JSON.stringify({
  providers: [{
    id: "prov_chatgpt_test",
    type: "chatgpt",
    name: "ChatGPT",
    enabled: true,
    accessToken: "test-access",
    refreshToken: "test-refresh",
    expiresAt: Date.now() + 60_000,
    models: [{ id: "gpt-5.6", enabled: true }],
  }],
  combos: [],
}));
const dbModule = await import("../src/server/db.ts");
const skills = await import("../src/server/skills.ts");
const bots = await import("../src/server/bots.ts");

const stamp = Date.now();
dbModule.seed();
dbModule.run("INSERT INTO users (username,pass,display,is_admin,created) VALUES ('captain','x','Captain',1,?)", stamp);
dbModule.run("UPDATE channels SET personal_main_owner_id=1,created_by=1 WHERE name='main'");
const main = Number(dbModule.q1("SELECT id FROM channels WHERE name='main'").id);
dbModule.run("INSERT OR IGNORE INTO members (channel_id,user_id) VALUES (?,1)", main);
const providerId = dbModule.run("INSERT INTO providers (name,base_url,api_key,kind,created) VALUES ('Router','http://127.0.0.1:4949/v1','test','routing',?)", stamp).lastInsertRowid;
const skipperBot = dbModule.run("INSERT INTO bots (name,provider_id,model,prompt,avatar,base_url,api_key,created) VALUES ('skipper',?,'gpt-5.6','','','','',?)", providerId, stamp).lastInsertRowid;
const skipper = dbModule.run("INSERT INTO agents (bot_id,kind,name,display_name,status,created) VALUES (?,'skipper','skipper','Skipper','ready',?)", skipperBot, stamp).lastInsertRowid;
dbModule.run("INSERT INTO agent_profiles (agent_id,purpose,instructions,workspace_ref,memory_namespace,capability_policy,updated) VALUES (?,'Chief','Chief','skipper','workspace','{}',?)", skipper, stamp);
dbModule.run("INSERT OR IGNORE INTO bot_channels (bot_id,channel_id) VALUES (?,?)", skipperBot, main);

assert.equal(skills.imageGenerationAvailable(), true);
assert.ok(bots.runtimeToolNamesForChannel(skipperBot, main, true).includes("generate_image"));
assert.equal(dbModule.q1("SELECT COUNT(*) n FROM providers WHERE kind='chatgpt'").n, 0);
assert.equal(dbModule.q1("SELECT COUNT(*) n FROM chatgpt_sessions").n, 0);
assert.equal(dbModule.q1(`SELECT COUNT(*) n FROM agent_skills ask JOIN skills s ON s.id=ask.skill_id WHERE ask.agent_id=? AND s.slug='image-generation'`, skipper).n, 0);

const rootMessage = dbModule.run("INSERT INTO messages (channel_id,user_id,body,created) VALUES (?,1,'generate a pelican',?)", main, stamp).lastInsertRowid;
const reply = dbModule.run("INSERT INTO messages (channel_id,parent_id,bot_id,body,created) VALUES (?,?,?,'Working',?)", main, rootMessage, skipperBot, stamp).lastInsertRowid;
const threadId = dbModule.run("INSERT INTO threads (root_message_id,channel_id,status,title,summary,opened_at,updated_at) VALUES (?,?,'open','pelican','',?,?)", rootMessage, main, stamp, stamp).lastInsertRowid;
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(128, 3)]);
const attachment = await bots.generateAndAttachImage(main, reply, threadId, "A pelican riding a bicycle", "pelican.png", "skipper", async () => png);
assert.equal(attachment.mime, "image/png");
assert.deepEqual(await readFile(join(dataDir, "uploads", String(dbModule.q1("SELECT path FROM attachments WHERE id=?", attachment.id).path))), png);
assert.equal(existsSync(join(dataDir, "channels", String(main), attachment.path)), true);
dbModule.db.close();
