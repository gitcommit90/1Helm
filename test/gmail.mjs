import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "1helm-gmail-"));
process.env.CTRL_DATA_DIR = dataDir;
process.env.ONEHELM_GOOGLE_CONNECTION_DIR = join(dataDir, "gmail");
process.env.ONEHELM_GOOGLE_TOKENS_DIR = join(dataDir, "gmail", "tokens");
const gmail = await import("../src/server/gmail.ts");
const exchanges = [];

gmail.setGmailFetchForTests(async (input, init = {}) => {
  const url = String(input);
  if (url === "https://mock.google/token") {
    const body = new URLSearchParams(String(init.body || ""));
    exchanges.push(Object.fromEntries(body));
    if (body.get("grant_type") === "authorization_code") {
      return Response.json({ access_token: "short-lived-access", refresh_token: "durable-refresh", expires_in: 3600, scope: "gmail.readonly gmail.compose" });
    }
    return Response.json({ access_token: "refreshed-access", expires_in: 3600 });
  }
  if (url.endsWith("/gmail/v1/users/me/profile")) {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer short-lived-access");
    return Response.json({ emailAddress: "captain@example.com" });
  }
  if (url.includes("/gmail/v1/users/me/messages?")) return Response.json({ messages: [] });
  throw new Error(`unexpected Gmail fetch ${url}`);
});

const client = {
  installed: {
    client_id: "desktop-client.apps.googleusercontent.com",
    client_secret: "desktop-secret",
    auth_uri: "https://accounts.google.test/o/oauth2/auth",
    token_uri: "https://mock.google/token",
    redirect_uris: ["http://localhost"],
  },
};

test("Gmail missing-client state is a stable connector result, not a retrying tool failure", async () => {
  const status = await gmail.startGmailConnection();
  assert.equal(status.has_oauth_client, false);
  assert.equal(status.setup.status, "needs_client");
  assert.equal(status.setup.active, false);
  assert.match(status.setup.error, /OAuth Desktop app JSON/i);
});

test("Gmail OAuth client validation is fail-closed and status never returns secrets", () => {
  assert.throws(() => gmail.saveGmailOAuthClient({ installed: { client_id: "missing-secret" } }), /valid Google OAuth client JSON/i);
  assert.throws(() => gmail.saveGmailOAuthClient({ web: client.installed }), /Desktop app/i);
  const status = gmail.saveGmailOAuthClient(client);
  assert.equal(status.has_oauth_client, true);
  assert.equal(JSON.stringify(status).includes("desktop-secret"), false);
});

test("Gmail loopback OAuth rejects state mismatch and uses PKCE for a valid callback", async () => {
  let status = await gmail.startGmailConnection();
  let authorization = new URL(status.setup.authorization_url);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.match(authorization.searchParams.get("code_challenge") || "", /^[A-Za-z0-9_-]{43}$/);
  assert.match(authorization.searchParams.get("scope") || "", /gmail\.readonly/);
  assert.match(authorization.searchParams.get("scope") || "", /gmail\.compose/);
  const rejected = await fetch(`${authorization.searchParams.get("redirect_uri")}?code=wrong&state=wrong`);
  assert.equal(rejected.status, 400);
  assert.match(await rejected.text(), /state did not match/i);
  assert.deepEqual(gmail.availableGoogleAccounts(), []);

  status = await gmail.startGmailConnection();
  authorization = new URL(status.setup.authorization_url);
  const callback = new URL(authorization.searchParams.get("redirect_uri"));
  callback.searchParams.set("code", "valid-code");
  callback.searchParams.set("state", authorization.searchParams.get("state"));
  const accepted = await fetch(callback);
  assert.equal(accepted.status, 200);
  assert.match(await accepted.text(), /Gmail connected/i);
  assert.deepEqual(gmail.availableGoogleAccounts(), ["captain@example.com"]);
  assert.equal(exchanges[0].code, "valid-code");
  assert.match(exchanges[0].code_verifier, /^[A-Za-z0-9_-]{64}$/);
  assert.equal(exchanges[0].redirect_uri, authorization.searchParams.get("redirect_uri"));
});

test("Gmail accepts a pasted remote-browser localhost callback without fetching it", async () => {
  const before = exchanges.length;
  const status = await gmail.startGmailConnection();
  const authorization = new URL(status.setup.authorization_url);
  assert.equal(status.setup.manual_completion, true);
  const callback = new URL(authorization.searchParams.get("redirect_uri"));
  callback.searchParams.set("code", "pasted-valid-code");
  callback.searchParams.set("state", authorization.searchParams.get("state"));
  const completed = await gmail.completeGmailConnection(callback.toString());
  assert.equal(completed.setup.status, "connected");
  assert.deepEqual(completed.accounts, ["captain@example.com"]);
  assert.equal(exchanges.length, before + 1, "only Google's token endpoint is called; the pasted localhost URL is never fetched");
  assert.equal(exchanges.at(-1).code, "pasted-valid-code");
  assert.equal(exchanges.at(-1).redirect_uri, authorization.searchParams.get("redirect_uri"));
  await assert.rejects(() => gmail.completeGmailConnection(callback.toString()), /No Gmail authorization is waiting/i);
});

test("connected Gmail inventory and brokered reads never expose tokens", async () => {
  const status = gmail.gmailConnectionStatus();
  assert.deepEqual(status.accounts, ["captain@example.com"]);
  assert.equal(JSON.stringify(status).includes("durable-refresh"), false);
  const result = await gmail.searchGmail("captain@example.com", "newer_than:1d", 5);
  assert.deepEqual(result.results, []);
  const tokenFiles = readdirSync(join(dataDir, "gmail", "tokens"));
  assert.equal(tokenFiles.length, 1);
  const stored = readFileSync(join(dataDir, "gmail", "tokens", tokenFiles[0]), "utf8");
  assert.match(stored, /durable-refresh/);
  assert.equal(JSON.stringify(result).includes("durable-refresh"), false);
});

test.after(() => {
  gmail.stopGmailConnection();
  gmail.setGmailFetchForTests(null);
  rmSync(dataDir, { recursive: true, force: true });
});
