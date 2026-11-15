// Image tiles (the + picker, chat file tiles, marked pictures in a message, the chip a picked Library image becomes) load the small picture
// (?thumb=1&c=<version>), never the original; the full viewer and downloads still use the original address. Picker tiles are kept loaded between opens.
// node test/tile-thumbs.test.mjs
import assert from 'node:assert/strict'; import fs from 'node:fs';
const v3 = fs.readFileSync(new URL('../src/v3.ts', import.meta.url), 'utf8'), am = fs.readFileSync(new URL('../src/ee/annotation-msg.ts', import.meta.url), 'utf8');
const line = (re) => { const l = v3.split('\n').find(x => re.test(x)); assert.ok(l, `no line matches ${re}`); return l; };
const th = line(/^const thumbUrl = /); assert.match(th, /\?thumb=1/); assert.match(th, /&c=\$\{v\}/); assert.match(th, /FVER\.get/, 'names the version the live file list reported, else the one the caller has');
assert.match(line(/^const pkThumb = /), /src="\$\{thumbUrl\(PK\.slug, a\.fid, a\.ver\)\}"/, 'picker tiles');
assert.match(line(/thumb: a\.kind === "image" \? /), /thumbUrl\(slug, id, a\.ver\)/, 'the chip of a picked Library image');
assert.match(line(/chat-tile-preview\$\{f\.image/), /<img src="\$\{thumbUrl\(ch\.slug, f\.id, f\.version\)\}"/, 'chat file tiles');
assert.match(line(/annMsgHtml\(tm\.annotations/), /id => thumbUrl\(ch\.slug, id\)[,)]/, 'marked pictures');
assert.match(am, /\(thumb \|\| url\)\(a\.marked\)/); assert.match(am, /href="\$\{esc\(url\(a\.marked\)\)\}"/, 'the link still opens the original');
assert.match(line(/chat-tile-open" href="\$\{u\}"/), /const k|href="\$\{u\}"/); assert.match(v3, /const k = fkind\(f\.name, f\.mime\), u = fileUrl\(ch\.slug, f\.id\)/, 'the open link and download keep the original address');
// the tiles stay loaded between opens
assert.match(v3, /const PKWARM = new Map<string, HTMLImageElement>\(\)/); assert.match(v3, /pkPaint\(\); pkWarm\(\);/, 'warmed on every open');
console.log('tile-thumbs: ok');
