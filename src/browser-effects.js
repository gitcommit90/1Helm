// What a browser_act did, in plain words, from the effects the browser service collected while the steps ran (image/opt/1hc-browser/server.mjs).
// An older browser service sends no effects, only page_changed. Nothing here guesses: when the service saw nothing, the line says so as a fact.
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);
const NONE = "No change was seen: same page text and address, no download, no new tab, no network request and no change to the page structure. Check the page (browser_snapshot or a screenshot) before saying it worked. ";
export function describeEffects(r) {
  const e = r?.effects;
  if (!e) return r?.page_changed === false ? "No change was seen in the page text or address. Check the page (browser_snapshot or a screenshot) before saying it worked. " : "";
  const items = [];
  if (!e.outline_changed && !e.address_changed) items.push("the page text and address stayed the same");
  if (e.outline_changed) items.push("the page text changed");
  if (e.address_changed) items.push("the address changed");
  if (e.uploaded) items.push("a file was attached");
  for (const d of e.downloads || []) items.push(d.state === "completed" ? `a download of "${d.name}" (${size(d.bytes)}) finished` : d.state === "in_progress" ? `a download of "${d.name}" is still in progress` : `a download of "${d.name}" was cancelled or failed`);
  if (e.pdf_saved) items.push(`this tab shows a PDF, which the outline cannot read, and a copy was saved as "${e.pdf_saved}"`);
  for (const n of (e.navigations || []).filter((x) => !(x.main && !x.same && e.address_changed) && !(x.same && e.address_changed))) items.push(n.main ? (n.same ? `the page changed its address without reloading (${n.url})` : `the page loaded ${n.url}`) : `a frame loaded ${n.url}`);
  if (e.popups_blocked?.length) items.push(`the page tried to open a window at ${e.popups_blocked.join(", ")} and the browser blocked it${e.popup_opened_for_you ? "; that address was opened as a new tab for you instead" : ""}`);
  for (const d of e.dialogs || []) items.push(`a JavaScript ${d.type} box${d.message ? ` saying "${d.message}"` : ""} appeared and the browser ${d.handled} it`);
  if (e.file_chooser) items.push("the click opened a file chooser, which the browser did not show; use the upload step with this ref to attach a file");
  if (e.requests) items.push(`${e.requests.count} network request${e.requests.count === 1 ? "" : "s"} (${e.requests.items.join(", ")}${e.requests.count > e.requests.items.length ? ", and more" : ""})`);
  if (e.mutations && !e.outline_changed) items.push(`${e.mutations} change${e.mutations === 1 ? "" : "s"} to the page structure`);
  if (e.new_tab && items.length === 1 && !e.outline_changed) items.push("a new tab opened");
  const seen = items.filter((i) => i !== "the page text and address stayed the same");
  if (!seen.length && !e.new_tab) return NONE;
  return `What the steps did: ${items.join("; ")}. `;
}
