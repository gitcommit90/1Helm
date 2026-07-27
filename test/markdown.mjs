// Unit test for the Markdown renderer using representative bot output.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// Bundle just the md() function via esbuild so we can run it in Node.
const dir = mkdtempSync(join(tmpdir(), "mdtest-"));
const entry = join(dir, "e.ts");
writeFileSync(entry, `export { md } from ${JSON.stringify(join(process.cwd(), "src/client/dom.ts"))};`);
const outfile = join(dir, "e.mjs");
execSync(`npx esbuild ${entry} --bundle --format=esm --outfile=${outfile} --platform=node`, { stdio: "pipe" });
const { md } = await import(outfile);

let pass = 0, fail = 0;
const ok = (cond, label, got) => { if (cond) { pass++; console.log("  ok  -", label); } else { fail++; console.log("  FAIL-", label, "\n     got:", got); } };

const sample = [
  "# Deploy Runbook",
  "",
  "Here's the **plan** with a few _caveats_ and ~~old steps~~ removed:",
  "",
  "## Steps",
  "1. Pull the latest image",
  "2. Run migrations",
  "3. Restart the service",
  "",
  "### Notes",
  "- Use `docker compose` not the legacy CLI",
  "- Check [the docs](https://example.com/docs)",
  "",
  "> Warning: back up the DB first",
  "",
  "| Env | Port |",
  "| --- | ---- |",
  "| prod | 8123 |",
  "| dev | 8124 |",
  "",
  "```bash",
  "echo hi && ls",
  "```",
  "",
  "---",
].join("\n");

const html = md(sample);
ok(/<h1>Deploy Runbook<\/h1>/.test(html), "H1 heading rendered (no raw #)", html.slice(0, 80));
ok(/<h2>Steps<\/h2>/.test(html), "H2 heading rendered");
ok(/<h3>Notes<\/h3>/.test(html), "H3 heading rendered");
ok(!/(^|>)#{1,3}\s/.test(html.replace(/<[^>]+>/g, "")), "no raw hashtags leak into text");
ok(/<strong>plan<\/strong>/.test(html), "bold rendered");
ok(/<strong> Goal <\/strong>/.test(md("** Goal **")), "spaced bold labels render without literal asterisks");
ok(/<em>caveats<\/em>/.test(html), "italic rendered");
ok(/<del>old steps<\/del>/.test(html), "strikethrough rendered");
ok(/<ol>.*<li>Pull the latest image<\/li>/s.test(html), "ordered list rendered");
ok(/<ul>.*<li>Use <code>docker compose<\/code>/s.test(html), "unordered list + inline code rendered");
ok(/<a href="https:\/\/example.com\/docs"[^>]*>the docs<\/a>/.test(html), "link rendered");
ok(/<blockquote>Warning: back up the DB first<\/blockquote>/.test(html), "blockquote rendered");
ok(/<table>.*<th>Env<\/th>.*<td>prod<\/td>.*<td>8123<\/td>/s.test(html), "GFM table rendered");
ok(/<pre><code>echo hi &amp;&amp; ls<\/code><\/pre>/.test(html), "fenced code block preserved & escaped");
ok(/<hr>/.test(html), "horizontal rule rendered");
ok(!/<script>/.test(md("<script>alert(1)</script>")), "HTML is escaped (XSS-safe)");

const channels = [
  { name: "main", slug: "main" },
  { name: "oss-scout", slug: "oss-scout" },
  { name: "career-advice", slug: "career-advice" },
];
const linked = md("See #oss-scout and #career-advice with @skipper", { channels });
ok(/data-channel-slug="oss-scout"/.test(linked) && /#oss-scout/.test(linked), "known #channel becomes a hyperlink", linked);
ok(/data-channel-slug="career-advice"/.test(linked), "multi-segment channel slug links");
ok(!/data-channel-slug="skipper"/.test(linked), "@mentions stay agent spans, not channel links");
const heading = md("# Deploy Runbook\n\nBody with #oss-scout", { channels });
ok(/<h1>Deploy Runbook<\/h1>/.test(heading) && /data-channel-slug="oss-scout"/.test(heading), "headings stay titles; body #channel still links");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
