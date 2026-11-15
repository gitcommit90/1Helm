// The task view follows a streaming reply only while the person is at the bottom. Synthetic DOM, no browser, no network.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
class Node_ {} class Element_ extends Node_ { closest() { return null; } } class HTMLElement_ extends Element_ {} class HTMLImageElement_ extends HTMLElement_ {}
const handlers = {};
const el = Object.assign(new HTMLElement_(), { id: 'scroll', scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
globalThis.Node = Node_; globalThis.Element = Element_; globalThis.HTMLElement = HTMLElement_; globalThis.HTMLImageElement = HTMLImageElement_;
globalThis.window = { setTimeout: () => 0 };
globalThis.document = { getElementById: (id) => id === 'scroll' ? el : null, addEventListener: (type, fn) => { handlers[type] = fn; } };
const code = (await build({ entryPoints: ['src/chat-follow.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'error' })).outputFiles[0].text;
const { followWant, followPin, followSent, followDrawn, followKeep } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const scroll = (top) => { el.scrollTop = top; handlers.scroll({ target: el }); };
const grow = (n) => { el.scrollHeight += n; };

followDrawn('main/1');
assert.equal(el.scrollTop, el.scrollHeight, 'opening a task goes to the bottom');
grow(200); followPin();
assert.equal(el.scrollTop, el.scrollHeight, 'at the bottom the view follows a growing reply');

scroll(300);
assert.equal(followWant(), false, 'scrolling up stops following');
grow(200); followPin();
assert.equal(el.scrollTop, 300, 'a reply that keeps growing does not move a view the person scrolled up');
followKeep(() => grow(100));
assert.equal(el.scrollTop, 300, 'a repaint keeps the place when the person is not at the bottom');
followDrawn('main/1');
assert.equal(el.scrollTop, 300, 'a redraw of the same task keeps the place');

scroll(el.scrollHeight - el.clientHeight);
assert.equal(followWant(), true, 'scrolling back to the bottom follows again');
followKeep(() => grow(50));
assert.equal(el.scrollTop, el.scrollHeight, 'a repaint at the bottom stays pinned');

scroll(100); followSent();
assert.equal(followWant(), true, 'sending a message follows the bottom again');
scroll(100); followDrawn('main/2');
assert.equal(el.scrollTop, el.scrollHeight, 'opening another task goes to the bottom');
console.log('chat-follow ok');
