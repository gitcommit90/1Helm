// Memory Overhaul phase 2 (the design notes): the bank templates 1HC imports into every
// Hindsight bank, the placeholder filling, the named context strings and the speaker labels. Pure functions, no network.
// Everything here is used only when HS_FOUNDATIONS is "on" (hsFoundations); with the flag off, 1HC behaves as before.
import general from "./hindsight-templates/general.json" with { type: "json" };
import channel from "./hindsight-templates/channel.json" with { type: "json" };
import { helperName } from "./helper-name.js";
const RAW = { general, channel };

// Bump when a template file changes, so every bank imports it again (the key below holds it).
export const TEMPLATE_VERSION = "p10-4";   // p10-4: every mental model refreshes on trigger.refresh_cron "0 10,22 * * *" (UTC, twice a day, and only when memories in its scope changed) instead of after every consolidation, and the 1,800 second minimum refresh interval is gone from the bank and the models (Captain 2026-10-18; the models only restate what the facts and notes already hold); was p10-3. p10-3: the LANGUAGE RULE sentence is back as the first sentence of retain_mission (bank and the ambient strategy) and observations_mission, in both templates (Captain 2026-10-15; the p9 removal let the retain model switch language on 18% of English calls); was p10-2. p10-2: min_refresh_interval_seconds 1,800 (bank setting and the people, places and decisions models; was 3,600), as DESIGN section 8 says; was p10-1. p10: Notebook pages (Memory Overhaul phase 6): mental models people and places (General) and decisions (project channels), and the directive that honors the person's corrections; was p9-1. p9: no language rule in the missions and no language directive (Hindsight detects the language itself), and no topic mental models (topic-food, topic-how, topic-home); was p8-1 (p8-2 with HS_USE). Earlier history: p8: observations_mission starts with a language rule; p6: the raw-transcript strategy; p4a-1 the HS_USE topic models.
export const hsFoundations = (env) => String(env?.HS_FOUNDATIONS || "").toLowerCase() === "on";
// How many mental models a kind of bank refreshes (the page models and the prompt models); the meter charges one refresh run for each.
export const templateModelCount = (kind) => (RAW[kind]?.mental_models || []).length;
export const templateKind = (slug) => (slug === "main" ? "general" : "channel");

const one = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
// The four placeholder values. Braces and line breaks are removed, so a value can never add a placeholder or break a sentence.
export function templateVars({ first, helper, channel: ch, purpose } = {}) {
  return { first: one(first, 40) || "the user", helper: helperName(one(helper, 40)), channel: one(ch, 60) || "main", purpose: one(purpose, 300) || "not written down yet" };
}
// A copy of the template with every {first}, {helper}, {channel} and {purpose} replaced, in every string.
export function fillTemplate(kind, vars) {
  const base = RAW[kind]; if (!base) throw new Error(`unknown bank template: ${kind}`);
  const raw = base, v = templateVars(vars), walk = (x) => typeof x === "string" ? x.replace(/\{(first|helper|channel|purpose)\}/g, (_, k) => v[k]) : Array.isArray(x) ? x.map(walk) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)])) : x;
  return walk(raw);
}
// What decides whether a bank needs its template imported again: the template version and kind, and the four values.
export const templateKey = (kind, vars) => { const v = templateVars(vars); return [TEMPLATE_VERSION, kind, v.first, v.helper, v.channel, v.purpose].join("|"); };

// ---- context strings and speaker labels (DESIGN.md 3.4) ----
// Hindsight learns who is speaking only from `context`, so these are fixed per document kind.
// Names and fields in speaker labels and context lines are stored content: exactly as given (Captain 2026-10-14, no length limits).
// The template one() above keeps cleaning the values filled into the bank missions ({first}, {helper}), which are bank settings.
const nm = (s) => { const t = String(s ?? ""); return t.trim() ? t : ""; };
export function speakerLabels({ first, helper } = {}) {
  const f = nm(first, 24), h = helperName(nm(helper, 24));
  return { user: f ? `${f} (user)` : "User", assistant: `${h} (assistant)`, notes: `${h} (assistant notes)`, scheduled: "Scheduled run prompt" };
}
export function contextFor(kind, { first, helper, channel: ch, section, file, address, summary, page, heading } = {}) {
  const f = nm(first, 24) || "the user", h = helperName(nm(helper, 24)), c = nm(ch, 30) || "main";
  let s;
  if (kind === "chat") s = `1Helm chat in #${c} between ${f} (the user) and ${h} (the user's AI assistant). The user's lines are the user's own words and facts about the user. The assistant's lines are what the assistant said or did. Each entry may name its message origin. Keep the stated origin with facts from that entry so app messages, phone texts, voice messages and poll votes remain distinguishable. A phone service is known only when the entry names it. Do not apply one entry's origin to another entry, and do not infer successful phone delivery from an assistant reply.`;
  else if (kind === "scheduled") s = `Scheduled run of a ${h} workflow in #${c}. These lines are the assistant's own work, not the user's words.`;
  else if (kind === "note") s = `A note ${f} wrote in their 1Helm Notebook, in the ${nm(section, 30) || "notes"} section. It is ${f}'s own statement.`;
  else if (kind === "page-edit") s = `A correction ${f} made to the "${nm(page) || "notes"}" page of their 1Helm Notebook${nm(heading) ? `, in the section "${nm(heading)}"` : ""}. It is ${f}'s own statement of what the page should say, and it overrides anything else about that subject.`;
  else if (kind === "helper-note") s = `A note ${h} saved about ${f} in the ${nm(section, 30) || "notes"} section of the 1Helm Notebook.`;
  else if (kind === "file") s = `A file in ${f}'s 1Helm Library: ${nm(file, 80)}.`;
  else if (kind === "live") s = `Live meeting transcript recorded by ${f}'s Bee wearable. The speaker marked wearer is ${f}. Unknown speakers are other people, never ${f}.`;
  else if (kind === "bee") s = `Ambient recording by ${f}'s Bee wearable${address ? ` at ${nm(address, 60)}` : ""}. The wearer is ${f}. Unknown speakers are other people.${summary ? ` Summary: ${nm(summary, 80)}` : ""}`;
  else throw new Error(`unknown context kind: ${kind}`);
  return s;   // no length limit: Hindsight 1.0 sets none on context
}
