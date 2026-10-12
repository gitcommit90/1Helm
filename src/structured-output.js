// Bounded background jobs: the same schema goes to the provider and validates its answer locally.
// No JSON salvage, coercion, or silent downgrade. Callers apply state only after this succeeds.
import { boundedText } from "./bounded-body.js";
export const S = {
  object: properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }),
  array: items => ({ type: "array", items }),
  string: { type: "string" }, number: { type: "number" }, integer: { type: "integer" }, boolean: { type: "boolean" },
};
export class StructuredOutputError extends Error {
  constructor(reason) { super(`structured output: ${reason}`); this.name = "StructuredOutputError"; this.structured = true; }
}
const SCHEMA_KEYS = new Set(["type", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "enum", "anyOf", "description", "title"]);
export function assertStructuredSchema(schema) {
  if (!schema || typeof schema !== "object") throw new StructuredOutputError("invalid schema");
  for (const key of Object.keys(schema)) if (!SCHEMA_KEYS.has(key)) throw new StructuredOutputError(`unsupported schema keyword ${key}`);
  if (schema.anyOf) {
    if (Object.keys(schema).some(k => !["anyOf", "description", "title"].includes(k))) throw new StructuredOutputError("anyOf sibling constraints are unsupported");
    if (!Array.isArray(schema.anyOf) || !schema.anyOf.length) throw new StructuredOutputError("empty anyOf");
    schema.anyOf.forEach(assertStructuredSchema); return;
  }
  const types = [schema.type].flat();
  if (!types.length || types.some(t => !["object", "array", "string", "number", "integer", "boolean", "null"].includes(t))) throw new StructuredOutputError("unsupported schema type");
  if (types.includes("object")) {
    const keys = Object.keys(schema.properties || {});
    if (schema.additionalProperties !== false || !Array.isArray(schema.required) || keys.length !== schema.required.length || keys.some(k => !schema.required.includes(k))) throw new StructuredOutputError("object schema must require every field and forbid extras");
    Object.values(schema.properties || {}).forEach(assertStructuredSchema);
  }
  if (types.includes("array")) assertStructuredSchema(schema.items);
}
export const structuredFormat = (name, schema) => { assertStructuredSchema(schema); return { type: "json_schema", json_schema: { name, strict: true, schema } }; };
export function validateStructured(value, schema, path = "$", depth = 0) {
  const fail = why => { throw new StructuredOutputError(`${path} ${why}`); };
  if (depth > 64) fail("exceeds nesting limit");
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => { try { validateStructured(value, s, path, depth + 1); return true; } catch { return false; } })) fail("does not match any permitted shape");
    return value;
  }
  if (schema.enum && !schema.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) fail("is not an allowed value");
  const type = schema.type;
  if (Array.isArray(type)) return validateStructured(value, { ...schema, type: undefined, anyOf: type.map(t => ({ ...schema, type: t })) }, path, depth + 1);
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("must be an object");
    for (const k of schema.required || []) if (!Object.hasOwn(value, k)) fail(`missing ${k}`);
    for (const k of Object.keys(value)) {
      if (Object.hasOwn(schema.properties || {}, k)) validateStructured(value[k], schema.properties[k], `${path}.${k}`, depth + 1);
      else if (schema.additionalProperties === false) fail("has an unexpected field");
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validateStructured(value[k], schema.additionalProperties, `${path}.*`, depth + 1);
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) fail("must be an array");
    if (schema.minItems != null && value.length < schema.minItems || schema.maxItems != null && value.length > schema.maxItems) fail("has an invalid item count");
    value.forEach((v, i) => validateStructured(v, schema.items, `${path}[${i}]`, depth + 1));
  } else if (type === "string") {
    if (typeof value !== "string") fail("must be a string");
    if (schema.minLength != null && value.length < schema.minLength || schema.maxLength != null && value.length > schema.maxLength) fail("has an invalid length");
  } else if (type === "number" || type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || type === "integer" && !Number.isInteger(value)) fail(`must be ${type}`);
    if (schema.minimum != null && value < schema.minimum || schema.maximum != null && value > schema.maximum) fail("is out of range");
  } else if (type === "boolean") { if (typeof value !== "boolean") fail("must be boolean"); }
  else if (type === "null") { if (value !== null) fail("must be null"); }
  else fail("has an unsupported schema type");
  return value;
}
export function parseStructuredResponse(response, schema) {
  const c = response?.choices?.[0], m = c?.message;
  if (!c || response.error || m?.refusal || m?.tool_calls?.length || c.finish_reason !== "stop") throw new StructuredOutputError("missing, refused, or incomplete answer");
  if (typeof m?.content !== "string") throw new StructuredOutputError("missing JSON text");
  if (m.content.length > 1_000_000) throw new StructuredOutputError("JSON text exceeds limit");
  let value;
  try { value = JSON.parse(m.content); } catch { throw new StructuredOutputError("invalid JSON"); }
  return validateStructured(value, schema);
}
export function addStructuredUsage(total, usage = {}) {
  for (const [k, v] of Object.entries(usage || {})) {
    if (typeof v === "number" && Number.isFinite(v)) total[k] = (total[k] || 0) + v;
    else if (v && typeof v === "object" && !Array.isArray(v)) addStructuredUsage(total[k] ||= {}, v);
  }
  return total;
}
// Native Workers AI has no finish_reason on its response-only shape. Normalize only that API shape.
export function workersStructuredResponse(r) {
  if (r?.choices) return r;
  const content = r?.response ?? r?.result?.response;
  return { ...r, choices: [{ finish_reason: r?.truncated || r?.error ? "length" : r?.finish_reason || "stop", message: { content: typeof content === "string" ? content : JSON.stringify(content), refusal: r?.refusal } }] };
}
export async function structuredChat(call, request, { name, schema, maxAttempts = 2, onUsage } = {}) {
  const usage = {}; let attempts = 0;
  const body = { ...request, stream: false, response_format: structuredFormat(name, schema) };
  while (attempts < Math.max(1, Math.min(3, maxAttempts))) {
    attempts++;
    try {
      const r = await call(body);
      if (r instanceof Response && !r.ok) throw new Error(`structured provider HTTP ${r.status}`);
      const response = r instanceof Response ? JSON.parse(await boundedText(r, 8_000_000)) : r;
      addStructuredUsage(usage, response?.usage);
      await onUsage?.(response?.usage || {}, response);
      return { data: parseStructuredResponse(response, schema), response, usage, attempts };
    } catch (e) {
      e.usage = usage; e.attempts = attempts;
      if (!e.structured || attempts >= Math.max(1, Math.min(3, maxAttempts))) throw e;
    }
  }
}
