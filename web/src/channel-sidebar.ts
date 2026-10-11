// Desktop channel navigation only. Never rerender the composer when changing layout.
const DEFAULT = 272, MIN = 240, MAX = 480;
let key = '', preferred = DEFAULT, collapsed = false, ready = false;
let handle: HTMLDivElement;
let drag: { id: number; x: number; width: number; preferred: number } | null = null;
const desktop = () => innerWidth >= 768;
const autoHidden = () => document.body.classList.contains('pc-on') && innerWidth < 1440;
const limit = () => Math.floor(Math.max(MIN, Math.min(MAX, innerWidth - 80 - 380 - 20 -
  (document.body.classList.contains('pc-on') ? Math.max(420, innerWidth * .46) : 0))));
const width = () => Math.round(Math.max(MIN, Math.min(limit(), preferred)));
const icon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m6-12-3 4 3 4"/></svg>`;
export const sidebarCollapseButton = () => `<button type="button" class="sidebar-collapse" data-sidebar-collapse aria-label="Hide channel sidebar" title="Hide channel sidebar" aria-controls="side" aria-expanded="true">${icon}</button>`;
export const sidebarRestoreButton = () => `<button type="button" class="sidebar-restore" data-sidebar-restore aria-label="Show channel sidebar" title="Show channel sidebar" aria-controls="side" aria-expanded="false" hidden>${icon}<span>Sidebar</span></button>`;
function save() { try { localStorage.setItem(key, JSON.stringify({ width: preferred, collapsed })); } catch { /* Private browsing/storage quota: layout still works. */ } }
export function sidebarSync() {
  if (!ready) return;
  const active = desktop(), unavailable = !active || autoHidden(), hidden = unavailable || collapsed, w = width();
  document.body.style.setProperty('--channel-sidebar-width', `${collapsed ? 0 : w}px`);
  document.body.classList.toggle('sidebar-collapsed', active && collapsed);
  const side = document.getElementById('side');
  if (side) { side.inert = hidden; if (hidden) side.setAttribute('aria-hidden', 'true'); else side.removeAttribute('aria-hidden'); }
  handle.hidden = hidden; handle.style.left = `${80 + w - 6}px`;
  handle.setAttribute('aria-valuemin', String(MIN)); handle.setAttribute('aria-valuemax', String(Math.floor(limit())));
  handle.setAttribute('aria-valuenow', String(w)); handle.setAttribute('aria-valuetext', `${w} pixels`);
  document.querySelectorAll<HTMLButtonElement>('[data-sidebar-restore]').forEach(b => { b.hidden = unavailable || !collapsed; });
}
function setCollapsed(next: boolean, focus = false) {
  if (!desktop() || autoHidden()) return;
  finishDrag(false); collapsed = next; save(); sidebarSync();
  if (focus) document.querySelector<HTMLElement>(next ? '[data-sidebar-restore]' : '[data-sidebar-collapse]')?.focus();
}
export function sidebarReveal() { if (collapsed) setCollapsed(false); }
function finishDrag(commit: boolean) {
  if (!drag) return;
  const old = drag; drag = null;
  if (!commit) preferred = old.preferred;
  if (handle.hasPointerCapture(old.id)) handle.releasePointerCapture(old.id);
  document.body.classList.remove('sidebar-resizing');
  if (commit) save(); sidebarSync();
}
export function sidebarInit(workspace: string) {
  if (ready) return;
  key = `1hc.channel-sidebar.v1:${workspace}`;
  try { const data = JSON.parse(localStorage.getItem(key) || 'null');
    if (typeof data?.width === 'number' && Number.isFinite(data.width)) preferred = Math.max(MIN, Math.min(MAX, data.width));
    collapsed = data?.collapsed === true;
  } catch { /* Ignore invalid or unavailable preferences. */ }
  handle = document.createElement('div'); handle.id = 'channel-sidebar-resize'; handle.tabIndex = 0;
  handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-controls', 'side'); handle.setAttribute('aria-label', 'Resize channel sidebar');
  handle.title = 'Drag to resize. Arrow keys resize; Enter hides; double-click resets width.';
  document.body.append(handle); ready = true;
  document.addEventListener('click', e => {
    const target = (e.target as Element).closest?.('[data-sidebar-collapse],[data-sidebar-restore]');
    if (!target) return; e.preventDefault(); setCollapsed(target.hasAttribute('data-sidebar-collapse'), true);
  });
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary || !desktop() || collapsed || autoHidden()) return;
    e.preventDefault(); handle.focus(); drag = { id: e.pointerId, x: e.clientX, width: width(), preferred };
    handle.setPointerCapture(e.pointerId); document.body.classList.add('sidebar-resizing');
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    preferred = Math.max(MIN, Math.min(limit(), drag.width + e.clientX - drag.x)); sidebarSync();
  });
  handle.addEventListener('pointerup', e => { if (drag?.id === e.pointerId) finishDrag(true); });
  handle.addEventListener('pointercancel', () => finishDrag(false));
  handle.addEventListener('lostpointercapture', () => finishDrag(false));
  handle.addEventListener('dblclick', () => { preferred = DEFAULT; save(); sidebarSync(); });
  handle.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drag) { e.preventDefault(); finishDrag(false); return; }
    if (e.key === 'Enter') { e.preventDefault(); setCollapsed(true, true); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); preferred = e.key === 'Home' ? MIN : e.key === 'End' ? limit() :
      Math.max(MIN, Math.min(limit(), width() + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 32 : 16)));
    save(); sidebarSync();
  });
  window.addEventListener('blur', () => finishDrag(false));
  window.addEventListener('resize', () => { finishDrag(false); sidebarSync(); });
  let pc = document.body.classList.contains('pc-on');
  new MutationObserver(() => { const next = document.body.classList.contains('pc-on'); if (next !== pc) { pc = next; finishDrag(false); sidebarSync(); } })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  sidebarSync();
}
