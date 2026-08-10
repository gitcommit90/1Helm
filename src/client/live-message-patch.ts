/** Keep mounted interactive nodes alive across streamed row updates. A control
 * replaced between pointerdown and pointerup never receives a click. */
function adopt(mounted: HTMLElement, next: HTMLElement): void {
  mounted.className = next.className;
  mounted.replaceChildren(...Array.from(next.childNodes));
  next.replaceWith(mounted);
}

export function patchLiveMessageRow(current: HTMLElement, next: HTMLElement, bindBodyCollapse: (shell: HTMLElement) => void): void {
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
    for (const currentStep of Array.from(currentProgress.querySelectorAll<HTMLElement>("details[data-step-key]"))) {
      const nextStep = nextProgress.querySelector<HTMLElement>(`details[data-step-key="${currentStep.dataset.stepKey || ""}"]`);
      if (!nextStep) continue;
      const currentStepSummary = currentStep.querySelector<HTMLElement>(":scope > summary");
      const nextStepSummary = nextStep.querySelector<HTMLElement>(":scope > summary");
      if (currentStepSummary && nextStepSummary) adopt(currentStepSummary, nextStepSummary);
      adopt(currentStep, nextStep);
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
  current.querySelectorAll<HTMLElement>("[data-message-body-shell]").forEach(bindBodyCollapse);
}
