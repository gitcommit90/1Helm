// node --import ./test/stubs/register.mjs test/like-cap.test.mjs
// D1 rejects a LIKE pattern over 50 bytes. likePat keeps every pattern inside that, counting escapes and both %, and never cuts a character in half.
import assert from "node:assert/strict";
import { likePat } from "../src/history-search.js";
const bytes = (s) => new TextEncoder().encode(s).length;
const plain = likePat("a".repeat(60));
assert.equal(plain, `%${"a".repeat(48)}%`); assert.equal(bytes(plain), 50);
assert.equal(likePat("hello"), "%hello%");
const multi = likePat("é".repeat(40)); assert.ok(bytes(multi) <= 50); assert.match(multi, /^%(é)+%$/);
const emoji = likePat("😀".repeat(20)); assert.ok(bytes(emoji) <= 50); assert.ok(!emoji.includes("�")); assert.match(emoji, /^%(😀)+%$/);
const esc = likePat("%_\\".repeat(30)); assert.ok(bytes(esc) <= 50); assert.match(esc, /^%(\\[%_\\])+%$/);
console.log("like-cap ok");
