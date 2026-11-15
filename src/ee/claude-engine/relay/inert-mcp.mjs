// Inventory only: no effects and no executable tool implementations. Claude Code lists these tools so the model can name them, and a call is always denied
// (1Helm runs every tool itself). Ported from inert_mcp.py in the Nous Research Hermes plugin "claude-subscription-directsdk", MIT License,
// Copyright (c) 2026 Nous Research and contributors (notice in THIRD-PARTY-NOTICES.md).
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let row; try { row = JSON.parse(line); } catch { continue; }
  let result = {};
  if (row.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "onehc-inert-inventory", version: "1" } };
  else if (row.method === "tools/list") result = { tools: manifest };
  else if (row.method === "tools/call") result = { isError: true, content: [{ type: "text", text: "Denied: native tools are inert; only 1Helm executes tools." }] };
  if ("id" in row) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: row.id, result }) + "\n");
}
