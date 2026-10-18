// node --import ./test/stubs/register.mjs test/website-live.test.mjs
// A request to put a website live on a domain gets the business-setup guidance from 1Helm itself (website-live.js), not from the model's choice.
import assert from "node:assert"; import { readFileSync } from "node:fs";
import { wantsWebsiteLive, websiteLiveNote } from "../src/website-live.js";
import { helperJobText } from "../src/helpers.js";
import { SKILLS, readSkill } from "../src/skills/index.js";

const yes = ["I just bought the domain example-nobis-test.com on Cloudflare. Can you help me make a landing page for it that will be live?",
  "create a landing page for nobisai.com that will be live", "Launch my website", "put my site online on my domain", "help me host my new website",
  "I own a domain, can you set up hosting and DNS for it?"];
const no = ["Make me a chart of my spending as a web page", "Write a poem about the sea", "Put my site on Vercel", "Build me a landing page on Squarespace",
  "What's the weather in Paris?", "Create a one page website mockup as a PDF", "buy me a GoDaddy domain"];
for (const t of yes) assert.ok(wantsWebsiteLive(t), `should match: ${t}`);
for (const t of no) assert.ok(!wantsWebsiteLive(t), `should not match: ${t}`);

// Main turn: the note names the skill as the first call and the Cloudflare MCP rules.
const note = websiteLiveNote();
assert.match(note, /read_skill with slug business-setup/); assert.match(note, /cloudflare_mcp/); assert.match(note, /never ask for a Cloudflare API token/);
const src = readFileSync(new URL("../src/resident.js", import.meta.url), "utf8");
assert.match(src, /eeEnabled\(this\.env\) && wantsWebsiteLive\(text\) \? websiteLiveNote\(\)/, "resident adds the note to the chat turn's hint note only when the Cloud switch is on (the note names the Cloudflare MCP app)");
assert.match(src, /helperJobText\(h, this\.get\("channel"\), \(\) => readSkill\(\{ slug: "business-setup" \}/, "resident passes the guide to the helper job text");

// Helper: the job text carries the whole skill for a matching job, and nothing for another job.
const guide = readSkill({ slug: "business-setup" }, { apps: true });
assert.match(guide, /^\[1Helm skill: business-setup\]/); assert.ok(guide.includes("CLOUDFLARE_MCP_EXECUTE"));
const mk = (name, task, extra = {}) => ({ id: 1, name, task, ...extra });
for (const h of [mk("Make landing page live", "Build and publish a landing page for example-nobis-test.com"), mk("Site", "Make the website live", { dynamic_routing: 1 })]) {
  const j = helperJobText(h, "main", () => guide);
  assert.ok(j.includes("[1Helm skill: business-setup]") && j.includes("CLOUDFLARE_MCP_EXECUTE"), "job text includes the guide");
  assert.ok(j.indexOf("business-setup guide") < j.lastIndexOf(h.task), "guide comes before the job");
}
const other = helperJobText(mk("Summarize", "Summarize my inbox"), "main", () => guide);
assert.ok(!other.includes("[1Helm skill: business-setup]"), "unrelated job has no guide");
// The artifacts web-page reference and skill table point to business-setup.
const art = SKILLS.find((s) => s.slug === "artifacts");
assert.ok(art.refs["web-page"].includes("business-setup") && art.body.includes("business-setup"));
console.log("PASS website-live");
