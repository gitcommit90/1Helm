import { unsavedKind } from "../unsaved";
export function createAmbientCue({ LIVE, BOOT, shown, sRender, esc, helper, note, ic }: { LIVE: {api:string} | null; BOOT:any; shown:()=>boolean; sRender:()=>void; esc:(v:any)=>string; helper:()=>string; note:(...args:any[])=>void; ic:{check:string} }) {
// Optional relevance hints: never wake words or execution consent.
const ACUE = { loaded: false, busy: false, error: "", conflict: false, revision: 0, generation: 0, enabled: false, draft: "", savedEnabled: false, savedDraft: "" };
const acueDirty = () => ACUE.enabled !== ACUE.savedEnabled || ACUE.draft !== ACUE.savedDraft;
function acuePaint() { if (shown()) sRender(); }
async function acueApi(body?: any) {
  const r = await fetch(`${LIVE!.api}/ambient/settings`, { credentials: "same-origin", ...(body ? { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e: any = new Error(d.error || "Couldn't load ambient settings."); e.conflict = r.status === 409; throw e; }
  return d;
}
function acueAccept(d: any) {
  ACUE.revision = d.revision; ACUE.generation++; ACUE.enabled = ACUE.savedEnabled = !!d.enabled;
  ACUE.draft = ACUE.savedDraft = (d.phrases || []).join("\n"); ACUE.loaded = true; ACUE.error = ""; ACUE.conflict = false;
}
async function acueLoad() {
  if (ACUE.busy) return; ACUE.busy = true; ACUE.error = "";
  try { acueAccept(LIVE ? await acueApi() : { enabled: false, phrases: [], revision: 0 }); }
  catch (e: any) { ACUE.error = e.message; }
  finally { ACUE.busy = false; acuePaint(); }
}
function acueSec() {
  if (!ACUE.loaded && !ACUE.busy && !ACUE.error) void acueLoad();
  const locked = ACUE.busy || !ACUE.loaded || !!BOOT?.look;
  return `<h3>Relevance phrases <span class="h3n">Optional</span></h3>
    <form class="sc sform acue" id="acuef" data-unsaved="ambient-cue" data-unsaved-key="${ACUE.revision}:${ACUE.generation}">
      <p>A phrase can help ${esc(helper())} notice nearby thoughts, just before or after you say it. All speech still gets processed, with or without it.</p>
      <label class="acue-enable"><input id="acue-enabled" type="checkbox"${ACUE.enabled ? " checked" : ""}${locked ? " disabled" : ""}><span>Use my relevance phrases</span></label>
      <label class="sf"><span>Your phrases</span><textarea id="acue-phrases" rows="3" maxlength="648" placeholder="${esc(`Hey ${helper()}`)}" aria-describedby="acue-help"${locked ? " disabled" : ""}>${esc(ACUE.draft)}</textarea></label>
      <p id="acue-help" class="sfine">One phrase per line, up to 8. Each can be up to 80 characters. Turning this off keeps your phrases saved.</p>
      <p class="sfine">This is not a real-time wake word. Saying a phrase does not send messages, schedule reminders, or authorize actions. Saved changes apply to speech not yet processed; earlier results are not reprocessed.</p>
      <p class="acue-message" role="status">${esc(ACUE.error || (ACUE.busy ? "Loading or saving…" : ""))}</p>
      <div class="sbtns"><button type="submit" class="sprim"${locked || ACUE.conflict ? " disabled" : ""}>${ACUE.busy ? "Saving…" : "Save phrases"}</button><button type="button" class="sa" data-acue-clear${locked || ACUE.conflict ? " disabled" : ""}>Clear phrases</button>${ACUE.error ? `<button type="button" class="sa" data-acue-reload${ACUE.busy ? " disabled" : ""}>${ACUE.loaded ? "Reload saved settings" : "Try again"}</button>` : ""}</div>${ACUE.error && ACUE.loaded ? '<p class="sfine">Reloading replaces your unsaved draft with the saved settings.</p>' : ""}
    </form>`;
}
async function acueSave(clear = false) {
  if (ACUE.busy || !ACUE.loaded || ACUE.conflict || BOOT?.look) return;
  const phrases = clear ? [] : ACUE.draft.split("\n").map(s => s.normalize("NFKC").trim().replace(/\s+/g, " ")).filter(Boolean);
  const enabled = clear ? false : ACUE.enabled;
  if (phrases.length > 8 || phrases.some(s => s.length > 80 || /[\u0000-\u001f\u007f]/.test(s)) || (enabled && !phrases.length)) {
    ACUE.error = "Add 1–8 phrases to turn this on, with no more than 80 characters each."; acuePaint(); return;
  }
  ACUE.busy = true; ACUE.error = ""; acuePaint();
  try { acueAccept(LIVE ? await acueApi({ enabled, phrases, revision: ACUE.revision }) : { enabled, phrases, revision: ACUE.revision + 1 }); note(ic.check, clear ? "Phrases cleared" : "Ambient phrases saved", "Applies to speech not yet processed. No automatic actions.", ""); }
  catch (e: any) { ACUE.error = e.message; ACUE.conflict = !!e.conflict; }
  finally { ACUE.busy = false; acuePaint(); }
}
document.addEventListener("input", e => { const el = e.target as HTMLInputElement; if (el.id === "acue-phrases") ACUE.draft = el.value; if (el.id === "acue-enabled") ACUE.enabled = el.checked; });
document.addEventListener("submit", e => { if ((e.target as HTMLElement).id !== "acuef") return; e.preventDefault(); e.stopImmediatePropagation(); void acueSave(); }, true);
document.addEventListener("click", e => { const el = e.target as Element; if (el.closest("[data-acue-clear]")) void acueSave(true); if (el.closest("[data-acue-reload]")) void acueLoad(); });
unsavedKind("ambient-cue", { hash: false, leave: "[data-sgo],[data-sclose],[data-apps]", active: () => shown() && acueDirty(), busy: () => ACUE.busy,
  title: () => "Save ambient phrases?", state: el => JSON.stringify([(el.querySelector("#acue-enabled") as HTMLInputElement)?.checked, (el.querySelector("#acue-phrases") as HTMLTextAreaElement)?.value]),
  discard: () => { ACUE.generation++; ACUE.enabled = ACUE.savedEnabled; ACUE.draft = ACUE.savedDraft; acuePaint(); } });
return acueSec;
}
