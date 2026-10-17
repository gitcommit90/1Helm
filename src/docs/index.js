// 1Helm's own docs for the helper (Muse overhaul, Stage 2): src/docs/*.md, bundled as text like src/prompt/*.md (wrangler "Text"
// rule for **/*.md; node tests load them through test/stubs/register.mjs). The helper reads one with read_doc({ name }) before it
// answers a question about 1Helm, its own abilities or how 1Helm handles data. No computer start; read-only; offered in every channel
// and to background helpers.
// - DOCS is the one list: name, one-line summary (shown in the static core's docs index and in read_doc's "unknown name" answer), text.
// - Same {{#flag}}…{{/flag}} syntax as the prompt (render() from src/prompt/index.js), so a doc only describes what this
//   deployment really has (flags: the prompt's switches).
// - Lines starting with "TODO(Captain)" are notes for the Captain (facts nobody has confirmed yet). They show on the parity page
//   and are never served to the helper.
// Facts in these docs come from the code and the live app. A new feature adds its doc lines (and its prompt line) in the same change.
import product from "./1helm.md";
import browser from "./browser.md";
import connectors from "./connectors.md";
import payments from "./payments-and-purchases.md";
import privacy from "./privacy-and-credentials.md";
import scheduling from "./scheduling-and-watching.md";
import files from "./files-and-library.md";
import memory from "./memory.md";
import texting from "./texting.md";
import surfaces from "./client-surfaces.md";
import data from "./data-handling.md";
import security from "./security.md";
import { render } from "../prompt/index.js";

export const DOCS = [
  { name: "security", summary: "verified security answers: encryption in transit and at rest, HTTPS and TLS, encrypted backups and tested recovery, saved credentials", md: security },
  { name: "1helm", summary: "what 1Helm is: one helper, channels and tasks, plans, billing, storage and canceling, which AI models answer, the app's main parts", md: product },
  { name: "client-surfaces", summary: "the web app on a computer and a phone, every Settings section, notifications, Report an issue, Stop and automatic pauses, plans, Activity, to-dos, focus timer, send later, dictation", md: surfaces },
  { name: "memory", summary: "what you remember and where, the Notebook, Contacts (import, merge), the work log, General vs other channels, how to correct or delete something", md: memory },
  { name: "connectors", summary: "connecting apps (Gmail, Google Calendar, Slack and more), finding an app and offering to connect it, several accounts and account notes, which account to check, disconnecting", md: connectors },
  { name: "browser", summary: "your browser and web search: what it reaches, signing in, watching and taking over, downloads, what it can't do", md: browser },
  { name: "payments-and-purchases", summary: "buying things with Link: the steps, approvals, the one-time card, refunds and cancellations", md: payments },
  { name: "privacy-and-credentials", summary: "Passwords & keys, saved logins, stand-in keys, the checkpoint and approvals, permission levels (Standard, Careful, Locked down), one-time codes", md: privacy },
  { name: "scheduling-and-watching", summary: "workflows (on a schedule or when an app event happens), follow-ups and gates: how scheduled work and watching really work, where results go, and the Scheduled view (pause, resume, stop, cancel)", md: scheduling },
  { name: "files-and-library", summary: "your computer's files and command time limits, uploads, the Library, share links and published pages, storage limits, what survives a restart", md: files },
  { name: "texting", summary: "texting from their phone (iMessage, or text messages on Android): setup, what you can send back, pictures and files, heads-up texts, limits, texting other people", md: texting },
  { name: "data-handling", summary: "how the person's information is handled: who processes it, what they control, how to delete a chat, a channel or the account", md: data },
];
export const DOC_NAMES = DOCS.map((d) => d.name);

// The docs index for the static core: one line per doc. Byte-identical for everyone.
export const DOCS_INDEX = DOCS.map((d) => `- ${d.name}: ${d.summary}`).join("\n");

const TODO_LINE = /^\s*(?:[-*>]\s*)?TODO\(Captain\)[^\n]*(?:\n|$)/gm;
// What the helper gets: flags rendered, Captain's notes removed.
export function docText(md, flags = {}) { return render(String(md).replace(TODO_LINE, ""), flags); }
// "Connectors.md", " connectors ", "Payments and purchases" → "payments-and-purchases".
export const docKey = (s) => String(s ?? "").trim().toLowerCase().replace(/\.md$/, "").replace(/^.*\//, "").replace(/[\s_]+/g, "-");
export function findDoc(name) { const k = docKey(name); return DOCS.find((d) => d.name === k) || null; }

export const READ_DOC_TOOL = { type: "function", function: { name: "read_doc",
  description: "Read one of 1Helm's docs: security, encryption, data handling, apps, browser, payments, passwords and keys, scheduling, files, memory, texting and Settings. For security questions read security first; for other questions read the matching doc. Answer directly from its verified facts. Fast, read-only, no computer needed. An unknown name returns the list of docs.",
  parameters: { type: "object", properties: { name: { type: "string", description: `The doc's name, one of: ${DOC_NAMES.join(", ")}` } }, required: ["name"] } } };

const listText = () => `Docs you can read (pass the name to read_doc):\n${DOCS_INDEX}`;
// read_doc({ name }) → the doc's text, or the list of names with their summaries.
export function readDoc(a = {}, flags = {}) {
  const d = findDoc(a?.name);
  if (!d) return `${String(a?.name ?? "").trim() ? `There's no doc called "${String(a.name).trim().slice(0, 80)}". ` : ""}${listText()}`;
  return `[1Helm doc: ${d.name}]\n${docText(d.md, flags)}`;
}
