import { basicSetup, EditorView } from "codemirror";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { yCollab } from "y-codemirror.next";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
type User = { id: number; username: string; display: string; avatar: string };
import { authenticatedAssetSrc } from "./avatar-assets.ts";
import { h, markdownFromHtml, md, textReplaceOps } from "./dom.ts";
import type { CoworkDocument } from "./cowork-collaboration.ts";

/** True when at least one transaction in the update was produced by local typing. */
function updateFromLocalUser(update: { transactions: readonly { isUserEvent: (event: string) => boolean }[] }): boolean {
  return update.transactions.some((transaction) =>
    transaction.isUserEvent("input")
    || transaction.isUserEvent("delete")
    || transaction.isUserEvent("move")
    || transaction.isUserEvent("undo")
    || transaction.isUserEvent("redo")
    || transaction.isUserEvent("paste"));
}

function applyYTextContent(text: { toString: () => string; delete: (start: number, len: number) => void; insert: (start: number, value: string) => void }, content: string): void {
  const ops = textReplaceOps(text.toString(), content);
  if (!ops) return;
  if (ops.deleteLen > 0) text.delete(ops.start, ops.deleteLen);
  if (ops.insert) text.insert(ops.start, ops.insert);
}

/**
 * Notes/Docs: people edit rendered prose, never raw Markdown.
 * Durable storage + Yjs stay Markdown for agents and collaboration.
 */
export function mountDocumentSurface(
  collaboration: CoworkDocument,
  mode: "notes" | "docs",
  onChange: (content: string) => void,
  onSave: () => void,
): MountedEditor {
  const label = mode === "docs" ? "Docs editor" : "Notes editor";
  const node = h("div", {
    class: `cowork-document-surface cowork-document-surface-${mode}`,
    dataset: { coworkEditor: mode },
  });
  const surface = h("div", {
    class: "md cowork-document-body",
    contenteditable: "true",
    role: "textbox",
    spellcheck: "true",
    "aria-multiline": "true",
    "aria-label": label,
    dataset: { coworkDocumentBody: mode },
  }) as HTMLDivElement;
  node.append(surface);

  let applyingRemote = false;
  let lastMarkdown = collaboration.text.toString();
  let paintGeneration = 0;

  const paintFromMarkdown = (source: string): void => {
    const gen = ++paintGeneration;
    const scrollTop = surface.scrollTop;
    applyingRemote = true;
    const html = md(source || "");
    surface.innerHTML = html || "<p><br></p>";
    // Restore scroll after remote/agent rewrites so idle reading mid-doc holds.
    requestAnimationFrame(() => {
      if (gen !== paintGeneration) return;
      const max = Math.max(0, surface.scrollHeight - surface.clientHeight);
      surface.scrollTop = Math.min(scrollTop, max);
      applyingRemote = false;
    });
  };

  paintFromMarkdown(lastMarkdown);

  const pushLocal = (): void => {
    if (applyingRemote) return;
    const next = markdownFromHtml(surface);
    if (next === lastMarkdown) return;
    lastMarkdown = next;
    applyingRemote = true;
    collaboration.doc.transact(() => {
      applyYTextContent(collaboration.text, next);
    });
    applyingRemote = false;
    onChange(next);
  };

  // input covers typing; debounce coalesces rapid keystrokes / IME.
  let inputTimer: number | null = null;
  const schedulePush = (): void => {
    if (applyingRemote) return;
    if (inputTimer != null) window.clearTimeout(inputTimer);
    inputTimer = window.setTimeout(() => {
      inputTimer = null;
      pushLocal();
    }, 40);
  };
  surface.addEventListener("input", schedulePush);
  surface.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (inputTimer != null) { window.clearTimeout(inputTimer); inputTimer = null; }
      pushLocal();
      onSave();
    }
  });

  const onY = (): void => {
    if (applyingRemote) return;
    const remote = collaboration.text.toString();
    if (remote === lastMarkdown) return;
    lastMarkdown = remote;
    paintFromMarkdown(remote);
    onChange(remote);
  };
  collaboration.text.observe(onY);

  const runFormat = (command: string, value?: string): void => {
    surface.focus();
    try { document.execCommand(command, false, value); } catch { /* ignore unsupported */ }
    pushLocal();
  };

  return {
    node,
    focus: () => surface.focus(),
    destroy: () => {
      if (inputTimer != null) window.clearTimeout(inputTimer);
      collaboration.text.unobserve(onY);
    },
    getContent: () => {
      if (inputTimer != null) { window.clearTimeout(inputTimer); inputTimer = null; }
      pushLocal();
      // Native contenteditable formatting uses browser-specific tags (`<b>` in
      // Chromium). Save already canonicalizes those to Markdown; repaint only at
      // this explicit boundary so the live editor becomes canonical rendered
      // HTML (`<strong>`) without replacing the DOM during typing.
      paintFromMarkdown(lastMarkdown);
      return lastMarkdown;
    },
    replaceContent: (content) => {
      lastMarkdown = content;
      applyingRemote = true;
      collaboration.doc.transact(() => applyYTextContent(collaboration.text, content));
      paintFromMarkdown(content);
      onChange(content);
      surface.focus();
    },
    format: (prefix, suffix = prefix, placeholder = "text") => {
      // Toolbar maps semantic actions; ignore raw md wrappers when possible.
      if (prefix.startsWith("#")) {
        const level = Math.min(6, Math.max(1, prefix.replace(/[^#]/g, "").length || 2));
        runFormat("formatBlock", `h${level}`);
        return;
      }
      if (prefix === "**" && suffix === "**") { runFormat("bold"); return; }
      if ((prefix === "_" || prefix === "*") && (suffix === "_" || suffix === "*")) { runFormat("italic"); return; }
      if (prefix.startsWith("- ") || prefix.startsWith("* ")) { runFormat("insertUnorderedList"); return; }
      if (/^\d+[.)]\s/.test(prefix)) { runFormat("insertOrderedList"); return; }
      // Fallback: wrap selection as plain text insertion of md (rare).
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      const selected = range.toString() || placeholder;
      range.deleteContents();
      range.insertNode(document.createTextNode(`${prefix}${selected}${suffix}`));
      pushLocal();
    },
    selection: () => {
      const text = surface.innerText || "";
      return { from: 0, to: text.length };
    },
  };
}

declare global { interface Window { EXCALIDRAW_ASSET_PATH?: string | string[] } }
// This module is eagerly bundled, and Excalidraw reads the global while its
// font registry initializes. Set it here as well as in index.html so embedded
// mobile shells and cached HTML can never fall back to the public CDN.
window.EXCALIDRAW_ASSET_PATH = `${location.origin}/excalidraw/`;

type ExcalidrawApi = {
  updateScene: (scene: Record<string, unknown>) => void;
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  scrollToContent: (target: readonly unknown[], options: { fitToContent: boolean; animate: boolean; viewportZoomFactor: number }) => void;
};

export type MountedEditor = {
  node: HTMLElement;
  focus: () => void;
  destroy: () => void;
  getContent?: () => string;
  replaceContent?: (content: string) => void;
  format?: (prefix: string, suffix?: string, placeholder?: string) => void;
  selection?: () => { from: number; to: number };
};

function languageFor(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (["js", "jsx", "mjs", "cjs"].includes(extension || "")) return { name: "javascript", extension: javascript({ jsx: extension === "jsx" }) };
  if (["ts", "tsx", "mts", "cts"].includes(extension || "")) return { name: "typescript", extension: javascript({ jsx: extension === "tsx", typescript: true }) };
  if (extension === "json") return { name: "json", extension: json() };
  if (extension === "py") return { name: "python", extension: python() };
  if (["html", "htm", "svg", "xml"].includes(extension || "")) return { name: "html", extension: html() };
  if (["css", "scss", "less"].includes(extension || "")) return { name: "css", extension: css() };
  if (["sql", "sqlite"].includes(extension || "")) return { name: "sql", extension: sql() };
  if (["yaml", "yml"].includes(extension || "")) return { name: "yaml", extension: yaml() };
  if (["md", "mdx", "markdown"].includes(extension || "")) return { name: "markdown", extension: markdown() };
  return { name: "plain-text", extension: [] };
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", background: "transparent", color: "var(--c-fg)" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.65" },
  ".cm-content": { caretColor: "var(--c-accent)", padding: "1rem 0" },
  ".cm-gutters": { background: "color-mix(in srgb, var(--c-surface) 92%, transparent)", color: "var(--c-faint)", borderRight: "1px solid var(--c-line)" },
  ".cm-activeLine, .cm-activeLineGutter": { background: "color-mix(in srgb, var(--c-accent) 8%, transparent)" },
  ".cm-selectionBackground, ::selection": { background: "color-mix(in srgb, var(--c-accent) 28%, transparent) !important" },
  ".cm-searchMatch": { background: "#f2c94c55" },
});

export function mountCodeMirror(
  collaboration: CoworkDocument,
  path: string,
  mode: "notes" | "docs" | "code",
  onChange: (content: string) => void,
  onSave: () => void,
): MountedEditor {
  const node = h("div", { class: `cowork-codemirror cowork-codemirror-${mode}`, dataset: { coworkEditor: mode }, "aria-label": `${mode === "code" ? "Code" : mode === "docs" ? "Docs" : "Notes"} editor` });
  const language = languageFor(path);
  node.dataset.coworkLanguage = language.name;
  // Remote Yjs → CodeMirror updates (server reseed, collaborator, agent write)
  // have no userEvent annotation. Capture scroll before layout settles and
  // restore after so idle readers mid-document are not slammed to the top.
  let pendingRemoteScroll: number | null = null;
  const extensions = [
    basicSetup,
    keymap.of([indentWithTab, { key: "Mod-s", run: () => { onSave(); return true; } }]),
    editorTheme,
    language.extension,
    yCollab(collaboration.text, collaboration.provider.awareness),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (!updateFromLocalUser(update)) {
        if (pendingRemoteScroll == null) pendingRemoteScroll = update.view.scrollDOM.scrollTop;
        const keep = pendingRemoteScroll;
        requestAnimationFrame(() => {
          const scroller = update.view.scrollDOM;
          const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = Math.min(keep, max);
          pendingRemoteScroll = null;
        });
      } else {
        pendingRemoteScroll = null;
      }
      onChange(update.state.doc.toString());
    }),
    EditorView.lineWrapping,
  ];
  const view = new EditorView({ parent: node, doc: collaboration.text.toString(), extensions });
  return {
    node,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    getContent: () => view.state.doc.toString(),
    replaceContent: (content) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content }, selection: { anchor: content.length } });
      view.focus();
    },
    format: (prefix, suffix = prefix, placeholder = "text") => {
      const range = view.state.selection.main;
      const selected = view.state.sliceDoc(range.from, range.to) || placeholder;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: `${prefix}${selected}${suffix}` },
        selection: { anchor: range.from + prefix.length, head: range.from + prefix.length + selected.length },
      });
      view.focus();
    },
    selection: () => ({ from: view.state.selection.main.from, to: view.state.selection.main.to }),
  };
}

type Scene = { elements: readonly unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> };

function parseScene(content: string): Scene {
  const parsed = JSON.parse(content || "{}");
  if (!Array.isArray(parsed.elements)) throw new Error("Unsupported canvas file");
  return { elements: parsed.elements, appState: parsed.appState || {}, files: parsed.files || {} };
}

function canvasCollaborators(collaboration: CoworkDocument, me: User) {
  const users = collaboration.awarenessUsers().filter((user) => user.id !== me.id);
  const states = [...collaboration.provider.awareness.getStates().values()];
  return new Map(users.map((user) => [String(user.id), {
    id: String(user.id),
    socketId: String(user.id),
    username: user.name,
    avatarUrl: user.avatar ? authenticatedAssetSrc(user.avatar) : undefined,
    color: { background: user.color, stroke: user.color },
    pointer: states.find((state: Record<string, any>) => state.user?.id === user.id)?.canvasPointer,
  }]));
}

export function mountExcalidraw(
  collaboration: CoworkDocument,
  me: User,
  className: string,
  label: string,
  onChange: (content: string) => void,
  options: {
    presentation?: boolean;
    viewMode?: boolean;
    adapter?: {
      read: (content: string) => Scene;
      write: (scene: Scene, content: string) => string;
    };
    exportPdf?: () => void | Promise<void>;
    fitToContentElementId?: string;
  } = {},
): MountedEditor {
  const node = h("div", { class: `cowork-excalidraw ${className}`, "aria-label": label, dataset: { excalidrawCanvas: "" } });
  const root: Root = createRoot(node);
  let api: ExcalidrawApi | null = null;
  let applyingRemote = false;
  let destroyed = false;
  let fitFrame = 0;
  let last = collaboration.scene.get("json") || JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });
  const read = options.adapter?.read || parseScene;
  const write = options.adapter?.write || ((next: Scene) => JSON.stringify({ type: "excalidraw", version: 2, ...next }, null, 2));
  let scene: Scene;
  try { scene = read(last); }
  catch { scene = { elements: [], appState: {}, files: {} }; }
  const paintSceneMetadata = (next: Scene): void => {
    node.dataset.sceneElements = String(next.elements.filter((element: any) => !element?.isDeleted).length);
  };
  paintSceneMetadata(scene);
  const updateRemote = (): void => {
    const next = collaboration.scene.get("json") || "";
    if (!api || !next || next === last) return;
    try {
      const remote = read(next); last = next; applyingRemote = true; paintSceneMetadata(remote);
      api.updateScene({ elements: remote.elements, appState: { ...remote.appState, collaborators: canvasCollaborators(collaboration, me) } });
      applyingRemote = false;
    } catch { applyingRemote = false; }
  };
  const updatePresence = (): void => {
    if (!api) return;
    api.updateScene({ appState: { collaborators: canvasCollaborators(collaboration, me) } });
  };
  const updateTheme = (event: Event): void => {
    if (!api) return;
    const requested = (event as CustomEvent<"light" | "dark">).detail;
    api.updateScene({ appState: { theme: requested === "light" || requested === "dark" ? requested : document.documentElement.classList.contains("light") ? "light" : "dark" } });
  };
  collaboration.scene.observe(updateRemote);
  collaboration.provider.awareness.on("change", updatePresence);
  window.addEventListener("themechange", updateTheme);
  const props: React.ComponentProps<typeof Excalidraw> = {
    excalidrawAPI: (value) => {
      api = value as unknown as ExcalidrawApi;
      updatePresence();
      if (options.fitToContentElementId) {
        node.dataset.initialFit = "pending";
        const fit = (): void => {
          if (!api || destroyed) return;
          if (!node.isConnected || node.clientWidth < 1 || node.clientHeight < 1) { fitFrame = requestAnimationFrame(fit); return; }
          const target = scene.elements.filter((element: any) => element?.id === options.fitToContentElementId);
          api.scrollToContent(target.length ? target : scene.elements, { fitToContent: true, animate: false, viewportZoomFactor: 0.88 });
          fitFrame = requestAnimationFrame(() => {
            if (!api || destroyed) return;
            const zoom = api.getAppState().zoom as { value?: number } | undefined;
            node.dataset.initialZoom = String(zoom?.value || "");
            node.dataset.initialFit = "complete";
          });
        };
        fitFrame = requestAnimationFrame(() => { fitFrame = requestAnimationFrame(fit); });
      }
    },
    initialData: { elements: scene.elements as never, appState: { ...scene.appState, collaborators: canvasCollaborators(collaboration, me) } as never, files: scene.files as never },
    theme: document.documentElement.classList.contains("light") ? "light" : "dark",
    name: label,
    isCollaborating: true,
    zenModeEnabled: Boolean(options.presentation),
    viewModeEnabled: Boolean(options.viewMode),
    UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } },
    onPointerUpdate: (payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "up" | "down" }) => {
      collaboration.provider.awareness.setLocalStateField("canvasPointer", { ...payload.pointer, button: payload.button });
    },
    onChange: (elements, appState, files) => {
      if (applyingRemote || destroyed) return;
      const stableState = {
        viewBackgroundColor: appState.viewBackgroundColor,
        gridSize: appState.gridSize,
        gridStep: appState.gridStep,
        gridModeEnabled: appState.gridModeEnabled,
      };
      const content = write({ elements, appState: stableState, files }, last);
      paintSceneMetadata({ elements, appState: stableState, files });
      if (content === last) return;
      last = content; collaboration.scene.set("json", content); onChange(content);
    },
  };
  const menu = options.exportPdf ? React.createElement(MainMenu, null,
    React.createElement(MainMenu.Item, { onSelect: () => { void options.exportPdf?.(); }, value: "export-pdf", children: "Export PDF" }),
    React.createElement(MainMenu.Separator),
    React.createElement(MainMenu.DefaultItems.ToggleTheme),
    React.createElement(MainMenu.DefaultItems.ChangeCanvasBackground)) : null;
  root.render(React.createElement(Excalidraw, props, menu));
  return {
    node,
    focus: () => node.querySelector<HTMLElement>("canvas")?.focus({ preventScroll: true }),
    destroy: () => { destroyed = true; if (fitFrame) cancelAnimationFrame(fitFrame); collaboration.scene.unobserve(updateRemote); collaboration.provider.awareness.off("change", updatePresence); window.removeEventListener("themechange", updateTheme); root.unmount(); },
  };
}
