import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("multi-item releases retain the complete numbered acceptance ledger", () => {
  const checklist = read("docs/release-checklist.md");
  const lifecycle = read("docs/release-lifecycle.md");
  const governance = read("docs/GOVERNANCE.md");
  const pullRequest = read(".github/pull_request_template.md");
  const notesTemplate = read("docs/release-notes-template.md");

  for (const source of [checklist, lifecycle, governance, pullRequest, notesTemplate]) {
    assert.match(source, /numbered acceptance\s+ledger/i);
  }
  assert.match(checklist + read(".github/workflows/promote-stable.yml") + read("scripts/publish-promotion.mjs"), /--notes-file/);
  assert.doesNotMatch(checklist, /gh release create[^\n]+--generate-notes/);
  assert.match(notesTemplate, /^1\. \*\*Feature or fix name\*\*/m);
  assert.match(notesTemplate, /artifact/i);
  assert.match(notesTemplate, /verification/i);
});

test("one retained Mac Studio owns the complete macOS release gate", () => {
  const tracked = [
    read("docs/release-checklist.md"),
    read("docs/release-lifecycle.md"),
    read("docs/GOVERNANCE.md"),
    read("docs/release-notes-template.md"),
    read("CHANGELOG.md"),
  ].join("\n");

  assert.match(tracked, /same retained Apple Silicon release host/i);
  assert.match(tracked, /publicly downloaded/i);
  assert.match(tracked, /Application Support preservation/i);
});

// The tracked release authority: three published artifacts, and Windows accepted
// by behaviour because it publishes nothing at all.
const RELEASE_DOCS = {
  "docs/release-checklist.md": read("docs/release-checklist.md"),
  "docs/release-lifecycle.md": read("docs/release-lifecycle.md"),
  "docs/GOVERNANCE.md": read("docs/GOVERNANCE.md"),
  "docs/release-notes-template.md": read("docs/release-notes-template.md"),
};

test("desktop releases fail closed unless Mac, Linux, and Windows ship together", () => {
  const checklist = read("docs/release-checklist.md");
  const lifecycle = read("docs/release-lifecycle.md");
  const governance = read("docs/GOVERNANCE.md");
  const notes = read("docs/release-notes-template.md");
  const vision = read("docs/VISION.md");

  for (const source of [checklist, lifecycle, governance, notes, vision]) {
    assert.match(source, /Mac(?:OS)?[^\n]+Linux[^\n]+Windows|macOS[^\n]+Linux[^\n]+Windows/i);
  }
  assert.match(checklist + lifecycle + governance, /pause (?:the )?(?:whole|entire) release/i);
  assert.match(checklist + governance, /Never[\s\S]+self-signed|Never[\s\S]+self-sign/i);
  assert.doesNotMatch(notes, /Other published artifact, or `Not applicable`/i);
});

test("every release document names the same three published artifacts", () => {
  for (const [path, source] of Object.entries(RELEASE_DOCS)) {
    for (const artifact of ["arm64.dmg", "mac-arm64.zip", "linux-node.tgz"]) {
      assert.match(source, new RegExp(`1Helm-[^\\s\`]*${artifact.replaceAll(".", "\\.")}`, "i"),
        `${path} must name the ${artifact} release artifact`);
    }
    assert.match(source, /three[\s\S]{0,40}(?:artifacts?|files?|rows?)/i,
      `${path} must state that the desktop matrix is exactly three artifacts`);
    assert.doesNotMatch(source, /six[- ](?:file|artifact)|complete six/i,
      `${path} must not describe a six-artifact desktop matrix`);
  }
  const checklist = RELEASE_DOCS["docs/release-checklist.md"];
  assert.match(checklist, /for artifact in "\$DMG" "\$UPDATE_ZIP" "\$HEADLESS"; do/,
    "the checklist verifies exactly the three built artifacts");
  const promotion = read("scripts/publish-promotion.mjs");
  assert.match(promotion, /STABLE_ARTIFACT_ROLES\.map/,
    "the publish command derives exactly the three validated artifact roles");
  assert.match(promotion, /"release", "create", tag, \.\.\.artifactPaths, stablePath/,
    "the publish command attaches the three artifacts plus their Stable manifest");
  assert.match(promotion, /"--draft"[\s\S]*expectedAssets[\s\S]*"--draft=false"/,
    "publication exposes Stable only after the complete draft matrix is digest-verified");
});

test("release documents never reintroduce a Windows artifact, installer or signing lane", () => {
  // Windows has no executable, so there is nothing to package, no update
  // manifest to publish and no signature status to disclose. Any of these tokens
  // reappearing means the retired Electron/Squirrel lane crept back in.
  const retired = [
    [/squirrel/i, "Squirrel"],
    [/\.nupkg/i, "a .nupkg package"],
    [/\bRELEASES\b/, "a RELEASES manifest"],
    [/authenticode/i, "Authenticode signing"],
    [/setup\.exe|windows[- ]x64[- ]setup/i, "a Windows Setup executable"],
    [/package:windows/, "a Windows packaging npm script"],
    [/NotSigned/, "a Windows NotSigned signature disclosure"],
    [/electron-winstaller/i, "the Squirrel installer builder"],
    [/native-windows|Windows update feed/i, "a Windows update feed"],
  ];
  for (const [path, source] of Object.entries(RELEASE_DOCS)) {
    for (const [pattern, description] of retired) {
      assert.doesNotMatch(source, pattern, `${path} must not reintroduce ${description}`);
    }
    assert.match(source, /Windows (?:publishes|owns) no/i,
      `${path} must state plainly that Windows publishes no release artifact`);
  }
});

test("Windows is accepted by behaviour through the site-served PowerShell installer", () => {
  const checklist = RELEASE_DOCS["docs/release-checklist.md"];
  const governance = RELEASE_DOCS["docs/GOVERNANCE.md"];
  const lifecycle = RELEASE_DOCS["docs/release-lifecycle.md"];
  const notes = RELEASE_DOCS["docs/release-notes-template.md"];

  for (const [path, source] of Object.entries(RELEASE_DOCS)) {
    assert.match(source, /https:\/\/1helm\.com\/install\.ps1/,
      `${path} must install Windows from the site-served install.ps1`);
  }
  // Each numbered behavioural requirement of the Windows acceptance lane.
  for (const [pattern, requirement] of [
    [/irm https:\/\/1helm\.com\/install\.ps1 \| iex/, "the exact PowerShell one-liner"],
    [/non-elevated/i, "a non-elevated PowerShell window"],
    [/(?:one|single|exactly one) UAC prompt/i, "exactly one UAC prompt"],
    [/restart/i, "the mid-install restart"],
    [/resum/i, "the resumed second run"],
    [/keepalive/i, "the keepalive"],
    [/reboot/i, "keepalive survival across a reboot"],
    [/http:\/\/localhost:8123/, "the browser reaching localhost:8123"],
    [/\/var\/lib\/1helm-oci-v1/, "the retained data root"],
    [/uninstall\.ps1/, "removal via uninstall.ps1"],
  ]) {
    for (const [path, source] of [["docs/release-checklist.md", checklist], ["docs/GOVERNANCE.md", governance]]) {
      assert.match(source, pattern, `${path} must require ${requirement} for Windows acceptance`);
    }
  }
  assert.match(notes, /irm https:\/\/1helm\.com\/install\.ps1 \| iex/,
    "release notes tell users the one command that installs Windows");
  assert.match(notes + governance + checklist, /uninstall\.ps1[\s\S]{0,400}wsl --shutdown|wsl --shutdown[\s\S]{0,400}uninstall\.ps1/,
    "removal must be documented as never calling wsl --shutdown");
  assert.match(lifecycle + checklist, /served from the site|site-served|serves? .{0,40}install\.ps1/i,
    "install.ps1 is served by the site rather than attached to a release");
  assert.match(checklist + lifecycle, /Linux (?:artifact|archive)[\s\S]{0,120}blocks Windows/i,
    "a failed Linux artifact must block Windows, which installs it");
});
