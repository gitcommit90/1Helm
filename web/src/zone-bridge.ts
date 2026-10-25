// The two small scripts the Zone puts into the page it shows (zone-doc.ts patchForZone). They are text, not code of the app: the app never runs them.
// They run inside the sandboxed frame (scripts allowed, no allow-same-origin), so all they can do is send messages to the app and read what the app
// sends. Every message carries the nonce the app made for this opening of the file (__N__), and the app accepts a message only from the frame it opened.
//
// BRIDGE runs in the page (a plain page, or the template document of a deck). It
//   - names the element under the pointer (hover) and the one clicked (select), with its slide, its data-slot or element path, its text and its computed look;
//   - lets a double click or Enter edit a text element in place (Enter saves, Esc cancels) and lets a picture dropped on a picture box replace it;
//   - applies the style / background / picture changes the inspector asks for, and reports each change as an "edit" the app saves;
//   - tells which slide is shown (a MutationObserver on the slide elements) and steps the template to another slide with arrow keys;
//   - makes a picture of the page ("snap") for the effect that covers the canvas while the helper works.
// RELAY runs in a deck's shell page. The template document is a frame inside the shell, so its messages reach the shell first; the relay forwards them
// to the app (turning the rectangles from the slide's 1920 by 1080 pixels into the frame's pixels) and forwards the app's commands the other way.
// Elements are named the way 1HC src/zone-edit.js finds them: slide root = [data-hc-slide="<index>"], then data-slot (and n, which one of that slot) or
// sel, the 0-based index among element children at each level from the slide root (the page's <body> for a plain page).
export const BRIDGE = String.raw`(function(){
if(window.__zb)return;window.__zb=1;
var N="__N__",DECK=__D__,P=window.parent,sel=null,ed=null,edOrig="",edWas="",edWs="",last=-2,dropEl=null,hov=null,raf=0,mx=0,my=0;
var CSSOK={"font-size":1,"font-weight":1,"font-style":1,"color":1,"text-align":1,"line-height":1,"letter-spacing":1,"background-color":1,"width":1,"height":1,"opacity":1};
function post(m,el){m.zb=N;if(el){var r=el.getBoundingClientRect?el.getBoundingClientRect():el;m.r=[r.left,r.top,r.width,r.height]}P.postMessage(m,"*")}
function slides(){return DECK?[].slice.call(document.querySelectorAll("[data-hc-slide]")):[]}
function shown(){var s=slides(),i;for(i=0;i<s.length;i++)if(/(^|\s)(active|is-active|current)(\s|$)/.test(s[i].className))return i;
 for(i=0;i<s.length;i++){var r=s[i].getBoundingClientRect(),c=getComputedStyle(s[i]);if(c.visibility!=="hidden"&&c.display!=="none"&&+c.opacity>.5&&r.width>0&&r.right>0&&r.left<innerWidth)return i}return 0}
function rootEl(){if(!DECK)return document.body;return slides()[shown()]||document.body}
function own(e){for(var n=e.firstChild;n;n=n.nextSibling)if(n.nodeType===3&&n.nodeValue.trim())return true;return false}
function meaningful(e){if(/^(img|svg|canvas|video|picture)$/i.test(e.tagName)||own(e))return true;var b=getComputedStyle(e).backgroundImage;return !!b&&b!=="none"}
function stop(e,r){return e===r||e===document.documentElement||e===document.body}
function pick(t){var r=rootEl(),e;if(!(t instanceof Element))return null;
 for(e=t;e&&!stop(e,r);e=e.parentElement)if(e.hasAttribute("data-slot"))return e;
 for(e=t;e&&!stop(e,r);e=e.parentElement)if(meaningful(e))return e;return null}
function idx(el,root){var p=[];while(el&&el!==root){var par=el.parentElement;if(!par)return null;p.unshift([].indexOf.call(par.children,el));el=par}return el===root?p.join("/"):null}
function target(el){var r=rootEl(),o={slide:DECK?shown()+1:null},slot=el.getAttribute("data-slot");
 if(slot){var all=[].filter.call(r.querySelectorAll("[data-slot]"),function(x){return x.getAttribute("data-slot")===slot}),n=all.indexOf(el);if(n>=0){o.slot=slot;o.n=n;return o}}
 o.sel=idx(el,r);return o}
function hex(c){var m=/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c);if(!m||(m[4]!==undefined&&+m[4]===0))return "";return "#"+[1,2,3].map(function(i){return ("0"+(+m[i]).toString(16)).slice(-2)}).join("")}
function plain(el){var s="";(function w(n){for(var c=n.firstChild;c;c=c.nextSibling){if(c.nodeType===3)s+=c.nodeValue;else if(c.nodeType===1){if(c.tagName==="BR")s+="\n";else{var b=/^(DIV|P)$/.test(c.tagName);if(b&&s&&s.slice(-1)!=="\n")s+="\n";w(c)}}}})(el);
 return s.split("\n").map(function(l){return l.replace(/\s+/g," ").trim()}).join("\n").replace(/^\n+|\n+$/g,"").slice(0,2000)}
function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function html(s){return esc(s).replace(/\n/g,"<br>")}
function editable(el){if(/^(img|svg|canvas|video|picture)$/i.test(el.tagName)||el.getAttribute("data-slot")==="media")return false;
 for(var n=el.firstChild;n;n=n.nextSibling)if(!(n.nodeType===3||n.nodeType===8||(n.nodeType===1&&n.tagName==="BR")))return false;return true}
function info(el){var cs=getComputedStyle(el),t=target(el),tag=el.tagName.toLowerCase(),r=el.getBoundingClientRect(),
 img=tag==="img"||t.slot==="media"||(el.children.length===1&&el.children[0].tagName==="IMG"),tx=plain(el);
 return {t:t,path:idx(el,rootEl()),tag:tag,text:tx.replace(/\n/g," ").slice(0,400),kind:img?"image":(own(el)||(tx&&!el.querySelector("svg,img")))?"text":"box",edit:editable(el),
  css:{fontSize:parseFloat(cs.fontSize)||0,fontWeight:+cs.fontWeight||400,color:hex(cs.color),textAlign:cs.textAlign,bg:hex(cs.backgroundColor),opacity:+cs.opacity,w:Math.round(r.width),h:Math.round(r.height)}}}
function select(el){sel=el;var s=DECK?shown()+1:null;if(!el){post({t:"select",slide:s,bg:hex(getComputedStyle(rootEl()).backgroundColor)});return}post({t:"select",slide:s,info:info(el)},el)}
function resel(){if(sel&&sel.isConnected)post({t:"rect"},sel)}
function startEdit(el){if(ed||!el)return;if(!editable(el)){post({t:"note",m:"mixed"});return}
 ed=el;edOrig=el.innerHTML;edWas=plain(el);edWs=el.style.whiteSpace;el.innerHTML=html(edWas);el.style.whiteSpace="pre-wrap";
 el.setAttribute("contenteditable","plaintext-only");if(el.contentEditable!=="plaintext-only")el.setAttribute("contenteditable","true");el.focus();var r=document.createRange();r.selectNodeContents(el);var s=getSelection();s.removeAllRanges();s.addRange(r);
 post({t:"editing",on:true},el)}
function endEdit(ok){if(!ed)return;var el=ed,now=plain(el);ed=null;el.removeAttribute("contenteditable");el.style.whiteSpace=edWs;if(!el.getAttribute("style"))el.removeAttribute("style");
 if(ok&&now!==edWas){el.innerHTML=html(now);post({t:"edit",edit:merge({op:"text",text:now},target(el)),was:edWas,label:1});}else el.innerHTML=edOrig;
 post({t:"editing",on:false});select(el)}
function merge(a,b){for(var k in b)a[k]=b[k];return a}
function setImage(el,mime,data){var u="data:"+mime+";base64,"+data;if(el.tagName==="IMG"){el.removeAttribute("srcset");el.src=u}else{el.innerHTML='<img src="'+u+'" alt="" style="width:100%;height:100%;object-fit:cover;display:block">';el.style.border="0"}}
function setStyle(el,css){var was={};for(var k in css){if(!CSSOK[k])continue;was[k]=getComputedStyle(el).getPropertyValue(k);el.style.setProperty(k,css[k])}return was}
function dropTarget(t){if(!(t instanceof Element))return null;for(var e=t,r=rootEl();e&&!stop(e,r);e=e.parentElement){if(e.tagName==="IMG"||e.getAttribute("data-slot")==="media")return e}return null}
function hasFiles(e){var t=e.dataTransfer&&e.dataTransfer.types;return !!t&&[].indexOf.call(t,"Files")>=0}
function readImage(f,el){if(!f||!/^image\/(png|jpeg|webp|gif)$/.test(f.type)){post({t:"note",m:"type"});return}
 if(f.size>4000000){post({t:"note",m:"big"});return}
 var fr=new FileReader();fr.onload=function(){var d=String(fr.result),b=d.slice(d.indexOf(",")+1);setImage(el,f.type,b);post({t:"edit",edit:merge({op:"image",mime:f.type,data:b},target(el)),name:f.name,label:1});select(el)};fr.readAsDataURL(f)}
function go(i){var n=slides().length,c=shown(),k=0;i=Math.max(0,Math.min(n-1,i));
 (function step(){c=shown();if(c===i||k++>60)return;document.dispatchEvent(new KeyboardEvent("keydown",{key:c<i?"ArrowRight":"ArrowLeft",bubbles:true,cancelable:true}));setTimeout(step,90)})()}
function snapRaw(w,h,cb){try{var c=document.documentElement.cloneNode(true);[].forEach.call(c.querySelectorAll("script"),function(s){s.remove()});
 var W=DECK?1920:innerWidth,H=DECK?1080:innerHeight,x=new XMLSerializer().serializeToString(c),
  svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'"><foreignObject width="100%" height="100%">'+x+'</foreignObject></svg>',im=new Image();
 im.onload=function(){try{var cv=document.createElement("canvas");cv.width=w;cv.height=h;var cx=cv.getContext("2d");cx.drawImage(im,0,0,w,h);cb(cv,cx)}catch(e){cb(null)}};
 im.onerror=function(){cb(null)};im.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg)}catch(e){cb(null)}}
function snap(w,h){snapRaw(w,h,function(cv){try{post(cv?{t:"snap",png:cv.toDataURL("image/jpeg",.82)}:{t:"snap"})}catch(e){post({t:"snap"})}})}
function shows(cx,w,h,color){var t=document.createElement("canvas").getContext("2d");t.fillStyle=color;t.fillRect(0,0,1,1);var p=t.getImageData(0,0,1,1).data,d=cx.getImageData(0,0,w,h).data,n=0,i;
 for(i=0;i<d.length;i+=4)if(Math.abs(d[i]-p[0])<28&&Math.abs(d[i+1]-p[1])<28&&Math.abs(d[i+2]-p[2])<28)n++;return n/(w*h)>=.3}
window.addEventListener("click",function(e){if(ed&&ed.contains(e.target))return;e.preventDefault();e.stopPropagation();var el=pick(e.target);if(el||!DECK)select(el);else{sel=null;post({t:"select",slide:shown()+1,whole:1,bg:hex(getComputedStyle(rootEl()).backgroundColor)})}},true);
window.addEventListener("dblclick",function(e){var el=pick(e.target);if(!el)return;e.preventDefault();e.stopPropagation();if(sel!==el)select(el);startEdit(el)},true);
window.addEventListener("keydown",function(e){
 if(ed){e.stopPropagation();if(e.key==="Escape"){e.preventDefault();endEdit(false)}else if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();endEdit(true)}return}
 if(e.metaKey||e.ctrlKey||e.altKey)return;
 if(e.key==="Enter"&&sel){e.preventDefault();e.stopPropagation();startEdit(sel)}else if(e.key==="Escape"&&sel){e.preventDefault();select(null)}},true);
window.addEventListener("keyup",function(e){if(ed)e.stopPropagation()},true);
window.addEventListener("blur",function(){if(ed)endEdit(true)});
document.addEventListener("pointermove",function(e){mx=e.clientX;my=e.clientY;if(raf||ed)return;raf=requestAnimationFrame(function(){raf=0;var el=pick(document.elementFromPoint(mx,my));if(el===hov)return;hov=el;
 if(!el||el===sel)post({t:"hover"});else post({t:"hover",tag:el.tagName.toLowerCase(),slot:el.getAttribute("data-slot"),text:plain(el).slice(0,40)},el)})},{passive:true});
document.addEventListener("pointerleave",function(){hov=null;post({t:"hover"})});
window.addEventListener("scroll",resel,true);window.addEventListener("resize",resel);
window.addEventListener("dragover",function(e){if(!hasFiles(e))return;e.preventDefault();var el=dropTarget(e.target);if(el!==dropEl){dropEl=el;if(el)post({t:"drop"},el);else post({t:"drop"})}},true);
window.addEventListener("dragleave",function(e){if(e.relatedTarget)return;dropEl=null;post({t:"drop"})},true);
window.addEventListener("drop",function(e){if(!hasFiles(e))return;e.preventDefault();e.stopPropagation();var el=dropTarget(e.target);dropEl=null;post({t:"drop"});
 if(!el){post({t:"note",m:"where"});return}readImage(e.dataTransfer.files[0],el)},true);
window.addEventListener("message",function(e){var d=e.data;if(e.source!==P||!d||d.zb!==N)return;
 if(d.t==="goto")go(+d.i||0);
 else if(d.t==="clear"){if(ed)endEdit(true);select(null)}
 else if(d.t==="edit"&&sel)startEdit(sel);
 else if(d.t==="style"&&sel){var css={},k;for(k in d.css)if(CSSOK[k]&&typeof d.css[k]==="string"&&d.css[k].length<61)css[k]=d.css[k];var was=setStyle(sel,css);post({t:"edit",edit:merge({op:"style",css:css},target(sel)),was:was});select(sel)}
 else if(d.t==="bg"&&typeof d.value==="string"&&d.value.length<61){var r=rootEl(),w=getComputedStyle(r).backgroundColor,before=r.getAttribute("style"),val=d.value,sl=DECK?shown()+1:null;r.style.setProperty("background",val);r.style.removeProperty("background-image");
  snapRaw(64,36,function(cv,cx){if(!cx||shows(cx,64,36,val)){post({t:"edit",edit:{op:"bg",slide:sl,value:val},was:hex(w)||w})}else{if(before===null)r.removeAttribute("style");else r.setAttribute("style",before);post({t:"note",m:"bg"});select(null)}})}
 else if(d.t==="image"&&sel&&typeof d.data==="string"&&/^image\/(png|jpeg|webp|gif)$/.test(d.mime)){setImage(sel,d.mime,d.data);post({t:"edit",edit:merge({op:"image",mime:d.mime,data:d.data},target(sel)),name:d.name||"",label:1});select(sel)}
 else if(d.t==="snap")snap(Math.max(16,+d.w||960),Math.max(16,+d.h||540));
 else if(d.t==="hello"){last=-2;ready()}});
if(DECK){var mo=new MutationObserver(function(){var i=shown();if(i!==last){last=i;if(ed)endEdit(true);sel=null;post({t:"slide",i:i,n:slides().length,bg:hex(getComputedStyle(rootEl()).backgroundColor)})}});
 slides().forEach(function(s){mo.observe(s,{attributes:true,attributeFilter:["class","style"]})})}
function ready(){last=DECK?shown():0;post({t:"ready",n:DECK?slides().length:1,i:last,bg:hex(getComputedStyle(rootEl()).backgroundColor)})}
if(document.readyState==="complete")ready();else window.addEventListener("load",ready);
})();`;

export const RELAY = String.raw`(function(){
var f=document.getElementById("deck"),st=document.getElementById("stage"),N="__N__",last="";if(!f||!st)return;
function geo(){var b=st.getBoundingClientRect(),w=innerWidth||1,h=innerHeight||1;return [b.left/w,b.top/h,b.width/w,b.height/h]}
function tell(){var g=geo(),k=g.join();if(k===last)return;last=k;parent.postMessage({zb:N,t:"stage",g:g},"*")}
addEventListener("resize",tell);addEventListener("transitionend",tell,true);addEventListener("load",tell);
if(window.ResizeObserver)new ResizeObserver(tell).observe(st);
addEventListener("message",function(e){var d=e.data;if(!d||d.zb!==N)return;
 if(e.source===f.contentWindow){d.g=geo();parent.postMessage(d,"*")}
 else if(e.source===parent){if(d.t==="hello"){last="";tell()}f.contentWindow.postMessage(d,"*")}});
tell();
})();`;

/** CSS added to a deck's shell: the Zone has its own slide strip, so the shell's controls and notes stay hidden. */
export const SHELL_CSS = "#bar,#notes{display:none!important}";

export const bridgeFor = (nonce: string, deck: boolean) => BRIDGE.replace("__N__", nonce).replace("__D__", deck ? "true" : "false");
export const relayFor = (nonce: string) => RELAY.replace("__N__", nonce);
