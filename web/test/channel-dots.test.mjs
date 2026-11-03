import assert from 'node:assert/strict';import {build} from 'esbuild';
const result=await build({entryPoints:[new URL('../src/channel-dots.ts', import.meta.url).pathname],bundle:true,format:'esm',write:false});
const {paintChannelDots}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
// A tiny DOM: elements with children, class, title, attributes, and the few selectors paintChannelDots uses.
class El{constructor(cls,attrs={}){this.className=cls;this.attrs=attrs;this.children=[];this.parent=null;this.title='';this.dataset={};for(const[k,v]of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-./g,m=>m[1].toUpperCase())]=v}
 get firstChild(){return this.children[0]??null}
 get ownerDocument(){return {createElement:()=>new El('')}}
 appendChild(c){c.parent=this;this.children.push(c);return c}
 insertBefore(c,ref){c.parent=this;this.children.splice(this.children.indexOf(ref)>=0?this.children.indexOf(ref):this.children.length,0,c);return c}
 remove(){this.parent.children=this.parent.children.filter(x=>x!==this)}
 getAttribute(k){return this.attrs[k]??null}
 has(c){return this.className.split(' ').includes(c)}
 querySelector(sel){return this.querySelectorAll(sel)[0]??null}
 querySelectorAll(sel){
  const out=[];const walk=(e)=>{for(const c of e.children){if(match(c,sel))out.push(c);walk(c)}};
  const match=(c,s)=>s==='.tile'?c.has('tile'):s==='.pip'?c.has('pip'):s===':scope > .udot'?c.has('udot')&&c.parent===this:s==='#rail .chs .ch[data-ch]'?c.has('ch')&&'data-ch' in c.attrs:s==='#chlist a.chr[data-mch]'?c.has('chr'):false;
  walk(this);return out}}
const rail=new El('chs');const mk=slug=>{const b=new El('ch',{'data-ch':slug});b.appendChild(new El('tile'));rail.appendChild(b);return b};
const a=mk('tcinfra'),b=mk('llms'),c=mk('quiet');
const list=new El('chlist');const row=slug=>{const r=new El('chr',{href:'#/'+slug,'data-mch':''});r.appendChild(new El('chtile'));list.appendChild(r);return r};
const ra=row('tcinfra'),rb=row('llms'),rc=row('quiet');
const root=new El('root');root.appendChild(rail);root.appendChild(list);
const pips=e=>e.querySelectorAll('.pip').length,udots=e=>e.children.filter(x=>x.has('udot')).length;
let state={tcinfra:'New result',llms:null,quiet:null};
paintChannelDots(root,s=>state[s]??null);
assert.equal(pips(a.children[0]),1,'a channel that got an unread task gets its dot without a full redraw');assert.equal(pips(b.children[0]),0);assert.equal(udots(ra),1);assert.equal(ra.children[0].has('udot'),true);assert.equal(udots(rb),0);
paintChannelDots(root,s=>state[s]??null);assert.equal(pips(a.children[0]),1,'repainting twice never doubles a dot');assert.equal(udots(ra),1);
state={tcinfra:'Needs you',llms:'New result',quiet:null};paintChannelDots(root,s=>state[s]??null);
assert.equal(a.children[0].querySelector('.pip').title,'Needs you','title follows the state');assert.equal(pips(b.children[0]),1);assert.equal(udots(rb),1);
state={tcinfra:null,llms:null,quiet:null};paintChannelDots(root,s=>state[s]??null);
for(const x of [a,b,c])assert.equal(pips(x.children[0]),0,'read tasks clear every dot');for(const r of [ra,rb,rc])assert.equal(udots(r),0);
// The wiring in v3.ts: refresh() and repaint() both call it, with the rule the rows use.
import fs from 'node:fs';const v3=fs.readFileSync(new URL('../src/v3.ts', import.meta.url),'utf8');
assert.match(v3,/function repaint\(ch: Channel\) \{\s*paintChannelDots\(document, chDotKind\)/,'every repaint paints the channel dots');
assert.match(v3,/clearFresh\(ch\);\s*paintChannelDots\(document, chDotKind\)/,'refresh paints the channel dots on every branch');
assert.match(v3,/const chDotKind = .*rowLit.*needsYou/,'the channel dot reads the same rule as the task row dot');
console.log('Channel list dots: added, cleared, retitled, never doubled, wired into refresh and repaint passed.');
