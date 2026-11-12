// One cleaner for every tool schema that comes from outside 1Helm (a server's own inputSchema) before it is sent to a model as function parameters.
// It returns a copy and never changes the input. Calls still go to the server with the arguments exactly as the model wrote them.
// Rules, each with its reason:
//   1 pattern: dropped unless it compiles with new RegExp(p) and uses nothing a provider's regex check rejects. OpenAI and Azure answer 400
//     invalid_function_parameters "is not a 'regex'" for property escapes (\p{L}, \P{..}), lookbehind, named groups, \k backreferences and \u{..}
//     (Better Design's use_device device pattern, 2026-11-12). Dropping a pattern only loosens what the model is told; the server still validates the call.
//   2 patternProperties: the same test on each key; a key that fails is removed with its schema.
// Nothing else is changed: $schema and the other keywords are left as the existing code handles them.
const SUB_MAPS = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"];
const SUB_ONE = ["items", "additionalProperties", "additionalItems", "not", "if", "then", "else", "contains", "propertyNames", "unevaluatedProperties", "unevaluatedItems"];
const SUB_LISTS = ["anyOf", "oneOf", "allOf", "prefixItems", "items"];
const UNSAFE = /\\[pP]\{|\\[pP][A-Za-z]|\(\?<[=!]|\(\?<[A-Za-z_]|\\k<|\\u\{|\(\?[a-z]*[-:]?[imsx]+[:)]|\(\?>/;
export function safePattern(p) {
  if (typeof p !== "string" || UNSAFE.test(p)) return false;
  try { new RegExp(p); return true; } catch { return false; }
}
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
export function cleanToolSchema(schema) {
  if (Array.isArray(schema)) return schema.map(cleanToolSchema);
  if (!isObj(schema)) return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "pattern") { if (safePattern(v)) out[k] = v; continue; }
    if (SUB_MAPS.includes(k) && isObj(v)) {
      const m = {};
      for (const [name, sub] of Object.entries(v)) { if (k === "patternProperties" && !safePattern(name)) continue; m[name] = cleanToolSchema(sub); }
      out[k] = m;
    } else if (SUB_LISTS.includes(k) && Array.isArray(v)) out[k] = v.map(cleanToolSchema);
    else if (SUB_ONE.includes(k) && isObj(v)) out[k] = cleanToolSchema(v);
    else out[k] = v;   // enum, const, default, examples and every other keyword are copied as they are
  }
  return out;
}
