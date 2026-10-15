// Payload cut (r35): send less on a fresh task without removing behavior.
// Switch: env.PAYLOAD_CUT (see below). Off means every code path below returns the old payload.
//  1. An append task sends every tool from turn 0, but a tool outside the eager set is a stub: its name, the first sentence of its
//     description, and a loose parameters object. The list never changes during the task, so the cached prefix (tools, system,
//     messages) stays valid. load_tools returns the full schemas and family guidance in its result (end of the conversation).
//     A stubbed call is checked server-side against the real schema (runTool); a bad call, or the first call in a family with
//     guidance, returns the schema and guidance instead of running, so a model that skipped load_tools corrects itself.
//  2. Each step_title property keeps a short description. The full rule is stated once in the system prompt.
//  3. Guidance that only matters for one tool family (scheduling, interviews, buying, connecting apps, texting) is not in the
//     system prompt. It is returned in the load_tools result for that family, which is after the cached prefix.
// PAYLOAD_CUT: "on" turns on both parts; "title" is the short step_title text only (does not change the cached prefix rules);
// "lazy" is the eager-tools-only start with family guidance on load. Anything else is off.
const parts = (env) => { const v = String(env?.PAYLOAD_CUT || "off"); return v === "on" ? ["title", "lazy"] : v.split(","); };
export const cutTitle = (env) => parts(env).includes("title");
export const cutLazy = (env) => parts(env).includes("lazy");
// Each family: the tools whose schemas, when loaded, bring the guidance; and where the guidance lives in the rendered prompt
// (a whole file section by name, or a "###" subsection by its heading text).
export const FAMILIES = [
  { id: "scheduling", tools: ["schedule_workflow", "schedule_followup", "list_workflows", "set_workflow_status", "set_workflow_gate", "save_run_notes"], file: "09-scheduled-work" },
  { id: "interviews", tools: ["interview"], file: "11-interviews" },
  { id: "buying", tools: ["buy_with_link", "check_purchase", "browser_fill_card"], heading: "Buying things" },
  { id: "connecting", tools: ["find_app", "offer_connect"], heading: "Connecting apps" },
  { id: "texting", tools: ["text_person"], heading: "Texting the person" },
];
// Split a rendered section into { before, parts: [{ heading, text }] } on "### " lines.
function cutSubsection(text, heading) {
  const lines = text.split("\n"), start = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^#{1,3} /.test(l));
  if (end < 0) end = lines.length;
  return { rest: [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n"), cut: lines.slice(start, end).join("\n").trim() };
}
// rendered: [[name, text]] in order. Returns { sections: [[name, text]] without the family guidance, guidance: {id: text} }.
export function splitFamilies(rendered) {
  const guidance = {}; let out = rendered.map(([n, t]) => [n, t]);
  for (const f of FAMILIES) {
    if (f.file) { const i = out.findIndex(([n]) => n === f.file); if (i >= 0) { guidance[f.id] = out[i][1]; out.splice(i, 1); } continue; }
    for (const s of out) { const c = cutSubsection(s[1], f.heading); if (c) { s[1] = c.rest; guidance[f.id] = c.cut; break; } }
  }
  return { sections: out, guidance };
}
// Guidance for the families the newly loaded tools belong to. A family already delivered earlier in the task (any of its tools
// was loaded before) is skipped.
export function guidanceFor(names, previouslyLoaded, guidance) {
  const out = [];
  for (const f of FAMILIES) {
    if (!guidance[f.id] || !names.some((n) => f.tools.includes(n)) || f.tools.some((n) => previouslyLoaded.has(n))) continue;
    out.push(guidance[f.id]);
  }
  return out;
}

// Parameter skeleton: field names, types, enums and required fields, with every description dropped. The model still sees which
// fields are arrays or objects (without it, it sends them as JSON text), and extra fields stay allowed.
// Every array keeps an items schema and every object keeps its properties at any depth, because Google (Gemini) rejects an array
// without items, and a skeleton cut at a fixed depth left exactly that. Descriptions and other keywords are dropped, so it stays small.
// An array whose schema has no items gets an empty items schema; required names that are not in properties are dropped.
const skeleton = (x, depth = 0) => {
  if (!x || typeof x !== "object" || Array.isArray(x)) return x;
  const o = {};
  for (const k of ["type", "enum"]) if (x[k] !== undefined) o[k] = x[k];
  const isObj = x.type === "object" || (!x.type && x.properties);
  if (x.properties && typeof x.properties === "object") {
    o.properties = Object.fromEntries(Object.entries(x.properties).map(([k, v]) => [k, skeleton(v, depth + 1)]));
    if (Array.isArray(x.required)) { const r = x.required.filter((k) => Object.hasOwn(x.properties, k)); if (r.length) o.required = r; }
    if (!o.type && isObj) o.type = "object";
  } else if (Array.isArray(x.required) && x.required.length && !isObj) o.required = x.required;
  if (x.type === "array") o.items = x.items && typeof x.items === "object" && !Array.isArray(x.items) ? skeleton(x.items, depth + 1) : {};
  if (x.type === "object" && depth === 0) o.additionalProperties = true;
  return o;
};
// A stub keeps native function calling working (step_title is added by withStepTitles): name, first sentence, parameter skeleton.
export function stubTool(t) {
  const d = String(t.function.description || "").split(/(?<=\.)\s/)[0].slice(0, 200);
  return { ...t, function: { name: t.function.name, description: d, parameters: skeleton(t.function.parameters) || { type: "object", properties: {}, additionalProperties: true } } };
}
// A model that was not shown the field types sometimes sends an array or object as JSON text. Parse it when the real schema says
// array or object, so a correct call is not rejected for its encoding. Returns the (possibly new) arguments.
export function coerceArgs(args, schema) {
  if (!args || typeof args !== "object" || Array.isArray(args) || !schema?.properties) return args;
  const out = { ...args };
  for (const [k, sub] of Object.entries(schema.properties)) {
    if (typeof out[k] === "string" && (sub?.type === "array" || sub?.type === "object")) { try { const v = JSON.parse(out[k]); if (Array.isArray(v) === (sub.type === "array") && v && typeof v === "object") out[k] = v; } catch {} }
  }
  return out;
}
// Lenient check of a call's arguments against the real schema: required fields, basic types, enums, array item types.
// Unknown keywords are ignored, so it only rejects what is certainly wrong. Returns a list of problems.
export function checkArgs(args, schema, path = "") {
  const out = [], t = schema?.type;
  if (!schema || typeof schema !== "object") return out;
  const kind = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  if (t && !([t].flat().some((x) => x === kind(args) || (x === "integer" && Number.isInteger(args)) || (x === "number" && typeof args === "number")))) return [`${path || "arguments"} must be ${[t].flat().join(" or ")}`];
  if (schema.enum && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(args))) out.push(`${path || "arguments"} must be one of ${JSON.stringify(schema.enum)}`);
  if (t === "object" || (!t && schema.properties)) {
    if (args && typeof args === "object" && !Array.isArray(args)) {
      for (const k of schema.required || []) if (k !== "step_title" && !Object.hasOwn(args, k)) out.push(`missing required field ${path ? path + "." : ""}${k}`);
      for (const [k, sub] of Object.entries(schema.properties || {})) if (k !== "step_title" && Object.hasOwn(args, k)) out.push(...checkArgs(args[k], sub, path ? `${path}.${k}` : k));
    }
  } else if (t === "array" && Array.isArray(args) && schema.items) args.slice(0, 50).forEach((v, i) => out.push(...checkArgs(v, schema.items, `${path}[${i}]`)));
  return out.slice(0, 8);
}
