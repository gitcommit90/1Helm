import { deleteWorkspaceEntry, listWorkspaceFiles, readWorkspaceTextFile, syncWorkspaceArtifacts } from "./agents.ts";

export type CoworkContext = {
  kind: "file" | "folder";
  path: string;
  surface: "notes" | "whiteboards" | "code" | "docs" | "presentations";
};

const SURFACES = new Set<CoworkContext["surface"]>(["notes", "whiteboards", "code", "docs", "presentations"]);

function safeCoworkPath(input: string): string | null {
  const path = String(input || "").trim().replace(/^\/+/, "");
  const parts = path.split("/");
  if (!path || parts.some((part) => !part || part === "." || part === ".." || part !== part.trim() || /[\\\0-\x1f\x7f]/.test(part))) return null;
  return path;
}

/** Cowork writes one visible, server-validated marker onto the root message.
 * Re-derive the surface from that durable marker on every later turn so a
 * follow-up, queued turn, or process restart cannot lose its file contract. */
export function coworkContextFromRootBody(body: string): CoworkContext | null {
  const match = /^Working (file|folder): \/workspace\/(.+)$/m.exec(String(body || ""));
  if (!match) return null;
  const path = safeCoworkPath(match[2]);
  if (!path) return null;
  const surface = path.split("/")[0] as CoworkContext["surface"];
  if (!SURFACES.has(surface)) return null;
  return { kind: match[1] as "file" | "folder", path, surface };
}

export function coworkFormatContract(path: string, folderContext: boolean): string {
  const safePath = safeCoworkPath(path);
  const surface = safePath?.split("/")[0] as CoworkContext["surface"] | undefined;
  if (!surface || !SURFACES.has(surface)) return "";
  const target = folderContext ? `the /workspace/${safePath} folder` : `/workspace/${safePath}`;
  if (surface === "notes" || surface === "docs") {
    return [
      `Cowork ${surface === "docs" ? "Docs" : "Notes"} contract for ${target} — follow it exactly:`,
      "- The editable source of truth is Markdown. Create or update `.md` files only in this Cowork surface.",
      "- Do not create HTML, PDF, DOCX, PPTX, or another substitute as the working file. 1Helm renders Markdown and provides exports itself.",
      "- Keep any pre-existing user files intact; if the selected file has an incompatible extension, create a neighboring `.md` replacement instead of deleting it.",
    ].join("\n");
  }
  if (surface === "presentations") {
    return [
      `Cowork Presentations contract for ${target} — follow it exactly:`,
      "- Create exactly one editable deck named `<name>.slides.json`. Do not create HTML, PPTX, PDF, local servers, or extra presentation files.",
      "- Preferred schema: `{" + ' "theme": { "primary": "#hex", "background": "#hex", "text": "#hex", "accent": "#hex" }, "slides": [{ "title": "Slide title", "body": "Slide body" }] }' + "`.",
      "- Native schema: `{" + ' "type": "1helm-slides", "version": 3, "printableArea": { "width": 1500, "height": 1000 }, "slides": [{ "id": "...", "name": "Slide title", "scene": { "elements": [], "appState": {}, "files": {} } }] }' + "`.",
      "- Verify the JSON parses before finishing. The Presentations tab owns rendering and PDF export.",
    ].join("\n");
  }
  if (surface === "whiteboards") {
    return [
      `Cowork Whiteboard contract for ${target} — follow it exactly:`,
      "- Create exactly one editable board named `<name>.whiteboard.json`. Do not create HTML, an image substitute, or an ad-hoc schema.",
      '- Use an Excalidraw scene: `{ "type": "excalidraw", "version": 2, "elements": [], "appState": {}, "files": {} }`.',
      "- Verify the JSON parses before finishing.",
    ].join("\n");
  }
  return [
    `Cowork Code contract for ${target}:`,
    "- Use normal source files appropriate to the requested language or project. Preserve existing project conventions and verify the result.",
  ].join("\n");
}

const surfacePrefix = (context: CoworkContext): string => `workspace/${context.surface}/`;

export function snapshotCoworkSurface(channelId: number, context: CoworkContext): Set<string> {
  const prefix = surfacePrefix(context);
  return new Set(listWorkspaceFiles(channelId).filter((entry) => entry.kind === "file" && entry.path.startsWith(prefix)).map((entry) => entry.path));
}

function compatibleCoworkFile(channelId: number, context: CoworkContext, path: string): boolean {
  const lower = path.toLowerCase();
  if (context.surface === "code") return true;
  if (context.surface === "notes" || context.surface === "docs") return lower.endsWith(".md");
  try {
    if (context.surface === "whiteboards") {
      if (!lower.endsWith(".whiteboard.json")) return false;
      const parsed = JSON.parse(readWorkspaceTextFile(channelId, path).content) as Record<string, unknown>;
      return parsed.type === "excalidraw" && Number(parsed.version) === 2 && Array.isArray(parsed.elements);
    }
    if (!lower.endsWith(".slides.json")) return false;
    const parsed = JSON.parse(readWorkspaceTextFile(channelId, path).content) as Record<string, unknown>;
    if (!Array.isArray(parsed.slides)) return false;
    if (parsed.type === "1helm-slides") {
      return Number(parsed.version) === 3 && parsed.slides.every((slide) => {
        if (!slide || typeof slide !== "object") return false;
        const scene = (slide as Record<string, unknown>).scene;
        return Boolean(scene && typeof scene === "object" && Array.isArray((scene as Record<string, unknown>).elements));
      });
    }
    return parsed.slides.every((slide) => slide != null && typeof slide === "object");
  } catch { return false; }
}

/** Reject only files born during this command. Pre-existing user files are
 * never removed, even when they predate and violate today's Cowork contract. */
export function enforceCoworkCommandOutput(channelId: number, threadId: number | null, context: CoworkContext, before: Set<string>): string | null {
  const prefix = surfacePrefix(context);
  const created = listWorkspaceFiles(channelId)
    .filter((entry) => entry.kind === "file" && entry.path.startsWith(prefix) && !before.has(entry.path))
    .map((entry) => entry.path);
  const rejected = created.filter((path) => !compatibleCoworkFile(channelId, context, path));
  for (const path of rejected) deleteWorkspaceEntry(channelId, path);
  if (!rejected.length) return null;
  syncWorkspaceArtifacts(channelId, threadId || null, "agent");
  const expected = context.surface === "presentations" ? "one valid `.slides.json` deck"
    : context.surface === "whiteboards" ? "one valid `.whiteboard.json` Excalidraw scene"
      : context.surface === "docs" || context.surface === "notes" ? "Markdown `.md`"
        : "normal source files";
  return `Error: Cowork rejected and removed newly-created incompatible output (${rejected.map((path) => `/${path}`).join(", ")}). Create ${expected} in /workspace/${context.surface}; do not substitute HTML, PPTX, PDF, or an invented schema. Pre-existing user files were not touched.`;
}
