// The Zone is loaded only when a file is opened in it: its code, styles and effect are separate files next to app.js, never part of it.
// The web build writes them, and once app.js holds the loader the files must be there (this test reads the built files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const A = 'app-assets/app-static';

test('the web build writes the Zone files next to app.js', () => {
  const s = read('web/build.mjs');
  assert.match(s, /zone: source\("src\/zone\.ts"\), "zone-ui": source\("src\/zone\.css"\)/);
  assert.match(s, /outdir: `\$\{target\}\/zone`/);
});

test('app.js loads the Zone on demand and holds none of it', () => {
  const app = read(`${A}/app.js`);
  if (!app.includes('zone/zone.js')) return;   // not shipped yet
  assert.doesNotMatch(app, /__zb|pixels-mechanic|plaintext-only|ImageGeneration/, 'the in-frame scripts and the effect are not in app.js');
  assert.ok(statSync(new URL(`../${A}/app.js`, import.meta.url)).size < 1_250_000, 'app.js stays about the size it was (the Zone and the effect are 0.9 MB on their own)');
  for (const f of ['zone/zone.js', 'zone/zone-ui.css', 'zone/imgfx.js']) assert.ok(existsSync(new URL(`../${A}/${f}`, import.meta.url)), `${f} is shipped`);
  const fx = read(`${A}/zone/imgfx.js`);
  assert.match(fx.slice(0, 400), /MIT License/, 'the effect keeps its license notice');
  assert.match(fx.slice(0, 200), /img-fx/, 'and its name');
  const zone = read(`${A}/zone/zone.js`);
  assert.ok(zone.includes('zone-edit'), 'the Zone saves through the zone-edit route');
  assert.ok(!/allow-same-origin/.test(zone.replace(/"allow-scripts allow-popups"/g, '')), 'the canvas frame is never given allow-same-origin');
});
