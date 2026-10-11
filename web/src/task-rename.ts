// A task-name editor, not a browser prompt. Modal/inert behavior and focus stay native;
// the app's existing dialog styles keep it consistent with other confirmations.
let current: HTMLDialogElement | null = null;
export function openTaskRename(title: string, save: (title: string) => Promise<void>, focusBack?: () => void) {
  if (current) return;
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog"); current = dialog;
  dialog.className = "task-rename dlg"; dialog.id = "task-rename";
  dialog.setAttribute("aria-labelledby", "task-rename-heading");
  dialog.setAttribute("aria-describedby", "task-rename-help");
  dialog.innerHTML = `<form novalidate><span class="dlggrab" aria-hidden="true"></span><h2 id="task-rename-heading">Rename task</h2>
    <p id="task-rename-help">Choose a name that makes sense to you.</p>
    <label class="dlgtype" for="task-rename-input">Task name</label><input class="dlgin" id="task-rename-input" type="text" maxlength="120" autocomplete="off" enterkeyhint="done" aria-describedby="task-rename-limit task-rename-error">
    <p id="task-rename-limit" class="rename-limit">Up to 120 characters.</p><p id="task-rename-error" class="dlgerr" role="alert" hidden></p>
    <div class="dlgbtns"><button type="button" class="dlgb no" data-rename-cancel>Cancel</button><button type="submit" class="dlgb ok" data-rename-save>Save</button></div></form>`;
  const input = dialog.querySelector<HTMLInputElement>("input")!, ok = dialog.querySelector<HTMLButtonElement>("[data-rename-save]")!, cancel = dialog.querySelector<HTMLButtonElement>("[data-rename-cancel]")!, error = dialog.querySelector<HTMLElement>(".dlgerr")!;
  input.value = title;
  let busy = false;
  const valid = () => !!input.value.trim() && input.value.trim().length <= 120 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(input.value.trim());
  const sync = () => { ok.disabled = busy || !valid(); };
  const close = () => { if (busy) return; dialog.close(); dialog.remove(); current = null; if (focusBack) focusBack(); else if (previous?.isConnected && previous !== document.body) previous.focus({ preventScroll: true }); };
  cancel.onclick = close;
  dialog.addEventListener("cancel", e => { e.preventDefault(); close(); });
  input.addEventListener("input", () => { error.hidden = true; input.removeAttribute("aria-invalid"); sync(); });
  dialog.querySelector("form")!.onsubmit = async e => {
    e.preventDefault(); e.stopPropagation(); if (busy || !valid()) return;
    busy = true; sync(); cancel.disabled = true; input.readOnly = true; ok.textContent = "Saving…"; dialog.setAttribute("aria-busy", "true"); error.hidden = true;
    try { await save(input.value.trim()); busy = false; close(); }
    catch (e) { busy = false; cancel.disabled = false; input.readOnly = false; ok.textContent = "Save"; dialog.removeAttribute("aria-busy"); error.textContent = e instanceof Error ? e.message : "Couldn't save the name. Try again."; error.hidden = false; input.setAttribute("aria-invalid", "true"); sync(); input.focus(); }
  };
  // These capture handlers were registered before the app shortcuts by the import order.
  document.body.appendChild(dialog); sync(); dialog.showModal(); input.focus(); input.select();
}
window.addEventListener("keydown", e => {
  if (!current) return;
  e.stopImmediatePropagation();
  if (e.key === "Escape") { e.preventDefault(); current.querySelector<HTMLButtonElement>("[data-rename-cancel]")?.click(); }
  else if (e.key === "Tab") {
    const items = [...current.querySelectorAll<HTMLElement>("input,button:not(:disabled)")], index = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault(); items[(index + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus();
  }
}, true);
window.addEventListener("keyup", e => { if (current) e.stopImmediatePropagation(); }, true);
