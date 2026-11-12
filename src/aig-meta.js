// The gateway metadata of every call, shared by the OpenRouter path (model.js) and the Workers AI path (cloudflare-models.js). See the order note in model.js.
// A call whose caller set no kind is tagged "untagged" so that the Langfuse trace is never nameless (the collector names traces from kind). Every caller should set its own kind.
export const AIG_META_FIRST = ["tenant", "session", "channel", "kind", "px", "job"];
export const aigMeta = (env, meta = {}) => {
  const ok = Object.entries(meta.kind ? meta : { ...meta, kind: "untagged" }).filter(([k, v]) => v != null && v !== "" && !k.startsWith("_"));
  const first = AIG_META_FIRST.flatMap((k) => ok.filter(([key]) => key === k)), rest = ok.filter(([k]) => !AIG_META_FIRST.includes(k));
  return Object.fromEntries([...first, ...rest].slice(0, 5).map(([k, v]) => [k, typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 64)]));
};
