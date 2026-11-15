// A button that sends the person to an outside sign-in or authorization window shows a busy "Opening…" state. If they close that window,
// or never finish, nothing comes back to clear it. resetWhenBack calls clear() once, when that happens, and never on a finished sign-in
// (a success refreshes the state itself, and the grace period lets a fast success callback win).
//   win: the popup, when window.open gave one. Its `closed` flag is polled.
//   no win (popup blocked, noopener, or a native shell opened the system browser): the app window gaining focus or showing again.
// Returns a function that stops the watching (call it when the flow ends by itself). Shows nothing and moves nothing.
export function resetWhenBack(win: Window | null | undefined, clear: () => void, graceMs = 1500, pollMs = 500): () => void {
  let stopped = false, timer = 0, poll = 0;
  const stop = () => { stopped = true; clearTimeout(timer); clearInterval(poll); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  const fire = () => { timer = window.setTimeout(() => { if (stopped) return; stop(); clear(); }, graceMs); };
  function back() { if (stopped || timer || document.visibilityState === "hidden") return; fire(); }
  if (win) poll = window.setInterval(() => { let gone = false; try { gone = win.closed; } catch { gone = false; } if (gone && !timer && !stopped) { clearInterval(poll); fire(); } }, pollMs);
  else { document.addEventListener("visibilitychange", back); window.addEventListener("focus", back); }
  return stop;
}
