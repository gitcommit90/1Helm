// One place for "copy this text". The wrapper apps (Mac, iOS, Android) show this same web app in a web view, and a web view can refuse
// navigator.clipboard. So the copy starts synchronously inside the click (a deferred call can lose the click's permission), then falls
// back to a hidden textarea and the copy command, then to a Capacitor Clipboard plugin if the wrapper happens to expose one.
// It returns true when some route reported success and false when none did.
export async function copyText(plain: string, html = ""): Promise<boolean> {
  const nav: any = typeof navigator === "undefined" ? null : navigator, clip = nav?.clipboard;
  // Start the async clipboard call now, in the click's own turn, before anything is awaited.
  let first: Promise<unknown> | null = null;
  try {
    const CI = (globalThis as any).ClipboardItem;
    if (CI && clip?.write && html) first = clip.write([new CI({ "text/plain": new Blob([plain], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
    else if (clip?.writeText) first = clip.writeText(plain);
  } catch { first = null; }
  if (first) { try { await first; return true; } catch { /* fall through */ } }
  // The html copy may be what was refused, so try plain text through the same API once more before the textarea.
  if (html && clip?.writeText) { try { await clip.writeText(plain); return true; } catch { /* fall through */ } }
  if (execCopy(plain)) return true;
  try {
    const plugin = (globalThis as any).Capacitor?.Plugins?.Clipboard;
    if (plugin?.write) { await plugin.write({ string: plain }); return true; }
  } catch { /* fall through */ }
  return false;
}

// The copy command on a hidden textarea. Focus and selection are put back afterwards.
function execCopy(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;
  const focused = document.activeElement as HTMLElement | null, selection = window.getSelection?.() ?? null;
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  // Inside an open modal dialog the rest of the page is inert, so the textarea goes inside it.
  const host = (focused?.closest?.("dialog[open],[aria-modal=true]") as HTMLElement | null) || document.body;
  const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("aria-hidden", "true"); ta.setAttribute("tabindex", "-1"); ta.setAttribute("inputmode", "none");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px";
  try { host.appendChild(ta); ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length); return document.execCommand("copy"); }
  catch { return false; }
  finally { ta.remove(); if (focused?.isConnected) focused.focus({ preventScroll: true }); if (selection) { selection.removeAllRanges(); ranges.forEach(r => selection.addRange(r)); } }
}
