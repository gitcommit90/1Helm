// node --import ./test/stubs/register.mjs test/model-migration.test.mjs
// The first saved settings (src/model-seed.js) reproduce what is in effect today, job by job. The expected values below are typed from the earlier
// behavior (the earlier code defaults, evaluated chore policies, and the CHORE_MODEL_* variables an earlier hosted deployment set), not
// computed from the seed, so a drift in either fails here. The environment variables are a synthetic copy of those four settings.
import assert from "node:assert/strict";
import { seedFromLegacy, seedFresh, mergeLevels } from "../src/ee/model-seed.js";
import { validateModelSettings } from "../src/ee/model-settings.js";
import { choreRouteOf, entriesOf } from "../src/ee/model-jobs.js";
import { policyRoute, dispatchOrder } from "../src/ee/route2.js";
import { CATEGORIES } from "../src/ee/pool.js";
import { ID } from "./helpers/seed-settings.mjs";

const vars = () => ({ MODEL: "@cf/zai-org/glm-5.3-flash", OWN_ROUTER_CLEF: "clef", CHORE_MODEL_LABEL: "dsflash", CHORE_MODEL_BROWSER: "dsflash" });
const { MUSE_C: MC, MUSE_S: MS, DEEPSEEK: DS, LUNA: LU, HAIKU: HA, OSS120: O120, QWEN, GLM } = ID;
const NEW = ["azure", "azure/us", "azure/eu"], DSH = ["together", "modal", "coreweave"], HAH = ["google-vertex", "amazon-bedrock"];

// chat lists, per level, typed from the earlier spec (PROMPT.md section 3) with the earlier fixed efforts
const EFFORT = { [MC]: "xhigh", [MS]: "xhigh", [DS]: "max", [LU]: "xhigh", [HA]: "xhigh" };
// Sol left the first-run data (Captain, 2026-10-15): Haiku takes its place in each list, once per list.
const CHAIN = {
  general:         { unrestricted: [MC, DS, LU], no_training: [DS, MS, LU], zdr: [DS, LU, HA] },
  research:        { unrestricted: [MC, DS, HA], no_training: [MS, DS, HA], zdr: [DS, HA] },
  apps_economical: { unrestricted: [MC, DS, HA], no_training: [DS, MS, HA], zdr: [DS, HA] },
  skills:          { unrestricted: [MC, DS, HA], no_training: [DS, HA, MS], zdr: [DS, HA] },
  spreadsheet:     { unrestricted: [LU, HA, MC], no_training: [LU, HA, MS], zdr: [LU, HA] },
  technical:       { unrestricted: [HA, DS], no_training: [HA, DS], zdr: [HA, DS] },
  apps_complete:   { unrestricted: [HA, DS], no_training: [HA, DS], zdr: [HA, DS] },
};
// background jobs: [model, effort, hosts, pinned, fallbacks as [model, effort, hosts, pinned]]
const CHORES = {
  handoff: [DS, "low", DSH, true, [[HA, "low", HAH, true]]],
  label: [HA, "low", HAH, true, [[DS, "low", DSH, true]]], notes: [LU, "low", NEW, true, [[DS, "low", DSH, true]]], notes_refine: [DS, "low", DSH, true, [[HA, "low", HAH, true]]], notes_final: [HA, "low", HAH, true, [[DS, "low", DSH, true]]],
  sidecar_card: [HA, "low", HAH, true, [[DS, "low", DSH, true]]], ambient_extract: [LU, "low", NEW, true, [[DS, "low", DSH, true]]], ambient_review: [DS, "low", DSH, true, [[HA, "low", HAH, true]]],
  // the first-run data (dev and Live already saved their own browser setting; no variable chooses it any more)
  browser: [O120, "low", ["cerebras"], true, [[DS, "low", DSH, true]]],
};
// the saved hosts and pins stay in the saved settings but are no longer part of the route: OpenRouter picks the provider
const shape = (r) => [r.model, r.effort, r.host, r.pin, r.fallbacks.map((f) => [f.model, f.effort, f.host, f.pin])];

for (const file of ["earlier hosted variables"]) {
  const env = vars(), s = validateModelSettings(seedFromLegacy(env, null)), tag = file;
  // chat: every level's first choice and own list, each model at its earlier effort
  for (const c of CATEGORIES) for (const lv of ["unrestricted", "no_training", "zdr"]) {
    const got = dispatchOrder(policyRoute(s, c, lv, "x"), lv, { settings: s }).attempts, want = CHAIN[c][lv];
    assert.equal(got[0].model, want[0], `${tag} ${c}/${lv} first choice`);
    for (const a of got) assert.equal(a.effort, EFFORT[a.model], `${tag} ${c}/${lv} ${a.model} effort`);
    if (lv !== "unrestricted") assert.deepEqual(got.map((a) => a.model), want, `${tag} ${c}/${lv}`);
    else if (!(c === "general" || c === "research" || c === "apps_economical")) assert.deepEqual(got.map((a) => a.model), want, `${tag} ${c}/${lv}`);
  }
  // recovery and the mid-task switch: the model of the slot they used before, at that slot's effort
  for (const [job, model] of [["recover.apps_economical", HA], ["recover.apps_complete", HA], ["recover.technical", HA], ["recover.spreadsheet", HA], ["escalate", HA]])
    assert.deepEqual([s.jobs[job].model, s.jobs[job].effort, s.jobs[job].fallbacks], [model, EFFORT[model], []], `${tag} ${job}`);
  // background jobs, with the real environment variables
  for (const [id, [model, effort, hosts, pin, fbs]] of Object.entries(CHORES)) {
    const r = choreRouteOf(s, id); assert.deepEqual(shape(r), [model, effort, undefined, undefined, fbs.map((f) => [f[0], f[1], undefined, undefined])], `${tag} ${id}`);
  }
  assert.equal(choreRouteOf(s, "label").json && choreRouteOf(s, "browser").json, true);
  // everything else
  const J = s.jobs;
  assert.deepEqual([J.decider.model, J.decider.effort], [ID.PPLX, null]);
  assert.deepEqual([J.stt.model, J.stt.fallbacks.map((f) => f.model), J.stt_cloudflare.model, J.live_dictation.model], [ID.STT_BEST, [ID.STT, ID.STT_FALLBACK], ID.STT_WAI, ID.STT_BEST]);
  assert.deepEqual(J.live_dictation.fallbacks.map((f) => f.model), [ID.LIVE], "Deepgram Nova 3 is the live dictation fallback");
  assert.deepEqual([J.embed_files.model, J.embed_memory.model, J.vision_files.model], [ID.EMBED_FILES, ID.EMBED_MEMORY, ID.VISION]);
  assert.equal(J.workers_ai_chat.model, ID.WAI_CHAT, "the first-run Workers AI model (the MODEL variable is no longer read)");
  for (const gone of ["classic_router", "doors_shadow", "classic_decider"]) assert.ok(!(gone in J), `${gone} is no longer a job`);
  // the config files' variables are decoys now: the first-run data is the same with or without them
  assert.deepEqual(seedFromLegacy(env, null), seedFromLegacy({}, null), `${tag}: no environment variable changes the first-run data`);
}

// the first-run data for an environment with no variables set has the same shape, and the same chat lists
{ const s = validateModelSettings(seedFresh({})); assert.equal(Object.keys(s.jobs).length, 32);
  assert.deepEqual(shape(choreRouteOf(s, "browser")), [O120, "low", undefined, undefined, [[DS, "low", undefined, undefined]]], "gpt-oss-120b, with DeepSeek Flash as its fallback"); }

// a saved earlier configuration is carried exactly: replaced slots, custom lists, configured chores, the decider
{ const catalog = { "acme/alpha": { id: "acme/alpha", name: "Alpha", eligible: true, reasons: [], efforts: ["none", "low", "high"], default_effort: "low", levels: ["unrestricted", "no_training", "zdr"], hosts: ["safe/fp16"], context_length: 16384,
    max_output: 4096, input_modalities: ["text"], pricing: { prompt: 1, completion: 2 }, tool_choice: ["auto"], json: true } };
  const legacy = { efforts: { "muse-c": "xhigh", "muse-s": "xhigh", deepseek: "high", luna: "xhigh", haiku: "xhigh" }, models: { "muse-c": MC, "muse-s": MS, deepseek: "acme/alpha", luna: LU, haiku: HA }, catalog,
    chains: Object.fromEntries(CATEGORIES.map((c) => [c, { unrestricted: ["muse-c", "deepseek", "luna"], no_training: ["deepseek", "muse-s", "luna"], zdr: ["deepseek", "luna", "haiku"] }])),
    chores: Object.fromEntries(["handoff", "label", "browser", "notes", "notes_refine", "notes_final", "sidecar_card", "ambient_extract", "ambient_review"].map((r) => [r, { model: "default", effort: "default" }])),
    decider: "default" };
  legacy.chores.browser = { model: "acme/alpha", effort: "high" }; legacy.chores.sidecar_card = { model: "haiku", effort: "medium" };
  const s = validateModelSettings(seedFromLegacy({}, legacy));
  assert.deepEqual(dispatchOrder(policyRoute(s, "general", "zdr", "x"), "zdr", { settings: s }).attempts.map((a) => [a.model, a.effort]), [["acme/alpha", "high"], [LU, "xhigh"], [HA, "xhigh"]]);
  const w = choreRouteOf(s, "browser"); assert.deepEqual([w.model, w.effort, w.host, w.pin, w.runtimeSettings, w.fallbacks.map((f) => [f.model, f.effort, f.host, f.pin])], ["acme/alpha", "high", undefined, undefined, true, [[O120, "low", undefined, undefined]]]);
  const v = choreRouteOf(s, "sidecar_card"); assert.deepEqual([v.model, v.effort, v.fallbacks.length], [HA, "medium", 1], "an evaluated role keeps its one chosen model and gets the DeepSeek Flash fallback");
  assert.ok(s.catalog["acme/alpha"].hosts, "the validated record of a replacement model came along"); }

// merge rule: each level's own list comes back when a privacy setting skips what it forbids
{ const allowed = (k, lv) => !(k === "c" && lv !== "unrestricted") && !(k === "s" && lv === "zdr");
  const merged = mergeLevels({ unrestricted: ["c", "d", "l"], no_training: ["d", "s", "l"], zdr: ["d", "l", "h"] }, allowed);
  const at = (lv) => merged.filter((k) => allowed(k, lv));
  assert.deepEqual(at("zdr"), ["d", "l", "h"]); assert.deepEqual(at("no_training").slice(0, 3), ["d", "s", "l"]); assert.equal(at("unrestricted")[0], "c");
  assert.deepEqual(mergeLevels({ unrestricted: ["a"], no_training: ["a"], zdr: ["a"] }), ["a"]); assert.deepEqual(mergeLevels(null), []); }
// Makora is not an allowed host for xiaomi/mimo-v2.6-flash (replays: it loops on Makora, 5 of 10 runs; Io Net and Novita 0 of 16).
{ const MIMO = "xiaomi/mimo-v2.6-flash", fresh = seedFresh({}), legacy = seedFromLegacy({});
  for (const [name, cfg] of [["fresh", fresh], ["legacy", legacy]]) {
    const hosts = (cfg.catalog?.[MIMO]?.hosts) || [];
    assert.ok(!hosts.some((h) => /^makora(\/|$)/.test(h)), `${name}: no makora host in the catalog for mimo`);
    const entries = Object.values(cfg.jobs).flatMap((j) => entriesOf(j)).filter((e) => e.model === MIMO);
    assert.ok(entries.every((e) => !(e.hosts || []).some((h) => /^makora(\/|$)/.test(h))), `${name}: no makora host on a job entry for mimo`); } }
console.log("PASS migration: every job's first saved value equals what was in effect on dev and live (variables included), earlier saved settings carried exactly");
