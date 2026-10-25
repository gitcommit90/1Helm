// PowerPoint fit: text in the mapped font (Arial, Arial Narrow, Times New Roman, Courier New) must fit the box the page gave it, and the export's own check
// must flag text that does not. Deterministic facts only: computed widths against box widths, read back from the written .pptx. No browser and no model.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const S = new URL('../src/skills/artifacts/scripts/build_pptx.py', import.meta.url).pathname;
const run = (py) => { const r = spawnSync('python3', ['-I', '-c', `import sys,json\nsrc=open(${JSON.stringify(S)}).read().rsplit("\\nmain()",1)[0]\ng={"__name__":"m","__file__":${JSON.stringify(S)}}\nsys.argv=["x"]\nexec(compile(src,"b","exec"),g)\n${py}`], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim().split('\n').pop()); };
const text = (t, font, px, extra = {}) => ({ type: 'text', x: 100, y: 100, w: 600, h: px * 1.2, base: 100 + px, maxw: 600, rot: 0, align: 'left', lh: px * 1.1, lines: 1, runs: [{ t, font, gen: 'sans-serif', px, color: '#000000', spacing: 0, bold: false, italic: false }], ...extra });

// 1. Text that is wider in Arial Narrow than the page's condensed font is made smaller for its own box, and the written file passes the check.
{
  const items = [text('SUPERCATALOG NUMBER SEVEN', 'Bebas Neue', 140, { w: 500, maxw: 500 }), text('Short', 'Inter', 40, { w: 120 })];
  const dir = mkdtempSync(join(tmpdir(), 'pptxfit-')); mkdirSync(join(dir, '.src', 'build'), { recursive: true });
  writeFileSync(join(dir, '.src', 'build', 'pptx.json'), JSON.stringify({ title: 't', slides: [{ items, notes: '' }] }));
  const r = spawnSync('python3', ['-I', S, dir], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.fit_measured, true);
  assert.equal(out.fitted, 1, 'only the wide line is made smaller');
  assert.ok(out.smallest_fit < 1 && out.smallest_fit > 0.1);
  assert.deepEqual(out.overflows, []);
}

// 2. Computed widths: the fitted size puts the line inside its box (with the 2% margin), the original size does not, and a box that already fits is untouched.
{
  const o = run(`it=json.loads(${JSON.stringify(JSON.stringify(text('SUPERCATALOG NUMBER SEVEN', 'Bebas Neue', 140, { w: 500, maxw: 500 })))})
fit,f=g["fit_item"](it)
cells=lambda x:[c for p in g["item_cells"](x) for c in p]
print(json.dumps({"f":f,"before":g["measure"](cells(it)),"after":g["measure"](cells(fit)),"box":508}))`);
  assert.ok(o.before > o.box && o.after <= o.box && o.f < 1);
  const u = run(`it=json.loads(${JSON.stringify(JSON.stringify(text('Hi', 'Inter', 40, { w: 120 })))})
fit,f=g["fit_item"](it); print(json.dumps({"f":f,"px":fit["runs"][0]["px"]}))`);
  assert.deepEqual(u, { f: 1, px: 40 });
}

// 3. Several lines keep the page's line count: a title that took two lines in the page does not take three in the mapped font.
{
  const it = text('this is the broadside style', 'Barlow', 250, { w: 1593, maxw: 1623, h: 520, lh: 220, lines: 2 });
  it.runs[0].bold = true; it.runs[0].spacing = -10;
  const o = run(`it=json.loads(${JSON.stringify(JSON.stringify(it))})
fit,f=g["fit_item"](it); p=g["item_cells"](fit); w=g["box_width"](fit,True)[0]
print(json.dumps({"f":f,"lines":g["wrap"](p,w)[0],"word":g["wrap"](p,w)[2],"w":w}))`);
  assert.ok(o.f < 1 && o.lines <= 2 && o.word <= o.w);
}

// 4. The check flags overflow: a box written too narrow for its text in the mapped font is reported, one that fits is not.
{
  const o = run(`from pptx import Presentation
from pptx.util import Emu, Pt
PX=6350
prs=Presentation(); s=prs.slides.add_slide(prs.slide_layouts[6])
def box(x,w,wrap):
    b=s.shapes.add_textbox(Emu(x*PX),Emu(100*PX),Emu(w*PX),Emu(100*PX)); tf=b.text_frame; tf.word_wrap=wrap
    r=tf.paragraphs[0].add_run(); r.text="Quarterly strategy session"; r.font.name="Arial"; r.font.size=Pt(40)
box(0,300,False); box(0,1400,False); box(0,100,True)
print(json.dumps({"n":len(g["overflows"](prs.slides[0],1))}))`);
  assert.equal(o.n, 2, 'the 300 px single line and the 100 px wrapping box are flagged, the 1400 px box is not');
}

// 5. Without the width table the export still succeeds, fits nothing and says so (make_deck.sh prints a note, never FAIL); the table travels with every template.
{
  const dir = mkdtempSync(join(tmpdir(), 'pptxfit-')); mkdirSync(join(dir, '.src', 'build'), { recursive: true }); mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, '.src', 'build', 'pptx.json'), JSON.stringify({ title: 't', slides: [{ items: [text('SUPERCATALOG NUMBER SEVEN', 'Bebas Neue', 140, { w: 500, maxw: 500 })], notes: '' }] }));
  copyFileSync(S, join(dir, 'scripts', 'build_pptx.py'));   // away from the repository, so only the deck's own copy and /opt/1hc/deck-templates are searched
  const run1 = (env) => { const r = spawnSync('python3', ['-I', join(dir, 'scripts', 'build_pptx.py'), dir], { encoding: 'utf8', env: { ...process.env, ...env } }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim().split('\n').pop()); };
  if (!existsSync('/opt/1hc/deck-templates/_measure/widths.json')) {
    const out = run1({ HC_DECK_TEMPLATES: join(dir, 'nowhere') });
    assert.equal(out.fit_measured, false); assert.equal(out.fitted, 0); assert.deepEqual(out.overflows, []);
  }
  // the deck's own copy of the table (what new_deck.mjs copies into .src/template) is found
  const T = new URL('../app-assets/deck-templates/', import.meta.url).pathname;
  mkdirSync(join(dir, '.src', 'template', '_measure'), { recursive: true });
  copyFileSync(T + '_measure/widths.json', join(dir, '.src', 'template', '_measure', 'widths.json'));
  const withTable = run1({ HC_DECK_TEMPLATES: join(dir, 'nowhere') });
  assert.equal(withTable.fit_measured, true); assert.equal(withTable.fitted, 1);
  const files = JSON.parse(readFileSync(T + 'manifest.json', 'utf8')).templates['8-bit-orbit'].files   // the manifest (kept current by build-deck-templates-manifest.mjs --check) lists what each computer is sent;
  assert.ok(files.includes('_measure/widths.json') && files.includes('_measure/LICENSE-liberation.txt') && files.includes('_measure/LICENSE-liberation-sans-narrow.txt'));
  assert.match(readFileSync(new URL('../src/skills/artifacts/scripts/make_deck.sh', import.meta.url), 'utf8'), /fit_measured===false/);
}
