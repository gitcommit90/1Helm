// native-transport/.dockerignore is an allowlist (`*` then `!file`). Every non-test .go file must be allowed,
// or `go build` in the container Dockerfile fails because the file is missing from the build context.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../native-transport/", import.meta.url);
const lines = readFileSync(new URL(".dockerignore", dir), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
assert.ok(lines.includes("*"), ".dockerignore must start from the allowlist pattern `*`");
const allowed = new Set(lines.filter((l) => l.startsWith("!")).map((l) => l.slice(1)));
const goFiles = readdirSync(dir).filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"));
assert.ok(goFiles.length > 0, "no .go files found");
const missing = goFiles.filter((f) => !allowed.has(f));
assert.deepEqual(missing, [], `native-transport/.dockerignore does not allow: ${missing.join(", ")}. Add "!<file>" for each.`);
console.log("ok native-transport dockerignore allows", goFiles.join(", "));
