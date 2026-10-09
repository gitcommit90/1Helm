// What the helper sees of a Composio action's inputs (10-06, composio-upgrade stage 2), and how its plain-words `want` is cleaned
// before it goes to Composio's search. Used by both backends of the Composio transport (composio-transport.js) and by composio.js.
//
// slimInputs(schema): one compact line per input, * = required. Objects and arrays of objects show their fields one or two levels deep
// (required first), so an action like GOOGLECALENDAR_BATCH_EVENTS shows "operations*: array of {op_id*: string, method*: …,
// calendar_id*: string, body: object, …}" instead of the bare "operations: array" that hid what it needs (a real dev task, 10-06:
// the helper couldn't add a 10-minute reminder because it never saw the nested fields).
// exampleOf(schema): a short example input built from the schema's own examples / defaults, only when every required input has one
// and at least one of them is a list or object.
// File inputs (stage 4): an input that is Composio's FileUploadable ({name, mimetype, s3key}, flagged file_uploadable), alone or as a list,
// shows as one plain line (FILE_HINT): the helper passes a Library file name or a /workspace path and 1Helm stages the file
// (composio-files.js). fileInputs(schema) names them for app_run.
// cleanWant(want): the search query without personal data (Composio may cache search queries): emails, links, @handles, quoted text,
// times, dates, phone numbers, ids, other numbers and capitalised names go; the kind of task stays.

// ---- file inputs (FileUploadable) ----
export const FILE_HINT = "file: give a Library file name or a /workspace path";
const FILE_LIST_HINT = "file or list of files: give Library file names or /workspace paths";
const isUploadable = (v) => !!v && typeof v === "object" && (v.file_uploadable === true || v.title === "FileUploadable" || !!(v.properties?.s3key && v.properties?.mimetype && v.properties?.name));
// → "one" (a single file), "many" (a list), "either" (a single file or a list, like Gmail's attachment), or "" (not a file input).
export function fileKind(v) {
  if (!v || typeof v !== "object") return "";
  if (isUploadable(v)) return "one";
  if (v.items && isUploadable(Array.isArray(v.items) ? v.items[0] : v.items)) return "many";
  const alt = (v.anyOf || v.oneOf || []).filter((x) => x && x.type !== "null");
  if (alt.length) { const ks = new Set(alt.map(fileKind)); ks.delete(""); if (!ks.size) return ""; return ks.size === 1 ? [...ks][0] : "either"; }
  return "";
}
// { input name: kind } for an action's top-level file inputs.
export function fileInputs(p) {
  const out = {}; for (const [k, v] of Object.entries(p?.properties || {})) { const f = fileKind(v); if (f) out[k] = f; }
  return out;
}

const MAX_FIELDS = 25, DESC = 160, NESTED_DESC = 100, FIELD_MAX = 420;
const typeName = (v = {}) => {
  if (Array.isArray(v.type)) return v.type.filter((t) => t !== "null").join("|");
  if (v.type) return v.type;
  const alt = v.anyOf || v.oneOf; if (Array.isArray(alt)) return [...new Set(alt.map((x) => x?.type).filter((t) => t && t !== "null"))].join("|");
  return "";
};
// The object an input really is (a nullable anyOf [{object}, {null}] counts as that object).
const unwrap = (v = {}) => {
  if (v.properties || v.items || v.enum) return v;
  const alt = (v.anyOf || v.oneOf || []).filter((x) => x && x.type !== "null");
  return alt.length === 1 ? { ...alt[0], description: v.description || alt[0].description } : v;
};
function brief(v0, depth) {
  const fk = fileKind(v0); if (fk) return fk === "one" ? FILE_HINT : FILE_LIST_HINT;
  const v = unwrap(v0), t = typeName(v);
  if (v.enum) return `${t || "string"} one of ${v.enum.slice(0, 12).join("|")}`;
  if (v.properties && depth < 2) return `object {${fields(v, depth + 1)}}`;
  if ((t === "array" || v.items) && v.items) {
    const it = unwrap(v.items);
    if (it.properties && depth < 2) return `array of {${fields(it, depth + 1)}}${v.maxItems ? ` (max ${v.maxItems})` : ""}`;
    if (it.enum) return `array of ${it.enum.slice(0, 8).join("|")}`;
    return `array of ${typeName(it) || "any"}`;
  }
  return t || "any";
}
function fields(o, depth) {
  const props = o.properties || {}, req = new Set(o.required || []), keys = Object.keys(props);
  const need = keys.filter((k) => req.has(k)), opt = keys.filter((k) => !req.has(k));
  const shown = keys.length <= 6 ? opt : opt.slice(0, Math.max(0, 4 - need.length));
  const parts = [...need.map((k) => `${k}*: ${brief(props[k], depth)}`), ...shown.map((k) => `${k}: ${brief(props[k], depth)}`)];
  if (shown.length < opt.length) parts.push("…");
  return parts.join(", ");
}
export function slimInputs(p) {
  const props = p?.properties || {}, req = new Set(p?.required || []);
  // Required inputs first, so a long schema never cuts one off.
  const keys = [...Object.keys(props).filter((k) => req.has(k)), ...Object.keys(props).filter((k) => !req.has(k))].slice(0, MAX_FIELDS);
  return Object.fromEntries(keys.map((k) => {
    const v = props[k] || {}, b = brief(v, 0), nested = b.includes("{");
    let d = v.description || unwrap(v).description;
    // A file input's own description talks about mimetype / s3key, which 1Helm fills in: its first sentence only.
    if (d && fileKind(v)) d = String(d).replace(/\s+/g, " ").split(/(?<=[.!?])\s/)[0];
    const line = `${b}${d ? ": " + String(d).replace(/\s+/g, " ").slice(0, nested ? NESTED_DESC : DESC) : ""}`;
    return [k + (req.has(k) ? "*" : ""), line.length > FIELD_MAX ? line.slice(0, FIELD_MAX - 1) + "…" : line];
  }));
}

// ---- a short example input ----
const EX_MAX = 400;
function ex(v0, depth, withOptional) {
  if (fileKind(v0)) return "report.pdf";   // a file input: a Library file name (1Helm stages it)
  const v = unwrap(v0);
  if (Array.isArray(v.examples) && v.examples.length && v.examples[0] !== null) return v.examples[0];
  if (v.default !== undefined && v.default !== null && !(typeof v.default === "object" && !Object.keys(v.default).length)) return v.default;
  if (v.enum?.length) return v.enum[0];
  if (depth > 3) return undefined;
  if (v.properties) {
    const o = {}, req = v.required || [];
    for (const k of req) { const x = ex(v.properties[k], depth + 1, withOptional); if (x === undefined) return undefined; o[k] = x; }
    // Inside a list item, an object-valued input with its own example (a request body) shows how the item is filled in.
    if (withOptional && depth >= 1) for (const [k, p] of Object.entries(v.properties)) if (!(k in o) && unwrap(p).type === "object" && Array.isArray(p.examples) && p.examples[0] && typeof p.examples[0] === "object") o[k] = p.examples[0];
    return Object.keys(o).length ? o : undefined;
  }
  if (v.items) { const it = ex(v.items, depth + 1, withOptional); return it === undefined ? undefined : [it]; }
  return undefined;
}
// Only for inputs with structure (a required list or object): a flat input list is already clear, and a flat example is mostly
// placeholder ids the helper might copy.
export function exampleOf(p) {
  const req = p?.required || [];
  if (!p?.properties || !req.length) return undefined;
  if (!req.some((k) => { if (fileKind(p.properties[k])) return false; const v = unwrap(p.properties[k] || {}); return v.properties || v.items || typeName(v) === "object" || typeName(v) === "array"; })) return undefined;
  for (const withOptional of [true, false]) {
    const o = {};
    let okAll = true;
    for (const k of req) { const x = ex(p.properties[k], 0, withOptional); if (x === undefined) { okAll = false; break; } o[k] = x; }
    if (!okAll) return undefined;
    if (JSON.stringify(o).length <= EX_MAX) return o;
  }
  return undefined;
}

// ---- the search query, without personal data ----
const KEEP = new Set(("google gmail calendar drive docs doc sheets sheet slides slack notion github linear jira outlook microsoft teams zoom dropbox " +
  "hubspot salesforce trello asana airtable shopify stripe twitter linkedin youtube reddit discord figma canva whatsapp icloud apple excel word " +
  "powerpoint onedrive sharepoint meet maps photos tasks contacts hacker news monday clickup todoist evernote confluence bitbucket gitlab intercom " +
  "zendesk mailchimp quickbooks xero gemini openai perplexity spotify instagram facebook telegram calendly typeform docusign box wix wordpress " +
  "i ok ai api url id pdf csv json html pr prs issue issues").split(" "));
const VERBS = new Set(("create find list add send get search read update delete remove post make set schedule move copy share upload download check " +
  "show fetch reply draft open close star label archive invite rename write edit change look count summarize mark book cancel turn start stop " +
  "the a an my all new one any some each every this that what which how when where who is are can do does please").split(" "));
const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
export function cleanWant(s, keepWords = []) {
  const keep = new Set([...KEEP, ...keepWords.flatMap((w) => String(w || "").toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean)]);
  let t = String(s || "").replace(/[\u0000-\u001f]+/g, " ");
  t = t.replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, " a link ")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " an email address ")
    .replace(/(^|[\s(])@[\w.-]+/g, "$1someone ")
    .replace(/(^|[\s(])#[\w-]*[a-z][\w-]*/gi, "$1a channel ")
    .replace(/(^|\s)#\d+\b/g, "$1a number ")
    .replace(/"[^"]{1,300}"|“[^”]{1,300}”|‘[^’]{1,300}’|(?<![a-z])'[^']{2,300}'(?![a-z])/gi, " some text ")
    .replace(new RegExp(`\\b(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH})\\b(?:,?\\s*\\d{4})?`, "gi"), " a date ")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " a date ")
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)(?![a-z])|\b\d{1,2}:\d{2}(?::\d{2})?\b/gi, " a time ")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, " a number ")
    .replace(/(^|\s)[\w.-]+(?:\/[\w.-]+)+(?=\s|$|[,;:])/g, "$1a path ")
    .replace(/\b(\d+)[- ]?(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b/gi, "N-$2")
    .replace(/\b(?=[A-Za-z_-]*\d)(?=[\w-]*[A-Za-z])[\w-]{5,}\b/g, (m) => (/^N-[a-z]+$/i.test(m) ? m : " an id "))
    .replace(/\d+(?:[.,]\d+)?/g, "N");
  // Capitalised words are names (people, companies, titles) unless they're an app's name, an acronym, or the first word of a sentence
  // that's an ordinary verb ("Create …").
  let start = true;
  t = t.split(/(\s+)/).map((w) => {
    if (/^\s+$/.test(w) || !w) return w;
    const bare = w.replace(/^[^\w]+|[^\w]+$/g, ""), low = bare.toLowerCase(), first = start;
    start = /[.!?]$/.test(w);
    if (!/^[A-Z]/.test(bare) || /^N(-[a-z]+)?$/.test(bare) || keep.has(low) || /^[A-Z]{2,5}s?$/.test(bare) || (first && VERBS.has(low))) return w;
    return w.replace(bare, "a name");
  }).join("");
  t = t.replace(/\b(a name)(?:\s+a name)+\b/g, "$1").replace(/'s\b/g, "").replace(/\s+/g, " ").trim();
  return t.slice(0, 300);
}
