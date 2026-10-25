// The small script assemble_deck.mjs adds to the template's own document, so the deck file's shell (deck_shell.html) can drive it
// and read it without touching its document: the two may be in different origins (a published page, the app's file viewer). It
// reports which slide is shown, passes keys the shell sends to the template as ordinary key events, and tells the shell about
// F (full screen), N (notes) and pointer activity. The function that finds the shown slide is put in by assemble_deck.mjs.
(function () {
  if (window.parent === window) return;
  var shown = __SHOWN__;   // replaced by the function that finds the shown slide
  var last = -2, count = -1;
  function report() {
    var n = document.querySelectorAll("[data-hc-slide]").length, i = shown();
    if (i !== last || n !== count) { last = i; count = n; window.parent.postMessage({ hc: "state", index: i, count: n }, "*"); }
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
