import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("v0.0.9 and later use the complete AGPL-3.0-only license owned by Joseph Yaksich", () => {
  const license = read("LICENSE");
  const [product, owner, blank, ...canonicalLines] = license.split("\n");
  const canonical = canonicalLines.join("\n");
  assert.equal(product, "1Helm");
  assert.equal(owner, "Copyright (c) 2026 Joseph Yaksich.");
  assert.equal(blank, "");
  assert.equal(
    createHash("sha256").update(canonical).digest("hex"),
    "0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0",
    "the complete canonical GNU AGPL-3.0 text remains intact after the ownership notice",
  );
  assert.match(canonical, /GNU AFFERO GENERAL PUBLIC LICENSE\n\s+Version 3, 19 November 2007/);
  assert.match(canonical, /13\. Remote Network Interaction/);
  assert.match(canonical, /END OF TERMS AND CONDITIONS/);
  assert.doesNotMatch(license, /Copyright \(c\) 2026 1Helm contributors/);

  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.license, "AGPL-3.0-only");
  assert.equal(lock.packages[""].license, "AGPL-3.0-only");
});

test("public surfaces state the MIT-to-AGPL release boundary honestly", () => {
  const notice = read("NOTICE");
  assert.match(notice, /releases up to and including v0\.0\.8 were released under the MIT License/);
  assert.match(notice, /releases v0\.0\.9 and later are released under AGPL-3\.0-only/);
  assert.match(notice, /Copyright \(c\) 2026 Joseph Yaksich\./);

  const readme = read("README.md");
  assert.match(readme, /<code>AGPL-3\.0-only<\/code>/);
  assert.match(readme, /1Helm · AGPL-3\.0-only · Copyright © 2026 Joseph Yaksich/);
  assert.doesNotMatch(readme, /MIT licensed/i);

  const terms = read("site/terms.html");
  assert.match(terms, /releases beginning with v0\.0\.9[\s\S]*AGPL-3\.0-only/);
  assert.match(terms, /Releases through v0\.0\.8 remain available under the MIT License/);
  assert.doesNotMatch(terms, /you can do nearly anything with it/i);
  assert.doesNotMatch(terms, /1Helm contributors/);

  const app = read("src/client/app.ts");
  assert.match(app, /AGPL-3\.0-only[\s\S]*https:\/\/github\.com\/gitcommit90\/1Helm[\s\S]*View source code/,
    "network users have an in-product route to the corresponding source repository");
});

test("desktop package filters retain LICENSE and NOTICE and the Mac DMG exposes both", () => {
  const mac = read("scripts/package-mac-dmg.cjs");
  assert.match(mac, /LICENSE\$\|NOTICE\$/);
  assert.match(mac, /path\.join\(ROOT, "LICENSE"\), path\.join\(stage, "LICENSE\.txt"\)/);
  assert.match(mac, /path\.join\(ROOT, "NOTICE"\), path\.join\(stage, "NOTICE\.txt"\)/);
});

test("contributions require an accurate DCO sign-off", () => {
  const contributing = read("CONTRIBUTING.md");
  assert.match(contributing, /Developer Certificate of Origin \(DCO\)/);
  assert.match(contributing, /Developer Certificate of Origin 1\.1/);
  assert.match(contributing, /Signed-off-by: Your Name <you@example\.com>/);
  assert.match(contributing, /git commit -s/);
  assert.match(contributing, /not a copyright\s+assignment/);
});
