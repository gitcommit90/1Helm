// Environment-wide model controls. Only MODEL_ADMINS grants access, never TEST_MODE or ops view-as.
import { modelSettingsView, saveModelSettings, restoreModelSettings, readModelSettings } from "./model-settings.js";
import { modelCatalog } from "./model-catalog.js";
import { boundedText, BodyTooLargeError } from "../bounded-body.js";
import { modelDashboard } from "./model-dashboard.js";
import { outsideModels } from "./outside-models.js";
import { pageDialog } from "../page-dialog.js";

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
    if (Number(req.headers.get("content-length")) > (env.DYNAMIC_ROUTING === "on" ? 131072 : 32768)) return json({ error: "Settings request is too large." }, 413);
  }
  try {
    let view;
    if (catalog) view = await modelCatalog(env, { q: String(url.searchParams.get("q") || "").slice(0, 120), settings: (await readModelSettings(env)).config });
    else if (read) view = await modelSettingsView(env);
    else {
      const limit = env.DYNAMIC_ROUTING === "on" ? 131072 : 32768;
      const raw = await boundedText(req, limit);
      if (new TextEncoder().encode(raw).length > limit) return json({ error: "Settings request is too large." }, 413);
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
    const error = e?.modelSettings ? e.message : status === 503 ? catalog ? "The model catalog is unavailable. Your settings have not changed; try again shortly." : "Model settings are temporarily unavailable. Try again shortly." : e.message;
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
.privacy-tabs{display:flex;gap:8px;margin:22px 0 12px}.privacy-tabs button[aria-selected=true]{background:var(--ink);color:var(--bg)}
.category-list{display:flex;align-items:flex-start;gap:16px;overflow-x:auto;padding:6px 2px 18px;scroll-snap-type:x proximity}.category-card{flex:0 0 310px;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:0 4px 14px #00000008;scroll-snap-align:start}.category-card h3{font-size:19px;margin:0 0 12px;overflow-wrap:anywhere}.category-choice{border-top:1px solid var(--line);padding:11px 0;overflow-wrap:anywhere}.category-choice strong{display:block;font-size:11px;color:var(--muted);margin-bottom:4px}.category-choice .entry-id{margin:3px 0 5px}.category-choice .model-name{font-weight:600;line-height:1.35}.category-add{flex:0 0 150px;border:2px dashed var(--line2);border-radius:16px;min-height:180px;background:none;font-size:32px}.category-add span{display:block;font-size:13px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.category-editing{border-color:var(--focus)}.primary-action{background:var(--ink);color:var(--bg);border-color:var(--ink)}.category-caption{font-size:11px;color:var(--muted);margin:0 0 10px}.category-title-label{display:block;font-size:11px;color:var(--muted);margin-bottom:12px}.category-title-label input{display:block;width:100%;background:var(--bg);color:var(--ink);border:1px solid var(--line2);border-radius:8px;padding:7px 9px;font:600 18px IS,system-ui,sans-serif;margin-top:4px}.category-title-label input:disabled{opacity:1;background:none;border-color:transparent;padding-left:0}.category-title-label .muted{font-size:11px}.category-editing>.actions{margin-top:12px;justify-content:flex-start}.category-choice .model-select{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left;border-radius:8px;padding:7px 9px;min-height:38px;font-size:13px;font-weight:500}.model-select .model-name{font-weight:500}.model-select .source{margin:0;flex-shrink:0}.category-choice select{margin-top:7px;font-size:12px;min-height:32px}.category-choice .fixed{display:block;font-size:12px}.source{display:inline-block!important;font-size:10px!important;font-weight:600!important;border:1px solid var(--line2);border-radius:4px;padding:0 4px;margin-left:6px;color:var(--muted)}.category-review{flex:0 0 auto;max-width:none;scroll-snap-align:start}.category-review h2{font-size:15px;margin:0 0 8px}.category-review-cards{display:flex;gap:12px}.category-review .category-card{flex-basis:280px;width:280px;box-shadow:none}.category-review .category-card h2{font-size:11px;color:var(--muted);margin-bottom:8px}.category-review>.actions{position:sticky;left:0;width:max-content;justify-content:flex-start;margin-top:12px}.category-review>h2{position:sticky;left:0;width:max-content}.category-review>.status{position:sticky;left:0;max-width:min(340px,calc(100vw - 32px))}.shared-heading{margin-top:20px}
dialog.picker.anchored{position:fixed;inset:auto;margin:0;width:min(360px,calc(100vw - 16px));max-height:min(440px,calc(100dvh - 16px));border-radius:12px;box-shadow:0 12px 36px #0003;z-index:10}.anchored .picker-head{padding:12px 12px 8px;gap:8px}.anchored .picker-head h2{font-size:14px}.anchored .picker-head p{font-size:11px}.anchored .picker-head #picker-close{padding:2px 8px;min-height:28px;font-size:12px}.anchored .picker-search{padding:0 12px 8px}.anchored .picker-search input{min-height:36px;font-size:13px}.anchored .picker-list button{padding:7px 8px;font-size:12px}.anchored .picker-list button span{font-size:11px}.anchored .picker-foot{padding:8px 12px;font-size:11px}
@media(max-width:600px){.privacy-tabs{gap:6px}.privacy-tabs button{padding:6px 11px}.category-card{flex-basis:min(310px,calc(100vw - 40px))}.category-add{flex-basis:110px}.category-review .category-card{flex-basis:280px;width:280px}}

@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;

// Plain script text. Every dynamic value is inserted with textContent, never innerHTML.
const JS = `(function(){
var state=JSON.parse(document.getElementById('model-state').textContent),busy=false,target=null,seq=0,timer=null,activeLevel='unrestricted',draft=null,pickedFacts={},postError='';
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
function effortsFor(id){var m=pickedFacts[id]||state.config.catalog[id];return m&&m.efforts?m.efforts:[]}
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
 var previousCards=root.querySelector('.category-list'),categoryScroll=previousCards?previousCards.scrollLeft:0;root.replaceChildren();
 if(state.dynamicRouting){renderRouting();root.querySelector('.category-list').scrollLeft=categoryScroll}
 state.dashboard.groups.forEach(function(g){
  var jobs=state.dashboard.jobs.filter(function(j){return j.group===g.id&&(!state.dynamicRouting||(j.group!=='chat'&&j.group!=='recovery'))});if(!jobs.length)return;
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
function lock(v){busy=v;document.querySelectorAll('#groups button,#groups select,#groups input,#history-list button').forEach(function(e){if(v){e.dataset.beforeSaveDisabled=e.disabled?'1':'0';e.disabled=true}else if(e.dataset.beforeSaveDisabled!==undefined){e.disabled=e.dataset.beforeSaveDisabled==='1';delete e.dataset.beforeSaveDisabled}})}
async function post(action,body,statusEl){
 if(busy)return false;postError='';lock(true);say(statusEl,'Saving…');
 try{
  var r=await fetch('/models/api/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-model-settings':'1'},body:JSON.stringify(body)});
  var data=await r.json().catch(function(){return{}});
  if(!r.ok){
   if(r.status===401){postError='Not saved. Sign in again and retry.';say(statusEl,postError,'error');lock(false);return false}
   var msg='Not saved. '+(data.error||'Try again.');postError=msg;
   if(r.status===409){try{var latest=await (await fetch('/models/api',{credentials:'same-origin',cache:'no-store'})).json();state=latest;render();say(pageStatus,msg+' Showing the latest settings.','error')}catch(e){say(statusEl,msg,'error')}}
   else say(statusEl,msg,'error');
   lock(false);return false
  }
  var key=statusEl.closest&&statusEl.closest('[data-job]')?statusEl.closest('[data-job]').dataset.job:null;
  state=data;if(draft&&draft.revision===body.revision)draft.revision=state.revision;render();lock(false);
  var fresh=key?document.querySelector('[data-job="'+key+'"] .status'):pageStatus;if(fresh){say(fresh,'Saved','ok');setTimeout(function(){if(fresh.textContent==='Saved')say(fresh,'')},4000)}
  return true
 }catch(e){postError='Not saved. Check your connection and try again.';say(statusEl,postError,'error');lock(false);return false}
}
function edit(id,li,fn){
 var cfg=clone(state.config),arr=entriesOf(cfg.jobs[id]);
 if(fn(arr)===false||!arr.length)return;cfg.jobs[id]=pack(arr);
 return post('save',{revision:state.revision,config:saveConfig(cfg)},li.querySelector('.status'))
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
function closePicker(restoreFocus){clearTimeout(timer);seq++;var anchor=target&&target.anchor;if(picker.open)picker.close();picker.classList.remove('anchored');picker.removeAttribute('style');target=null;if(anchor&&anchor.isConnected){anchor.setAttribute('aria-expanded','false');if(restoreFocus!==false)anchor.focus({preventScroll:true})}}
function sourceOf(m){return m.source||(m.id&&m.id.indexOf('@cf/')===0?'CF':'OR')}
function modelButton(m,sub,onPick){var li=E('li'),b=E('button');b.type='button';var title=E('b','',m.name);title.append(E('span','source',sourceOf(m)));b.append(title,E('span','',sub));b.addEventListener('click',onPick);li.append(b);return li}
function inUse(q){
 if(target.category)return categoryChoices(q);
 var all=state.options.choices[target.view.pick]||[],taken={};
 entriesOf(state.config.jobs[target.id]).forEach(function(e,i){if(i!==target.idx)taken[e.model]=1});
 return all.filter(function(m){return !taken[m.id]&&(!q||(m.name+' '+m.id).toLowerCase().indexOf(q.toLowerCase())>=0)})
}
function priceText(value){var n=Number(value);return Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:8}):String(value)}
function priceLine(m){var p=m.pricing;return p&&p.prompt!=null&&p.completion!=null?m.id+', $'+priceText(p.prompt)+' in, $'+priceText(p.completion)+' out per million tokens':m.id}
// Saved models are listed with the live catalog's name, reasoning levels and price. The saved copy is from when the model was first picked and goes out of date.
function mergeKnown(saved,fresh,q){var by={},w=(q||'').toLowerCase();fresh.forEach(function(f){by[f.id]=f});return saved.filter(function(m){return by[m.id]||!w||(m.name+' '+m.id).toLowerCase().indexOf(w)>=0}).map(function(m){var f=by[m.id];return f?Object.assign({},m,{name:f.name||m.name,efforts:f.efforts||m.efforts,default_effort:f.default_effort,pricing:f.pricing,source:f.source||m.source,levels:f.levels||m.levels,kinds:f.kinds||m.kinds,eligible:f.eligible,chat:f.chat||m.chat}):m})}
function pickerAllowed(m,ignorePrivacy){
 var t=target,v=t.view,known=state.config.catalog[m.id],meta=Object.assign({},known||{},m),kinds=meta.kinds||[];
 if(t.category)return ((meta.eligible&&meta.source!=='CF'&&(!kinds.length||kinds.indexOf('chat')>=0||kinds.indexOf('chore')>=0))||meta.chat||kinds.indexOf('chat')>=0||kinds.indexOf('chore')>=0)&&(ignorePrivacy||!meta.levels||meta.levels.indexOf(t.level)>=0);
 var chat=meta.chat||((meta.eligible&&meta.source!=='CF'&&(!kinds.length||kinds.indexOf('chat')>=0||kinds.indexOf('chore')>=0))||kinds.indexOf('chat')>=0||kinds.indexOf('chore')>=0);
 var ok=takesChat(v)?chat||(v.any&&(kinds.indexOf('decider')>=0||kinds.indexOf('workers_decider')>=0)):kinds.indexOf(v.pick)>=0;
 return ok&&(ignorePrivacy||v.privacy!=='zdr'||!meta.levels||meta.levels.indexOf('zdr')>=0)
}
function takenModels(){if(target.category)return draft.card.chains[target.level].filter(function(e,i){return e&&i!==target.idx}).map(function(e){return e.model});return entriesOf(state.config.jobs[target.id]).filter(function(e,i){return i!==target.idx}).map(function(e){return e.model})}
async function loadCatalog(){
 if(!target)return;var mine=++seq,q=search.value.trim(),local=inUse(q).filter(function(m){return pickerAllowed(m,true)}),taken=takenModels();list.replaceChildren();
 function show(models){models=models.filter(function(m){return taken.indexOf(m.id)<0&&pickerAllowed(m,true)});list.replaceChildren();models.slice(0,100).forEach(function(m){var allowed=pickerAllowed(m),row=modelButton(m,priceLine(m)+(allowed?'':'. Unavailable for this privacy level; no verified eligible provider.'),function(){choose(m)});row.querySelector('button').disabled=!allowed;list.append(row)});return models.length}
 try{
  var r=await fetch('/models/api/catalog?q='+encodeURIComponent(q),{credentials:'same-origin',cache:'no-store'}),data=await r.json();
  if(mine!==seq)return;if(!r.ok)throw new Error(data.error||'Could not load models.');
  var fresh=data.models||[];local=mergeKnown(inUse(''),data.models,q);var merged=local,ids={};merged.forEach(function(m){ids[m.id]=1});
  var count=show(merged.concat(fresh.filter(function(m){return m.eligible&&!ids[m.id]})));
  pickerStatus.textContent=count?(count>100?'Showing 100 of '+count+'. Type to narrow the list.':'OR = OpenRouter. CF = Cloudflare.'):'No compatible models match this job and privacy level.'
 }catch(e){if(mine!==seq)return;show(local);pickerStatus.textContent=e.message||'Could not load models. Try again.'}
}

function choose(m){
 var t=target;closePicker();if(t.category){pickedFacts[m.id]=m;var prev=draft.card.chains[t.level][t.idx],efforts=m.efforts||effortsFor(m.id);draft.card.chains[t.level][t.idx]={model:m.id,effort:efforts.indexOf(prev&&prev.effort)>=0?prev.effort:(m.default_effort||efforts[0]||'default')};draft.error='';render();focusCategorySlot(t.idx);return}
 var li=document.querySelector('[data-job="'+t.id+'"]'),pick=t.view.pick,hasEffort=t.view.has_effort;
 edit(t.id,li,function(arr){
  var old=arr[t.idx],efforts=m.efforts||effortsFor(m.id),cur=old?old.effort:null,next=null;
  if(hasEffort)next=efforts.indexOf(cur)>=0?cur:(m.default_effort&&efforts.indexOf(m.default_effort)>=0?m.default_effort:efforts[0]);
  var e={model:m.id,effort:next};if(pick==='chore'||pick==='classic'||(t.view.any&&(m.chat||m.eligible)))e.strict=true;
  if(old&&old.model===m.id)return false;
  if(t.idx>=arr.length)arr.push(e);else arr[t.idx]=e
 })
}
function saveConfig(cfg){var out={version:cfg.version,jobs:cfg.jobs};if(cfg.version===3)out.routing=cfg.routing;return out}
var LEVELS=['unrestricted','no_training','zdr'],LEVEL_NAMES={unrestricted:'Unrestricted',no_training:'No Training',zdr:'ZDR'},ORDINALS=['1st','2nd','3rd'];
function categories(){return state.config.routing.categories}
function metaOf(id){return pickedFacts[id]||state.config.catalog[id]||{id:id,name:id}}
function categoryChoices(q){return (state.options.choices.chat||[]).concat(Object.keys(pickedFacts).map(function(id){return pickedFacts[id]})).filter(function(m,i,a){return a.findIndex(function(n){return n.id===m.id})===i&&(!q||(m.name+' '+m.id).toLowerCase().indexOf(q.toLowerCase())>=0)})}
function button(text,fn,cls){var b=E('button',cls||'',text);b.type='button';b.addEventListener('click',fn);return b}
function categorySlot(card,level,idx,editable){
 var field=E('div','category-choice'),entry=card.chains[level][idx],meta=entry?metaOf(entry.model):null;field.append(E('strong','',ORDINALS[idx]));
 if(editable){var pick=button('',function(){openCategoryPicker(level,idx,pick)},'model-select');pick.dataset.choiceIndex=idx;pick.setAttribute('aria-label',(entry?'Change':'Choose')+' '+ORDINALS[idx]+' model for '+LEVEL_NAMES[level]);pick.setAttribute('aria-haspopup','dialog');pick.setAttribute('aria-controls','model-picker');pick.setAttribute('aria-expanded','false');pick.append(E('span','model-name',entry?(meta.name||entry.model):'Choose model'));if(entry)pick.append(E('span','source',sourceOf(meta)));else pick.append(E('span','muted','⌄'));field.append(pick)}
 else if(entry){var name=E('div','model-name',meta.name||entry.model);name.append(E('span','source',sourceOf(meta)));field.append(name)}
 if(entry){field.append(E('span','entry-id',entry.model));var choices=effortsFor(entry.model);if(editable&&choices.length>1){var select=E('select');select.setAttribute('aria-label','Reasoning for '+ORDINALS[idx]+' '+LEVEL_NAMES[level]);choices.forEach(function(e){var o=E('option','',eff(e));o.value=e;select.append(o)});select.value=entry.effort;select.addEventListener('change',function(){draft.card.chains[level][idx].effort=select.value;draft.error=''});field.append(select)}else field.append(E('span','fixed',eff(entry.effort)))}
 return field
}
function categoryCard(card,level){var box=E('article','category-card');box.dataset.category=card.id;box.append(E('h3','',card.title||'New category'));for(var i=0;i<3;i++)box.append(categorySlot(card,level,i,false));return box}
function focusCategorySlot(idx){var field=document.querySelector('#category-editor [data-choice-index="'+idx+'"]');if(field)field.focus({preventScroll:true})}
function focusDraft(){var editor=document.getElementById('category-editor');if(!editor)return;editor.scrollIntoView({block:'nearest',inline:draft.review?'start':'nearest'});var field=document.getElementById('category-title');if(field&&!field.disabled)field.focus({preventScroll:true});else if(!draft.review)focusCategorySlot(0);else{var b=editor.querySelector('[data-save-category]');if(b)b.focus({preventScroll:true})}}
function beginCategory(card){if(busy||draft)return;say(pageStatus,'');var start=LEVELS.indexOf(activeLevel);draft={card:card?clone(card):{id:'cat_'+crypto.randomUUID().replace(/-/g,''),title:'',chains:{unrestricted:[null,null,null],no_training:[null,null,null],zdr:[null,null,null]}},level:activeLevel,order:LEVELS.slice(start).concat(LEVELS.slice(0,start)),step:0,review:false,isNew:!card,revision:state.revision,error:''};render();focusDraft()}
function draftProblem(level){var title=draft.card.title;if(!title.trim())return 'Enter a category title.';if(title.length>240)return 'Use a title of up to 240 characters.';if(categories().some(function(c){return c.id!==draft.card.id&&c.title.toLowerCase()===title.trim().toLowerCase()}))return 'A category already has that title.';var chain=draft.card.chains[level];if(chain.some(function(e){return !e||!e.model}))return 'Choose all three models for '+LEVEL_NAMES[level]+'.';if(new Set(chain.map(function(e){return e.model})).size!==3)return 'Choose three different models.';return ''}
function positionCategoryPicker(){
 if(!target||!target.category||!picker.open)return;var a=target.anchor.getBoundingClientRect(),gap=6,edge=8,width=Math.min(360,innerWidth-16),height=Math.min(440,innerHeight-16),left=Math.max(edge,Math.min(a.left,innerWidth-width-edge)),top;
 if(innerWidth<=600){top=innerHeight-height-edge;left=(innerWidth-width)/2}else{var below=innerHeight-a.bottom-gap-edge,above=a.top-gap-edge;if(below>=Math.min(height,260)){height=Math.min(height,below);top=a.bottom+gap}else if(above>=Math.min(height,260)){height=Math.min(height,above);top=a.top-gap-height}else{top=Math.max(edge,Math.min(a.bottom+gap,innerHeight-height-edge))}}
 picker.style.width=width+'px';picker.style.maxHeight=height+'px';picker.style.left=left+'px';picker.style.top=top+'px'
}
function openCategoryPicker(level,idx,anchor){if(busy)return;target={category:true,level:level,idx:idx,anchor:anchor,view:{pick:'chat',privacy:level,has_effort:true}};anchor.setAttribute('aria-expanded','true');document.getElementById('picker-title').textContent=ORDINALS[idx]+' model';document.getElementById('picker-now').textContent=LEVEL_NAMES[level];document.getElementById('picker-note').textContent='OR = OpenRouter. CF = Cloudflare.';search.value='';search.placeholder='Search models';pickerStatus.textContent='Loading models...';list.replaceChildren();picker.classList.add('anchored');picker.show();positionCategoryPicker();search.focus({preventScroll:true});loadCatalog()}
function cancelDraft(){var id=draft.card.id,isNew=draft.isNew;draft=null;render();var b=isNew?document.querySelector('.category-add'):document.querySelector('[data-category="'+id+'"] [data-edit-category]');if(b)b.focus({preventScroll:true})}
function showDraftError(message){draft.error=message;var status=document.querySelector('#category-editor .status');if(status){say(status,message,'error');status.focus({preventScroll:true})}}
async function saveDraft(){
 if(!draft||busy)return;var problem='';if(draft.isNew)LEVELS.some(function(level){problem=draftProblem(level);return !!problem});else problem=draftProblem(draft.level);if(problem){showDraftError(problem);return}
 if(draft.revision!==state.revision){showDraftError('Settings changed elsewhere. Cancel and reopen the card to use the latest settings. Your pending changes are still shown.');return}
 var cfg=clone(state.config),idx=cfg.routing.categories.findIndex(function(c){return c.id===draft.card.id}),id=draft.card.id;
 if(draft.isNew){if(idx>=0){showDraftError('The category already exists. Cancel and reopen it.');return}var added=clone(draft.card);added.title=added.title.trim();cfg.routing.categories.push(added)}
 else{if(idx<0){showDraftError('The category was deleted elsewhere. Cancel to see the latest settings.');return}cfg.routing.categories[idx].title=draft.card.title.trim();cfg.routing.categories[idx].chains[draft.level]=clone(draft.card.chains[draft.level])}
 var status=document.querySelector('#category-editor .status'),ok=await post('save',{revision:draft.revision,config:saveConfig(cfg)},status);
 if(ok){draft=null;render();say(pageStatus,'Saved','ok');var b=document.querySelector('[data-category="'+id+'"] [data-edit-category]');if(b)b.focus({preventScroll:true})}
 else if(draft){draft.error=postError||'Not saved. Try again.';if(draft.revision!==state.revision)draft.error+=' Cancel and reopen the card to use the latest settings. Your pending changes are still shown.';render();var error=document.querySelector('#category-editor .status');if(error)error.focus({preventScroll:true})}
}
function draftActions(editor,status){
 var actions=E('div','actions');actions.append(button('Cancel',cancelDraft));
 if(draft.isNew&&(draft.review||draft.step>0))actions.append(button('Back',function(){draft.error='';if(draft.review)draft.review=false;else draft.step--;activeLevel=draft.order[draft.step];render();focusDraft()}));
 var save=button(!draft.isNew||draft.review?'Save':draft.step===2?'Review':'Next Card',function(){if(!draft.isNew||draft.review){saveDraft();return}var level=draft.order[draft.step],problem=draftProblem(level);if(problem){showDraftError(problem);return}draft.card.title=draft.card.title.trim();draft.error='';if(draft.step===2)draft.review=true;else{draft.step++;activeLevel=draft.order[draft.step]}render();focusDraft()},'primary-action');if(!draft.isNew||draft.review)save.dataset.saveCategory='1';actions.append(save);editor.append(status,actions)
}
function renderDraft(){
 var level=draft.isNew?draft.order[draft.step]:draft.level,editor=E(draft.review?'section':'article',draft.review?'category-review':'category-card category-editing');editor.id='category-editor';editor.dataset.category=draft.card.id;
 var status=E('p','status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.tabIndex=-1;if(draft.error)say(status,draft.error,'error');
 if(draft.review){editor.append(E('h2','','Review new category'));var variants=E('div','category-review-cards');LEVELS.forEach(function(l){var card=categoryCard(draft.card,l);card.prepend(E('h2','',LEVEL_NAMES[l]));variants.append(card)});editor.append(variants)}
 else{
  if(draft.isNew)editor.append(E('p','category-caption','New category, '+(draft.step+1)+' of 3: '+LEVEL_NAMES[level]));
  if(draft.card.id==='general')editor.append(E('h3','','General'));
  else{var label=E('label','category-title-label');label.append(E('span',draft.isNew?'':'sr-only','Category title'));var input=E('input');input.id='category-title';input.type='text';input.maxLength=240;input.value=draft.card.title;input.placeholder='Category or keywords';input.addEventListener('input',function(){draft.card.title=input.value;draft.error=''});label.append(input);editor.append(label)}
  for(var i=0;i<3;i++)editor.append(categorySlot(draft.card,level,i,true))
 }
 draftActions(editor,status);return editor
}
function renderRouting(){
 var sec=E('section','routing-section');sec.append(E('h2','','Categories'));var tabs=E('div','privacy-tabs');tabs.setAttribute('role','tablist');LEVELS.forEach(function(level){var b=button(LEVEL_NAMES[level],function(){activeLevel=level;render()});b.disabled=!!draft;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(activeLevel===level));tabs.append(b)});sec.append(tabs);
 var cards=E('div','category-list');cards.setAttribute('aria-label',LEVEL_NAMES[activeLevel]+' category cards');categories().forEach(function(c){if(draft&&!draft.isNew&&draft.card.id===c.id){cards.append(renderDraft());return}var box=categoryCard(c,activeLevel),actions=E('div','actions'),editButton=button('Edit',function(){beginCategory(c)});editButton.dataset.editCategory='1';editButton.setAttribute('aria-label','Edit '+c.title+' for '+LEVEL_NAMES[activeLevel]);editButton.disabled=!!draft;actions.append(editButton);if(c.id!=='general'){var remove=button('Delete',function(){ask({title:'Delete '+c.title+'?',body:'This removes the category from all three privacy pages.',confirm:'Delete',danger:true}).then(function(ok){if(!ok)return;var cfg=clone(state.config);cfg.routing.categories=cfg.routing.categories.filter(function(item){return item.id!==c.id});post('save',{revision:state.revision,config:saveConfig(cfg)},pageStatus)})});remove.disabled=!!draft;actions.append(remove)}box.append(actions);cards.append(box)});
 if(draft&&draft.isNew)cards.append(renderDraft());var add=button('+',function(){beginCategory(null)},'category-add');add.setAttribute('aria-label','Add category');add.append(E('span','','Add category'));add.disabled=!!draft||categories().length>=24;cards.append(add);sec.append(cards);root.append(sec,E('h2','shared-heading','Shared models'),E('p','muted','A change below applies to all three privacy pages.'))
}
search.addEventListener('input',function(){clearTimeout(timer);seq++;pickerStatus.textContent='Searching…';timer=setTimeout(loadCatalog,220)});
document.getElementById('picker-close').addEventListener('click',closePicker);
picker.addEventListener('cancel',function(e){e.preventDefault();closePicker()});
picker.addEventListener('click',function(e){if(e.target===picker&&(!target||!target.category))closePicker()});
document.addEventListener('click',function(e){if(picker.open&&target&&target.category&&!picker.contains(e.target)&&e.target!==target.anchor&&!target.anchor.contains(e.target))closePicker(!e.target.closest('button,input,select,textarea,a[href],[tabindex]'))},true);
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&picker.open&&target&&target.category){e.preventDefault();closePicker()}});
window.addEventListener('resize',positionCategoryPicker);window.addEventListener('scroll',positionCategoryPicker,true);
render();
})();`;

export function modelsHtml(view, env) {
  const dev = env.ENV_NAME === "dev", environment = dev ? "Dev" : "Production";
  // History contains actor strings; JSON script data must escape '<' and Unicode separators.
  if (!view.dashboard) view = { ...view, dashboard: modelDashboard(view) };
  const initial = JSON.stringify(view).replace(/</g, "\\u003c").replace(new RegExp("\\u2028", "g"), "\\u2028").replace(new RegExp("\\u2029", "g"), "\\u2029");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Models · ${environment} · 1Helm</title><link rel="icon" href="/1helm-icon-64.png"><style>${CSS}</style></head>
<body class="${dev ? "dev" : "live"}" data-environment="${environment}"><main><nav aria-label="Model settings navigation"><a class="back" href="${dev ? "/releases" : "/"}">${dev ? "← Releases" : "← 1Helm"}</a><div class="environments" aria-label="Environment">${dev ? "Development" : "Production"}</div></nav>
<h1>Models</h1><p class="lead">${view.dynamicRouting ? "General is your primary model. Add categories to choose models for delegated tasks." : `The model, reasoning level and fallback models saved for every job on ${environment}. Each change saves right away. Running work keeps its existing model choices. New work uses your saved changes.`}</p>
<noscript>Turn on JavaScript to see and change model settings.</noscript><div class="banner" id="banner" role="alert" hidden></div><p id="page-status" role="status" aria-live="polite"></p>
<div id="groups"></div>
<div id="outside"></div>
<details class="history"><summary>History</summary><ul id="history-list"></ul></details>
<p class="footnote">Revision ${esc(view.revision)}. Only models that meet the privacy and tool limits are offered. When an account's privacy setting forbids a model, that model is skipped and the next one in the list is tried.${view.dynamicRouting ? " Running work keeps its existing model choices. New work uses your saved changes." : ""}</p></main>
<dialog id="model-picker" class="picker" aria-labelledby="picker-title"><div class="picker-head"><div><h2 id="picker-title">Choose a model</h2><p id="picker-now"></p><p id="picker-note"></p></div><button type="button" id="picker-close" aria-label="Close">Close</button></div>
<label class="picker-search"><input id="catalog-query" type="search" placeholder="Search by name, provider or ID" autocomplete="off" aria-label="Search models"></label>
<ul id="picker-list" class="picker-list" aria-label="Models"></ul><div class="picker-foot" id="picker-status" role="status" aria-live="polite"></div></dialog>
${pageDialog("warm")}<script id="model-state" type="application/json">${initial}</script><script>${JS}</script></body></html>`;
}
