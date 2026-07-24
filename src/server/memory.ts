import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, q1, type Row } from "./db.ts";

const APP_ROOT = process.env.HELM_APP_ROOT || process.cwd();
const BRIDGE = join(APP_ROOT, "scripts", "mnemosyne-bridge.py");
const CONFIG_DIR = join(DATA_DIR, "mnemosyne-runtime", "config");
const MNEMOSYNE_VERSION = "3.14.0";
let validatedPython: string | null | undefined;
let validatedSemanticPython: string | undefined;
let preparation: Promise<boolean> | null = null;
let preparationAbort = new AbortController();
const execFileAsync = promisify(execFile);

const asyncExecOptions = (timeout: number) => ({ timeout, windowsHide: true, signal: preparationAbort.signal });

function hasPinnedRuntime(candidate: string): boolean {
  if (!candidate || !existsSync(candidate)) return false;
  const result = spawnSync(candidate, ["-c", `import mnemosyne; assert mnemosyne.__version__ == "${MNEMOSYNE_VERSION}"`], {
    timeout: 10_000,
    stdio: "ignore",
  });
  return result.status === 0;
}

function hasPinnedSemanticRuntime(candidate: string): boolean {
  if (validatedSemanticPython === candidate) return true;
  if (!hasPinnedRuntime(candidate)) return false;
  const result = spawnSync(candidate, ["-c", "import fastembed, sqlite_vec"], {
    timeout: 10_000,
    stdio: "ignore",
  });
  if (result.status === 0) validatedSemanticPython = candidate;
  return result.status === 0;
}

function pythonRuntime(): string | null {
  if (validatedPython !== undefined) return validatedPython;
  const candidates = [
    process.env.MNEMOSYNE_PYTHON || "",
    join(DATA_DIR, "mnemosyne-runtime", "venv", "bin", "python"),
    join(APP_ROOT, "data-refactored", "mnemosyne-runtime", "venv", "bin", "python"),
  ];
  validatedPython = candidates.find(hasPinnedRuntime) || null;
  return validatedPython;
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
      timeout: request.operation === "sync_transcript" ? 120_000 : 20_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        MNEMOSYNE_DATA_DIR: CONFIG_DIR,
        MNEMOSYNE_FASTEMBED_CACHE_DIR: join(DATA_DIR, "mnemosyne-runtime", "cache", "fastembed"),
        ...(["recall", "recall_transcript"].includes(String(request.operation)) && hasPinnedSemanticRuntime(python)
          ? { MNEMOSYNE_POLYPHONIC_RECALL: "1" }
          : {}),
      },
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

export type TranscriptMemoryInput = {
  message_id: number;
  content: string;
  previous_memory_id?: string;
  metadata: Record<string, unknown>;
};

export type TranscriptMemoryHit = RecalledMemory & {
  metadata?: Record<string, unknown>;
};

/** Mirror raw transcript rows into the owning resident's semantic index. The
 * control-plane messages table remains authoritative; Mnemosyne stores only a
 * scoped retrieval index with stable source provenance. */
export function syncTranscriptForAgent(agent: Row, entries: TranscriptMemoryInput[]): { message_id: number; memory_id: string }[] {
  if (!entries.length) return [];
  const result = invoke(agent, { operation: "sync_transcript", entries });
  return Array.isArray(result?.indexed)
    ? (result!.indexed as { message_id: number; memory_id: string }[]).filter((entry) => Number(entry.message_id) && entry.memory_id)
    : [];
}

export function recallTranscriptForAgent(agent: Row, query: string, topK = 24): TranscriptMemoryHit[] {
  if (!query.trim()) return [];
  const result = invoke(agent, { operation: "recall_transcript", query: query.slice(0, 4000), top_k: topK });
  return Array.isArray(result?.memories)
    ? (result!.memories as TranscriptMemoryHit[]).filter((memory) => memory?.content && memory.metadata?.message_id)
    : [];
}

export function mnemosyneAvailable(): boolean { return Boolean(pythonRuntime()); }

/** Install the pinned local-first memory runtime into the data root on a fresh 1Helm host. */
async function prepareMnemosyneRuntimeUnlocked(): Promise<boolean> {
  const managedPython = join(DATA_DIR, "mnemosyne-runtime", "venv", "bin", "python");
  const current = pythonRuntime();
  if (current && hasPinnedSemanticRuntime(current)) return true;
  // Ephemeral test workspaces reuse the repository's already validated base
  // runtime. Installing the optional embedding stack into every throwaway
  // data directory would make application startup depend on package downloads
  // and can leave pip racing test cleanup after a deliberately killed child.
  if (process.env.NODE_ENV === "test" && current) return true;
  // Upgrade an existing app-managed base runtime in place. If optional local
  // embedding wheels are unavailable on this platform, retain keyword/FTS
  // memory instead of destroying a working durable-memory runtime.
  if (current === managedPython) {
    try {
      await execFileAsync(current, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--ignore-requires-python", `mnemosyne-memory[embeddings]==${MNEMOSYNE_VERSION}`], asyncExecOptions(600_000));
      if (hasPinnedSemanticRuntime(current)) return true;
    } catch (error) {
      if (preparationAbort.signal.aborted) return false;
      console.warn(`Could not add local semantic retrieval to the existing Mnemosyne runtime:`, (error as Error).message);
    }
    return true;
  }
  const venv = join(DATA_DIR, "mnemosyne-runtime", "venv");
  mkdirSync(join(DATA_DIR, "mnemosyne-runtime"), { recursive: true });
  // Homebrew Python can be preferred in a user's PATH but occasionally lacks
  // a working ensurepip installation. macOS always includes its own Python
  // runtime, which Mnemosyne supports through the bridge's Python 3.9 shim.
  // Try each explicitly rather than leaving durable memory unavailable merely
  // because the first interpreter cannot create an app-owned venv.
  const installers = [...new Set([
    process.env.PYTHON || "",
    "python3",
    ...(process.platform === "darwin" ? ["/usr/bin/python3"] : []),
  ].filter(Boolean))];
  for (const python of installers) {
    if (preparationAbort.signal.aborted) break;
    // A failed venv or pip run may still leave an executable Python behind.
    // Replace only this app-managed runtime after proving it cannot import the
    // pinned package; agent databases and all other Application Support remain.
    if (existsSync(venv)) rmSync(venv, { recursive: true, force: true });
    validatedSemanticPython = undefined;
    try {
      await execFileAsync(python, ["-m", "venv", venv], asyncExecOptions(60_000));
      try {
        const requirement = process.env.NODE_ENV === "test"
          ? `mnemosyne-memory==${MNEMOSYNE_VERSION}`
          : `mnemosyne-memory[embeddings]==${MNEMOSYNE_VERSION}`;
        await execFileAsync(join(venv, "bin", "python"), ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--ignore-requires-python", requirement], asyncExecOptions(600_000));
      } catch {
        if (preparationAbort.signal.aborted) break;
        await execFileAsync(join(venv, "bin", "python"), ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--ignore-requires-python", `mnemosyne-memory==${MNEMOSYNE_VERSION}`], asyncExecOptions(180_000));
      }
      validatedPython = undefined;
      if (pythonRuntime()) return true;
    } catch (error) {
      if (preparationAbort.signal.aborted) break;
      console.warn(`Could not prepare Mnemosyne runtime with ${python}:`, (error as Error).message);
    }
  }
  // Do not leave a partial virtual environment looking like an available
  // runtime. Agent-owned Mnemosyne databases remain untouched.
  if (existsSync(venv)) rmSync(venv, { recursive: true, force: true });
  validatedPython = undefined;
  validatedSemanticPython = undefined;
  return false;
}

/** Prepare the optional Python runtime without blocking the HTTP server's
 * event loop on venv creation or package downloads. Concurrent callers share
 * one installation attempt. */
export function prepareMnemosyneRuntime(): Promise<boolean> {
  if (!preparation) preparation = prepareMnemosyneRuntimeUnlocked();
  return preparation;
}

/** Stop only the in-flight app-managed runtime installer during host shutdown. */
export function cancelMnemosyneRuntimePreparation(): void {
  preparationAbort.abort();
}
