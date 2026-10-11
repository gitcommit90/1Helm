// Accept one JSON object, optionally surrounded by model prose/fences. Never
// repair malformed JSON, choose among alternatives, or evaluate model output.
export function parseAmbientOutput(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 100000 || text.startsWith("[")) throw new SyntaxError("Invalid ambient JSON output");
  let start = -1, depth = 0, quoted = false, escape = false;
  const objects = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!depth) { if (c === "{") { start = i; depth = 1; } continue; }
    if (quoted) { if (escape) escape = false; else if (c === "\\") escape = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && !--depth) objects.push(text.slice(start, i + 1));
  }
  if (depth || objects.length !== 1) throw new SyntaxError("Ambiguous or truncated ambient JSON output");
  const parsed = JSON.parse(objects[0]);
  if (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.items)) throw new SyntaxError("Invalid ambient JSON object");
  return parsed;
}

// Keep the sentence's subject/negation and an immediately following qualifier.
// Every returned character is still one contiguous substring of the source.
export function ambientContextQuote(text, quote) {
  const at = text.indexOf(quote); if (at < 0) return quote;
  const spans = [...text.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g)];
  let first = spans.findIndex((m) => m.index + m[0].length > at); const end = at + quote.length;
  if (first < 0) return quote;
  if (first > 0 && /^(?:or\b|but\b|maybe\b|actually\b|however\b|not\b|except\b|unless\b)/i.test(spans[first][0].trim())) first--;
  let last = first; while (last + 1 < spans.length && spans[last].index + spans[last][0].length < end) last++;
  while (last + 1 < spans.length && /^(?:or\b|but\b|maybe\b|actually\b|however\b|not\b|except\b|unless\b)/i.test(spans[last + 1][0].trim())) last++;
  const context = text.slice(spans[first].index, spans[last].index + spans[last][0].length).trim();
  return context.length <= 1500 ? context : quote;
}
