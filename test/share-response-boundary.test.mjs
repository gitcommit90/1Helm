import assert from "node:assert/strict";
import { linkHeaders } from "../src/share.js";

const pdf = linkHeaders("application/pdf; charset=utf-8", "guide.pdf", false);
assert.equal(pdf["content-type"], "application/pdf");
assert.match(pdf["content-disposition"], /^inline;/);
assert.equal(pdf["content-security-policy"], "frame-ancestors 'self'");

for (const mime of ["application/pdfx", "application/pdf+html", "application/pdf html"]) {
  const h = linkHeaders(mime, "payload.txt", false);
  assert.match(h["content-disposition"], /^attachment;/, mime);
  assert.match(h["content-security-policy"], /sandbox/, mime);
}
assert.equal(linkHeaders("application/pdf+html", "payload.txt", false)["content-type"], "application/octet-stream");

console.log("ok - only an exact PDF media type receives the unsandboxed inline PDF policy");
