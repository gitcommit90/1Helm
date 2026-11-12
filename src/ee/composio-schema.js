// What 1Helm reads from a Composio action's input schema, and how the helper's plain-words `want` is cleaned before it goes to Composio's
// search. Used by both backends of the Composio transport (composio-transport.js) and by composio.js.
//
// The helper gets the action's FULL input schema exactly as Composio returns it (app_action_schema in composio.js); nothing here shortens,
// reorders or rewrites it (the old one-line-per-input summary, its 25-field cap, 160-character description cut, two-level nesting and
// invented example were removed 2026-11-07). This file only reads the schema for three things 1Helm itself must do:
// File inputs (stage 4): an input that is Composio's FileUploadable ({name, mimetype, s3key}, flagged file_uploadable), alone or as a list.
// The helper cannot hold bytes, so it passes a Library file name or a /workspace path and 1Helm stages the file (composio-files.js).
// fileInputs(schema) names them for app_run; fileNotes() tells the helper which inputs work that way.
// URL inputs: inputs described as a URL, where {"file_url": file} becomes a temporary link (app-file-links.js).
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

// ---- required inputs that are present (a required input may be null when its schema allows null, or "" when it allows a string) ----
const branches = (v) => [...(v?.anyOf || []), ...(v?.oneOf || [])];
const typesOf = (v) => (Array.isArray(v?.type) ? v.type : v?.type ? [v.type] : []);
export function allowsNull(v) {
  if (!v || typeof v !== "object") return false;
  if (typesOf(v).includes("null") || v.nullable === true || (Array.isArray(v.enum) && v.enum.includes(null)) || v.const === null) return true;
  return branches(v).some(allowsNull);
}
export function allowsString(v) {
  if (!v || typeof v !== "object") return false;
  const t = typesOf(v), alt = branches(v);
  if (t.includes("string")) return true;
  if (alt.length) return alt.some(allowsString);
  return !t.length && !v.items && !v.properties;   // no type given: anything goes, a string included
}
// The required inputs a call leaves unfilled: omitted, null where the schema doesn't allow null, "" where it doesn't allow a string.
export function lackingInputs(schema, args) {
  const props = schema?.properties || {};
  return (Array.isArray(schema?.required) ? schema.required.filter((k) => typeof k === "string") : []).filter((k) => {
    const v = args?.[k], p = props[k];
    if (v === undefined) return true;
    if (v === null) return !allowsNull(p);
    if (v === "") return !(p ? allowsString(p) : false);
    return false;
  });
}

// ---- which inputs of an action want a URL (app-file-links.js hands a temporary link to one of the person's files to these) ----
// Top-level inputs that are a string or a list of strings and are described as a URL: format uri / url, a name like url / image_url / file_link,
// or a description that says URL. → a list of input names.
const NAMEY = /(^|_)(url|uri|link)s?($|_)|(url|uri)s?$/i, DESCY = /\b(url|uri|urls|publicly accessible link|public link)\b/i;
const isStr = (v = {}) => { const t = Array.isArray(v.type) ? v.type.filter((x) => x !== "null") : [v.type]; return t.length === 1 && t[0] === "string" || (!v.type && !v.items && !v.properties); };
export function urlInputs(schema) {
  const out = [];
  for (const [k, v0] of Object.entries(schema?.properties || {})) {
    const alt = (v0?.anyOf || v0?.oneOf || []).filter((x) => x && x.type !== "null"), v = alt.length === 1 ? { ...alt[0], description: v0.description || alt[0].description } : v0 || {};
    const item = v.items && !Array.isArray(v.items) ? v.items : null, base = item || v;
    if (item ? !isStr(item) : !isStr(v)) continue;
    if (v.properties || base.properties || v.enum || base.enum) continue;
    if (/^(uri|url|iri)$/i.test(base.format || "") || NAMEY.test(k) || DESCY.test(String(v0?.description || "")) ) out.push(k);
  }
  return out;
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

// The notes that go beside an action's exact schema (the schema itself is never edited): which inputs are files 1Helm attaches, which take a URL.
export function inputNotes(schema) {
  const files = fileInputs(schema), urls = urlInputs(schema), out = {};
  const fk = Object.entries(files);
  if (fk.length) out.file_inputs = Object.fromEntries(fk.map(([k, kind]) => [k, kind === "one" ? FILE_HINT : FILE_LIST_HINT]));
  if (urls.length) out.url_inputs = { inputs: urls, hint: "to give one of the person's own files to an input like this, pass {\"file_url\": \"<Library file name or /workspace path>\"} as its value and 1Helm makes a temporary read-only link" };
  return out;
}
