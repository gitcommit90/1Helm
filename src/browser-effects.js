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
  for (const m of e.page_errors || []) items.push(`the page reported a JavaScript error: ${m}`);
  if (e.file_chooser) items.push("the click opened a file chooser, which the browser did not show; use the upload step with this ref to attach a file");
  if (e.requests) items.push(`${e.requests.count} network request${e.requests.count === 1 ? "" : "s"} (${e.requests.items.join(", ")}${e.requests.count > e.requests.items.length ? ", and more" : ""})`);
  if (e.mutations && !e.outline_changed) items.push(`${e.mutations} change${e.mutations === 1 ? "" : "s"} to the page structure`);
  if (e.new_tab && items.length === 1 && !e.outline_changed) items.push("a new tab opened");
  const seen = items.filter((i) => i !== "the page text and address stayed the same");
  if (!seen.length && !e.new_tab) return NONE;
  return `What the steps did: ${items.join("; ")}. `;
}

// One outcome label for each browser_act result, with one suggested next step. Plain code on the effects the browser service collected, no model call.
// Labels: worked, partly worked, nothing happened, can't tell, blocked. `requested` is the number of steps the model asked for.
export const OUTCOME_LABELS = ["worked", "partly worked", "nothing happened", "can't tell", "blocked"];
export function actOutcome(r, requested) {
  const e = r?.effects, dialogOpen = /^\[open dialog /m.test(String(r?.snapshot || ""));
  const out = (label, next) => ({ label, next });
  if (requested > 0 && r?.completed < requested) return out("partly worked", `only ${r.completed} of ${requested} steps ran, so take a snapshot and do the remaining steps with the refs it lists`);
  if (!e) {
    if (r?.page_changed === true) return out("worked", dialogOpen ? "a dialog is open, so act inside it first" : "check the page below, then carry on");
    if (r?.page_changed === false) return out(dialogOpen ? "blocked" : "nothing happened", dialogOpen ? "a dialog is open, so act inside it or close it first" : "nothing on the page responded to the steps, so take a snapshot and try a different element");
    return out("can't tell", "take a snapshot to see the page");
  }
  const dls = e.downloads || [];
  if (dls.some((d) => d.state !== "completed" && d.state !== "in_progress")) return out("blocked", "the download was cancelled or failed, so try the link again or look for another way to get the file");
  if (e.popups_blocked?.length && !e.popup_opened_for_you) return out("blocked", "the browser blocked a new window, so look for a normal link to the same page or take a snapshot");
  if (dls.some((d) => d.state === "in_progress")) return out("partly worked", "a download is still running, so wait a little and take a snapshot, then check the downloads folder");
  if (e.file_chooser) return out("partly worked", "the click opened a file chooser, so use the upload step with this ref to attach the file");
  if (r.notes?.some((n) => /does not clearly show|no selected text|not run because/.test(String(n)))) return out("partly worked", "the page may not show the choice yet, so take a snapshot and check the field before moving on");
  // An error the page's own script threw while the steps ran: the steps reached the page and the page failed, so the control may be broken on the page itself.
  if (e.page_errors?.length) return out(e.visible ? "partly worked" : "blocked", "the page reported a JavaScript error while handling the steps, so a control on the page may be broken. Take a snapshot to see what did change, and if the page itself is at fault, tell the person what the page reported instead of repeating the same steps");
  if (e.visible) return out("worked", dialogOpen ? "a dialog is open, so act inside it first" : e.new_tab ? "a new tab is now your current tab, so use the refs below" : e.pdf_saved || dls.length ? "the file is saved, so say where it is or use it" : "check the page below, then carry on");
  if (e.requests || e.mutations) return out("can't tell", "the page sent a request or changed inside, but its text did not change, so take a snapshot and check before saying it worked");
  return out(dialogOpen ? "blocked" : "nothing happened", dialogOpen ? "a dialog is open, so act inside it or close it first" : "nothing on the page responded to the steps, so take a snapshot and try a different element");
}
export const describeOutcome = (r, requested) => { const o = actOutcome(r, requested); return `Outcome: ${o.label}. Suggested next step: ${o.next}. `; };
