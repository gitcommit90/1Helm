// Notification sounds follow the phone's silent setting.
// iPhone (1Helm app, WKWebView): navigator.audioSession.type = "ambient" makes WebKit use the AVAudioSession category Ambient, which
//   obeys the silent switch (WebKit DOMAudioSession.cpp: Ambient -> AmbientSound -> AVAudioSessionCategoryAmbient; the preference
//   DOMAudioSessionEnabled is on by default). The type is set only around a chime and put back to "auto" afterwards, and always before
//   the microphone starts, because an explicit non-recording type would stop dictation and live notes from recording.
//   While the microphone is recording the session is play-and-record, which has no silent switch, so the chime is skipped in the app.
// Android (1Helm app): there is no silent switch and silent or vibrate mode does not mute media sound, so the app's
//   InstanceGateway plugin reports AudioManager's ringer mode (getRingerMode, and a ringerModeChange event). Not "normal": no chime.
// Browsers: nothing changes (no native plugin, and audioSession is only touched when it exists).
export type Ringer = "normal" | "silent" | "vibrate";
let ringer: Ringer = "normal", started = false, micBusy: () => boolean = () => false, back: any = 0;
const cap = (): any => (typeof window === "undefined" ? null : (window as any).Capacitor);
const nativeApp = () => !!cap()?.isNativePlatform?.();
const gateway = (): any => (nativeApp() ? cap().Plugins?.InstanceGateway : null);
const sess = (): any => (typeof navigator === "undefined" ? null : (navigator as any).audioSession || null);
const asRinger = (v: any): Ringer => (v === "silent" || v === "vibrate" ? v : "normal");

/** Pages that can record (dictation, live notes) tell this module how to see whether the microphone is in use. */
export function silentMicBusy(fn: () => boolean) { micBusy = fn; }
/** Start following the Android ringer mode. Safe to call more than once and anywhere. */
export function silentInit() {
  if (started) return; started = true;
  const g = gateway(); if (!g?.getRingerMode) return;
  try { Promise.resolve(g.getRingerMode()).then((r: any) => { ringer = asRinger(r?.mode); }).catch(() => {}); } catch { /* keep normal */ }
  try { g.addListener?.("ringerModeChange", (r: any) => { ringer = asRinger(r?.mode); }); } catch { /* keep the first answer */ }
}
export const ringerMode = (): Ringer => ringer;
/** Put the audio session back to the browser's own choice. Call before any microphone use. */
export function silentRelease() {
  clearTimeout(back);
  try { const s = sess(); if (s && s.type !== "auto") s.type = "auto"; } catch { /* unsupported */ }
}
/** Call right before playing a notification sound that lasts `ms`. Returns false when it must stay silent. */
export function soundOk(ms = 1500): boolean {
  silentInit();
  if (ringer !== "normal") return false;
  const s = sess(); if (!s) return true;
  if (micBusy()) return !nativeApp();    // recording: no silent switch to obey; the app stays quiet instead
  try { s.type = "ambient"; } catch { return true; }
  clearTimeout(back); back = setTimeout(silentRelease, ms + 1000);
  return true;
}
