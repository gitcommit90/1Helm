import { createHash } from "node:crypto";

export type ContextMetricSegment = { hash: string; tokens: number };
export type ModelContextMetrics = { tokens: number; segments: ContextMetricSegment[] };

/** Provider-neutral, deterministic rough token count over the exact structured
 * material 1Helm submits. Four UTF-8 bytes per token is intentionally a stable
 * product approximation rather than any provider's tokenizer contract. */
export function nativeTokenCount(value: unknown): number {
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (!serialized) return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(serialized, "utf8") / 4));
}

const segment = (kind: string, value: unknown, tokens = nativeTokenCount(value)): ContextMetricSegment => ({
  hash: createHash("sha256").update(kind).update("\0").update(typeof value === "string" ? value : JSON.stringify(value ?? null)).digest("hex"),
  tokens,
});

/** Count the model, messages, and exposed tool schemas using one native format.
 * The model segment carries no context tokens but prevents cross-model cache
 * overlap from being presented as reused context. */
export function calculateModelContext(model: string, messages: unknown[], tools?: unknown[]): ModelContextMetrics {
  const segments: ContextMetricSegment[] = [segment("model", model, 0)];
  for (const message of messages) segments.push(segment("message", message));
  for (const tool of tools || []) segments.push(segment("tool", tool));
  return { tokens: segments.reduce((total, item) => total + item.tokens, 0), segments };
}

/** Cached means the unchanged leading context shared with the preceding call.
 * This is a native reuse metric; it never depends on a provider cache report. */
export function sharedContextTokens(previous: ContextMetricSegment[], current: ContextMetricSegment[]): number {
  let tokens = 0;
  for (let index = 0; index < Math.min(previous.length, current.length); index += 1) {
    if (previous[index].hash !== current[index].hash) break;
    tokens += current[index].tokens;
  }
  return Math.min(tokens, current.reduce((total, item) => total + item.tokens, 0));
}

/** Count only output that 1Helm actually receives: response text and generated
 * tool-call payloads. Hidden provider reasoning is deliberately not invented. */
export function calculateModelOutput(content: string, toolCalls: unknown[]): number {
  return nativeTokenCount(content) + (toolCalls || []).reduce<number>((total, call) => total + nativeTokenCount(call), 0);
}

export function parseContextMetricSegments(value: unknown): ContextMetricSegment[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => item && typeof item.hash === "string" && Number.isFinite(Number(item.tokens))
      ? [{ hash: item.hash, tokens: Math.max(0, Math.round(Number(item.tokens))) }]
      : []);
  } catch { return []; }
}
