import assert from 'node:assert/strict';import {build} from 'esbuild';
const r=await build({stdin:{resolveDir:process.cwd(),contents:`export {mathMatch,mathExt} from './src/chat-math';export {Marked} from 'marked';`},bundle:true,format:'esm',write:false});
const {mathMatch,mathExt,Marked}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
// Which delimiters start math at the beginning of the text.
for(const [src,tex,display] of [['$x^2$ and more','x^2',false],['\\(a+b\\) ok','a+b',false],['$$\\sum_i i$$','\\sum_i i',true],['\\[\\frac{1}{2}\\]','\\frac{1}{2}',true],['$$\n\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\n$$','\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',true],['$a$','a',false]]){
 const m=mathMatch(src);assert.ok(m,src);assert.equal(m.tex,tex,src);assert.equal(m.display,display,src);}
// Dollar amounts and unfinished math are text.
for(const src of ['$5 and $10','$5, then $10.','$ x $','$x $','costs $5','$$ not closed','\\(open','$5$10']) assert.equal(mathMatch(src),undefined,src);
// Through marked: math becomes a span.tex, code stays code, amounts stay text, and math is not mangled by emphasis.
const md=new Marked(mathExt,{breaks:true}),html=t=>md.parse(t,{async:false});
const tex=h=>[...h.matchAll(/<span class="tex( d)?" data-t="([^"]*)">/g)].map(m=>[!!m[1],m[2]]);
assert.deepEqual(tex(html('Inline $a_1 + b_2$ here')),[[false,'a_1 + b_2']]);
assert.deepEqual(tex(html('Both \\(x\\) and\n\n$$y_1*y_2$$')),[[false,'x'],[true,'y_1*y_2']]);
assert.deepEqual(tex(html('I paid $5 and $10 today')),[]);
assert.deepEqual(tex(html('`$x$` and\n\n```\n$$y$$\n\\(z\\)\n```')),[]);
assert.deepEqual(tex(html('Escaped \\$5 and \\$6, then $x$')),[[false,'x']]);
assert.match(html('$a<b$'),/data-t="a&#60;b">\$a&#60;b\$<\/span>/);
assert.doesNotThrow(()=>html('$$\\frac{1}{'));
assert.deepEqual(tex(html('I paid $10, and `$x$` ok')),[]);
// The .md file viewer's md() in v3.ts parses with the same math rules as chat.
const v3=(await import('node:fs')).readFileSync(new URL('../src/v3.ts',import.meta.url),'utf8');
assert.match(v3,/const marked = new Marked\(mathExt\);/);assert.match(v3,/const md = .*marked\.parse\(/);
console.log('chat-math ok');
