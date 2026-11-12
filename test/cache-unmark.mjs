// Reverse cache annotations in synthetic provider fixtures only.
const one = m => {
  if (!Array.isArray(m?.content) || !m.content.some(p => p?.cache_control)) return m;
  const c = m.content.map(({ cache_control, ...p }) => p);
  return { ...m, content: c.length === 1 && c[0].type === "text" ? c[0].text : c };
};
export function unmark(body) {
  if (!body || typeof body !== "object") return body;
  const out = { ...body };
  if (Array.isArray(body.messages)) out.messages = body.messages.map(one);
  if (Array.isArray(body.tools)) out.tools = body.tools.map(({ cache_control, ...t }) => t);
  return out;
}
