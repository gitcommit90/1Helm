import assert from "node:assert/strict";
import test from "node:test";

const worker = (await import("../cloudflare/src/worker.ts")).default;

class Registry {
  rows = new Map();

  prepare(sql) {
    const registry = this;
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() {
        if (/COUNT\(\*\) AS total/i.test(sql)) return { total: registry.rows.size };
        if (/WHERE installation_id=\?/i.test(sql)) return [...registry.rows.values()].find((row) => row.installation_id === this.values[0]) || null;
        if (/WHERE slug=\?/i.test(sql)) {
          const row = registry.rows.get(this.values[0]);
          return /SELECT 1 FROM/i.test(sql) ? (row ? { 1: 1 } : null) : row || null;
        }
        return null;
      },
      async run() {
        if (/INSERT INTO workspaces/i.test(sql)) {
          const [slug, hostname, installationId, workspaceName, secretHash, created, updated, limit] = this.values;
          if (registry.rows.has(slug) || [...registry.rows.values()].some((row) => row.installation_id === installationId)) throw new Error("UNIQUE constraint failed");
          if (registry.rows.size >= Number(limit)) return { success: true, meta: { changes: 0 } };
          registry.rows.set(slug, {
            slug, hostname, installation_id: installationId, workspace_name: workspaceName,
            management_secret_hash: secretHash, tunnel_id: "", connector_secret_cipher: "",
            status: "provisioning", enabled: 1, error: "", created_at: created, updated_at: updated,
          });
        } else if (/UPDATE workspaces SET tunnel_id=/i.test(sql)) {
          const [tunnelId, cipher, updated, slug] = this.values;
          Object.assign(registry.rows.get(slug), { tunnel_id: tunnelId, connector_secret_cipher: cipher, status: "active", error: "", updated_at: updated });
        } else if (/UPDATE workspaces SET enabled=/i.test(sql)) {
          const [enabled, updated, slug] = this.values;
          Object.assign(registry.rows.get(slug), { enabled, updated_at: updated });
        } else if (/DELETE FROM workspaces/i.test(sql)) {
          const [slug] = this.values;
          if (registry.rows.get(slug)?.status === "provisioning") registry.rows.delete(slug);
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
  }
}

const env = (registry) => ({
  REGISTRY: registry,
  CLOUDFLARE_ACCOUNT_ID: "account-test",
  CLOUDFLARE_ZONE_ID: "zone-test",
  CLOUDFLARE_RUNTIME_TOKEN: "runtime-test",
  PROVISION_LIMIT: { limit: async () => ({ success: true }) },
  FEEDBACK_LIMIT: { limit: async () => ({ success: true }) },
  FEEDBACK_ADMIN_TOKEN: "feedback-admin-test",
});
const request = (path, init) => new Request(`https://provision.1helm.com${path}`, init);
const body = async (response) => ({ status: response.status, json: await response.json() });

test("workspace provisioner validates slugs, reserves atomically, and is idempotent per installation", async (t) => {
  const registry = new Registry();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    if (String(url).endsWith("/cfd_tunnel")) return Response.json({ success: true, result: { id: "tunnel-1" } });
    if (String(url).endsWith("/dns_records")) return Response.json({ success: true, result: { id: "dns-1" } });
    throw new Error(`Unexpected Cloudflare call ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const tooShort = await body(await worker.fetch(request("/v1/slugs/a"), env(registry)));
  const reserved = await body(await worker.fetch(request("/v1/slugs/demo"), env(registry)));
  const available = await body(await worker.fetch(request("/v1/slugs/acme"), env(registry)));
  assert.deepEqual([tooShort.json.available, reserved.json.available, available.json.available], [false, false, true]);
  assert.equal(available.json.hostname, "acme.1helm.com");

  const secret = "a".repeat(64);
  const claimInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "acme", installation_id: "0123456789abcdef", workspace_name: "Acme", management_secret: secret }) };
  const claimed = await body(await worker.fetch(request("/v1/workspaces", claimInit), env(registry)));
  assert.equal(claimed.status, 201);
  assert.equal(claimed.json.workspace.hostname, "acme.1helm.com");
  assert.equal(claimed.json.connector.tunnel_id, "tunnel-1");
  assert.equal(calls.length, 2, "one tunnel and one exact DNS record are created");

  const repeated = await body(await worker.fetch(request("/v1/workspaces", claimInit), env(registry)));
  assert.equal(repeated.status, 200);
  assert.equal(repeated.json.existing, true);
  assert.equal(repeated.json.connector.tunnel_secret, claimed.json.connector.tunnel_secret, "the owning installation can recover its encrypted connector credential");
  assert.equal(calls.length, 2, "idempotent retry does not create another tunnel or DNS record");

  const collision = await body(await worker.fetch(request("/v1/workspaces", { ...claimInit, body: JSON.stringify({ slug: "acme", installation_id: "fedcba9876543210", workspace_name: "Other", management_secret: "b".repeat(64) }) }), env(registry)));
  assert.equal(collision.status, 409);
  assert.match(collision.json.error, /already taken/i);

  const disabled = await body(await worker.fetch(request("/v1/workspaces/acme", { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) }), env(registry)));
  assert.equal(disabled.status, 200);
  assert.equal(disabled.json.workspace.enabled, false);
  assert.equal(registry.rows.get("acme").enabled, 0, "turning collaboration off retains the reserved row");
});

test("workspace provisioner removes the exact partial tunnel and reservation after DNS failure", async (t) => {
  const registry = new Registry();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    if (String(url).endsWith("/cfd_tunnel") && (init.method || "GET") === "POST") return Response.json({ success: true, result: { id: "tunnel-failed" } });
    if (String(url).endsWith("/dns_records")) return Response.json({ success: false, errors: [{ message: "DNS unavailable" }] }, { status: 503 });
    if (String(url).endsWith("/cfd_tunnel/tunnel-failed") && init.method === "DELETE") return Response.json({ success: true, result: {} });
    throw new Error(`Unexpected Cloudflare call ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const failed = await body(await worker.fetch(request("/v1/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "retryable", installation_id: "0011223344556677", workspace_name: "Retryable", management_secret: "c".repeat(64) }) }), env(registry)));
  assert.equal(failed.status, 502);
  assert.match(failed.json.error, /DNS unavailable/);
  assert.equal(registry.rows.has("retryable"), false, "failed provisioning releases the D1 reservation");
  assert.ok(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/cfd_tunnel/tunnel-failed")), "the exact partial tunnel is cleaned up");
});

test("workspace provisioner rejects rate-limited claims before reserving or calling Cloudflare", async (t) => {
  const registry = new Registry();
  const originalFetch = globalThis.fetch;
  let cloudflareCalls = 0;
  globalThis.fetch = async () => {
    cloudflareCalls++;
    throw new Error("Cloudflare must not be called for a rate-limited claim");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const limitedEnv = {
    ...env(registry),
    PROVISION_LIMIT: { limit: async () => ({ success: false }) },
  };
  const response = await body(await worker.fetch(request("/v1/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.10" },
    body: JSON.stringify({ slug: "limited", installation_id: "0011223344556677", workspace_name: "Limited", management_secret: "d".repeat(64) }),
  }), limitedEnv));

  assert.equal(response.status, 429);
  assert.match(response.json.error, /too many/i);
  assert.equal(registry.rows.size, 0, "a rate-limited claim creates no D1 reservation");
  assert.equal(cloudflareCalls, 0, "a rate-limited claim creates no tunnel or DNS record");
});

test("workspace provisioner rejects the atomic reservation when the beta is full", async (t) => {
  const registry = new Registry();
  for (let index = 0; index < 1000; index++) {
    registry.rows.set(`existing-${index}`, {
      slug: `existing-${index}`,
      hostname: `existing-${index}.1helm.com`,
      installation_id: index.toString(16).padStart(16, "0"),
      workspace_name: `Existing ${index}`,
      management_secret_hash: "existing",
      tunnel_id: `tunnel-${index}`,
      connector_secret_cipher: "existing",
      status: "active",
      enabled: 1,
      error: "",
      created_at: index,
      updated_at: index,
    });
  }
  const originalFetch = globalThis.fetch;
  let cloudflareCalls = 0;
  globalThis.fetch = async () => {
    cloudflareCalls++;
    throw new Error("Cloudflare must not be called after a full-beta reservation rejection");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await body(await worker.fetch(request("/v1/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "overflow", installation_id: "abcdef0123456789", workspace_name: "Overflow", management_secret: "e".repeat(64) }),
  }), env(registry)));

  assert.equal(response.status, 503);
  assert.match(response.json.error, /beta is currently full/i);
  assert.equal(registry.rows.size, 1000, "the rejected claim creates no row");
  assert.equal(registry.rows.has("overflow"), false);
  assert.equal(cloudflareCalls, 0, "the rejected claim creates no tunnel or DNS record");
});

test("feedback collector validates, deduplicates, bounds attachments, and keeps its inbox admin-only", async () => {
  class FeedbackRegistry extends Registry {
    feedback = new Map();
    attachments = [];
    prepare(sql) {
      if (/feedback_reports/i.test(sql) || /feedback_attachments/i.test(sql)) {
        const registry = this;
        return {
          values: [],
          bind(...values) { this.values = values; return this; },
          async first() {
            if (/SELECT 1 FROM feedback_attachments/i.test(sql)) {
              return registry.attachments.some((item) => item.report_id === this.values[0]) ? { 1: 1 } : null;
            }
            return null;
          },
          async run() {
            if (/INSERT OR IGNORE INTO feedback_reports/i.test(sql)) {
              const [publicId, installationId, workspaceName, comment, diagnostics, attachmentCount, createdAt, receivedAt] = this.values;
              if (!registry.feedback.has(publicId)) registry.feedback.set(publicId, {
                public_id: publicId,
                installation_id: installationId,
                workspace_name: workspaceName,
                comment,
                diagnostics,
                attachment_count: attachmentCount,
                created_at: createdAt,
                received_at: receivedAt,
              });
            } else if (/INSERT INTO feedback_attachments/i.test(sql)) {
              const [reportId, name, mime, size, data, createdAt] = this.values;
              registry.attachments.push({ report_id: reportId, name, mime, size, data, created_at: createdAt });
            }
            return { success: true, meta: { changes: 1 } };
          },
          async all() { return { results: [...registry.feedback.values()] }; },
        };
      }
      return super.prepare(sql);
    }
  }
  const registry = new FeedbackRegistry();
  const payload = {
    public_id: `fb_${"a".repeat(24)}`,
    installation_id: "0123456789abcdef",
    workspace_name: "Test",
    comment: "A broken thing",
    diagnostics: { version: "0.0.5", failed_capabilities: [{ capability: "connect_google_workspace", status: "failed" }] },
    attachments: [{ name: "shot.png", mime: "image/png", size: 3, data: "YWJj" }],
  };
  const intake = await body(await worker.fetch(request("/v1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), env(registry)));
  assert.equal(intake.status, 202);
  assert.equal(registry.feedback.size, 1);
  assert.equal(registry.attachments.length, 1);
  await worker.fetch(request("/v1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), env(registry));
  assert.equal(registry.feedback.size, 1);
  assert.equal(registry.attachments.length, 1, "idempotent retry stores no duplicate attachment");
  assert.equal((await worker.fetch(request("/v1/feedback"), env(registry))).status, 404);
  const inbox = await body(await worker.fetch(request("/v1/feedback", {
    headers: { authorization: "Bearer feedback-admin-test" },
  }), env(registry)));
  assert.equal(inbox.status, 200);
  assert.equal(inbox.json.reports.length, 1);
  const oversized = await worker.fetch(request("/v1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, public_id: `fb_${"b".repeat(24)}`, attachments: [{ name: "huge", size: 6 * 1024 * 1024, data: "x" }] }),
  }), env(registry));
  assert.equal(oversized.status, 413);
  const dishonestSize = await worker.fetch(request("/v1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, public_id: `fb_${"c".repeat(24)}`, attachments: [{ name: "mismatch", size: 0, data: "YWJj" }] }),
  }), env(registry));
  assert.equal(dishonestSize.status, 413, "the collector bounds decoded bytes rather than trusting caller-supplied sizes");
});
