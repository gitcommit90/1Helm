// The editable Word document in the Zone: the model, with no page and no network. It is a flat list of the body's paragraphs, in document order (a paragraph in a
// table cell is in the list too), so a paragraph's place in the list is the index the server addresses it by (1HC src/zone-docx.js: "the body's w:p elements in document
// order"). A paragraph is a list of runs { t: text, r: the run's w:rPr children as text }, so formatting the app does not understand rides along unchanged.
// A protected paragraph (a picture, a field, a link, a text box, a tracked change) is in the list for the numbering and is never changed.
// Everything here is pure: split, join, replace a range, toggle bold, italic or underline, undo snapshots, and the diff that turns two states into the server's ops.

export type Run = { t: string; r: string };
export type PView = { head: number; list: { id: string; lvl: number } | null; jc: string; ind: number; first: number; before: number; after: number; style: string; line: number };
export type Para = {
  pid: number;           // never reused: a split makes a new one, a join drops one
  orig: number | null;   // its index in the file as last read or saved; null for a paragraph made here
  runs: Run[]; caret: string;   // caret: the rPr text typed into an empty paragraph takes
  prot: boolean; nested: boolean;   // nested: a text box's own paragraph, drawn inside the paragraph that holds the box
  ct: number;            // the container: 0 the body, else a table cell
  v: PView; plain: string; imgs: string[]; protRuns?: { t: string; r: string; img?: string }[];   // what a protected paragraph shows
};
export type Doc = { paras: Para[]; nextPid: number };
export type Pos = { i: number; o: number };
export type Op = { op: "runs"; p: number; runs: { t: string; r: string }[] } | { op: "insert"; after: number; runs?: { t: string; r: string }[] } | { op: "delete"; p: number } | { op: "format"; p: number; from: number; to: number; b?: boolean; i?: boolean; u?: boolean };
export type Flag = "b" | "i" | "u";

// ---- the formatting text: the same rule as the server's composeRpr (1HC src/zone-docx.js) ----
const ORDER = ["w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps", "w:strike", "w:dstrike", "w:outline", "w:shadow", "w:emboss", "w:imprint", "w:noProof", "w:snapToGrid", "w:vanish", "w:webHidden", "w:color", "w:spacing", "w:w", "w:kern", "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect", "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath"];
export const RPR_NAMES = new Set(ORDER);
const KID = /<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*="[^"<>&]*")*)\s*\/>/g;
export type Kid = { name: string; raw: string; attrs: Record<string, string> };
export function kidsOf(rpr: string): Kid[] {
  const out: Kid[] = []; KID.lastIndex = 0; let m: RegExpExecArray | null;
  while ((m = KID.exec(rpr))) { const attrs: Record<string, string> = {}; m[2].replace(/([A-Za-z_][\w.:-]*)="([^"]*)"/g, (_x, k, v) => (attrs[k] = v, "")); out.push({ name: m[1], raw: m[0], attrs }); }
  return out;
}
const offVal = (v: string | undefined) => v === "0" || v === "false" || v === "off";
const idxOf = (n: string) => { const i = ORDER.indexOf(n); return i < 0 ? ORDER.length : i; };
const NAME: Record<Flag, string> = { b: "w:b", i: "w:i", u: "w:u" };
/** What the run itself says about a flag: true, false, or undefined when it says nothing (a style may still decide). */
export function explicit(rpr: string, f: Flag): boolean | undefined {
  const k = kidsOf(rpr).find(x => x.name === NAME[f]); if (!k) return undefined;
  return f === "u" ? k.attrs["w:val"] !== "none" : !offVal(k.attrs["w:val"]);
}
export function composeRpr(rpr: string, flags: Partial<Record<Flag, boolean | undefined>>): string {
  let ks = kidsOf(rpr);
  for (const f of ["b", "i", "u"] as Flag[]) {
    const v = flags[f]; if (v === undefined) continue; const name = NAME[f];
    if (explicit(rpr, f) === v && ks.some(k => k.name === name)) continue;
    ks = ks.filter(k => k.name !== name);
    const raw = f === "u" ? `<w:u w:val="${v ? "single" : "none"}"/>` : v ? `<${name}/>` : `<${name} w:val="0"/>`;
    let at = ks.findIndex(k => idxOf(k.name) > idxOf(name)); if (at < 0) at = ks.length; ks.splice(at, 0, { name, raw, attrs: {} });
    rpr = ks.map(k => k.raw).join("");
  }
  return ks.map(k => k.raw).join("");
}

// ---- runs ----
export const ptext = (p: Para) => p.runs.map(r => r.t).join("");
export const plen = (p: Para) => p.runs.reduce((n, r) => n + r.t.length, 0);
export function tidy(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) { if (!r.t) continue; const l = out[out.length - 1]; if (l && l.r === r.r) out[out.length - 1] = { t: l.t + r.t, r: r.r }; else out.push({ t: r.t, r: r.r }); }
  return out;
}
export function sliceRuns(runs: Run[], a: number, b: number): Run[] {
  const out: Run[] = []; let o = 0;
  for (const r of runs) { const s = o, e = o + r.t.length; o = e; if (e <= a || s >= b) continue; out.push({ t: r.t.slice(Math.max(a, s) - s, Math.min(b, e) - s), r: r.r }); }
  return out;
}
/** The formatting text typed at offset o takes: the run before it, else the run after it, else the paragraph's own. */
export function rprAt(p: Para, o: number): string {
  let at = 0, before: Run | null = null;
  for (const r of p.runs) { if (o > at && o <= at + r.t.length) return r.r; if (at >= o && !before) before = r; at += r.t.length; }
  return p.runs[0]?.r ?? p.caret;
}
const lastRpr = (runs: Run[], dflt: string) => runs.length ? runs[runs.length - 1].r : dflt;

const clone = (p: Para, pid: number, runs: Run[], caret: string): Para => ({ ...p, pid, orig: null, runs, caret, prot: false, nested: false, plain: "", imgs: [] });

/** Enter: the paragraph is split at the offset. The first part keeps the paragraph (and its place in the file); the second is new and copies its look. */
export function enter(d: Doc, i: number, o: number): Pos | null {
  const p = d.paras[i]; if (!p || p.prot) return null;
  const left = tidy(sliceRuns(p.runs, 0, o)), right = tidy(sliceRuns(p.runs, o, plen(p)));
  const caret = rprAt(p, o) || p.caret;
  d.paras[i] = { ...p, runs: left, caret: left.length ? lastRpr(left, p.caret) : caret };
  d.paras.splice(i + 1, 0, clone(p, d.nextPid++, right, caret));
  return { i: i + 1, o: 0 };
}
/** Replace everything from a to b with text (Enter in the text splits the paragraph). Refused (null) when it would reach a protected paragraph or another container. */
export function replace(d: Doc, a: Pos, b: Pos, text: string): Pos | null {
  if (a.i > b.i || (a.i === b.i && a.o > b.o)) [a, b] = [b, a];
  const pa = d.paras[a.i], pb = d.paras[b.i]; if (!pa || !pb) return null;
  for (let k = a.i; k <= b.i; k++) { const q = d.paras[k]; if (q.prot || q.ct !== pa.ct) return null; }
  const rpr = rprAt(pa, a.o), left = sliceRuns(pa.runs, 0, a.o), right = sliceRuns(pb.runs, b.o, plen(pb));
  const lines = text.replace(/\r\n?/g, "\n").split("\n"), mk = (t: string) => (t ? [{ t, r: rpr }] : []);
  if (lines.length === 1) {
    const runs = tidy([...left, ...mk(lines[0]), ...right]);
    d.paras.splice(a.i, b.i - a.i + 1, { ...pa, runs, caret: runs.length ? pa.caret : rpr });
    return { i: a.i, o: plen({ runs: [...left, ...mk(lines[0])] } as Para) };
  }
  const first = { ...pa, runs: tidy([...left, ...mk(lines[0])]), caret: rpr }, mid = lines.slice(1, -1).map(t => clone(pa, d.nextPid++, mk(t), rpr));
  const lastText = lines[lines.length - 1], lastRuns = tidy([...mk(lastText), ...right]);
  const last = b.i > a.i ? { ...pb, runs: lastRuns } : clone(pa, d.nextPid++, lastRuns, rpr);
  d.paras.splice(a.i, b.i - a.i + 1, first, ...mid, last);
  return { i: a.i + mid.length + 1, o: lastText.length };
}
/** Backspace at the start of paragraph i: it joins the one before (the first one keeps its place). */
export function joinBack(d: Doc, i: number): Pos | null { if (i < 1) return null; const p = d.paras[i - 1]; return p ? replace(d, { i: i - 1, o: plen(p) }, { i, o: 0 }, "") : null; }
/** Delete at the end of paragraph i: the next one joins it. */
export function joinForward(d: Doc, i: number): Pos | null { const p = d.paras[i]; return p && d.paras[i + 1] ? replace(d, { i, o: plen(p) }, { i: i + 1, o: 0 }, "") : null; }

/** What a flag is for the characters of a run when the run says nothing: set by the paragraph's style (a heading is bold). */
export type Dflt = (p: Para, f: Flag) => boolean;
const eff = (p: Para, r: Run, f: Flag, dflt: Dflt) => explicit(r.r, f) ?? dflt(p, f);
/** Cmd or Ctrl plus B, I or U on a range: when every character in it has the flag, it goes off; else it goes on. Returns the paragraphs that changed (null: nothing to change). */
export function toggle(d: Doc, a: Pos, b: Pos, f: Flag, dflt: Dflt): number[] | null {
  if (a.i > b.i || (a.i === b.i && a.o > b.o)) [a, b] = [b, a];
  const spans: { i: number; s: number; e: number }[] = [];
  for (let i = a.i; i <= b.i; i++) { const p = d.paras[i]; if (!p || p.prot) continue; const s = i === a.i ? a.o : 0, e = i === b.i ? b.o : plen(p); if (e > s) spans.push({ i, s, e }); }
  if (!spans.length) return null;
  let all = true; for (const x of spans) { let o = 0; for (const r of d.paras[x.i].runs) { const s = o, e = o + r.t.length; o = e; if (e > x.s && s < x.e && !eff(d.paras[x.i], r, f, dflt)) all = false; } }
  const want = !all, hit: number[] = [];
  for (const x of spans) {
    const p = d.paras[x.i], out: Run[] = []; let o = 0;
    for (const r of p.runs) {
      const s = o, e = o + r.t.length; o = e;
      if (e <= x.s || s >= x.e) { out.push(r); continue; }
      const m0 = Math.max(x.s, s) - s, m1 = Math.min(x.e, e) - s;
      if (m0 > 0) out.push({ t: r.t.slice(0, m0), r: r.r });
      out.push({ t: r.t.slice(m0, m1), r: composeRpr(r.r, { [f]: want }) });
      if (m1 < r.t.length) out.push({ t: r.t.slice(m1), r: r.r });
    }
    d.paras[x.i] = { ...p, runs: tidy(out) }; hit.push(x.i);
  }
  return hit;
}

// ---- keeping the file in step ----
export const snapshot = (d: Doc): Doc => ({ paras: d.paras.map(p => ({ ...p })), nextPid: d.nextPid });
const sameRuns = (a: Run[], b: Run[]) => a.length === b.length && a.every((r, k) => r.t === b[k].t && r.r === b[k].r);
const rprPerChar = (runs: Run[]) => { const o: string[] = []; for (const r of runs) for (let k = 0; k < r.t.length; k++) o.push(r.r); return o; };
const FL: Flag[] = ["b", "i", "u"];
/** The ops that turn the file's paragraphs (base, by index) into the paragraphs now (cur): format ops where only bold, italic or underline changed, runs ops where text changed, then
 *  the deletes (highest index first), then the inserts (each after the paragraph before it). The server applies them in order, so every index is as the file stands at that step. */
export function diffOps(base: Para[], cur: Para[]): Op[] {
  const ops: Op[] = [], keep = new Set<number>();
  for (const c of cur) if (c.orig != null) keep.add(c.orig);
  for (const c of cur) {
    if (c.orig == null || c.prot) continue; const b = base[c.orig]; if (!b || b.prot || sameRuns(b.runs, c.runs)) continue;
    if (ptext(b) === ptext(c)) {
      const rb = rprPerChar(b.runs), rc = rprPerChar(c.runs), segs: Op[] = []; let okay = true;
      for (let k = 0; k < rb.length && okay;) {
        let e = k + 1; while (e < rb.length && rb[e] === rb[k] && rc[e] === rc[k]) e++;
        if (rb[k] !== rc[k]) {
          const want: Partial<Record<Flag, boolean>> = {}; for (const f of FL) { const x = explicit(rb[k], f), y = explicit(rc[k], f); if (x !== y && y !== undefined) want[f] = y; }
          if (!Object.keys(want).length || composeRpr(rb[k], want) !== rc[k]) okay = false;
          else { const l = segs[segs.length - 1] as any; if (l && l.to === k && FL.every(f => l[f] === want[f])) l.to = e; else segs.push({ op: "format", p: c.orig, from: k, to: e, ...want }); }
        }
        k = e;
      }
      if (okay) { ops.push(...segs); continue; }
    }
    ops.push({ op: "runs", p: c.orig, runs: c.runs.map(r => ({ t: r.t, r: r.r })) });
  }
  base.forEach((b, i) => { if (!keep.has(i) && !b.prot) ops.push({ op: "delete", p: i }); });
  const dels = ops.filter(o => o.op === "delete") as { op: "delete"; p: number }[], rest = ops.filter(o => o.op !== "delete");
  dels.sort((x, y) => y.p - x.p);
  const out: Op[] = [...rest, ...dels]; let at = 0;
  for (const c of cur) { if (c.orig == null) { if (at > 0) out.push({ op: "insert", after: at - 1, runs: c.runs.map(r => ({ t: r.t, r: r.r })) }); } at++; }
  return out;
}
/** After a save: the paragraphs are the file's now, in this order. */
export function rebase(d: Doc): Para[] { d.paras.forEach((p, i) => { p.orig = i; }); return d.paras.map(p => ({ ...p })); }

/** Another device saved a newer file (theirs) while this one has unsaved changes (mine, against base). Each paragraph the person changed, added or removed is reapplied to theirs when the
 *  matching paragraph there still equals the base (by position, or by its text when the paragraph count differs); else theirs is kept and its number is listed in lost. */
export function rebaseParas(base: Para[], mine: Para[], theirs: Doc): { paras: Para[]; lost: number[] } {
  const T = theirs.paras, same = T.length === base.length, used = new Set<number>(), lost: number[] = [], out = T.map(p => ({ ...p })), gone = new Set<Para>();
  const ref = base.map((b, k) => { const j = same ? k : T.findIndex((t, i) => !used.has(i) && !t.prot && ptext(t) === ptext(b)); if (j >= 0) used.add(j); return j >= 0 ? out[j] : null; });
  const have = new Map(mine.filter(c => c.orig != null).map(c => [c.orig!, c]));
  base.forEach((b, k) => {
    const c = have.get(k); if (b.prot || (c && sameRuns(c.runs, b.runs))) return; const good = !!ref[k] && sameRuns(ref[k]!.runs, b.runs);
    if (!good) lost.push(k + 1); else if (c) { ref[k]!.runs = c.runs; ref[k]!.caret = c.caret; } else gone.add(ref[k]!);
  });
  let prev: Para | null = null;
  for (const c of mine) { if (c.orig != null) { prev = ref[c.orig] ?? prev; continue; } const n = { ...c, pid: theirs.nextPid++, orig: null }; out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, n); prev = n; }
  return { paras: out.filter(p => !gone.has(p)), lost };
}
