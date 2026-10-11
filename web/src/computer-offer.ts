// Viewer state belongs to the client, not to an agent's persisted browser event.
// Keep it outside v3's late PC declaration so cards can render safely at startup.
let viewed: string | null = null;
export const watchingComputer = (slug: string) => viewed === slug;
export function computerViewerChanged(slug: string | null, root: ParentNode = document) {
  viewed = slug;
  for (const offer of root.querySelectorAll<HTMLElement>('[data-computer-offer]')) {
    offer.hidden = watchingComputer(offer.dataset.computerOffer || '');
  }
}
