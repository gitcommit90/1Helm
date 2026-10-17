import {joinedReply, workStep, type LiveReply} from './progress-dedupe';
const held = new WeakMap<object,string>();
export const progressReset = (m: object) => held.delete(m);
export function progressSnapshot(m: LiveReply, state: unknown): boolean {
  if(!state || typeof state!=='object')return false;
  const v=state as Record<string,unknown>, strings=(x: unknown): x is string[] => Array.isArray(x)&&x.every(s=>typeof s==='string');
  if(typeof v.body!=='string'||!strings(v.pre)||!strings(v.prog)||typeof v.held_progress!=='string')return false;
  if(v.held_progress && v.held_progress!==v.prog.at(-1))return false;
  m.body=v.body;m.pre=[...v.pre];m.prog=[...v.prog];
  const target=m as LiveReply & {progressOmitted?:number};
  if(typeof v.progress_omitted==='number'&&Number.isSafeInteger(v.progress_omitted)&&v.progress_omitted>0)target.progressOmitted=v.progress_omitted;
  else delete target.progressOmitted;
  held.set(m,v.held_progress);return true;
}
export function progressWorked(m: LiveReply) {
  const n=m.prog?.length || 0, changed=workStep(m);
  if(changed)held.set(m,(m.prog?.length || 0)>n ? m.prog!.at(-1)! : '');
  return changed;
}

// The protocol only classifies text at work/done. Never hold back incoming answer
// text while guessing: work retains the last note; the next text replaces it.
export function progressSlot(m: {body: string; pre?: string[]; prog?: string[]}, live: boolean) {
  const latest = live && !m.body.trim() ? held.get(m)?.trim() || '' : '';
  return {text: joinedReply(m.pre, m.body.trim() ? m.body : latest), mode: latest ? 'progress' : live ? 'stream' : 'answer',
    part: latest ? `progress-${m.prog!.length - 1}` : 'part'};
}

type Before = {row: HTMLElement; slot: HTMLElement; rect: DOMRect; hash: string};
const settled = new WeakSet<object>();
let effect: (() => void) | undefined;
let scrollAtPaint: {element: HTMLElement; top: number; left: number} | undefined;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clear = () => { effect?.(); effect = undefined; };
window.addEventListener('hashchange', clear);
window.addEventListener('pagehide', clear);
document.addEventListener('scroll', e => {
  // paintChat follows the bottom before starting the effect. Its queued scroll
  // event is not a user navigation; a subsequent changed position cancels it.
  if(scrollAtPaint && e.target===scrollAtPaint.element && scrollAtPaint.element.scrollTop===scrollAtPaint.top && scrollAtPaint.element.scrollLeft===scrollAtPaint.left)return;
  clear();
}, true);
document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });

export function progressBefore(id: number): Before | undefined {
  const row = document.querySelector<HTMLElement>(`.msgs .m.agent[data-mr="${id}"]`), slot = row?.querySelector<HTMLElement>('.reply-slot');
  if (!row || !slot) return;
  return {row, slot, rect: slot.querySelector('.body')?.getBoundingClientRect() || slot.getBoundingClientRect(), hash: location.hash};
}

export function progressAfter(before: Before | undefined, message: object, final: boolean) {
  if (!before || !before.row.isConnected || before.hash !== location.hash) return;
  if (final) { if (settled.has(message)) return; settled.add(message); }
  clear();
  if (reduced() || document.hidden) return;
  const sc=document.getElementById('scroll');scrollAtPaint=sc?{element:sc,top:sc.scrollTop,left:sc.scrollLeft}:undefined;
  const slot = before.row.querySelector<HTMLElement>('.reply-slot');
  if (slot !== before.slot) return;
  // Fade in the replacement in the same slot. No outgoing duplicate text, no
  // height animation, and no opacity flicker on every token/status repaint.
  const reveal = !final ? slot.animate([{opacity:.55,transform:'translateY(2px)'},{opacity:1,transform:'none'}],{duration:180,easing:'ease-out'}) : undefined;
  const activity = before.row.closest('.msgs')?.querySelector<HTMLElement>('.primary-activity activity-orb');
  if (!activity) { effect = () => reveal?.cancel(); return; }
  // The outgoing confirmed note becomes dust at the first incoming word, which
  // might be another note or the final answer. Its old bounds are the source;
  // incoming text remains readable and no old text is resurrected or duplicated.
  const target=activity.getBoundingClientRect(), r=before.rect;
  if (!r.width || !r.height || r.bottom<0 || r.top>innerHeight || target.top>innerHeight) return;
  const layer=document.createElement('div');layer.className='progress-dust';layer.setAttribute('aria-hidden','true');layer.inert=true;
  const animations: Animation[]=[];
  for(let i=0;i<12;i++){
    const dot=document.createElement('i'), x=r.left+Math.min(r.width,280)*((i+.5)/12), y=r.top+Math.min(r.height,52)*(i%3)/3;
    dot.style.left=x+'px';dot.style.top=y+'px';layer.appendChild(dot);
    animations.push(dot.animate([{opacity:0,transform:'translate(0,0) scale(1)'},{opacity:.5,offset:.18},{opacity:0,transform:`translate(${target.left+target.width/2-x}px,${target.top+target.height/2-y}px) scale(.15)`}],{duration:520+i%3*35,easing:'cubic-bezier(.3,.05,.6,1)',fill:'forwards'}));
  }
  document.body.appendChild(layer);
  const timer=setTimeout(clear,650);
  effect=()=>{clearTimeout(timer);animations.forEach(a=>a.cancel());reveal?.cancel();layer.remove();};
}
