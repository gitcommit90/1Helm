#!/usr/bin/env node
// Pick a deck's style plan: one theme (palette + two installed font families), a layout per slide and the deck's two
// text+image lockups. Deterministic: the same title, brief and slide ids always give the same plan.
//
//   node slide_style.mjs plan --input <abs path to style-plan-input.json>   -> StylePlan JSON on stdout
//   node slide_style.mjs list                                              -> the theme catalog
//   node slide_style.mjs check                                             -> contrast + font self-test (exit 1 on failure)
//
// The input file is strict JSON: { "title": "...", "brief": "...", "slide_ids": ["cover", ..., "closing"] }.
// Title and brief come from a file, never from shell arguments, so quotes in them can't break the command.
// Exit codes: 0 ok, 2 bad input. Errors print { ok:false, error } on stdout.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
// --help: print the header above and exit.
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n"); process.exit(0);
}

// ---- theme catalog -------------------------------------------------------------------------------------------------
// Every family here is installed on the computer (fc-list). Text pairs are checked by `check`: ink and primary on paper
// must reach 4.5:1. `words` are what in a brief points at the theme.
const THEMES = [
  {
    id: "editorial-warm", archetype: "editorial", mode: "light",
    palette: { paper: "#FAF7F2", ink: "#1C1B19", primary: "#9A3412", accent: "#1F4E5F" },
    fonts: { display: "Fraunces", body: "Work Sans" }, fallback: { display: "serif", body: "sans-serif" },
    voice: "warm, observant, specific", tone: "inviting", weight: "medium", density: "airy",
    image_style: "natural-light editorial photography with real places and people, warm grade",
    preferred_layouts: ["slide-two-column", "slide-steps", "slide-gallery", "slide-statement", "slide-hero-stats"],
    preferred_charts: ["bar", "donut", "line"], lockups: ["L4", "L1"],
    words: ["travel", "trip", "itinerary", "guide", "culture", "history", "story", "city", "journey", "food", "book", "warm", "vacation", "holiday", "tour"],
  },
  {
    id: "boardroom-clear", archetype: "corporate", mode: "light",
    palette: { paper: "#FFFFFF", ink: "#111827", primary: "#1D4ED8", accent: "#0F766E" },
    fonts: { display: "Manrope", body: "Inter" }, fallback: { display: "sans-serif", body: "sans-serif" },
    voice: "direct, numbers first, no hype", tone: "confident", weight: "medium", density: "balanced",
    image_style: "clean product and workplace photography, neutral light, uncluttered backgrounds",
    preferred_layouts: ["slide-hero-stats", "slide-comparison", "slide-two-column", "slide-headline-bullets", "slide-bento"],
    preferred_charts: ["bar", "line", "stacked-bar"], lockups: ["L4", "L2"],
    words: ["quarterly", "qbr", "finance", "financial", "business", "report", "sales", "revenue", "strategy", "investor", "pitch", "board", "roadmap", "kpi", "results", "minimal", "clean", "simple", "corporate", "team"],
  },
  {
    id: "midnight-signal", archetype: "tech", mode: "dark",
    palette: { paper: "#0F172A", ink: "#E2E8F0", primary: "#38BDF8", accent: "#A78BFA" },
    fonts: { display: "Space Grotesk", body: "Inter" }, fallback: { display: "sans-serif", body: "sans-serif" },
    voice: "crisp, technical, concrete", tone: "energetic", weight: "bold", density: "balanced",
    image_style: "low-key photography of devices, screens and hands at work, cool grade, deep shadows",
    preferred_layouts: ["slide-bento", "slide-hero-stats", "slide-steps", "slide-comparison", "slide-two-column"],
    preferred_charts: ["line", "bar", "area"], lockups: ["L4", "L2"],
    words: ["tech", "technology", "software", "ai", "data", "product", "launch", "startup", "app", "platform", "engineering", "developer", "cloud", "security", "dark", "darker", "night", "futuristic"],
  },
  {
    id: "botanical-calm", archetype: "organic", mode: "light",
    palette: { paper: "#F4F1EA", ink: "#1F2A24", primary: "#2F6B4F", accent: "#8A5A12" },
    fonts: { display: "DM Serif Display", body: "DM Sans" }, fallback: { display: "serif", body: "sans-serif" },
    voice: "calm, caring, practical", tone: "gentle", weight: "light", density: "airy",
    image_style: "soft daylight photography of plants, food and outdoor scenes, earthy grade",
    preferred_layouts: ["slide-two-column", "slide-gallery", "slide-steps", "slide-statement", "slide-headline-bullets"],
    preferred_charts: ["donut", "bar"], lockups: ["L1", "L4"],
    words: ["wellness", "garden", "nature", "health", "sustainability", "green", "recipe", "cooking", "farm", "yoga", "climate", "environment", "calm", "organic", "home"],
  },
  {
    id: "playful-pop", archetype: "playful", mode: "light",
    palette: { paper: "#FFF8EE", ink: "#1E1B4B", primary: "#BE185D", accent: "#1D4ED8" },
    fonts: { display: "Bricolage Grotesque", body: "Outfit" }, fallback: { display: "sans-serif", body: "sans-serif" },
    voice: "friendly, upbeat, plain words", tone: "fun", weight: "bold", density: "balanced",
    image_style: "bright, saturated photography of people having fun, crisp daylight",
    preferred_layouts: ["slide-bento", "slide-gallery", "slide-steps", "slide-hero-stats", "slide-two-column"],
    preferred_charts: ["bar", "donut"], lockups: ["L2", "L4"],
    words: ["kids", "children", "party", "school", "fun", "birthday", "game", "games", "club", "camp", "festival", "family", "playful", "class", "students"],
  },
  {
    id: "noir-luxe", archetype: "luxury", mode: "dark",
    palette: { paper: "#141414", ink: "#F5F0E8", primary: "#D4A373", accent: "#8AB4A0" },
    fonts: { display: "Playfair Display", body: "Lora" }, fallback: { display: "serif", body: "serif" },
    voice: "refined, sparing, evocative", tone: "elegant", weight: "light", density: "airy",
    image_style: "moody, low-key photography with rich texture and a single warm light source",
    preferred_layouts: ["slide-statement", "slide-gallery", "slide-two-column", "slide-hero-stats", "slide-comparison"],
    preferred_charts: ["line", "bar"], lockups: ["L4", "L1"],
    words: ["luxury", "wedding", "fashion", "art", "gala", "wine", "design", "gallery", "jewelry", "hotel", "elegant", "premium", "brand", "portfolio"],
  },
  {
    id: "civic-bold", archetype: "civic", mode: "light",
    palette: { paper: "#F8FAFC", ink: "#0B1324", primary: "#B91C1C", accent: "#1E3A8A" },
    fonts: { display: "Archivo Black", body: "IBM Plex Sans" }, fallback: { display: "sans-serif", body: "sans-serif" },
    voice: "clear, urgent, factual", tone: "serious", weight: "bold", density: "balanced",
    image_style: "documentary photography of real places and communities, natural light",
    preferred_layouts: ["slide-statement", "slide-hero-stats", "slide-steps", "slide-comparison", "slide-headline-bullets"],
    preferred_charts: ["bar", "line"], lockups: ["L2", "L4"],
    words: ["policy", "community", "campaign", "nonprofit", "charity", "announcement", "safety", "government", "city council", "volunteer", "election", "public", "fundraiser", "neighborhood", "bold"],
  },
];
const GENERAL = ["editorial-warm", "boardroom-clear", "botanical-calm"];   // picked by title hash when nothing in the brief matches
const LAYOUTS = ["slide-two-column", "slide-bento", "slide-hero-stats", "slide-headline-bullets", "slide-steps", "slide-comparison", "slide-statement", "slide-gallery"];
// Slide ids that name what the slide is: the layout follows.
// Matched against whole dash-separated segments of the id.
const ID_HINTS = [
  [/(budget|cost|price|numbers?|metrics?|kpis?|stats?|results|revenue|growth|impact|by-the-numbers)/, "slide-hero-stats"],
  [/(steps?|process|how|timeline|plan|agenda|schedule|roadmap|day-?\d+|itinerary|journey|phases?)/, "slide-steps"],
  [/(vs|versus|compare|comparison|before-after|options|pros-cons|choices)/, "slide-comparison"],
  [/(gallery|photos|places|highlights|showcase|sights)/, "slide-gallery"],
  [/(quote|mission|vision|why|statement|big-idea|takeaway)/, "slide-statement"],
  [/(overview|features|summary|at-a-glance|team|services)/, "slide-bento"],
  [/(intro|about|context|background|problem|solution|story)/, "slide-two-column"],
];

// ---- colour maths (WCAG relative luminance) -----------------------------------------------------------------------
function luminance(hex) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

// ---- helpers ------------------------------------------------------------------------------------------------------
function hash(text) {   // FNV-1a, 32-bit: stable across runs and platforms
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
const quoteFamily = (f) => (/\s/.test(f) ? `"${f}"` : f);

function pickTheme(title, brief) {
  const text = ` ${String(brief || "")} ${String(title || "")} `.toLowerCase();
  let best = null, bestScore = 0;
  for (const theme of THEMES) {
    let score = 0;
    for (const w of theme.words) if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) score += 1;
    // An explicit mood word ("dark", "minimal") in the brief outweighs topic words.
    if (theme.mode === "dark" && /\b(dark|darker|night|moody)\b/.test(text)) score += 2;
    if (theme.mode === "light" && /\b(light|lighter|bright|airy)\b/.test(text)) score += 1;
    if (score > bestScore) { best = theme; bestScore = score; }
  }
  if (best) return { theme: best, matched: true };
  return { theme: THEMES.find((t) => t.id === GENERAL[hash(title) % GENERAL.length]), matched: false };
}

function layoutPlan(ids, theme) {
  const plan = ids.map((id, i) => {
    if (i === 0) return { id, layout: "cover" };
    if (i === ids.length - 1 && ids.length > 1) return { id, layout: "closing" };
    const hint = ID_HINTS.find(([re]) => new RegExp(`(?:^|-)${re.source}(?:-|$)`).test(id));
    return { id, layout: hint ? hint[1] : null };
  });
  // Unhinted slides take the theme's preferred layouts in turn, skipping a repeat of the slide before.
  let k = hash(ids.join("|")) % theme.preferred_layouts.length;
  for (let i = 1; i < plan.length - 1; i++) {
    if (plan[i].layout) continue;
    let pick = theme.preferred_layouts[k++ % theme.preferred_layouts.length];
    if (pick === plan[i - 1].layout) pick = theme.preferred_layouts[k++ % theme.preferred_layouts.length];
    plan[i].layout = pick;
  }
  // Five or more slides need at least three distinct content layouts: swap later repeats for unused preferred ones.
  const content = plan.slice(1, -1);
  if (plan.length >= 5) {
    const used = () => new Set(content.map((s) => s.layout));
    const pool = [...theme.preferred_layouts, ...LAYOUTS].filter((l, i, a) => a.indexOf(l) === i);
    for (let i = content.length - 1; i >= 0 && used().size < 3; i--) {
      const repeats = content.filter((s) => s.layout === content[i].layout).length > 1;
      if (!repeats) continue;
      const fresh = pool.find((l) => !used().has(l));
      if (fresh) content[i].layout = fresh;
    }
  }
  return plan;
}

function cssVariables(theme) {
  return {
    "--slide-bg": theme.palette.paper,
    "--slide-fg": theme.palette.ink,
    "--slide-primary": theme.palette.primary,
    "--slide-accent": theme.palette.accent,
    "--slide-muted": "color-mix(in srgb, var(--slide-fg) 80%, var(--slide-bg))",
    "--slide-font-display": `${quoteFamily(theme.fonts.display)}, ${theme.fallback.display}`,
    "--slide-font-body": `${quoteFamily(theme.fonts.body)}, ${theme.fallback.body}`,
  };
}

const REQUIRED_BLOCKS = [
  [/\b(budget|cost|price|money|spend)\b/, "budget"],
  [/\b(chart|graph|trend|data|numbers)\b/, "chart"],
  [/\b(timeline|schedule|itinerary|agenda|day)\b/, "timeline"],
  [/\b(compare|comparison|versus|vs)\b/, "comparison"],
  [/\b(map|route|places)\b/, "places"],
];

export function plan(input) {
  const title = String(input?.title ?? "").trim();
  const brief = String(input?.brief ?? "").trim();
  const ids = Array.isArray(input?.slide_ids) ? input.slide_ids.map((s) => String(s).trim()) : [];
  if (!title) throw new Error("input needs a non-empty title");
  if (ids.length < 1) throw new Error("input needs a non-empty slide_ids array (cover first, closing last)");
  const bad = ids.find((id) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || id === "index");
  if (bad !== undefined) throw new Error(`slide id ${JSON.stringify(bad)} must be kebab-case (a-z, 0-9, -) and not "index"`);
  if (new Set(ids).size !== ids.length) throw new Error("slide_ids repeats an id");
  const { theme, matched } = pickTheme(title, brief);
  const vars = cssVariables(theme);
  const text = `${brief} ${title}`.toLowerCase();
  return {
    ok: true,
    archetype: theme.archetype,
    theme: theme.id,
    mode: theme.mode,
    matched_brief: matched,
    palette: { ...theme.palette },
    fonts: { ...theme.fonts },
    voice: theme.voice,
    preferred_layouts: [...theme.preferred_layouts],
    preferred_charts: [...theme.preferred_charts],
    required_content_blocks: REQUIRED_BLOCKS.filter(([re]) => re.test(text)).map(([, b]) => b),
    image_style: theme.image_style,
    tone: theme.tone, weight: theme.weight, density: theme.density,
    layout_plan: layoutPlan(ids, theme),
    lockups: [...theme.lockups],
    css_variables: vars,
    css_root: `:root {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`,
  };
}

function selfCheck() {
  const problems = [];
  let families = "";
  try { families = execFileSync("fc-list", [":", "family"], { encoding: "utf8" }); } catch { problems.push("fc-list not available; fonts unchecked"); }
  for (const t of THEMES) {
    for (const [a, b] of [["ink", "paper"], ["primary", "paper"], ["accent", "paper"]]) {
      const c = contrast(t.palette[a], t.palette[b]);
      if (c < 4.5) problems.push(`${t.id}: ${a} on ${b} is ${c}:1 (needs 4.5)`);
    }
    if (families) for (const f of Object.values(t.fonts)) {
      if (!families.split("\n").some((line) => line.split(",").includes(f))) problems.push(`${t.id}: font "${f}" is not installed`);
    }
  }
  return problems;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "list") {
    process.stdout.write(JSON.stringify(THEMES.map(({ words, ...t }) => ({ ...t, contrast: { ink: contrast(t.palette.ink, t.palette.paper), primary: contrast(t.palette.primary, t.palette.paper) } })), null, 2) + "\n");
    return 0;
  }
  if (cmd === "check") {
    const problems = selfCheck();
    process.stdout.write(JSON.stringify({ ok: problems.length === 0, themes: THEMES.length, problems }) + "\n");
    return problems.length ? 1 : 0;
  }
  if (cmd === "plan") {
    const i = rest.indexOf("--input");
    const path = i >= 0 ? rest[i + 1] : rest[0];
    try {
      if (!path) throw new Error("usage: slide_style.mjs plan --input <style-plan-input.json>");
      let input;
      try { input = JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new Error(`cannot read ${path} as JSON: ${e.message}`); }
      process.stdout.write(JSON.stringify(plan(input), null, 2) + "\n");
      return 0;
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + "\n");
      return 2;
    }
  }
  process.stdout.write(JSON.stringify({ ok: false, error: "usage: slide_style.mjs plan --input <file> | list | check" }) + "\n");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
