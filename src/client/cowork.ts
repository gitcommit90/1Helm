import { api, type Channel, type ChannelFile, type Message, type User } from "./api.ts";
import { clear, color, h, icon, initials, md } from "./dom.ts";
import { appAlert, appConfirm, appPrompt } from "./dialogs.ts";
import { connectCoworkDocument, type CoworkDocument } from "./cowork-collaboration.ts";
import { mountCodeMirror, mountDocumentSurface, mountExcalidraw, type MountedEditor } from "./cowork-editors.ts";
import { exportToCanvas, getCommonBounds } from "@excalidraw/excalidraw";
import { PDFDocument } from "pdf-lib";
import { authenticatedAssetSrc } from "./avatar-assets.ts";
import { configureSpeechUi } from "./speech-ui.ts";
const { mount: mountSpeechToTextControl, focus: setFocusedSpeechTarget } = configureSpeechUi();
export type CoworkSection = "notes" | "whiteboards" | "code" | "docs" | "presentations";
type EditableFile = ChannelFile & { content: string };
type SlideScene = { elements: readonly unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> };
type DeckSlide = { id: string; name: string; scene: SlideScene };
type PrintableArea = { width: number; height: number };
type Deck = { type: "1helm-slides"; version: 3; printableArea: PrintableArea; slides: DeckSlide[] };
type SectionSession = {
  folder: string;
  path: string;
  content: string;
  saved: string;
  loaded: boolean;
  preview: boolean;
  activeSlide: number;
  slideStripScroll?: number;
  collaboration: CoworkDocument | null;
  mounted: MountedEditor | null;
  view: HTMLElement | null;
  presenceCleanup: (() => void) | null;
  loadVersion: number;
};
type CoworkSurface = { node: HTMLElement; openPath: (path: string) => Promise<void>; reload: () => Promise<void>; setOpenThread: (callback: (root: Message) => void) => void; setActive: (active: boolean) => void };
const SECTIONS: Array<{ id: CoworkSection; label: string; folder: string; icon: string; defaultExtension: string }> = [
  { id: "notes", label: "Notes", folder: "notes", icon: "fileText", defaultExtension: ".md" },
  { id: "whiteboards", label: "Whiteboard", folder: "whiteboards", icon: "board", defaultExtension: ".whiteboard.json" },
  { id: "code", label: "Code", folder: "code", icon: "code", defaultExtension: ".txt" },
  { id: "docs", label: "Docs", folder: "docs", icon: "fileText", defaultExtension: ".md" },
  { id: "presentations", label: "Presentations", folder: "presentations", icon: "presentation", defaultExtension: ".slides.json" },
];
const surfaces = new Map<number, CoworkSurface>();
const pendingPaths = new Map<number, string>();

export function stageCoworkPath(channelId: number, path: string): void {
  pendingPaths.set(channelId, path.replace(/^\/?workspace\/?/, "").replace(/^\/+/, ""));
}

/** Hidden cached editors retain their DOM state, but only the visible Cowork
 * file advertises presence or participates in live synchronization. */
export function setActiveCoworkChannel(channelId: number | null): void {
  for (const [candidateId, surface] of surfaces) surface.setActive(candidateId === channelId);
}

function sectionForPath(path: string): CoworkSection {
  const root = path.split("/")[0] as CoworkSection;
  return SECTIONS.some((section) => section.id === root) ? root : "notes";
}

function fileIcon(file: ChannelFile, size = 17): SVGElement {
  if (file.kind === "directory") return icon("folder", size);
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "sh", "html", "css", "json", "yaml", "yml", "sql"].includes(ext || "")) return icon("code", size);
  if (file.name.includes(".whiteboard.")) return icon("board", size);
  if (file.name.includes(".slides.")) return icon("presentation", size);
  return icon("fileText", size);
}

function blankScene(): SlideScene { return { elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} }; }
const DEFAULT_PRINTABLE_AREA: PrintableArea = { width: 1500, height: 1000 };
const PRINTABLE_BOUNDARY_ID = "1helm-printable-area-boundary";
function blankDeck(): Deck { return { type: "1helm-slides", version: 3, printableArea: { ...DEFAULT_PRINTABLE_AREA }, slides: [{ id: crypto.randomUUID(), name: "Slide 1", scene: blankScene() }] }; }

function printableArea(value: unknown): PrintableArea {
  const candidate = value && typeof value === "object" ? value as Partial<PrintableArea> : {};
  const width = Math.round(Number(candidate.width));
  const height = Math.round(Number(candidate.height));
  return {
    width: Number.isFinite(width) ? Math.max(320, Math.min(5000, width)) : DEFAULT_PRINTABLE_AREA.width,
    height: Number.isFinite(height) ? Math.max(240, Math.min(5000, height)) : DEFAULT_PRINTABLE_AREA.height,
  };
}

function printableBoundary(area: PrintableArea): Record<string, unknown> {
  return {
    id: PRINTABLE_BOUNDARY_ID, type: "rectangle", x: 0, y: 0, width: area.width, height: area.height, angle: 0,
    strokeColor: "#4c6ef5", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "dashed",
    roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 15001000, version: 1,
    versionNonce: 15001000, index: "Zz", isDeleted: false, boundElements: null, updated: 1, link: null, locked: true,
  };
}

function sceneWithPrintableBoundary(scene: SlideScene, area: PrintableArea): SlideScene {
  return { ...scene, elements: [printableBoundary(area), ...scene.elements.filter((element: any) => element?.id !== PRINTABLE_BOUNDARY_ID)] };
}

function sceneWithoutPrintableBoundary(scene: SlideScene): SlideScene {
  return { ...scene, elements: scene.elements.filter((element: any) => element?.id !== PRINTABLE_BOUNDARY_ID) };
}

function starterContent(section: CoworkSection): string {
  if (section === "whiteboards") return JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }, null, 2);
  if (section === "presentations") return JSON.stringify(blankDeck(), null, 2);
  return "";
}

function normalizeDeck(content: string): Deck {
  const parsed = JSON.parse(content || "{}");
  if (parsed?.type === "1helm-slides" && Array.isArray(parsed.slides)) {
    return { type: "1helm-slides", version: 3, printableArea: printableArea(parsed.printableArea), slides: parsed.slides.length ? parsed.slides.map((slide: Partial<DeckSlide>, index: number) => ({ id: slide.id || crypto.randomUUID(), name: slide.name || `Slide ${index + 1}`, scene: slide.scene?.elements ? sceneWithoutPrintableBoundary(slide.scene) : blankScene() })) : blankDeck().slides };
  }
  if (Array.isArray(parsed?.slides)) {
    return simpleDeckToScenes(parsed as SimpleDeck);
  }
  throw new Error("Unsupported presentation file");
}

/** Simple-format decks ({slides:[{title,body}]}) get a real layout: themed
 * background and title band, content-sized text boxes with word wrap and
 * font step-down, and per-line bullet rendering. */
type SimpleDeck = { slides: Array<{ title?: string; body?: string }>; theme?: { primary?: string; secondary?: string; background?: string; text?: string; accent?: string } };

function simpleDeckToScenes(parsed: SimpleDeck): Deck {
  const area = { ...DEFAULT_PRINTABLE_AREA };
  const safeColor = (value: unknown, fallback: string): string => typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback;
  const theme = {
    primary: safeColor(parsed.theme?.primary, "#4c6ef5"),
    background: safeColor(parsed.theme?.background, "#ffffff"),
    text: safeColor(parsed.theme?.text, "#1b1b1f"),
    muted: safeColor(parsed.theme?.secondary, "#495057"),
    accent: safeColor(parsed.theme?.accent, safeColor(parsed.theme?.primary, "#4c6ef5")),
  };
  const margin = 110;
  const contentWidth = area.width - margin * 2;
  // Excalidraw's default font is close to 0.6em average glyph width; measure
  // wrapped lines conservatively so boxes are sized to their contents.
  const wrapCount = (text: string, fontSize: number): number => {
    const perLine = Math.max(8, Math.floor(contentWidth / (fontSize * 0.65)));
    return text.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / perLine)), 0);
  };
  let seed = 1;
  const textElement = (text: string, x: number, y: number, width: number, fontSize: number, color: string, align: string, bold = false): Record<string, unknown> => ({
    type: "text", id: crypto.randomUUID(), x, y, width,
    height: Math.ceil(wrapCount(text, fontSize) * fontSize * 1.6),
    text, originalText: text, fontSize, fontFamily: bold ? 2 : 1, textAlign: align, verticalAlign: "top",
    strokeColor: color, backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, roughness: 0, opacity: 100,
    angle: 0, seed: seed++, version: 1, versionNonce: seed, index: `a${seed}`, isDeleted: false, groupIds: [], frameId: null,
    roundness: null, boundElements: null, link: null, locked: false, containerId: null, autoResize: true, lineHeight: 1.25,
  });
  const bar = (x: number, y: number, width: number, height: number, color: string): Record<string, unknown> => ({
    type: "rectangle", id: crypto.randomUUID(), x, y, width, height, angle: 0,
    strokeColor: "transparent", backgroundColor: color, fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
    roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: { type: 3 }, seed: seed++, version: 1,
    versionNonce: seed, index: `a${seed}`, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
  });
  const slides = (parsed.slides.length ? parsed.slides : [{ title: "Slide 1" }]).map((slide, index) => {
    const title = String(slide.title || "").trim();
    const body = String(slide.body || "").trim();
    const elements: Record<string, unknown>[] = [];
    const titleOnly = title && !body;
    if (titleOnly) {
      // Section divider: centered title over an accent underline.
      elements.push(textElement(title, margin, area.height / 2 - 60, contentWidth, 64, theme.text, "center", true));
      elements.push(bar(area.width / 2 - 120, area.height / 2 + 40, 240, 10, theme.accent));
    } else {
      elements.push(bar(0, 0, area.width, 14, theme.accent));
      if (title) {
        elements.push(textElement(title, margin, 70, contentWidth, 52, theme.text, "left", true));
        elements.push(bar(margin, 150, 150, 7, theme.accent));
      }
      if (body) {
        // Render bullets as separate, spaced rows; prose as one sized block.
        const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
        const bulletish = lines.length > 1 && lines.filter((line) => /^([-*•]|\d+[.)])\s+/.test(line)).length >= Math.ceil(lines.length / 2);
        const top = title ? 200 : margin;
        const available = area.height - top - 70;
        if (bulletish) {
          let fontSize = 30;
          const totalRows = (size: number): number => lines.reduce((rows, line) => rows + wrapCount(line.replace(/^([-*•]|\d+[.)])\s+/, ""), size), 0);
          while (fontSize > 16 && totalRows(fontSize) * fontSize * 1.45 > available) fontSize -= 2;
          let y = top;
          for (const line of lines) {
            const isBullet = /^([-*•]|\d+[.)])\s+/.test(line);
            const label = line.replace(/^[-*•]\s+/, "");
            if (isBullet && !/^\d+[.)]/.test(line)) elements.push(bar(margin + 4, y + fontSize * 0.42, fontSize * 0.42, fontSize * 0.42, theme.accent));
            const x = isBullet ? margin + fontSize * 1.3 : margin;
            const element = textElement(label, x, y, contentWidth - (x - margin), fontSize, theme.muted, "left");
            elements.push(element);
            y += Number(element.height) + fontSize * 0.45;
          }
        } else {
          let fontSize = 30;
          while (fontSize > 16 && wrapCount(body, fontSize) * fontSize * 1.3 > available) fontSize -= 2;
          elements.push(textElement(body, margin, top, contentWidth, fontSize, theme.muted, "left"));
        }
      }
      elements.push(textElement(String(index + 1), area.width - 70, area.height - 56, 40, 18, theme.muted, "right"));
    }
    return {
      id: crypto.randomUUID(), name: title || `Slide ${index + 1}`,
      scene: { elements: elements as never[], appState: { viewBackgroundColor: theme.background }, files: {} },
    };
  });
  return { type: "1helm-slides", version: 3, printableArea: area, slides };
}

async function presentationPdf(deck: Deck, filename: string): Promise<void> {
  const pdf = await PDFDocument.create();
  const { width, height } = deck.printableArea;
  for (const slide of deck.slides) {
    const elements = slide.scene.elements.filter((element: any) => {
      if (!element || element.id === PRINTABLE_BOUNDARY_ID || element.isDeleted) return false;
      const [minX, minY, maxX, maxY] = getCommonBounds([element] as never);
      return maxX > 0 && maxY > 0 && minX < width && minY < height;
    });
    const output = document.createElement("canvas"); output.width = width; output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the PDF canvas.");
    context.fillStyle = String(slide.scene.appState?.viewBackgroundColor || "#ffffff");
    context.fillRect(0, 0, width, height);
    if (elements.length) {
      const [minX, minY] = getCommonBounds(elements as never);
      const rendered = await exportToCanvas({ elements: elements as never, appState: { ...slide.scene.appState, exportBackground: false, exportScale: 1 } as never, files: (slide.scene.files || {}) as never, exportPadding: 0 });
      // The printable canvas is the clipping mask. Partially overlapping
      // elements retain their in-bounds pixels while content wholly outside
      // 0,0 → width,height never reaches the exported page.
      context.save(); context.beginPath(); context.rect(0, 0, width, height); context.clip();
      context.drawImage(rendered, minX, minY); context.restore();
    }
    const image = await pdf.embedPng(output.toDataURL("image/png"));
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
  const bytes = await pdf.save();
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = `${filename.replace(/\.slides\.json$/i, "") || "presentation"}.pdf`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function visibleName(path: string): string { return path.split("/").pop() || path; }

export function renderCowork(container: HTMLElement, channelId: number, channel: Channel, me: User, onOpenThread: (root: Message) => void, preserveExisting = false): void {
  const cached = surfaces.get(channelId);
  if (cached) {
    cached.setActive(true);
    cached.setOpenThread(onOpenThread);
    clear(container); container.append(cached.node);
    const staged = pendingPaths.get(channelId); pendingPaths.delete(channelId);
    if (staged) void cached.openPath(staged); else if (!preserveExisting) void cached.reload();
    return;
  }

  const sessions = new Map<CoworkSection, SectionSession>();
  for (const item of SECTIONS) sessions.set(item.id, { folder: item.folder, path: "", content: "", saved: "", loaded: false, preview: false, activeSlide: 0, collaboration: null, mounted: null, view: null, presenceCleanup: null, loadVersion: 0 });
  let section: CoworkSection = "notes";
  let filter = "";
  let selectedEntry: ChannelFile | null = null;
  let agentOpen = false;
  let chatTimer: number | null = null;
  let chatRootId = 0;
  let surfaceActive = true;
  let focusAgentOnDraw = false;
  let coworkContextPending = true;
  let openThreadCallback = onOpenThread;
  const agentDrafts = new Map<string, string>();
  const shell = h("section", { class: "cowork-shell flex h-full min-h-[34rem] flex-col bg-surface", dataset: { coworkSurface: String(channelId) } });
  const sectionNav = h("nav", { class: "cowork-sections flex w-full shrink-0 justify-start gap-1 overflow-x-auto border-b border-line bg-raised/25 px-3 sm:justify-center", "aria-label": "Cowork sections" });
  const breadcrumb = h("nav", { class: "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto font-mono text-[11px]", "aria-label": "Cowork folder path" });
  const fileList = h("div", { class: "min-h-0 flex-1 overflow-y-auto p-2", dataset: { coworkFiles: "" } });
  const fileActions = h("div", { class: "cowork-file-actions hidden flex-wrap gap-1 border-t border-line p-2", dataset: { coworkFileActions: "" } });
  const workspace = h("main", { class: "cowork-workspace relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg", dataset: { coworkViewport: "" } });
  const status = h("span", { class: "min-h-5 truncate text-xs text-muted", role: "status" });
  const search = h("input", { class: "field h-9 text-xs", type: "search", placeholder: "Filter files", "aria-label": "Filter current Cowork folder" }) as HTMLInputElement;
  const agentPanel = h("aside", { class: "cowork-agent hidden min-h-0 w-[min(25rem,38vw)] shrink-0 flex-col border-l border-line bg-surface", dataset: { coworkAgent: "" } });
  const agentAvatar = () => {
    const value = channel.agent?.runtime?.avatar || "";
    const name = channel.agent?.display_name || channel.agent?.name || "Agent";
    const swatch = /^color:(#[0-9a-f]{6})$/i.exec(value)?.[1] || color(channel.agent?.name || "agent");
    const image = /^agent:([1-9]):#[0-9a-f]{6}$/i.exec(value);
    if (!value && channel.agent?.kind === "skipper") return h("img", { class: "h-9 w-9 rounded-full object-cover", src: "/brand/1helm-sailboat.png", alt: name, title: name });
    if (image) return h("span", { class: "grid h-9 w-9 place-items-center overflow-hidden rounded-full", style: `background:${swatch}`, title: name, "aria-label": name }, h("img", { class: "h-full w-full object-contain", src: `/agent-avatars/agent-${image[1]}.png`, alt: "" }));
    if (value.startsWith("data:image/") || value.startsWith("/")) return h("img", { class: "h-9 w-9 rounded-full object-cover", src: authenticatedAssetSrc(value), alt: name, title: name });
    return h("span", { class: "grid h-9 w-9 place-items-center rounded-full text-xs font-bold text-white", style: `background:${swatch}` }, initials(name));
  };
  const agentToggle = h("button", { class: "cowork-agent-toggle", type: "button", title: "Work with the channel agent", "aria-label": "Open Cowork agent panel", "aria-expanded": "false" }, agentAvatar());

  const activeSession = (): SectionSession => sessions.get(section)!;
  const activeSection = () => SECTIONS.find((candidate) => candidate.id === section)!;
  const threadKey = (path: string): string => `1helm.cowork.thread.${channelId}.${path || section}`;
  const contextPath = (session: SectionSession): string => session.path || session.folder;

  const syncCollaborationActivity = (): void => {
    const current = activeSession();
    for (const candidate of sessions.values()) candidate.collaboration?.setActive(surfaceActive && candidate === current);
  };

  const disposeEditor = (session: SectionSession): void => {
    session.loadVersion += 1;
    setFocusedSpeechTarget(null);
    session.presenceCleanup?.(); session.presenceCleanup = null;
    session.mounted?.destroy(); session.mounted = null;
    session.collaboration?.destroy(); session.collaboration = null;
    session.view = null;
  };

  /** y-websocket rooms are ephemeral. A disconnected Y.Doc must never be
   * reconnected after its server room has been reseeded from the file: Yjs
   * would merge both histories and duplicate the whole document. Every hidden
   * editor is destroyed and must reload the authoritative file into a new doc. */
  const resetEditor = (session: SectionSession): void => {
    disposeEditor(session);
    session.loaded = false;
    session.content = "";
    session.saved = "";
  };

  const openFolder = (path: string): void => {
    const session = activeSession();
    if (session.path) resetEditor(session);
    session.path = "";
    session.folder = path;
    selectedEntry = null;
    coworkContextPending = true;
    syncCollaborationActivity();
    void draw();
  };

  const disconnectEditors = (): void => {
    for (const candidate of sessions.values()) if (candidate.path) resetEditor(candidate);
  };

  const updateSectionNav = (): void => {
    clear(sectionNav);
    for (const item of SECTIONS) sectionNav.append(h("button", {
      class: `cowork-section ${section === item.id ? "is-active" : ""}`, type: "button", "aria-current": section === item.id ? "page" : undefined,
      onclick: () => {
        if (section === item.id) return;
        resetEditor(activeSession());
        section = item.id; filter = ""; selectedEntry = null; search.value = ""; coworkContextPending = true; syncCollaborationActivity(); void draw();
      },
    }, icon(item.icon, 15), item.label));
  };

  const drawBreadcrumb = (): void => {
    clear(breadcrumb);
    const session = activeSession();
    const segments = session.folder.split("/").filter(Boolean);
    const add = (label: string, path: string): void => {
      if (breadcrumb.childNodes.length) breadcrumb.append(h("span", { class: "text-faint" }, "/"));
      breadcrumb.append(h("button", { class: path === session.folder ? "shrink-0 text-fg" : "shrink-0 text-accent hover:underline", type: "button", onclick: () => openFolder(path) }, label));
    };
    add("workspace", activeSection().folder);
    segments.slice(1).forEach((segment, index) => add(segment, segments.slice(0, index + 2).join("/")));
  };

  const saveFile = async (): Promise<void> => {
    const session = activeSession();
    if (!session.path) return;
    if (session.mounted?.getContent) session.content = session.mounted.getContent();
    status.textContent = "Saving…";
    try {
      const result = await api<{ file: EditableFile }>(`/api/channels/${channelId}/files/text`, { method: "PATCH", body: { path: session.path, content: session.content } });
      session.saved = result.file.content; status.textContent = "Saved";
    } catch (error) { status.textContent = (error as Error).message; }
  };

  const markChanged = (session: SectionSession, content: string): void => {
    session.content = content;
    status.textContent = "Saving…";
    window.setTimeout(() => { if (activeSession() === session && status.textContent === "Saving…") status.textContent = "Saved live"; }, 700);
  };

  const presence = (session: SectionSession): HTMLElement => {
    const root = h("div", { class: "cowork-presence flex items-center -space-x-1", dataset: { coworkPresence: "" }, "aria-label": "People editing this file" });
    const paint = (): void => {
      clear(root); const users = session.collaboration?.awarenessUsers() || [];
      root.setAttribute("aria-label", users.length === 1 ? "Only you are editing" : `${users.length} people editing`);
      for (const user of users.slice(0, 5)) root.append(h("span", { class: "grid h-7 w-7 place-items-center rounded-full border-2 border-surface text-[9px] font-bold text-white", style: `background:${user.color}`, title: user.name, dataset: { coworkViewer: user.username } }, initials(user.name)));
      if (users.length > 5) root.append(h("span", { class: "grid h-7 w-7 place-items-center rounded-full border-2 border-surface bg-raised text-[9px] text-muted" }, `+${users.length - 5}`));
    };
    paint();
    const handler = () => paint();
    session.collaboration?.provider.awareness.on("change", handler);
    session.presenceCleanup = () => session.collaboration?.provider.awareness.off("change", handler);
    return root;
  };

  const commonToolbar = (session: SectionSession, left: Node | string, ...tools: Array<Node | null>): HTMLElement => h("div", { class: "cowork-editor-toolbar" },
    typeof left === "string" ? h("span", { class: "min-w-0 flex-1 truncate font-mono text-[11px] text-muted", title: left }, left) : left,
    ...tools, presence(session), h("button", { class: "btn-primary text-xs", type: "button", onclick: () => { void saveFile(); } }, "Save"));

  /** Resolve same-project relative CSS/JS so a static page previews like a site. */
  const inlineHtmlAssets = async (html: string, htmlPath: string): Promise<string> => {
    const baseDir = htmlPath.split("/").slice(0, -1).join("/");
    const resolve = (ref: string): string | null => {
      if (/^(?:[a-z]+:)?\/\//i.test(ref) || ref.startsWith("data:") || ref.startsWith("#")) return null;
      const parts = (ref.startsWith("/") ? ref.slice(1) : `${baseDir}/${ref}`).split("/");
      const out: string[] = [];
      for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") { out.pop(); continue; }
        out.push(part);
      }
      return out.join("/");
    };
    const fetchText = async (path: string): Promise<string | null> => {
      try { return (await api<{ file: EditableFile }>(`/api/channels/${channelId}/files/text?path=${encodeURIComponent(path)}`)).file.content; }
      catch { return null; }
    };
    let output = html;
    const linkTags = [...output.matchAll(/<link\b[^>]*?href=["']([^"']+)["'][^>]*>/gi)]
      .filter((match) => /rel=["']?stylesheet/i.test(match[0]));
    for (const match of linkTags) {
      const target = resolve(match[1]);
      if (!target) continue;
      const css = await fetchText(target);
      if (css != null) output = output.replace(match[0], `<style>\n${css}\n</style>`);
    }
    const scriptTags = [...output.matchAll(/<script\b[^>]*?src=["']([^"']+)["'][^>]*>\s*<\/script>/gi)];
    for (const match of scriptTags) {
      const target = resolve(match[1]);
      if (!target) continue;
      const js = await fetchText(target);
      if (js != null) output = output.replace(match[0], `<script>\n${js.replaceAll("</script>", "<\\/script>")}\n</script>`);
    }
    return output;
  };

  const textEditor = (session: SectionSession, mode: "notes" | "code" | "docs"): HTMLElement => {
    // Notes/Docs: rendered document surface (people never see raw Markdown).
    // Code: CodeMirror source editor. HTML files keep an optional site preview.
    const mounted = mode === "code"
      ? mountCodeMirror(session.collaboration!, session.path, "code", (content) => markChanged(session, content), () => { void saveFile(); })
      : mountDocumentSurface(session.collaboration!, mode, (content) => markChanged(session, content), () => { void saveFile(); });
    session.mounted = mounted;
    const editStage = h("div", {
      class: mode === "docs"
        ? "cowork-doc-page"
        : mode === "notes"
          ? "cowork-notes-editor-frame min-h-0 flex-1 overflow-hidden"
          : "min-h-0 flex-1 overflow-hidden",
    }, mounted.node);
    const format = (label: string, prefix: string, suffix = prefix, placeholder = "text") => h("button", {
      class: "btn-ghost text-xs", type: "button", title: label,
      onclick: () => mounted.format?.(prefix, suffix, placeholder),
    }, label);
    const htmlFile = mode === "code" && /\.html?$/i.test(session.path);
    const htmlStage = htmlFile ? h("div", { class: "hidden min-h-0 flex-1 overflow-hidden bg-white" }) : null;
    const htmlPreviewButton = htmlFile ? h("button", { class: "btn-subtle text-xs", type: "button", onclick: () => {
      void (async () => {
        session.preview = !session.preview;
        const button = htmlPreviewButton as HTMLButtonElement;
        if (session.preview) {
          button.disabled = true; button.textContent = "Loading…";
          const raw = session.mounted?.getContent?.() || session.content || "";
          let rendered = raw;
          try { rendered = await inlineHtmlAssets(raw, session.path); } catch { /* preview raw on failure */ }
          clear(htmlStage!);
          const frame = h("iframe", { class: "h-full w-full border-0", sandbox: "allow-scripts", title: `Preview of ${visibleName(session.path)}` }) as HTMLIFrameElement;
          frame.srcdoc = rendered;
          htmlStage!.append(frame);
          button.disabled = false;
        }
        htmlStage!.classList.toggle("hidden", !session.preview);
        editStage.classList.toggle("hidden", session.preview);
        button.textContent = session.preview ? "Return to code" : "Preview";
      })();
    } }, "Preview") : null;
    const speechTarget = {
      value: () => mounted.getContent?.() || "",
      replace: (content: string) => mounted.replaceContent?.(content),
      focus: () => mounted.focus(),
    };
    const dictation = mode === "notes" || mode === "docs" ? mountSpeechToTextControl(speechTarget, `Dictate ${mode === "docs" ? "document" : "note"}`) : null;
    if (dictation) mounted.node.addEventListener("focusin", () => setFocusedSpeechTarget(speechTarget, dictation));
    const toolbar = commonToolbar(session, `/workspace/${session.path}`,
      mode !== "code" ? format("Heading", "## ", "", "Heading") : null,
      mode !== "code" ? format("Bold", "**", "**") : null,
      mode !== "code" ? format("Italic", "_", "_") : null,
      mode === "docs" || mode === "notes" ? format("List", "- ", "", "List item") : null,
      dictation, htmlPreviewButton);
    const stage = mode === "notes"
      ? h("div", { class: "cowork-notes-edit-stage flex min-h-0 flex-1 flex-col overflow-hidden" }, editStage)
      : h("div", { class: `cowork-text-stage flex min-h-0 flex-1 flex-col ${mode === "code" ? "overflow-hidden" : "overflow-auto"}` }, editStage, ...(htmlStage ? [htmlStage] : []));
    return h("div", { class: `flex min-h-0 flex-1 flex-col ${mode === "docs" ? "cowork-doc-canvas" : ""}` }, toolbar, stage);
  };

  const whiteboardEditor = (session: SectionSession): HTMLElement => {
    try { JSON.parse(session.content || "{}"); }
    catch { return h("div", { class: "grid flex-1 place-items-center p-8 text-center text-sm text-muted" }, "This file is not a supported 1Helm whiteboard."); }
    const mounted = mountExcalidraw(session.collaboration!, me, "cowork-whiteboard-canvas", "Whiteboard canvas", (content) => markChanged(session, content));
    session.mounted = mounted;
    return h("div", { class: "flex min-h-0 flex-1 flex-col" }, commonToolbar(session, h("span", { class: "flex-1 text-xs text-muted" }, "Draw, type, connect, and arrange ideas on one shared canvas.")), mounted.node);
  };

  const presentationEditor = (session: SectionSession): HTMLElement => {
    let deck: Deck;
    try { deck = normalizeDeck(session.collaboration?.scene.get("json") || session.content); }
    catch { return h("div", { class: "grid flex-1 place-items-center p-8 text-center text-sm text-muted" }, "This file is not a supported 1Helm presentation."); }
    session.activeSlide = Math.min(session.activeSlide, Math.max(0, deck.slides.length - 1));
    const root = h("div", { class: "flex min-h-0 flex-1 flex-col", dataset: { coworkPresentation: "", slideCount: String(deck.slides.length), activeSlide: String(session.activeSlide) } });
    const structureSignature = (next: Deck): string => `${next.printableArea.width}x${next.printableArea.height}|${next.slides.map((slide) => `${slide.id}:${slide.name}`).join("|")}`;
    let structure = structureSignature(deck);
    const writeDeck = (next: Deck): void => { structure = structureSignature(next); const content = JSON.stringify(next, null, 2); session.collaboration!.scene.set("json", content); markChanged(session, content); };
    const adapter = {
      read: (content: string): SlideScene => { const next = normalizeDeck(content); return sceneWithPrintableBoundary(next.slides[session.activeSlide]?.scene || blankScene(), next.printableArea); },
      write: (scene: SlideScene, content: string): string => { const next = normalizeDeck(content); if (next.slides[session.activeSlide]) next.slides[session.activeSlide].scene = sceneWithoutPrintableBoundary(scene); return JSON.stringify(next, null, 2); },
    };
    const reopen = (): void => { session.mounted?.destroy(); session.mounted = null; session.view = null; void drawWorkspace(true); };
    let exportPending = false;
    const exportPdf = async (): Promise<void> => {
      if (exportPending) return;
      exportPending = true; status.textContent = `Exporting ${deck.slides.length} PDF page${deck.slides.length === 1 ? "" : "s"}…`;
      try { await presentationPdf(normalizeDeck(session.collaboration!.scene.get("json") || session.content), visibleName(session.path)); status.textContent = "PDF exported"; }
      catch (error) { status.textContent = (error as Error).message; }
      finally { exportPending = false; }
    };
    const mounted = mountExcalidraw(session.collaboration!, me, "cowork-slide-canvas", `Slide ${session.activeSlide + 1} canvas`, (content) => markChanged(session, content), { adapter, exportPdf, fitToContentElementId: PRINTABLE_BOUNDARY_ID });
    mounted.node.style.aspectRatio = `${deck.printableArea.width} / ${deck.printableArea.height}`;
    mounted.node.dataset.printableWidth = String(deck.printableArea.width);
    mounted.node.dataset.printableHeight = String(deck.printableArea.height);
    const remoteStructure = (): void => {
      try {
        const next = normalizeDeck(session.collaboration!.scene.get("json") || "");
        const signature = structureSignature(next);
        if (signature === structure) return;
        structure = signature; reopen();
      } catch { /* malformed remote content is handled by the normal editor error surface */ }
    };
    session.collaboration!.scene.observe(remoteStructure);
    const destroyMounted = mounted.destroy;
    mounted.destroy = () => { session.collaboration?.scene.unobserve(remoteStructure); destroyMounted(); };
    session.mounted = mounted;
    const slides = h("aside", { class: "cowork-slide-strip", "aria-label": "Slides" });
    // Slide clicks rebuild this whole editor; restore the strip's scroll
    // position afterwards (and keep the active thumb visible) instead of
    // snapping back to the top on every selection.
    slides.addEventListener("scroll", () => { session.slideStripScroll = slides.scrollTop; });
    requestAnimationFrame(() => {
      if (typeof session.slideStripScroll === "number") slides.scrollTop = session.slideStripScroll;
      const active = slides.querySelector<HTMLElement>(".cowork-slide-thumb.is-active");
      if (active) {
        const over = active.offsetTop < slides.scrollTop || active.offsetTop + active.offsetHeight > slides.scrollTop + slides.clientHeight;
        if (over) active.scrollIntoView({ block: "nearest" });
      }
    });
    deck.slides.forEach((slide, index) => {
      const open = h("button", { class: "min-w-0 flex-1 text-left", type: "button", onclick: () => { if (session.activeSlide === index) return; session.activeSlide = index; reopen(); } },
        h("span", { class: "text-[10px] text-faint" }, String(index + 1)),
        h("span", { class: "mt-1 block truncate text-xs font-semibold text-fg" }, slide.name));
      const actions = h("div", { class: "mt-1 flex justify-end gap-1" },
        h("button", { class: "cowork-slide-action", title: "Move slide up", disabled: index === 0, onclick: () => { [deck.slides[index - 1], deck.slides[index]] = [deck.slides[index], deck.slides[index - 1]]; session.activeSlide = index - 1; writeDeck(deck); reopen(); } }, "↑"),
        h("button", { class: "cowork-slide-action", title: "Move slide down", disabled: index === deck.slides.length - 1, onclick: () => { [deck.slides[index + 1], deck.slides[index]] = [deck.slides[index], deck.slides[index + 1]]; session.activeSlide = index + 1; writeDeck(deck); reopen(); } }, "↓"));
      slides.append(h("div", {
        class: `cowork-slide-thumb ${session.activeSlide === index ? "is-active" : ""}`,
        draggable: true,
        dataset: { slideIndex: String(index) },
        ondragstart: (event: DragEvent) => event.dataTransfer?.setData("text/plain", String(index)),
        ondragover: (event: DragEvent) => event.preventDefault(),
        ondrop: (event: DragEvent) => {
          event.preventDefault(); const from = Number(event.dataTransfer?.getData("text/plain"));
          if (!Number.isInteger(from) || from === index) return;
          const [moved] = deck.slides.splice(from, 1); deck.slides.splice(index, 0, moved);
          session.activeSlide = index; writeDeck(deck); reopen();
        },
      }, open, actions));
    });
    const present = (): void => {
      let at = session.activeSlide;
      const overlay = h("div", { class: "fixed inset-0 z-[100] flex flex-col bg-black", role: "dialog", "aria-label": "Presentation mode" });
      let viewer: MountedEditor | null = null;
      const stage = h("div", { class: "min-h-0 flex-1" });
      const paint = () => { viewer?.destroy(); clear(stage); const viewAdapter = { read: (content: string) => normalizeDeck(content).slides[at]?.scene || blankScene(), write: (_scene: SlideScene, content: string) => content }; viewer = mountExcalidraw(session.collaboration!, me, "cowork-presentation-view", `Presenting slide ${at + 1}`, () => undefined, { adapter: viewAdapter, presentation: true, viewMode: true }); stage.append(viewer.node); counter.textContent = `${at + 1} / ${deck.slides.length}`; };
      const close = () => { viewer?.destroy(); overlay.remove(); mounted.focus(); };
      const counter = h("span", { class: "font-mono text-xs text-white/70" });
      overlay.append(h("header", { class: "flex h-12 items-center gap-2 bg-black/80 px-3" }, h("span", { class: "flex-1 truncate text-sm text-white" }, visibleName(session.path)), h("button", { class: "btn-ghost text-white", disabled: at === 0, onclick: () => { at -= 1; paint(); } }, "Previous"), counter, h("button", { class: "btn-ghost text-white", disabled: at === deck.slides.length - 1, onclick: () => { at += 1; paint(); } }, "Next"), h("button", { class: "btn-subtle", onclick: close }, "Close")), stage); document.body.append(overlay); paint();
      overlay.onkeydown = (event) => { if (event.key === "Escape") close(); else if (event.key === "ArrowRight" && at < deck.slides.length - 1) { at += 1; paint(); } else if (event.key === "ArrowLeft" && at > 0) { at -= 1; paint(); } }; overlay.tabIndex = -1; overlay.focus();
    };
    const width = h("input", { class: "field h-8 w-20 px-2 text-xs", type: "number", min: "320", max: "5000", step: "10", value: String(deck.printableArea.width), "aria-label": "Printable width" }) as HTMLInputElement;
    const height = h("input", { class: "field h-8 w-20 px-2 text-xs", type: "number", min: "240", max: "5000", step: "10", value: String(deck.printableArea.height), "aria-label": "Printable height" }) as HTMLInputElement;
    const resize = (): void => { const area = printableArea({ width: width.value, height: height.value }); if (area.width === deck.printableArea.width && area.height === deck.printableArea.height) return; deck.printableArea = area; writeDeck(deck); reopen(); };
    width.onchange = resize; height.onchange = resize;
    const toolbar = commonToolbar(session, h("div", { class: "flex min-w-0 flex-1 items-center gap-2" }, h("span", { class: "truncate text-xs text-muted" }, `${deck.slides.length} slide${deck.slides.length === 1 ? "" : "s"}`), h("span", { class: "hidden text-[10px] font-semibold uppercase tracking-wide text-faint lg:inline" }, "Printable area"), width, h("span", { class: "text-xs text-muted" }, "×"), height),
      h("button", { class: "btn-subtle text-xs", onclick: () => { deck.slides.push({ id: crypto.randomUUID(), name: `Slide ${deck.slides.length + 1}`, scene: blankScene() }); session.activeSlide = deck.slides.length - 1; writeDeck(deck); reopen(); } }, icon("plus", 13), "Slide"),
      h("button", { class: "btn-ghost text-xs", onclick: () => { const copy = structuredClone(deck.slides[session.activeSlide]); copy.id = crypto.randomUUID(); copy.name = `${copy.name} copy`; deck.slides.splice(session.activeSlide + 1, 0, copy); session.activeSlide += 1; writeDeck(deck); reopen(); } }, "Duplicate"),
      h("button", { class: "btn-ghost text-xs text-danger", disabled: deck.slides.length <= 1, onclick: () => { deck.slides.splice(session.activeSlide, 1); session.activeSlide = Math.min(session.activeSlide, deck.slides.length - 1); writeDeck(deck); reopen(); } }, "Delete"),
      h("button", { class: "btn-subtle text-xs", onclick: present }, "Present"));
    root.append(toolbar, h("div", { class: "flex min-h-0 flex-1" }, slides, h("div", { class: "cowork-slide-stage" }, mounted.node)));
    return root;
  };

  const drawWorkspace = async (force = false): Promise<void> => {
    const session = activeSession(); clear(workspace);
    if (!session.path) {
      workspace.append(h("div", { class: "grid h-full place-items-center p-8 text-center" }, h("div", {}, h("span", { class: "mx-auto grid h-14 w-14 place-items-center rounded-xl bg-accent-soft text-accent" }, icon(activeSection().icon, 27)), h("h2", { class: "mt-4 font-display text-2xl text-fg" }, activeSection().label), h("p", { class: "mt-2 max-w-sm text-sm leading-6 text-muted" }, "Choose a file on the left or create one. Cowork edits the same files your channel agent sees in /workspace."))), agentToggle);
      return;
    }
    if (session.view && !force) { workspace.append(session.view, agentToggle); return; }
    if (section === "code" && /\.(?:db|sqlite)$/i.test(session.path)) {
      disposeEditor(session);
      workspace.append(h("div", { class: "grid h-full place-items-center p-8 text-center" }, h("div", {}, h("span", { class: "text-accent" }, fileIcon({ path: session.path, name: visibleName(session.path), size: 0, modified: 0, kind: "file" }, 32)), h("h3", { class: "mt-3 font-semibold text-fg" }, visibleName(session.path)), h("p", { class: "mt-2 text-sm text-muted" }, "File type not supported to view."))), agentToggle);
      return;
    }
    if (force) { session.presenceCleanup?.(); session.presenceCleanup = null; session.mounted?.destroy(); session.mounted = null; session.view = null; }
    if (!session.loaded) {
      const openingPath = session.path;
      const loadVersion = ++session.loadVersion;
      let openingCollaboration: CoworkDocument | null = null;
      workspace.append(h("div", { class: "grid h-full place-items-center text-sm text-muted" }, "Opening file…"));
      try {
        const result = await api<{ file: EditableFile }>(`/api/channels/${channelId}/files/text?path=${encodeURIComponent(openingPath)}`);
        if (session.loadVersion !== loadVersion || session.path !== openingPath) return;
        session.content = result.file.content; session.saved = result.file.content; session.loaded = true;
        openingCollaboration = connectCoworkDocument(channelId, openingPath, me);
        session.collaboration = openingCollaboration;
        syncCollaborationActivity();
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("The collaborative editor could not connect.")), 12_000);
          const synced = (ready: boolean) => { if (!ready) return; window.clearTimeout(timeout); openingCollaboration?.provider.off("sync", synced); resolve(); };
          openingCollaboration!.provider.on("sync", synced);
          // A fast local socket can finish its first sync between provider
          // construction and listener registration. Treat that durable state
          // as completion instead of leaving Cowork on “Opening file…” until
          // the timeout despite a healthy connected document.
          if (openingCollaboration!.provider.synced) synced(true);
        });
        if (session.loadVersion !== loadVersion || session.path !== openingPath || session.collaboration !== openingCollaboration) return;
        // y-websocket auto-reconnects this same Y.Doc after a silent socket
        // drop (laptop sleep, frozen background tab, server restart). When we
        // were the last viewer the server room was torn down, and reconnecting
        // reseeds a fresh doc from the file — syncing the old doc into it
        // merges two unrelated histories of the same text and duplicates the
        // document. Deliberate disconnect()/destroy() clears shouldConnect, so
        // only unexpected drops reach the reset: throw the stale doc away and
        // reload the authoritative file into a new one.
        openingCollaboration.provider.on("connection-close", () => {
          if (!openingCollaboration!.provider.shouldConnect) return;
          if (session.collaboration !== openingCollaboration || session.path !== openingPath) return;
          resetEditor(session);
          if (surfaceActive && activeSession() === session) void drawWorkspace();
        });
        const shared = openingPath.endsWith(".whiteboard.json") || openingPath.endsWith(".slides.json") ? openingCollaboration.scene.get("json") || "" : openingCollaboration.text.toString();
        // The synchronized file is authoritative. Keeping a second recovery
        // copy in localStorage previously resurrected stale text after agents or
        // collaborators changed the file and was the source of the misleading
        // “Restore unsaved changes?” loop. The server flushes live Yjs changes
        // on its debounce and again when the last editor disconnects.
        session.content = shared || session.content;
      } catch (error) {
        if (session.loadVersion !== loadVersion || session.path !== openingPath) return;
        disposeEditor(session); clear(workspace); workspace.append(h("div", { class: "grid h-full place-items-center p-8 text-center" }, h("div", {}, h("span", { class: "text-accent" }, fileIcon({ path: session.path, name: visibleName(session.path), size: 0, modified: 0, kind: "file" }, 32)), h("h3", { class: "mt-3 font-semibold text-fg" }, visibleName(session.path)), h("p", { class: "mt-2 text-sm text-muted" }, (error as Error).message || "File type not supported to view.")))); return;
      }
      clear(workspace);
    }
    if (!session.collaboration) return;
    session.view = section === "whiteboards" ? whiteboardEditor(session) : section === "presentations" ? presentationEditor(session) : textEditor(session, section === "code" ? "code" : section === "docs" ? "docs" : "notes");
    workspace.append(session.view, agentToggle);
  };

  const openPath = async (path: string): Promise<void> => {
    const normalized = path.replace(/^\/?workspace\/?/, "").replace(/^\/+/, "");
    const nextSection = sectionForPath(normalized);
    if (section !== nextSection) resetEditor(activeSession());
    section = nextSection; const session = activeSession();
    if (session.path !== normalized) { resetEditor(session); session.path = normalized; session.preview = false; session.activeSlide = 0; }
    session.folder = normalized.split("/").slice(0, -1).join("/") || activeSection().folder; selectedEntry = { path: normalized, name: visibleName(normalized), kind: "file", size: 0, modified: 0 };
    chatRootId = Number(localStorage.getItem(threadKey(normalized)) || 0); coworkContextPending = true; syncCollaborationActivity(); await draw();
  };

  const drawFileActions = (): void => {
    clear(fileActions); fileActions.classList.toggle("hidden", !selectedEntry);
    if (!selectedEntry) return;
    const rename = async () => { const name = await appPrompt("Rename file or folder", selectedEntry!.name); if (!name || name === selectedEntry!.name) return; const prior = selectedEntry!.path; const session = activeSession(); const active = session.path === prior; if (active) { disposeEditor(session); session.loaded = false; } try { const result = await api<{ entry: ChannelFile }>(`/api/channels/${channelId}/files/entries`, { method: "PATCH", body: { path: prior, name } }); if (active) session.path = result.entry.path; selectedEntry = result.entry; await draw(); } catch (error) { status.textContent = (error as Error).message; if (active) await drawWorkspace(); } };
    const move = async () => { const parent = await appPrompt("Move to folder inside /workspace", selectedEntry!.path.split("/").slice(0, -1).join("/")); if (parent == null) return; const prior = selectedEntry!.path; const session = activeSession(); const active = session.path === prior; if (active) { disposeEditor(session); session.loaded = false; } try { const result = await api<{ entry: ChannelFile }>(`/api/channels/${channelId}/files/entries`, { method: "PATCH", body: { path: prior, parent } }); if (active) { session.path = result.entry.path; session.folder = result.entry.path.split("/").slice(0, -1).join("/"); } selectedEntry = result.entry; await draw(); } catch (error) { status.textContent = (error as Error).message; if (active) await drawWorkspace(); } };
    const duplicate = async () => { try { const result = await api<{ entry: ChannelFile }>(`/api/channels/${channelId}/files/duplicate`, { body: { path: selectedEntry!.path } }); selectedEntry = result.entry; await loadFiles(); } catch (error) { status.textContent = (error as Error).message; } };
    const remove = async () => { if (!(await appConfirm(`Delete ${selectedEntry!.name}?`))) return; const prior = selectedEntry!.path; const session = activeSession(); const active = session.path === prior || session.path.startsWith(`${prior}/`); if (active) { disposeEditor(session); session.path = ""; session.loaded = false; } try { await api(`/api/channels/${channelId}/files/entries`, { method: "DELETE", body: { path: prior } }); selectedEntry = null; await draw(); } catch (error) { status.textContent = (error as Error).message; if (active) { session.path = prior; await drawWorkspace(); } } };
    fileActions.append(h("button", { class: "btn-ghost text-[11px]", onclick: () => { void rename(); } }, "Rename"), h("button", { class: "btn-ghost text-[11px]", onclick: () => { void move(); } }, "Move"), h("button", { class: "btn-ghost text-[11px]", onclick: () => { void duplicate(); } }, "Duplicate"), h("button", { class: "btn-ghost text-[11px] text-danger", onclick: () => { void remove(); } }, "Delete"));
  };

  const loadFiles = async (): Promise<void> => {
    const session = activeSession();
    try {
      const result = await api<{ files: ChannelFile[] }>(`/api/channels/${channelId}/files?path=${encodeURIComponent(session.folder)}`);
      clear(fileList); const visible = result.files.filter((file) => !filter || file.name.toLowerCase().includes(filter));
      if (!visible.length) fileList.append(h("p", { class: "px-2 py-8 text-center text-xs leading-5 text-faint" }, result.files.length ? "No matching files." : "This folder is empty."));
      for (const file of visible) {
        const row = h("button", {
          class: `group mb-0.5 flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left ${selectedEntry?.path === file.path ? "bg-accent-soft ring-1 ring-accent/40" : "hover:bg-hover"}`,
          type: "button",
          dataset: { coworkPath: file.path, coworkKind: file.kind },
          ondblclick: () => { if (file.kind === "directory") openFolder(file.path); else void openPath(file.path); },
          onclick: () => {
            selectedEntry = file; drawFileActions();
            // Opening a file already redraws the rail and workspace together.
            // Folders must also navigate on single click: rebuilding the list
            // here replaced the clicked row before a double-click could land,
            // which made directories look unopenable.
            if (file.kind === "file") void openPath(file.path); else openFolder(file.path);
          },
        },
        h("span", { class: file.kind === "directory" ? "text-muted" : "text-accent" }, fileIcon(file)),
        h("span", { class: "min-w-0 flex-1 truncate text-xs text-fg" }, file.name),
        file.kind === "file" ? h("span", { class: "font-mono text-[9px] text-faint" }, file.name.split(".").pop()?.toUpperCase() || "FILE") : h("span", { class: "text-[9px] text-faint" }, "FOLDER"));
        fileList.append(row);
      }
      drawFileActions();
    } catch (error) { fileList.replaceChildren(h("p", { class: "p-3 text-xs text-danger" }, (error as Error).message)); }
  };

  let agentWasWorking = false;
  let historyOpen = false;

  /** Past Cowork sessions for this file/folder: root messages stamped with the
   * working-context marker at send time. Client-side filter over the channel's
   * recent roots — no separate index required. */
  const loadContextHistory = async (context: string, folder: boolean): Promise<Message[]> => {
    const marker = `Working ${folder ? "folder" : "file"}: /workspace/${context}`;
    try {
      const result = await api<{ messages: Message[] }>(`/api/channels/${channelId}/messages?progress=summary`);
      return (result.messages || []).filter((message) => String(message.body || "").includes(marker)).reverse();
    } catch { return []; }
  };

  const renderChatMessages = async (): Promise<void> => {
    const stream = agentPanel.querySelector<HTMLElement>("[data-cowork-chat-stream]"); if (!stream || !chatRootId) return;
    const stick = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 60; const top = stream.scrollTop;
    try {
      const result = await api<{ root: Message; replies: Message[] }>(`/api/messages/${chatRootId}/thread?progress=summary`);
      const rows = [result.root, ...result.replies];
      const signature = rows.map((message) => `${message.id}:${message.body}:${(message.progress || []).map((step) => `${step.id}${step.status}`).join(",")}`).join("|");
      if (stream.dataset.signature === signature) return;
      stream.dataset.signature = signature; clear(stream);
      // One live status at a time: the latest progress step replaces the
      // previous. The full chain of thought stays in the main channel thread.
      let currentStep = "";
      let anyWorking = false;
      for (const message of rows) {
        const working = message.body === "_Working…_" || Boolean(message.progress?.some((step) => step.status === "running"));
        if (working) {
          anyWorking = true;
          const steps = message.progress || [];
          const live = [...steps].reverse().find((step) => step.status === "running") || steps.at(-1);
          if (live?.body) currentStep = live.body;
        }
        const body = message.body === "_Working…_" ? "" : message.body;
        if (!body && message.author.kind !== "user") continue;
        stream.append(h("article", { class: `cowork-chat-message ${message.author.kind === "user" ? "is-user" : ""}` },
          h("div", { class: "mb-1 text-[10px] font-semibold text-muted" }, message.author.kind === "user" ? "You" : message.author.name),
          h("div", { class: "md text-sm text-fg", html: md(body) })));
      }
      if (anyWorking) {
        stream.append(h("div", { class: "flex items-start gap-2 px-1 py-1.5", dataset: { coworkWorking: "" } },
          h("span", { class: "cowork-orb mt-0.5", "aria-hidden": "true" }),
          h("div", { class: "min-w-0 flex-1" },
            h("div", { class: "text-[11px] font-medium text-fg" }, `@${channel.agent?.name || "agent"} is working…`),
            currentStep ? h("div", { class: "cowork-live-step mt-0.5 truncate text-[10px] text-muted", title: currentStep }, currentStep) : null)));
      }
      // Agent turns create/rename files in this workspace. Refresh the rail
      // while a turn runs and once more when it settles so new artifacts
      // appear without switching sections or reloading the page.
      if (anyWorking !== agentWasWorking) {
        agentWasWorking = anyWorking;
        void loadFiles();
      } else if (anyWorking) void loadFiles();
      requestAnimationFrame(() => { stream.scrollTop = stick ? stream.scrollHeight : top; });
    } catch { /* a deleted/archived thread stays quiet until the user starts another */ }
  };

  const drawAgent = (): void => {
    agentPanel.classList.toggle("hidden", !agentOpen); agentPanel.classList.toggle("flex", agentOpen); agentToggle.setAttribute("aria-expanded", String(agentOpen));
    if (!agentOpen) { if (chatTimer != null) window.clearInterval(chatTimer); chatTimer = null; return; }
    const session = activeSession(); const context = contextPath(session); chatRootId = Number(localStorage.getItem(threadKey(context)) || 0);
    const stream = h("div", { class: "min-h-0 flex-1 space-y-3 overflow-y-auto p-3", dataset: { coworkChatStream: "" } });
    // The rounded wrapper below owns focus indication (focus-within border).
    // Without the explicit focus-visible suppression, the global a11y outline
    // draws a square rectangle around this inner textarea and clashes with it.
    const input = h("textarea", { class: "min-h-20 w-full resize-none bg-transparent p-2 text-sm text-fg outline-none focus-visible:outline-none placeholder:text-faint", rows: 3, placeholder: `Ask @${channel.agent?.name || "agent"} about this ${session.path ? "file" : "folder"}…`, value: agentDrafts.get(context) || "" }) as HTMLTextAreaElement;
    const dictate = mountSpeechToTextControl(input, "Dictate Cowork agent request");
    input.oninput = () => agentDrafts.set(context, input.value);
    input.onfocus = () => setFocusedSpeechTarget(input, dictate);
    const send = async (): Promise<void> => {
      const message = input.value.trim(); if (!message) return;
      input.disabled = true;
      try {
        const body = chatRootId ? message : `@${channel.agent?.name || "agent"} ${message}`;
            const result = await api<{ message: Message }>(`/api/channels/${channelId}/messages`, { body: { body, parentId: chatRootId || null, ...(coworkContextPending ? { coworkPath: context, coworkKind: session.path ? "file" : "folder" } : {}) } });
            if (!chatRootId) { chatRootId = result.message.id; localStorage.setItem(threadKey(context), String(chatRootId)); }
            coworkContextPending = false; input.value = ""; agentDrafts.delete(context); await renderChatMessages();
      } catch (error) { void appAlert((error as Error).message); }
      finally { input.disabled = false; input.focus(); }
    };
    input.onkeydown = (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } };
    const historyPane = h("div", { class: "hidden min-h-0 flex-1 overflow-y-auto p-3", dataset: { coworkHistory: "" } });
    const historyButton = h("button", {
      class: "grid h-8 w-8 place-items-center rounded text-muted hover:bg-hover",
      title: "Past sessions with this file", "aria-label": "Past sessions with this file", "aria-pressed": "false",
      onclick: async () => {
        historyOpen = !historyOpen;
        (historyButton as HTMLButtonElement).setAttribute("aria-pressed", String(historyOpen));
        historyButton.classList.toggle("text-accent", historyOpen);
        historyPane.classList.toggle("hidden", !historyOpen);
        stream.classList.toggle("hidden", historyOpen);
        if (!historyOpen) return;
        historyPane.replaceChildren(h("p", { class: "py-6 text-center text-xs text-muted" }, "Loading past sessions…"));
        const roots = await loadContextHistory(context, !session.path);
        if (!roots.length) {
          historyPane.replaceChildren(h("p", { class: "py-6 text-center text-xs leading-5 text-muted" }, `No past sessions with this ${session.path ? "file" : "folder"} yet.`));
          return;
        }
        historyPane.replaceChildren(
          h("p", { class: "mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-faint" }, `Past sessions · ${roots.length}`),
          ...roots.map((root) => {
            const preview = String(root.body || "").split("\n")[0].replace(/^@\S+\s*/, "").slice(0, 120) || "(untitled session)";
            const active = root.id === chatRootId;
            return h("button", {
              class: `mb-1 block w-full rounded-md border px-2.5 py-2 text-left hover:bg-hover ${active ? "border-accent/50 bg-accent-soft" : "border-line"}`,
              type: "button",
              onclick: () => {
                chatRootId = root.id;
                localStorage.setItem(threadKey(context), String(chatRootId));
                coworkContextPending = false;
                historyOpen = false;
                drawAgent();
              },
            },
            h("div", { class: "truncate text-xs text-fg" }, preview),
            h("div", { class: "mt-0.5 flex items-center gap-2 text-[10px] text-faint" },
              h("span", {}, new Date(root.created).toLocaleString()),
              root.reply_count ? h("span", {}, `${root.reply_count} repl${root.reply_count === 1 ? "y" : "ies"}`) : null,
              active ? h("span", { class: "text-accent" }, "current") : null));
          }));
      },
    }, icon("history", 15));
    clear(agentPanel);
    agentPanel.append(h("header", { class: "flex min-h-14 items-center gap-2 border-b border-line px-3" }, agentAvatar(), h("div", { class: "min-w-0 flex-1" }, h("div", { class: "truncate text-sm font-semibold text-fg" }, channel.agent?.display_name || channel.agent?.name || "Channel agent"), h("div", { class: "truncate text-[10px] text-muted" }, `/workspace/${context}`)), historyButton, chatRootId ? h("button", { class: "btn-ghost text-xs", onclick: async () => { try { const result = await api<{ root: Message }>(`/api/messages/${chatRootId}/thread?progress=summary`); openThreadCallback(result.root); } catch (error) { void appAlert((error as Error).message); } } }, "Open in Chat") : null, h("button", { class: "grid h-8 w-8 place-items-center rounded text-muted hover:bg-hover", "aria-label": "Close agent panel", onclick: () => { agentOpen = false; drawAgent(); } }, icon("x", 15))), stream, historyPane,
      h("div", { class: "border-t border-line p-2" }, chatRootId ? h("button", { class: "btn-ghost mb-1 text-[11px]", onclick: () => { chatRootId = 0; coworkContextPending = true; localStorage.removeItem(threadKey(context)); drawAgent(); } }, "New session") : h("p", { class: "px-2 pb-1 text-[11px] leading-4 text-muted" }, `Your first message starts a normal channel session with this ${session.path ? "file and its current collaborators" : "folder"}.`), h("div", { class: "rounded-lg border border-line bg-raised/40 focus-within:border-accent" }, input, h("div", { class: "flex justify-end gap-1 p-1.5" }, dictate, h("button", { class: "btn-primary text-xs", onclick: () => { void send(); } }, icon("send", 13), "Send")))));
    historyOpen = false;
    void renderChatMessages(); if (chatTimer != null) window.clearInterval(chatTimer); chatTimer = window.setInterval(() => { if (!shell.isConnected || !agentOpen) { if (chatTimer != null) window.clearInterval(chatTimer); chatTimer = null; return; } void renderChatMessages(); }, 1600);
    if (focusAgentOnDraw) requestAnimationFrame(() => input.focus({ preventScroll: true }));
    focusAgentOnDraw = false;
  };

  agentToggle.onclick = () => { agentOpen = !agentOpen; if (agentOpen) { focusAgentOnDraw = true; coworkContextPending = true; } drawAgent(); };
  search.oninput = () => { filter = search.value.trim().toLowerCase(); void loadFiles(); };
  const createFolder = async (): Promise<void> => { const name = await appPrompt("Folder name"); if (!name) return; try { await api(`/api/channels/${channelId}/files/directories`, { body: { path: activeSession().folder, name } }); await loadFiles(); } catch (error) { status.textContent = (error as Error).message; } };
  const createFile = async (): Promise<void> => {
    const item = activeSection();
    const input = await appPrompt(`New ${item.label.toLowerCase()} file`);
    const requested = input?.trim() || "";
    if (!requested) return;
    // A supplied suffix is deliberate, including compound formats such as
    // .slides.json. Only truly extensionless names receive the section default.
    const name = /\.[^./]+(?:\.[^./]+)*$/.test(requested) ? requested : `${requested}${item.defaultExtension}`;
    try {
      const result = await api<{ file: ChannelFile }>(`/api/channels/${channelId}/files/entries`, { body: { parent: activeSession().folder, name, content: starterContent(section) } });
      await openPath(result.file.path);
    } catch (error) { status.textContent = (error as Error).message; }
  };

  const draw = async (): Promise<void> => { updateSectionNav(); drawBreadcrumb(); await Promise.all([loadFiles(), drawWorkspace()]); drawAgent(); };
  const rail = h("aside", { class: "cowork-files flex min-h-0 w-[min(18rem,28vw)] shrink-0 flex-col border-r border-line bg-surface" }, h("div", { class: "space-y-2 border-b border-line p-3" }, h("div", { class: "flex items-center gap-2" }, breadcrumb, h("button", { class: "grid h-8 w-8 shrink-0 place-items-center rounded text-muted hover:bg-hover", title: "New folder", onclick: () => { void createFolder(); } }, icon("folder", 14)), h("button", { class: "grid h-8 w-8 shrink-0 place-items-center rounded bg-accent text-white", title: "New file", onclick: () => { void createFile(); } }, icon("plus", 14))), search), fileList, fileActions, h("div", { class: "min-h-9 border-t border-line px-3 py-2" }, status));
  shell.append(h("header", { class: "flex min-h-14 items-center gap-3 border-b border-line px-3 sm:px-4" }, h("div", { class: "min-w-0 flex-1" }, h("h2", { class: "font-display text-xl text-fg" }, "Cowork"), h("p", { class: "truncate text-xs text-muted" }, "Work directly in this channel's /workspace files"))), sectionNav, h("div", { class: "flex min-h-0 flex-1" }, rail, workspace, agentPanel));
  const surface: CoworkSurface = {
    node: shell,
    openPath,
    reload: async () => { await loadFiles(); },
    setOpenThread: (callback) => { openThreadCallback = callback; },
    setActive: (active) => {
      const returning = active && !surfaceActive;
      surfaceActive = active;
      if (returning) coworkContextPending = true;
      if (!active) disconnectEditors();
      else { syncCollaborationActivity(); if (activeSession().path) void drawWorkspace(); }
      if (returning && agentOpen) drawAgent();
    },
  };
  surfaces.set(channelId, surface); clear(container); container.append(shell);
  const staged = pendingPaths.get(channelId); pendingPaths.delete(channelId); if (staged) void openPath(staged); else void draw();
}
