// Speaker labels in transcripts (Live notes, Bee, audio and video files). A line's `speaker` is an id ("S1") or, for Bee, Bee's own label.
// The session's `speakers` list ([{ id, name, contact_id }]) holds the names people gave. A named speaker shows its name, an unnamed
// "S1" shows "Speaker 1", and any other label shows as it came. Tapping a label opens one small box to type a name or pick a Contacts person.
export type Speaker = { id: string; name?: string | null; contact_id?: string | number | null };
export type Person = { id: string; name: string };
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function speakersOf(data: any): Speaker[] {
  return Array.isArray(data?.speakers) ? data.speakers.filter((s: any) => s && typeof s.id === "string" && s.id).map((s: any) => ({ id: s.id, name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : null, contact_id: s.contact_id ?? null })) : [];
}
export function speakerLabel(id: string, speakers: Speaker[] = []) {
  const n = speakers.find((s) => s.id === id)?.name; if (n) return n;
  const m = /^S(\d+)$/i.exec(id); return m ? `Speaker ${m[1]}` : id;
}
// Only labels this app can map to a name: the ones in the session's speakers list, and our own "S<number>" ids. Bee's labels stay as Bee sent them.
export const speakerEditable = (id: string, speakers: Speaker[] = []) => /^S\d+$/i.test(id) || speakers.some((s) => s.id === id);
// The label sits in the small line the time already uses, so a label arriving or changing later moves nothing.
export function speakerTag(id: string, speakers: Speaker[]) {
  if (!id) return "";
  const t = esc(speakerLabel(id, speakers));
  return speakerEditable(id, speakers) ? `<button type="button" class="spk" data-spk="${esc(id)}" aria-label="Name ${t}" title="Name this speaker">${t}</button>` : `<span class="spk">${t}</span>`;
}
export function transcriptHtml(lines: { time: string; speaker: string; text: string }[], speakers: Speaker[], empty: string) {
  return lines.length ? lines.map((l) => `<p>${l.time || l.speaker ? `<small>${[l.time ? esc(l.time) : "", speakerTag(l.speaker, speakers)].filter(Boolean).join(" · ")}</small><br>` : ""}<span style="white-space:pre-wrap">${esc(l.text)}</span></p>`).join("") : `<p>${esc(empty)}</p>`;
}
// Every label for this speaker in `root` shows the new name at once.
export function repaintSpeakers(root: ParentNode, speakers: Speaker[]) {
  root.querySelectorAll<HTMLElement>("[data-spk]").forEach((b) => { const t = speakerLabel(b.dataset.spk!, speakers); if (b.textContent !== t) { b.textContent = t; b.setAttribute("aria-label", `Name ${t}`); } });
}
export const personMatches = (people: Person[], q: string, max = 5) => { const s = q.trim().toLowerCase(); return (s ? people.filter((p) => p.name.toLowerCase().includes(s)) : people).slice(0, max); };

let pop: HTMLElement | null = null, popOff: (() => void) | null = null;
export const speakerEditorClose = () => { popOff?.(); popOff = null; pop?.remove(); pop = null; };
export type EditorOpts = { anchor: HTMLElement; id: string; speakers: Speaker[]; people: () => Person[]; save: (body: { name: string | null; contact_id?: string | null }) => Promise<string | null>; };
// One floating box next to the label (position: fixed, so it never moves the transcript). Enter saves the typed name, a person row saves
// that Contacts person, Esc or a tap outside closes. A failed save keeps the box open with one line saying so.
export function speakerEditor(o: EditorOpts) {
  speakerEditorClose();
  const cur = o.speakers.find((s) => s.id === o.id), root = o.anchor.closest<HTMLElement>("#fv, body") || document.body;
  const el = pop = document.createElement("div"); el.className = "spkpop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", `Name ${speakerLabel(o.id, o.speakers)}`);
  el.innerHTML = `<input type="text" class="spkin" maxlength="80" placeholder="Name" value="${esc(cur?.name || "")}" aria-label="Name"><div class="spkpp" role="listbox"></div><p class="spkerr" role="alert" hidden></p>${cur?.name ? `<button type="button" class="spkclr">Remove name</button>` : ""}`;
  root.appendChild(el);
  const input = el.querySelector<HTMLInputElement>(".spkin")!, list = el.querySelector<HTMLElement>(".spkpp")!, err = el.querySelector<HTMLElement>(".spkerr")!;
  const place = () => { const r = o.anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight; el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`; el.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`; };
  const paintList = () => { const ms = personMatches(o.people(), input.value); list.innerHTML = ms.map((p) => `<button type="button" role="option" class="spkp" data-pid="${esc(p.id)}">${esc(p.name)}</button>`).join(""); list.hidden = !ms.length; };
  let busy = false;
  const go = async (name: string | null, contact?: string | null) => { if (busy) return; busy = true; el.classList.add("busy"); const e = await o.save({ name, ...(contact ? { contact_id: contact } : {}) }); busy = false; el.classList.remove("busy"); if (e) { err.textContent = e; err.hidden = false; place(); } else speakerEditorClose(); };
  input.addEventListener("input", () => { paintList(); err.hidden = true; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const v = input.value.trim(); if (v) void go(v); } });
  el.addEventListener("click", (e) => { const t = e.target as HTMLElement; const p = t.closest<HTMLElement>("[data-pid]"); if (p) { void go(p.textContent || "", p.dataset.pid!); return; } if (t.closest(".spkclr")) void go(null); });
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); const a = o.anchor; speakerEditorClose(); a.focus?.({ preventScroll: true }); } };
  const away = (e: Event) => { if (!el.contains(e.target as Node) && !o.anchor.contains(e.target as Node)) speakerEditorClose(); };
  document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", away, true);
  popOff = () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", away, true); };
  paintList(); place(); input.focus({ preventScroll: true }); input.select();
}
