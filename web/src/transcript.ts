// Legacy notes already contain the authenticated JSON endpoint. Recognize it without rewriting saved notes.
export function transcriptLink(href: string, api: string, base: string) {
  try {
    const u = new URL(href, base), root = new URL(api.replace(/\/$/, '') + '/', base);
    if (u.origin !== root.origin || !u.pathname.startsWith(root.pathname)) return null;
    const m = u.pathname.slice(root.pathname.length).match(/^res\/([a-z0-9][a-z0-9-]{0,62})\/sessions\/([0-9a-f-]{36})\/livenotes\/transcript\/(\d{1,4})$/);
    return m ? { url: u.origin + u.pathname, slug: m[1], task: m[2], n: Number(m[3]) } : null;
  } catch { return null; }
}
export function transcriptLines(data: any) {
  if (!data || !Array.isArray(data.utterances)) throw new Error('The transcript could not be read.');
  const start = Number(data.started_at);
  return data.utterances.filter((u: any) => typeof u?.text === 'string' && u.text.trim()).map((u: any) => {
    const at = Number(u.at), seconds = Number.isFinite(start) && Number.isFinite(at) ? Math.max(0, Math.floor((at - start) / 1000)) : null;
    const time = seconds == null ? '' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    return { time, speaker: typeof u.speaker === 'string' ? u.speaker.trim() : '', text: u.text };
  });
}
export const transcriptText = (lines: ReturnType<typeof transcriptLines>) => lines.map(l => `${l.time ? `[${l.time}] ` : ''}${l.speaker ? `${l.speaker}: ` : ''}${l.text}`).join('\n\n');
