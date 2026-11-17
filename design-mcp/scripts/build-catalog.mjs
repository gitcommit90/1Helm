// Generates design-mcp/src/catalog.js from the tweakcn theme presets (Apache-2.0, see THIRD-PARTY-NOTICES.md).
//   node design-mcp/scripts/build-catalog.mjs [path to a local copy of utils/theme-presets.ts]
// Without a path the file is downloaded from the pinned commit below. Either way its SHA-256 must match, so the output is reproducible.
// Only presets named for a mood or style are kept (SKIP lists the ones named after a company, a product or a trademarked color).
// Each kept theme gets a tag line written here, the 15 core colors for light and dark, a radius, one shadow, and three font stacks. The fonts are
// mapped to families that are installed on the computer image (MAP), because the skill tells agents to use installed fonts only.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const COMMIT = "a3b47b37cba97dd637de517aab52c45ec0f83456";
const SHA256 = "d333858a5a4f1e2fd615f1b73709f552e5a84c12882196456dfc48e1f09376a8";
const URL_ = `https://raw.githubusercontent.com/jnsahaj/tweakcn/${COMMIT}/utils/theme-presets.ts`;

const SKIP = new Set(["t3-chat", "twitter", "catppuccin", "supabase", "claude", "vercel", "doom-64", "candyland", "mocha-mousse"]);

const TAGS = {
 "modern-minimal": "minimal clean modern neutral blue saas startup product landing professional calm simple software app",
 "violet-bloom": "playful friendly violet purple rounded soft creative app community social startup lifestyle",
 bubblegum: "playful pink fun candy kids bright quirky retro cute children toy sweet bakery dessert",
 "amethyst-haze": "calm soft muted purple lavender elegant wellness meditation beauty spa gentle dreamy",
 notebook: "handwritten sketch paper notes casual friendly journal education classroom creative grey",
 graphite: "grey monochrome neutral serious professional minimal corporate portfolio understated architecture",
 perpetuity: "teal typewriter monospace retro terminal technical developer docs engineering cyan",
 "kodama-grove": "earthy forest nature warm green olive organic natural cafe bakery craft artisan eco outdoor food",
 "cosmic-night": "space cosmic dark purple indigo tech ai futuristic science astronomy night product",
 tangerine: "orange energetic dashboard analytics admin saas modern clean business console tool app",
 "quantum-rose": "pink rose bold magenta feminine fashion beauty glamorous romantic boutique wedding editorial",
 nature: "green natural organic eco garden outdoors sustainability farm plants wellness food earthy trust",
 "bold-tech": "bold technology startup developer saas purple vibrant modern product ai platform energetic",
 "elegant-luxury": "luxury elegant premium editorial serif refined fashion jewelry hotel restaurant fine dining wedding boutique wine",
 "amber-minimal": "amber yellow minimal clean warm friendly saas productivity simple modern",
 "neo-brutalism": "brutalist bold raw loud playful flat thick borders creative agency portfolio quirky youthful",
 "solar-dusk": "warm sunset amber earthy cozy restaurant cafe food hospitality travel autumn editorial rustic",
 claymorphism: "soft clay rounded playful friendly tactile toy kids app onboarding consumer fun",
 cyberpunk: "neon cyberpunk futuristic game games gaming studio dark magenta cyan techno nightlife music esports bold",
 "pastel-dreams": "pastel soft dreamy gentle lavender kids wellness beauty baby friendly cute calm rounded",
 "clean-slate": "clean slate indigo professional saas dashboard business neutral modern documentation product tool corporate",
 caffeine: "coffee brown warm neutral minimal cafe espresso bakery earthy simple sleek",
 "ocean-breeze": "ocean breeze blue green fresh calm travel beach water health wellness marine resort airy",
 "retro-arcade": "retro arcade game games gaming pixel vintage nostalgic playful solarized fun",
 "midnight-bloom": "dark night purple moody evening elegant music nightlife editorial floral modern creative",
 "northern-lights": "aurora green cool calm nordic travel nature science technology modern crisp winter",
 "vintage-paper": "vintage paper aged sepia retro classic serif heritage bookstore library editorial history craft warm antique",
 "sunset-horizon": "sunset warm orange coral peach friendly playful cheerful travel lifestyle creative event festival food restaurant",
 "starry-night": "night blue calm serif literary art museum gallery poetry editorial classic dreamy",
 darkmatter: "monospace technical developer terminal orange dark engineering docs hacker tool minimal",
 mono: "monochrome black white brutalist minimal technical developer terminal austere typographic",
 "soft-pop": "pop colorful playful indigo amber youthful creative fun friendly startup education app bright",
 "sage-garden": "sage green garden calm organic botanical wellness spa serif natural restaurant home interior",
};

const COLORS = ["background", "foreground", "card", "card-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "ring"];
const DEFAULT = { sans: '"Inter", sans-serif', serif: '"Source Serif 4", serif', mono: '"IBM Plex Mono", monospace' };
const PLEX = '"IBM Plex Mono", monospace';
const MAP = {
 Inter: DEFAULT.sans, Geist: DEFAULT.sans, Roboto: DEFAULT.sans, Antic: DEFAULT.sans, "DM Sans": '"DM Sans", sans-serif',
 "Plus Jakarta Sans": '"Manrope", sans-serif', Poppins: '"Outfit", sans-serif', Montserrat: '"Outfit", sans-serif', Quicksand: '"Outfit", sans-serif', Outfit: '"Outfit", sans-serif',
 "Open Sans": '"Noto Sans", sans-serif', Oxanium: '"Space Grotesk", sans-serif', "Architects Daughter": '"Work Sans", sans-serif',
 "Source Serif 4": DEFAULT.serif, Georgia: DEFAULT.serif, Lora: '"Lora", serif', Merriweather: '"Lora", serif', "Libre Baskerville": '"Lora", serif',
 "Playfair Display": '"Playfair Display", serif', "Times New Roman": '"Liberation Serif", serif', Signifier: '"Fraunces", serif',
 "JetBrains Mono": PLEX, "Fira Code": PLEX, "Space Mono": PLEX, "IBM Plex Mono": PLEX, "Source Code Pro": PLEX, "Geist Mono": PLEX, "Roboto Mono": PLEX, Menlo: PLEX, "Ubuntu Mono": PLEX, "Courier New": PLEX,
};
const GENERIC = new Set(["ui-serif", "ui-sans-serif", "ui-monospace", "serif", "sans-serif", "monospace", "system-ui"]);

function fontStack(value, role) {
 const first = String(value || "").split(",").map((p) => p.trim().replace(/^["']|["']$/g, "")).find((p) => p && !GENERIC.has(p));
 if (!first) return DEFAULT[role];
 if (!MAP[first]) throw new Error(`no installed font mapped for "${first}"`);
 return MAP[first];
}

// The shadow color at its opacity, written with color-mix so any color syntax (hex, hsl, oklch) works.
const shadow = (l) => l["shadow-color"] ? `${l["shadow-offset-x"] || "0px"} ${l["shadow-offset-y"] || "1px"} ${l["shadow-blur"] || "3px"} ${l["shadow-spread"] || "0px"} color-mix(in srgb, ${l["shadow-color"]} ${Math.round(Number(l["shadow-opacity"] || 0.1) * 100)}%, transparent)` : "0 1px 3px 0 rgb(0 0 0 / 0.1)";

let src;
if (process.argv[2]) src = readFileSync(process.argv[2], "utf8");
else src = await (await fetch(URL_)).text();
const sum = createHash("sha256").update(src).digest("hex");
if (SHA256 && sum !== SHA256) throw new Error(`upstream file hash ${sum} does not match the pinned ${SHA256}`);

const presets = new Function(src.replace(/^import.*\n/, "").replace(/export const defaultPresets[^=]*=/, "return "))();
const pick = (o) => Object.fromEntries(COLORS.map((k) => [k, o[k]]));
const out = [];
for (const [id, p] of Object.entries(presets)) {
 if (SKIP.has(id)) continue;
 if (!TAGS[id]) throw new Error(`no tag line for ${id}`);
 const l = p.styles.light, d = p.styles.dark;
 out.push({ id, name: p.label, tags: TAGS[id], light: pick(l), dark: pick(d), radius: l.radius || "0.5rem", shadow: shadow(l),
  fonts: { sans: fontStack(l["font-sans"], "sans"), serif: fontStack(l["font-serif"], "serif"), mono: fontStack(l["font-mono"], "mono") } });
}
for (const id of Object.keys(TAGS)) if (!out.some((t) => t.id === id)) throw new Error(`tag line for unknown preset ${id}`);

writeFileSync(new URL("../src/catalog.js", import.meta.url), `// Generated by design-mcp/scripts/build-catalog.mjs. Do not edit by hand.
// Source: tweakcn theme presets (https://github.com/jnsahaj/tweakcn, utils/theme-presets.ts at commit ${COMMIT}), Apache-2.0.
// Modified from the presets: some presets left out, 15 colors per mode, one shadow, fonts mapped to installed families, our own tag lines. License text: THIRD-PARTY-NOTICES.md.
export const CATALOG = [
${out.map((t) => " " + JSON.stringify(t)).join(",\n")},
];
`);
console.log(`wrote ${out.length} themes`);
