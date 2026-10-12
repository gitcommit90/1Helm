// Wire contracts for bounded background jobs. Empty arrays are valid no-change results.
// These contracts constrain shape; the callers still enforce evidence, privacy and ownership.
const str = { type: "string" };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items, maxItems) => ({ type: "array", items, ...(maxItems == null ? {} : { maxItems }) });
const values = (...enumValues) => ({ type: "string", enum: enumValues });
const nullableString = { anyOf: [str, { type: "null" }] };
const status = values("changes", "no_change"), checked = str;
export const MEMORY_VERIFY_SCHEMA = obj({ results: arr(obj({ id: str, refute: values("pass", "fail", "hold"), evidence_grounded: values("pass", "fail", "hold"), reason: str })) });
export const MEMORY_SCHEMAS = {
  upkeep: obj({ status, checked, claims: arr(obj({ kind: values("fact", "preference", "correction"), text: str, quote: str, turn: str, replaces: str }), 12) }),
  people: obj({ status, checked, people: arr(obj({ contact_id: nullableString, name: str, relation: str, relation_quote: str, relation_turn: str, aliases: arr(str), facts: arr(obj({ section: values("facts", "history", "relationship", "in_common", "open_threads"), text: str, quote: str, turn: str, replaces_fact_id: str })) }), 12) }),
  reflect: obj({ status, checked, claims: arr(obj({ text: { type: "string", maxLength: 220 }, quotes: { ...arr(obj({ turn: str, quote: str }), 3), minItems: 1 } }), 10) }),
};
export function memorySchema(job, step) {
  const schema = step === "verify" ? MEMORY_VERIFY_SCHEMA : MEMORY_SCHEMAS[job];
  if (!schema) throw new Error("Unknown memory job schema");
  return schema;
}
export const AMBIENT_EXTRACT_SCHEMA = obj({ items: arr(obj({
  kind: values("task", "reminder", "idea", "fact", "preference", "decision"),
  speech_act: values("intention", "tentative_intention", "memory", "example", "quotation", "uncertain"),
  quote: str, line: { type: "integer", minimum: 0 }, status: values("open", "completed", "cancelled"), due_text: str,
  relation: { anyOf: [values("repeat", "correction", "completion", "cancellation", "reopen"), { type: "null" }] }, supersedes: arr(str),
}), 30) });
export const AMBIENT_REVIEW_SCHEMA = obj({ items: arr(obj({ id: str, verdict: values("retain", "uncertain", "drop"),
  reason: values("direct_personal_intent", "explicit_personal_update", "independent_personal_need", "ambiguous_speech_act", "tentative_or_fragmentary", "insufficient_context", "example_or_quotation", "background_media"),
  context: { ...arr(str, 8), minItems: 1 },
}), 60) });
const sec = values("decisions", "actions", "questions", "notes");
export const NOTE_PATCH_SCHEMA = obj({ ops: arr({ anyOf: [
  obj({ op: values("summary"), text: str }),
  obj({ op: values("add"), sec, text: str, owner: str, due: str }),
  obj({ op: values("update"), sec, old: str, text: str, owner: str, due: str }),
  obj({ op: values("remove"), sec, old: str }),
] }, 40), rolling: { type: "string", maxLength: 1500 } });
export const FINAL_NOTES_SCHEMA = obj({ attendees: arr(str), summary: arr(str), decisions: arr(str),
  actions: arr(obj({ text: str, owner: str, due: str })), questions: arr(str), notes: arr(str) });
