// What a person's message shows when it carries an edit from the image editor (zone-annotate.ts): the marked picture as a small thumbnail, and one row for each
// mark with its coloured number and its note. The server keeps the marks with the message (src/tracker.js annotationsOut), so the same block shows after a reload.
export type Notes = { source?: string; marked: string; marks: { n: number; color: string; note?: string }[] };
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const COLOR = /^#[0-9a-f]{3,8}$/i;
export function annMsgHtml(a: Notes | undefined, slug: string, url: (id: string) => string, tail = "", thumb?: (id: string) => string, vis?: { ar?: number; local?: string }): string {
  const ar = vis?.ar && vis.ar > 0 ? ` ar" style="aspect-ratio:${Math.round(vis.ar * 1000) / 1000}` : "";   // the slot keeps one size from sending to sent
  if (!a || !a.marked || !Array.isArray(a.marks)) return "";
  const rows = a.marks.slice(0, 20).map(m => `<li class="amrow"><span class="ambadge" style="--c:${COLOR.test(m.color) ? m.color : "#2563eb"}">${Math.trunc(Number(m.n)) || ""}</span>${String(m.note ?? "").trim() ? `<span class="amnote">${esc(String(m.note).trim())}</span>` : ""}</li>`).join("");
  if (a.marked === "pending") return `<div class="amsg">${tail}<span class="amthumb pend${ar}"></span>${rows ? `<ul class="amrows">${rows}</ul>` : ""}</div>`;   // the picture is still being made
  return `<div class="amsg">${tail}<a class="amthumb${ar}" href="${esc(url(a.marked))}" data-fv="${esc(slug)}|${esc(a.marked)}" data-fvc aria-label="Open the marked picture"><img src="${esc(vis?.local || (thumb || url)(a.marked))}" data-full="${esc(url(a.marked))}" onerror="if(this.dataset.full&&this.src!==this.dataset.full){this.src=this.dataset.full}" alt=""${vis?.local ? "" : ' loading="lazy"'}></a>${rows ? `<ul class="amrows">${rows}</ul>` : ""}</div>`;
}
