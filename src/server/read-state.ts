import { Worker } from "node:worker_threads";
import { join } from "node:path";

const DATA_DIR = process.env.CTRL_DATA_DIR || join(process.cwd(), "data");

type WorkerReply = {
  type?: string;
  requestId?: number;
  message?: string;
};

let readStateWorker: Worker | null = null;
let nextRequestId = 1;
const flushWaiters = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
const expectedExits = new WeakSet<Worker>();

function rejectWaiters(error: Error): void {
  for (const waiter of flushWaiters.values()) waiter.reject(error);
  flushWaiters.clear();
}

function workerForReadState(): Worker {
  if (readStateWorker) return readStateWorker;
  const worker = new Worker(new URL("./read-state-worker.mjs", import.meta.url), {
    workerData: { databasePath: join(DATA_DIR, "ctrl-pane.db") },
  });
  worker.on("message", (reply: WorkerReply) => {
    if (reply.type === "warning") {
      console.warn(`read-state worker: ${reply.message || "unknown error"}`);
      return;
    }
    if (reply.type !== "flushed" || !reply.requestId) return;
    const waiter = flushWaiters.get(reply.requestId);
    if (!waiter) return;
    flushWaiters.delete(reply.requestId);
    waiter.resolve();
    if (flushWaiters.size === 0) worker.unref();
  });
  worker.on("error", (cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (readStateWorker === worker) readStateWorker = null;
    rejectWaiters(error);
    console.warn(`read-state worker stopped: ${error.message}`);
  });
  worker.on("exit", (code) => {
    if (readStateWorker === worker) readStateWorker = null;
    if (!expectedExits.has(worker) && code !== 0) {
      const error = new Error(`read-state worker exited with code ${code}`);
      rejectWaiters(error);
      console.warn(error.message);
    }
  });
  worker.unref();
  readStateWorker = worker;
  return worker;
}

/** Persist noncritical read receipts away from Node's HTTP event loop. */
export function queueLastRead(userId: number, channelId: number, lastRead: number): void {
  if (![userId, channelId, lastRead].every(Number.isSafeInteger) || userId <= 0 || channelId <= 0 || lastRead < 0) return;
  workerForReadState().postMessage({ type: "update", userId, channelId, lastRead });
}

/** Test/shutdown seam: resolves after all updates queued before it are durable. */
export function flushLastReads(): Promise<void> {
  if (!readStateWorker) return Promise.resolve();
  const requestId = nextRequestId++;
  return new Promise<void>((resolve, reject) => {
    flushWaiters.set(requestId, { resolve, reject });
    readStateWorker!.ref();
    readStateWorker!.postMessage({ type: "flush", requestId });
  });
}

export async function shutdownReadStateWorker(): Promise<void> {
  const worker = readStateWorker;
  if (!worker) return;
  await flushLastReads().catch(() => undefined);
  if (readStateWorker === worker) readStateWorker = null;
  expectedExits.add(worker);
  rejectWaiters(new Error("read-state worker is shutting down"));
  await worker.terminate();
}
