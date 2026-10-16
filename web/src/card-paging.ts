// Inline Messages cards use tap pages; full browser pages keep document scroll.
// Hide original DOM units between pages so values and action bindings survive.
export function cardPaging(content: HTMLElement, pager: HTMLElement) {
  const prev = pager.querySelector<HTMLButtonElement>('[data-cprev]')!;
  const next = pager.querySelector<HTMLButtonElement>('[data-cnext]')!;
  const label = pager.querySelector<HTMLElement>('[data-cposition]')!;
  const note = document.getElementById('cnote')!;
  const home = note.parentElement!;
  const center = label.parentElement!;
  type Page = { units: HTMLElement[]; offset: number };
  let pages: Page[] = [], page = 0, frame = 0, compact = false;
  let units: HTMLElement[] = [], groups: HTMLElement[] = [];
  const observed = new Set<Element>();
  function show(selected: HTMLElement[]) {
    for (const el of units) el.toggleAttribute('data-cpage-hidden', !selected.includes(el));
    for (const el of groups) el.toggleAttribute('data-cpage-hidden', !selected.some(unit => el.contains(unit)));
  }
  function paint() {
    const current = pages[page];
    if (current) { show(current.units); content.scrollTop = current.offset; }
    prev.disabled = page <= 0; next.disabled = page >= pages.length - 1;
    label.replaceChildren();
    if (pages.length > 1) for (const text of [String(page + 1), 'of', String(pages.length)]) {
      const part = document.createElement('span'); part.textContent = text; label.append(part);
    }
    label.setAttribute('aria-label', `Page ${page + 1} of ${pages.length}`);
    content.dataset.more = String(!!current && current.offset + content.clientHeight < content.scrollHeight - 1);
  }
  function refresh() {
    frame = 0;
    const focused = document.activeElement as HTMLElement | null;
    const typing = !!focused && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName);
    if (!typing) compact = innerHeight <= 420;
    document.body.classList.toggle('compact', compact);
    for (const el of content.querySelectorAll('[data-cpage-hidden]')) el.removeAttribute('data-cpage-hidden');
    content.scrollTop = 0;
    units = []; groups = [];
    for (const el of observed) if (el.parentElement !== content) { resize.unobserve(el); observed.delete(el); }
    for (const el of content.children) if (!observed.has(el)) { observed.add(el); resize.observe(el); }
    if (!compact) { pager.hidden = true; pages = []; page = 0; if (note.parentElement !== home) home.append(note); return; }
    // The feedback replaces the page label in an already reserved navigation
    // row, so accepting an answer cannot make the card gain another page.
    pager.hidden = true;
    if (note.parentElement !== home) home.append(note);
    if (content.scrollHeight <= content.clientHeight + 1) { pages = []; page = 0; label.replaceChildren(); return; }
    pager.hidden = false;
    if (note.parentElement !== center) center.append(note);
    const height = content.clientHeight;
    const first = content.firstElementChild as HTMLElement | null;
    const stack = content.querySelector<HTMLElement>('.gu-stack') || (first?.matches('.gu-reply') ? first : content);
    const children = [...stack.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
    if (!children.length && stack !== content) children.push(stack);
    for (const el of children) {
      if (el.getBoundingClientRect().height > height && el.children.length > 1 && el.matches('.gu-rows,.gu-form,.gu-opts,.gu-sys,.gu-plan,.ivc')) {
        groups.push(el); units.push(...[...el.children].filter((n): n is HTMLElement => n instanceof HTMLElement));
      } else units.push(el);
    }
    const old = pages[page]?.units[0];
    pages = []; let current: HTMLElement[] = [];
    for (const unit of units) {
      show([...current, unit]);
      if (current.length && content.scrollHeight > height + 1) { pages.push({ units: current, offset: 0 }); current = []; show([unit]); }
      if (content.scrollHeight > height + 1) {
        const end = content.scrollHeight - height, step = Math.max(16, height - 16);
        for (let at = 0; ; at = Math.min(end, at + step)) { pages.push({ units: [unit], offset: at }); if (at === end) break; }
      } else current.push(unit);
    }
    if (current.length) pages.push({ units: current, offset: 0 });
    page = Math.max(0, pages.findIndex(p => typing && focused ? p.units.some(el => el.contains(focused)) : old && p.units.includes(old)));
    paint();
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
  const go = (delta: number) => { page = Math.max(0, Math.min(pages.length - 1, page + delta)); paint(); };
  prev.addEventListener('click', () => go(-1)); next.addEventListener('click', () => go(1));
  content.addEventListener('focusin', e => {
    const el = e.target as HTMLElement, found = pages.findIndex(p => p.units.some(unit => unit.contains(el)));
    if (found >= 0 && found !== page) { page = found; paint(); }
  });
  content.addEventListener('invalid', e => { const el = e.target as HTMLElement, found = pages.findIndex(p => p.units.some(unit => unit.contains(el))); if (found >= 0) { page = found; paint(); } }, true);
  const resize = new ResizeObserver(schedule);
  resize.observe(content); resize.observe(content.parentElement!);
  new MutationObserver(schedule).observe(content, { childList: true, subtree: true, characterData: true });
  content.addEventListener('load', schedule, true); content.addEventListener('toggle', schedule, true); content.addEventListener('focusout', schedule);
  document.fonts?.ready.then(schedule); document.fonts?.addEventListener('loadingdone', schedule);
  window.addEventListener('resize', schedule); schedule();
  return schedule;
}
