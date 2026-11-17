// node --import ./test/stubs/register.mjs test/design-catalog.test.mjs
// The built-in design theme catalog (design-mcp/src/catalog.js) and how the design brief picks a theme from it. No network, no model.
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { CATALOG } from "../design-mcp/src/catalog.js";
import { fetchBrief } from "../src/design-brief.js";
import { FLAGS } from "../src/prompt/index.js";
import { themeFor, pickSystem, renderBrief, BRIEF_MAX } from "../design-mcp/src/brief.js";

const ok = (m) => console.log("  ok", m);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const COLORS = ["background", "foreground", "card", "card-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "ring"];
// Families on the computer image: the packages and downloaded fonts in image/skills-layer.sh, plus Liberation (the artifacts skill's reliable list).
const INSTALLED = new Set(["Inter", "IBM Plex Mono", "Noto Sans", "Liberation Serif", "Fraunces", "Playfair Display", "Space Grotesk", "Manrope", "Source Serif 4", "Lora", "Work Sans", "Outfit", "DM Sans"]);
const BRANDS = /twitter|claude|vercel|supabase|t3|catppuccin|doom|candyland|mocha|github|google|apple|netflix|spotify|stripe/i;

// 1. Every theme has what the brief needs.
{
  assert.ok(CATALOG.length >= 30, `enough themes (${CATALOG.length})`);
  assert.equal(new Set(CATALOG.map((t) => t.id)).size, CATALOG.length, "ids are unique");
  for (const t of CATALOG) {
    assert.match(t.id, /^[a-z0-9-]+$/); assert.ok(t.name && t.tags.split(" ").length >= 6, `${t.id} has a name and a tag line`);
    for (const mode of ["light", "dark"]) for (const k of COLORS) assert.ok(/^(#[0-9a-f]{3,8}|(hsl|oklch|rgb)a?\([^;{}]+\))$/i.test(t[mode][k] || ""), `${t.id} ${mode} ${k} is a color (${t[mode][k]})`);
    assert.match(t.radius, /^[0-9.]+(rem|px)$/); assert.ok(t.shadow && !/[;{}]/.test(t.shadow), `${t.id} shadow`);
    for (const role of ["sans", "serif", "mono"]) {
      const m = /^"([^"]+)", (sans-serif|serif|monospace)$/.exec(t.fonts[role]); assert.ok(m, `${t.id} ${role} font stack: ${t.fonts[role]}`);
      assert.ok(INSTALLED.has(m[1]), `${t.id} ${role} uses ${m[1]}, which is installed on the computer image`);
    }
  }
  ok(`${CATALOG.length} themes: fields, colors parse, radius, shadow and installed font families`);
}

// 2. No theme is named after a company or product, and the license notice and pinned source are in place.
{
  for (const t of CATALOG) assert.ok(!BRANDS.test(`${t.id} ${t.name} ${t.tags}`), `${t.id} has no brand name`);
  const commit = /commit ([0-9a-f]{40})/.exec(read("../design-mcp/src/catalog.js"))[1];
  assert.ok(read("../design-mcp/scripts/build-catalog.mjs").includes(commit), "the generator pins the same upstream commit as the generated module");
  const notices = read("../THIRD-PARTY-NOTICES.md");
  assert.ok(notices.includes("tweakcn") && notices.includes(commit) && /Apache License\s+Version 2\.0/.test(notices), "the notices name the source and carry the Apache 2.0 text");
  ok("no brand names; generator pin matches the module; notice with license text");
}

// 3. Matching is deterministic and picks fitting themes.
{
  const cases = [
    ["a playful single-page site for a sushi restaurant", "sunset-horizon"],
    ["an analytics dashboard for developers with api docs", "tangerine"],
    ["a luxury wedding boutique landing page", "elegant-luxury"],
    ["a calm spa and wellness retreat", "amethyst-haze"],
    ["a game studio launch page with neon vibes", "cyberpunk"],
  ];
  for (const [d, id] of cases) { assert.equal(themeFor(d).id, id, d); assert.deepEqual(themeFor(d), themeFor(d), "same answer twice"); }
  assert.ok(CATALOG.some((t) => t.id === themeFor("zzz qqq").id), "a description with no matching word still gets a theme");
  assert.equal(pickSystem([], "x"), null);
  assert.ok(!/saas|developer/.test(pickSystem(CATALOG, "a kids bakery").tags), "a non-technical request avoids the technical themes");
  ok("five descriptions pick fitting themes, deterministically");
}

// 4. The theme block and the brief have the expected shape and stay under the size cap.
{
  const th = themeFor("a calm spa and wellness retreat");
  assert.match(th.root, /^:root\{\n  --background:[^\n]+;\n/); assert.match(th.root, /\n\.dark\{\n  --background:/);
  for (const k of [...COLORS, "radius", "shadow", "font-sans", "font-serif", "font-mono"]) assert.ok(th.root.includes(`--${k}:`), `--${k} is in the block`);
  assert.ok(th.fonts.length >= 1 && th.fonts.every((f) => INSTALLED.has(f)), "font names are listed");
  const text = renderBrief("a calm spa", { theme: th });
  assert.ok(text.length <= BRIEF_MAX, `under the cap (${text.length})`);
  assert.match(text, /DESIGN THEME TOKENS \(Amethyst Haze; fonts: /); assert.match(text, /\nRULES\n(- [^\n]+\n){7,}/);
  const rules = text.split("RULES\n")[1].trim().split("\n"); assert.ok(rules.length >= 8 && rules.length <= 12, `8 to 12 rules (${rules.length})`);
  ok("the brief has a :root block, a dark block, fonts and 8 to 12 rules under the size cap");
}

// 5. The main Worker has no Better Design switch, flag or setting, and the brief call carries only the description.
{
  assert.ok(!existsSync(new URL("../src/better-design.js", import.meta.url)), "the switch module is gone");
  assert.ok(!FLAGS.includes("better_design"), "no prompt flag");
  for (const f of ["account.js", "resident.js", "index.js", "design-brief.js", "design-tools.js"]) assert.ok(!/better.?design/i.test(read(`../src/${f}`)), `src/${f} does not mention Better Design`);
  let sent;
  const text = await fetchBrief("a spa", { url: "https://design.example.test/brief/mcp", fetchFn: async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "BRIEF" }] } })); } });
  assert.equal(text, "BRIEF"); assert.deepEqual(sent.params, { name: "design_brief", arguments: { description: "a spa" } });
  ok("main Worker: no switch module, flag or mentions; the brief call sends the description only");
}
console.log("design-catalog.test.mjs: all ok");
