// node --import ./test/stubs/register.mjs test/deck-captain1.test.mjs
// A user's deck job (helper #30: three rounds, 11 minutes, no deck). Deterministic app facts only: which recipe a deck brief gets, which impact figures
// new_deck accepts, whether every slide pattern of every template takes long words and fits them, the messages for words that fit nowhere, and (with Chrome) that a
// deck built from long words passes make_deck.sh in one build. No model wording is judged. Fixtures are synthetic look-alikes of the real brief and project list.
import test from "node:test"; import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resident } from "../src/resident.js";
import { helperJobText } from "../src/helpers.js";
import { fileRecipe } from "../src/file-recipe.js";
import { wantsWebsiteLive, wantsWebsiteLiveJob } from "../src/website-live.js";
import { tailOutput } from "../src/computer-capacity.js";
import { readSkill } from "../src/skills/index.js";
// The test loader reads files under src/skills as text, so the script is loaded from a copy (as test/skills-artifacts.test.mjs does).
const fitCopy = join(mkdtempSync(join(tmpdir(), "deck-fit-")), "deck_fit.mjs"); writeFileSync(fitCopy, readFileSync(new URL("../src/skills/artifacts/scripts/deck_fit.mjs", import.meta.url), "utf8"));
const { bestSize, floorFor, loadFit, scan, flowOf, unitsOf, wrap, unesc } = await import(fitCopy);

const S = new URL("../src/skills/artifacts/scripts/", import.meta.url).pathname, T = new URL("../app-assets/deck-templates/", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "deck-captain1-"));
const templates = readdirSync(T).filter((n) => existsSync(join(T, n, "head.html"))).sort();
const run = (cmd, args, env = {}) => spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env } });

// 1. The recipe. The brief names two Library files by path (a notes file and last year's proposal as a PDF) and lists projects, one of them a website and a tennis.com page.
const BRIEF = `Create a slide presentation titled "2026 Impact Report" for Sam to use as a road show for decision makers who don't yet know the full scope of the work.

Result wanted: a slide deck where 1 slide is dedicated to one project, with space left blank on each project slide for screenshots or GIFs that Sam will add. Include all projects listed in notes.txt (Alpha Tool, Beta Bot, Gamma Pipeline, the example.com How to Watch page, The Big Co website, Parser One, plus intro/closing and build-vs-buy context).

Inputs: /workspace/files/notes.txt contains the full project descriptions and impacts to use; /workspace/files/Proposal Deck (2) (3).pdf is the prior proposal for tone and context. Use the stated impacts faithfully.

Limits: Keep language simple, warm, short. No emoji. Leave a visual placeholder on each project slide. Report back when the deck file is ready to review.`;
const job = { id: 30, name: "Build impact report deck", task: BRIEF, dynamic_routing: 1 };
const recipeOf = (h) => Resident.prototype.helperRecipe.call({ docFlags: () => ({}) }, h);

test("a deck brief that names Library files of other kinds gets the presentation recipe and no website guide", () => {
  assert.deepEqual(fileRecipe(`${job.name}\n${job.task}`).refs, ["presentation", "deck-templates"], "input files of other kinds (txt, pdf) are source material, not a deck to edit");
  const r = recipeOf(job);
  assert.equal(r.kind, "presentation");
  const first = helperJobText(job, "main", () => "BUSINESS-SETUP-GUIDE", () => r);
  assert.ok(first.includes("new_deck.mjs") && first.includes("# Deck templates") && first.includes("# Slide decks"), "the recipe is in the first input");
  assert.ok(!first.includes("# Changing an existing deck"), "not the deck-editing page");
  assert.ok(!first.includes("BUSINESS-SETUP-GUIDE"), "a website named as a project is not a request to put one live");
  assert.ok(wantsWebsiteLive(BRIEF), "the plain test alone does match this brief (a website and a domain name)");
  assert.ok(!wantsWebsiteLiveJob(BRIEF, true) && wantsWebsiteLiveJob("Put my new website live on mysite.com", false) && wantsWebsiteLiveJob("Make a deck, then launch my website on mysite.com", true));
});

test("editing an existing file still gets the editing page, and a file of the kind made without a change request does not", () => {
  assert.deepEqual(fileRecipe("edit the deck at /workspace/files/q3.html").refs, ["deck-editing"]);
  assert.deepEqual(fileRecipe("Update the slides in /workspace/files/Q3 review.pptx with new numbers").refs, ["deck-editing"]);
  assert.deepEqual(fileRecipe("Fill in the PDF form /workspace/files/w9.pdf").refs, ["pdf-existing"]);
  assert.deepEqual(fileRecipe("Make a one-pager PDF from /workspace/files/data.csv").refs, ["pdf", "pdf-design"]);
  assert.deepEqual(fileRecipe("Make a deck about /workspace/files/q3.pdf").refs, ["presentation", "deck-templates"]);
});

// Why the helper read prompt.txt three times: its first command was cat of a 26,000 character file, and run_command keeps only the end of an output with no word that the
// beginning is gone, so the file looked like it started in the middle of a sentence. The cut is now announced on the output's first line.
test("a long command output says its beginning was cut", () => {
  const file = "x".repeat(26059), shown = tailOutput(file, undefined);
  assert.match(shown.split("\n")[0], /^\[the first 6059 characters of this output were cut, the last 20000 follow\. To read a whole file use file_text/);
  assert.equal(shown.split("\n")[1], "x".repeat(20000));
  assert.equal(tailOutput("short", undefined), "short"); assert.equal(tailOutput(file, 200000), file, "a read_file that asked for more comes back whole");
});

// 2. Impact figures.
const entry = (impact) => ({ pattern: "project", title: "T", users: "U", problem: "p", built: "b", impact });
const deckWith = (name, template, slides, extra = []) => { const dir = join(work, name), data = join(work, `${name}.json`); writeFileSync(data, JSON.stringify({ slides })); return { dir, data, r: run("node", [S + "new_deck.mjs", dir, "--template", template, "--title", "T", "--data", data, ...extra]) }; };
test("an impact value may be words with no digit; a split figure is still refused", () => {
  for (const [value, label] of [["Days → seconds", "to get an answer"], ["Hours → minutes", "per report"], ["Multi-six-figure", "est. first-year impact"], ["3 days → 4 hours", "report time"]]) {
    const d = deckWith("imp", "emerald-editorial", [entry([{ value, label }])], ["--redo"]);
    assert.equal(d.r.status, 0, `${value}: ${d.r.stdout}`);
    assert.ok(readFileSync(join(d.dir, ".src", "slides", "01-project.html"), "utf8").replace(/&nbsp;|\u00a0/g, " ").includes(value.split(" → ")[0]), value);
  }
  for (const [value, label, why] of [["days", "report time", /only a unit or a joining word/], ["3 days", "to 4 hours: report time cut", /starts with part of the figure/], ["9 →", "days", /stops in the middle/], ["Days → seconds", "→ 5 seconds", /starts with part of the figure/], ["", "x", /no "value"/]]) {
    const d = deckWith("imp", "emerald-editorial", [entry([{ value, label }])], ["--redo"]);
    assert.equal(d.r.status, 2, `${value}|${label}`); assert.match(JSON.parse(d.r.stdout).error, why);
  }
});

// 3. Every pattern of every template has measured room, and takes long words.
test("every template has a fit table for every pattern, with widths for each font it uses", () => {
  for (const t of templates) {
    const fit = loadFit(T, t); assert.ok(fit, `${t}: fit.json`);
    const patterns = readdirSync(join(T, t, "slides")).map((f) => f.match(/^\d+-(.+)\.html$/)[1]);
    assert.deepEqual(Object.keys(fit.patterns).sort(), [...patterns].sort(), `${t}: every pattern is measured`);
    for (const p of patterns) for (const u of unitsOf(fit, p)) {
      if (u.skip) { assert.ok(["not shown", "faint", "turned", "ghost", "no room"].includes(u.skip), `${t}/${p}: ${u.skip}`); continue; }
      assert.ok(fit.faces[u.fk]?.w?.M > 0.2, `${t}/${p}: widths for ${u.fk}`); assert.ok(u.W > 0 && u.fs > 0 && u.Ls >= 1 && u.Lx >= 0, `${t}/${p}: ${JSON.stringify(u)}`);
    }
  }
});

const TITLES = ["Infrastructure, now managed", "Gracenote Image Toolkit", "Internationalization", "Multi-Channel Verification", "Parser/Report Automation Suite"];
const BODY = "The team replaced a weekly manual spreadsheet with a self-hosted tool that reads every channel feed, checks artwork and schedule gaps, and flags problems early so nobody compares files by hand anymore.";
const POOL = "Alpha review channel feed ad grid rights audience listing report clip asset podcast verify parser team schedule match image ";
// The pieces of text of a slide as new_deck.mjs counts them (what "text" gives one string for each of).
const piecesOf = (html) => [...html.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, "").matchAll(/>([^<>]+)</g)].map((m) => unesc(m[1]).replace(/\s+/g, " ").trim()).filter(Boolean);
// One slide for every pattern of a template, written the way a long deck is: a headline gets a long title, a sentence gets a longer sentence, a label gets other
// words of its own length, numbers stay. (A pattern with its own empty picture boxes is left out: it cannot pass the empty-box check by design.)
export function stressSlides(t) {
  let k = 0; const fit = loadFit(T, t);
  return readdirSync(join(T, t, "slides")).sort().flatMap((f) => {
    const pattern = f.match(/^\d+-(.+)\.html$/)[1], html = readFileSync(join(T, t, "slides", f), "utf8");
    if (pattern === "media") return [{ pattern, title: TITLES[k++ % TITLES.length], body: "One short line about the work.", drop: "Screenshot or GIF", notes: "n" }];
    if (pattern === "project") return [{ pattern, title: TITLES[k++ % TITLES.length], users: "Customer support, 120 agents", problem: BODY.slice(0, 96), built: BODY.slice(0, 98), impact: [{ value: "3 days → 4 hours", label: "report time" }, { value: "Days → seconds", label: "to get an answer" }], notes: "n" }];
    if (/class="[^"]*placeholder[^"]*"/i.test(html)) return [];
    const fsOf = new Map(); for (const u of unitsOf(fit, pattern)) if (!u.skip) for (const line of u.t.split("\n")) fsOf.set(line.replace(/\s+/g, " "), u.fs);
    const text = piecesOf(html).map((p) => {
      if (/^\[.*\]$/.test(p)) return "Q3 2026";
      if (p.length <= 8 || /^[\d\s/.,%+\-:·×$]+$/.test(p)) return p;   // markers, dates and numbers keep their words
      if ((fsOf.get(p) ?? 0) >= 40) return TITLES[k++ % TITLES.length];
      if (p.length >= 40) return BODY.slice(0, Math.round(p.length * 1.3)).trim();
      return (POOL.slice((k += 7) % 60) + POOL).slice(0, p.length).trim() || p;
    });
    return [{ pattern, text, notes: "n" }];
  });
}
// What a helper does with a refusal: take the text new_deck suggests, or cut the word to the letters it says fit (the refusal's problems list names each one).
function followFixes(slides, problems) {
  const norm = (x) => String(x).replace(/\s+/g, " ").trim();
  let any = false;
  for (const q of problems) {
    const e = slides[q.slide - 1]; if (!e) continue;
    const apply = (str) => q.word ? str.replace(q.word, q.word.slice(0, q.letters || 3)) : q.fix;
    if (q.field && typeof e[q.field] === "string") { e[q.field] = apply(e[q.field]); any = true; }
    else if (Array.isArray(e.text)) outer: for (let k = 0; k < e.text.length; k++) for (let m = 0; k + m < e.text.length; m++) {
      if (norm(e.text.slice(k, k + m + 1).filter((x) => norm(x)).join(" ")) === norm(q.text)) { e.text[k] = apply(e.text[k]); for (let r = 1; r <= m; r++) e.text[k + r] = ""; any = true; break outer; }
    }
  }
  return any;
}
// Starts a deck from the stress slides, following each refusal's fix (as a helper does) until new_deck accepts it. -> { dir, data, r, rounds, slides }
function buildFollowingFixes(name, t) {
  const slides = stressSlides(t); let d, rounds = 0;
  for (;;) {
    d = deckWith(name, t, slides, ["--redo"]);
    if (d.r.status === 0 || rounds >= 6) break;
    assert.equal(d.r.status, 2, `${t}: ${d.r.stdout.slice(0, 500)}`);
    const j = JSON.parse(d.r.stdout); assert.ok(j.problems?.length, `${t}: a refusal names its problems: ${d.r.stdout.slice(0, 300)}`);
    assert.match(j.error, /Fix: in the entry for slide \d+ of the data file/);
    assert.ok(followFixes(slides, j.problems), `${t}: the refusal's fix could be applied: ${JSON.stringify(j.problems[0])}`);
    rounds++;
  }
  assert.equal(d.r.status, 0, `${t}: built after ${rounds} rounds of fixes: ${d.r.stdout.slice(0, 600)}`);
  return { ...d, rounds, slides };
}
test("long titles and sentences build in every pattern of all 34 templates, and a refusal's fix always gets the deck built", () => {
  const sized = {}, refused = {};
  for (const t of templates) {
    const d = buildFollowingFixes(`stress-${t}`, t), rounds = d.rounds;
    refused[t] = rounds;
    const m = d.r.stdout.match(/(\d+) text\(s\) were set smaller/); sized[t] = m ? +m[1] : 0;
    const files = readdirSync(join(d.dir, ".src", "slides")).map((f) => readFileSync(join(d.dir, ".src", "slides", f), "utf8"));
    assert.ok(!/data-hcu/.test(files.join("")), `${t}: no marker left in a slide`);
    for (const h of files) for (const px of [...h.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((x) => +x[1])) assert.ok(px >= 10, `${t}: ${px}px`);
  }
  assert.ok(Object.values(sized).filter((n) => n > 0).length >= 25, "long words made most templates shrink some text: " + JSON.stringify(sized));
  assert.ok(Object.values(refused).filter((n) => n === 0).length >= 10, "many templates take the long words with no refusal: " + JSON.stringify(refused));
});

test("words that fit no size are refused with the slide, the field, the length that fits and the command to run again", () => {
  const t = "emerald-editorial", unbroken = "Pneumonoultramicroscopicsilicovolcanoconiosis Pneumonoultramicroscopicsilicovolcanoconiosis";
  const d = deckWith("nofit", t, [{ pattern: "media", title: unbroken, body: "Short.", drop: "Screenshot" }, { pattern: "media", title: "Fine title", body: "alpha ".repeat(3000), drop: "Screenshot" }]);
  assert.equal(d.r.status, 2);
  const j = JSON.parse(d.r.stdout);
  assert.match(j.error, /2 texts do not fit its box/); assert.match(j.error, /slide 1 \(the "media" pattern\): "title" reads .*the word "Pneumonoultramicroscopicsilicovolcanoconiosis" \(45 letters\) is wider than the \d+px line/);
  assert.match(j.error, /slide 2 .*"body"/); assert.match(j.error, /Fix: in the entry for slide 1 of the data file, replace that word in "title" with one of about \d+ letters/); assert.match(j.error, /with --redo/);
  assert.deepEqual(j.problems.map((q) => [q.slide, q.field, q.word ? "word" : "lines"]), [[1, "title", "word"], [2, "body", "lines"]]);
  assert.ok(!existsSync(join(d.dir, ".src", "deck.json")), "nothing half-started is left as a deck");
  // a small caption: text of 40 or more characters under 12px is refused with a shorter text, not left for the build to fail
  const c = deckWith("caption", "bold-poster", [{ pattern: "stat-grid", text: piecesOf(readFileSync(join(T, "bold-poster", "slides", readdirSync(join(T, "bold-poster", "slides")).find((f) => /stat-grid/.test(f))), "utf8")).map((p, i) => p.length > 3 && p.length < 30 && !/^[\d\s/.,%+\-:·×$]+$/.test(p) ? (i % 2 ? BODY.slice(0, 60) : p) : p) }]);
  if (c.r.status === 2) assert.match(JSON.parse(c.r.stdout).error, /caption set at [\d.]+px/);
});

test("wrapping and sizing use the template's own letter widths", () => {
  const fit = loadFit(T, "emerald-editorial"), rec = unitsOf(fit, "media").find((u) => u.slot === "title"), m = { ...fit.faces[rec.fk], ls: rec.ls, up: rec.up, fs: rec.fs };
  assert.equal(bestSize(["Short"], rec, m), rec.fs, "a short title keeps the template's size");
  const s = bestSize(["Internationalization"], rec, m); assert.ok(s < rec.fs && s >= floorFor(rec.fs), `one long word shrinks: ${s}`);
  assert.equal(wrap("a b", 80, 1000, m).lines, 1);
  assert.ok(wrap("word ".repeat(30), 80, 580, m).lines > 5);
  assert.equal(bestSize(["Pneumonoultramicroscopicsilicovolcanoconiosis"], rec, m), null);
  const s2 = scan('<div data-hcu="1"><b>x</b> and<br>more <i data-hcu="2">gone</i></div>'); assert.deepEqual(flowOf(s2, s2.els[0]), ["x and", "more"]);
});

test("the recipe tells a background helper to read each named file once, with file_text", () => {
  const p = readSkill({ slug: "artifacts", ref: "presentation" }, {});
  assert.match(p, /read each once, whole, with `file_text`/); assert.match(p, /never `cat`, `head` or a partial read/);
  assert.match(p, /"Days → seconds"/); assert.match(p, /shrink by themselves to fit their boxes/);
});

// 4. With Chrome: the stress decks pass make_deck.sh in one build.
const chrome = [process.env.ONEHC_CHROME, "/opt/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
const hasPlaywright = (() => { try { createRequire(join(S, "browser_runtime.mjs")).resolve("playwright-core"); return true; } catch { return false; } })();
test("decks of long words pass make_deck.sh in one build", { skip: !(chrome && hasPlaywright) && "needs Chrome and playwright-core" }, () => {
  for (const t of ["emerald-editorial", "bold-poster", "monochrome", "retro-windows", "block-frame"]) {
    const d = buildFollowingFixes(`build-${t}`, t);
    const m = run("bash", [S + "make_deck.sh", d.dir], { ONEHC_CHROME: chrome });
    assert.equal(m.status, 0, `${t}: ${m.stdout.split("\n").filter((l) => /FAIL|Fix/.test(l)).join(" ").slice(0, 800)}`);
    assert.match(m.stdout, /PASS: built/);
  }
});
test("words that still cut off after the build repairs them are named by field and length", { skip: !(chrome && hasPlaywright) && "needs Chrome and playwright-core" }, () => {
  const d = deckWith("cutoff", "emerald-editorial", [{ pattern: "media", title: "Internationalization", body: "Short.", drop: "Screenshot" }]);
  assert.equal(d.r.status, 0, d.r.stdout);
  // A hand edit new_deck would have refused: a word of 60 letters in the title.
  const f = join(d.dir, ".src", "slides", "01-media.html"), h = readFileSync(f, "utf8").replace("Internationalization", "Pneumonoultramicroscopicsilicovolcanoconiosispneumonoultra");
  writeFileSync(f, h);
  const m = run("bash", [S + "make_deck.sh", d.dir], { ONEHC_CHROME: chrome });
  assert.equal(m.status, 1, m.stdout); assert.match(m.stdout, /slide 1 \(the "media" pattern\): "Pneumonoultramicroscopicsilicovolcanocon" is cut off\. The box holds about \d+ characters/);
  assert.match(m.stdout, /Fix: in \.src\/slides\/01-media\.html, shorten that text/);
});
test("a slide that fails only because words share room is repaired inside make_deck.sh", { skip: !(chrome && hasPlaywright) && "needs Chrome and playwright-core" }, () => {
  // Every text of the four-step cards longer at once: each fits its own box, together they push the labels off the slide. The build sets them smaller and passes.
  const slides = [{ pattern: "four-steps", text: piecesOf(readFileSync(join(T, "emerald-editorial", "slides", "06-four-steps.html"), "utf8")).map((p) => /^\d\d$/.test(p) ? p : p.length > 60 ? BODY.slice(0, Math.round(p.length * 1.4)) : p.length > 10 ? (POOL + POOL).slice(0, Math.round(p.length * 1.3)).trim() : (POOL + POOL).slice(3, 3 + p.length).trim()) }];
  const d = deckWith("share-room", "emerald-editorial", slides); assert.equal(d.r.status, 0, d.r.stdout);
  const m = run("bash", [S + "make_deck.sh", d.dir], { ONEHC_CHROME: chrome });
  assert.equal(m.status, 0, m.stdout.split("\n").filter((l) => /FAIL|Fix/.test(l)).join(" ").slice(0, 800)); assert.match(m.stdout, /PASS: built/);
});
