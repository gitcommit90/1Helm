// Environment-wide model controls. Only MODEL_ADMINS grants access, never TEST_MODE or ops view-as.
import { modelSettingsView, saveModelSettings, restoreModelSettings, readModelSettings } from "./model-settings.js";
import { modelCatalog } from "./model-catalog.js";
import { boundedText, BodyTooLargeError } from "../bounded-body.js";
import { modelDashboard } from "./model-dashboard.js";
import { outsideModels } from "./outside-models.js";

const HEADERS = { "cache-control": "no-store, private", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "content-security-policy": "frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...HEADERS, "content-type": "application/json;charset=utf-8", ...extra } });
const html = (value, status = 200) => new Response(value, { status, headers: { ...HEADERS, "content-type": "text/html;charset=utf-8" } });
export const isModelAdmin = (env, user) => !!user?.email && String(env.MODEL_ADMINS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean).includes(String(user.email).toLowerCase());

export async function modelsRoute(req, env, user) {
  const url = new URL(req.url), path = url.pathname, api = path !== "/models";
  if (!user) return api ? json({ error: "Sign in again to manage models." }, 401) : new Response(null, { status: 302, headers: { ...HEADERS, location: "/onboard?next=/models" } });
  if (!isModelAdmin(env, user)) return api ? json({ error: "This account cannot manage models." }, 403) : html('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Models · 1Helm</title><h1>Models</h1><p>This account cannot manage models.</p><p><a href="/">Back to 1Helm</a></p></html>', 403);
  const catalog = path === "/models/api/catalog", read = path === "/models" || path === "/models/api" || catalog;
  const action = { "/models/api/save": saveModelSettings, "/models/api/restore": restoreModelSettings }[path];
  if (!read && !action) return json({ error: "Not found." }, 404);
  if (read ? !["GET", "HEAD"].includes(req.method) : req.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: read ? "GET, HEAD" : "POST" });
  if (!read) {
    // All writes require exact origin proof AND a custom header AND JSON. Cross-site forms
    // and opaque/null origins cannot mutate settings using an administrator's cookie.
    if (req.headers.get("origin") !== url.origin || req.headers.get("sec-fetch-site") === "cross-site" || req.headers.get("x-model-settings") !== "1" || !/^application\/json(?:\s*;|\s*$)/i.test(req.headers.get("content-type") || "")) return json({ error: "Open Models on this site and try again." }, 403);
    if (Number(req.headers.get("content-length")) > 32768) return json({ error: "Settings request is too large." }, 413);
  }
  try {
    let view;
    if (catalog) view = await modelCatalog(env, { q: String(url.searchParams.get("q") || "").slice(0, 120), settings: (await readModelSettings(env)).config });
    else if (read) view = await modelSettingsView(env);
    else {
      const raw = await boundedText(req, 32768);
      if (new TextEncoder().encode(raw).length > 32768) return json({ error: "Settings request is too large." }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "Settings must be valid JSON." }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Settings must be a JSON object." }, 400);
      view = await action(env, body, user.email);
    }
    if (!catalog) view = { ...view, dashboard: modelDashboard(view), outside: outsideModels(env) };
    const response = path === "/models" ? html(modelsHtml(view, env)) : json(view);
    return req.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json({ error: "Settings request is too large." }, 413);
    // Validation messages are intentional API output; database/provider internals never are.
    const status = [400, 404, 409, 503].includes(e?.status) ? e.status : 503;
    const error = e?.modelSettings ? e.message : status === 503 ? catalog ? "OpenRouter's model catalog is unavailable. Your settings have not changed; try again shortly." : "Model settings are temporarily unavailable. Try again shortly." : e.message;
    return api ? json({ error }, status) : html(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Models · 1Helm</title><h1>Models</h1><p>${esc(error)}</p><p><a href="/models">Try again</a></p></html>`, status);
  }
}

const CSS = `@font-face{font-family:IS;src:url(/fonts/instrument-sans.woff2)}@font-face{font-family:ISe;src:url(/fonts/instrument-serif.woff2)}
:root{--bg:#f3f2ef;--card:#fff;--ink:#1c1b19;--muted:#625e56;--line:#dedbd3;--line2:#c9c5bb;--soft:#e8e6e0;--ok:#2d6a2d;--bad:#9b2c1f;--tag:#e4eadc;--warn:#fff1d6;--warnline:#b97a12;--focus:#9a6500}
@media(prefers-color-scheme:dark){:root{--bg:#161512;--card:#201f1b;--ink:#efede7;--muted:#a8a398;--line:#38352f;--line2:#4a463e;--soft:#2a2823;--ok:#8fcf8f;--bad:#ff9d8f;--tag:#2c3a2c;--warn:#3a2f12;--warnline:#8a6a12;--focus:#f5bd3c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 IS,system-ui,sans-serif}main{max-width:1040px;margin:auto;padding:36px 24px 80px}a{color:inherit;text-underline-offset:4px}
nav{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:24px}.back{margin-right:auto;color:var(--muted);font-size:13px}.environments{display:flex;gap:4px;padding:4px;background:var(--soft);border-radius:999px}.environments a{padding:7px 15px;border-radius:999px;text-decoration:none;font-size:13px}.environments a[aria-current=page]{background:var(--ink);color:var(--bg)}
h1{font:400 44px/1.1 ISe,Georgia,serif;margin:0 0 8px}h2{font-size:17px;margin:0}p{margin:6px 0}.lead{color:var(--muted);margin:0 0 6px}.muted{color:var(--muted);font-size:13px}
.group{margin-top:28px}.group-head{margin-bottom:8px}.group-head p{color:var(--muted);font-size:13px;margin:2px 0 0}
.jobs{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.job{padding:8px 18px;border-top:1px solid var(--line)}.job:first-child{border-top:0}
.jrow{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1.1fr) 150px auto;gap:12px;align-items:center;min-height:40px}
.job-name{font-weight:600;line-height:1.25}.job-desc{font-size:12px;color:var(--muted);margin:0;line-height:1.3}.job-needs{font-size:12px;color:var(--muted);margin:2px 0 0;line-height:1.3;font-style:italic}
.job-model{font-weight:600;overflow-wrap:anywhere;line-height:1.25}
.actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;align-items:center}
.fixed{font-size:13px;color:var(--muted)}
select{display:block;min-height:34px;width:100%;background:var(--card);color:var(--ink);border:1px solid var(--line2);border-radius:9px;padding:4px 24px 4px 10px;font:14px IS,system-ui,sans-serif}
button{font:600 13px IS,system-ui,sans-serif;border:1px solid var(--line2);background:var(--card);color:var(--ink);border-radius:999px;padding:6px 14px;min-height:34px;cursor:pointer}button:disabled,select:disabled{cursor:default;opacity:.5}button:hover:enabled{filter:brightness(.96)}
button.small{padding:4px 10px;min-height:30px}button.link{border:0;background:none;color:var(--muted);text-decoration:underline;text-underline-offset:3px;padding:6px 4px;font-weight:500}
.jpanel{margin:8px 0 6px;padding:10px;background:var(--soft);border-radius:10px}.jpanel[hidden]{display:none}
.entries{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.entry{display:grid;grid-template-columns:minmax(0,1.5fr) 150px auto;gap:10px;align-items:center;padding:6px 8px;background:var(--card);border-radius:8px}
.entry-name{font-weight:600;overflow-wrap:anywhere}.entry-role{display:block;font-size:11px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.entry-id{display:block;font-size:12px;font-weight:400;color:var(--muted);overflow-wrap:anywhere}
.privacy{display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0 0;font-size:12px;color:var(--muted)}.privacy b{font-weight:600;color:var(--ink)}
.privacy.alert{color:var(--bad);font-weight:600}.privacy.alert b{color:var(--bad)}
.warn{margin:6px 0 0;font-size:12px;background:var(--warn);border:1px solid var(--warnline);border-radius:8px;padding:4px 10px}
.status{font-size:12px;min-height:0;margin:4px 0 0;color:var(--muted)}.status.ok{color:var(--ok)}.status.error{color:var(--bad)}.status:empty{display:none}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
#page-status{font-size:13px;margin:12px 0 0}#page-status.error{color:var(--bad)}
.banner{background:var(--warn);color:var(--ink);border:1px solid var(--warnline);padding:12px 14px;border-radius:12px;margin:14px 0}
.footnote{font-size:12px;color:var(--muted);margin:24px 0 0}
details.history{margin-top:28px}details.history summary{cursor:pointer;font-weight:600}.history ul{list-style:none;margin:8px 0 0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:12px}.history li{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 14px;border-top:1px solid var(--line);font-size:13px}.history li:first-child{border-top:0}
dialog.picker{border:1px solid var(--line);border-radius:18px;padding:0;width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 48px);background:var(--card);color:var(--ink)}dialog.picker::backdrop{background:#0006}
dialog.picker[open]{display:flex;flex-direction:column}.picker-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:16px 18px 8px}.picker-head h2{font-size:17px}.picker-head p{font-size:12px;color:var(--muted);margin:2px 0 0}
.picker-search{display:block;padding:0 18px 8px}.picker-search input{width:100%;min-height:42px;border:1px solid var(--line2);border-radius:9px;padding:8px 10px;font:14px IS,system-ui,sans-serif;background:var(--card);color:var(--ink)}
.picker-list{overflow:auto;overscroll-behavior:contain;min-height:0;padding:0 8px 8px;margin:0;list-style:none}.picker-list h3{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:10px 10px 4px}
.picker-list button{display:block;width:100%;text-align:left;border:0;border-radius:10px;background:none;font-weight:500;padding:8px 10px;min-height:0}.picker-list button:hover:enabled{background:var(--soft);filter:none}.picker-list button b{display:block;font-weight:600}.picker-list button span{display:block;font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.picker-foot{padding:8px 18px 14px;font-size:12px;color:var(--muted);border-top:1px solid var(--line)}
@media(max-width:760px){main{padding:24px 16px 60px}h1{font-size:36px}.job{padding:10px 14px}.jrow{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"n a" "m m" "e e";gap:6px 10px}.jrow>.c-name{grid-area:n}.jrow>.c-model{grid-area:m}.jrow>.c-effort{grid-area:e}.jrow>.actions{grid-area:a}.entry{grid-template-columns:1fr;gap:8px}dialog.picker{width:100%;max-width:none;margin:auto 0 0;border-radius:18px 18px 0 0;max-height:90dvh}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;

// Plain script text. Every dynamic value is inserted with textContent, never innerHTML.
const JS = `(function(){
var state=JSON.parse(document.getElementById('model-state').textContent),busy=false,target=null,seq=0,timer=null;
var EFFORT={none:'Reasoning off',default:'Provider default',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra high',max:'Maximum'};
var pageStatus=document.getElementById('page-status'),root=document.getElementById('groups');
var picker=document.getElementById('model-picker'),search=document.getElementById('catalog-query'),list=document.getElementById('picker-list'),pickerStatus=document.getElementById('picker-status');
function E(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function clone(x){return JSON.parse(JSON.stringify(x))}
function eff(e){return EFFORT[e]||e||''}
function say(el,text,cls){el.textContent=text||'';el.className=el.className.replace(/ ?(ok|error)/g,'')+(cls?' '+cls:'')}
function defOf(id){return state.options.jobs.find(function(j){return j.id===id})}
function viewOf(id){return state.dashboard.jobs.find(function(j){return j.id===id})}
function takesChat(v){return ['chat','chore','classic'].indexOf(v.pick)>=0||!!v.any}
function nameOf(id){var m=state.config.catalog[id];return m&&m.name?m.name:id}
function entriesOf(job){return [{model:job.model,effort:job.effort,hosts:job.hosts,pin:job.pin,strict:job.strict}].concat(job.fallbacks||[])}
function pack(entries){var first=clone(entries[0]);first.fallbacks=entries.slice(1).map(function(e){return clone(e)});Object.keys(first).forEach(function(k){if(first[k]===undefined)delete first[k]});first.fallbacks.forEach(function(f){Object.keys(f).forEach(function(k){if(f[k]===undefined)delete f[k]})});return first}
function effortsFor(id){var m=state.config.catalog[id];return m&&m.efforts?m.efforts:[]}
var open={};
function row(job,idx,total,li){
 var e=document.createElement('li');e.className='entry';var v=viewOf(job.id);
 var a=E('div','entry-name');a.append(E('span','entry-role',idx===0?'Model':'Fallback '+idx));
 var entry=idx===0?job.main:job.fallbacks[idx-1];
 a.append(document.createTextNode(entry.name),E('span','entry-id',entry.id));
 var mid=E('div');
 if(v.has_effort){var ch=effortsFor(entry.id);if(ch.length>1){var es=E('select');es.setAttribute('aria-label','Reasoning for '+v.label+(idx?' fallback '+idx:''));ch.forEach(function(x){var o=E('option','',eff(x));o.value=x;es.append(o)});es.value=entry.effort;es.addEventListener('change',function(){edit(job.id,li,function(arr){arr[idx].effort=es.value})});mid.append(es)}else mid.append(E('span','fixed',eff(entry.effort)))}
 var act=E('div','actions');
 var change=E('button','small','Change');change.type='button';change.setAttribute('aria-label','Change '+(idx?'fallback '+idx:'model')+' for '+v.label);change.addEventListener('click',function(){openPicker(job.id,idx)});act.append(change);
 if(total>1){
  if(idx>0){var up=E('button','small','Up');up.type='button';up.setAttribute('aria-label','Move up');up.addEventListener('click',function(){edit(job.id,li,function(arr){var t=arr[idx-1];arr[idx-1]=arr[idx];arr[idx]=t})});act.append(up)}
  if(idx<total-1){var dn=E('button','small','Down');dn.type='button';dn.setAttribute('aria-label','Move down');dn.addEventListener('click',function(){edit(job.id,li,function(arr){var t=arr[idx+1];arr[idx+1]=arr[idx];arr[idx]=t})});act.append(dn)}
  if(idx>0){var rm=E('button','small','Remove');rm.type='button';rm.setAttribute('aria-label','Remove from '+v.label);rm.addEventListener('click',function(){edit(job.id,li,function(arr){arr.splice(idx,1)})});act.append(rm)}
 }
 e.append(a,mid,act);return e
}
function card(v){
 var li=E('li','job');li.dataset.job=v.id;var n=1+v.fallbacks.length;
 var r=E('div','jrow'),nm=E('div','c-name');nm.append(E('div','job-name',v.label),E('p','job-desc',v.description));if(v.needs)nm.append(E('p','job-needs',v.needs));
 var md=E('div','c-model job-model',v.main.name),ef=E('div','c-effort');
 if(v.has_effort){var ch=effortsFor(v.main.id);if(ch.length>1){var es=E('select');es.setAttribute('aria-label','Reasoning for '+v.label);ch.forEach(function(x){var o=E('option','',eff(x));o.value=x;es.append(o)});es.value=v.main.effort;es.addEventListener('change',function(){edit(v.id,li,function(arr){arr[0].effort=es.value})});ef.append(es)}else ef.append(E('span','fixed',eff(v.main.effort)))}
 var act=E('div','actions');
 var change=E('button','','Change');change.type='button';change.setAttribute('aria-label','Change model for '+v.label);change.addEventListener('click',function(){openPicker(v.id,0)});act.append(change);
 var panel=E('div','jpanel');panel.hidden=!open[v.id];panel.id='fb-'+v.id.replace(/[^a-z0-9]/gi,'-');
 var tg=E('button','small','Fallbacks ('+v.fallbacks.length+')');tg.type='button';tg.setAttribute('aria-expanded',open[v.id]?'true':'false');tg.setAttribute('aria-controls',panel.id);
 tg.addEventListener('click',function(){open[v.id]=!open[v.id];panel.hidden=!open[v.id];tg.setAttribute('aria-expanded',open[v.id]?'true':'false')});if(v.max_fallbacks>0)act.append(tg);
 r.append(nm,md,ef,act);li.append(r);
 var ul=E('ol','entries');ul.setAttribute('aria-label','Models for '+v.label);
 for(var i=0;i<n;i++)ul.append(row(v,i,n,li));
 panel.append(ul);
 if(v.fallbacks.length<v.max_fallbacks){var add=E('button','small','Add fallback');add.type='button';add.style.marginTop='8px';add.addEventListener('click',function(){openPicker(v.id,n)});panel.append(add)}
 if(v.max_fallbacks>0)li.append(panel);
 var lv=['unrestricted','no_training','zdr'];
 if(v.privacy==='list'){
  var none=lv.some(function(l){return !v.coverage[l].allowed}),differs=lv.some(function(l){var c=v.coverage[l];return c.allowed&&c.first!==v.main.name});
  if(none||differs){var p=E('p','privacy'+(none?' alert':''));lv.forEach(function(l){var c=v.coverage[l],s=E('span');s.append(E('b','',state.dashboard.level_labels[l]+': '));s.append(c.allowed?E('span','',c.first):E('span','','no allowed model'));p.append(s)});li.append(p)}
 }
 else if(v.privacy==='zdr'&&open[v.id])panel.append(E('p','job-desc','Always uses zero-data-retention providers, whatever the privacy setting.'));
 v.warnings.forEach(function(w){if(/no allowed model/.test(w)||open[v.id]){var d=E('p','warn',w);d.setAttribute('role','note');li.append(d)}});
 var st=E('p','status');st.setAttribute('role','status');st.setAttribute('aria-live','polite');li.append(st);
 return li
}
function render(){
 var b=document.getElementById('banner');b.hidden=!state.stale;b.textContent=state.stale?'The saved settings could not be read just now, so this page and running tasks are using the last copy that was read. Check the logs, then reload.':'';
 root.replaceChildren();
 state.dashboard.groups.forEach(function(g){
  var jobs=state.dashboard.jobs.filter(function(j){return j.group===g.id});if(!jobs.length)return;
  var sec=E('section','group'),head=E('div','group-head'),ul=E('ul','jobs');head.append(E('h2','',g.title));if(g.note)head.append(E('p','',g.note));
  jobs.forEach(function(j){ul.append(card(j))});sec.append(head,ul);root.append(sec)
 });
 var out=document.getElementById('outside');out.replaceChildren();
 if((state.outside||[]).length){var oh=E('div','group-head');oh.append(E('h2','','Chosen elsewhere'),E('p','','Read only. These models are not set on this page.'));out.append(oh);
  state.outside.forEach(function(g){var sec=E('section','group'),head=E('div','group-head'),ul=E('ul','jobs');head.append(E('h2','',g.title));if(g.note)head.append(E('p','',g.note));
   g.items.forEach(function(i){var li=E('li','job'),n=E('div','c-name');n.append(E('strong','',i.label));li.append(n,E('div','c-model',i.model));if(i.detail)li.append(E('p','muted',i.detail));ul.append(li)});sec.append(head,ul);out.append(sec)})}
 var h=document.getElementById('history-list');h.replaceChildren();
 (state.history||[]).forEach(function(x){var li=E('li');var t=E('span','',new Date(x.at).toLocaleString()+' by '+x.by+': '+x.action+' (revision '+x.revision+')');li.append(t);
  if(x.revision!==state.revision){var r=E('button','small','Restore');r.type='button';r.setAttribute('aria-label','Restore revision '+x.revision);r.addEventListener('click',function(){post('restore',{revision:state.revision,restore_revision:x.revision},pageStatus)});li.append(r)}h.append(li)})
}
function lock(v){busy=v;document.querySelectorAll('#groups button,#groups select,#history-list button').forEach(function(e){e.disabled=v})}
async function post(action,body,statusEl){
 if(busy)return false;lock(true);say(statusEl,'Saving…');
 try{
  var r=await fetch('/models/api/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-model-settings':'1'},body:JSON.stringify(body)});
  var data=await r.json().catch(function(){return{}});
  if(!r.ok){
   if(r.status===401){say(statusEl,'Not saved. Sign in again and retry.','error');lock(false);return false}
   var msg='Not saved. '+(data.error||'Try again.');
   if(r.status===409){try{var latest=await (await fetch('/models/api',{credentials:'same-origin',cache:'no-store'})).json();state=latest;render();say(pageStatus,msg+' Showing the latest settings.','error')}catch(e){say(statusEl,msg,'error')}}
   else say(statusEl,msg,'error');
   lock(false);return false
  }
  var key=statusEl.closest&&statusEl.closest('[data-job]')?statusEl.closest('[data-job]').dataset.job:null;
  state=data;render();lock(false);
  var fresh=key?document.querySelector('[data-job="'+key+'"] .status'):pageStatus;if(fresh){say(fresh,'Saved','ok');setTimeout(function(){if(fresh.textContent==='Saved')say(fresh,'')},4000)}
  return true
 }catch(e){say(statusEl,'Not saved. Check your connection and try again.','error');lock(false);return false}
}
function edit(id,li,fn){
 var cfg=clone(state.config),arr=entriesOf(cfg.jobs[id]);
 if(fn(arr)===false||!arr.length)return;cfg.jobs[id]=pack(arr);
 return post('save',{revision:state.revision,config:{version:2,jobs:cfg.jobs}},li.querySelector('.status'))
}
function openPicker(id,idx){
 if(busy)return;var v=viewOf(id);target={id:id,idx:idx,def:defOf(id),view:v};
 document.getElementById('picker-title').textContent=(idx===0?'Model':idx>=1+v.fallbacks.length?'New fallback':'Fallback '+idx)+' for '+v.label;
 var cur=idx<=v.fallbacks.length?(idx===0?v.main:v.fallbacks[idx-1]):null;
 document.getElementById('picker-now').textContent=cur?'In use now: '+cur.name:'';
 var chat=takesChat(v);
 document.getElementById('picker-note').textContent=v.needs?v.needs:v.any?'Any chat model with a zero-data-retention provider can do this job, and so can the special decision models.':v.pick==='chore'?'Only models with a zero-data-retention provider are offered.':chat?'':'Pick a listed model, or type another model ID.';
 search.value='';search.placeholder=chat?'Search by name, provider or ID':'Search the list, or type a model ID';list.replaceChildren();pickerStatus.textContent=chat?'Loading models…':'';
 if(!picker.open)picker.showModal();search.focus();loadCatalog()
}
function closePicker(){clearTimeout(timer);seq++;if(picker.open)picker.close();target=null}
function modelButton(m,sub,onPick){var li=E('li'),b=E('button');b.type='button';b.append(E('b','',m.name),E('span','',sub));b.addEventListener('click',onPick);li.append(b);return li}
function inUse(q){
 var all=state.options.choices[target.view.pick]||[],taken={};
 entriesOf(state.config.jobs[target.id]).forEach(function(e,i){if(i!==target.idx)taken[e.model]=1});
 return all.filter(function(m){return !taken[m.id]&&(!q||(m.name+' '+m.id).toLowerCase().indexOf(q.toLowerCase())>=0)})
}
function priceLine(m){var p=m.pricing;return p&&p.prompt!=null&&p.completion!=null?m.id+' · $'+p.prompt+' in, $'+p.completion+' out per million tokens':m.id}
// Saved models are listed with the live catalog's name, reasoning levels and price. The saved copy is from when the model was first picked and goes out of date.
function mergeKnown(saved,fresh,q){var by={},w=(q||'').toLowerCase();fresh.forEach(function(f){by[f.id]=f});return saved.filter(function(m){return by[m.id]||!w||(m.name+' '+m.id).toLowerCase().indexOf(w)>=0}).map(function(m){var f=by[m.id];return f?Object.assign({},m,{name:f.name||m.name,efforts:f.efforts||m.efforts,default_effort:f.default_effort,pricing:f.pricing}):m})}
async function loadCatalog(){
 var mine=++seq,q=search.value.trim(),chat=takesChat(target.view);
 list.replaceChildren();var local=inUse(q);
 if(!chat){
  if(local.length){list.append(E('h3','','Already known'));local.forEach(function(m){list.append(modelButton(m,m.id,function(){choose(m)}))})}
  var typed=q.length>2&&/^[@~a-zA-Z0-9][a-zA-Z0-9._~:-]*(\\/[a-zA-Z0-9][a-zA-Z0-9._:~-]*)+$/.test(q)&&!local.some(function(m){return m.id===q});
  if(typed){list.append(E('h3','','Other model ID'));list.append(modelButton({id:q,name:q,efforts:[]},'Use this model ID exactly as typed',function(){choose({id:q,name:q,efforts:[]})}))}
  pickerStatus.textContent=local.length||typed?'':'No match. Type a full model ID such as provider/model-name.';return
 }
 try{
  var r=await fetch('/models/api/catalog?q='+encodeURIComponent(q),{credentials:'same-origin',cache:'no-store'}),data=await r.json();
  if(mine!==seq)return;if(!r.ok)throw new Error(data.error||'Could not load models.');
  local=mergeKnown(inUse(''),data.models,q);var ids={};local.forEach(function(m){ids[m.id]=1});
  var taken={};entriesOf(state.config.jobs[target.id]).forEach(function(e,i){if(i!==target.idx)taken[e.model]=1});
  var more=data.models.filter(function(m){return m.eligible&&!ids[m.id]&&!taken[m.id]&&(target.view.privacy!=='zdr'||(m.levels||[]).indexOf('zdr')>=0)});
  list.replaceChildren();
  if(local.length){list.append(E('h3','','Already known'));local.forEach(function(m){list.append(modelButton(m,priceLine(m),function(){choose(m)}))})}
  if(more.length)list.append(E('h3','','More models'));
  more.slice(0,40).forEach(function(m){list.append(modelButton(m,priceLine(m),function(){choose(m)}))});
  pickerStatus.textContent=local.length+more.length?(more.length>40?'Showing 40 of '+more.length+'. Type to narrow the list.':''):'No eligible models match.'
 }catch(e){if(mine!==seq)return;if(local.length){list.replaceChildren(E('h3','','Already known (saved copy)'));local.forEach(function(m){list.append(modelButton(m,m.id,function(){choose(m)}))})}pickerStatus.textContent=e.message||'Could not load models. Try again.'}
}
function choose(m){
 var t=target;closePicker();var li=document.querySelector('[data-job="'+t.id+'"]'),pick=t.view.pick,hasEffort=t.view.has_effort;
 edit(t.id,li,function(arr){
  var old=arr[t.idx],efforts=m.efforts||effortsFor(m.id),cur=old?old.effort:null,next=null;
  if(hasEffort)next=efforts.indexOf(cur)>=0?cur:(m.default_effort&&efforts.indexOf(m.default_effort)>=0?m.default_effort:efforts[0]);
  var e={model:m.id,effort:next};if(pick==='chore'||pick==='classic'||(t.view.any&&(m.chat||m.eligible)))e.strict=true;
  if(old&&old.model===m.id)return false;
  if(t.idx>=arr.length)arr.push(e);else arr[t.idx]=e
 })
}
search.addEventListener('input',function(){clearTimeout(timer);seq++;pickerStatus.textContent='Searching…';timer=setTimeout(loadCatalog,220)});
document.getElementById('picker-close').addEventListener('click',closePicker);
picker.addEventListener('cancel',function(e){e.preventDefault();closePicker()});
picker.addEventListener('click',function(e){if(e.target===picker)closePicker()});
render();
})();`;

export function modelsHtml(view, env) {
  const dev = env.ENV_NAME === "dev", environment = dev ? "Dev" : "Production";
  // History contains actor strings; JSON script data must escape '<' and Unicode separators.
  if (!view.dashboard) view = { ...view, dashboard: modelDashboard(view) };
  const initial = JSON.stringify(view).replace(/</g, "\\u003c").replace(new RegExp("\\u2028", "g"), "\\u2028").replace(new RegExp("\\u2029", "g"), "\\u2029");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Models · ${environment} · 1Helm</title><link rel="icon" href="/1helm-icon-64.png"><style>${CSS}</style></head>
<body class="${dev ? "dev" : "live"}" data-environment="${environment}"><main><nav aria-label="Model settings navigation"><a class="back" href="${dev ? "/releases" : "/"}">${dev ? "← Releases" : "← 1Helm"}</a><div class="environments" aria-label="Environment">${dev ? "Development" : "Production"}</div></nav>
<h1>Models</h1><p class="lead">The model, reasoning level and fallback models saved for every job on ${environment}. The jobs listed here take their model from these settings. Accounts that bring their own key use their own endpoint, and the dev test model override (TEST_MODEL) replaces them on dev. Each change saves right away. Running tasks finish with the model they started with.</p>
<noscript>Turn on JavaScript to see and change model settings.</noscript><div class="banner" id="banner" role="alert" hidden></div><p id="page-status" role="status" aria-live="polite"></p>
<div id="groups"></div>
<div id="outside"></div>
<details class="history"><summary>History</summary><ul id="history-list"></ul></details>
<p class="footnote">Revision ${esc(view.revision)}. Only models that meet the privacy, tool and price limits are offered. When an account's privacy setting forbids a model, that model is skipped and the next one in the list is tried.</p></main>
<dialog id="model-picker" class="picker" aria-labelledby="picker-title"><div class="picker-head"><div><h2 id="picker-title">Choose a model</h2><p id="picker-now"></p><p id="picker-note"></p></div><button type="button" id="picker-close" aria-label="Close">Close</button></div>
<label class="picker-search"><input id="catalog-query" type="search" placeholder="Search by name, provider or ID" autocomplete="off" aria-label="Search models"></label>
<ul id="picker-list" class="picker-list" aria-label="Models"></ul><div class="picker-foot" id="picker-status" role="status" aria-live="polite"></div></dialog>
<script id="model-state" type="application/json">${initial}</script><script>${JS}</script></body></html>`;
}
