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
import { Excalidraw } from "@excalidraw/excalidraw";
import type { User } from "./api.ts";
import { h } from "./dom.ts";
import type { CoworkDocument } from "./cowork-collaboration.ts";

declare global { interface Window { EXCALIDRAW_ASSET_PATH?: string | string[] } }
// This module is eagerly bundled, and Excalidraw reads the global while its
// font registry initializes. Set it here as well as in index.html so embedded
// mobile shells and cached HTML can never fall back to the public CDN.
window.EXCALIDRAW_ASSET_PATH = `${location.origin}/excalidraw/`;

type ExcalidrawApi = {
  updateScene: (scene: Record<string, unknown>) => void;
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
};

export type MountedEditor = {
  node: HTMLElement;
  focus: () => void;
  destroy: () => void;
  getContent?: () => string;
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
  const extensions = [
    basicSetup,
    keymap.of([indentWithTab, { key: "Mod-s", run: () => { onSave(); return true; } }]),
    editorTheme,
    language.extension,
    yCollab(collaboration.text, collaboration.provider.awareness),
    EditorView.updateListener.of((update) => { if (update.docChanged) onChange(update.state.doc.toString()); }),
    EditorView.lineWrapping,
  ];
  const view = new EditorView({ parent: node, doc: collaboration.text.toString(), extensions });
  return {
    node,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    getContent: () => view.state.doc.toString(),
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
    avatarUrl: user.avatar || undefined,
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
  } = {},
): MountedEditor {
  const node = h("div", { class: `cowork-excalidraw ${className}`, "aria-label": label, dataset: { excalidrawCanvas: "" } });
  const root: Root = createRoot(node);
  let api: ExcalidrawApi | null = null;
  let applyingRemote = false;
  let destroyed = false;
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
    excalidrawAPI: (value) => { api = value as unknown as ExcalidrawApi; updatePresence(); },
    initialData: { elements: scene.elements as never, appState: { ...scene.appState, collaborators: canvasCollaborators(collaboration, me) } as never, files: scene.files as never },
    theme: document.documentElement.classList.contains("light") ? "light" : "dark",
    name: label,
    isCollaborating: true,
    zenModeEnabled: Boolean(options.presentation),
    viewModeEnabled: Boolean(options.viewMode),
    UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false } },
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
  root.render(React.createElement(Excalidraw, props));
  return {
    node,
    focus: () => node.querySelector<HTMLElement>("canvas")?.focus({ preventScroll: true }),
    destroy: () => { destroyed = true; collaboration.scene.unobserve(updateRemote); collaboration.provider.awareness.off("change", updatePresence); window.removeEventListener("themechange", updateTheme); root.unmount(); },
  };
}
