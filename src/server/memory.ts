import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, q1, type Row } from "./db.ts";

const BRIDGE = join(process.cwd(), "scripts", "mnemosyne-bridge.py");
const CONFIG_DIR = join(DATA_DIR, "mnemosyne-runtime", "config");

function pythonRuntime(): string | null {
  const candidates = [
    process.env.MNEMOSYNE_PYTHON || "",
    join(DATA_DIR, "mnemosyne-runtime", "venv", "bin", "python"),
    join(process.cwd(), "data-refactored", "mnemosyne-runtime", "venv", "bin", "python"),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

export function memoryPathForAgent(agent: Row): string {
  if (String(agent.kind) === "skipper") return join(DATA_DIR, "skipper", "memory", "mnemosyne.db");
  const channelId = Number(agent.channel_id || q1("SELECT channel_id FROM agent_channels WHERE agent_id=?", agent.id)?.channel_id || 0);
  if (!channelId) throw new Error("Channel agent has no memory namespace.");
  return join(DATA_DIR, "channels", String(channelId), "memory", "mnemosyne.db");
}

function invoke(agent: Row, request: Record<string, unknown>): Record<string, unknown> | null {
  const python = pythonRuntime();
  if (!python || !existsSync(BRIDGE)) return null;
  const dbPath = memoryPathForAgent(agent);
  mkdirSync(join(dbPath, ".."), { recursive: true });
  mkdirSync(CONFIG_DIR, { recursive: true });
  try {
    const output = execFileSync(python, [BRIDGE], {
      input: JSON.stringify({
        ...request,
        db_path: dbPath,
        session_id: request.session_id || `agent:${agent.id}`,
        author_id: request.author_id || String(agent.id),
        author_type: request.author_type || (String(agent.kind) === "skipper" ? "skipper" : "agent"),
        channel_id: request.channel_id || (String(agent.kind) === "skipper" ? "workspace" : String(agent.channel_id || "")),
      }),
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, MNEMOSYNE_DATA_DIR: CONFIG_DIR },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(output) as Record<string, unknown>;
  } catch (error) {
    console.warn(`Mnemosyne ${String(request.operation)} failed for agent ${agent.id}:`, (error as Error).message);
    return null;
  }
}

export function ensureAgentMemory(agent: Row): boolean {
  return Boolean(invoke(agent, { operation: "init" })?.ok);
}

export function rememberForAgent(agent: Row, content: string, opts: {
  source?: string; importance?: number; metadata?: Record<string, unknown>; scope?: string;
  authorId?: string; authorType?: string; sessionId?: string;
} = {}): string | null {
  const result = invoke(agent, {
    operation: "remember",
    content,
    source: opts.source || "1helm",
    importance: opts.importance ?? 0.75,
    metadata: opts.metadata || {},
    scope: opts.scope || "global",
    author_id: opts.authorId,
    author_type: opts.authorType,
    session_id: opts.sessionId,
  });
  return result?.id ? String(result.id) : null;
}

export type RecalledMemory = { id?: string; content: string; source?: string; timestamp?: string; score?: number; importance?: number };

export function recallForAgent(agent: Row, query: string, topK = 8): RecalledMemory[] {
  if (!query.trim()) return [];
  const result = invoke(agent, { operation: "recall", query: query.slice(0, 4000), top_k: topK });
  return Array.isArray(result?.memories) ? (result!.memories as RecalledMemory[]).filter((memory) => memory?.content) : [];
}

export function mnemosyneAvailable(): boolean { return Boolean(pythonRuntime()); }

/** Install the pinned local-first memory runtime into the data root on a fresh 1Helm host. */
export function prepareMnemosyneRuntime(): boolean {
  if (pythonRuntime()) return true;
  const venv = join(DATA_DIR, "mnemosyne-runtime", "venv");
  mkdirSync(join(DATA_DIR, "mnemosyne-runtime"), { recursive: true });
  try {
    execFileSync(process.env.PYTHON || "python3", ["-m", "venv", venv], { timeout: 60_000, stdio: "ignore" });
    execFileSync(join(venv, "bin", "python"), ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "mnemosyne-memory==3.14.0"], { timeout: 180_000, stdio: "ignore" });
    return Boolean(pythonRuntime());
  } catch (error) {
    console.warn("Could not prepare Mnemosyne runtime:", (error as Error).message);
    return false;
  }
}
