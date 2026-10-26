// The small script assemble_deck.mjs adds to the template's own document, so the deck file's shell (deck_shell.html) can drive it
// and read it without touching its document: the two may be in different origins (a published page, the app's file viewer). It
// reports which slide is shown, passes keys the shell sends to the template as ordinary key events, and tells the shell about
// F (full screen), N (notes) and pointer activity. The function that finds the shown slide is put in by assemble_deck.mjs.
(function () {
  if (window.parent === window) return;
  var shown = __SHOWN__;   // replaced by the function that finds the shown slide
  var last = -2, count = -1;
  // Items a style keeps invisible until an entrance animation shows them, that no animation shows (see UNSTICK_JS in the Zone, the same text).
  function unstick(s){var all=s?s.querySelectorAll("*"):[],n=0;for(var i=0;i<all.length;i++){var e=all[i];if(e.hasAttribute("data-hc-unstuck")||/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(e.tagName))continue;
  var cs=getComputedStyle(e);if(cs.opacity!=="0"||cs.display==="none"||cs.visibility==="hidden")continue;if(e.getAnimations&&e.getAnimations().length)continue;
  var h=e.className&&e.className.baseVal!==undefined?e.className.baseVal:String(e.className||"");for(var j=0;j<e.attributes.length;j++)h+=" "+e.attributes[j].name+" "+e.attributes[j].value.slice(0,40);
  if(!/anim|delay|reveal|fade|stagger|enter|appear|aos|wow|in-view/i.test(h))continue;
  if(!(e.textContent.trim()||e.querySelector("img,svg,canvas,video")||/^(IMG|SVG|CANVAS|VIDEO)$/i.test(e.tagName)))continue;
  e.setAttribute("data-hc-unstuck","");e.style.setProperty("opacity","1","important");n++}return n}
  function settle() { [1700, 3800].forEach(function (ms) { setTimeout(function () { unstick(document.querySelectorAll("[data-hc-slide]")[shown()]); }, ms); }); }
  function report() {
    var n = document.querySelectorAll("[data-hc-slide]").length, i = shown();
    if (i !== last || n !== count) { if (i !== last) settle(); last = i; count = n; window.parent.postMessage({ hc: "state", index: i, count: n }, "*"); }
  }
  setInterval(report, 300);
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.hc !== "key" || typeof d.key !== "string") return;
    ["keydown", "keyup"].forEach(function (t) { document.dispatchEvent(new KeyboardEvent(t, { key: d.key, bubbles: true, cancelable: true })); });
    setTimeout(report, 150); setTimeout(report, 1000);
  });
  window.addEventListener("keydown", function (e) {
    var t = e.target;
    if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    if (/^[fFnN]$/.test(e.key)) { e.preventDefault(); window.parent.postMessage({ hc: "key", key: e.key }, "*"); }
  });
  ["mousemove", "touchstart"].forEach(function (t) { window.addEventListener(t, function () { window.parent.postMessage({ hc: "activity" }, "*"); }, { passive: true }); });
  window.addEventListener("load", function () { report(); window.focus(); });
})();
