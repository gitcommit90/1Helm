// The Sandbox view in the browser (HTML: sandboxInner in models-console-core.js; server: src/sandbox.js). It loads the jobs, fills the input with a job's real request,
// keeps the person's edits and attachments, sends, and shows the reply. Nothing is saved anywhere: the chat lives in ui.sb and goes away with the page.
// Only #sb-root is redrawn, and never while typing, so a text box keeps its focus and selection.
import * as C from "./models-console-core.js";

const FILES_MAX = 20 * 1024 * 1024;
const $ = (s, r) => (r || document).querySelector(s);
const PH = /"\$file"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const namesIn = (v) => { const out = []; for (const m of JSON.stringify(v ?? null).matchAll(PH)) { const n = JSON.parse('"' + m[1] + '"'); if (!out.includes(n)) out.push(n); } return out; };
const isPh = (v) => !!v && typeof v === "object" && !Array.isArray(v) && typeof v.$file === "string";
const mapPh = (v, fn) => (isPh(v) ? fn(v) : Array.isArray(v) ? v.map((x) => mapPh(x, fn)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapPh(x, fn)])) : v);
const textOf = (v) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

// ---- the input: a chat request as labeled blocks, anything else as editable JSON ----
export function draftOf(request) {
  if (!Array.isArray(request.messages)) return { shape: "fields", json: JSON.stringify(request, null, 2) };
  const { messages, ...rest } = request;
  const blocks = messages.map((m) => {
    const { role, content, ...extra } = m, parts = [];
    if (Array.isArray(content)) for (const el of content) {
      const files = namesIn(el);
      if (el && el.type === "text" && typeof el.text === "string" && !files.length) parts.push({ t: "text", text: el.text, el });
      else parts.push({ t: "raw", value: el, files });
    } else parts.push({ t: "text", text: textOf(content) });
    if (!parts.length) parts.push({ t: "text", text: "" });
    return { role, extra, parts, plain: !Array.isArray(content), wasNull: content == null };
  });
  return { shape: "chat", rest, blocks };
}
export function requestOf(d) {
  if (d.shape === "fields") return JSON.parse(d.json);
  const messages = d.blocks.map((b) => {
    const allText = b.parts.every((p) => p.t === "text");
    const content = b.plain && allText ? (() => { const t = b.parts.map((p) => p.text).join("\n"); return b.wasNull && t === "" ? null : t; })()
      : b.parts.filter((p) => p.t !== "text" || p.text !== "" || b.parts.length === 1).map((p) => (p.t === "text" ? { ...(p.el || { type: "text" }), text: p.text } : p.value));
    return { ...b.extra, role: b.role, content };
  });
  return { ...d.rest, messages };
}

export function initSandbox({ app, getState, ui, api, toast, openPicker }) {
  const sb = () => (ui.sb ||= { jobs: null, job: null, model: null, draft: null, turns: [], files: {}, history: [], extra: [], busy: false, pending: 0, base: null, seq: 0 });
  const redraw = (stick) => {
    const root = $("#sb-root"); if (!root) return;
    const chat = $("[data-sb-chat]", root), top = chat ? chat.scrollTop : 0, inn = $(".sb-in", root), itop = inn ? inn.scrollTop : 0;
    root.innerHTML = C.sandboxInner(getState(), sb()).toString();
    const c2 = $("[data-sb-chat]", root); if (c2) c2.scrollTop = stick ? c2.scrollHeight : top;
    const i2 = $(".sb-in", root); if (i2) i2.scrollTop = itop;
  };
  const fileTotal = () => Object.values(sb().files).reduce((a, f) => a + (f.size || 0), 0);

  async function enter() {
    const s = sb();
    if (s.jobs) return;
    const r = await api("GET", "/models/api/sandbox/jobs");
    if (r.ok) { s.jobs = r.data.jobs; redraw(); } else toast(r.data.error || "The job list could not be loaded.");
  }
  async function pickJob(id) {
    const s = sb(), mine = ++s.seq;
    Object.assign(s, { job: id, model: null, effort: undefined, draft: null, turns: [], files: {}, history: [], extra: [], busy: false, pending: 0, base: null, gold: null }); redraw();
    const r = await api("GET", "/models/api/sandbox/sample?job=" + encodeURIComponent(id));
    if (mine !== s.seq) return;
    if (!r.ok) { toast(r.data.error || "The sample could not be loaded."); return; }
    for (const f of r.data.files) s.files[f.name] = { name: f.name, type: f.type, source: "fixture", path: f.path, size: f.size };
    s.draft = draftOf(r.data.request);
    if (r.data.golden) s.gold = { data: r.data.golden, edit: JSON.parse(JSON.stringify(r.data.golden.golden)), open: false, busy: false };
    redraw();
  }

  // ---- golden answers: the fields edit a working copy, the scores under the replies follow it, Save stores it for the job, Reset returns to the sample's own ----
  const redrawChat = () => {
    const root = $("#sb-root"), chat = root && $("[data-sb-chat]", root); if (!chat) return;
    const top = chat.scrollTop, wrap = document.createElement("div"); wrap.innerHTML = C.sandboxChat(getState(), sb()).toString();
    chat.replaceWith(wrap.firstElementChild); $("[data-sb-chat]", root).scrollTop = top;
  };
  const syncGoldButtons = () => {
    const g = sb().gold, dirty = C.goldDirty(g), save = $("[data-sb-gact=save]", app), reset = $("[data-sb-gact=reset]", app);
    if (save) save.disabled = !dirty || g.busy; if (reset) reset.disabled = !g.data.saved && !dirty;
  };
  function goldInput(t) {
    const g = sb().gold, e = g && g.edit; if (!e) return;
    const k = t.dataset;
    if (k.g === "c") e.value[k.k] = t.value;
    else if (k.g === "i") e.value[+k.r][k.f] = t.value;
    else if (k.g === "p") e.value[+k.i] = t.value;
    else if (k.g === "t") e.value = t.value;
    else if (k.g === "x") { const own = g.data.golden; if (t.checked === (own.extras_fail !== false)) { if (own.extras_fail === undefined) delete e.extras_fail; else e.extras_fail = own.extras_fail; } else e.extras_fail = t.checked; }
    else if (k.g === "w") { const n = Number(t.value); if (t.value !== "" && Number.isFinite(n)) e.max_wer = Math.min(100, Math.max(0, n)) / 100; }
    redrawChat(); syncGoldButtons();
  }
  async function goldAct(a, el) {
    const s = sb(), g = s.gold; if (!g) return;
    if (a === "toggle") { g.open = !g.open; redraw(); return; }
    if (a === "addrow") { if (g.edit.type === "items") g.edit.value.push(Object.fromEntries((g.edit.match || []).map((f) => [f, ""]))); else g.edit.value.push(""); redraw(); redrawChat(); return; }
    if (a === "rmrow") { g.edit.value.splice(+el.dataset.r, 1); redraw(); return; }
    if (g.busy) return;
    const e = g.edit, mine = s.seq;
    const golden = a === "reset" ? null : { value: e.type === "items" ? e.value.filter((r) => Object.values(r).some((x) => String(x ?? "").trim())) : e.type === "contains" ? e.value.filter((x) => x.trim()) : e.value, ...(e.type === "text" && e.max_wer !== undefined ? { max_wer: e.max_wer } : {}), ...(e.type === "items" && typeof e.extras_fail === "boolean" ? { extras_fail: e.extras_fail } : {}) };
    g.busy = true; syncGoldButtons();
    const r = await api("POST", "/models/api/sandbox/golden", { job: s.job, golden });
    if (mine !== s.seq) return;
    g.busy = false;
    if (!r.ok) { toast(r.data.error || "The golden answers could not be saved."); syncGoldButtons(); return; }
    g.data = { golden: r.data.golden, default: r.data.default, saved: r.data.saved }; g.edit = JSON.parse(JSON.stringify(r.data.golden));
    redraw(); redrawChat();
  }

  // ---- files ----
  const readB64 = (file) => new Promise((ok, no) => { const fr = new FileReader(); fr.onerror = () => no(new Error("A file could not be read.")); fr.onload = () => ok(String(fr.result).split(",")[1] || ""); fr.readAsDataURL(file); });
  const uniqueName = (name) => { const s = sb(); if (!s.files[name]) return name; const dot = name.lastIndexOf("."), a = dot > 0 ? name.slice(0, dot) : name, b = dot > 0 ? name.slice(dot) : ""; let n = 2; while (s.files[`${a} (${n})${b}`]) n++; return `${a} (${n})${b}`; };
  function place(name, type) {
    const d = sb().draft, ref = (as) => ({ $file: name, as });
    if (d.shape === "fields") {
      let obj; try { obj = JSON.parse(d.json); } catch { toast("The request is not valid JSON, so the file cannot be placed."); return false; }
      let hit = false; const next = mapPh(obj, (p) => { if (hit) return p; hit = true; return { ...p, $file: name }; });
      if (!hit) { toast("This request has no place for a file."); return false; }
      d.json = JSON.stringify(next, null, 2); return true;
    }
    const ext = (name.split(".").pop() || "").toLowerCase();
    const part = /^image\//.test(type) ? { type: "image_url", image_url: { url: ref("data_url") } }
      : /^audio\//.test(type) ? { type: "input_audio", input_audio: { data: ref("base64"), format: ext === "mp3" ? "mp3" : ext || type.split("/")[1] } }
      : type === "application/pdf" ? { type: "file", file: { filename: name, file_data: ref("data_url") } } : null;
    if (!part) { toast("Add a picture, a PDF or an audio file."); return false; }
    const b = [...d.blocks].reverse().find((x) => x.role === "user") || d.blocks[d.blocks.length - 1];
    b.parts.push({ t: "raw", value: part, files: [name] }); return true;
  }
  async function attach(list) {
    const s = sb(); if (!s.draft) return;
    for (const file of list) {
      if (fileTotal() + file.size > FILES_MAX) { toast("Files are limited to 20 MB in total. Remove a file and try again."); break; }
      let data; try { data = await readB64(file); } catch (e) { toast(e.message); break; }
      const name = uniqueName(file.name), type = file.type || "application/octet-stream";
      const prev = s.files[name]; s.files[name] = { name, type, source: "upload", data, size: file.size };
      if (!place(name, type)) { if (!prev) delete s.files[name]; break; }
    }
    redraw();
  }
  function removeChip(key) {
    const d = sb().draft;
    if (d.shape === "fields") {
      let obj; try { obj = JSON.parse(d.json); } catch { toast("The request is not valid JSON."); return; }
      d.json = JSON.stringify(mapPh(obj, (p) => (p.$file === key ? null : p)), null, 2);
    } else { const [bi, pi] = key.split(".").map(Number), b = d.blocks[bi]; b.parts.splice(pi, 1); if (!b.parts.some((p) => p.t === "text")) b.parts.unshift({ t: "text", text: "" }); }
    redraw();
  }

  // ---- send ----
  function shownTurns(d, followUp) {
    const files = (names) => names.map((n) => ({ name: n, size: sb().files[n] ? sb().files[n].size : null }));
    if (d.shape === "fields") { let t = d.json; try { t = JSON.stringify(JSON.parse(d.json)); } catch { /* shown as typed */ } return [{ role: "request", text: t.length > 400 ? t.slice(0, 400) + "..." : t, files: files(namesIn((() => { try { return JSON.parse(d.json); } catch { return null; } })())) }]; }
    const blocks = followUp ? d.blocks.slice(-1) : d.blocks;
    return blocks.map((b) => ({ role: b.role, text: b.parts.filter((p) => p.t === "text").map((p) => p.text).join("\n"), files: files(b.parts.filter((p) => p.t === "raw").flatMap((p) => p.files)) }));
  }
  // Every slot gets the same edited input as its own POST. A slot's follow-up carries its own conversation; a slot with none yet starts from the first request.
  async function send() {
    const s = sb(), d = s.draft; if (!d || s.busy || !s.job) return;
    let base;
    try { base = requestOf(d); } catch { toast("The request is not valid JSON."); return; }
    const followUp = d.shape === "chat" && !!s.base, slots = C.slotsOf(s);
    if (followUp) {
      const last = d.blocks[d.blocks.length - 1];
      if (!last.parts.some((p) => (p.t === "text" && p.text.trim()) || p.t === "raw")) return;
    }
    const requestFor = (slot) => (followUp ? { ...base, messages: [...(slot.history.length ? slot.history : s.base), ...base.messages] } : base);
    const reqs = slots.map(requestFor), names = [...new Set(reqs.flatMap(namesIn))];
    const files = names.map((n) => s.files[n]).filter(Boolean).map((f) => (f.source === "upload" ? { name: f.name, type: f.type, source: "upload", data: f.data } : { name: f.name, type: f.type, source: "fixture", path: f.path }));
    const total = names.reduce((a, n) => a + ((s.files[n] && s.files[n].size) || 0), 0);
    if (total > FILES_MAX) { toast("Files are limited to 20 MB in total. Remove a file and try again."); return; }
    const mine = s.seq, added = shownTurns(d, followUp);
    for (const slot of slots) slot.turns.push(...added);
    s.busy = true; s.pending = slots.length; redraw(true);
    await Promise.all(slots.map(async (slot, k) => {
      const request = reqs[k];
      // Nothing changed: the job's saved model and level go out exactly as the real job sends them. A changed model or level sends both.
      const ef = C.sandboxEffort(getState(), slot, s.job), changed = slot.model || slot.effort !== undefined;
      const body = { job: s.job, request, files, ...(changed && (slot.model || ef) ? { model: slot.model ? slot.model.id : ef.saved.model, effort: ef ? ef.value : slot.model.effort ?? null, ...(slot.model && slot.model.facts ? { facts: slot.model.facts } : {}) } : {}) };
      const r = await api("POST", "/models/api/sandbox/send", body);
      if (mine !== s.seq) return;   // another job was chosen meanwhile: its chat stays clean
      if (--s.pending <= 0) s.busy = false;
      const reply = r.data && r.data.ok !== undefined ? r.data : { ok: false, error: (r.data && r.data.error) || "Check your connection and try again.", raw_request: null };
      if (!reply.ok) { const at = slot.turns.indexOf(added[0]); if (at >= 0) slot.turns.splice(at, added.length); }
      slot.turns.push({ role: "reply", reply });
      if (reply.ok && d.shape === "chat" && reply.view && reply.view.type === "chat") {
        const text = reply.view.text || (reply.view.tool_calls || []).map((t) => `Tool call ${t.name}: ${JSON.stringify(t.arguments)}`).join("\n");
        slot.history = [...request.messages, { role: "assistant", content: text }];
        if (s.draft === d) { s.base ||= base.messages; s.draft = { shape: "chat", rest: d.rest, blocks: [{ role: "user", extra: {}, plain: true, wasNull: false, parts: [{ t: "text", text: "" }] }] }; }
      }
      redraw(true);
    }));
  }

  // ---- the model menu ----
  function chooseModel(k) {
    const s = sb(), slot = C.slotsOf(s)[k] || s, st = getState(), id = s.job, cat = id.startsWith("chat:");
    const jv = cat ? null : st.jobs.find((j) => j.id === id), c = cat ? st.config.routing.categories.find((x) => x.id === id.slice(5)) : null;
    if (!cat && !jv) return;
    const tg = { key: id, kind: cat ? "cat" : "job", jv, level: "unrestricted", idx: 0, free: true, row: cat ? { kind: "cat", id: c.id, cat: c, jv: null, label: c.title } : { kind: "job", id, jv, label: jv.label },
      onPick: ({ entry, meta }) => { slot.effort = undefined; slot.model = { id: entry.model, effort: entry.effort, efforts: meta.efforts || [], def: meta.default_effort ?? null, source: meta.source, name: meta.name || null, ...(st.config.catalog[entry.model] ? {} : { facts: meta }) }; redraw(); } };
    openPicker(tg, "Choose a model for this send");
  }

  // ---- events ----
  app.addEventListener("click", (e) => {
    const t = e.target, slotOf = (el) => C.slotsOf(sb())[+el.dataset.slot || 0], turnOf = (key) => { const [k, i] = String(key).split(".").map(Number), sl = C.slotsOf(sb())[k]; return sl && sl.turns[i]; }, jobBtn = t.closest("[data-sb-job]"), act = t.closest("[data-sb-act]"), raw = t.closest("[data-sb-raw]"), rm = t.closest("[data-sb-remove]"), js = t.closest("[data-sb-json]"), ga = t.closest("[data-sb-gact]");
    if (ga) goldAct(ga.dataset.sbGact, ga);
    else if (jobBtn) pickJob(jobBtn.dataset.sbJob);
    else if (rm) removeChip(rm.dataset.sbRemove);
    else if (js) { const turn = turnOf(js.dataset.sbJson); if (turn) { turn.json = !turn.json; redraw(); } }
    else if (raw) { const turn = turnOf(raw.dataset.sbRaw); if (turn) { turn.raw = !turn.raw; redraw(); } }
    else if (act) {
      const a = act.dataset.sbAct;
      if (a === "send") send();
      else if (a === "attach") $("[data-sb-file]", app).click();
      else if (a === "model") chooseModel(+act.dataset.slot || 0);
      else if (a === "modelreset") { const sl = slotOf(act); sl.model = null; sl.effort = undefined; redraw(); }
      else if (a === "addslot") { const s = sb(); if (C.slotsOf(s).length < C.SLOTS_MAX) { (s.extra ||= []).push(C.newSlot()); redraw(); } }
      else if (a === "rmslot") { const k = +act.dataset.slot; if (k > 0) { sb().extra.splice(k - 1, 1); redraw(); } }
    }
  });
  app.addEventListener("input", (e) => {
    const t = e.target, d = sb().draft;
    if (t.dataset && t.dataset.g !== undefined) { goldInput(t); return; }
    if (!d) return;
    if (t.dataset.sbText !== undefined) d.blocks[+t.dataset.b].parts[+t.dataset.p].text = t.value;
    else if (t.dataset.sbJson !== undefined) d.json = t.value;
  });
  app.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.sbEffort !== undefined) { C.slotsOf(sb())[+t.dataset.slot || 0].effort = t.value; redraw(); }
    else if (t.dataset.sbSelect !== undefined) { if (t.value) pickJob(t.value); }
    else if (t.dataset.sbFile !== undefined) { const list = Array.from(t.files || []); t.value = ""; attach(list); }
  });
  app.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target.closest && e.target.closest(".sb-ta")) { e.preventDefault(); send(); } });
  return { enter, redraw };
}
