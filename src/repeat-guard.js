// Repetition guard for a streamed model step (Captain 10-07). Once, one Sol step wrote 65,536 output tokens of dates (2026→2052)
// inside one run_command argument until the provider's limit stopped it ($0.67, reasoning 0). The per-step cap (model.js stepMaxOut)
// bounds the worst case; this stops a degenerate step long before it.
//
// What counts as degenerate: the tail of what the step is writing (its text, one tool call's arguments, or its reasoning) is periodic:
//   exact   the same chunk (period ≤ 400 chars) repeated ≥ 20 times over ≥ 4,000 chars ("the the the", one paragraph again and again);
//   folded  with every run of digits read as one "#", the same short pattern (period ≤ 80) repeated ≥ 100 times over ≥ 8,000 folded chars
//           (a counting loop: dates, ids, "row 1, row 2…"). A 365-day list or a normal CSV with names in it stays far below this.
// Checked every 512 new chars once a stream holds 4,000; each check walks back from the end and stops at the first mismatch, so a
// normal step costs almost nothing. Pure: the Resident (callModelOnce) feeds it and decides what to do (resident.js callModel:
// abort, drop the partial call, retry once with REPEAT_NOTE, then REPEAT_FALLBACK as a plain message; the spend guard counts it).
export const REPEAT = { checkEvery: 512, minChars: 4000, keep: 40000,
  exactMaxPeriod: 400, exactMinSpan: 4000, exactMinRepeats: 20,
  foldMaxPeriod: 80, foldMinSpan: 8000, foldMinRepeats: 100 };

// A model step cannot pre-author hundreds of operations before seeing feedback.
// Independent of optional spend pauses; reject the whole step, never a prefix.
export const TOOL_BATCH = Object.freeze({ maxCalls: 32, maxPeriod: 4, minCycles: 4, minCalls: 8, signatureChars: 8192, signatureDepth: 32 });
function callSignature(name, args) {
  if (!name || args.length > TOOL_BATCH.signatureChars) return null;
  try {
    const value = JSON.parse(args);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const canonical = (v, depth) => {
      if (depth > TOOL_BATCH.signatureDepth) throw new Error("deep signature");
      if (!v || typeof v !== "object") return JSON.stringify(v);
      if (Array.isArray(v)) return `[${v.map(x => canonical(x, depth + 1)).join(",")}]`;
      return `{${Object.keys(v).sort().filter(k => depth !== 0 || k !== "step_title").map(k => `${JSON.stringify(k)}:${canonical(v[k], depth + 1)}`).join(",")}}`;
    };
    return `${name}:${canonical(value, 0)}`;
  } catch { return null; } // Partial/invalid JSON is not a repeated completed call.
}
export function toolBatchWatch() {
  const calls = new Map(); let hit = null, chars = 0;
  const stop = (kind, span) => (hit = { where: "tool_calls", kind, span, period: 0, unit: "bounded tool batch", chars });
  return {
    feed(deltas = []) {
      if (hit) return hit;
      for (const delta of deltas) {
        const index = delta.index ?? 0;
        // Check before the stream parser can allocate a sparse/unbounded array.
        if (!Number.isSafeInteger(index) || index < 0 || index >= TOOL_BATCH.maxCalls) return stop("batch-limit", calls.size + 1);
        const c = calls.get(index) || { name: "", args: "", oversized: false, signature: null };
        const name = delta.function?.name || "", args = delta.function?.arguments || "";
        chars += name.length + args.length;
        c.name = (c.name + name).slice(0, 256);
        if (!c.oversized) {
          if (c.args.length + args.length > TOOL_BATCH.signatureChars) { c.oversized = true; c.args = ""; }
          else c.args += args;
        }
        c.signature = c.oversized ? null : callSignature(c.name, c.args);
        calls.set(index, c);
      }
      // Do not skip gaps or incomplete arguments: they break a repeated pattern.
      const keys = [...calls.keys()].sort((a, b) => a - b);
      const signatures = keys.map(k => calls.get(k).signature);
      for (let end = TOOL_BATCH.minCalls; end <= keys.length; end++) {
        for (let period = 1; period <= TOOL_BATCH.maxPeriod; period++) {
          const span = Math.max(TOOL_BATCH.minCalls, period * TOOL_BATCH.minCycles), start = end - span;
          if (start < 0) continue;
          let same = true;
          for (let i = start; i < end; i++) if (!signatures[i] || (i > start && keys[i] !== keys[i - 1] + 1) || signatures[i] !== signatures[start + (i - start) % period]) { same = false; break; }
          if (same) { stop("batch-repeat", span); hit.period = period; return hit; }
        }
      }
      return null;
    },
    get hit() { return hit; },
  };
}

// Longest run at the end of s that repeats with period p (≥ minSpan and ≥ minRepeats periods) for the smallest such p, or null.
export function periodicTail(s, maxP, minSpan, minRepeats) {
  const n = s.length; if (n < minSpan) return null;
  for (let p = 1; p <= maxP && p * minRepeats <= n; p++) {
    let i = n - 1; const stop = Math.max(p, n - minSpan * 4);
    while (i >= stop && s.charCodeAt(i) === s.charCodeAt(i - p)) i--;
    const span = n - 1 - i + p;   // the matched run plus the first copy of the period
    if (span >= minSpan && span / p >= minRepeats) return { period: p, span, unit: s.slice(n - p) };
  }
  return null;
}
const fold = (s) => s.replace(/\d+/g, "#").replace(/[ \t]+/g, " ");
// → null, or { kind: "exact" | "folded", period, span, unit } for a tail that's looping.
export function degenerate(s, o = REPEAT) {
  s = String(s || ""); if (s.length < o.minChars) return null;
  const ex = periodicTail(s, o.exactMaxPeriod, o.exactMinSpan, o.exactMinRepeats); if (ex) return { kind: "exact", ...ex };
  const f = periodicTail(fold(s), o.foldMaxPeriod, o.foldMinSpan, o.foldMinRepeats); if (f) return { kind: "folded", ...f };
  return null;
}

// One watch per streamed step. feed(where, delta) → null, or { where, kind, period, span, unit, chars } the first time a stream loops.
// where: "text", "reasoning", or "call:<index>" (each tool call's arguments on their own).
export function repeatWatch(o = REPEAT) {
  const tails = new Map(); let total = 0, hit = null;
  return {
    feed(where, delta) {
      if (hit || !delta) return hit;
      total += delta.length;
      const t = tails.get(where) || { s: "", since: 0 };
      t.s += delta; t.since += delta.length; if (t.s.length > o.keep) t.s = t.s.slice(-o.keep);
      tails.set(where, t);
      if (t.s.length < o.minChars || t.since < o.checkEvery) return null;
      t.since = 0;
      const d = degenerate(t.s, o);
      if (d) hit = { where, ...d, unit: d.unit.slice(0, 80), chars: total };
      return hit;
    },
    get chars() { return total; },
    get hit() { return hit; },
  };
}

// What the model is told before its one retry, and the plain message when the retry loops too.
export const REPEAT_NOTE = "(1Helm note, not from the person: your last output started repeating the same thing over and over, so it was stopped and thrown away, including any tool call in it. Produce a concise answer now. Don't write long lists or data out by hand: if something needs many repeated lines, write a short script that makes them, or ask the person.)";
export const REPEAT_FALLBACK = "Sorry, I got stuck repeating myself on that step, so I stopped it before it went any further. Nothing from that step was run. Could you tell me again what you need, or break it into a smaller piece?";
