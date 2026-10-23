// Resident side of the Notebook pages (notebook-pages.js): saving a page edit. A page edit is a Notebook note retained as note:<id> (hindsight-writers.js), with a
// context that says it is the person's correction to that page, so every later search reads it. The pages themselves are lists of facts and need no refresh.
import { hsOn } from "./mem0.js";
import { hsWriters } from "./hs-flag.js";
import { stDelete } from "./storage.js";

const PHOTO = "nb_photo";
const jp = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export const pageMethods = {
  // RPC (added only): the person's edit of one page, or of one section of it. → { ok, note_id } | { error }
  async nbPageEdit({ page, title, sec, section = null, text, category = "" }) {
    const cid = this.get("channel_id"), body = String(text ?? ""); if (!body.trim()) return { error: "text required" };
    const row = await this.archive().noteAdd(String(cid), String(sec || "ov"), body, "human", { page: { id: String(page), title: String(title), section: section ? String(section) : "", ...(category ? { category: String(category) } : {}) } });
    if (hsOn(this.env) && hsWriters(this.env)) { try { await this.hsNoteSync(row.id); } catch (e) { console.log("page edit retain", String(e?.message || e).slice(0, 160)); } }
    return { ok: true, note_id: String(row.id) };
  },
  // The pages are lists of facts and nothing refreshes them, but a Worker or object from the last deploy can still call these while it winds down.
  async nbPageBuild() { return { skipped: "off" }; },
  async nbPagesEnsure() { return { skipped: "off" }; },
  async nbPagesBuild({ models } = {}) { return Object.fromEntries((Array.isArray(models) ? models : []).map((m) => [m.model, "empty"])); },
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
};
export const pagesMix = (Cls) => Object.assign(Cls.prototype, pageMethods);
