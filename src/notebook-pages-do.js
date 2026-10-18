// Resident side of the Notebook pages (notebook-pages.js): saving a page edit, and asking Hindsight to refresh the page once the edit is in.
// A page edit is a Notebook note retained as note:<id> (hindsight-writers.js), with a context that says it is the person's correction to that
// page, so every refresh of any page reads it. Hindsight refreshes a page itself after consolidation, but its minimum refresh interval (1,800
// seconds) can park that refresh for up to an hour. So after an edit the Resident waits until Hindsight has finished the retain and the
// consolidation, then asks for one refresh of that page (POST refresh, which ignores the interval). The job is saved in kv before it waits and
// the alarm carries it on after a deploy (the same pattern as the outbox and the rebuild).
import { hsOn, freshStats, pendingWork, refreshMentalModel } from "./hindsight.js";
import { hsFoundations } from "./hindsight-template.js";
import { hsWriters } from "./hs-flag.js";
import { METER } from "./byok-meter.js";
import { stDelete } from "./storage.js";

const PHOTO = "nb_photo", KEY = "hs_pr", ASKED = "hs_pr_asked", POLL_MS = 20e3, GIVE_UP_MS = 30 * 60e3, TRIES_MAX = 4;
// A page that has never been built is refreshed on request at most once per this many ms (the app's own limit on the explicit refresh the Notebook asks for, not a Hindsight setting).
export const ASK_EVERY_MS = 1800e3;
const jp = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export const pageMethods = {
  hsPageJob() { return jp(this.get(KEY)); },
  // The alarm wants to wake again when a page refresh is waiting.
  hsPageNext() { if (!hsWriters(this.env)) return null; const j = this.hsPageJob(); return j?.models?.length ? Math.max(Number(j.due) || 0, Date.now() + 500) : null; },
  // RPC (added only): the person's edit of one page, or of one section of it. → { ok, note_id } | { error }
  async nbPageEdit({ page, title, model, sec, section = null, text }) {
    const cid = this.get("channel_id"), body = String(text ?? ""); if (!body.trim()) return { error: "text required" };
    const row = await this.archive().noteAdd(String(cid), String(sec || "ov"), body, "human", { page: { id: String(page), title: String(title), section: section ? String(section) : "", model: String(model) } });
    if (hsOn(this.env) && hsWriters(this.env)) {
      try { await this.hsNoteSync(row.id); } catch (e) { console.log("page edit retain", String(e?.message || e).slice(0, 160)); }
      await this.hsPageQueue(model);
    }
    return { ok: true, note_id: String(row.id) };
  },
  // Saves one waiting refresh of a page's model in kv and arms the alarm (shared by an edit and by a page that was never built).
  async hsPageQueue(model) {
    const j = this.hsPageJob() || { models: [], at: Date.now(), tries: 0 };
    if (!j.models.includes(model)) j.models.push(model);
    j.due = Date.now() + POLL_MS; this.put(KEY, JSON.stringify(j)); await this.arm();
  },
  // RPC (added only): a page that opened empty. Each model's first refresh can run while the bank was still empty (Hindsight skips it with
  // "no sources in scope"), and the min refresh interval then parks every later automatic refresh. So when the bank now holds documents, ask for
  // one refresh through the same waiting job an edit uses (POST refresh ignores the interval), at most once per model per ASK_EVERY_MS.
  // The request time is saved before the request, so repeated opens do not repeat it. → { requested: true } | { skipped: why }
  async nbPageBuild({ model }) {
    if (!model || !hsOn(this.env) || !hsWriters(this.env)) return { skipped: "off" };
    const asked = jp(this.get(ASKED)) || {}, now = Date.now(); if (now - (Number(asked[model]) || 0) < ASK_EVERY_MS) return { skipped: "recently asked" };
    let docs = 0; try { docs = Number((await freshStats(this.env, this.hsBankId()))?.total_documents) || 0; } catch (e) { console.log("page build stats", String(e?.message || e).slice(0, 120)); return { skipped: "no stats" }; }
    if (!docs) return { skipped: "bank empty" };
    asked[model] = now; this.put(ASKED, JSON.stringify(asked));
    await this.hsPageQueue(model); return { requested: true };
  },
  // RPC (added only): the bank has its current template, so every page's model exists. A bank last imported before a template version that added
  // models (e.g. p10 added people and places) has no such model until some saved turn runs hsBank, so a page on such a bank stayed blank. The route
  // calls this on a real open when a page's model is missing. Importing creates the missing models, and Hindsight queues their first refresh.
  async nbPagesEnsure() {
    if (!hsOn(this.env) || !hsFoundations(this.env)) return { skipped: "off" };
    try { await this.hsBank(); return { ok: true }; } catch (e) { console.log("pages ensure", String(e?.message || e).slice(0, 120)); return { skipped: "failed" }; }
  },
  // RPC (added only): the state of every page that has no text yet, with one bank read for all of them. models: [{ model, refreshed }] where refreshed says
  // Hindsight has already refreshed it once. build true (a real open) requests the refresh nbPageBuild would, once per model per ASK_EVERY_MS.
  // → { "<model>": "building" | "empty" }. "building": a refresh is requested or waiting, or Hindsight's first refresh has not run. "empty": nothing to build from.
  async nbPagesBuild({ models, build = false }) {
    const out = {}, list = (Array.isArray(models) ? models : []).filter((m) => m?.model); if (!list.length) return out;
    const on = hsOn(this.env) && hsWriters(this.env), asked = jp(this.get(ASKED)) || {}, job = this.hsPageJob(), now = Date.now();
    let docs = null; try { docs = Number((await freshStats(this.env, this.hsBankId()))?.total_documents) || 0; } catch (e) { console.log("pages stats", String(e?.message || e).slice(0, 120)); }
    for (const { model, refreshed } of list) {
      if (docs === 0) { out[model] = "empty"; continue; }
      const recent = now - (Number(asked[model]) || 0) < ASK_EVERY_MS;
      if (build && on && docs != null && !recent) { asked[model] = now; this.put(ASKED, JSON.stringify(asked)); await this.hsPageQueue(model); out[model] = "building"; continue; }
      out[model] = recent || job?.models?.includes(model) || !refreshed ? "building" : "empty";
    }
    return out;
  },
  // ---- The person's own photo (the Notebook page's Edit mode). The original bytes are a Library file in General (R2, exactly as uploaded, no resizing,
  // so the file rules apply: it is the person's file, and it is kept until they replace or delete it). General's Resident keeps which file is the photo
  // (kv nb_photo), because the photo belongs to the account and General's About page. The Contacts card photo (people_photos, a small thumbnail) is only the fallback.
  // RPCs, added only. nbPhotoGet → { id, at, mime, sha, r2key, name } | null
  async nbPhotoGet() {
    const j = jp(this.get(PHOTO)); if (!j?.id) return null;
    const row = await this.fileRow(j.id); return row ? { id: row.id, at: Number(j.at) || Number(row.at) || 0, mime: row.mime, sha: j.sha || "", r2key: row.r2key, name: row.name } : null;
  },
  // f is the stored upload ({ id, name, mime, bytes, r2key }, from storeUpload) and sha its SHA-256. The same bytes again change nothing (the new copy is dropped, so no
  // duplicate); a different photo replaces the old one (the old file is deleted).
  async nbPhotoSet({ tenant, channel, channelId, f, sha }) {
    const cur = await this.nbPhotoGet();
    if (cur && cur.sha && cur.sha === sha) { await stDelete(this.env, [{ key: f.r2key, size: f.bytes }]).catch(() => {}); return { ok: true, same: true, at: cur.at, id: cur.id }; }
    const v = await this.addUpload(tenant, channel, channelId, f), at = Date.now();
    this.put(PHOTO, JSON.stringify({ id: v.id, sha, at }));
    if (cur) await this.deleteFile(cur.id);
    return { ok: true, at, id: v.id };
  },
  async nbPhotoClear() {
    const cur = await this.nbPhotoGet(); this.put(PHOTO, ""); if (cur) await this.deleteFile(cur.id);
    return { ok: true, removed: !!cur };
  },
  async hsPageAlarm() {
    const j = this.hsPageJob(); if (!j?.models?.length || Date.now() < (Number(j.due) || 0)) return null;
    const bank = this.hsBankId(), old = Date.now() - (Number(j.at) || 0) > GIVE_UP_MS;
    let ready = false;
    try { const [w, st] = await Promise.all([pendingWork(this.env, bank), freshStats(this.env, bank)]); ready = w.work === 0 && !(Number(st?.pending_consolidation) > 0); }
    catch (e) { console.log("page refresh wait", String(e?.message || e).slice(0, 120)); }
    if (!ready && !old) { j.due = Date.now() + POLL_MS; this.put(KEY, JSON.stringify(j)); return { waiting: true }; }
    const left = [];
    for (const id of j.models) {
      const h = await this.byokHold("hs-refresh", METER.hs_refresh_run); if (!h) continue;   // no credits: the page still refreshes by itself after consolidation
      try { await refreshMentalModel(this.env, bank, id); await h.done(); } catch (e) { await h.done(0); left.push(id); console.log("page refresh", id, String(e?.message || e).slice(0, 120)); }
    }
    j.tries = (j.tries || 0) + 1;
    if (left.length && j.tries < TRIES_MAX) { j.models = left; j.due = Date.now() + 60e3; this.put(KEY, JSON.stringify(j)); } else this.put(KEY, "");
    return { refreshed: j.models.length - left.length, left: left.length };
  },
};
export const pagesMix = (Cls) => Object.assign(Cls.prototype, pageMethods);
