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
  assert.match(checklist, /--notes-file "\$RELEASE_NOTES"/);
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
