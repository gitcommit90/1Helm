// A screen that is drawn again because the window changed size (the on-screen keyboard shrinks the window on Android, and under 500px high the app
// switches to the phone layout) must not lose what is being typed. keepFields() remembers every field in the given areas (its text, whether it is
// checked, the caret) and which one had focus, runs the redraw, and puts all of it back into the matching new fields (same id, or same name and place).
import { typingAtResize } from "./mobile-viewport";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type Kept = { key: string; value: string; checked: boolean; a: number | null; b: number | null; dir: "forward" | "backward" | "none" | null; focus: boolean };

const SKIP_TYPES = new Set(["file", "hidden", "button", "submit", "reset", "image"]);
const keyOf = (f: Field, all: Field[]) => {
  if (f.id) return `#${f.id}`;
  if (!f.name) return "";
  const same = all.filter(x => x.name === f.name && x.type === f.type);
  return `${f.type}[name=${f.name}]#${same.indexOf(f)}`;
};
const fieldsIn = (roots: string[]) => [...document.querySelectorAll<Field>(roots.map(r => `${r} input, ${r} textarea, ${r} select`).join(","))].filter(f => !SKIP_TYPES.has((f as HTMLInputElement).type));

/**
 * Run paint() (a redraw of the areas matching `roots`) and keep the fields' content and the focused field across it. `skip` are ids that redraw
 * themselves. scope "all" keeps every field in the areas (a layout change redraws the screen, and nothing should be lost); scope "focused-form"
 * keeps only the form of the field being typed in, and nothing at all when no field has focus (an ordinary redraw, e.g. a list that finished loading).
 */
export function keepFields(roots: string[], skip: string[], paint: () => void, scope: "all" | "focused-form" = "all") {
  const list = () => fieldsIn(roots).filter(f => !skip.includes(f.id));
  const before = list(), isFocus = (f: Field) => document.activeElement === f || typingAtResize() === f;
  let take = before;
  if (scope === "focused-form") {
    const f = before.find(isFocus);
    if (!f) { paint(); return; }
    const form = f.closest("form");
    take = form ? before.filter(x => x.closest("form") === form) : [f];
  }
  const kept: Kept[] = [];
  for (const f of take) {
    const key = keyOf(f, before); if (!key) continue;
    const text = f instanceof HTMLSelectElement ? null : f;
    let a: number | null = null, b: number | null = null, dir: Kept["dir"] = null;
    try { a = text?.selectionStart ?? null; b = text?.selectionEnd ?? null; dir = text?.selectionDirection ?? null; } catch { /* types without a caret (email) */ }
    kept.push({ key, value: f.value, checked: (f as HTMLInputElement).checked, a, b, dir, focus: isFocus(f) });
  }
  paint();
  const now = list();
  let focusEl: Field | null = null, focusKept: Kept | null = null;
  for (const k of kept) {
    const f = now.find(x => keyOf(x, now) === k.key); if (!f) continue;
    if (f.type === "checkbox" || f.type === "radio") { if ((f as HTMLInputElement).checked !== k.checked) (f as HTMLInputElement).checked = k.checked; }
    else if (f.value !== k.value) { f.value = k.value; f.dispatchEvent(new Event("input", { bubbles: true })); }
    if (k.focus) { focusEl = f; focusKept = k; }
  }
  if (!focusEl || !focusKept || focusEl === document.activeElement || focusEl.disabled || !focusEl.offsetParent) return;
  focusEl.focus({ preventScroll: true });
  try { if (focusKept.a !== null && !(focusEl instanceof HTMLSelectElement)) focusEl.setSelectionRange(focusKept.a, focusKept.b ?? focusKept.a, focusKept.dir ?? "none"); } catch { /* no caret on this type */ }
  focusEl.scrollIntoView({ block: "nearest" });
}
