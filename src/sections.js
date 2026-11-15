// Custom sections for a channel's task list (the side panel). Per channel, stored in that channel's Resident:
//   table session_sections (id, title, color, position), column sessions.section (null = Uncategorized), and kv "sections_on" ("1" = the person switched custom sections on).
// Nothing here puts a task in a section by itself: a task is in a section only when the person moved it, and every other task is Uncategorized.
// Turning the mode off keeps the sections and the assignments, so turning it on again brings them back.
export const SECTION_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"];
export const MAX_SECTIONS = 30;
export const UNCATEGORIZED = "Uncategorized";

export function sectionsInit(sql) {
  sql.exec("CREATE TABLE IF NOT EXISTS session_sections (id TEXT PRIMARY KEY, title TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0)");
  try { sql.exec("ALTER TABLE sessions ADD COLUMN section TEXT"); } catch {}
}

// Order inside every section: open tasks first, newest activity first, then closed tasks, newest activity first. "updated" is the activity time
// (a rename does not change it), so this is activity order and never creation order. Ties keep a stable order by id.
export function orderTasks(rows) {
  const act = (x) => Number(x.updated) || 0;
  return [...rows].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || act(b) - act(a) || String(a.id).localeCompare(String(b.id)));
}

const cleanTitle = (t) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s && s.length <= 60 && !/[\r\n]/.test(String(t)) ? s : null; };

export function sectionsState(R) {
  const sections = R.sql.exec("SELECT id, title, color, position FROM session_sections ORDER BY position, rowid").toArray().map((x) => ({ id: x.id, title: x.title, color: x.color, position: Number(x.position) }));
  return { on: R.getRaw("sections_on") === "1", sections, colors: SECTION_COLORS };
}

export function sectionExists(R, id) { return !!R.sql.exec("SELECT 1 FROM session_sections WHERE id=?", String(id)).toArray().length; }

// One call for every change: { action: "enable" | "disable" | "create" | "update" | "delete" | "reorder", ... }.
export function sectionsAction(R, b = {}) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { error: "Invalid sections request.", status: 400 };
  const bad = (error) => ({ error, status: 400 });
  const on = R.getRaw("sections_on") === "1";
  switch (b.action) {
    case "enable": R.put("sections_on", "1"); break;
    case "disable": R.put("sections_on", "0"); break;
    case "create": {
      if (!on) return bad("Switch to Custom sections first.");
      const title = cleanTitle(b.title); if (!title) return bad("Use a section name of 1 to 60 characters on one line.");
      if (title.toLowerCase() === UNCATEGORIZED.toLowerCase()) return bad("Uncategorized is already there.");
      const n = R.sql.exec("SELECT COUNT(*) n FROM session_sections").one().n; if (n >= MAX_SECTIONS) return bad(`A channel can have up to ${MAX_SECTIONS} sections.`);
      const color = b.color == null ? SECTION_COLORS[n % SECTION_COLORS.length] : String(b.color); if (!SECTION_COLORS.includes(color)) return bad("Unknown color.");
      const pos = Number(R.sql.exec("SELECT COALESCE(MAX(position),0) m FROM session_sections").one().m) + 1;
      R.sql.exec("INSERT INTO session_sections (id,title,color,position) VALUES (?,?,?,?)", crypto.randomUUID(), title, color, pos);
      break;
    }
    case "update": {
      if (!sectionExists(R, b.id)) return { error: "No such section.", status: 404 };
      if (Object.prototype.hasOwnProperty.call(b, "title")) {
        const title = cleanTitle(b.title); if (!title) return bad("Use a section name of 1 to 60 characters on one line.");
        if (title.toLowerCase() === UNCATEGORIZED.toLowerCase()) return bad("Uncategorized is already there.");
        R.sql.exec("UPDATE session_sections SET title=? WHERE id=?", title, String(b.id));
      }
      if (Object.prototype.hasOwnProperty.call(b, "color")) { if (!SECTION_COLORS.includes(String(b.color))) return bad("Unknown color."); R.sql.exec("UPDATE session_sections SET color=? WHERE id=?", String(b.color), String(b.id)); }
      break;
    }
    case "delete": {
      if (!sectionExists(R, b.id)) return { error: "No such section.", status: 404 };
      R.sql.exec("UPDATE sessions SET section=NULL WHERE section=?", String(b.id));   // its tasks go to Uncategorized
      R.sql.exec("DELETE FROM session_sections WHERE id=?", String(b.id));
      break;
    }
    case "reorder": {
      if (!Array.isArray(b.ids)) return bad("Send the section ids in the new order.");
      const have = R.sql.exec("SELECT id FROM session_sections ORDER BY position, rowid").toArray().map((x) => x.id);
      const want = [...new Set(b.ids.map(String).filter((id) => have.includes(id)))];
      [...want, ...have.filter((id) => !want.includes(id))].forEach((id, i) => R.sql.exec("UPDATE session_sections SET position=? WHERE id=?", i + 1, id));
      break;
    }
    default: return bad("Unknown sections action.");
  }
  return sectionsState(R);
}
