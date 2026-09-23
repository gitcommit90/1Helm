/** Reconcile a mounted container without disconnecting retained interactive
 * children. A control removed between pointerdown and pointerup loses click. */
function reconcileChildren(mounted: HTMLElement, next: HTMLElement, retained = new Map<Node, Node>()): void {
  // Replace ordinary siblings in place rather than inserting every desired node
  // before the first stale child. The latter moved retained <details> elements
  // within their parent on every live tick; browsers preserve `open` but reset
  // a nested overflow scroller to zero when its ancestor is moved.
  const retainedNodes = new Set(retained.values());
  let cursor = mounted.firstChild;
  for (const candidate of Array.from(next.childNodes)) {
    const desired = retained.get(candidate) || candidate;
    if (desired === cursor) { cursor = cursor.nextSibling; continue; }
    if (desired.parentNode === mounted) {
      // Remove stale, non-retained siblings in front of an already-mounted node.
      while (cursor && cursor !== desired && !retainedNodes.has(cursor)) {
        const stale = cursor; cursor = cursor.nextSibling; stale.remove();
      }
      if (cursor === desired) { cursor = cursor.nextSibling; continue; }
      // A true retained-node reorder is rare; only that case needs a move.
      mounted.insertBefore(desired, cursor);
      continue;
    }
    if (cursor && !retainedNodes.has(cursor)) {
      const stale = cursor; cursor = cursor.nextSibling; stale.replaceWith(desired);
    } else mounted.insertBefore(desired, cursor);
  }
  while (cursor) { const stale = cursor; cursor = cursor.nextSibling; stale.remove(); }
}

/** Update only changed/new work-log cards. Replacing every card on every live
 * tick makes Chromium's nested scroll anchoring walk the viewport upward. */
function patchProgressTimeline(mounted: HTMLElement, next: HTMLElement): void {
  const priorTop = mounted.scrollTop;
  const stick = mounted.scrollHeight - mounted.scrollTop - mounted.clientHeight < 48;
  mounted.className = next.className;
  const current = new Map(Array.from(mounted.children).flatMap((child) => {
    const key = (child as HTMLElement).dataset.progressStep;
    return key ? [[key, child as HTMLElement] as const] : [];
  }));
  const retained = new Set<string>();
  for (const child of Array.from(next.children) as HTMLElement[]) {
    const key = child.dataset.progressStep;
    if (!key) continue;
    retained.add(key);
    const prior = current.get(key);
    if (!prior) mounted.append(child);
    else if (!prior.isEqualNode(child)) prior.replaceWith(child);
  }
  for (const [key, child] of current) if (!retained.has(key)) child.remove();
  // Replacing a running card with its completed form can change its height.
  // Keep the reader's exact inner work-log position, or follow new steps only
  // when they were already at the bottom.
  mounted.scrollTop = stick ? mounted.scrollHeight : Math.min(priorTop, Math.max(0, mounted.scrollHeight - mounted.clientHeight));
}

export function patchLiveMessageRow(current: HTMLElement, next: HTMLElement, bindBodyCollapse: (shell: HTMLElement) => void): void {
  const currentBody = current.querySelector<HTMLElement>('[data-live-slot="body"]');
  const nextBody = next.querySelector<HTMLElement>('[data-live-slot="body"]');
  const currentShell = current.querySelector<HTMLElement>("[data-message-body-shell]");
  const nextShell = next.querySelector<HTMLElement>("[data-message-body-shell]");
  const currentContent = currentShell?.parentElement || null;
  const nextContent = nextShell?.parentElement || null;
  if (currentBody && nextBody) {
    currentBody.className = nextBody.className;
    currentBody.replaceChildren(...Array.from(nextBody.childNodes));
  }

  const currentProgress = current.querySelector<HTMLDetailsElement>("details.agent-progress");
  const nextProgress = next.querySelector<HTMLDetailsElement>("details.agent-progress");
  if (currentProgress && nextProgress) {
    const currentTimeline = currentProgress.querySelector<HTMLElement>(".progress-timeline");
    const nextTimeline = nextProgress.querySelector<HTMLElement>(".progress-timeline");
    if (currentTimeline && nextTimeline) patchProgressTimeline(currentTimeline, nextTimeline);
    const currentSummary = currentProgress.querySelector<HTMLElement>(":scope > summary");
    const nextSummary = nextProgress.querySelector<HTMLElement>(":scope > summary");
    if (currentSummary && nextSummary) {
      currentSummary.className = nextSummary.className;
      currentSummary.replaceChildren(...Array.from(nextSummary.childNodes));
    }
    currentProgress.className = nextProgress.className;
    currentProgress.open = nextProgress.open;
    reconcileChildren(currentProgress, nextProgress, new Map<Node, Node>([
      ...(currentSummary && nextSummary ? [[nextSummary, currentSummary] as [Node, Node]] : []),
      ...(currentTimeline && nextTimeline ? [[nextTimeline, currentTimeline] as [Node, Node]] : []),
    ]));
  }

  if (currentContent && nextContent && currentShell && nextShell) {
    currentContent.className = nextContent.className;
    reconcileChildren(currentContent, nextContent, new Map<Node, Node>([
      [nextShell, currentShell],
      ...(currentProgress && nextProgress ? [[nextProgress, currentProgress] as [Node, Node]] : []),
    ]));
  }
  current.className = next.className;
  for (const name of next.getAttributeNames()) if (name !== "class") current.setAttribute(name, next.getAttribute(name) || "");
  reconcileChildren(current, next, new Map<Node, Node>(currentContent && nextContent ? [[nextContent, currentContent]] : []));
  // The body, shell, toggle, content column, progress disclosure, and timeline
  // remain continuously connected through the patch. Rebind/sync after the new
  // body text is mounted so expanded state never flickers or blocks scrolling.
  if (currentShell) bindBodyCollapse(currentShell);
}
