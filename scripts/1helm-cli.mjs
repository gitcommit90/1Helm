#!/usr/bin/env node
import { readFileSync } from "node:fs";

function die(message, details) {
  process.stdout.write(JSON.stringify({ ok: false, error: message, details: details || null }) + "\n");
  process.exit(1);
}
const args = process.argv.slice(2);
const command = args.shift() || "help";
const base = String(process.env.HELM_URL || "http://127.0.0.1:8123").replace(/\/+$/, "");
const token = String(process.env.HELM_TOKEN || "");
const option = (name, fallback = "") => { const index = args.indexOf(name); return index >= 0 ? String(args[index + 1] ?? "") : fallback; };
const input = () => { const path = option("--input"); if (path) return JSON.parse(readFileSync(path, "utf8")); if (!process.stdin.isTTY) return JSON.parse(readFileSync(0, "utf8") || "{}"); return {}; };
async function api(path, init = {}) {
  const response = await fetch(base + path, { ...init, headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) die(body.error || `HTTP ${response.status}`, { status: response.status, path });
  return body;
}
if (command === "help") {
  process.stdout.write(JSON.stringify({ ok: true, commands: ["status", "channels", "message", "workflows", "workflow-create", "workflow-status", "audit-verify"], environment: { HELM_URL: base, HELM_TOKEN: "required except status" }, input: "Use --input file.json or JSON on stdin for mutation commands." }) + "\n");
  process.exit(0);
}
if (command !== "status" && !token) die("HELM_TOKEN is required for this command.");
let result;
if (command === "status") result = await api("/api/setup/status");
else if (command === "channels") result = await api("/api/channels");
else if (command === "message") { const data = input(); if (!data.channel_id || !data.body) die("message requires channel_id and body."); result = await api(`/api/channels/${Number(data.channel_id)}/messages`, { method: "POST", body: JSON.stringify({ body: String(data.body), parentId: data.parent_id == null ? undefined : Number(data.parent_id) }) }); }
else if (command === "workflows") result = await api(`/api/workflows${option("--channel") ? `?channel_id=${encodeURIComponent(option("--channel"))}` : ""}`);
else if (command === "workflow-create") result = await api("/api/workflows", { method: "POST", body: JSON.stringify(input()) });
else if (command === "workflow-status") { const data = input(); if (!data.workflow_id || !data.channel_id || !data.status) die("workflow-status requires workflow_id, channel_id, and status."); result = await api(`/api/workflows/${Number(data.workflow_id)}`, { method: "PATCH", body: JSON.stringify(data) }); }
else if (command === "audit-verify") result = await api("/api/audit/verify");
else die(`Unknown command: ${command}`);
process.stdout.write(JSON.stringify({ ok: true, command, result }) + "\n");
