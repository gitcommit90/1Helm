import { createRequire } from "node:module";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type * as Y from "yjs";
import {
  normalizeWorkspaceDirectoryPath,
  readWorkspaceTextFile,
  saveWorkspaceTextFile,
} from "./agents.ts";

const require = createRequire(import.meta.url);
const yWebsocket = require("y-websocket/bin/utils") as {
  setPersistence: (persistence: {
    bindState: (name: string, doc: Y.Doc) => void;
    writeState: (name: string, doc: Y.Doc) => Promise<void>;
    provider: null;
  }) => void;
  setupWSConnection: (socket: WebSocket, request: IncomingMessage, options: { docName: string; gc: boolean }) => void;
};

const COWORK_ROOTS = new Set(["notes", "whiteboards", "code", "docs", "presentations"]);
const INITIAL_ORIGIN = Symbol("cowork-initial-file");
const EXTERNAL_ORIGIN = Symbol("cowork-external-file");

type Room = {
  channelId: number;
  path: string;
  scene: boolean;
  doc?: Y.Doc;
  dirty: boolean;
  lastContent: string;
  saveTimer: NodeJS.Timeout | null;
  refreshTimer: NodeJS.Timeout | null;
  viewers: Map<number, { username: string; display: string; avatar: string; connections: number }>;
};

const rooms = new Map<string, Room>();

/** Keep collaboration room names opaque so paths never become server-global IDs. */
function roomName(channelId: number, path: string): string {
  return `cowork:${channelId}:${Buffer.from(path, "utf8").toString("base64url")}`;
}

function value(room: Room, doc: Y.Doc): string {
  return room.scene ? String(doc.getMap<string>("scene").get("json") || "") : doc.getText("content").toString();
}

/**
 * Minimal middle-span edit between two strings. Used so external file refresh
 * does not delete+reinsert the entire Y.Text (which resets every client's
 * CodeMirror scroll/caret to the top even when the text is unchanged or only
 * a small region moved).
 */
export function textReplaceOps(prev: string, next: string): { start: number; deleteLen: number; insert: string } | null {
  if (prev === next) return null;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  let endPrev = prev.length - 1;
  let endNext = next.length - 1;
  while (endPrev >= start && endNext >= start && prev.charCodeAt(endPrev) === next.charCodeAt(endNext)) {
    endPrev -= 1;
    endNext -= 1;
  }
  return {
    start,
    deleteLen: Math.max(0, endPrev - start + 1),
    insert: next.slice(start, endNext + 1),
  };
}

function applyTextContent(text: Y.Text, content: string): void {
  const ops = textReplaceOps(text.toString(), content);
  if (!ops) return;
  if (ops.deleteLen > 0) text.delete(ops.start, ops.deleteLen);
  if (ops.insert) text.insert(ops.start, ops.insert);
}

function replaceValue(room: Room, doc: Y.Doc, content: string, origin: unknown): void {
  // No-op when the live collaborative doc already matches disk — avoids a full
  // Yjs transaction that would still thrash editors if lastContent drifted.
  if (value(room, doc) === content) return;
  doc.transact(() => {
    if (room.scene) doc.getMap<string>("scene").set("json", content);
    else applyTextContent(doc.getText("content"), content);
  }, origin);
}

function flush(room: Room): void {
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = null;
  if (!room.doc || !room.dirty) return;
  const content = value(room, room.doc);
  if (content !== room.lastContent) saveWorkspaceTextFile(room.channelId, room.path, content);
  room.lastContent = content;
  room.dirty = false;
}

function queueSave(room: Room): void {
  room.dirty = true;
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(() => {
    try { flush(room); }
    catch (error) { console.warn(`Cowork could not save /workspace/${room.path}: ${(error as Error).message}`); }
  }, 350);
  room.saveTimer.unref();
}

function refreshFromFile(room: Room): void {
  // Never clobber in-flight local edits. While dirty, the open Y.Doc is the
  // source of truth until the debounce flush lands.
  if (!room.doc || room.dirty) return;
  try {
    const content = readWorkspaceTextFile(room.channelId, room.path).content;
    if (content === room.lastContent) return;
    // Keep lastContent aligned even when Y already matches (e.g. after a
    // same-bytes rewrite on disk). replaceValue is a no-op in that case, but
    // skipping the call entirely avoids an unnecessary transaction setup.
    const live = value(room, room.doc);
    room.lastContent = content;
    if (live === content) return;
    replaceValue(room, room.doc, content, EXTERNAL_ORIGIN);
  } catch {
    // A move/delete closes or reconnects the browser room. Until then, keep the
    // last valid collaborative state instead of replacing it with an error.
  }
}

yWebsocket.setPersistence({
  provider: null,
  bindState(name, doc) {
    const room = rooms.get(name);
    if (!room) throw new Error("Unknown Cowork collaboration room.");
    const content = readWorkspaceTextFile(room.channelId, room.path).content;
    room.doc = doc;
    room.lastContent = content;
    replaceValue(room, doc, content, INITIAL_ORIGIN);
    doc.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin !== INITIAL_ORIGIN && origin !== EXTERNAL_ORIGIN) queueSave(room);
    });
    room.refreshTimer = setInterval(() => refreshFromFile(room), 1_500);
    room.refreshTimer.unref();
  },
  async writeState(name) {
    const room = rooms.get(name);
    if (!room) return;
    try { flush(room); }
    finally {
      if (room.refreshTimer) clearInterval(room.refreshTimer);
      if (room.saveTimer) clearTimeout(room.saveTimer);
      room.refreshTimer = null;
      room.saveTimer = null;
      rooms.delete(name);
    }
  },
});

export function normalizeCoworkFolderPath(input: string): string {
  const path = normalizeWorkspaceDirectoryPath(input);
  const root = path.split("/")[0];
  if (!path || !COWORK_ROOTS.has(root)) throw new Error("Cowork paths must stay in a supported /workspace section.");
  return path;
}

export function normalizeCoworkPath(input: string): string {
  const path = normalizeCoworkFolderPath(input);
  if (!path.includes("/")) throw new Error("Choose a Cowork file.");
  return path;
}

/** Attach one already authenticated, membership-gated socket to its file. */
export function attachCoworkClient(
  channelId: number,
  input: string,
  viewer: { id: number; username: string; display: string; avatar: string },
  socket: WebSocket,
  request: IncomingMessage,
): void {
  const path = normalizeCoworkPath(input);
  // Validate existence, file type, size, and text safety before the upgrade is
  // accepted by Yjs. This is the same contract used by the REST editor.
  readWorkspaceTextFile(channelId, path);
  const name = roomName(channelId, path);
  if (!rooms.has(name)) rooms.set(name, {
    channelId,
    path,
    scene: path.endsWith(".whiteboard.json") || path.endsWith(".slides.json"),
    dirty: false,
    lastContent: "",
    saveTimer: null,
    refreshTimer: null,
    viewers: new Map(),
  });
  const room = rooms.get(name)!;
  const current = room.viewers.get(viewer.id);
  room.viewers.set(viewer.id, { ...viewer, connections: (current?.connections || 0) + 1 });
  socket.once("close", () => {
    const active = room.viewers.get(viewer.id);
    if (!active || active.connections <= 1) room.viewers.delete(viewer.id);
    else room.viewers.set(viewer.id, { ...active, connections: active.connections - 1 });
  });
  yWebsocket.setupWSConnection(socket, request, { docName: name, gc: true });
}

/** Authenticated room presence used for first-message thread participation. */
export function coworkViewerUsernames(channelId: number, input: string, exceptUserId: number): string[] {
  const name = roomName(channelId, normalizeCoworkPath(input));
  const room = rooms.get(name);
  if (!room) return [];
  return [...room.viewers.entries()]
    .filter(([userId]) => userId !== exceptUserId)
    .map(([, viewer]) => viewer.username)
    .sort((a, b) => a.localeCompare(b));
}

export function coworkPresence(channelId: number, input: string): Array<{ id: number; username: string; display: string; avatar: string }> {
  const name = roomName(channelId, normalizeCoworkPath(input));
  return [...(rooms.get(name)?.viewers.entries() || [])].map(([id, viewer]) => ({ id, username: viewer.username, display: viewer.display, avatar: viewer.avatar }));
}

/** Synchronously persist every dirty room before the HTTP/WebSocket server is
 * stopped. File writes are local and bounded to 5 MB, so shutdown can fail
 * closed without waiting on a background debounce. */
export function flushCoworkDocuments(): void {
  for (const room of rooms.values()) {
    try { flush(room); }
    catch (error) { console.warn(`Cowork could not flush /workspace/${room.path}: ${(error as Error).message}`); }
  }
}
