# Skills (src/skills/)

Skills are the helper's "how to do an X" playbooks: per-task recipes with fixed rules, helper scripts and a check that must pass
before anything is handed over. The helper sees a one-line list of every skill in its system prompt and reads a skill with
`read_skill` before doing a task the skill covers.

## Layout (stable; other branches build on it)

```
src/skills/
  README.md                   this file (not a skill)
  index.js                    the loader: SKILLS, SKILLS_INDEX (the prompt's list), read_skill, the scripts bundle
  build.mjs                   regenerates bundle.js: run `node src/skills/build.mjs` after adding, renaming or removing any file
  bundle.js                   GENERATED: one static import per file below. Never hand-edit; a test fails when it's stale
  <slug>/SKILL.md             required
  <slug>/references/<name>.md optional; subfolders allowed (references/pdf/visual.md is the ref "pdf/visual")
  <slug>/scripts/<file>       optional; subfolders allowed; text files only (.py .mjs .js .sh .json ...), no binaries
```

- `<slug>`: lowercase letters, digits and hyphens (`artifacts`, `self-awareness`, `wide-research`). The folder name is the slug.
- Anything else in a skill folder (eval/, notes) is ignored by the loader and not bundled.

## SKILL.md

```
---
name: <slug, same as the folder>
description: Use when <the situations this skill covers>, in one line.
always: false
---
# Title

Body in plain Markdown.
```

- `description` is one line and starts with "Use when". It is what the helper sees in its prompt, so it must say exactly when
  the skill applies.
- `always: true` marks a skill the helper should read for every task of its kind (Muse's includeInPrompt). Its body is still
  NOT inlined in the prompt; only the one-line entry is listed, so the prompt stays lean.
- Same `{{#flag}}…{{/flag}}` switches as src/prompt and src/docs (render() in src/prompt/index.js), so a skill only describes
  what this deployment has. Lines starting with `TODO(Captain)` are notes for the Captain and are never served.
  Because of that, SKILL.md and references can't contain a literal `{{` or `}}` (a template example, say): put such text in a
  script or example file under scripts/ and point to it. The test renders every skill in every switch set and catches it.
- Name only 1Helm tools that exist (in backticks: `share_file`, `run_command`, `read_skill`). A test checks every tool named in
  every SKILL.md and reference against the channel's real tool list.
- Point to references by name ("read_skill with ref `pdf/visual`" or just "the pdf/visual reference") and to scripts by their
  real path on the computer (below).

## Scripts: where they live on the channel computer

**Path: `/opt/1hc/skills/<slug>/scripts/<file>`** (executable bits set for .sh .py .mjs .js). Write that exact path in SKILL.md,
e.g. `python3 /opt/1hc/skills/artifacts/scripts/validate_xlsx.py out.xlsx`.

Mechanism: the scripts are bundled into the Worker as text (wrangler Text rule for `**/skills/*/scripts/*`, next to `**/*.md`;
bundle.js imports them as "../skills/<slug>/scripts/…" so that rule matches nothing else), and the
channel computer's controller (src/channel-computer.js) writes the whole set to `/opt/1hc/skills/` on the computer's own disk:

- right after each start (next to the Chrome policy setup), and
- before a command whenever the installed set is older than the deployed Worker (a deploy while the computer is up).

So scripts always match the SKILL.md text of the same deploy, need no image rebuild, and never land in /workspace: they're not
saved into the channel's files, don't count toward storage, and the helper can't lose them by cleaning its folder. The install is
one command with the files on stdin, swapped in atomically (`/opt/1hc/skills/.version` holds the set's hash).

Why not bake them into the image: every script fix would need an image rebuild + push + container rollout, and the image and the
Worker could disagree during a rollout. The path is the same either way, so baking later changes nothing in SKILL.md.

What the image itself must provide (Python packages, LibreOffice, poppler, Chromium, fonts...) is a separate image change. A skill
that needs a tool the image lacks must say so in its own branch report.

## Channel skills (later)

Per-channel custom skills (skill-creator) will be stored in the channel and passed to the loader as `extra` skills of the same
shape (`{ slug, description, always, body, refs }`). They're listed in the per-channel block, never in the static core, so the
core stays byte-identical across tenants. Built-in slugs win on a clash.

## Example

`self-awareness/` is the first real skill: SKILL.md, two references (question-types, when-asked) and one script
(`/opt/1hc/skills/self-awareness/scripts/inventory.sh`, what's on the computer, newest first).

## Checks (test/skills.test.mjs)

Every skill folder is in bundle.js and vice versa; frontmatter is valid; the prompt list is sorted, deterministic and identical
across tenants; `read_skill` with an unknown slug or ref returns the list; refs load; every tool named in any skill exists.
