// Wire contracts for bounded background jobs. Empty arrays are valid no-change results.
// These contracts constrain shape; the callers still enforce evidence, privacy and ownership.
const str = { type: "string" };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items, maxItems) => ({ type: "array", items, ...(maxItems == null ? {} : { maxItems }) });
const values = (...enumValues) => ({ type: "string", enum: enumValues });
export const AMBIENT_EXTRACT_SCHEMA = obj({ items: arr(obj({
  kind: values("task", "reminder", "idea", "fact", "preference", "decision"),
  speech_act: values("intention", "tentative_intention", "memory", "example", "quotation", "uncertain"),
  text: str, quote: str, line: { type: "integer", minimum: 0 }, status: values("open", "completed", "cancelled"), due_text: str,
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
