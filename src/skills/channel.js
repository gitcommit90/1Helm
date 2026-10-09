// This channel's own skills (skill-creator, B4): procedures the person asked the helper to save, stored in the channel (the
// Resident's SQLite, table channel_skills) and listed like the built-ins: read_skill reads them (index.js `extra`), the per-channel
// prompt block lists them (never the static core, which stays byte-identical across tenants). A built-in slug always wins, so
// save_skill refuses one. Only the person's explicit ask creates, changes or deletes one (never on the helper's own initiative:
// there is no background skill-review job). Deleting a channel deletes its skills with the rest of its storage.
import { SLUG_RE, SKILL_SLUGS, skillProblems } from "./index.js";

export const CHANNEL_SKILLS_MAX = 30, BODY_MAX = 12000, SLUG_MAX = 40;
const SECRET = /\b(password|passcode|pin code|security code|verification code|one[- ]time code|ssn|social security|card number|cvv|routing number|account number|api key|secret key)\b[^\n]{0,20}?[:=]?\s*\S*\d{3,}|\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){13,19}\b|\bsk-[A-Za-z0-9_-]{16,}/i;

export function channelSkillsInit(sql) { sql.exec("CREATE TABLE IF NOT EXISTS channel_skills (slug TEXT PRIMARY KEY, description TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, session TEXT)"); }
// → the loader's shape ({ slug, description, always, body, refs, scripts }), oldest first, plus when it changed.
export function listChannelSkills(sql) {
  try { return sql.exec("SELECT slug, description, body, created, updated FROM channel_skills ORDER BY created").toArray().map((r) => ({ slug: r.slug, description: r.description, always: false, body: r.body, refs: {}, scripts: [], created: r.created, updated: r.updated, own: true })); }
  catch { return []; }
}
// The per-channel prompt line (empty when the channel has none).
export function channelSkillsLine(list = []) {
  return list.length ? `This channel's own skills (procedures the person asked you to save; read one with read_skill before doing that task, like the built-in ones):\n${list.map((s) => `- ${s.slug}: ${s.description}`).join("\n")}` : "";
}

export const SAVE_SKILL_TOOL = { type: "function", function: { name: "save_skill",
  description: "Save, update or delete one of this channel's own skills: a procedure the person explicitly asked you to keep (\"save this as a skill\", \"remember how to do this\"). Read the skill-creator skill first. It's listed with your other skills from the next message and read_skill reads it at once. Never save one they didn't ask for. delete: true removes it.",
  parameters: { type: "object", properties: {
    slug: { type: "string", description: "Short name: lowercase words joined by hyphens, e.g. weekly-sales-report" },
    description: { type: "string", description: "One line starting with \"Use when\": exactly when this skill applies" },
    body: { type: "string", description: "The skill in Markdown, starting with a # title: the steps, the rules, what to hand over" },
    delete: { type: "boolean", description: "true to delete this skill (slug only)" } }, required: ["slug"] } } };

const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
export function saveSkill(sql, a = {}, ctx = {}) {
  channelSkillsInit(sql);
  const slug = one(a.slug).toLowerCase().replace(/[\s_]+/g, "-");
  if (!slug || !SLUG_RE.test(slug) || slug.length > SLUG_MAX) return `error: slug must be lowercase words joined by hyphens (up to ${SLUG_MAX} characters), e.g. weekly-sales-report`;
  const ex = sql.exec("SELECT slug FROM channel_skills WHERE slug=?", slug).toArray()[0];
  if (a.delete) {
    if (!ex) return `There's no channel skill called "${slug}"${SKILL_SLUGS.includes(slug) ? " (that's a built-in skill, which can't be deleted)" : ""}.`;
    sql.exec("DELETE FROM channel_skills WHERE slug=?", slug);
    return `Deleted this channel's skill "${slug}". It's gone from your skills list from the next message.`;
  }
  if (SKILL_SLUGS.includes(slug)) return `error: "${slug}" is a built-in skill's name. Pick another name for this channel's skill.`;
  const description = one(a.description), body = String(a.body ?? "").replace(/\r/g, "").replace(/\\n/g, "\n").trim();
  const p = skillProblems(slug, { name: slug, description, always: false }).filter((x) => !/^name /.test(x));
  if (p.length) return `error: ${p.join("; ")}`;
  if (!/^# \S/.test(body)) return "error: body must be Markdown starting with a # title line";
  if (body.length > BODY_MAX) return `error: body is ${body.length} characters; keep it under ${BODY_MAX} (move detail out, keep the steps and rules)`;
  if (/\{\{|\}\}/.test(body + description)) return "error: skills can't contain {{ or }}; write the example another way";
  if (SECRET.test(body) || SECRET.test(description)) return "error: it looks like it contains a password, code, card or account number or key. Leave secrets out: saved keys and logins are kept separately (Passwords & keys), and the skill can say which one to use by name.";
  if (!ex && sql.exec("SELECT COUNT(*) n FROM channel_skills").one().n >= CHANNEL_SKILLS_MAX) return `error: this channel already has ${CHANNEL_SKILLS_MAX} skills. Delete or merge one first.`;
  const now = Date.now();
  if (ex) sql.exec("UPDATE channel_skills SET description=?, body=?, updated=?, session=? WHERE slug=?", description, body, now, ctx.session || null, slug);
  else sql.exec("INSERT INTO channel_skills (slug, description, body, created, updated, session) VALUES (?,?,?,?,?,?)", slug, description, body, now, now, ctx.session || null);
  return `${ex ? "Updated" : "Saved"} this channel's skill "${slug}". read_skill reads it now, and it's in your skills list from the next message. Only this channel has it.`;
}
