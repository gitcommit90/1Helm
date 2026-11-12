// An explicit assistant link, never inferred from words in an answer: [Start Live notes](#livenotes/start). In the chat it is a button
// that opens the Live notes Start sheet in the open task (v3.ts). Tapping it starts nothing until the person confirms in that sheet.
export const LIVE_NOTES_LINK = "#livenotes/start";
export function liveNotesLinkHtml(href: string): string | null {
  if (href !== LIVE_NOTES_LINK) return null;
  return `<button type="button" class="settings-link" data-livenotes-start aria-label="Start Live notes in this task" title="Start Live notes">Start Live notes <span aria-hidden="true">▶</span></button>`;
}
