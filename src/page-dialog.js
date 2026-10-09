// Our own confirm / notice dialog for the server-rendered pages (classic channel + account pages, Releases, Muse ↔ 1HC, texting).
// 1Helm never uses the browser's confirm(), alert() or prompt() (Captain rule; test/no-native-dialogs.test.mjs fails if one
// comes back). The app has its own (design-sandbox src/dialog.ts); this is the tiny self-contained one, no app bundle needed.
// pageDialog(theme) returns a <style> + <script> to put in the page. The script defines, on window:
//   ask({ title, body, confirm: "Delete", cancel: "Cancel", danger: true }) → Promise<boolean>   (true only on the confirm button)
//   tell(title, body)                                                       → Promise<void>      (one OK button)
// and any <form data-ask="Question?" data-ask-body="..." data-ask-ok="Push" [data-ask-danger]> asks before it submits.
// Centered card on desktop, bottom sheet on phone. Esc and the backdrop cancel; Tab stays inside; Enter only presses the focused
// button (destructive dialogs open with Cancel focused). The client code is a plain string on purpose: wrangler's bundler adds
// __name() helpers inside real functions, which would break once stringified into a page.

const CSS = `.pdlgw,.pdlgw *{box-sizing:border-box}.pdlgw{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;font-family:var(--pd-font);color:var(--pd-ink)}
.pdlgback{position:absolute;inset:0;background:rgba(28,27,25,.32);opacity:0;transition:opacity .18s}
.pdlg{position:relative;width:min(400px,100%);max-height:calc(100dvh - 48px);overflow:auto;background:#fff;border:1px solid var(--pd-line);border-radius:var(--pd-r);box-shadow:0 30px 80px rgba(28,27,25,.2);padding:22px 22px 18px;outline:0;text-align:left;opacity:0;transform:translateY(8px) scale(.985);transition:opacity .18s,transform .22s cubic-bezier(.2,.8,.2,1)}
.pdlgw.on .pdlgback{opacity:1}.pdlgw.on .pdlg{opacity:1;transform:none}.pdlgw.off{pointer-events:none}.pdlgw.off .pdlgback,.pdlgw.off .pdlg{opacity:0}
.pdlg h2{margin:0;font-family:var(--pd-font);font-size:18px;font-weight:600;line-height:1.3;letter-spacing:-.01em;color:var(--pd-ink);overflow-wrap:anywhere}
.pdlg p{margin:8px 0 0;font-family:var(--pd-font);font-size:15px;line-height:1.5;color:var(--pd-ink2);overflow-wrap:anywhere;white-space:pre-line}
.pdlgbtns{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.pdlgw .pdlgb{margin:0;min-height:40px;padding:0 18px;border-radius:var(--pd-br);border:1px solid var(--pd-ink);font-family:var(--pd-font);font-size:14px;font-weight:600;line-height:1.2;cursor:pointer;background:var(--pd-ink);color:#fff;box-shadow:none;width:auto;height:auto}
.pdlgw .pdlgb.no{background:#fff;color:var(--pd-ink);border-color:var(--pd-line2)}.pdlgw .pdlgb.no:hover{background:#f3f2ef}
.pdlgw .pdlgb.bad{background:#dc2626;border-color:#dc2626;color:#fff}.pdlgw .pdlgb.bad:hover{background:#b91c1c}
.pdlgw .pdlgb:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
.pdlggrab{display:none}
@media (max-width:640px){.pdlgw{place-items:end stretch;padding:0}.pdlgback{background:rgba(0,0,0,.4)}
 .pdlg{width:100%;max-height:90dvh;border:0;border-radius:24px 24px 0 0;padding:10px 20px calc(16px + env(safe-area-inset-bottom));opacity:1;transform:translateY(100%);transition:transform .3s cubic-bezier(.2,.8,.2,1)}
 .pdlgw.off .pdlg{opacity:1;transform:translateY(100%)}.pdlggrab{display:block;width:40px;height:5px;border-radius:3px;background:var(--pd-line2);margin:0 auto 16px}
 .pdlg h2,.pdlg p{text-align:center}.pdlgbtns{flex-direction:column-reverse}.pdlgw .pdlgb{width:100%;min-height:50px;font-size:16px}}
@media (prefers-reduced-motion:reduce){.pdlg,.pdlgback{transition:none}}`;

// Each page's own look: the classic prototype pages (system font, 8px buttons) and the warm 1Helm pages (Instrument Sans, pills).
const THEMES = {
  classic: `.pdlgw{--pd-ink:#111;--pd-ink2:#444;--pd-line:#ddd;--pd-line2:#bbb;--pd-r:12px;--pd-br:8px;--pd-font:system-ui,sans-serif}`,
  warm: `.pdlgw{--pd-ink:#1c1b19;--pd-ink2:#44423d;--pd-line:#e7e5e0;--pd-line2:#d8d5ce;--pd-r:22px;--pd-br:999px;--pd-font:IS,-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter",system-ui,sans-serif}`,
};

const JS = `(function(){if(window.ask)return;
var cur=null,n=0;
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
// Pin the dialog to what's actually on screen (the visual viewport): pages wider than a phone grow the layout viewport, and a
// fixed bottom sheet would otherwise sit below the visible area.
function fit(){var vv=window.visualViewport;if(!cur||!vv)return;cur.el.style.cssText="inset:auto;left:"+vv.offsetLeft+"px;top:"+vv.offsetTop+"px;width:"+vv.width+"px;height:"+vv.height+"px"}
if(window.visualViewport){visualViewport.addEventListener("resize",fit);visualViewport.addEventListener("scroll",fit)}
function btns(){return cur?[].slice.call(cur.el.querySelectorAll(".pdlgb")):[]}
function close(v){if(!cur)return;var c=cur;cur=null;c.el.classList.remove("on");c.el.classList.add("off");
 setTimeout(function(){c.el.remove()},320);if(c.prev&&c.prev.isConnected)try{c.prev.focus({preventScroll:true})}catch(e){}c.done(v)}
window.ask=function(o){o=o||{};if(cur)close(false);var id="pdlg"+(++n),cancel=o.cancel===undefined?"Cancel":o.cancel,el=document.createElement("div");
 el.className="pdlgw";
 el.innerHTML='<div class="pdlgback" data-pdx></div><div class="pdlg" role="'+(o.danger?"alertdialog":"dialog")+'" aria-modal="true" aria-labelledby="'+id+'t"'+(o.body?' aria-describedby="'+id+'b"':"")+' tabindex="-1"><span class="pdlggrab" aria-hidden="true"></span><h2 id="'+id+'t">'+esc(o.title)+"</h2>"+(o.body?'<p id="'+id+'b">'+esc(o.body)+"</p>":"")+'<div class="pdlgbtns">'+(cancel?'<button type="button" class="pdlgb no" data-pdno>'+esc(cancel)+"</button>":"")+'<button type="button" class="pdlgb '+(o.danger?"bad":"ok")+'" data-pdok>'+esc(o.confirm||"OK")+"</button></div></div>";
 el.addEventListener("click",function(e){e.stopPropagation();var t=e.target;if(t.closest("[data-pdok]"))close(true);else if(t.closest("[data-pdno]")||t.closest("[data-pdx]"))close(false)});
 el.addEventListener("mousedown",function(e){if(e.target.closest("[data-pdx]"))e.preventDefault()});
 var a=document.activeElement,prev=a&&a!==document.body?a:null;document.body.appendChild(el);
 return new Promise(function(done){cur={el:el,done:done,prev:prev};fit();el.querySelector(o.danger&&cancel?"[data-pdno]":"[data-pdok]").focus({preventScroll:true});void el.offsetWidth;el.classList.add("on")})};
window.tell=function(title,body){return window.ask({title:title,body:body,confirm:"OK",cancel:null}).then(function(){})};
window.addEventListener("keydown",function(e){if(!cur)return;e.stopImmediatePropagation();
 if(e.key==="Escape"){e.preventDefault();close(false);return}
 if(e.key==="Tab"){e.preventDefault();var b=btns();if(!b.length)return;var i=b.indexOf(document.activeElement);b[(i<0?0:i+(e.shiftKey?b.length-1:1))%b.length].focus();return}
 if((e.key==="Enter"||e.key===" ")&&!(document.activeElement&&document.activeElement.closest&&document.activeElement.closest(".pdlgb")))e.preventDefault()},true);
document.addEventListener("focusin",function(e){if(!cur||cur.el.contains(e.target))return;var b=cur.el.querySelector("[data-pdno]")||cur.el.querySelector("[data-pdok]");b&&b.focus({preventScroll:true})},true);
document.addEventListener("submit",function(e){var f=e.target;if(!f.matches||!f.matches("form[data-ask]")||f.__asked)return;e.preventDefault();e.stopImmediatePropagation();
 window.ask({title:f.dataset.ask,body:f.dataset.askBody,confirm:f.dataset.askOk,danger:f.hasAttribute("data-ask-danger")}).then(function(ok){if(ok){f.__asked=true;f.submit()}})},true);
})();`;

export function pageDialog(theme = "warm") {
  return `<style>${CSS}${THEMES[theme] || THEMES.warm}</style><script>${JS}</script>`;
}
