// Provider text is a sequence of owned characters. Typing replaces ownership,
// so a later recognition correction cannot overwrite the person's edits.
type Token = { text: string; place?: object };
type Segment = { chars: Token[]; end: Token; revision: number; final: boolean };
export type Transcript = { id: string; revision: number; text: string; final: boolean };
type Edit = { old: Token[]; add: string; next?: Token };

function edits(old: Token[], text: string): Edit[] {
  const groups = (value: string) => value.match(/\s+|\S+/g) ?? [];
  const left = groups(old.map(t => t.text).join('')), right = groups(text);
  const starts = [0]; for (const word of left) starts.push(starts[starts.length - 1] + word.length);
  let a = 0, z = old.length, y = text.length;
  z = left.length; y = right.length;
  while (a < z && a < y && left[a] === right[a]) a++;
  while (z > a && y > a && left[z - 1] === right[y - 1]) { z--; y--; }
  const n = z - a, m = y - a;
  if (!n && !m) return [];
  // Bound work for untrusted long hypotheses. A broad correction is conservative:
  // if any replaced character was edited by the person, preserve that whole run.
  if (n * m > 1_000_000) return [{ old: old.slice(starts[a], starts[z]), add: right.slice(a, y).join(''), next: old[starts[z]] }];
  const rows = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    rows[i][j] = left[a + i] === right[a + j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const out: Edit[] = []; let i = 0, j = 0, run: Edit | null = null;
  const flush = (next?: Token) => { if (run) { run.next = next; out.push(run); run = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && left[a + i] === right[a + j]) { flush(old[starts[a + i]]); i++; j++; }
    else if (j < m && (i === n || rows[i][j + 1] > rows[i + 1][j])) { (run ??= { old: [], add: '' }).add += right[a + j++]; }
    else { (run ??= { old: [], add: '' }).old.push(...old.slice(starts[a + i], starts[a + i + 1])); i++; }
  }
  flush(old[starts[z]]); return out;
}

export class DictationBuffer {
  private doc: Token[];
  private segments = new Map<string, Segment>();
  private protected = new WeakSet<Token>();
  private undoStack: { removed: Token[]; added: Token[]; next?: Token; offset: number }[] = [];
  private redoStack: { removed: Token[]; added: Token[]; next?: Token; offset: number }[] = [];
  private anchor: Token = { text: '' };
  private place: object = {};
  private selected: Token[] = [];
  inserted = false;
  constructor(text: string, start = text.length, end = start) {
    this.doc = text.split('').map(text => ({ text }));
    this.move(start, end);
  }
  get value() { return this.doc.map(t => t.text).join(''); }
  get cursor() { return this.doc.slice(0, this.doc.indexOf(this.anchor)).reduce((n, t) => n + t.text.length, 0); }
  // Explicit user selection moves only the destination of NEW words. Existing
  // speech stays attached to its tokens, even across several insertion places.
  move(start: number, end = start) {
    const chars = this.doc.filter(t => t.text);
    this.selected = chars.slice(start, end);
    this.doc = this.doc.filter(t => t !== this.anchor);
    this.doc.splice(this.indexAt(start), 0, this.anchor);
    this.place = {};
  }
  private indexAt(offset: number) {
    let p = 0;
    for (let i = 0; i < this.doc.length; i++) { if (p >= offset && this.doc[i].text) return i; p += this.doc[i].text.length; }
    return this.doc.length;
  }
  // Called for every native input, including paste, undo, speech on-device and IME.
  edit(value: string, record = true) {
    const old = this.value; if (old === value) return;
    let a = 0, z = old.length, y = value.length;
    while (a < z && a < y && old[a] === value[a]) a++;
    while (z > a && y > a && old[z - 1] === value[y - 1]) { z--; y--; }
    const chars = this.doc.filter(t => t.text);
    let wa = a, wz = z;
    // A corrected word belongs to the person, not merely the changed letters.
    // This also covers inserting a letter/space inside a provider-owned word.
    while (wa > 0 && !/\s/.test(old[wa - 1])) wa--;
    while (wz < old.length && !/\s/.test(old[wz])) wz++;
    for (const token of chars.slice(wa, wz)) this.protected.add(token);
    const at = this.indexAt(a), removed = new Set<Token>(); let p = 0;
    for (const token of this.doc) { if (token.text && p >= a && p < z) removed.add(token); p += token.text.length; }
    const added = value.slice(a, y).split('').map(text => ({ text }));
    if (record) { this.undoStack.push({ removed: [...removed], added, next: chars[z], offset: a }); this.redoStack = []; }
    this.doc.splice(at, 0, ...added);
    this.doc = this.doc.filter(t => !removed.has(t));
    this.selected = [];
  }
  // Live dictation has its own edit history because assigning textarea.value
  // invalidates native undo in some browsers. Undo only the person's operation,
  // not new words that arrived afterward. The same history supports redo.
  undo(redo = false) {
    const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack;
    const op = from.pop(); if (!op) return null;
    const remove = redo ? op.removed : op.added, add = redo ? op.added : op.removed;
    const first = remove.find(t => this.doc.includes(t));
    const at = first ? this.doc.indexOf(first) : op.next && this.doc.includes(op.next) ? this.doc.indexOf(op.next) : this.indexAt(op.offset);
    this.doc.splice(at, 0, ...add); const gone = new Set(remove); this.doc = this.doc.filter(t => !gone.has(t));
    add.forEach(t => this.protected.add(t)); to.push(op);
    return Math.min(this.value.length, op.offset + add.length);
  }
  // Keep selection attached to existing characters, rather than jumping to the
  // end whenever a partial result arrives while someone is editing earlier words.
  selection(start: number, end: number) {
    const chars = this.doc.filter(t => t.text);
    const anchor = (n: number) => ({ left: chars[n - 1], right: chars[n], fallback: n });
    const a = anchor(start), b = anchor(end);
    return () => {
      const current = this.doc.filter(t => t.text);
      const resolve = (x: ReturnType<typeof anchor>) => {
        const r = x.right ? current.indexOf(x.right) : -1; if (r >= 0) return r;
        const l = x.left ? current.indexOf(x.left) : -1; return l >= 0 ? l + 1 : Math.min(x.fallback, current.length);
      };
      return [resolve(a), resolve(b)] as [number, number];
    };
  }
  apply(event: Transcript) {
    this.inserted = false;
    if (!event.id || !Number.isSafeInteger(event.revision) || event.revision < 0 || typeof event.text !== 'string' || event.text.length > 32000) return false;
    let seg = this.segments.get(event.id);
    if (seg && (seg.final || event.revision <= seg.revision)) return false;
    if (!seg) {
      if (!event.text.trim()) return false;
      const at = this.doc.indexOf(this.anchor);
      const end = { text: '' };
      this.doc.splice(at, 0, end);
      seg = { chars: [], end, revision: -1, final: false }; this.segments.set(event.id, seg);
    }
    const changes = edits(seg.chars, event.text), replacement = new Map<Token, Token[]>(), present = new Set(this.doc);
    for (const change of changes) {
      const fresh: Token[] = change.add.split('').map(text => ({ text }));
      const previous = change.next ? seg.chars[seg.chars.indexOf(change.next) - 1] : undefined;
      const locations = new Set(change.old.map(t => t.place).filter(Boolean));
      // An ASR rewrite spanning cursor destinations must never gather those
      // words back together. Freeze ambiguous rewrites, not the user's layout.
      const touched = locations.size > 1 || change.old.some(t => !present.has(t) || this.protected.has(t))
        || (!change.old.length && !!change.next && ((!present.has(change.next) || this.protected.has(change.next)) || (!!previous && (!present.has(previous) || this.protected.has(previous)))));
      const first = change.old.find(t => this.doc.includes(t));
      const at = first ? this.doc.indexOf(first) : change.next && this.doc.includes(change.next) ? this.doc.indexOf(change.next) : this.doc.indexOf(seg.end);
      // Split an updated last word from fresh continuation. Recognition can
      // complete/correct that word where it was heard; NEW words follow the
      // current caret, not the start-of-recording anchor or document end.
      let split = fresh.length;
      if (!change.next) {
        const oldWords = (change.old.map(t => t.text).join('').match(/\S+/g) ?? []).length;
        if (!oldWords) split = 0;
        else { const words = [...change.add.matchAll(/\S+/g)]; if (words.length > oldWords) split = words[oldWords - 1].index! + words[oldWords - 1][0].length; }
      }
      if (!touched) {
        for (const token of fresh.slice(0, split)) token.place = change.old[0]?.place ?? change.next?.place ?? this.place;
        this.doc.splice(at, 0, ...fresh.slice(0, split));
        const gone = new Set(change.old); this.doc = this.doc.filter(t => !gone.has(t));
      }
      if (split < fresh.length) this.insert(fresh.slice(split));
      // Suppressed tokens still enter canonical history, but never enter the
      // document. Future hypotheses cannot resurrect the overwritten words.
      if (change.old.length) replacement.set(change.old[0], fresh);
      else replacement.set(change.next ?? seg.end, fresh);
    }
    const removed = new Set(changes.flatMap(c => c.old));
    const canonical: Token[] = [];
    for (const t of [...seg.chars, seg.end]) { canonical.push(...(replacement.get(t) ?? [])); if (t !== seg.end && !removed.has(t)) canonical.push(t); }
    seg.chars = canonical; seg.revision = event.revision; seg.final = event.final;
    return true;
  }
  private insert(tokens: Token[]) {
    if (!tokens.some(t => /\S/.test(t.text))) return;
    for (const token of tokens) token.place = this.place;
    if (this.selected.length) {
      const gone = new Set(this.selected); this.doc = this.doc.filter(t => !gone.has(t)); this.selected = [];
    }
    const at = this.doc.indexOf(this.anchor);
    const before = this.doc.slice(0, at).map(t => t.text).join(''), after = this.doc.slice(at + 1).map(t => t.text).join('');
    let visible = tokens;
    if (!before || /\s$/.test(before)) { const first = tokens.findIndex(t => /\S/.test(t.text)); visible = tokens.slice(first); }
    const pre = before && !/\s$/.test(before) && !/^\s/.test(visible[0]?.text ?? '') ? [{ text: ' ' }] : [];
    const post = after && !/^\s/.test(after) && !/\s$/.test(visible.at(-1)?.text ?? '') ? [{ text: ' ' }] : [];
    this.doc.splice(at, 0, ...pre, ...visible);
    this.doc.splice(this.doc.indexOf(this.anchor) + 1, 0, ...post);
    this.inserted = true;
  }
}
