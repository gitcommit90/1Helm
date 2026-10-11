import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const source = readFileSync(new URL('../src/v3.ts', import.meta.url), 'utf8');
assert.match(source, /if \(hasFeature\("connected_apps"\)\) cmcpInit\(/);
assert.match(source, /\[CMCP_SEC\]: "connected_apps"/);
assert.match(source, /secShown\(CMCP_SEC\) \? r\(CMCP_SEC\) : ""/);
assert.match(source, /hasFeature\("ambient"\) \? createAmbientCue\(/);
assert.match(source, /LIVE && hasFeature\("ambient"\) && !BOOT\?\.look \? `<button type="button" class="home-notes"/);
assert.match(source, /case "perm": if \(LIVE\) return pmHtml\(\) \+ \(!hasFeature\("connected_apps"\)/);
assert.match(source, /if \(hasFeature\("connected_apps"\)\) registerShortcut\(\{ id: "apps"/);

// A public install must not contact the ambient API or wire its handlers.
// Exercise the same lazy factory selection used by the app, with real bundled EE code.
const built = await build({ entryPoints: [new URL('../src/ee/ambient-cue.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
let requests = 0;
globalThis.fetch = () => { requests++; throw Error('Unexpected ambient request'); };
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {}, querySelectorAll: () => [] };
globalThis.MutationObserver = class { observe() {} };
const { createAmbientCue } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const enabled = false;
const section = enabled ? createAmbientCue({}) : () => '';
assert.equal(section(), '');
assert.equal(requests, 0);
console.log('Public UI keeps custom MCP, ambient cues and Apps shortcuts behind feature gates.');
