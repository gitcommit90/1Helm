// Word documents in the Zone: the canvas shows the document's pages as pictures (the server's Word-to-PDF preview, drawn by pdf.js), so what the
// person points at is text on a picture. These pure functions turn the text pdf.js reports for one page (small pieces with a position) into the
// paragraphs a person sees: pieces on one baseline become a line, a line is split where the gap is as wide as a column or a tab, and lines that
// follow each other with the same left edge, size and line distance are one paragraph. A leading bullet or number is kept apart from the text.
// Positions are in the page's own units (pdf.js "scale 1"), measured from the top left.

export type TItem = { str: string; transform: number[]; width: number; height: number };
export type Seg = { text: string; l: number; t: number; r: number; b: number; fs: number; y: number };
export type Para = { text: string; marker: string; l: number; t: number; r: number; b: number; lines: Seg[] };

// The same marker pattern the server uses (1HC src/zone-docx.js MARKER).
export const MARKER = /^\s*(?:[•◦▪■●○–—·*\-]|\(?\d{1,3}[.)]|\(?[A-Za-z][.)])\s+/;
export const norm = (s: string) => s.replace(/\s+/g, " ").trim();
/** Letters and digits only, the way two copies of the same words are compared (ligatures and quote styles do not matter). */
export const keyOf = (s: string) => { let k = ""; for (const ch of s.normalize("NFKC")) if (/[\p{L}\p{N}]/u.test(ch)) k += ch; return k; };
export function splitMarker(text: string): { marker: string; text: string } {
  const m = text.match(MARKER); if (!m || !keyOf(text.slice(m[0].length))) return { marker: "", text: norm(text) };
  return { marker: m[0].trim(), text: norm(text.slice(m[0].length)) };
}

const FS_MIN = 2;
/** The lines of a page: pieces on one baseline, split into separate segments where the gap is wider than about two letters of the text size. */
export function pageSegments(items: TItem[], pageH: number): Seg[] {
  type P = { s: string; l: number; r: number; y: number; fs: number };
  const ps: P[] = [];
  for (const it of items) {
    const t = it.transform; if (!t || t.length < 6 || !it.str || !it.str.trim()) continue;
    const fs = Math.hypot(t[2], t[3]) || it.height || 0; if (!(fs >= FS_MIN) || Math.abs(t[1]) > 0.2 * fs) continue;   // a vertical or tiny piece is not body text
    ps.push({ s: it.str, l: t[4], r: t[4] + Math.max(0, it.width), y: pageH - t[5], fs });
  }
  ps.sort((a, b) => a.y - b.y || a.l - b.l);
  const lines: P[][] = [];
  for (const p of ps) {
    const L = lines.find(l => Math.abs(l[0].y - p.y) < Math.min(l[0].fs, p.fs) * 0.35); if (L) L.push(p); else lines.push([p]);
  }
  const segs: Seg[] = [];
  for (const l of lines) {
    l.sort((a, b) => a.l - b.l);
    let cur: P[] = [];
    const flush = () => { if (!cur.length) return; const fs = Math.max(...cur.map(p => p.fs)), y = cur[0].y; let text = "";
      cur.forEach((p, i) => { if (i) { const gap = p.l - cur[i - 1].r; if (gap > fs * 0.18 && !/\s$/.test(text) && !/^\s/.test(p.s)) text += " "; } text += p.s; });
      segs.push({ text: norm(text), l: cur[0].l, r: Math.max(...cur.map(p => p.r)), t: y - fs * 0.85, b: y + fs * 0.25, fs, y }); cur = []; };
    for (const p of l) { const prev = cur[cur.length - 1]; if (prev && p.l - prev.r > Math.max(prev.fs, p.fs) * 2.2) flush(); cur.push(p); }
    flush();
  }
  return segs.filter(s => s.text);
}

/** Segments that follow each other (same left edge or overlapping, similar size, the usual line distance) are one paragraph. */
export function paragraphsOf(items: TItem[], pageH: number): Para[] {
  const segs = pageSegments(items, pageH).sort((a, b) => a.y - b.y || a.l - b.l);
  const open: Seg[][] = [];
  for (const s of segs) {
    let best: Seg[] | null = null, bd = 1e9;
    for (const P of open) {
      const L = P[P.length - 1], dy = s.y - L.y; if (dy <= s.fs * 0.5 || MARKER.test(s.text)) continue;   // a line that starts with a bullet or a number starts a paragraph
      const limit = P.length > 1 ? (P[1].y - P[0].y) * 1.2 : s.fs * 1.4;   // the second line may be up to 1.4 text sizes down, the next ones about as far as the first two were
      if (dy > Math.max(limit, s.fs * 0.5 + 1) || dy > s.fs * 2.4) continue;
      if (s.fs < L.fs * 0.85 || s.fs > L.fs * 1.18) continue;
      const first = P[0], lo = Math.max(L.l, s.l), hi = Math.min(L.r, s.r), overlap = (hi - lo) / Math.max(1, Math.min(L.r - L.l, s.r - s.l));
      const aligned = Math.abs(s.l - L.l) < s.fs * 2.5 || Math.abs(s.l - first.l) < s.fs * 2.5 || overlap > 0.5;
      if (!aligned || hi <= lo - s.fs) continue;
      if (dy < bd) { bd = dy; best = P; }
    }
    if (best) best.push(s); else open.push([s]);
  }
  return open.map(P => {
    const raw = P.map(s => s.text).join(" "), { marker, text } = splitMarker(raw);
    return { text, marker, l: Math.min(...P.map(s => s.l)), t: Math.min(...P.map(s => s.t)), r: Math.max(...P.map(s => s.r)), b: Math.max(...P.map(s => s.b)), lines: P };
  }).filter(p => keyOf(p.text)).sort((a, b) => a.t - b.t || a.l - b.l);
}

/** The paragraph under a point (page units), or the nearest one within a few units of it. */
export function paraAt(ps: Para[], x: number, y: number, slack = 3): number {
  let best = -1, bd = 1e9;
  ps.forEach((p, i) => { const dx = x < p.l ? p.l - x : x > p.r ? x - p.r : 0, dy = y < p.t ? p.t - y : y > p.b ? y - p.b : 0; if (dx > slack || dy > slack) return; const d = dx + dy; if (d < bd) { bd = d; best = i; } });
  return best;
}
