import assert from "node:assert/strict";
import test from "node:test";
import { md, textReplaceOps } from "../src/client/dom.ts";

test("md renders headings and emphasis for the document surface", () => {
  const html = md("# Title\n\n**bold** and _italic_\n\n- one\n- two\n");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<ul>/);
  assert.doesNotMatch(html, /\*\*bold\*\*/);
});

test("textReplaceOps keeps shared prefix and suffix", () => {
  assert.equal(textReplaceOps("same", "same"), null);
  assert.deepEqual(textReplaceOps("abXcd", "abYcd"), { start: 2, deleteLen: 1, insert: "Y" });
  assert.deepEqual(textReplaceOps("aaa", "bbb"), { start: 0, deleteLen: 3, insert: "bbb" });
});
