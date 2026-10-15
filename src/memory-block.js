// Memory that 1Helm adds to a turn (Memory Overhaul phase 4A, DESIGN.md 6.2) is wrapped in these tags, so it can be taken out again before
// the turn is retained into Hindsight (the OpenClaw pattern): memory that was recalled must never be retained as if the person had said it.
// No imports, so the writers can use it without pulling in the rest.
export const MEM_OPEN = "<injected-memory>", MEM_CLOSE = "</injected-memory>";
export const wrapMemory = (text) => (String(text || "").trim() ? `${MEM_OPEN}\n${String(text).trim()}\n${MEM_CLOSE}` : "");
// Remove every wrapped block (and an opening tag with no closing tag, to the end of the text), whatever surrounds it.
export function stripInjectedMemory(text) {
  const s = String(text ?? ""); if (!s.includes(MEM_OPEN) && !s.includes(MEM_CLOSE)) return s;
  return s.replace(/<injected-memory>[\s\S]*?<\/injected-memory>/g, "").replace(/<injected-memory>[\s\S]*$/, "").replace(/<\/injected-memory>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
