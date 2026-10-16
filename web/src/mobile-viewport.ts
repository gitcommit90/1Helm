// A phone keyboard can resize and pan the visible viewport without resizing the
// layout viewport. Keep the whole chat, including its header, in the visible area.
const viewport = window.visualViewport;
const mobile = matchMedia("(max-width: 767px)");
const root = document.documentElement;
let frame = 0;

function fit() {
  frame = 0;
  if (!mobile.matches || !viewport) {
    root.style.removeProperty("--mobile-viewport-top");
    root.style.removeProperty("--mobile-viewport-height");
    return;
  }
  // Let the browser pan and magnify the existing layout during pinch zoom.
  // Retain the last unzoomed dimensions until the scale returns to normal.
  if (Math.abs(viewport.scale - 1) > 0.01 || viewport.height <= 0) return;
  root.style.setProperty("--mobile-viewport-top", `${viewport.offsetTop}px`);
  root.style.setProperty("--mobile-viewport-height", `${viewport.height}px`);
}

function schedule() { if (!frame) frame = requestAnimationFrame(fit); }
viewport?.addEventListener("resize", schedule);
viewport?.addEventListener("scroll", schedule);
window.addEventListener("resize", schedule);
window.addEventListener("pageshow", schedule);
mobile.addEventListener("change", schedule);
fit();
