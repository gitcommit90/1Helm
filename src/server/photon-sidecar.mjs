import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Spectrum, text as spectrumText } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const projectId = String(process.env.PHOTON_PROJECT_ID || "");
const projectSecret = String(process.env.PHOTON_PROJECT_SECRET || "");
const sharedToken = String(process.env.PHOTON_SIDECAR_TOKEN || "");
const port = Number(process.env.PHOTON_SIDECAR_PORT || 0);
const maxInbound = Math.max(100, Number(process.env.PHOTON_INBOUND_QUEUE || 2000));
if (!projectId || !projectSecret || !sharedToken || !port) throw new Error("Photon sidecar configuration is incomplete.");

const app = await Spectrum({ projectId, projectSecret, providers: [imessage.config()], options: { flattenGroups: true }, telemetry: false });
const provider = imessage(app);
const spaces = new Map();
const inbound = [];
const waiters = [];

function rememberSpace(space) {
  if (space?.id) spaces.set(String(space.id), space);
  const phone = String(space?.phone || "");
  if (/^\+\d{6,}$/.test(phone)) spaces.set(phone, space);
}

function bodyText(content) {
  if (!content || typeof content !== "object") return "";
  if (content.type === "text") return String(content.text || "");
  if (content.type === "group") return (content.items || []).map((item) => bodyText(item?.content)).filter(Boolean).join("\n");
  if (content.type === "attachment" || content.type === "voice") return `[${content.type}: ${content.name || content.mimeType || "media"}]`;
  if (content.type === "reaction") return `[reaction ${content.emoji || ""}]`;
  return "";
}

function pushInbound(space, message) {
  rememberSpace(space);
  const entry = {
    id: String(message?.id || ""),
    space_id: String(space?.id || message?.space?.id || ""),
    space_type: String(space?.type || message?.space?.type || "dm"),
    sender: String(message?.sender?.id || ""),
    text: bodyText(message?.content).slice(0, 50_000),
    timestamp: message?.timestamp instanceof Date ? message.timestamp.toISOString() : String(message?.timestamp || ""),
  };
  if (!entry.id || !entry.space_id) return;
  const waiter = waiters.shift();
  if (waiter) waiter(entry);
  else { inbound.push(entry); while (inbound.length > maxInbound) inbound.shift(); }
}

void (async () => {
  let delay = 1000;
  for (;;) {
    try {
      for await (const [space, message] of app.messages) {
        delay = 1000;
        pushInbound(space, message);
      }
    } catch (error) {
      console.error(`1Helm Photon stream interrupted: ${error?.message || error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(30_000, delay * 2);
  }
})();

const tokenOk = (value) => {
  if (typeof value !== "string") return false;
  const expected = Buffer.from(sharedToken), received = Buffer.from(value);
  return expected.length === received.length && timingSafeEqual(expected, received);
};
const respond = (res, status, value) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  res.end(body);
};
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) throw new Error("request too large"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
async function resolveSpace(id) {
  if (spaces.has(id)) return spaces.get(id);
  const space = /^\+\d{6,}$/.test(id) ? await provider.space.create(id) : await provider.space.get(id);
  rememberSpace(space); return space;
}

const server = createServer(async (req, res) => {
  if (!tokenOk(req.headers["x-1helm-photon-token"])) return respond(res, 401, { ok: false, error: "unauthorized" });
  try {
    if (req.method === "POST" && req.url === "/health") return respond(res, 200, { ok: true, queued: inbound.length });
    if (req.method === "GET" && req.url?.startsWith("/next")) {
      if (inbound.length) return respond(res, 200, { ok: true, event: inbound.shift() });
      const event = await Promise.race([
        new Promise((resolve) => waiters.push(resolve)),
        new Promise((resolve) => setTimeout(() => resolve(null), 25_000)),
      ]);
      return respond(res, 200, { ok: true, event });
    }
    if (req.method === "POST" && req.url === "/send") {
      const body = await readJson(req);
      if (!body.space_id || typeof body.text !== "string" || !body.text.trim()) return respond(res, 400, { ok: false, error: "space_id and text are required" });
      const message = await (await resolveSpace(String(body.space_id))).send(spectrumText(body.text.slice(0, 50_000)));
      return respond(res, 200, { ok: true, message_id: message?.id || "" });
    }
    if (req.method === "POST" && req.url === "/shutdown") {
      respond(res, 200, { ok: true });
      setTimeout(() => process.kill(process.pid, "SIGTERM"), 25).unref(); return;
    }
    respond(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    console.error(`1Helm Photon sidecar request failed: ${error?.stack || error}`);
    respond(res, 500, { ok: false, error: "Photon operation failed" });
  }
});
server.listen(port, "127.0.0.1", () => console.error(`1Helm Photon sidecar ready on 127.0.0.1:${port}`));

let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  server.close();
  await app.stop().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.stdin.resume();
process.stdin.on("end", () => void shutdown());
