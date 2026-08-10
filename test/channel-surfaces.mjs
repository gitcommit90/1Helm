import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";

const root = resolve(import.meta.dirname, "..");
const agentsSource = readFileSync(join(root, "src", "server", "agents.ts"), "utf8");
const stylesSource = readFileSync(join(root, "src", "client", "styles.css"), "utf8");
const coworkEditorsSource = readFileSync(join(root, "src", "client", "cowork-editors.ts"), "utf8");
const dataDir = mkdtempSync(join(tmpdir(), "1helm-channel-surfaces-"));
process.env.CTRL_DATA_DIR = dataDir;
process.env.NODE_ENV = "test";

const agents = await import("../src/server/agents.ts");
const database = await import("../src/server/db.ts");
const { db, now, q, run, UPLOAD_DIR } = database;

const addChannel = (id, name) => {
  run("INSERT INTO channels (id,name,slug,kind,topic,purpose,status,created) VALUES (?,?,?,'channel','','','active',?)", id, name, name, now());
  run(`INSERT INTO channel_computers
    (channel_id,backend,machine_id,image,desired_state,observed_state,cpus,memory_bytes,disk_bytes,home_mount,provision_status,last_used,created,updated)
    VALUES (?,'native',?,'','auto','running',1,1073741824,1073741824,'none','ready',?,?,?)`, id, `channel-surfaces-${id}`, now(), now(), now());
  agents.ensureChannelWorkspace(id);
};

addChannel(901, "surface-test");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("note filenames accept titles with or without .md and reject other extensions", () => {
  assert.equal(agents.validateNoteFilename("Launch Plan.md"), "Launch Plan.md");
  assert.equal(agents.validateNoteFilename("Launch Plan"), "Launch Plan.md");
  assert.throws(() => agents.validateNoteFilename("plan.txt"), /Notes use \.md files.*plan\.md/);
  for (const unsafe of ["", ".md", "../plan.md", "notes/plan.md", " plan.md", "plan.md ", "plan\\one.md", "bad\0.md", `${"a".repeat(158)}.md`]) {
    assert.throws(() => agents.validateNoteFilename(unsafe), /plain Markdown filename/);
  }
});

test("notes create, list, open, save, and rename in /workspace/notes with mirror changes", () => {
  const created = agents.createChannelNote(901, "Launch.md", "# Launch\n");
  assert.equal(created.name, "Launch.md");
  assert.equal(created.content, "# Launch\n");
  assert.equal(readFileSync(join(dataDir, "channels", "901", "workspace", "notes", "Launch.md"), "utf8"), "# Launch\n");
  assert.deepEqual(agents.listChannelNotes(901).map(({ name }) => name), ["Launch.md"]);
  assert.equal(agents.readChannelNote(901, "Launch.md").content, "# Launch\n");

  const saved = agents.saveChannelNote(901, "Launch.md", "# Launch\n\nReady.\n");
  assert.equal(saved.content, "# Launch\n\nReady.\n");
  const renamed = agents.renameChannelNote(901, "Launch.md", "Release.md");
  assert.equal(renamed.name, "Release.md");
  assert.equal(renamed.content, "# Launch\n\nReady.\n");
  assert.throws(() => agents.readChannelNote(901, "Launch.md"), /not found/);

  const changes = q("SELECT relative_path,operation FROM channel_workspace_changes WHERE channel_id=? ORDER BY relative_path", 901);
  assert.deepEqual(changes.filter((row) => String(row.relative_path).includes("notes/")).map((row) => ({ ...row })), [
    { relative_path: "workspace/notes/Launch.md", operation: "delete" },
    { relative_path: "workspace/notes/Release.md", operation: "upsert" },
  ]);
  assert.throws(() => agents.createChannelNote(901, "Release.md", "duplicate"), /already exists/);
  assert.throws(() => agents.saveChannelNote(901, "Release.md", "x".repeat(1024 * 1024 + 1)), /limited to 1 MB/);

  const extensionless = agents.createChannelNote(901, "Meeting notes", "# Meeting\n");
  assert.equal(extensionless.name, "Meeting notes.md");
  assert.equal(readFileSync(join(dataDir, "channels", "901", "workspace", "notes", "Meeting notes.md"), "utf8"), "# Meeting\n");
});

test("notes reject a symlinked notes directory", () => {
  addChannel(902, "symlink-note-test");
  const outside = join(dataDir, "outside-notes");
  mkdirSync(outside);
  rmSync(join(dataDir, "channels", "902", "workspace", "notes"), { recursive: true });
  symlinkSync(outside, join(dataDir, "channels", "902", "workspace", "notes"));
  assert.throws(() => agents.listChannelNotes(902), /not a safe directory/);
});

test("workspace paths stay contained and entry names cannot become paths", () => {
  for (const input of ["", ".", "/", "workspace", "/workspace"]) assert.equal(agents.normalizeWorkspaceDirectoryPath(input), "");
  assert.equal(agents.normalizeWorkspaceDirectoryPath("/workspace/projects/site"), "projects/site");
  assert.equal(agents.normalizeWorkspaceDirectoryPath("files/audio"), "files/audio");
  for (const unsafe of ["../outside", "projects/../outside", "/etc", "projects//site", "projects\\site", "./projects", "projects/./site"]) {
    assert.throws(() => agents.normalizeWorkspaceDirectoryPath(unsafe), /inside \/workspace/);
  }
  assert.equal(agents.validateWorkspaceEntryName("Release assets"), "Release assets");
  for (const unsafe of ["", ".", "..", "../outside", "a/b", "a\\b", " padded", "padded ", "bad\nname"]) {
    assert.throws(() => agents.validateWorkspaceEntryName(unsafe), /plain name/);
  }
});

test("directory listing is navigable, direct-child only, folder-first, and symlink safe", () => {
  const projects = agents.createWorkspaceDirectory(901, "", "projects");
  const site = agents.createWorkspaceDirectory(901, "projects", "site");
  writeFileSync(join(dataDir, "channels", "901", "workspace", "projects", "brief.txt"), "brief");
  assert.equal(projects.path, "projects");
  assert.equal(site.path, "projects/site");

  const rootListing = agents.listWorkspaceDirectory(901, "");
  assert.equal(rootListing.path, "");
  assert.deepEqual(rootListing.files.map(({ path }) => path), ["code", "docs", "files", "notes", "presentations", "projects", "whiteboards"]);
  const projectListing = agents.listWorkspaceDirectory(901, "/workspace/projects");
  assert.deepEqual(projectListing.files.map(({ path }) => path), ["projects/site", "projects/brief.txt"]);
  assert.ok(!projectListing.files.some(({ path }) => path.includes("site/")), "nested descendants are not flattened into the current folder");

  const escaped = join(dataDir, "channels", "901", "workspace", "projects", "outside");
  symlinkSync("/etc", escaped);
  assert.ok(!agents.listWorkspaceDirectory(901, "projects").files.some(({ name }) => name === "outside"));
  assert.throws(() => agents.listWorkspaceDirectory(901, "projects/outside"), /not found/);
  assert.throws(() => agents.createWorkspaceDirectory(901, "projects", "../outside"), /plain name/);
  assert.throws(() => agents.createWorkspaceDirectory(901, "", "files"), /reserved/);

  const mirrorChange = q("SELECT operation FROM channel_workspace_changes WHERE channel_id=? AND relative_path=?", 901, "workspace/projects")[0];
  assert.equal(mirrorChange.operation, "upsert");
});

test("uploads target the selected folder, retain containment, and keep legacy files/ behavior", () => {
  writeFileSync(join(UPLOAD_DIR, "a".repeat(40)), "one");
  writeFileSync(join(UPLOAD_DIR, "b".repeat(40)), "two");
  writeFileSync(join(UPLOAD_DIR, "c".repeat(40)), "three");
  const nested = agents.importWorkspaceUpload(901, null, "a".repeat(40), "report.md", "human", "projects/site");
  const duplicate = agents.importWorkspaceUpload(901, null, "b".repeat(40), "report.md", "human", "/workspace/projects/site");
  const rootUpload = agents.importWorkspaceUpload(901, null, "c".repeat(40), "root.txt", "human", "");
  writeFileSync(join(UPLOAD_DIR, "d".repeat(40)), "four");
  const legacy = agents.importAttachment(901, null, "d".repeat(40), "recording.mp3", "human");
  assert.equal(nested, "workspace/projects/site/report.md");
  assert.equal(duplicate, "workspace/projects/site/report-2.md");
  assert.equal(rootUpload, "workspace/root.txt");
  assert.equal(legacy, "files/recording.mp3");
  assert.equal(readFileSync(join(dataDir, "channels", "901", "workspace", "projects", "site", "report.md"), "utf8"), "one");
  assert.equal(readFileSync(join(dataDir, "channels", "901", "files", "recording.mp3"), "utf8"), "four");
  assert.equal(agents.importWorkspaceUpload(901, null, "e".repeat(40), "missing.txt", "human", "projects"), null);
  assert.equal(agents.importWorkspaceUpload(901, null, "../ctrl-pane.db", "escape.txt", "human", "projects"), null);
  assert.throws(() => agents.importWorkspaceUpload(901, null, "a".repeat(40), "bad.txt", "human", "../outside"), /inside \/workspace/);
  assert.ok(q("SELECT relative_path FROM channel_workspace_changes WHERE channel_id=?", 901).some((row) => row.relative_path === "workspace/projects/site/report.md"));
});

test("workspace files support contained CRUD and protected Cowork roots", () => {
  const created = agents.createWorkspaceFile(901, "docs", "proposal.md", "# Proposal\n");
  assert.equal(created.path, "docs/proposal.md");
  assert.equal(agents.readWorkspaceTextFile(901, created.path).content, "# Proposal\n");
  assert.equal(agents.saveWorkspaceTextFile(901, created.path, "# Proposal\n\nReady.\n").content, "# Proposal\n\nReady.\n");
  const renamed = agents.moveWorkspaceEntry(901, created.path, undefined, "launch-proposal.md");
  assert.equal(renamed.path, "docs/launch-proposal.md");
  const duplicated = agents.duplicateWorkspaceEntry(901, renamed.path);
  assert.equal(duplicated.path, "docs/launch-proposal copy.md");
  agents.deleteWorkspaceEntry(901, duplicated.path);
  assert.throws(() => agents.readWorkspaceTextFile(901, duplicated.path), /not found/);
  const nested = agents.createWorkspaceDirectory(901, "docs", "plans");
  assert.equal(agents.moveWorkspaceEntry(901, renamed.path, nested.path).path, "docs/plans/launch-proposal.md");
  assert.throws(() => agents.moveWorkspaceEntry(901, "docs", "", "renamed-docs"), /top-level workspace folder/);
  assert.throws(() => agents.deleteWorkspaceEntry(901, "notes"), /top-level workspace folder/);
});

test("quick notes choose collision-safe untitled filenames", () => {
  assert.equal(agents.createQuickNote(901, "", "first").name, "untitled-quick-note-1.md");
  assert.equal(agents.createQuickNote(901, "", "second").name, "untitled-quick-note-2.md");
  assert.equal(agents.createQuickNote(901, "Captain thought", "third").name, "Captain thought.md");
  assert.equal(agents.createQuickNote(901, "release.v2", "fourth").name, "release.v2.md");
});

test("agent attachment MIME recognizes MP3 and M4A audio", () => {
  assert.equal(agents.attachmentMimeForName("voice.MP3"), "audio/mpeg");
  assert.equal(agents.attachmentMimeForName("meeting.m4a"), "audio/mp4");
  assert.equal(agents.attachmentMimeForName("archive.bin"), "application/octet-stream");
});

test("channel UI source exposes file-backed Cowork, traditional Files, audio preview, and compact global threads contracts", () => {
  const channelSource = readFileSync(join(root, "src", "client", "channel.ts"), "utf8");
  const apiSource = readFileSync(join(root, "src", "client", "api.ts"), "utf8");
  const appSource = readFileSync(join(root, "src", "client", "app.ts"), "utf8");
  const coworkSource = readFileSync(join(root, "src", "client", "cowork.ts"), "utf8");
  const serverSource = readFileSync(join(root, "src", "server", "index.ts"), "utf8");
  assert.match(channelSource, /export function renderNotes\(/);
  assert.match(channelSource, /const noteSurfaces = new Map/, "note editor nodes survive shell refreshes");
  assert.match(channelSource, /data(?:set)?: \{ notePreviewToggle: "" \}/, "Notes includes a Markdown preview mode");
  assert.match(channelSource, /role: "toolbar", "aria-label": "Note formatting"/, "Notes exposes formatting controls");
  assert.match(channelSource, /\/api\/channels\/\$\{channelId\}\/notes/);
  assert.match(channelSource, /\/files\?path=\$\{encodeURIComponent\(requestedPath\)\}/);
  assert.match(channelSource, /\/files\/directories/);
  assert.match(channelSource, /body: \{ \.\.\.upload, path: currentPath \}/);
  assert.match(channelSource, /data(?:set)?: \{ globalThreadsList: "compact" \}/);
  assert.match(channelSource, /class: "md text-sm leading-5 text-fg", html: md\(item\.summary\)/, "Markdown is rendered in status and Activity summaries too");
  assert.match(apiSource, /blob\.type\.startsWith\("audio\/"\)/);
  assert.match(apiSource, /document\.createElement\("audio"\)/);
  assert.match(appSource, /\["cowork", "Cowork"\]/, "Cowork replaces the visible Notes tab");
  assert.match(appSource, /data(?:set)?: \{ quickNoteHeader: "" \}/, "the header exposes Quick Note");
  assert.doesNotMatch(appSource, /title: "Call Skipper"|aria-label": "Call Skipper"/, "the redundant Call Skipper button is removed");
  assert.match(channelSource, /data(?:set)?: \{ fileFolderTree: "" \}/, "Files has a folder navigation rail");
  assert.match(channelSource, /icon\("folder"/, "Files uses a recognizable folder icon");
  assert.match(coworkSource, /const SECTIONS[\s\S]*"notes"[\s\S]*"whiteboards"[\s\S]*"code"[\s\S]*"docs"[\s\S]*"presentations"/, "Cowork exposes five file-backed work modes");
  assert.match(coworkSource, /version: 3[\s\S]*DEFAULT_PRINTABLE_AREA[\s\S]*width: 1500, height: 1000[\s\S]*PRINTABLE_BOUNDARY_ID/, "Presentations migrate to a visible 1500×1000 printable-area contract");
  assert.match(coworkSource, /presentationPdf[\s\S]*PDFDocument\.create\(\)[\s\S]*for \(const slide of deck\.slides\)[\s\S]*pdf\.addPage/, "Presentations export every slide into one multipage PDF");
  assert.match(coworkSource, /sceneWithoutPrintableBoundary[\s\S]*element\?\.id !== PRINTABLE_BOUNDARY_ID/, "the visible printable boundary is not persisted as user content");
  assert.match(coworkSource, /aria-label": "Printable width"[\s\S]*aria-label": "Printable height"/, "printable dimensions are user configurable");
  assert.match(coworkSource, /mountSpeechToTextControl\(input, "Dictate Cowork agent request"\)/, "Cowork agent requests expose the shared explicit dictation control");
  assert.match(coworkSource, /mountSpeechToTextControl\(speechTarget, `Dictate \$\{mode === "docs" \? "document" : "note"\}`\)/, "Cowork Notes and Docs expose the shared explicit dictation control");
  assert.match(coworkSource, /if \(!value && channel\.agent\?\.kind === "skipper"\) return h\("img"/, "Cowork renders Skipper with a real product avatar instead of an initial");
  assert.match(coworkSource, /const resetEditor[\s\S]*session\.loaded = false[\s\S]*disconnectEditors[\s\S]*resetEditor\(candidate\)/, "Cowork discards disconnected Yjs histories before a hidden surface is reopened");
  assert.match(channelSource, /onclick: \(\) => \{ selected = entry; redrawSelection\(\); \}/, "Files paints selection immediately without re-fetching the guest mirror");
  assert.match(channelSource, /const refreshDirectories = async/, "Files loads its recursive folder tree independently of the current directory listing");
  assert.match(channelSource, /CORE_WORKSPACE_FOLDERS = \["notes", "whiteboards", "code", "docs", "presentations"\]/, "Files visually prioritizes the five Cowork roots");
  assert.match(channelSource, /fileOtherToggle/, "Files groups non-core root entries behind a visual Other disclosure");
  assert.match(channelSource, /files\/docx[\s\S]*catch\(\(error\) => appAlert\(`DOCX download failed:[\s\S]*Download - DOCX/, "Markdown files expose a real DOCX export action with visible failure handling");
  assert.match(stylesSource, /\.cowork-document-body \{[\s\S]*?overflow-y: auto;[\s\S]*?\}/, "long Cowork Notes and Docs edit sessions scroll in the rendered document viewport");
  assert.match(coworkSource, /mode === "code" \? "overflow-hidden" : "overflow-auto"/, "Cowork Code gives its finite editor viewport control of scrolling");
  assert.match(stylesSource, /\.cowork-codemirror-code \.cm-scroller \{ overflow-y: auto; \}/, "long Cowork Code files scroll inside CodeMirror");
  assert.match(stylesSource, /\.cowork-codemirror-code \{[^}]*background: var\(--c-surface\);[^}]*\}[\s\S]*\.dark \.cowork-codemirror-code/, "Code uses a bounded, legible light surface without changing its dark treatment");
  assert.match(stylesSource, /\.cowork-slide-stage[^}]*place-items: start center/, "oversized presentation canvases remain reachable from their top edge");
  assert.match(coworkSource, /fitToContentElementId: PRINTABLE_BOUNDARY_ID/, "every opened, selected, or newly created presentation slide fits exactly its printable boundary");
  assert.match(coworkEditorsSource, /scrollToContent\(target\.length \? target : scene\.elements, \{ fitToContent: true, animate: false, viewportZoomFactor: 0\.88 \}\)/, "presentation fitting leaves a clean margin around the complete dotted boundary");
  assert.match(stylesSource, /\.cowork-slide-stage \{ container-type: size[\s\S]*\.cowork-slide-canvas[^}]*overflow: visible[\s\S]*\.cowork-slide-canvas > \.excalidraw \{ overflow: visible[\s\S]*\.cowork-slide-canvas \.dropdown-menu[^}]*top: 3\.25rem !important[\s\S]*max-height: min\(25rem, max\(8rem, calc\(100cqh - 11rem\)\)\) !important/, "presentation menus escape both Excalidraw clips and stay bounded to the visible stage");
  assert.match(channelSource, /files\/refresh[\s\S]*void refreshMirror\(\)/, "Files paints the host cache first and refreshes the VM mirror independently");
  assert.match(serverSource, /channelFilesRefresh[\s\S]*refreshChannelWorkspaceMirror\(channelId\)/, "Files has one explicit coalesced VM refresh route instead of syncing every click");
  assert.match(coworkSource, /const contextPath = \(session: SectionSession\): string => session\.path \|\| session\.folder/, "Cowork agent context follows an open file or the current folder");
  assert.match(coworkSource, /const openFolder[\s\S]*session\.path = ""[\s\S]*session\.folder = path/, "entering a nested Cowork folder replaces any prior file context");
  assert.match(coworkSource, /coworkPath: context, coworkKind: session\.path \? "file" : "folder"/, "a Cowork panel's first message identifies its validated file-or-folder context");
  assert.match(coworkSource, /if \(!session\.path\)[\s\S]*agentToggle/, "the Cowork folder empty state keeps the agent launcher available");
  assert.match(serverSource, /folderContext \? normalizeCoworkFolderPath[\s\S]*Working \$\{folderContext \? "folder" : "file"\}: \/workspace\/\$\{path\}/, "the server adds the validated file or folder path only to a new Cowork thread");
  assert.match(serverSource, /coworkViewerUsernames\(cid, path, Number\(user\.id\)\)[\s\S]*Working with:/, "the server adds active co-viewers to the first Cowork agent message");
  assert.doesNotMatch(appSource, /controllerchange[\s\S]{0,300}location\.reload\(/, "service-worker updates never reload an active note draft");
});

test("new residents choose an unused character and color combination while options remain", () => {
  assert.match(agentsSource, /const used = new Set\(q\(`[\s\S]*a\.kind='channel'[\s\S]*a\.status<>'deleted'/, "active resident avatars define the used set");
  assert.match(agentsSource, /if \(!used\.has\(candidate\)\) return candidate;/, "provisioning skips an already-used avatar combination");
});
