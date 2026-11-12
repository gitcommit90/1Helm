#!/usr/bin/env node
// First install in an operator-owned Cloudflare account. Never run this in 1HC's account.
import { createInterface } from "node:readline/promises";
import { randomBytes, webcrypto } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = process.env.ONEHELM_WRANGLER_BIN || join(root, "node_modules/.bin/wrangler");
const npm = process.env.ONEHELM_NPM_BIN || "npm";
const docker = process.env.ONEHELM_DOCKER_BIN || "docker";
const configFile = join(root, "wrangler.jsonc");
const run = (cmd, args, { input, capture = false } = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, input, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : input === undefined ? "inherit" : ["pipe", "inherit", "inherit"], env: process.env });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed${capture && r.stderr ? `: ${r.stderr.trim().slice(0, 300)}` : ""}`);
  return capture ? r.stdout : "";
};
const validName = (s) => /^[a-z][a-z0-9-]{1,40}[a-z0-9]$/.test(s);
const validEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const uuid = (s) => /^[0-9a-f]{32}$|^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
const pathExists = (path) => { try { lstatSync(path); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } };
const ask = async (rl, question, fallback = "") => {
  if (!process.stdin.isTTY) {
    if (!fallback) throw new Error(`${question} must be supplied as an environment default when setup has no terminal.`);
    return fallback;
  }
  return (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback;
};

async function main() {
  if (pathExists(configFile)) throw new Error("wrangler.jsonc already exists. Use npm run deploy for upgrades; setup only creates a new install.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let name, host, sender, support, account;
  try {
    name = await ask(rl, "Worker name (also used for D1 and R2)", process.env.ONEHELM_WORKER_NAME || "onehelm-personal");
    host = (await ask(rl, `Full workers.dev host for ${name} (no https://)`, process.env.ONEHELM_APP_HOST || "")).toLowerCase();
    sender = await ask(rl, "Verified Cloudflare Email sender address", process.env.ONEHELM_EMAIL_FROM || "");
    support = await ask(rl, "Support email shown in your app", process.env.ONEHELM_SUPPORT_EMAIL || sender);
    account = await ask(rl, "Cloudflare account ID (32 hex characters)", process.env.CLOUDFLARE_ACCOUNT_ID || "");
  } finally { rl.close(); }
  if (!validName(name)) throw new Error("Worker name must be 3–42 lowercase letters, numbers and dashes, starting with a letter and ending with a letter or number.");
  const hostParts = host.split(".");
  if (hostParts.length !== 4 || hostParts[0] !== name || hostParts[2] !== "workers" || hostParts[3] !== "dev" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostParts[1]))
    throw new Error(`Host must be the full ${name}.<your-subdomain>.workers.dev hostname.`);
  if (!validEmail(sender) || !validEmail(support)) throw new Error("Enter valid sender and support email addresses.");
  if (!/^[0-9a-f]{32}$/i.test(account)) throw new Error("Enter the 32-character Cloudflare account ID from the dashboard.");
  process.env.CLOUDFLARE_ACCOUNT_ID = account;
  const recoveryDir = process.env.ONEHELM_RECOVERY_DIR || join(homedir(), ".config", "onehelm");
  const recoveryFile = join(recoveryDir, `${name}-recovery.json`);
  if (pathExists(recoveryFile)) throw new Error(`Recovery file already exists at ${recoveryFile}. Use a different Worker name or inspect the existing installation before retrying.`);

  console.log("Checking local build requirements and Cloudflare login…");
  run(docker, ["info"], { capture: true });
  run(npm, ["ci", "--prefix", "web"]);
  run(process.execPath, ["scripts/check-migrations.mjs"]);
  run(wrangler, ["whoami"]);

  const dbName = `${name}-db`, bucket = `${name}-files`;
  // A fresh name prevents accidentally selecting an existing database or bucket.
  console.log(`Creating D1 ${dbName} and R2 ${bucket}…`);
  run(wrangler, ["d1", "create", dbName]);
  const list = JSON.parse(run(wrangler, ["d1", "list", "--json"], { capture: true }));
  const matches = (Array.isArray(list) ? list : list.result || []).filter((x) => x.name === dbName);
  const dbId = matches.length === 1 ? matches[0].uuid || matches[0].id : "";
  if (!uuid(dbId)) throw new Error("D1 was created, but its ID could not be verified. Find it with wrangler d1 list --json before retrying manually.");
  run(wrangler, ["r2", "bucket", "create", bucket]);

  const template = readFileSync(join(root, "wrangler.example.jsonc"), "utf8");
  const configured = template.replace(/^(\s*\{)/, `$1\n  "account_id": "${account}",`)
    .replace('"name": "onehelm"', `"name": ${JSON.stringify(name)}`)
    .replaceAll("REPLACE_WITH_YOUR_D1_DATABASE_ID", dbId)
    .replaceAll("REPLACE_WITH_YOUR_R2_BUCKET_NAME", bucket)
    .replaceAll('"REPLACE_WITH_YOUR_WORKERS_DEV_HOST"', JSON.stringify(host))
    .replaceAll('"REPLACE_WITH_YOUR_VERIFIED_SENDER_EMAIL"', JSON.stringify(sender))
    .replace('"SENTINEL_DEFAULT": "on"', `"SUPPORT_EMAIL": ${JSON.stringify(support)},\n    "SENTINEL_DEFAULT": "on"`);
  if (configured.includes("REPLACE_WITH_")) throw new Error("The Wrangler template has an unfilled placeholder.");
  writeFileSync(configFile, configured, { flag: "wx", mode: 0o600 });
  console.log("Wrote private wrangler.jsonc. Creating encrypted vault and Web Push keys…");
  const key = randomBytes(32).toString("base64");
  const backupToken = randomBytes(32).toString("base64url");
  const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = Buffer.from(await webcrypto.subtle.exportKey("raw", kp.publicKey)).toString("base64url");
  const priv = (await webcrypto.subtle.exportKey("jwk", kp.privateKey)).d;
  console.log("Applying the fresh schema, building the app, and deploying…");
  run(wrangler, ["d1", "migrations", "apply", "DB", "--remote"]);
  run(process.execPath, ["web/build.mjs"]);
  mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  writeFileSync(recoveryFile, JSON.stringify({ VAULT_KEY: key, VAPID_PUBLIC: pub, VAPID_PRIVATE: priv, BACKUP_TOKEN: backupToken }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`Recovery secrets saved outside the repo at ${recoveryFile}. Keep an encrypted offline copy.`);
  run(wrangler, ["deploy", "--secrets-file", recoveryFile]);
  console.log(`1Helm is deployed at https://${host}/. Open that address to claim the single owner account, then add your AI provider key in Settings.`);
}

main().catch((e) => { console.error(`Setup stopped: ${e.message}`); process.exitCode = 1; });
