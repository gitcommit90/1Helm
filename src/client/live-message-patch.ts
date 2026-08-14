/** Keep mounted interactive nodes alive across streamed row updates. A control
 * replaced between pointerdown and pointerup never receives a click. */
function adopt(mounted: HTMLElement, next: HTMLElement): void {
  mounted.className = next.className;
  mounted.replaceChildren(...Array.from(next.childNodes));
  next.replaceWith(mounted);
}

/** Update only changed/new work-log cards. Replacing every card on every live
 * tick makes Chromium's nested scroll anchoring walk the viewport upward. */
function patchProgressTimeline(mounted: HTMLElement, next: HTMLElement): void {
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
}

export function patchLiveMessageRow(current: HTMLElement, next: HTMLElement, bindBodyCollapse: (shell: HTMLElement) => void): void {
  let timelineScroll: { element: HTMLElement; top: number; left: number } | null = null;
  const currentBody = current.querySelector<HTMLElement>('[data-live-slot="body"]');
  const nextBody = next.querySelector<HTMLElement>('[data-live-slot="body"]');
  if (currentBody && nextBody) {
    currentBody.className = nextBody.className;
    currentBody.replaceChildren(...Array.from(nextBody.childNodes));
    if (currentBody.id) nextBody.id = currentBody.id;
    nextBody.replaceWith(currentBody);
  }
  const currentShell = current.querySelector<HTMLElement>("[data-message-body-shell]");
  const nextShell = next.querySelector<HTMLElement>("[data-message-body-shell]");
  if (currentShell && nextShell) {
    const currentToggle = currentShell.querySelector<HTMLElement>("[data-message-body-toggle]");
    const nextToggle = nextShell.querySelector<HTMLElement>("[data-message-body-toggle]");
    if (currentToggle && nextToggle) adopt(currentToggle, nextToggle);
    adopt(currentShell, nextShell);
  }
  const currentProgress = current.querySelector<HTMLElement>("details.agent-progress");
  const nextProgress = next.querySelector<HTMLElement>("details.agent-progress");
  if (currentProgress && nextProgress) {
    const currentTimeline = currentProgress.querySelector<HTMLElement>(".progress-timeline");
    const nextTimeline = nextProgress.querySelector<HTMLElement>(".progress-timeline");
    if (currentTimeline && nextTimeline) {
      timelineScroll = { element: currentTimeline, top: currentTimeline.scrollTop, left: currentTimeline.scrollLeft };
      patchProgressTimeline(currentTimeline, nextTimeline);
      nextTimeline.replaceWith(currentTimeline);
    }
    const currentSummary = currentProgress.querySelector<HTMLElement>(":scope > summary");
    const nextSummary = nextProgress.querySelector<HTMLElement>(":scope > summary");
    if (currentSummary && nextSummary) adopt(currentSummary, nextSummary);
    adopt(currentProgress, nextProgress);
  }
  current.className = next.className;
  for (const name of next.getAttributeNames()) {
    if (name !== "class") current.setAttribute(name, next.getAttribute(name) || "");
  }
  current.replaceChildren(...Array.from(next.childNodes));
  // The timeline is temporarily detached while it moves through `next` above.
  // Restore only after the full row is mounted again; detached scrollers have
  // no layout height and browsers clamp an earlier scrollTop assignment to 0.
  if (timelineScroll) {
    timelineScroll.element.scrollTop = timelineScroll.top;
    timelineScroll.element.scrollLeft = timelineScroll.left;
    requestAnimationFrame(() => {
      timelineScroll!.element.scrollTop = timelineScroll!.top;
      timelineScroll!.element.scrollLeft = timelineScroll!.left;
    });
  }
  current.querySelectorAll<HTMLElement>("[data-message-body-shell]").forEach(bindBodyCollapse);
}
