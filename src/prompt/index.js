// The helper's system prompt (Muse overhaul, Stage 1). Two parts, in this order:
//   1. the static core: src/prompt/*.md, one file per section, bundled as text (wrangler "Text" rule for **/*.md; node tests load
//      them through test/stubs/register.mjs). Byte-identical for every person, channel and turn that share the same feature
//      switches (flags below), so the provider's prompt cache covers it. Feature switches only drop lines for tools a deployment
//      doesn't offer, so the prompt never names a tool or feature the helper doesn't have.
//   2. the per-person/channel block (channelBlock): names, tone, time zone, channel + purpose, General or not, saved keys/logins,
//      connected apps, pinned notes. Stable across turns; nothing per message (time, recall, to-dos) ever goes here: that rides
//      in the person's message, after the history.
// Syntax inside the .md files: {{#flag}}…{{/flag}} keeps the text only when the flag is on ({{^flag}}…{{/flag}} only when off; blocks of
// different flags may nest); {{name}} inserts a shared constant.
import whoYouAre from "./01-who-you-are.md";
import personalization from "./02-personalization.md";
import contextual from "./03-contextual-awareness.md";
import conversation from "./04-conversation-context.md";
import writing from "./05-writing-style.md";
import environment from "./06-environment.md";
import tools from "./07-tools.md";
import backgroundHelpers from "./08-background-helpers.md";
import scheduled from "./09-scheduled-work.md";
import channels from "./10-channels-and-tasks.md";
import interviews from "./11-interviews.md";
import files from "./12-computer-files.md";
import security from "./13-security.md";
import safety from "./14-safety.md";
import { STEP_TITLE_PROMPT } from "../steer.js";
import { HELPER_PROMPT } from "../helpers.js";
import { DOCS_INDEX } from "../docs/index.js";
import { SKILLS_INDEX, coreSkillsIndex } from "../skills/index.js";

export const SECTIONS = [
  ["01-who-you-are", whoYouAre], ["02-personalization", personalization], ["03-contextual-awareness", contextual],
  ["04-conversation-context", conversation], ["05-writing-style", writing], ["06-environment", environment], ["07-tools", tools],
  ["08-background-helpers", backgroundHelpers], ["09-scheduled-work", scheduled], ["10-channels-and-tasks", channels], ["11-interviews", interviews],
  ["12-computer-files", files], ["13-security", security], ["14-safety", safety],
];
// browser_task: the browser agent tool is offered · apps: Composio (Gmail/Calendar/app tools) · recall: memory recall arrives per
// message (memory mode "on") · compact: earlier turns are what was said + hand-off notes · cards: the app draws card replies ·
// app_events: apps AND this server has its Composio webhook (COMPOSIO_WEBHOOK_SECRET; composio-triggers.js eventsReady) ·
export const FLAGS = ["browser_task", "apps", "recall", "compact", "cards", "app_events"];
const CONSTS = { step_title: STEP_TITLE_PROMPT, helper_prompt: HELPER_PROMPT };

export function render(md, flags = {}) {
  // Blocks may nest (a different flag inside another's block): repeat until none is left.
  let s = String(md), prev;
  do { prev = s; s = s.replace(/\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g, (_, k, f, body) => ((k === "#") === !!flags[f] ? body : "")); } while (s !== prev);
  const C = { ...CONSTS, docs_index: DOCS_INDEX, skills_index: flags.ee === false ? coreSkillsIndex : SKILLS_INDEX };   // read at call time: docs/ and skills/ import render() (via docText) from here
  s = s.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in C ? C[k] : m));
  if (/\{\{/.test(s)) throw new Error(`prompt: unrendered tag in ${s.match(/\{\{[^}]*\}\}/)[0]}`);
  return s.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
const cache = new Map();
// The static core for one set of switches. Same switches → the same string, byte for byte.
export function staticCore(flags = {}) {
  const f = { ...Object.fromEntries(FLAGS.map((k) => [k, !!flags[k]])), ee: flags.ee !== false }, key = FLAGS.map((k) => (f[k] ? 1 : 0)).join("") + (f.ee ? "1" : "0");
  if (!cache.has(key)) cache.set(key, SECTIONS.map(([, md]) => render(md, f)).join("\n\n"));
  return cache.get(key);
}

const TONES = ["", "They asked you to be warm and chatty.", "They asked you to explain things simply, without jargon."];
// The per-person/channel block. o: { helperName, firstName, tone, tz, channel, purpose, general, recall, keysLine, loginsLine,
// appsLine, textingLine, pinned, pinnedLabel, recent }. Every line here is stable across the turns of a conversation.
export function channelBlock(o = {}) {
  const L = ["## This Person and This Channel"];
  L.push(o.helperName ? `Your name is ${o.helperName}.` : `The person hasn't named you yet; you can go by "your 1Helm helper".`);
  if (o.firstName) L.push(`The person's first name is ${o.firstName}; use it naturally when useful, not in every reply.`);
  if (TONES[Number(o.tone || 0)]) L.push(TONES[Number(o.tone || 0)]);
  L.push(`The person's time zone: ${o.tz}. Scheduled work runs in it.`);
  const ch = String(o.channel || "general");
  if (o.general) {
    L.push(`You're in General, home base (#${ch}). Channel purpose: ${o.purpose || "(none)"}.`);
    L.push(o.recall
      ? "Here you can see across all their channels: what you remember from their other channels arrives with each message, labeled by channel. Say which channel a fact came from. To save something into another channel's notes, pass that channel to remember."
      : "Here you see General's own notes; notes from their other channels aren't available right now.");
    L.push("Only here, and only when the person explicitly asks you to mark a task done or check it off, use mark_task_done with their own words. Never on your own, even when the work is clearly finished.");
  } else {
    L.push(`You're in the #${ch} channel. Channel purpose: ${o.purpose || "(none)"}.`);
    L.push(`What you remember here stays in this channel's notes. Other projects' notes aren't visible from this channel and you can't look them up. If they ask about another project, say it's kept in that channel and that General can see across all their channels.`);
  }
  L.push(o.keysLine || "Saved keys on this computer: none.");
  L.push(o.loginsLine || "Saved logins: none.");
  if (o.appsLine) L.push(String(o.appsLine).trim());
  if (o.textingLine) L.push(o.textingLine);   // texting.js textingPromptLine: their helper number + phone, or how to set it up
  if (o.permLine) L.push(o.permLine);
  if (o.skillsLine) L.push(o.skillsLine);   // this channel's own skills (skills/channel.js), only when it has any   // Settings → Permissions, only when stricter than Standard (perms.js)
  L.push("");
  L.push(`${o.pinnedLabel || "Pinned notes and preferences:"}\n${o.pinned || "(none)"}`);
  if (o.recent) { L.push(""); L.push(`Most recent messages from before this channel moved to 1Helm Cloud (for context only):\n${o.recent}`); }
  return L.join("\n");
}
