// node test/library-upload-stale-list.test.mjs: a Library list fetched before an upload finished must not drop the uploaded file's row.
import assert from "node:assert"; import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/v3.ts", import.meta.url), "utf8");
const i = src.indexOf("function setFiles("), body = src.slice(i, src.indexOf("\n}\n", i));
assert.match(body, /FILE_NEW/, "setFiles keeps rows from uploads that just finished");
assert.match(body, /\.\.\.keep/, "kept rows are added to the new list");
assert.match(src, /FILE_NEW\.set\(f\.id, Date\.now\(\)\)/, "upload records the new file id");
