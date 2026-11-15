import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const listeners = new Map();
globalThis.document = { addEventListener(type, fn) { listeners.set(type, fn); }, getElementById() { return null; } };
globalThis.window = { addEventListener() {} };
globalThis.history = { replaceState() {} };
globalThis.location = { search: "", pathname: "/w/owner/app", hash: "", href: "https://owner.example.com/w/owner/app", origin: "https://owner.example.com" };
const dir = mkdtempSync(join(tmpdir(), "onehelm-byok-core-"));
try {
  const out = join(dir, "byok.mjs");
  await build({ entryPoints: [new URL("../src/byok.ts", import.meta.url).pathname], outfile: out, bundle: true, format: "esm", platform: "browser", logLevel: "silent" });
  const m = await import(pathToFileURL(out).href);
  const calls = [];
  const saved = { base: "https://api.example.com/v1", host: "api.example.com", model: "tool-model", fast: "", last4: "cret" };
  const api = async (path, body) => { calls.push([path, body]); if (path === "/byok") return { saved: null };
    if (path === "/byok/save") return { ok: true, saved, test: { ok: true } }; return { error: "unexpected" }; };
  m.bykInit({ api, repaint() {}, open() {}, note() {}, who: () => "Helper", srow: (i, t, s, r) => `${t}|${s}|${r}`, icon: () => "", shown: () => true, credits() {}, orStart: null });
  m.bykPage(); await new Promise(resolve => setTimeout(resolve, 0));
  let html = m.bykPage();
  assert.match(html, /Service address/);
  assert.match(html, /Model ID with tool calling/);
  assert.doesNotMatch(html, /\$10|credits|plan|data-bykmode/i);
  const input = (k, value) => listeners.get("input")({ target: { dataset: { bykf: k }, value } });
  input("base", saved.base); input("model", saved.model); input("key", "super-secret");
  listeners.get("change")({ target: { matches: () => true, checked: true } });
  html = m.bykPage();
  assert.doesNotMatch(html, /super-secret/);
  listeners.get("submit")({ target: { id: "bykf" }, preventDefault() {}, stopImmediatePropagation() {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.find(([path]) => path === "/byok/save")?.[1]?.key, "super-secret");
  html = m.bykPage();
  assert.match(html, /tool-model/);
  assert.doesNotMatch(html, /super-secret|\$10|credits|plan/i);
} finally { rmSync(dir, { recursive: true, force: true }); }
