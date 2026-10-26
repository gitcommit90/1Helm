// A panel that opens from the phone chat header or chat pane belongs to the chat pane, so it slides away with the pane when
// the channel sidebar opens. On a phone it is mounted inside `#m .chat` (that pane has a transform, so position:fixed inside
// it is placed against the pane); on a wide screen it stays on the body. The phone render rebuilds the pane, so v3.ts carries
// these elements from the old pane to the new one with keepPaneFloats.
const PHONE = "(max-width: 767px)";
export const paneHost = (): HTMLElement => (matchMedia(PHONE).matches && document.querySelector<HTMLElement>("#m .chat")) || document.body;
// Put a floating panel in the right parent for the current layout and mark it, so the render can find it.
export function mountPaneFloat(el: HTMLElement) { el.dataset.paneFloat = ""; const h = paneHost(); if (el.parentElement !== h) h.appendChild(el); }
// Run a render that replaces the phone pane (or clears it) and keep every marked panel alive across it.
export function keepPaneFloats(render: () => void) {
  const kept = [...document.querySelectorAll<HTMLElement>("#m [data-pane-float]")];
  kept.forEach(el => el.remove());
  try { render(); } finally { kept.forEach(el => paneHost().appendChild(el)); }
}
// The pane's top edge in the viewport, for placing a fixed panel that is mounted inside the pane.
export const paneOrigin = (el: HTMLElement) => { const p = el.parentElement; return p && p !== document.body ? p.getBoundingClientRect() : { left: 0, top: 0 }; };
