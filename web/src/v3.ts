// the design sandbox / v3 — "Soft": v2's structure with Muse-style surfaces: raised stage, soft bubbles, pill composer, character identity.
import { ask, dialogOpen } from "./dialog";   // first: its Esc handler must run before every other one
import { createAmbientCue } from "./ee/ambient-cue";
import { openTaskRename } from "./task-rename";   // modal keys stay out of app shortcuts
import { navInit, navButtons, navKey } from "./nav-history";   // address history record + the arrows (stamps history.state; its replaceState patch must be in place before the app starts)
import { registerShortcut, scInit, scPage, scLabel, scLabelN, scReset } from "./shortcuts";   // third: the one key handler + Settings → Keyboard shortcuts (registers its capture listener before every app one but the dialog's)
import { installAutoReload } from "./auto-reload";
import { micInfo } from "./ee/livemic";
import { draftsInit, draftGet, draftSet, draftClear } from "./drafts";   // unsent message text kept per composer
import { unsavedKind, guarded } from "./unsaved";   // second: "Save changes?" before leaving an edit (its hashchange listener must be the first one)
import { dedupeProgress, splitParts, finishReply } from "./progress-dedupe";
import { progressSlot, progressWorked, progressReset, progressSnapshot, progressBefore, progressAfter } from "./progress-slot";
import { bindTouchSwipe, bindSheetDismiss, gestureControl, gestureValueControl, scrollerOwns } from "./mobile-gestures";
import "./mobile-viewport";
import { rpInit, rpMailto } from "./report";
import { piKind, piOn, piInstall, piLabel, piSub, PI_ICON } from "./pwainstall";   // Install 1Helm as an app: catches beforeinstallprompt at import, before the UI renders   // Report an issue (its sheet's Esc, too; and it keeps the last log lines from the start)
import { beeInit, beeOverview, beeSec, beeMark } from "./ee/bee";
import { notebookBeeUnread } from "./ee/notebook-bee-unread";
import { wkMdFromHtml, wkRichOk } from "./wk-rich";
import { dpInit, dpSec, dpSheetMaybe, dpSheetOpen, dpLoc, dpShareNow, DP_ICON } from "./devperm";   // location + mic, asked once up front (its sheet's Esc, too)   // Settings → Ambient → Bee: the card and the Connect sheet (its sheet's Esc, too)
import { beeLibInit, beeLibParts, beeLibReset, beeLibEnsure } from "./ee/bee-library";   // General's Library: the saved Bee conversations (a filter and a section)
import { secInit, secPlus, secList, secRow, secOf, moveMenu, canMove, type CS } from "./sections";   // custom sections of the task list
import { delInit, rowMore, headDelete, channelMore, sheetRows, MORE } from "./delete";   // deleting a chat / channel / the account
import { openNewChannel, createViaApi, type NewChannel } from "./newchannel";   // second, for the same reason (New channel sheet)
import { shInit, shFiles, shCards, shEvent, shCardHtml, shFold, shFileBtn, shViewerBtns, shBadge, shLibHtml, shFileGone } from "./share";   // share links + published pages (its sheet's Esc, too)
import { orb } from "./activity-orb";
import { cmodelsInit, cmodelsCard, cmodelsPrivacy } from "./ee/custom-models";   // Settings → Advanced → Custom Model Selection (chat categories of this account; licensed)
import { marked } from "marked";
import DOMPurify from "dompurify";
import { fileUrl as fileResUrl } from "./file-url.mjs";
import { openShotLightbox } from "./shot-lightbox";
import { chatCodeHtml, initChatCodeCopy } from "./chat-code";
import { chatMarkdown } from "./chat-markdown";
import { settingsDestination, settingsTarget } from "./settings-links";
import { transcriptLink, transcriptLines, transcriptText } from "./transcript";
import { speakersOf, transcriptHtml, repaintSpeakers, speakerEditor, speakerEditorClose, type Speaker } from "./speakers";
import seedMock from "./seed.json";
import { planImport, type PwPlan } from "./pwimport";
import { ciInit, ciOpen } from "./contacts-import";
import { clInit, clList, clMount, pills } from "./contacts-list";
import { cmInit, numRows, readNums, numsOf, mergeOpen, mergeLocal, dupBanner, dupClick, findDups, type Num } from "./contacts-merge";   // several numbers per contact, merge, duplicates   // the Contacts list: letter sections, A–Z rail, windowed rows   // Contacts → Import (vCard / Google / Outlook CSV, read in the browser)
import { SCENES } from "./genui-scenes";
import { renderCard, foldHtml, replyParts, partOwner, scrubCode, cardText, plainPreview, wireCards } from "./genui-render";
import { approvalHtml, type Decision } from "./approval-card";
import { approvalCards, approvalResponse } from "./approval-live";
import { nativeResumeInput, internalHandoffInput, nativeReceiptStatus } from "./native-approval-progress";
import { pmInit, pmHtml, pmClick, pmAfter, pmFocusCheckins } from "./perms";   // Settings → Permissions (live): level + "Always allowed"
import { NETWORK_SEC, networkInit, networkHtml, networkClick, networkChange, networkVisible } from "./computer-network";
import { watchingComputer, computerViewerChanged } from "./computer-offer";
import { settleBrowserCards } from "./browser-card";
import { initAppDetail, openAppDetail, appDetailSync, appDetailRepaint } from "./ee/app-detail";
import { appIsSoon } from "./apps-availability";
import { initAcctNote, onAcctNote, acctNoteHtml, acctNoteReset, acctNoteAfter } from "./ee/acct-note";   // a note per connected account, for the helper
import { cmInit as amInit, cmHtml, cmClick, cmSet, cmNewTab, cmBack, cmMode } from "./ee/apps-mode";   // Settings → Connected accounts: Managed vs Self-managed (1HC composio-self.js)
import { keepPaneFloats } from "./pane-float";
import { todoBtn, todoSet, todoSync, todoInit } from "./todos";
import { pomoBtn, pomoGlobalBtn, pomoShortcut, pomoSet, pomoSync, pomoInit } from "./pomodoro";
import { lnSpeakers, lnBtn, lnSet, lnSync, lnInit, lnWrap, lnDot, lnRefineCard, lnStartFor, lnCanStart } from "./ee/livenotes";
import { mtInit } from "./ee/meetings";   // Meeting reminders for notes: "Your 2:00 “Weekly sync” is starting. Take notes?"   // Bee Live notes: header button, split view, chip, presence
import { streamNote } from "./clientlog";   // stream lost / re-attached lines (dev only)
import { streamState, streamLease, streamCurrent, streamRelease, streamInvalidate, streamProgress, streamCheckDue, streamFetch, streamErrorBody, readStream, type Lease } from "./stream-recovery";
import { tkInit, tkLoad, tkEvent, tkOn, tkLiveCard, tkBtn, tkWrap, tkSync, tkChip, tkMsgOf, tkCardView, tkHelperCount, tkProgress, orbState, type EventView } from "./tracker";
import { dictBtn, dictInit, dictActive } from "./dictate";
import { slBtn, slInit, slGate, slSchedule, slBubbles, slSentNote, slSet } from "./send-later";
import { docEditable, zoneKind } from "./zone-doc";   // the Zone (zone.ts, loaded only when a file is opened in it): which files it can open
import { dsAttr, dsBtn, dsCardHtml, dsInit, dsIsDeck, dsWire } from "./deck-styles";   // deck styles: Change style on a deck card, and the helper's picker card
import { schInit, schPage, schPaint, schAfter, schRedirect, isSch, schSec } from "./scheduled";   // the one Scheduled view (repeats, follow-ups, send later)
import { logoOver, logoChip, workDomain, appLogo, logoWarm } from "./logo";
import { ivInit, ivSet, ivIs, ivView } from "./interview";
import { apkRegister, apkHtml, apkReset, type AppOpt } from "./ee/apps-pick";   // Settings → Connected accounts → Apps I use
import { ivcHtml } from "./interview-card";
import { replyBinding, responseId, type InputRequest, type InputReply } from "./input-reply";
import { offerCardHtml, offerFold, cxoInit, cxoUpdate, cxoFrom, cxoBoot, cxoDraftHtml, type OfferCard } from "./ee/connect-card";
import { planInit, planAttach, planEvent, planCardHtml, planBriefs, briefMsgHtml } from "./plan-live";   // plan cards (propose_plan)
import { bcxInit, bcxUsage } from "./ee/cancel";
import { loadDue, loadFailed, withRetries } from "./task-load";
import { pdInit, pdSet } from "./ee/pastdue";   // payment failed: read-only banner (Fix payment) + disabled composers
import * as coreByok from "./byok";
import * as billingByok from "./ee/byok-billing";
import * as coreStorage from "./storage";
import * as billingStorage from "./ee/storage-billing";
import { cmcpInit, cmcpPage, cmcpBefore, cmcpAfter, CMCP_SEC } from "./ee/custom-mcp";   // Settings → Advanced → Custom MCP connections (Experimental)
import { hInit, hWatch, hFit } from "./headfit";   // the tablet/desktop task header: folds actions into ⋯ instead of running under the computer button
import { sidebarInit, sidebarSync, sidebarReveal, sidebarCollapseButton, sidebarRestoreButton } from "./channel-sidebar";
import { stInit, sync as stSync, headStop, rowStop, composerStop, stopTask, stopMany, stopBusy, pausedNote, SQ } from "./stop";   // Stop / Stop all
import { nfInit, nfHtml, nfSeen, nfPerm, nfAsk, nfElsewhere } from "./notif";   // Settings → Notifications: switches, this device (Web Push), sounds
import { maInit, maActs, maOpenCls, maQuote, rqHtml, rqTake, rqPut, rqClear, refOf, copyPlain, excerpt, type Pin, type Role } from "./msgreply";   // Copy + Reply on chat bubbles, the reply pinned above the composer
import { createRankedSearch, rankedRows } from "./task-search";   // sidebar and drawer Search: the server ranks every task after a pause
import { sgInit, pauseSet, usageSet, usageAdd, usageNote } from "./spendguard";   // core runaway guard and per-task usage
import { sgBillingInit, monthLine, noticeShow } from "./ee/spendguard-billing";   // 1HC monthly plan meter and credit notices
navInit();   // before anything calls history.replaceState

// Live mode: served by 1Helm Cloud at /w/<slug>/app with window.__1HC = { api, slug, classic }. Same UI, real channels and tasks.
const LIVE: { v?: string; api: string; slug: string; classic: string; person?: string; email?: string; support?: string; helper?: string; avatar?: number } | null = (window as any).__1HC || null;
const supportEmail = LIVE?.support || "support@example.com";
const supportHtml = supportEmail.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const LNAME: Record<string, string> = { main: "General" };
// A channel name is shown exactly as the person wrote it ("llms", "finances"); the app never changes its capitalization. Only a channel with no name falls back to its slug.
const liveName = (c: { slug: string; name?: string }) => LNAME[c.slug] ?? (c.name || c.slug);
// The page HTML starts this request before the script downloads (proto src/index.js BOOT_EARLY); use it once, else ask now.
const earlyBoot: Promise<any> | undefined = (window as any).__1HC_BOOT; (window as any).__1HC_BOOT = undefined;
const BOOT: any = LIVE ? await (earlyBoot || fetch(`${LIVE.api}/app/boot?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "")}`, { credentials: "same-origin" }).then(r => r.json()).catch(() => ({ channels: [] }))) : null;
const hasFeature = (feature: string) => !LIVE || Array.isArray(BOOT?.features) && BOOT.features.includes(feature);
const byok = () => hasFeature("billing") ? billingByok : coreByok;
const BYK_SEC = coreByok.BYK_SEC, BYK_TITLE = coreByok.BYK_TITLE;
const bykInit = (d: Parameters<typeof billingByok.bykInit>[0]) => byok().bykInit(d);
const bykRow = () => byok().bykRow();
const bykPage = () => byok().bykPage();
const bykAfter = () => byok().bykAfter();
const bykBusy = () => byok().bykBusy();
const bykEditing = () => byok().bykEditing();
const bykDiscard = () => byok().bykDiscard();
const bykUsageNote = () => byok().bykUsageNote();
const bykSwitched = () => byok().bykSwitched();
const bykSbOn = () => hasFeature("billing") && billingByok.bykSbOn();   // design sandbox only: a pretend switch now
const bykSbCredits = () => billingByok.bykSbCredits();
const storCard = () => hasFeature("billing") ? billingStorage.storCard() : coreStorage.storCard();
const storPlans = () => hasFeature("billing") ? billingStorage.storPlans() : "";
const storPlansOpen = () => hasFeature("billing") && billingStorage.storPlansOpen();
const storTogglePlans = () => { if (hasFeature("billing")) billingStorage.storTogglePlans(); };
const storNotice = (n: any) => hasFeature("billing") ? billingStorage.storNotice(n) : coreStorage.storNotice(n);
const storFull = (msg?: string) => hasFeature("billing") ? billingStorage.storFull(msg) : coreStorage.storFull(msg);
const storInit = (d: Parameters<typeof billingStorage.storInit>[0]) => hasFeature("billing") ? billingStorage.storInit(d) : coreStorage.storInit(d);
const liveNotesWrap = (slug: string, sid: any, html: string) => hasFeature("ambient") ? lnWrap(slug, sid, html) : html;
// "Show estimated costs" (Settings → General → Usage, see costRow): per account, off by default.
const CO: { on: boolean | null; busy: boolean } = { on: null, busy: false };
const showCosts = () => CO.on ?? !!BOOT?.account?.show_costs;
const SPEND: { on: boolean | null; busy: boolean; error: string } = { on: null, busy: false, error: '' };
const spendPauses = () => SPEND.on ?? BOOT?.account?.spend_pauses === true;   // off by default
if (LIVE) ivSet(BOOT?.interview);   // Get to know you: which task in General is the interview (interview.ts)
let PERSON = LIVE?.person?.trim() || "Joseph Yaksich";   // let: Settings → Your account can change the name and email
let EMAIL = LIVE?.email?.trim() || "you@example.com";
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "ME";
let INITIALS = initialsOf(PERSON);
// Custom sections of a channel (sections.ts): what the server says, or off with none.
function csOf(v: any): CS { return { on: !!v?.on, sections: Array.isArray(v?.sections) ? v.sections.map((x: any) => ({ id: String(x.id), title: String(x.title), color: String(x.color) })) : [] }; }
const seed: any = BOOT ? { captured: Date.now(), channels: BOOT.channels.map((c: any) => ({ id: c.id, slug: c.slug, name: c.name, purpose: c.purpose, memory: c.memory || [], notes: c.notes || [], jobs: c.jobs || [], cs: csOf(c.sections),
  sessions: c.sessions.map((v: any) => ({ id: v.id, title: v.title, status: v.state === "waiting" ? "waiting" : v.state === "watching" ? "open" : "resolved", state: v.state === "working" ? "working" : "idle", updated: v.updated, messages: [], srv: v, pinned: v.pinned, done: v.done, unread: v.unread })) })) } : seedMock;

type Msg = { id: number; role: "user" | "agent"; body: string; at: number; steps: string[]; pre?: string[]; prog?: string[]; progressOmitted?: number; cards?: any[]; input_request?: InputRequest; files?: FileV[]; saved?: Saved[] };
// Where a remember really saved, from the server (proto src/saved-to.js): the "Added to …" chips under the reply.
type Saved = { to: "notebook" | "contact" | "memory" | "account"; channel?: string; sec?: string; text?: string; name?: string; fields?: string[] };
type FileV = { id: string; name: string; mime: string; bytes: number; at: number; source?: string; session?: string | null; image?: boolean; tags?: string[]; tx?: string };
type Session = { id: any; srv?: any; loaded?: boolean; loading?: boolean; loadFailAt?: number; streaming?: boolean; attached?: boolean; tmp?: string; rawLine?: string; title: string; status: string; state: string; updated: number; messages: Msg[]; line?: string; unread?: boolean; fresh?: boolean; pinned?: boolean; done?: boolean };
type Channel = { id: number; slug: string; name: string; purpose: string; memory: string[]; notes?: any[]; jobs: any[]; sessions: Session[]; cs?: CS };
type Art = { tx?: string; name: string; kind: "doc" | "sheet" | "pdf" | "image" | "link" | "code"; sid: any; at: number; size: string; fresh?: boolean; fid?: string; you?: boolean; mime?: string; bytes?: number; tags?: string[] };

const NAMES: Record<string, string> = { main: "General", "weather-watch": "Weather", "family-schedule": "Family", "home-finances": "Finances", "trip-planning": "Japan trip", "side-project": "Side project" };
const NOW = Date.now(), SHIFT = NOW - (seed as any).captured;
const channels: Channel[] = (seed as any).channels.map((c: any) => ({
  id: c.id, slug: c.slug, name: LIVE ? liveName(c) : NAMES[c.slug] ?? c.slug, purpose: c.purpose, memory: c.memory, notes: c.notes, cs: c.cs, jobs: (c.jobs || []).map((j: any) => j.ended ? { ...j, ended: j.ended + SHIFT } : j),   // seed ended jobs move with the clock
  sessions: c.sessions.map((s: Session) => ({ ...s, updated: s.updated + SHIFT, messages: s.messages.map(m => ({ ...m, at: m.at + SHIFT })) })),
}));
if (LIVE && !channels.length) {
  // Full-page, self-contained (the app's own body grid/rail styles must not squeeze it into a column).
  document.body.className = ""; document.body.removeAttribute("style");
  document.body.innerHTML = `<div style="position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:#f3f2ef;color:#1c1b19;font:16px/1.55 'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif">
    <main style="width:100%;max-width:440px;background:#fff;border-radius:24px;padding:40px 36px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 40px rgba(0,0,0,.06);text-align:center">
      <img src="/1helm-icon.png" width="48" height="48" alt="" style="display:block;margin:0 auto 22px;border-radius:12px">
      <h1 style="margin:0 0 10px;font:400 30px/1.2 'Instrument Serif',Georgia,serif;letter-spacing:-.01em">We couldn’t open your 1Helm</h1>
      <p style="margin:0 0 26px;color:#6b6a65">It didn’t finish loading. Nothing is lost. Try again in a moment.</p>
      <button onclick="location.reload()" style="height:48px;padding:0 26px;border:0;border-radius:999px;background:#1c1b19;color:#fff;font:600 15px/1 inherit;cursor:pointer">Try again</button>
      <p style="margin:22px 0 0;font-size:13px;color:#a8a49b">Still stuck? <a href="mailto:${encodeURIComponent(supportEmail)}" style="color:#6b6a65">${supportHtml}</a></p>
    </main></div>`;
  throw new Error("1Helm boot returned no channels");
}
if (!LIVE) for (const c of channels) for (const x of c.sessions) if (x.status === "resolved" && ![15, 30, 25].includes(x.id)) x.done = true;
const main = channels.find(c => c.slug === "main") ?? channels[0];
if (!LIVE) for (const [slug, id] of [["family-schedule", 12], ["trip-planning", 27], ["home-finances", 24]] as const) { const x = channels.find(c => c.slug === slug)?.sessions.find(y => y.id === id); if (x) x.pinned = true; }
if (!LIVE) main.purpose = "For anything that doesn't have its own channel yet.";
if (!LIVE) main.sessions = [{ id: 900, title: "Welcome to 1Helm", status: "resolved", state: "complete", done: true, updated: NOW - 3600e3, messages: [
  { id: 9001, role: "agent", at: NOW - 3600e3, steps: [], body: "Each channel on the left is its own space, with its own memory and files. I work in every one, kept focused on that project.\n\nOpen one to see its sessions. A session is one piece of work, from the first ask to done." },
] }];
// Sandbox: three finished tasks whose replies are cards (the /genui errands), so the design is visible without a live helper.
if (!LIVE) for (const [k, i, title] of [["flights", 901, "Flights to Phoenix for Thanksgiving"], ["rsvp", 902, "RSVP for Maya's fall festival"], ["bill", 903, "Why is PG&E $214 this month?"]] as const) {
  const sc = SCENES.find(x => x.k === k); if (!sc) continue; const at = NOW - (i - 900) * 1800e3;
  main.sessions.unshift({ id: i, title, status: "resolved", state: "complete", updated: at, messages: [
    { id: i * 10 + 1, role: "user", at: at - 30e3, steps: [], body: sc.you || title }, { id: i * 10 + 2, role: "agent", at, steps: [], body: sc.lang }] });
}
const AV: Record<string, number> = LIVE ? { main: Number(LIVE.avatar || 8), "weather-tracking": 5, "family-schedule": 3, "public-adjusting": 4, health: 6, media: 7, "photo-fun": 9, myhailtracker: 1, myworship: 2, "come-to-the-table": 3 } : { main: 8, "weather-watch": 8, "family-schedule": 8, "home-finances": 8, "trip-planning": 8, "side-project": 8 };
// The helper's name is whatever the person picked (1HC always sends one). DEFAULT_HELPER is the single fallback; read names through who().
const DEFAULT_HELPER = "Skipper";
const AGENT: Record<string, string> = LIVE ? { main: String(LIVE.helper || "").trim() || DEFAULT_HELPER } : { main: DEFAULT_HELPER, "weather-watch": DEFAULT_HELPER, "family-schedule": DEFAULT_HELPER, "home-finances": DEFAULT_HELPER, "trip-planning": DEFAULT_HELPER, "side-project": DEFAULT_HELPER };
const CHAR: Record<number, string> = { 1: "Chomp", 2: "Pebble", 3: "Ollie", 4: "Penny", 5: "Shelly", 6: "Moss", 7: "Plum", 8: "Skipper", 9: "Pip" };
// ONE helper (Captain, Muse overhaul): every channel is the person's same helper, same name and avatar, kept on that project.
if (LIVE) for (const c of channels) { AV[c.slug] = AV.main; AGENT[c.slug] = AGENT.main; }
// Projects in the rail: serif initials on a soft color (Captain pick 10-01, /icons option 8). Skipper keeps General.
const MONO_C = ["#2f80c9", "#e0742b", "#2f9461", "#d0453b", "#7a55c7", "#b7791f", "#0e8a8a", "#c2417a"];
const initials = (c: Channel) => {
  const w = c.name.trim().split(/\s+/), first = (x: string) => [...x][0]?.toUpperCase() ?? "?";
  let t = first(w[0]);
  if (channels.some(o => o !== c && o.slug !== "main" && first(o.name.trim()) === t)) t = w.length > 1 ? t + first(w[1]) : t + ([...w[0]][1] ?? "");
  return t;
};
const mono = (c: Channel) => { const i = channels.filter(o => o.slug !== "main").indexOf(c); return `<span class="mono" style="--c:${MONO_C[(i < 0 ? 0 : i) % MONO_C.length]}">${esc(initials(c))}</span>`; };
const av = (c: Channel, cls = "av") => `<img class="${cls}" src="/av/${AV[c.slug] ?? 2}.png" alt="">`;
let nextId = 10000;

// Icons (Lucide, MIT), stroke only.
const I = (d: string, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ic = {
  newS: I('<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a1 1 0 0 1 3 3l-9 9-3.9 1 1-3.9z"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 15),
  memory: I('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>', 15),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 15),
  chev: I('<path d="m9 18 6-6-6-6"/>', 14),
  down: I('<path d="m6 9 6 6 6-6"/>', 16),
  up: I('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 16),
  term: I('<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>', 14),
  gear: I('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>', 18),
  main: I('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', 17),
  "weather-watch": I('<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 1 0 6 17.7"/><path d="M6 19h11.5"/>', 17),
  "family-schedule": I('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', 17),
  "home-finances": I('<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20"/><path d="M6 15h3"/>', 17),
  "trip-planning": I('<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>', 17),
  "side-project": I('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>', 17),
  plus: I('<path d="M5 12h14"/><path d="M12 5v14"/>', 18),
  menu: I('<path d="M5 9h14"/><path d="M5 15h14"/>', 22),
  back: I('<path d="m15 18-6-6 6-6"/>', 22),
  mic: I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>', 18),
  lib: I('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>', 16),
  folder: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 18),
  list: I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', 16),
  grid: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', 16),
  up2: I('<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>', 16),
  pin: I('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>', 14),
  check: I('<path d="M20 6 9 17l-5-5"/>', 13),
  screen: I('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>', 14),
  home: I('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', 16),
  nb: I('<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4M2 10h4M2 14h4M2 18h4"/><path d="M21.4 5.6a2 2 0 1 0-2.8-2.8l-5 5a2 2 0 0 0-.5.9l-.8 2.9 2.9-.8a2 2 0 0 0 .9-.5z"/>', 16),
  pen: I('<path d="M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.9L2 22l4.9-1.3a2 2 0 0 0 .9-.5z"/>', 14),
  trash: I('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 14),
  people: I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', 16),
  msg: I('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
  phone: I('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>', 15),
  mail: I('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>', 15),
  cake: I('<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3M12 8v3M17 8v3"/>', 15),
  pinmap: I('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', 15),
  apps: I('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>', 16),
  key: I('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3"/><path d="m17 6 3 3"/><path d="m14 9 2 2"/>', 17),
};

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
// ---------- Soon: in live mode, controls that aren't wired yet stay visible, wear a "Soon" mark, explain themselves on tap, and log the tap ----------
const SOON: Record<string, [string, string]> = {
  delete: ["Delete account", "Asks you to confirm twice, then deletes everything."],
  "google-next": ["Connect Google", "Let your helper read and act in Gmail, Calendar and Drive."], "connections-next": ["More apps", "One-click connections to Notion, Slack, Dropbox and YouTube."],
  texting: ["Text with your helper", "Text your helper from your phone, and get a text when something needs you."], notif: ["Notifications", "Choose what pings this device."],
};
const SP = `<span class="soonp">Soon</span>`;
const isSoon = (k: string) => !!LIVE && k in SOON;
// Icon buttons (attach, mic): same look, a small dot, and "· Soon" in the tooltip.
const cb = (k: string, title: string, icon: string, extra = "") => LIVE && k === "attach" ? `<button type="button" class="cbtn${extra}" title="Attach files" aria-label="Attach files" data-attach>${icon}</button>`
  : `<button type="button" class="cbtn${extra}${LIVE ? " soon" : ""}" title="${title}${LIVE ? " · Soon" : ""}"${LIVE ? ` data-soon="${k}"` : ""}>${icon}</button>`;
if (LIVE) window.addEventListener("click", e => {
  const el = (e.target as HTMLElement).closest?.<HTMLElement>("[data-soon]"); if (!el) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const k = el.dataset.soon!, appN = k.startsWith("app-") ? el.closest(".apcard")?.querySelector("b")?.textContent || "This app" : "", [a, b] = SOON[k] ?? (appN ? [appN, "More one-click apps are coming next."] : ["Coming soon", ""]);
  document.getElementById("smenuw")?.replaceChildren(); (S as any).menu = false;
  note(ic.clock, `${a} · Soon`, b, "");
  fetch(`${LIVE.api}/soon`, { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ k, where: location.hash || "#/", w: innerWidth }) }).catch(() => {});
}, true);
// breaks: a single newline is a line break, as the person typed it (a sign-off quoted as "> Best,\n> Joseph" stays two lines).
const md = (s: string) => DOMPurify.sanitize(marked.parse(s, { async: false, breaks: true }) as string);
const live = (s: Session) => s.status === "open" || s.status === "waiting";
// The one place the unread / needs-you dot lives: a fixed-width slot at the far right of a task row, after the pin and more buttons.
// The slot holds the time (rows that show one) or the dot, never both, and keeps its width, so nothing moves when the dot appears or clears.
// needsYou is the rule for "this task waits on the person" (Home's "All clear" reads it). rowLit adds a finished reply nobody has opened yet. The row dot,
// the rail dot, the phone channel list and the phone menu dot all read rowLit, so a dot only shows when the list it leads to has a row with a dot.
// A done task never counts.
const needsYou = (x: Session) => !x.done && x.status === "waiting";
const rowLit = (x: Session) => needsYou(x) || (!x.done && !!x.unread);
const rowDot = (x: Session) => rowLit(x) ? `<i class="dot" title="${x.unread ? "New result" : "Needs you"}"></i>` : "";
const rowTail = (x: Session, when = true) => `<span class="tail">${rowDot(x) || (when ? `<span class="when">${ago(x.done ? doneAt(x) : x.updated)}</span>` : "")}</span>`;
function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60e3);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.round(m / 60); if (h < 24) return `${h}h`;
  const d = Math.round(h / 24); return d < 7 ? `${d}d` : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
// Agent state is the helper's; "done" belongs to the person alone (the checkbox).
const astate = (x: Session) => x.state === "working" ? "working" : x.status === "waiting" ? "waiting" : x.status === "open" ? "watching" : "ready";
const stWorking = (x: Session) => !!LIVE && !!x.srv && !x.done && astate(x) === "working";   // a Stop shows for it
const statusText = (s: Session) => s.done ? "Done" : ({ working: "Working", waiting: "Waiting on you", watching: "Watching", ready: "Ready for you" } as const)[astate(s)];
// Texting conversations are ongoing (like a thread in Messages): a plain message icon, no checkbox, nothing to mark done.
const box = (x: Session, sm = false) => isTexts(x) ? `<span class="box tbox${sm ? " sm" : ""}${astate(x) === "working" ? " working" : ""}" aria-hidden="true">${ic.msg}${astate(x) === "working" ? TRACE() : ""}</span>` : `<span class="box${sm ? " sm" : ""}${x.done ? " done" : astate(x) === "working" ? " working" : ""}" role="checkbox" tabindex="0" aria-checked="${!!x.done}" data-done="${x.id}"
  title="${x.done ? "Done. Click to reopen" : astate(x) === "working" ? `${esc(who(chOf(x)))} is working on this. Check it off whenever you decide it's done` : "Mark done"}">${ic.check}${!x.done && astate(x) === "working" ? TRACE() : ""}</span>`;
// A short light segment travels around the box's own outline while the helper works (SVG dash, works in every browser).
// Phase is tied to the clock so live list refreshes never make the light jump back to the start.
const TRACE = () => `<svg class="trace" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6.5" pathLength="100" style="animation-delay:-${Date.now() % 1500}ms"/></svg>`;
const chOf = (x: Session) => channels.find(c => c.sessions.includes(x)) ?? main;

const isLib = () => /^#\/[^/]+\/library/.test(location.hash);
const isNb = () => /^#\/[^/]+\/notebook/.test(location.hash);
const isCt = () => /^#\/[^/]+\/contacts/.test(location.hash);
function route(): { ch: Channel; s: Session | null } {
  const [, slug, , sid] = location.hash.replace(/^#\/?/, "/").split("/");
  const ch = channels.find(c => c.slug === slug) ?? main;
  const s = sid === "new" ? null : (sid ? ch.sessions.find(x => String(x.id) === sid || x.tmp === sid) ?? null : null);
  return { ch, s };
}
const phone = () => matchMedia("(max-width: 767px)").matches;
const go = (slug: string, sid?: number | "new") => { location.hash = `/${slug}${sid !== undefined ? `/s/${sid}` : ""}`; };

// The computer: one icon, top-right of every screen. A dot means this channel's computer is running a browser step or a command right now
// (or a few seconds ago), or you have taken over its browser. A task that is only thinking or writing does not light it. The channel
// computer reports this (/ch/<channel>/browser/activity, polled by pcActivityTick), so a reload or reconnect reads the same answer.
const pcLit: Record<string, { on: boolean; at: number }> = {};
const pcOn = (slug: string) => !!pcLit[slug]?.on && Date.now() - pcLit[slug].at < 8000;   // an answer from a channel you left goes stale
function pcFab(ch: Channel) { const busy = pcOn(ch.slug);
  return `<button class="pcfab${busy ? " busy" : ""}" data-watch="${esc(ch.slug)}" title="${esc(who(ch))}'s computer" aria-label="Open ${esc(who(ch))}'s computer">${ic.screen}${busy ? `<i class="pcdot"></i>` : ""}</button>`; }
// Polls the open channel's computer while one of its tasks is working (or its dot is still lit), and moves the dot on the desktop button and
// the phone header button without repainting the page. Nothing is polled for an idle channel.
function pcPaintDot(slug: string, on: boolean) {
  document.querySelectorAll<HTMLElement>(`[data-watch="${CSS.escape(slug)}"]`).forEach(b => {
    if (b.classList.contains("pcfab")) { b.classList.toggle("busy", on); const d = b.querySelector(".pcdot"); if (on && !d) b.insertAdjacentHTML("beforeend", `<i class="pcdot"></i>`); else if (!on) d?.remove(); }
    else if (b.classList.contains("cb")) b.classList.toggle("busy", on);
  });
}
let pcActBusy = false;
async function pcActivityTick() {
  const ch = route().ch;
  if (!LIVE || pcActBusy || document.hidden || !(ch.sessions.some(x => x.state === "working") || pcOn(ch.slug))) return;
  pcActBusy = true;
  try {
    const st: any = await api(`/ch/${ch.slug}/browser/activity`);
    const on = !!(st && (st.busy || st.controlled));
    const was = pcOn(ch.slug); pcLit[ch.slug] = { on, at: Date.now() }; if (on !== was) pcPaintDot(ch.slug, on);
  } catch {} finally { pcActBusy = false; }
}
setInterval(pcActivityTick, 2500);
// The channel rail (desktop): every channel, then New channel. railWire keeps its scroll spot and bottom fade.
function railHtml(ch: Channel) {
  const nb = navButtons(`Back${scLabel("nav-back") ? `  ${scLabel("nav-back")}` : ""}`, `Forward${scLabel("nav-forward") ? `  ${scLabel("nav-forward")}` : ""}`);
  return `<div class="chs"><div class="navh">${nb[0]}<div class="brand" title="1Helm"><img src="/1helm-icon.png" alt="1Helm"></div>${nb[1]}</div>${sidebarRestoreButton()}${channels.map((c, i) => {
    const n = c.sessions.filter(rowLit).length, pipTitle = c.sessions.some(needsYou) ? "Needs you" : "New result";
    return `<button class="ch${c === ch ? " on" : ""}" data-ch="${c.slug}" title="${esc(c.name)}${scLabel("jump") ? `  ${scLabelN("jump", i + 1)}` : ""}">
      <span class="tile">${c.slug === "main" ? av(c) : mono(c)}${n ? `<i class="pip" title="${pipTitle}"></i>` : ""}</span><span class="lbl">${esc(c.name)}</span></button>`;
  }).join("")}<button class="ch add" title="New channel" aria-label="New channel" data-newch><span class="tile">${ic.plus}</span></button></div>
    <div class="foot">${LIVE ? pomoGlobalBtn(true) : ""}${hasFeature("connected_apps") ? `<button class="iconbtn apico" data-apps title="Apps${scLabel("apps") ? `  ${scLabel("apps")}` : ""}" aria-label="Apps">${I('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>', 20)}</button>` : ""}<button class="me" data-sgo="general" title="${esc(PERSON)} · Settings" aria-label="Settings">${esc(INITIALS)}</button><button class="iconbtn" data-smenu title="Menu" aria-label="Menu" aria-haspopup="menu">${ic.menu}</button></div>`;
}
function railWire(railTop: number) {
  const cs = document.querySelector<HTMLElement>("#rail .chs")!; cs.scrollTop = railTop; const fade = () => cs.classList.toggle("end", cs.scrollHeight - cs.scrollTop - cs.clientHeight < 4); fade(); cs.onscroll = fade;
    const on = cs.querySelector<HTMLElement>(".ch.on"); if (on && (on.offsetTop < cs.scrollTop || on.offsetTop + on.offsetHeight > cs.scrollTop + cs.clientHeight)) on.scrollIntoView({ block: "nearest" });
}
// The one rule for focus a re-render restores or sets on its own (a job finishing, a server push, a route repaint). It never takes focus from
// another field the person is typing in, and never moves it behind an open pop-up. Focus that follows the person's own click or key calls .focus() directly.
function overlayRoot(): Element | null {
  return document.querySelector('[aria-modal="true"], #sheet.on .sheet, .pkpop') ?? (NT.open ? document.querySelector("#nt .nmodal") : null);
}
function autoFocus(el: HTMLElement | null | undefined, opts?: FocusOptions, caretEnd = false): boolean {
  if (!el || !el.isConnected) return false;
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== el && a.isConnected && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a.isContentEditable)) return false;
  const ov = overlayRoot(); if (ov && !ov.contains(el)) return false;
  if (dialogOpen()) return false;
  el.focus(opts);
  if (caretEnd && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) el.setSelectionRange(el.value.length, el.value.length);
  return true;
}
// Whatever repaints the screen (a delete, rename, archive or list refresh finishing, a live event) must not touch what is being typed.
// The message box is rebuilt with the screen, so its text, caret and focus are put back when it is the same composer: the same task, or
// the same channel Home. Another task's composer starts empty, so a draft never lands in the wrong task.
let boxOwner: object | null = null, keepDepth = 0;
// Drafts: one per message box, keyed by channel and task ("home" for the channel Home box); the new-task box is keyed by the channel it opened from.
draftsInit(LIVE?.slug || "sandbox");
const boxKey = () => { const { ch, s } = route(); return `box|${ch.slug}|${s ? s.id : "home"}`; };
function boxRestore(box: HTMLTextAreaElement) {
  const d = draftGet(boxKey()); if (!d) return;
  box.value = d.t; box.dispatchEvent(new Event("input", { bubbles: true }));   // the same height and Send button as typing
  box.setSelectionRange(d.t.length, d.t.length); box.scrollTop = box.scrollHeight;
}
function keepDraft(paint: () => void) {
  if (keepDepth) { paint(); return; }
  const { ch, s } = route(), owner = s ?? ch, was = document.getElementById("box") as HTMLTextAreaElement | null;
  const kept = was && boxOwner === owner && (was.value || document.activeElement === was)
    ? { v: was.value, a: was.selectionStart, b: was.selectionEnd, dir: was.selectionDirection, focus: document.activeElement === was, top: was.scrollTop } : null;
  keepDepth++; try { paint(); } finally { keepDepth--; }
  const now = route(); boxOwner = now.s ?? now.ch;
  const box = document.getElementById("box") as HTMLTextAreaElement | null;
  if (box && box !== was && !box.value && !(kept && boxOwner === owner)) { boxRestore(box); return; }   // another channel or task, or a reload: the draft that belongs to this box
  if (!kept || !box || box === was || (box.value && box.value !== kept.v) || boxOwner !== owner) return;
  box.value = kept.v; box.dispatchEvent(new Event("input", { bubbles: true }));   // the same size and Send button as typing
  box.scrollTop = kept.top;
  if (kept.focus) { box.focus({ preventScroll: true }); box.setSelectionRange(kept.a ?? kept.v.length, kept.b ?? kept.v.length, kept.dir ?? "none"); }
}
function render() { keepPaneFloats(() => keepDraft(renderStage)); }
function renderStage() {
  zoneGuard();
  if (isNb()) nbBeeVisit(route().ch);
  requestAnimationFrame(nbBeePaint);
  { const rd = schRedirect(location.hash, slug => channels.some(c => c.slug === slug), main.slug); if (rd) history.replaceState(null, "", rd); }   // old Schedules / Scheduled links → the one view
  if (phone()) { for (const id of ["#rail", "#side", "#stage"]) $(id).innerHTML = ""; renderM(); sidebarSync(); return; }
  $("#m").innerHTML = "";
  const { ch, s } = route();
  document.title = isSch() ? "Scheduled · 1Helm" : isCt() ? "Contacts · 1Helm" : isNb() ? `${who(ch)}'s notebook · 1Helm` : isLib() ? `${ch.name} Library · 1Helm` : s ? `${s.title} · ${ch.name} · 1Helm` : `${ch.name} Home · 1Helm`;
  if (s) { if (LIVE && s.unread) livePatch(ch, s, { seen: true }); s.unread = false; if (LIVE) openLoad(ch, s); }

  const railTop = document.querySelector("#rail .chs")?.scrollTop ?? 0;
  $("#rail").innerHTML = railHtml(ch); railWire(railTop);

  const sl = document.querySelector<HTMLElement>("#side .sessions"), sideTop = sl && sl.dataset.ch === ch.slug ? sl.scrollTop : 0;   // the task list keeps its scroll spot across a redraw of the same channel
  const qEl = $("#q") as HTMLInputElement | null, q = qEl && qEl.dataset.ch === ch.slug ? qEl.value : "", focused = document.activeElement === qEl;

  $("#side").innerHTML = `
    <div class="chhead">${av(ch, "av lg")}<div><h2>${esc(ch.name)}</h2><span class="chip">${esc(AGENT[ch.slug] ?? ch.name)}</span></div>${LIVE ? channelMore(ch.slug, ch.name) : ""}${sidebarCollapseButton()}</div>
    <p class="purpose">${esc(ch.purpose)}</p>
    <button class="new" data-ntask>${ic.newS}<span>New</span>${scLabel("new-task") ? `<kbd>${scLabel("new-task")}</kbd>` : ""}</button>
    <a class="navrow${s || isLib() || isNb() || isCt() || isSch() ? "" : " on"}" href="#/${ch.slug}" data-new>${ic.home}<span>Home</span></a>
    <a class="navrow${isLib() ? " on" : ""}" href="#/${ch.slug}/library">${ic.lib}<span>Library</span></a>
    <a class="navrow${isNb() ? " on" : ""}" href="#/${ch.slug}/notebook">${ic.nb}<span>Notebook</span></a>
    <a class="navrow${isCt() ? " on" : ""}" href="#/${ch.slug}/contacts">${ic.people}<span>Contacts</span></a>
    <label class="search">${ic.search}<input id="q" data-ch="${ch.slug}" placeholder="Search" value="${esc(q)}" autocomplete="off">${scLabel("search") ? `<kbd>${scLabel("search")}</kbd>` : ""}</label>
    <div class="sessions" data-ch="${ch.slug}">${sideList(ch, s, q)}</div>
    <div class="drawer">
      <a class="drow${isSch() ? " on" : ""}" href="#/${ch.slug}/scheduled" title="Repeats, follow-ups and messages set to send later">${ic.clock}<span>Scheduled</span></a>
    </div><button class="sidesrch" data-sidesrch aria-label="Search tasks">${ic.search}<span>Search</span></button>`;
  sidebarSync();
  { const l = document.querySelector<HTMLElement>("#side .sessions"); if (l) { l.scrollTop = sideTop; const on = l.querySelector<HTMLElement>(".sess.on"); if (on && (on.offsetTop < l.scrollTop || on.offsetTop + on.offsetHeight > l.scrollTop + l.clientHeight)) on.scrollIntoView({ block: "nearest" }); } }   // only an off-screen selected row moves the list
  if (focused) { const i = $("#q") as HTMLInputElement; i.focus(); i.setSelectionRange(i.value.length, i.value.length); }

  if (isSch()) { $("#stage").innerHTML = (LIVE ? pcFab(ch) : "") + schPage(ch.slug); schAfter(schSec()); return; }
  if (isLib()) { $("#stage").innerHTML = (LIVE ? pcFab(ch) : "") + libPage(ch); return; }
  beeLibReset();   // left the Library: an open Bee conversation closes
  if (isNb()) { $("#stage").innerHTML = (LIVE ? pcFab(ch) : "") + nbPage(ch); nbAfter(); nbSync(ch); void nbpLoad(ch); return; }
  if (isCt()) { $("#stage").innerHTML = (LIVE ? pcFab(ch) : "") + ctPage(); ctAfter(); return; }
  $("#stage").innerHTML = (LIVE ? pcFab(ch) : "") + (s ? `
    <header class="th"><span class="ho" data-ho="0"><span class="who-chip">${av(ch, "av sm")}${esc(AGENT[ch.slug] ?? ch.name)}</span></span><h1 title="${esc(s.title)}">${canRename(s) ? `<button class="task-title" data-rename="${esc(ch.slug)}|${esc(s.id)}" aria-label="Rename task" title="Rename task"><span data-task-title>${esc(s.title)}</span></button>` : esc(s.title)}</h1><span class="ho" data-ho="1">${headPin(s)}</span>${headDone(s)}${LIVE && s.srv ? `<span class="ho" data-ho="3">${headDelete(ch.slug, s.id)}</span>` : ""}${LIVE ? `${hasFeature("ambient") ? `<span class="ho" data-ho="7">${lnBtn(ch.slug, s.id)}</span>` : ""}<span class="ho" data-ho="6">${pomoBtn(ch.slug, s.id)}</span><span class="ho" data-ho="5">${todoBtn(ch.slug, s.id)}</span><span class="ho" data-ho="4">${tkBtn(ch.slug, s.id)}</span>` : ""}<button class="hmore" data-hmore aria-label="More actions" title="More actions" aria-haspopup="menu" aria-expanded="false" hidden>${MORE}</button></header>
    ${stageBody(ch, s)}` : `
    <div class="dhome" id="scroll"><div class="hwrap">${homeHead(ch)}${composer(`Give ${esc(who(ch))} a task`)}
      <p class="hhint" id="hhint">${HINT}</p><div id="htasks">${tasksHtml(ch)}</div></div></div>`);
  const sc = document.getElementById("scroll"); if (sc && s) sc.scrollTop = sc.scrollHeight;
  if (!s) autoFocus($("#box"));
  if (LIVE && s) { tkSync(ch.slug, s.id); pomoSync(ch.slug, s.id); if (hasFeature("ambient")) lnSync(ch.slug, s.id); }
  hWatch();
  clearFresh(ch);
  stNow();
}
// The open task: chat + composer. Live, they sit in the tracker's wrapper (the Activity feed goes beside them once the server sends cards).
function stageBody(ch: Channel, s: Session) {
  if (LIVE && ivIs(ch.slug, s.id)) return ivView();
  const body = `<div class="scroll" id="scroll"><div class="msgs">${msgsHtml(s, ch)}</div></div>
    <div class="dock">${composer(`Reply to ${esc(AGENT[ch.slug] ?? ch.name)}`)}</div>`;
  return LIVE && hasFeature("ambient") ? lnWrap(ch.slug, s.id, tkWrap(ch.slug, s.id, body)) : LIVE ? tkWrap(ch.slug, s.id, body) : body;
}

// ---------- Tasks: type on Home, hit Enter, it becomes a session that works in the background ----------
const HINT = "Press Enter to start. It keeps working while you do other things.";
const STATUS: Record<number, string> = {
  8: "Checking air quality every hour · AQI 62 now", 13: "Waiting on you · sign the form by Friday", 23: "Checking bills every morning at 8 · next is $486 on Oct 3",
  29: "Checking the fare every 6 hours · $1,742 now", 20: "Live at portfolio-7ok.pages.dev · redeploys on every push",
};
const VERB: Record<string, [string, string]> = {
  main: ["looking into it", "pulling it together"], "weather-watch": ["pulling the latest forecast", "checking alerts near you"],
  "family-schedule": ["checking the family calendar", "looking for conflicts"], "home-finances": ["looking through your accounts", "adding things up"],
  "trip-planning": ["searching flights and hotels", "comparing prices"], "side-project": ["reading the code", "running the tests"],
};
const kindOf = (x: Session) => x.state === "working" ? "working" : x.status === "waiting" ? "waiting" : live(x) ? "watching" : "done";
function lineOf(x: Session) {
  if (LIVE) return liveLine(x);
  if (x.line) return x.line; if (STATUS[x.id]) return STATUS[x.id];
  const m = x.messages.filter(y => y.role === "agent" && y.body).at(-1); return m ? plain(m.body).split(/(?<=\.)\s/)[0] : "";
}
function greet() { const h = new Date().getHours(); return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
function dateLine(ch: Channel) {
  const n = ch.sessions.filter(x => !x.done).length, wd = new Date().toLocaleDateString(undefined, { weekday: "long" });
  return `<div class="hdate"><b>${esc(ch.name)} Home</b><span>${wd}${n ? ` · ${n} open` : ""}</span></div>`;
}
let homeNotesBusy = false;
function homeHead(ch: Channel) {
  return `${dateLine(ch)}<h1>${greet()}.</h1><p class="hsub">What should ${esc(who(ch))} take off your plate?</p>${LIVE && hasFeature("ambient") && !BOOT?.look ? `<button type="button" class="home-notes" data-home-notes${homeNotesBusy ? ' disabled aria-busy="true"' : ""} title="Start a new task for meeting or call notes"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4M21 12h0"/></svg>${homeNotesBusy ? "Opening…" : "Live Notes"}</button>` : ""}`;
}
// A direct UI action, never a chat message: creating the empty task runs no agent.
async function homeNotes() {
  if (!LIVE || !hasFeature("ambient") || BOOT?.look || homeNotesBusy) return;
  if (!lnCanStart()) { note(ic.check, "Live Notes", "Use a browser with microphone access, or connect your Bee in Settings.", ""); return; }
  const { ch } = route(), from = location.hash;
  homeNotesBusy = true;
  document.querySelectorAll<HTMLButtonElement>("[data-home-notes]").forEach(b => { b.disabled = true; b.setAttribute("aria-busy", "true"); b.lastChild!.textContent = "Opening…"; });
  try {
    const v = await api(`/res/${ch.slug}/sessions`, { title: "Live notes" });
    if (v?.error || !v?.id) throw new Error(v?.message || "The notes task couldn't be created. Try again.");
    const s = { id: v.id, title: v.title, status: "resolved", state: "idle", updated: Date.now(), messages: [], fresh: true } as unknown as Session;
    applySrv(s, v); ch.sessions.unshift(s);
    // A slow request must not pull them back after they've navigated elsewhere.
    if (location.hash !== from) { repaint(ch); return; }
    location.hash = `/${ch.slug}/s/${v.id}`;
    render();
    await lnStartFor(ch.slug, v.id);
  } catch (e) { note(ic.check, "Couldn't open Live Notes", e instanceof Error ? e.message : "Check your connection and try again.", ""); }
  finally {
    homeNotesBusy = false;
    document.querySelectorAll<HTMLButtonElement>("[data-home-notes]").forEach(b => { b.disabled = false; b.removeAttribute("aria-busy"); b.lastChild!.textContent = "Live Notes"; });
    if (!route().s) repaint(route().ch);
  }
}
function tasksHtml(ch: Channel) {
  const pri = (x: Session) => x.done ? 9 : x.status === "waiting" ? 0 : x.state === "working" ? 1 : x.unread ? 2 : 3;
  const pins = ch.sessions.filter(x => x.pinned).sort((a, b) => pri(a) - pri(b) || b.updated - a.updated), un = ch.sessions.filter(x => !x.pinned);
  const act = un.filter(x => !x.done && !isTexts(x)).sort((a, b) => pri(a) - pri(b) || b.updated - a.updated), txt = un.filter(x => !x.done && isTexts(x)).sort((a, b) => b.updated - a.updated);
  const done = un.filter(x => x.done).sort(byDone).slice(0, 4);
  const task = (x: Session) => `<a class="task${freshOnce("task", x, x.fresh)}${x.done ? " isdone" : ""}" href="#/${ch.slug}/s/${x.id}">${box(x)}
    <span class="tbody"><span class="tt">${esc(x.title)}</span><span class="tl">${esc(x.done ? "Done" : lineOf(x))}</span></span>${rowStop(ch.slug, x.id, x.title, stWorking(x))}${pinBtn(x)}${rowTail(x)}</a>`;
  const shut = (k: string) => folded(ch, `home-${k}`), sec = (k: string, label: string, n: number) => foldHead("hsec", `home-${k}`, label, n, shut(k));
  const group = (k: string, label: string, items: Session[]) => items.length ? `${foldHead("hsec hst", `home-${k}`, label, 0, shut(k))}${shut(k) ? "" : items.map(task).join("")}` : "";
  return `${pins.length ? `${sec("pinned", `${ic.pin}Pinned`, pins.length)}${shut("pinned") ? "" : pins.map(task).join("")}` : ""}
    ${act.length ? stateGroups(act, group) : txt.some(needsYou) ? "" : `<div class="hnone">All clear. Nothing open.</div>`}
    ${txt.length ? `${sec("texts", "Texts", txt.length)}${shut("texts") ? "" : txt.map(task).join("")}` : ""}
    ${done.length ? `${sec("done", "Done", done.length)}${shut("done") ? "" : done.map(x => `<a class="recent isdone" href="#/${ch.slug}/s/${x.id}">${box(x, true)}<span class="rt">${esc(x.title)}</span>${pinBtn(x)}<span class="when">${ago(doneAt(x))}</span></a>`).join("")}` : ""}
    ${libHtml(ch)}`;
}
// ---------- Library: everything this channel's helper has made, one tap from the task that made it ----------
const H = 3600e3, D = 24 * H;
const LIB: Record<string, Art[]> = LIVE ? {} : {
  "weather-watch": [
    { name: "Weekend hike forecast", kind: "doc", sid: 7, at: NOW - 3 * D, size: "1 page" },
    { name: "Rain totals · last 30 days", kind: "sheet", sid: 9, at: NOW - 1 * D, size: "30 rows" },
    { name: "Air quality map", kind: "image", sid: 8, at: NOW - 5 * H, size: "PNG" },
  ],
  "family-schedule": [
    { name: "Family calendar · October", kind: "pdf", sid: 14, at: NOW - 4 * D, size: "2 pages" },
    { name: "Soccer practice schedule", kind: "sheet", sid: 12, at: NOW - 5 * D, size: "12 rows" },
    { name: "Field trip permission form", kind: "pdf", sid: 13, at: NOW - 2 * D, size: "1 page" },
    { name: "Grandma gift ideas", kind: "doc", sid: 15, at: NOW - 4 * D, size: "8 ideas" },
    { name: "Pickup rotation", kind: "sheet", sid: 11, at: NOW - 5 * D, size: "5 rows" },
  ],
  "home-finances": [
    { name: "October budget", kind: "sheet", sid: 24, at: NOW - 2 * D, size: "24 rows" },
    { name: "Subscriptions to cancel", kind: "doc", sid: 21, at: NOW - 6 * D, size: "4 items" },
    { name: "Grocery spending · 3 months", kind: "image", sid: 22, at: NOW - 5 * D, size: "Chart" },
    { name: "Emergency fund plan", kind: "doc", sid: 25, at: NOW - 1 * D, size: "1 page" },
  ],
  "trip-planning": [
    { name: "Kyoto itinerary", kind: "doc", sid: 27, at: NOW - 4 * D, size: "5 days" },
    { name: "Tokyo hotels compared", kind: "sheet", sid: 30, at: NOW - 1 * D, size: "9 hotels" },
    { name: "Japan visa checklist", kind: "pdf", sid: 28, at: NOW - 3 * D, size: "1 page" },
    { name: "Delta fare history", kind: "image", sid: 29, at: NOW - 6 * H, size: "Chart" },
  ],
  "side-project": [
    { name: "portfolio-7ok.pages.dev", kind: "link", sid: 20, at: NOW - 3 * H, size: "Live site" },
    { name: "Performance report", kind: "pdf", sid: 19, at: NOW - 2 * D, size: "3 pages" },
    { name: "Astro portfolio", kind: "code", sid: 16, at: NOW - 6 * D, size: "42 files" },
  ],
};
const KIND: Record<Art["kind"], [string, string]> = {
  doc: ["Doc", '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'],
  sheet: ["Sheet", '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>'],
  pdf: ["PDF", '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 15.5h7"/>'],
  image: ["Image", '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/>'],
  link: ["Link", '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'],
  code: ["Code", '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'],
};
const libOpen: Record<string, boolean> = {};
// Live Library = the channel's real files (uploads + files the helper shared). Rows open the file itself.
const KB = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
function fkind(name: string, mime = ""): Art["kind"] {
  const e = (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  if (/^image\//.test(mime) || /^(png|jpe?g|gif|webp|heic|heif|svg)$/.test(e)) return "image";
  if (e === "pdf" || mime === "application/pdf") return "pdf";
  if (/^(xlsx?|csv|tsv|numbers|ods)$/.test(e)) return "sheet";
  if (/^(js|ts|py|json|html?|css|sh|zip|xml|sql|ipynb)$/.test(e)) return "code";
  return "doc";
}
const fileUrl = (slug: string, id: string, dl = false) => fileResUrl(LIVE!.api, slug, id, dl);
const artHref = (ch: Channel, a: Art) => a.fid ? fileUrl(ch.slug, a.fid) : `#/${ch.slug}/s/${a.sid}`;
const toArt = (f: FileV): Art => ({ name: f.name, kind: fkind(f.name, f.mime), sid: f.session, at: f.at, size: KB(f.bytes), fid: f.id, you: f.source === "upload", mime: f.mime, bytes: f.bytes, tags: f.tags, tx: f.tx });
// Library files the person deleted: hidden at once, and kept hidden while the delete request runs, so a reload from the server can't bring them back.
const FILE_DEL = new Set<string>();
function setFiles(ch: Channel, files: FileV[]) {
  if (FILE_DEL.size) files = files.filter(f => !FILE_DEL.has(f.id));
  const was = LIB[ch.slug] || [], sig = (l: Art[]) => l.map(a => a.fid).sort().join(",");
  const next = files.map(toArt); next.forEach(a => { if (was.length && !was.some(w => w.fid === a.fid)) a.fresh = true; });
  const changed = sig(was) !== sig(next); LIB[ch.slug] = next; return changed;
}
if (LIVE) for (const c of BOOT?.channels || []) { const ch = channels.find(x => x.slug === c.slug); if (ch) setFiles(ch, c.files || []); }
const lib = (ch: Channel) => (LIB[ch.slug] ??= []).sort((a, b) => b.at - a.at);
function libHtml(ch: Channel) {
  const all = lib(ch), n = phone() ? 4 : 6, shown = all.slice(0, n);
  const card = (a: Art) => { const [k, d] = KIND[a.kind]; const src = ch.sessions.find(x => x.id === a.sid);
    return `<a class="art${a.fresh ? " fresh" : ""}" href="${artHref(ch, a)}"${a.fid ? ` data-fv="${esc(ch.slug)}|${esc(a.fid)}"` : ""} title="${esc(src ? `From “${src.title}”` : a.name)}"><span class="aico k-${a.kind}">${I(d, 20)}</span>
      <span class="an">${esc(a.name)}</span><span class="am">${k} · ${esc(a.size)} · ${ago(a.at)}</span></a>`; };
  return `<div class="hsec"><span>Library</span><a class="more" href="#/${ch.slug}/library?c=${ch.slug}"><span>${all.length > n ? `See all ${all.length}` : "Open Library"}</span>${ic.chev}</a></div>
    ${all.length ? `<div class="arts">${shown.map(card).join("")}</div>` : `<div class="hnone">Files ${esc(who(ch))} makes for you, and files you add, show up here.</div>`}`;
}
// ---------- Library page: the "Drive" of 1Helm. Every file from every channel, folders = channels ----------
const EXTRA: Record<string, Art[]> = {
  "family-schedule": [{ name: "School supply list.pdf", kind: "pdf", sid: 14, at: NOW - 9 * D, size: "You added" }, { name: "Birthday party photos", kind: "image", sid: 15, at: NOW - 12 * D, size: "14 photos" }],
  "home-finances": [{ name: "2025 tax return.pdf", kind: "pdf", sid: 25, at: NOW - 20 * D, size: "You added" }],
  "trip-planning": [{ name: "Passport scan", kind: "image", sid: 28, at: NOW - 15 * D, size: "You added" }, { name: "JR Pass options", kind: "sheet", sid: 27, at: NOW - 8 * D, size: "6 rows" }],
  main: [{ name: "Welcome to 1Helm", kind: "doc", sid: 900, at: NOW - 3600e3, size: "1 page" }, { name: "Weekly 1:1 · meeting notes", kind: "doc", sid: 900, at: NOW - 2 * D, size: "2 pages", tags: ["meeting"] }],
};
if (!LIVE) for (const [k, v] of Object.entries(EXTRA)) (LIB[k] ??= []).push(...v);
type LF = Art & { ch: Channel };
const allFiles = (): LF[] => channels.flatMap(c => lib(c).map(a => ({ ...a, ch: c }))).sort((a, b) => b.at - a.at);
// [key, label, kinds it shows (null = any), tag it shows (files tagged in the Library API's tags[], e.g. meeting notes)]
const TYPES: [string, string, Art["kind"][] | null, string?][] = [["all", "All", null], ["doc", "Documents", ["doc"]], ["sheet", "Spreadsheets", ["sheet"]], ["pdf", "PDFs", ["pdf"]], ["image", "Images", ["image"]], ["link", "Links & code", ["link", "code"]], ["meeting", "Meetings", null, "meeting"], ["zone", "The Zone", null]];
// The Zone can change a deck, a web page and a .docx; a PDF report and the other word formats only open there to read, so "The Zone" leaves them out.
const ZSECS: [string, string][] = [["deck", "Presentations"], ["doc", "Documents"], ["page", "Websites"]];
const zoneSec = (f: Art) => { const k = zoneKind(f); return k === "deck" || k === "page" || (k === "doc" && docEditable(f.name)) ? k : null; };
const L = { q: "", type: "all", coll: "all", view: "list" as "list" | "grid", scope: "ch" as "ch" | "all" };
function libFiltered() {
  const ql = L.q.trim().toLowerCase(), [, , ks, tag] = TYPES.find(t => t[0] === L.type)!;
  const here = route().ch;
  return allFiles().filter(f => (L.type !== "zone" || !!zoneSec(f)) && (L.scope === "ch" ? f.ch === here : L.coll === "all" || (L.coll === "recent" ? NOW - f.at < 3 * D || f.fresh : f.ch.slug === L.coll))
    && (!ks || ks.includes(f.kind)) && (!tag || !!f.tags?.includes(tag)) && (!ql || f.name.toLowerCase().includes(ql) || f.ch.name.toLowerCase().includes(ql) || (f.ch.sessions.find(x => x.id === f.sid)?.title.toLowerCase().includes(ql) ?? false)));
}
function fileDate(t: number) { return NOW - t < 6 * D || t > NOW ? ago(t) : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function libFilesHtml() {
  const ups = LIVE && L.type !== "zone" ? (L.scope === "ch" ? lupHere(route().ch.slug) : LUP.filter(u => !u.f)) : [];
  if (ups.length && !L.q) { const rest = libFilesInner(); return `<div class="lrows lups${L.scope === "ch" ? " one" : ""}">${ups.map(lupRow).join("")}</div>${/class="lempty"/.test(rest) ? "" : rest}`; }
  return libFilesInner();
}
function libFilesInner() {
  const list = libFiltered(), one = L.scope === "ch", here = route().ch;
  if (!list.length) return `<div class="lempty">${L.q ? `Nothing matches “${esc(L.q)}”.` : L.type === "meeting" ? "No meeting notes yet." : L.type === "zone" ? "Nothing to open in the Zone yet." : one ? `Files ${esc(who(here))} makes for you, and files you add, show up here.${LIVE ? ` <button class="linkb" data-addfile>Add a file</button>` : ""}` : `No files here yet.`}</div>`;
  const src = (f: LF) => f.ch.sessions.find(x => String(x.id) === String(f.sid));
  const zl = L.type === "zone", open = (f: LF) => zl ? ` href="${f.sid != null ? `#/${f.ch.slug}/s/${esc(String(f.sid))}` : "#"}" data-zl="${esc(f.ch.slug)}|${esc(f.fid || "")}|${esc(String(f.sid ?? ""))}"` : ` href="${artHref(f.ch, f)}"${f.fid ? ` data-fv="${esc(f.ch.slug)}|${esc(f.fid)}" data-fvl` : ""}`;
  const card = (f: LF) => { const [k, d] = KIND[f.kind];
    return `<a class="art"${open(f)}><span class="aico k-${f.kind}">${I(d, 20)}</span><span class="an">${esc(f.name)}</span>
      <span class="am">${one ? `${k} · ${esc(f.size)} · ${fileDate(f.at)}` : `${av(f.ch, "av xs")}${esc(f.ch.name)} · ${fileDate(f.at)}`}${LIVE ? shBadge(f.ch.slug, f.fid, f.name) : ""}</span></a>`; };
  const row = (f: LF) => { const [k, d] = KIND[f.kind], x = src(f), you = f.you ?? f.size === "You added";
    return `<a class="lrow${f.fresh ? " fresh" : ""}"${open(f)}><span class="aico k-${f.kind}">${I(d, 18)}</span>
      <span class="lmain"><span class="ln">${esc(f.name)}</span><span class="lsub">${LIVE ? shBadge(f.ch.slug, f.fid, f.name).trimStart() : ""}${you ? "You added it" : `${esc(who(f.ch))} made it`}${x ? ` in “${esc(x.title)}”` : ""}${f.fid ? ` · ${esc(f.size)}` : ""}</span></span>${f.fid ? `<button class="ldel" data-fdel="${esc(f.ch.slug)}|${esc(f.fid)}" title="Delete" aria-label="Delete ${esc(f.name)}">${ic.trash}</button>` : ""}
      <span class="ltype">${k}</span>${one ? "" : `<span class="lch">${av(f.ch, "av xs")}<span>${esc(f.ch.name)}</span></span>`}<span class="ldate">${fileDate(f.at)}</span></a>`; };
  const body = (l: LF[]) => L.view === "grid" ? `<div class="arts lgrid">${l.map(card).join("")}</div>` : `<div class="lrows${one ? " one" : ""}">${l.map(row).join("")}</div>`;
  if (zl) return ZSECS.map(([k, n]) => [n, list.filter(f => zoneSec(f) === k)] as const).filter(([, l]) => l.length).map(([n, l]) => `<h3 class="lzh">${n}</h3>${body(l)}`).join("");
  return body(list);
}
function collHtml() {
  const all = allFiles(), recent = all.filter(f => NOW - f.at < 3 * D || f.fresh).length;
  const card = (key: string, icon: string, name: string, n: number) => `<button class="coll${L.coll === key ? " on" : ""}" data-coll="${key}"><span class="cico">${icon}</span><span class="cmeta"><b>${esc(name)}</b><span>${n} ${n === 1 ? "file" : "files"}</span></span></button>`;
  return card("all", ic.lib, "Everything", all.length) + card("recent", ic.clock, "Recent", recent)
    + channels.filter(c => lib(c).length).map(c => card(c.slug, av(c, "av cav"), c.name, lib(c).length)).join("");
}
function libBody() {
  const ch = route().ch, one = L.scope === "ch";
  const bee = beeLibParts(!!LIVE && one && ch.slug === "main", L.type);   // General's own Library only; nothing at all unless it has a stored Bee conversation
  if (bee.reset) L.type = "all";
  if (bee.view) return bee.view;
  return `${one ? "" : `<div class="lsec"><h2>Folders</h2><p>One folder for each channel. Everything ${esc(who(main))} makes, and everything you add.</p></div>
    <div class="colls" id="colls">${collHtml()}</div>`}
    ${bee.only ? "" : `<div class="lbar${one ? " first" : ""}"><h2>${one ? `${lib(ch).length} ${lib(ch).length === 1 ? "file" : "files"}` : L.coll === "all" ? "All files" : L.coll === "recent" ? "Recent" : esc(channels.find(c => c.slug === L.coll)?.name ?? "")}</h2>
      <div class="vt"><button class="${L.view === "list" ? "on" : ""}" data-view="list" aria-label="List">${ic.list}</button><button class="${L.view === "grid" ? "on" : ""}" data-view="grid" aria-label="Grid">${ic.grid}</button></div></div>`}
    <div class="chips${bee.only ? " beelib-first" : ""}">${TYPES.filter(t => LIVE || t[0] !== "zone").map(([k, n]) => `<button class="fchip${L.type === k ? " on" : ""}" data-type="${k}">${n}</button>`).join("")}${bee.chip}</div>
    ${bee.only ? "" : `${LIVE ? shLibHtml(one ? ch.slug : null) : ""}<div id="lfiles">${libFilesHtml()}</div>`}${bee.section}`;
}
function libHead(ch: Channel) {
  const one = L.scope === "ch";
  return `<div class="lhead">${one ? av(ch, "av lh") : `<span class="lh-all">${ic.lib}</span>`}<div class="lht"><h1>${one ? `${esc(ch.name)} Library` : "All Libraries"}</h1>
      <p>${one ? `Everything ${esc(who(ch))} has made for you, and anything you've added.` : "Every file from every channel, in one place."}</p></div>
    <div class="scope" role="tablist"><button class="${one ? "on" : ""}" data-scope="ch" role="tab">${esc(ch.name)}</button><button class="${one ? "" : "on"}" data-scope="all" role="tab">All channels</button></div></div>
    <div class="ltop"><label class="lsearch">${ic.search}<input id="lq" placeholder="${one ? `Search ${esc(ch.name)} files` : "Search all files"}" value="${esc(L.q)}" autocomplete="off"></label>
      <button class="lnew" title="Add a file${LIVE ? "" : " (sandbox)"}"${LIVE ? " data-addfile" : ""}>${ic.up2}<span>Add file</span></button></div>`;
}
function libPage(ch: Channel) {
  return `<div class="dhome" id="scroll"><div class="lwrap"><div id="lhd">${libHead(ch)}</div>
    <div id="lbody">${libBody()}</div></div></div>`;
}
function libUpdate(head = false) { const b = document.getElementById("lbody"); if (b) { b.innerHTML = libBody(); if (phone()) document.querySelector(".chips .fchip.on")?.scrollIntoView({ block: "nearest", inline: "nearest" }); } const h = document.getElementById("lhd"); if (head && h) h.innerHTML = libHead(route().ch); }
function openLib(ch: Channel, coll?: string) { beeLibReset(); L.scope = "ch"; L.coll = coll ?? "all"; L.type = "all"; L.q = ""; const h = `#/${ch.slug}/library`; if (location.hash === h) render(); else location.hash = h; }

// ---------- Files: attach in chat (button, drag and drop, paste) and Library "Add file". Uploads start at once; chips show progress. ----------
// lib: picked from the channel's Library (+ → Library picker). Already a Library file, so removing the chip never deletes it.
type Up = { k: number; name: string; bytes: number; ch: string; pct: number; f?: FileV; err?: string; xhr?: XMLHttpRequest; thumb?: string; gone?: boolean; lib?: boolean };
const UP: Record<string, Up[]> = { box: [], nbox: [] }; let upN = 0;
// Library uploads ("Add file" / drop on Library): shown as rows in the Library and in a small tray that stays put while you move around.
const LUP: Up[] = []; let trayT = 0;
const lupBusy = () => LUP.filter(u => !u.f && !u.err), lupHere = (slug: string) => LUP.filter(u => u.ch === slug && !u.f);
function lupRow(u: Up) {
  return `<div class="lrow lup${u.err ? " bad" : ""}" id="lup-${u.k}" aria-busy="${!u.err}"><span class="aico k-${fkind(u.name)}">${u.thumb ? `<img src="${u.thumb}" alt="">` : I(KIND[fkind(u.name)][1], 18)}</span>
    <span class="lmain"><span class="ln">${esc(u.name)}</span><span class="lsub">${u.err ? esc(u.err) : `<span class="lupt">${u.pct >= 99 ? "Finishing…" : `Uploading · ${u.pct}%`}</span>`}</span>${u.err ? "" : `<span class="lupbar"><i style="width:${u.pct}%"></i></span>`}</span>
    <button class="ldel lupx" data-lupx="${u.k}" aria-label="${u.err ? "Dismiss" : "Cancel upload"}" title="${u.err ? "Dismiss" : "Cancel"}">${I('<path d="M18 6 6 18M6 6l12 12"/>', 14)}</button></div>`;
}
function trayPaint() {
  let el = document.getElementById("uptray");
  const busy = lupBusy(), bad = LUP.filter(u => u.err), done = LUP.filter(u => u.f);
  if (!LUP.length) { el?.classList.remove("on"); return; }
  if (!el) { el = document.createElement("div"); el.id = "uptray"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
  const tot = LUP.reduce((a, u) => a + (u.bytes || 1), 0), got = LUP.reduce((a, u) => a + (u.bytes || 1) * (u.f ? 1 : u.err ? 1 : u.pct / 100), 0), pct = Math.round(got / tot * 100);
  const label = busy.length ? `Uploading ${busy.length === 1 ? busy[0].name : `${busy.length} files`}` : bad.length ? `${bad.length === 1 ? `Couldn't add ${bad[0].name}` : `${bad.length} files didn't upload`}` : `Added ${done.length === 1 ? done[0].name : `${done.length} files`}`;
  const ch = channels.find(c => c.slug === LUP[LUP.length - 1].ch);
  el.className = `on${busy.length ? " busy" : bad.length ? " bad" : " ok"}`;
  el.innerHTML = `<span class="utico">${busy.length ? `<svg viewBox="0 0 20 20" class="utring"><circle cx="10" cy="10" r="8"/><circle cx="10" cy="10" r="8" style="stroke-dashoffset:${50.3 - 50.3 * pct / 100}"/></svg>` : bad.length ? I('<path d="M12 8v5"/><path d="M12 16.5v.01"/><circle cx="12" cy="12" r="9"/>', 16) : ic.check}</span>
    <span class="utm"><b>${esc(label)}</b><span>${busy.length ? `${pct}%${done.length ? ` · ${done.length} done` : ""}` : bad.length ? esc(bad[0].err || "") : ch && !isLib() ? `<a href="#/${ch.slug}/library">Open ${esc(ch.name)} Library</a>` : `${esc(who(ch || route().ch))} can use ${done.length === 1 ? "it" : "them"} now`}</span></span>
    ${busy.length ? "" : `<button class="utx" data-utx aria-label="Dismiss">${I('<path d="M18 6 6 18M6 6l12 12"/>', 14)}</button>`}${busy.length ? `<i class="utbar" style="width:${pct}%"></i>` : ""}`;
  clearTimeout(trayT);
  if (!busy.length && !bad.length) trayT = window.setTimeout(() => { LUP.length = 0; trayPaint(); }, 4000);
}
// Update one Library upload in place (rows + tray), without redrawing the page.
function lupPaint(u: Up) {
  const r = document.getElementById(`lup-${u.k}`);
  if (r && !u.err) { const t = r.querySelector(".lupt"); if (t) t.textContent = u.pct >= 99 ? "Finishing…" : `Uploading · ${u.pct}%`; const b = r.querySelector<HTMLElement>(".lupbar i"); if (b) b.style.width = `${u.pct}%`; }
  else if (r) r.outerHTML = lupRow(u);
  trayPaint();
}
const MAXUP = 50 * 1024 * 1024;
const upsHtml = (key: string) => (UP[key] || []).map(u => `<span class="uchip${u.err ? " bad" : u.f ? "" : " busy"}" title="${esc(u.err || u.name)}">${u.thumb ? `<img src="${u.thumb}" alt="">` : `<span class="aico k-${fkind(u.name)}">${I(KIND[fkind(u.name)][1], 15)}</span>`}
  <span class="ucn"><b>${esc(u.name)}</b><span>${u.err ? esc(u.err) : u.f ? KB(u.bytes) : `Uploading ${u.pct}%`}</span></span><button type="button" class="ucx" data-uprm="${key}|${u.k}" aria-label="Remove ${esc(u.name)}">${I('<path d="M18 6 6 18M6 6l12 12"/>', 13)}</button>${u.f || u.err ? "" : `<i style="width:${u.pct}%"></i>`}</span>`).join("");
function upPaint(key: string) {
  const el = document.getElementById(`ups-${key}`); if (el) el.innerHTML = upsHtml(key);
  const has = (UP[key] || []).some(u => u.f) || !!(document.getElementById(key) as HTMLTextAreaElement | null)?.value.trim();
  if (key === "box") { const g = document.getElementById("go") as HTMLButtonElement | null; if (g) g.disabled = !has; document.getElementById("send")?.classList.toggle("has", has); }
  else { const g = document.getElementById("ngo") as HTMLButtonElement | null; if (g) g.disabled = !has; }
}
const upBusy = (key: string) => (UP[key] || []).some(u => !u.f && !u.err);
// Sending is what puts chat attachments in the Library; until then they're drafts the server keeps out of it.
function upTake(key: string, ch: Channel) {
  const out = (UP[key] || []).filter(u => u.f && u.ch === ch.slug).map(u => u.f!); UP[key] = []; upPaint(key);
  for (const f of out) if (!(LIB[ch.slug] ||= []).some(a => a.fid === f.id)) LIB[ch.slug].unshift({ ...toArt(f), fresh: true });
  return out;
}
// Removing a chip deletes the draft upload (or cancels it mid-way), so it never reaches the Library.
function upDrop(key: string, k: number) {
  const u = UP[key].find(x => x.k === k); UP[key] = UP[key].filter(x => x.k !== k); upPaint(key); if (!u) return;
  u.gone = true; if (!u.f && !u.err) u.xhr?.abort();
  if (u.f && !u.lib) api(`/res/${u.ch}/files/${u.f.id}/delete`, {}).catch(() => {});
}
// The model gets a small JPEG of each picture (any format the browser can open, iPhone HEIC included); the original stays as uploaded.
async function smallJpeg(file: Blob, max = 1568): Promise<Blob | null> {
  try { const bmp = await createImageBitmap(file); const r = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
    c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r); c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(z => c.toBlob(b => z(b), "image/jpeg", 0.85)); } catch { return null; }
}
function sendFile(slug: string, file: Blob, name: string, onPct: (p: number) => void, x = new XMLHttpRequest(), draft = false): Promise<any> {
  return new Promise((ok, no) => {
    x.open("POST", `${LIVE!.api}/res/${slug}/files`); x.withCredentials = true; x.setRequestHeader("x-file-name", encodeURIComponent(name)); if (draft) x.setRequestHeader("x-draft", "1");
    if (file.type) x.setRequestHeader("content-type", file.type);
    x.upload.onprogress = e => { if (e.lengthComputable) onPct(Math.min(99, Math.round(e.loaded / e.total * 100))); };
    x.onload = () => { let d: any = {}; try { d = JSON.parse(x.responseText); } catch {} if (x.status === 507 || d.storage_full) storFull(d.error);   // storage.ts: full → banner with Add storage
      x.status < 300 && d.id ? ok(d) : no(new Error(d.error === "payment_required" ? d.message || "Your plan needs attention" : d.storage_full ? "Not saved: your storage is full." : d.error || `Upload failed (${x.status})`)); };
    x.onerror = () => no(new Error("Upload failed. Check your connection.")); x.onabort = () => no(new Error("Removed"));
    x.send(file);
  });
}
async function upload(key: string | null, slug: string, list: File[]) {
  const ch = channels.find(c => c.slug === slug); if (!ch || !list.length) return;
  const done: FileV[] = [];
  await Promise.all(list.slice(0, 10).map(async file => {
    const u: Up = { k: ++upN, name: file.name || `Pasted ${fkind("", file.type) === "image" ? "image" : "file"}.${(file.type.split("/")[1] || "bin").replace("jpeg", "jpg")}`, bytes: file.size, ch: slug, pct: 0, xhr: new XMLHttpRequest() };
    if (/^image\//.test(file.type) && file.size < 30e6) u.thumb = URL.createObjectURL(file);
    if (key) { UP[key].push(u); upPaint(key); } else { LUP.push(u); refresh(); trayPaint(); }
    if (file.size > MAXUP) { u.err = `Too big (${KB(file.size)}). The limit is 50 MB.`; if (key) upPaint(key); else lupPaint(u); return; }
    try {
      const f: FileV = await sendFile(slug, file, u.name, p => { u.pct = p; if (key) upPaint(key); else lupPaint(u); }, u.xhr, !!key);
      if (u.gone) { api(`/res/${slug}/files/${f.id}/delete`, {}).catch(() => {}); return; }   // removed while the server was finishing
      if (f.image) { const j = await smallJpeg(file); if (j) await fetch(`${fileUrl(slug, f.id)}/view`, { method: "POST", credentials: "same-origin", headers: { "content-type": "image/jpeg" }, body: j }).catch(() => {}); }
      if (u.gone) { api(`/res/${slug}/files/${f.id}/delete`, {}).catch(() => {}); return; }
      u.f = f; u.pct = 100; done.push(f); if (!key) (LIB[slug] ??= []).unshift({ ...toArt(f), fresh: true });
    } catch (e: any) { if (u.gone) return; u.err = e.message; }
    if (key) upPaint(key); else { refresh(); trayPaint(); }   // each file swaps from its upload row to the real row as soon as it's in
  }));
  refresh();
}
function pickFiles(on: (l: File[]) => void, accept = "") {
  const i = document.createElement("input"); i.type = "file"; if (accept) i.accept = accept; else i.multiple = true; i.style.display = "none";
  i.onchange = () => { on([...(i.files || [])]); i.remove(); }; document.body.appendChild(i); i.click();
}
const upKey = () => NT.open ? "nbox" : "box", upSlug = (key: string) => key === "nbox" ? (NT.to || route().ch.slug) : route().ch.slug;
// ---------- + in the composer: the channel's Library first (pick files already there), then "Upload from device" ----------
// Desktop: a popover anchored to the +. Phone: a bottom sheet. Picked files become the same chips as uploads; the message
// sends their ids exactly like uploaded ones. Drag-and-drop and paste still upload straight away.
const PK = { open: false, key: "box", slug: "", q: "", sel: [] as string[], btn: null as HTMLElement | null };
const pkFiles = () => { const ch = channels.find(c => c.slug === PK.slug); return ch ? lib(ch).filter(a => a.fid) : []; };
const pkThumb = (a: Art, px: number) => a.kind === "image" && a.fid ? `<img src="${fileUrl(PK.slug, a.fid)}" alt="" loading="lazy" onerror="this.remove()">` : I(KIND[a.kind][1], px);
function pkList() {
  const all = pkFiles(), ql = PK.q.trim().toLowerCase(), list = ql ? all.filter(a => a.name.toLowerCase().includes(ql) || KIND[a.kind][0].toLowerCase().includes(ql)) : all;
  if (!all.length) return `<div class="pkempty"><span class="pkeico">${ic.lib}</span><b>Nothing in the Library yet</b><span>Upload a file and it's kept here for next time.</span></div>`;
  if (!list.length) return `<div class="pkempty"><span>Nothing matches “${esc(PK.q)}”.</span></div>`;
  return list.map(a => { const on = PK.sel.includes(a.fid!);
    return `<button type="button" class="pkrow${on ? " on" : ""}" data-pksel="${esc(a.fid!)}" aria-pressed="${on}"><span class="aico k-${a.kind}">${pkThumb(a, 18)}</span>
      <span class="lmain"><span class="ln">${esc(a.name)}</span><span class="lsub">${KIND[a.kind][0]} · ${esc(a.size)} · ${fileDate(a.at)}</span></span>
      <span class="pkchk" aria-hidden="true">${ic.check}</span></button>`; }).join("");
}
function pkFoot() {
  const n = PK.sel.length, had = UP[PK.key].filter(u => u.lib).length, empty = !pkFiles().length;
  return `<button type="button" class="pkup" data-pkup>${ic.up2}<span>Upload from device</span></button>${empty ? "" : `<span class="grow"></span>
    <button type="button" class="pkgo" data-pkgo${!n && !had ? " disabled" : ""}>${n ? (n === 1 ? "Attach 1 file" : `Attach ${n} files`) : had ? "Done" : "Attach"}</button>`}`;
}
function pkPaint(list = true) {
  const w = document.getElementById("pkw"); if (!w || !PK.open) return;
  if (list) w.querySelector(".pklist")!.innerHTML = pkList();
  w.querySelector(".pkfoot")!.innerHTML = pkFoot();
}
function pkPlace() {
  const el = document.querySelector<HTMLElement>("#pkw .pkpop"), b = PK.btn; if (!el || !b || phone()) { el?.removeAttribute("style"); return; }
  const r = b.getBoundingClientRect(), W = Math.min(420, innerWidth - 24), above = r.top > innerHeight - r.bottom;
  el.style.width = `${W}px`; el.style.left = `${Math.max(12, Math.min(r.left - 6, innerWidth - W - 12))}px`;
  if (above) { el.style.bottom = `${innerHeight - r.top + 8}px`; el.style.top = ""; el.style.maxHeight = `${Math.min(520, r.top - 20)}px`; el.classList.remove("down"); }
  else { el.style.top = `${r.bottom + 8}px`; el.style.bottom = ""; el.style.maxHeight = `${Math.min(520, innerHeight - r.bottom - 20)}px`; el.classList.add("down"); }
}
function pkOpen(key: string, btn: HTMLElement) {
  const slug = upSlug(key), ch = channels.find(c => c.slug === slug); if (!ch) return;
  Object.assign(PK, { open: true, key, slug, q: "", btn, sel: UP[key].filter(u => u.lib && u.f && u.ch === slug).map(u => u.f!.id) });
  let w = document.getElementById("pkw"); if (!w) { w = document.createElement("div"); w.id = "pkw"; document.body.appendChild(w); }
  const many = pkFiles().length > 8;
  w.innerHTML = `<div class="pkback" data-pkclose></div><div class="pkpop" role="dialog" aria-modal="true" aria-labelledby="pktitle">${phone() ? `<i class="grab"></i>` : ""}
    <div class="pkhead">${av(ch, "av sm")}<h2 id="pktitle">${esc(ch.name)} Library</h2><button type="button" class="pkx" data-pkclose aria-label="Close">${I('<path d="M18 6 6 18M6 6l12 12"/>', 16)}</button></div>
    ${many ? `<label class="pksearch">${ic.search}<input id="pkq" type="search" placeholder="Search ${esc(ch.name)} files" autocomplete="off" enterkeyhint="search" aria-label="Search files"></label>` : ""}
    <div class="pklist" role="group" aria-label="Library files"></div><div class="pkfoot"></div></div>`;
  pkPaint(); pkPlace(); btn.setAttribute("aria-expanded", "true");
  if (phone()) dragToClose(w.querySelector<HTMLElement>(".pkpop")!, pkClose);
  requestAnimationFrame(() => requestAnimationFrame(() => w!.classList.add("on")));
  const first = w.querySelector<HTMLElement>(many && !phone() ? "#pkq" : ".pkrow, .pkup"); first?.focus({ preventScroll: true });
  // Quietly refresh the list (another device may have added files since boot).
  api(`/res/${slug}/files`).then((d: any) => { if (Array.isArray(d?.files) && setFiles(ch, d.files) && PK.open && PK.slug === slug) pkPaint(); }).catch(() => {});
}
function pkClose(focus = true) {
  const w = document.getElementById("pkw"); if (!PK.open) return; PK.open = false; PK.btn?.setAttribute("aria-expanded", "false");
  if (focus && !phone()) (PK.btn?.isConnected ? PK.btn : document.getElementById(PK.key))?.focus({ preventScroll: true });
  if (!w) return; w.classList.remove("on"); setTimeout(() => { if (!PK.open) w.innerHTML = ""; }, 260);
}
// The composer's Library chips become exactly the picked files: new ones are added, unpicked ones removed (never deleted).
function pkApply() {
  const key = PK.key, slug = PK.slug, ch = channels.find(c => c.slug === slug); if (!ch) return;
  UP[key] = UP[key].filter(u => !u.lib || (u.ch === slug && PK.sel.includes(u.f!.id)));
  for (const id of PK.sel) { if (UP[key].some(u => u.lib && u.f!.id === id)) continue;
    const a = lib(ch).find(x => x.fid === id); if (!a) continue;
    const f: FileV = { id, name: a.name, mime: a.mime || "", bytes: a.bytes || 0, at: a.at, image: a.kind === "image" };
    UP[key].push({ k: ++upN, name: a.name, bytes: f.bytes, ch: slug, pct: 100, f, lib: true, thumb: a.kind === "image" ? fileUrl(slug, id) : undefined }); }
  upPaint(key);
}
if (LIVE) {
  document.addEventListener("click", e => {
    if (!PK.open) return; const t = e.target as HTMLElement;
    if (t.closest("[data-pkclose]")) { e.preventDefault(); pkClose(); return; }
    const r = t.closest<HTMLElement>("[data-pksel]"); if (r) { e.preventDefault(); const id = r.dataset.pksel!, i = PK.sel.indexOf(id); if (i >= 0) PK.sel.splice(i, 1); else PK.sel.push(id);
      r.classList.toggle("on", i < 0); r.setAttribute("aria-pressed", String(i < 0)); pkPaint(false); return; }
    if (t.closest("[data-pkgo]")) { e.preventDefault(); pkApply(); pkClose(); return; }
    // Same as the old +: the device's file picker, uploads start at once. Picks made so far are kept.
    if (t.closest("[data-pkup]")) { e.preventDefault(); const key = PK.key, slug = PK.slug; pkApply(); pkClose(false); pickFiles(l => upload(key, slug, l)); return; }
  }, true);
  document.addEventListener("focusout", e => { const t = e.target as HTMLInputElement; if (t.id === "q" && !t.value) setTimeout(() => { const q = document.getElementById("q"); if (document.activeElement !== q) document.getElementById("side")?.classList.remove("sopen"); }, 150); });
document.addEventListener("input", e => { const t = e.target as HTMLInputElement; if (t.id === "pkq" && PK.open) { PK.q = t.value; pkPaint(); } });
  window.addEventListener("keydown", e => {
    if (!PK.open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); const q = document.getElementById("pkq") as HTMLInputElement | null; if (q && q.value && document.activeElement === q) { q.value = ""; PK.q = ""; pkPaint(); } else pkClose(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {   // move through the files (from the search box too)
      const rows = [...document.querySelectorAll<HTMLElement>("#pkw .pkrow")], i = rows.indexOf(document.activeElement as HTMLElement); if (!rows.length) return;
      if (i < 0 && e.key === "ArrowUp") return; e.preventDefault();
      (e.key === "ArrowDown" ? rows[Math.min(rows.length - 1, i + 1)] : i === 0 ? document.getElementById("pkq") ?? rows[0] : rows[i - 1]).focus(); return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (PK.sel.length || UP[PK.key].some(u => u.lib)) { pkApply(); pkClose(); } return; }
    if (e.key === "Tab") {   // keep focus inside the picker
      const f = [...document.querySelectorAll<HTMLElement>("#pkw .pkpop button:not([disabled]), #pkw .pkpop input")]; if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }, true);
  window.addEventListener("resize", () => { if (PK.open) pkPlace(); });
  window.addEventListener("hashchange", () => pkClose(false));
}
// An agent suggestion the person ignored (still waiting, and they have since sent another message) folds into the same "Skipped" row
// as an unanswered reply card. Pending approvals, interviews, plans and live notes never fold; used cards keep their own look.
function foldTitle(c: any): string {
  if (c.t === "offer") return offerFold(c);
  if (c.t === "share") return shFold(c);
  if (c.t === "contact") return CX_DONE[c.k] ? "" : `Add ${c.c.name} to your contacts?`;
  return "";
}
// The files and pictures the helper already shared in a turn that is still running, from an attach snapshot or the open task's live part
// ({ shared, images }). A watcher that attaches after share_file ran never saw its "file" event, so these draw the same cards the reload does.
function liveOutputs(ch: Channel, reply: Msg, d: any) {
  for (const x of d?.images || []) { const cs = (reply.cards ??= []); if (!cs.some((c: any) => c.t === "image" && c.id === x.id)) cs.push({ t: "image", id: x.id, url: x.url, caption: x.caption }); }
  for (const f of d?.shared || []) {
    const cs = (reply.cards ??= []), i = cs.findIndex((c: any) => c.t === "file" && c.f?.id === f.id); if (i >= 0) cs[i] = { t: "file", f }; else cs.push({ t: "file", f });
    LIB[ch.slug] = [{ ...toArt(f), fresh: true }, ...(LIB[ch.slug] || []).filter((a) => a.fid !== f.id)];
  }
}
// One "Open in editor" card under an agent reply that shares files the Zone can open (zoneKind decides). It opens the first such file; with
// several, a file-name chooser on the card picks another. The choice is kept per reply (keyed by its first Zone file) so a repaint keeps it.
const OED: Record<string, string> = {};
function oedCard(cards: any[], ch: Channel) {
  if (!LIVE) return "";
  const fs: FileV[] = []; for (const c of cards) if (c.t === "file" && c.f?.id && zoneKind(c.f) && !fs.some(x => x.id === c.f.id)) fs.push(c.f);
  if (!fs.length) return "";
  const key = ch.slug + "|" + fs[0].id, cur = fs.find(x => x.id === OED[key]) || fs[0];
  const who = fs.length > 1 ? `<select class="oed-pick" data-oed="${esc(key)}" aria-label="File to open in the editor">${fs.map(x => `<option value="${esc(x.id)}"${x.id === cur.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : `<span class="oed-name">${esc(cur.name)}</span>`;
  return `<div class="oed" data-oedc="${esc(key)}"><button type="button" class="oed-open" data-zone="${esc(ch.slug)}|${esc(cur.id)}" aria-label="Open ${esc(cur.name)} in the editor">${I('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><rect x="9" y="9" width="6" height="6" rx="1"/>', 16)}<span>Open in editor</span></button>${who}</div>`;
}
if (LIVE) document.addEventListener("change", e => { const t = e.target as HTMLSelectElement; if (!t?.matches?.("select[data-oed]")) return; OED[t.dataset.oed!] = t.value; const b = t.closest(".oed")?.querySelector<HTMLElement>("[data-zone]"); if (b) { b.dataset.zone = t.dataset.oed!.split("|")[0] + "|" + t.value; b.setAttribute("aria-label", `Open ${t.selectedOptions[0]?.text || "the file"} in the editor`); } });
function chatCards(cards: any[], ch: Channel, reply?: string, all: any[] = cards) {
  let html = "", group = false;
  for (const c of cards) { const tile = c.t === "file" || c.t === "image";
    if (tile && !group) html += '<div class="chat-file-grid">';
    if (!tile && group) html += '</div>';
    const ft = foldTitle(c);
    html += ft ? foldHtml(`card:${ch.slug}:${c.t}:${c.o?.id ?? c.id ?? c.k}`, ft, cardHtml(c, ch), reply !== undefined) : cardHtml(c, ch); group = tile;
  }
  return html + (group ? '</div>' : '') + oedCard(all, ch);
}
// The message's cards without the file tiles its own File cards already show.
function claimedOut(m: Msg, text: string) { const { ids } = claimFiles(m, text); return ids.size ? (m.cards || []).filter(c => !(c.t === "file" && ids.has(c.f?.id))) : m.cards || []; }
// Open in the Zone (zone.ts): a deck, a web page or a PDF beside its task. The Zone's own code is fetched the first time this is used.
const zoBtn = (slug: string, f: FileV) => LIVE && zoneKind(f) ? `<span class="fsh zob" role="button" tabindex="0" data-zone="${esc(slug)}|${esc(f.id)}" aria-label="Open ${esc(f.name)} in the zone" title="Open in zone">${I('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><rect x="9" y="9" width="6" height="6" rx="1"/>', 16)}</span>` : "";
type ZoneMod = typeof import("./zone");
let zoneMod: ZoneMod | null = null, zoneLoading: Promise<ZoneMod> | null = null;
const zoneLoad = () => zoneMod ? Promise.resolve(zoneMod) : zoneLoading ||= import(/* @vite-ignore */ new URL(`./zone/zone.js?v=${encodeURIComponent(String((LIVE as any)?.v || ""))}`, import.meta.url).href).then((m: ZoneMod) => (zoneMod = m)).finally(() => { zoneLoading = null; });
async function zoneStart(slug: string, id: string) {
  const ch = channels.find(c => c.slug === slug), { s } = route(); if (!LIVE || !ch || !s) return;
  let f: any = null; try { f = ((await api(`/res/${slug}/files`))?.files || []).find((x: any) => x.id === id); } catch {}
  if (!f || !zoneKind(f)) { note(ic.clock, "Can't open that here", "The Zone opens decks, web pages, Word documents and PDF reports.", ""); return; }
  const m = await zoneLoad().catch(() => null); if (!m) { note(ic.clock, "Couldn't open the zone", "Check your connection and try again.", ""); return; }
  closeFile(); mState.drawer = false;
  void m.zoneOpen({ api: LIVE.api, v: String((LIVE as any).v || ""), fileUrl, who: sl => who(channels.find(c => c.slug === sl) || ch), pinKey: rqKey, pin: (k, ref) => { if (!k) return; if (ref) rqPut(k, ref); else rqClear(k); },
    note: (t, b) => note(ic.clock, t, b, ""), leave: () => { m.zoneClose(); render(); },
    styleBtn: ff => dsIsDeck(ff) ? `<span class="zwide" role="button" tabindex="0" ${dsAttr(ff.slug, ff)}>${I('<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-4.9-4.5-9-10-9z"/>', 16)}<span>Change style</span></span>` : "", shareAttrs: ff => ` data-shn="${esc(ff.name)}" data-shm="${esc(ff.mime || "")}"`,
    helperWorking: () => !!route().s?.streaming }, { slug, id: f.id, name: f.name, mime: f.mime, tags: f.tags, session: f.session, version: f.version, bytes: f.bytes }, String(s.id));
}
// The Zone belongs to the task it was opened from: leaving that task closes it.
function zoneGuard() { if (!zoneMod?.zoneIsOpen()) return; const sid = zoneMod.zoneSession(), { s } = route(); if (!s || String(s.id) !== sid) zoneMod.zoneClose(); }
document.addEventListener("rq:clear", () => zoneMod?.zoneUnpinned());
// A file in the Library's "The Zone" list: go to the task it came from, then open it in the Zone beside that chat. A file with no task that still exists
// opens in the channel's newest task (the Zone needs a task to sit beside, and the file belongs to the channel); a channel with no tasks opens the file viewer.
async function zoneFromLib(slug: string, id: string, sid: string) {
  const ch = channels.find(c => c.slug === slug); if (!ch) return;
  const to = ch.sessions.find(x => String(x.id) === sid) ?? [...ch.sessions].filter(x => !x.tmp).sort((a, b) => b.updated - a.updated)[0];
  if (!to) { const x = (LIB[slug] || []).find(y => y.fid === id); if (x) openFile([fvOf(slug, x)], 0); return; }
  const h = `#/${slug}/s/${to.id}`; if (location.hash !== h) location.hash = h; else render();
  for (let i = 0; i < 100; i++) { const { ch: c, s } = route(); if (c.slug === slug && s === to && (!LIVE || s.loaded) && document.getElementById("box")) break; await new Promise(r => setTimeout(r, 50)); }
  await zoneStart(slug, id);
}
if (LIVE) { document.addEventListener("click", e => { const z = (e.target as HTMLElement).closest<HTMLElement>("[data-zl]"); if (z && !(e.target as HTMLElement).closest("[data-fdel]")) { e.preventDefault(); e.stopPropagation(); const [slug, id, sid] = z.dataset.zl!.split("|"); void zoneFromLib(slug, id, sid); return; }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-zone]"); if (!b) return; e.preventDefault(); e.stopPropagation(); const [slug, id] = b.dataset.zone!.split("|"); void zoneStart(slug, id); }, true);
  document.addEventListener("keydown", e => { const t = e.target as HTMLElement; if ((e.key === "Enter" || e.key === " ") && t?.matches?.("[data-zone]")) { e.preventDefault(); t.click(); } }); }
function fileCard(ch: Channel, f: FileV, mine: boolean) {
  const k = fkind(f.name, f.mime), u = fileUrl(ch.slug, f.id);
  return `<div class="fcard chat-tile${mine ? " mine" : ""}" title="${esc(f.name)} · ${KIND[k][0]} · ${KB(f.bytes)}"><a class="chat-tile-open" href="${u}" data-fv="${esc(ch.slug)}|${esc(f.id)}" data-fvc aria-label="Open ${esc(f.name)}"><span class="chat-tile-preview${f.image ? " photo" : ""}">${f.image ? `<img src="${u}" alt="" loading="lazy">` : `<span class="aico k-${k}">${I(KIND[k][1], 28)}</span>`}</span><span class="chat-tile-name">${esc(f.name)}</span></a><span class="chat-tile-actions"><span class="chat-tile-kind">${dsIsDeck(f) ? "Deck" : KIND[k][0]}</span>${LIVE ? shFileBtn(ch.slug, f.id, f.name, f.mime, true) : ""}${dsBtn(ch.slug, f)}${zoBtn(ch.slug, f)}<a class="chat-tile-download" href="${fileUrl(ch.slug, f.id, true)}" download aria-label="Download ${esc(f.name)}" title="Download">${I('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', 14)}</a></span></div>`;
}
if (LIVE) {
  document.addEventListener("click", async e => {
    const t = e.target as HTMLElement;
    const at = t.closest<HTMLElement>("[data-attach]"); if (at) { e.preventDefault(); const key = t.closest("#nt") ? "nbox" : "box"; PK.open && PK.key === key ? pkClose() : pkOpen(key, at); return; }
    if (t.closest("[data-addfile]")) { e.preventDefault(); pickFiles(l => upload(null, route().ch.slug, l)); return; }
    const lx = t.closest<HTMLElement>("[data-lupx]"); if (lx) { e.preventDefault(); const i = LUP.findIndex(u => u.k === +lx.dataset.lupx!); if (i >= 0) { const u = LUP[i]; u.gone = true; if (!u.f && !u.err) u.xhr?.abort(); LUP.splice(i, 1); refresh(); trayPaint(); } return; }
    if (t.closest("[data-utx]")) { e.preventDefault(); for (let i = LUP.length - 1; i >= 0; i--) if (LUP[i].f || LUP[i].err) LUP.splice(i, 1); trayPaint(); return; }
    const rm = t.closest<HTMLElement>("[data-uprm]"); if (rm) { e.preventDefault(); const [key, k] = rm.dataset.uprm!.split("|"); upDrop(key, +k); return; }
    if (t.closest("[data-fdl]")) return;   // a Download link is a plain <a href download>: the browser downloads it, so the app never navigates
    const del = t.closest<HTMLElement>("[data-fdel]"); if (del) {
      e.preventDefault(); e.stopPropagation(); const [slug, id] = del.dataset.fdel!.split("|"), a = (LIB[slug] || []).find(x => x.fid === id); if (!a) return;
      if (!(await ask({ title: `Delete “${a.name}”?`, body: `It's removed from the Library and from ${who(channels.find(c => c.slug === slug)!)}'s computer.`, confirm: "Delete", danger: true }))) return;
      // Gone from every list at once; the request runs in the background and the file comes back in its place if it fails.
      const was = LIB[slug] || [], at = was.findIndex(x => x.fid === id); FILE_DEL.add(id); LIB[slug] = was.filter(x => x.fid !== id); refresh();
      api(`/res/${slug}/files/${id}/delete`, {}).catch((x: any) => ({ error: x.message })).then((r: any) => {
        if (r?.error) { FILE_DEL.delete(id); const cur = LIB[slug] ||= []; if (!cur.some(x => x.fid === id)) cur.splice(Math.min(Math.max(at, 0), cur.length), 0, a); refresh(); note(ic.clock, "Couldn't delete it", r.error, ""); return; }
        shFileGone(id); note(ic.check, "Deleted", a.name, "");
      });
    }
  });
  // Drop files anywhere on a channel screen (chat, Home, Library); paste images or files into the message box.
  let dragN = 0; const dropOk = (e: DragEvent) => [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", e => { if (!dropOk(e)) return; dragN++; document.body.classList.add("dropping"); });
  window.addEventListener("dragleave", e => { if (!dropOk(e)) return; if (--dragN <= 0) { dragN = 0; document.body.classList.remove("dropping"); } });
  window.addEventListener("dragover", e => { if (dropOk(e)) e.preventDefault(); });
  window.addEventListener("drop", e => {
    if (!dropOk(e)) return; e.preventDefault(); dragN = 0; document.body.classList.remove("dropping");
    const l = [...(e.dataTransfer?.files || [])]; if (!l.length) return;
    if (isLib() && !NT.open) upload(null, route().ch.slug, l); else { const key = upKey(); upload(key, upSlug(key), l); }
  });
  // Leaving the page with unsent attachments: delete those drafts now (the server also sweeps any it misses after a day).
  // (No "Leave site?" warning while files upload: that's the browser's own pop-up, and 1Helm never shows one. The upload tray shows progress.)
  window.addEventListener("pagehide", () => { for (const key of Object.keys(UP)) for (const u of UP[key]) if (u.f && !u.lib) fetch(`${fileUrl(u.ch, u.f.id)}/delete`, { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {}); });
  document.addEventListener("paste", e => {
    const t = e.target as HTMLElement; if (t.id !== "box" && t.id !== "nbox") return;
    const l = [...(e.clipboardData?.files || [])]; if (!l.length) return; e.preventDefault(); upload(t.id, upSlug(t.id), l);
  });
}
// ---------- File viewer: Library and chat files open in place (like Claude/ChatGPT/Gemini), never a new tab ----------
// Images zoom, PDFs render page by page (pdf.js, loaded only when a PDF opens), text/Markdown/CSV/code show as text,
// audio/video play. Slide decks (.pptx…) and Word documents (.docx…) show the PDF the channel computer makes of them with
// LibreOffice (GET …/files/<id>/preview, 1HC file-preview.js; the first open makes it, later opens are instant): a deck pages
// slide by slide, a document scrolls like a PDF. Anything else gets a clean card with Download. ← → move through the list it was opened from.
type FV = { slug: string; id: string; name: string; mime: string; bytes: number; at: number; sid?: any; you?: boolean; transcript?: string; tx?: string; spk?: { slug: string; task: string; n?: number } };
const FVS: { list: FV[]; i: number; zoom: number; gen: number; pdf?: any; slide?: (d: number, abs?: boolean) => boolean; transcript?: string; data?: any; speakers?: Speaker[] } = { list: [], i: 0, zoom: 1, gen: 0 };
const fvExt = (n: string) => (n.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
const fvKind = (f: FV) => { const e = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase(), m = f.mime;
  if (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(m) || /^(png|jpe?g|gif|webp|avif|bmp)$/.test(e)) return "image";
  if (m === "application/pdf" || e === "pdf") return "pdf";
  if (/^(xlsx|xlsm|xlsb|xls|ods|numbers)$/.test(e) || /spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(m)) return "xlsx";
  if (/^(pptx|ppt|pps|ppsx|pptm|odp)$/.test(e)) return "deck";   // by extension only, like the server's previewKind
  if (/^(docx|doc|docm|odt|rtf)$/.test(e)) return "word";
  if (/^(html?|xhtml)$/.test(e) || m === "text/html") return "html";
  if (/^video\//.test(m)) return "video"; if (/^audio\//.test(m)) return "audio";
  if (e === "md" || e === "markdown" || m === "text/markdown") return "md";
  if (e === "csv" || e === "tsv" || m === "text/csv" || m === "text/tab-separated-values") return "csv";
  if (/^text\//.test(m) || /^(txt|json|js|ts|py|sh|css|html?|xml|svg|yaml|yml|toml|ini|log|sql|ics)$/.test(e) || m === "application/json") return "text";
  return "other"; };
const fvOf = (slug: string, a: Art): FV => ({ slug, id: a.fid!, name: a.name, mime: a.mime || "", bytes: a.bytes || 0, at: a.at, sid: a.sid, you: a.you, tx: a.tx });
const fvTask = (f: FV) => { const ch = channels.find(c => c.slug === f.slug); return ch?.sessions.find(x => x.id === f.sid); };
function csvTable(t: string, tab: boolean) {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false; const d = tab ? "\t" : ",";
  for (let i = 0; i < t.length && rows.length < 2001; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === d) { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [h, ...b] = rows; if (!h) return `<p class="fvnone">This file is empty.</p>`;
  return `<div class="fvtbl"><table><thead><tr>${h.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${b.slice(0, 2000).map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${rows.length > 2000 ? `<p class="fvmore">Showing the first 2,000 rows. Download it to see everything.</p>` : ""}`;
}
// Spreadsheets (xlsx/xls/ods/numbers): SheetJS, loaded only when one opens. Every sheet as a tab, values as Excel shows them
// (dates, currency, percents), Excel-style column letters and row numbers, merged cells kept. Read-only preview.
let XL: Promise<any> | null = null;
const loadXL = () => XL ??= new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = new URL("./sheetjs/xlsx.full.min.js", import.meta.url).href; sc.onload = () => ok((window as any).XLSX); sc.onerror = () => { XL = null; no(new Error("couldn't load the spreadsheet reader")); }; document.head.appendChild(sc); });
const colName = (n: number) => { let s = ""; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
function xlSheetHtml(X: any, ws: any) {
  if (!ws || !ws["!ref"]) return `<p class="fvnone">This sheet is empty.</p>`;
  const r = X.utils.decode_range(ws["!ref"]), R = Math.min(r.e.r, r.s.r + 1999), C = Math.min(r.e.c, r.s.c + 99);
  const skip = new Set<string>(), span: Record<string, string> = {};
  for (const m of ws["!merges"] || []) { if (m.s.r > R || m.s.c > C) continue; span[`${m.s.r},${m.s.c}`] = `${m.e.r > m.s.r ? ` rowspan="${Math.min(m.e.r, R) - m.s.r + 1}"` : ""}${m.e.c > m.s.c ? ` colspan="${Math.min(m.e.c, C) - m.s.c + 1}"` : ""}`;
    for (let y = m.s.r; y <= Math.min(m.e.r, R); y++) for (let x = m.s.c; x <= Math.min(m.e.c, C); x++) if (y !== m.s.r || x !== m.s.c) skip.add(`${y},${x}`); }
  let h = `<div class="fvtbl fvxl"><table><thead><tr><th class="xn"></th>`;
  for (let c = r.s.c; c <= C; c++) h += `<th class="xc">${colName(c)}</th>`;
  h += `</tr></thead><tbody>`;
  for (let y = r.s.r; y <= R; y++) { h += `<tr><th class="xn">${y + 1}</th>`;
    for (let c = r.s.c; c <= C; c++) { const k = `${y},${c}`; if (skip.has(k)) continue; const cell = ws[X.utils.encode_cell({ r: y, c })];
      const v = cell && cell.t !== "z" ? (cell.w ?? (cell.v == null ? "" : String(cell.v))) : "", num = cell && (cell.t === "n" || cell.t === "d");
      // A formula saved without its result (some apps don't store it) shows the formula itself, quietly, instead of a blank.
      h += !v && cell?.f ? `<td${span[k] || ""} class="xf">=${esc(cell.f)}</td>` : `<td${span[k] || ""}${num ? ' class="xr"' : ""}${cell?.f ? ` title="=${esc(cell.f)}"` : ""}>${esc(v)}</td>`; }
    h += `</tr>`; }
  h += `</tbody></table></div>`;
  if (r.e.r > R || r.e.c > C) h += `<p class="fvmore">Showing ${R - r.s.r + 1} rows × ${C - r.s.c + 1} columns of ${r.e.r - r.s.r + 1} × ${r.e.c - r.s.c + 1}. Download it to see everything.</p>`;
  return h;
}
async function fvSheet(u: string, body: HTMLElement, gen: number) {
  try {
    const [X, buf] = await Promise.all([loadXL(), fetch(u, { credentials: "same-origin" }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })]);
    if (gen !== FVS.gen) return;
    const wb = X.read(buf, { type: "array", cellDates: true, cellNF: true, sheetStubs: true, dense: false, sheetRows: 2001 });
    const names: string[] = wb.SheetNames.filter((n: string) => wb.Workbook?.Sheets?.find((s: any) => s.name === n)?.Hidden !== 1 && wb.Workbook?.Sheets?.find((s: any) => s.name === n)?.Hidden !== 2);
    if (!names.length) { body.innerHTML = `<p class="fvnone">This spreadsheet has no sheets to show.</p>`; return; }
    const show = (i: number) => {
      body.innerHTML = `${names.length > 1 ? `<div class="xtabs" role="tablist">${names.map((n, j) => `<button role="tab" class="${j === i ? "on" : ""}" aria-selected="${j === i}" data-xtab="${j}">${esc(n)}</button>`).join("")}</div>` : ""}${xlSheetHtml(X, wb.Sheets[names[i]])}`;
      body.querySelectorAll<HTMLElement>("[data-xtab]").forEach(b => b.onclick = e => { e.stopPropagation(); show(+b.dataset.xtab!); });
    };
    show(0);
  } catch (e: any) { if (gen === FVS.gen) body.innerHTML = `<div class="fvnonebox"><b>Couldn't show this spreadsheet</b><p>${esc(String(e?.message || e).slice(0, 160))}</p><a class="fvdl" href="${u}?dl=1" download>Download</a></div>`; }
}
// Naming a speaker (src/speakers.ts): the server keeps the name for the whole session, and every label in the open transcript changes at once.
// Where a name is saved: a Live notes session's own route (with its session number), or the audio/video file's own route.
const spkCtx = (): { url: string; n?: number; slug: string; task?: string } | null => { const f = FVS.list[FVS.i]; if (!f) return null;
  if (f.transcript) { const m = transcriptLink(f.transcript, LIVE?.api || "", location.href); return m ? { url: `/res/${m.slug}/sessions/${m.task}/livenotes/speakers`, n: m.n, slug: m.slug, task: m.task } : null; }
  return f.tx ? { url: `${f.tx.startsWith(LIVE?.api || "\0") ? f.tx.slice(LIVE!.api.length) : f.tx}/speakers`, slug: f.slug } : null; };
function spkEdit(btn: HTMLElement) {
  const id = btn.dataset.spk!, c = spkCtx(), f = FVS.list[FVS.i], gen = FVS.gen; if (!c || !f) return;
  speakerEditor({ anchor: btn, id, speakers: FVS.speakers || [], people: () => CT.list.filter(p => p.sid).map(p => ({ id: String(p.sid), name: p.name })),
    save: async (b) => {
      try {
        const r = await api(c.url, { speaker: id, ...(c.n != null ? { n: c.n } : {}), ...b });
        if (r?.error || !Array.isArray(r?.speakers)) return String(r?.error || "That didn't save. Try again.");
        if (gen === FVS.gen) { FVS.speakers = speakersOf({ speakers: r.speakers }); const body = document.getElementById("fvbody"); if (body) repaintSpeakers(body, FVS.speakers); if (FVS.data) FVS.transcript = transcriptText(transcriptLines(FVS.data), FVS.speakers); }
        if (c.task) lnSpeakers(c.slug, c.task, r.speakers); return null;
      } catch { return "That didn't save. Check your connection and try again."; }
    } });
}
function openFile(list: FV[], i: number) {
  FVS.list = list; FVS.i = Math.max(0, Math.min(i, list.length - 1));
  let w = document.getElementById("fv"); if (!w) { w = document.createElement("div"); w.id = "fv"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); document.body.appendChild(w); }
  fvPaint(); requestAnimationFrame(() => w!.classList.add("on")); document.body.classList.add("fvopen");
}
function closeFile() { const w = document.getElementById("fv"); FVS.gen++; FVS.pdf?.destroy?.(); FVS.pdf = null; FVS.slide = undefined; document.body.classList.remove("fvopen"); if (!w) return; w.classList.remove("on"); setTimeout(() => { if (!w.classList.contains("on")) w.remove(); }, 200); }
function fvPaint() {
  const w = document.getElementById("fv")!, f = FVS.list[FVS.i], k = fvKind(f), u = f.transcript || fileUrl(f.slug, f.id), x = fvTask(f), n = FVS.list.length, gen = ++FVS.gen;
  FVS.transcript = undefined; FVS.data = undefined; FVS.speakers = undefined; speakerEditorClose();
  FVS.zoom = 1; FVS.pdf?.destroy?.(); FVS.pdf = null; FVS.slide = undefined;
  const [kn0, kd] = KIND[fkind(f.name, f.mime)], kn = k === "deck" ? "Slide deck" : k === "word" ? "Document" : k === "html" ? "Web page" : kn0;
  w.innerHTML = `<div class="fvback" data-fvclose></div><div class="fvbox fv-${k}">
    <header class="fvhd"><span class="aico k-${fkind(f.name, f.mime)}">${I(kd, 18)}</span><span class="fvt"><b title="${esc(f.name)}">${esc(f.name)}</b><span>${kn}${f.bytes ? ` · ${KB(f.bytes)}` : ""}${x ? ` · <a href="#/${esc(f.slug)}/s/${esc(x.id)}" data-fvgo>From “${esc(x.title)}”</a>` : f.you ? " · You added it" : ""}</span></span>
      ${k === "html" && n > 1 ? `<span class="fvhn" role="group" aria-label="Files"><button class="fvb" data-fvn="-1" aria-label="Previous file" title="Previous file"${FVS.i ? "" : " disabled"}>${I('<path d="m15 18-6-6 6-6"/>', 18)}</button><span class="fvhc">${FVS.i + 1} of ${n}</span><button class="fvb" data-fvn="1" aria-label="Next file" title="Next file"${FVS.i < n - 1 ? "" : " disabled"}>${I('<path d="m9 18 6-6-6-6"/>', 18)}</button></span>` : ""}
      ${LIVE && route().s && (k === "html" || k === "pdf" || (k === "word" && zoneKind(f))) ? `<button class="fvb" data-zone="${esc(f.slug)}|${esc(f.id)}" aria-label="Open in zone" title="Open in zone">${I('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><rect x="9" y="9" width="6" height="6" rx="1"/>', 18)}</button>` : ""}
      ${k === "html" ? `<button class="fvb" data-fvfs aria-label="Full screen" title="Full screen">${I('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>', 18)}</button>` : ""}
      ${k === "image" || k === "pdf" || k === "word" ? `<span class="fvzoom"><button data-fvz="-1" aria-label="Zoom out">${I('<path d="M5 12h14"/>', 16)}</button><button data-fvz="0" class="fvzl" aria-label="Fit">100%</button><button data-fvz="1" aria-label="Zoom in">${I('<path d="M5 12h14"/><path d="M12 5v14"/>', 16)}</button></span>` : ""}
      ${f.transcript ? `<button class="fvb" data-transcript-download disabled aria-label="Download transcript" title="Download transcript as text">${I('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', 18)}</button>` : `${shViewerBtns(f.slug, f.id, f.name, f.mime)}<a class="fvb" href="${fileUrl(f.slug, f.id, true)}" download aria-label="Download" title="Download">${I('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', 18)}</a>`}
      <button class="fvb" data-fvclose aria-label="Close" title="Close (Esc)">${I('<path d="M18 6 6 18M6 6l12 12"/>', 18)}</button></header>
    <div class="fvbody" id="fvbody">${k === "image" ? `<img class="fvimg" src="${u}" alt="${esc(f.name)}" draggable="false">`
      : k === "video" ? `<video src="${u}" controls playsinline autoplay></video>` : k === "audio" ? `<div class="fvaud"><span class="aico k-doc">${I(kd, 28)}</span><audio src="${u}" controls autoplay></audio></div>`
      : k === "other" ? `<div class="fvnonebox"><span class="aico k-${fkind(f.name, f.mime)}">${I(kd, 30)}</span><b>${esc(f.name)}</b><p>There's no preview for this kind of file yet. Download it, or ask ${esc(who(channels.find(c => c.slug === f.slug)!))} to work with it; it's on its computer at <code>files/${esc(f.name)}</code>.</p><a class="fvdl" href="${fileUrl(f.slug, f.id, true)}" download>Download</a></div>`
      : k === "deck" || k === "word" ? `<div class="fvload">${orb("working", "dark")}<p>Opening ${k === "deck" ? "the slides" : "the document"}…</p><p class="fvslow" hidden>The first time takes a few seconds.</p></div>`
      : `<div class="fvload">${orb("working", "dark")}</div>`}</div>
    ${n > 1 && k !== "html" ? `<button class="fvnav prev" data-fvn="-1" aria-label="Previous file"${FVS.i ? "" : " disabled"}>${I('<path d="m15 18-6-6 6-6"/>', 22)}</button><button class="fvnav next" data-fvn="1" aria-label="Next file"${FVS.i < n - 1 ? "" : " disabled"}>${I('<path d="m9 18 6-6-6-6"/>', 22)}</button><span class="fvcount">${FVS.i + 1} of ${n}</span>` : ""}</div>`;
  const body = document.getElementById("fvbody")!;
  if (f.transcript) fetch(u, { credentials: "same-origin", cache: "no-store" }).then(r => { if (!r.ok) throw new Error(r.status === 404 ? "This transcript is no longer available." : "Couldn't load the transcript. Please try again."); return r.json(); }).then(data => {
    if (gen !== FVS.gen) return;
    const lines = transcriptLines(data); FVS.data = data; FVS.speakers = speakersOf(data); FVS.transcript = transcriptText(lines, FVS.speakers);
    body.innerHTML = `<article class="fvmd fvtranscript">${transcriptHtml(lines, FVS.speakers, 'No speech was recorded in this session.')}</article>`;
    w.querySelector<HTMLButtonElement>('[data-transcript-download]')!.disabled = false;
  }).catch(e => { if (gen === FVS.gen) body.innerHTML = `<div class="fvnonebox"><b>Couldn't open the transcript</b><p>${esc(e.message)}</p><button class="fvdl ghost" data-transcript-retry>Try again</button></div>`; });
  else if ((k === "audio" || k === "video") && f.tx) fetch(f.tx, { credentials: "same-origin", cache: "no-store" }).then(r => r.ok ? r.json() : null).then(data => {
    if (gen !== FVS.gen || !data) return; const lines = transcriptLines(data); if (!lines.length) return;
    FVS.data = data; FVS.speakers = speakersOf(data); body.classList.add("fvwtx"); body.insertAdjacentHTML("beforeend", `<article class="fvmd fvtranscript">${transcriptHtml(lines, FVS.speakers, "")}</article>`);
  }).catch(() => {});
  else if (k === "pdf") fvPdf(u, body, gen);
  else if (k === "deck" || k === "word") fvOffice(f, u, body, gen, k === "deck");
  else if (k === "html") fvHtml(u, body, gen);
  else if (k === "xlsx") fvSheet(u, body, gen);
  else if (k === "md" || k === "csv" || k === "text") fetch(u, { credentials: "same-origin" }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }).then(t => {
    if (gen !== FVS.gen) return; const big = t.length > 1_500_000; if (big) t = t.slice(0, 1_500_000);
    body.innerHTML = (k === "md" ? `<article class="fvmd">${md(t)}</article>` : k === "csv" ? csvTable(t, /\.tsv$/i.test(f.name) || f.mime === "text/tab-separated-values") : `<pre class="fvpre">${esc(t)}</pre>`) + (big ? `<p class="fvmore">This file is long; showing the start. Download it to see everything.</p>` : "");
  }).catch(e => { if (gen === FVS.gen) body.innerHTML = `<p class="fvnone">Couldn't open it (${esc(e.message)}).</p>`; });
  else if (k === "image") { const img = body.querySelector("img")!; img.onerror = () => { if (gen === FVS.gen) body.innerHTML = `<p class="fvnone">Couldn't open this picture.</p>`; }; }
  (w.querySelector(".fvb[data-fvclose]") as HTMLElement | null)?.focus({ preventScroll: true });
}
// PDF: pages render as they scroll into view, sharp at the screen's pixel density. o.data: bytes already fetched (an office
// file's preview); o.deck: a slide deck, one slide per screen (stacked and fit to width on a phone) with a slide pager.
async function fvPdf(u: string, body: HTMLElement, gen: number, o: { data?: ArrayBuffer; deck?: boolean; noun?: string; dl?: string } = {}) {
  try {
    const base = new URL("./pdfjs/", import.meta.url).href, lib: any = await import(/* @vite-ignore */ base + "pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
    const doc = await lib.getDocument({ ...(o.data ? { data: o.data } : { url: u, withCredentials: true }), wasmUrl: base + "wasm/", standardFontDataUrl: base + "standard_fonts/", isEvalSupported: false }).promise;
    if (gen !== FVS.gen) { doc.destroy(); return; } FVS.pdf = doc;
    body.innerHTML = `<div class="fvpages${o.deck ? " fvdeck" : ""}" id="fvpages"></div>`; const wrap = document.getElementById("fvpages")!;
    const first = await doc.getPage(1), vp0 = first.getViewport({ scale: 1 });
    const pages: HTMLElement[] = [], frames: HTMLElement[] = [];
    for (let i = 1; i <= doc.numPages; i++) { const d = document.createElement("div"); d.className = "fvpg"; d.dataset.p = String(i); d.style.aspectRatio = `${vp0.width} / ${vp0.height}`; d.style.setProperty("--ar", String(vp0.width / vp0.height));
      if (o.deck) { const fr = document.createElement("div"); fr.className = "fvslide"; fr.dataset.s = String(i - 1); d.setAttribute("role", "img"); d.setAttribute("aria-label", `Slide ${i} of ${doc.numPages}`); fr.appendChild(d); wrap.appendChild(fr); frames.push(fr); }
      else wrap.appendChild(d);
      pages.push(d); }
    const done = new Set<number>(), draw = async (d: HTMLElement) => {
      const n = +d.dataset.p!, key = n * 1000 + Math.round(FVS.zoom * 100); if (done.has(key) || gen !== FVS.gen) return; done.add(key);
      const pg = await doc.getPage(n), v1 = pg.getViewport({ scale: 1 }); d.style.aspectRatio = `${v1.width} / ${v1.height}`; d.style.setProperty("--ar", String(v1.width / v1.height));
      const css = d.clientWidth || wrap.clientWidth, sc = css / v1.width * Math.min(3, devicePixelRatio || 1), vp = pg.getViewport({ scale: sc });
      const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      await pg.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise; if (gen !== FVS.gen) return;
      d.querySelector("canvas")?.remove(); d.appendChild(c);
    };
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) draw(e.target as HTMLElement); }), { root: body, rootMargin: "600px 0px" });
    pages.forEach(p => io.observe(p)); (FVS as any).redraw = () => pages.forEach(p => { const r = p.getBoundingClientRect(); if (r.bottom > -600 && r.top < innerHeight + 600) draw(p); });
    const cnt = document.querySelector(".fvt > span"), N = doc.numPages; if (cnt && (N > 1 || o.deck)) cnt.insertAdjacentHTML("beforeend", ` · ${N} ${o.deck ? (N === 1 ? "slide" : "slides") : "pages"}`);
    if (o.deck) fvDeckPager(body, frames, N, o.dl || `${u}?dl=1`, gen);
  } catch (e: any) { if (gen === FVS.gen) body.innerHTML = `<div class="fvnonebox"><b>Couldn't show this ${o.noun || "PDF"}</b><p>${esc(String(e?.message || e).slice(0, 160))}</p><a class="fvdl" href="${o.dl || `${u}?dl=1`}" download>Download</a></div>`; }
}
// A deck's pager under the slides: ‹ 3 / 12 › and Download .pptx. The slide in view is tracked as it scrolls (one slide per
// screen, scroll-snapped); ← → ↑ ↓ PageUp/PageDown/Space/Home/End page slides (the keydown handler below), past the ends ← → move files.
function fvDeckPager(body: HTMLElement, frames: HTMLElement[], n: number, dl: string, gen: number) {
  const box = body.closest(".fvbox")!; box.querySelector(".fvpager")?.remove();
  const ext = fvExt(FVS.list[FVS.i]?.name || "") || "pptx";
  box.insertAdjacentHTML("beforeend", `<div class="fvpager" role="group" aria-label="Slides"><button class="fvpgb" data-fvs="-1" aria-label="Previous slide" title="Previous slide (←)">${I('<path d="m15 18-6-6 6-6"/>', 18)}</button><span class="fvpgn" aria-live="polite"><b>1</b> / ${n}</span><button class="fvpgb" data-fvs="1" aria-label="Next slide" title="Next slide (→)">${I('<path d="m9 18 6-6-6-6"/>', 18)}</button><a class="fvpdl" href="${dl}" download>${I('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>', 16)}<span>Download .${esc(ext)}</span></a></div>`);
  const pager = box.querySelector<HTMLElement>(".fvpager")!, num = pager.querySelector("b")!, prev = pager.querySelector<HTMLButtonElement>('[data-fvs="-1"]')!, next = pager.querySelector<HTMLButtonElement>('[data-fvs="1"]')!;
  let cur = 0; const seen = new Map<number, number>();
  const show = (i: number) => { cur = i; num.textContent = String(i + 1); prev.disabled = i <= 0; next.disabled = i >= n - 1; };
  show(0);
  const io = new IntersectionObserver(es => { if (gen !== FVS.gen) return; es.forEach(e => seen.set(+(e.target as HTMLElement).dataset.s!, e.intersectionRatio));
    let best = cur, r = -1; seen.forEach((v, k) => { if (v > r + 0.01 || (Math.abs(v - r) <= 0.01 && k < best)) { r = v; best = k; } }); if (r > 0) show(best); }, { root: body, threshold: [0, 0.25, 0.5, 0.75, 1] });
  frames.forEach(f => io.observe(f));
  // d: ±1 from the slide in view (abs: go to slide d). false when there is no slide that way (← → then move to the next file).
  FVS.slide = (d: number, abs = false) => { const j = abs ? Math.max(0, Math.min(n - 1, d < 0 ? n - 1 : d)) : cur + d; if (j < 0 || j >= n || (abs && j === cur)) return !abs ? false : true;
    frames[j].scrollIntoView({ block: matchMedia("(max-width: 767px)").matches ? "center" : "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); show(j); return true; };
}
// An HTML file (an HTML slide deck, a page): it runs in a frame with an empty origin (sandbox without allow-same-origin), so its own script
// works (arrow keys, tap, full screen) but can't read the app's cookies, storage or page, or call the app's API. Links open in a new tab.
function fvHtml(u: string, body: HTMLElement, gen: number) {
  fetch(u, { credentials: "same-origin" }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }).then(t => {
    if (gen !== FVS.gen) return;
    body.innerHTML = `<iframe class="fvhtml" title="Preview" sandbox="allow-scripts allow-popups" allow="fullscreen" allowfullscreen referrerpolicy="no-referrer"></iframe>`;
    const fr = body.querySelector("iframe")!; fr.addEventListener("load", () => fr.focus()); fr.srcdoc = t;
  }).catch(e => { if (gen === FVS.gen) body.innerHTML = `<p class="fvnone">Couldn't open it (${esc(e.message)}).</p>`; });
}
// A deck or Word document: its PDF preview (made on the computer the first time; a few seconds), then the PDF viewer.
async function fvOffice(f: FV, u: string, body: HTMLElement, gen: number, deck: boolean, retry = false) {
  const noun = deck ? "deck" : "document", ext = fvExt(f.name), dl = `${u}?dl=1`;
  const slow = setTimeout(() => { const p = body.querySelector<HTMLElement>(".fvslow"); if (p) p.hidden = false; }, 2500);
  try {
    const r = await fetch(`${u}/preview${retry ? "?retry=1" : ""}`, { credentials: "same-origin" });
    if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.error || `HTTP ${r.status}`); }
    const data = await r.arrayBuffer(); clearTimeout(slow); if (gen !== FVS.gen) return;
    await fvPdf(u, body, gen, { data, deck, noun, dl });
  } catch (e: any) {
    clearTimeout(slow); if (gen !== FVS.gen) return;
    const [, kd] = KIND[fkind(f.name, f.mime)];
    body.innerHTML = `<div class="fvnonebox"><span class="aico k-doc">${I(kd, 30)}</span><b>Couldn't open a preview of this ${noun}</b><p>${esc(String(e?.message || e).replace(/^Couldn't make a preview: /, "").slice(0, 200))}</p><div class="fvacts"><button class="fvdl ghost" data-fvretry>Try again</button><a class="fvdl" href="${dl}" download>Download .${esc(ext)}</a></div></div>`;
  }
}
function fvZoom(dir: number) {
  const f = FVS.list[FVS.i], k = fvKind(f); FVS.zoom = dir === 0 ? 1 : Math.max(0.5, Math.min(4, FVS.zoom * (dir > 0 ? 1.25 : 0.8)));
  const l = document.querySelector(".fvzl"); if (l) l.textContent = `${Math.round(FVS.zoom * 100)}%`;
  if (k === "image") { const img = document.querySelector<HTMLElement>(".fvimg"); img?.classList.toggle("zoomed", FVS.zoom > 1); if (img) img.style.setProperty("--z", String(FVS.zoom)); }
  if (k === "pdf" || k === "word") { const p = document.getElementById("fvpages"); if (p) { p.style.setProperty("--z", String(FVS.zoom)); requestAnimationFrame(() => (FVS as any).redraw?.()); } }
}
if (LIVE) {
  document.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const link = t.closest<HTMLAnchorElement>('a[href]'), transcript = link && LIVE ? transcriptLink(link.href, LIVE.api, location.href) : null;
    if (transcript) {
      e.preventDefault(); e.stopImmediatePropagation();
      openFile([{ slug: transcript.slug, id: `transcript-${transcript.task}-${transcript.n}`, sid: transcript.task, name: 'Raw transcript', mime: 'text/plain', bytes: 0, at: 0, transcript: transcript.url }], 0); return;
    }
    if (document.getElementById("fv")?.contains(t)) {
      if (t.closest('[data-transcript-retry]')) { e.preventDefault(); fvPaint(); return; }
      const sp = t.closest<HTMLElement>('[data-spk]'); if (sp) { e.preventDefault(); spkEdit(sp); return; }
      if (t.closest('[data-transcript-download]')) {
        e.preventDefault(); if (FVS.transcript == null) return;
        const url = URL.createObjectURL(new Blob([FVS.transcript], { type: 'text/plain;charset=utf-8' })), a = document.createElement('a');
        a.href = url; a.download = 'meeting-transcript.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
      }
      if (t.closest("[data-fvclose]")) { e.preventDefault(); closeFile(); return; }
      if (t.closest("[data-fvgo]")) { closeFile(); return; }
      const nv = t.closest<HTMLElement>("[data-fvn]"); if (nv) { e.preventDefault(); FVS.i = Math.max(0, Math.min(FVS.list.length - 1, FVS.i + +nv.dataset.fvn!)); fvPaint(); return; }
      if (t.closest("[data-fvfs]")) { e.preventDefault(); const fr = document.querySelector<HTMLIFrameElement>("#fv .fvhtml"); if (fr) (document.fullscreenElement ? document.exitFullscreen() : fr.requestFullscreen?.())?.catch?.(() => {}); return; }
      const z = t.closest<HTMLElement>("[data-fvz]"); if (z) { e.preventDefault(); fvZoom(+z.dataset.fvz!); return; }
      const sl = t.closest<HTMLElement>("[data-fvs]"); if (sl) { e.preventDefault(); FVS.slide?.(+sl.dataset.fvs!); return; }
      if (t.closest("[data-fvretry]")) { e.preventDefault(); const f = FVS.list[FVS.i], k = fvKind(f), body = document.getElementById("fvbody"); if (body && (k === "deck" || k === "word")) { const gen = ++FVS.gen; body.innerHTML = `<div class="fvload">${orb("working", "dark")}<p>Trying again…</p></div>`; fvOffice(f, fileUrl(f.slug, f.id), body, gen, k === "deck", true); } return; }
      if (t.classList.contains("fvimg")) { if (FVS.zoom > 1) fvZoom(0); else { fvZoom(1); fvZoom(1); fvZoom(1); } return; }   // tap a picture: 2× / back to fit
      if (t.classList.contains("fvbody") || t.classList.contains("fvload") || t.classList.contains("fvslide")) { closeFile(); return; }
      return;
    }
    const a = t.closest<HTMLElement>("[data-fv]"); if (!a || t.closest("[data-fdel],[data-fdl]")) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || (e as MouseEvent).button === 1) return;   // ⌘-click still opens a tab on purpose
    e.preventDefault(); e.stopImmediatePropagation();
    const [slug, id] = a.dataset.fv!.split("|");
    // The list to page through: the Library list as shown, or every file in this chat, or just this file.
    let list: FV[] = [];
    if (a.hasAttribute("data-fvl")) list = [...document.querySelectorAll<HTMLElement>("#lfiles [data-fv]")].map(el => { const [s, i] = el.dataset.fv!.split("|"); const x = (LIB[s] || []).find(y => y.fid === i); return x ? fvOf(s, x) : null; }).filter(Boolean) as FV[];
    else if (a.hasAttribute("data-fvc")) { const { s } = route(); list = (s?.messages || []).flatMap(m => [...(m.files || []), ...(m.cards || []).filter(c => c.t === "file").map(c => c.f)]).map((f: FileV) => ({ slug, id: f.id, name: f.name, mime: f.mime, bytes: f.bytes, at: f.at, sid: f.session, you: f.source === "upload", tx: f.tx })); }
    if (!list.some(f => f.id === id)) { const x = (LIB[slug] || []).find(y => y.fid === id); if (x) list = [fvOf(slug, x)]; }
    if (!list.length) return;
    openFile(list, list.findIndex(f => f.id === id));
  }, true);
  window.addEventListener("keydown", e => {
    if (!document.getElementById("fv") || document.querySelector(".spkpop")) return;   // the speaker name box handles its own keys
    // A deck pages slide by slide; ← → past its first or last slide fall through to the previous / next file.
    if (FVS.slide && e.key !== "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target as HTMLElement).closest("input,textarea,video,audio")) {
      const k = e.key, moved = k === "Home" ? FVS.slide(0, true) : k === "End" ? FVS.slide(-1, true)
        : ["ArrowRight", "ArrowDown", "PageDown"].includes(k) || (k === " " && !e.shiftKey) ? FVS.slide(1) : ["ArrowLeft", "ArrowUp", "PageUp"].includes(k) || k === " " ? FVS.slide(-1) : null;
      if (moved !== null && (moved || !(k === "ArrowRight" || k === "ArrowLeft"))) { e.preventDefault(); return; }
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeFile(); }
    else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && fvKind(FVS.list[FVS.i]) === "html" && !(e.target as HTMLElement).closest("input,textarea,video,audio,button,a")) { document.querySelector<HTMLIFrameElement>("#fv .fvhtml")?.focus(); }   // a live page owns the arrow keys; files change from the header
    else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !(e.target as HTMLElement).closest("input,textarea,video,audio")) { const d = e.key === "ArrowRight" ? 1 : -1, j = FVS.i + d; if (j >= 0 && j < FVS.list.length) { e.preventDefault(); FVS.i = j; fvPaint(); } }
    else if ((e.key === "+" || e.key === "=") && !e.metaKey) fvZoom(1); else if (e.key === "-" && !e.metaKey) fvZoom(-1);
  }, true);
  // Phone: swipe left/right between files, swipe down on a picture to close.
  let sx = 0, sy = 0, st = 0;
  document.addEventListener("touchstart", e => {
    st = 0; const t = e.target as HTMLElement, body = t.closest<HTMLElement>("#fv .fvbody");
    if (!phone() || e.touches.length !== 1 || !body || gestureControl(t) || FVS.zoom > 1 || scrollerOwns(t, body, "x") || scrollerOwns(t, body, "y") || window.getSelection()?.toString()) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  document.addEventListener("touchmove", e => { if (e.touches.length !== 1) st = 0; }, { passive: true });
  document.addEventListener("touchcancel", () => { st = 0; }, { passive: true });
  document.addEventListener("touchend", e => {
    if (!st || !(e.target as HTMLElement).closest?.("#fv .fvbody") || e.changedTouches.length !== 1 || FVS.zoom > 1) { st = 0; return; }
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy, fast = Date.now() - st < 500; st = 0; if (!fast) return;
    const k = fvKind(FVS.list[FVS.i]);
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && k !== "pdf" && k !== "word" && k !== "csv") { const j = FVS.i + (dx < 0 ? 1 : -1); if (j >= 0 && j < FVS.list.length) { FVS.i = j; fvPaint(); } }
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5 && (k === "image" || k === "video")) closeFile();
  }, { passive: true });
}
// ---------- New task modal: start the next task without leaving the one you're in; toast confirms ----------
const NT = { open: false, to: "", pick: false, from: "" };
const nboxSave = (v: string) => draftSet(`new|${NT.from}`, v, NT.to);
function paintNew() {
  const w = document.getElementById("nt")!, to = channels.find(c => c.slug === NT.to) ?? route().ch;
  w.querySelector(".nwho")!.innerHTML = `${av(to, "av sm")}<span>${esc(to.name)}</span>${I('<path d="m6 9 6 6 6-6"/>', 14)}`;
  const mixed = new Set(channels.map(who)).size > 1;   // the helper name is only extra text when channels have different helpers
  w.querySelector(".nlist")!.innerHTML = NT.pick ? channels.map(c => `<button class="nopt${c === to ? " on" : ""}" data-nwho="${c.slug}">${av(c, "av sm")}<b>${esc(c.name)}</b>${mixed ? `<span>${esc(who(c))}</span>` : ""}${c === to ? ic.check : ""}</button>`).join("") : "";
  (w.querySelector("#nbox") as HTMLTextAreaElement).placeholder = `What should ${who(to)} do next?`;
  w.querySelector(".ngo-l")!.textContent = phone() ? "Start" : "Start task";
  if (!NT.pick) (w.querySelector("#nbox") as HTMLTextAreaElement).focus();
}
function openNew() {
  NT.open = true; NT.to = NT.from = route().ch.slug; NT.pick = false; hideToast();
  const nd = draftGet(`new|${NT.from}`); if (nd?.to && channels.some(c => c.slug === nd.to)) NT.to = nd.to;
  let w = document.getElementById("nt"); if (!w) { w = document.createElement("div"); w.id = "nt"; document.body.appendChild(w); }
  w.innerHTML = `<div class="nback" data-nclose></div><form class="nmodal" id="nsend" role="dialog" aria-label="New task">
    ${phone() ? '<button type="button" class="grab" data-nclose aria-label="Close new task"></button>' : ""}<div class="ups" id="ups-nbox">${upsHtml("nbox")}</div><textarea id="nbox" rows="2" autocomplete="off"></textarea>
    <div class="nrow">${cb("attach", "Attach", ic.plus)}
      <div class="npick"><button type="button" class="nwho" data-npick title="Who should do it"></button><div class="nlist"></div></div>
      <span class="grow"></span><span class="nkbd"><kbd>Esc</kbd> to close</span>${LIVE ? slBtn("nbox") + dictBtn("nbox", ic.mic) : cb("mic", "Talk", ic.mic, " mic")}
      <button id="ngo" class="ngo" disabled><span class="ngo-l">Start task</span></button></div></form>`;
  if (phone()) dragToClose(w.querySelector<HTMLElement>(".nmodal")!, () => {
    const draft = (document.getElementById("nbox") as HTMLTextAreaElement | null)?.value.trim();
    if (!draft && !UP.nbox.length) { closeNew(); return; }
    ask({ title: "Discard this task draft?", body: "Your message and attached files haven't been sent.", confirm: "Discard", cancel: "Keep editing", danger: true }).then(ok => { if (ok) { draftClear(`new|${NT.from}`); closeNew(); } });
  });
  const nb = w.querySelector<HTMLTextAreaElement>("#nbox")!; if (nd) nb.value = nd.t;
  paintNew(); if (nd) { nb.dispatchEvent(new Event("input", { bubbles: true })); nb.setSelectionRange(nd.t.length, nd.t.length); nb.scrollTop = nb.scrollHeight; }
  requestAnimationFrame(() => requestAnimationFrame(() => w!.classList.add("on")));
}
function closeNew() { const w = document.getElementById("nt"); NT.open = false; if (!w) return; w.classList.remove("on"); setTimeout(() => { if (!NT.open) w.innerHTML = ""; }, 220); }
function sendNew() {
  const b = document.getElementById("nbox") as HTMLTextAreaElement | null, text = b?.value.trim() || "", to = channels.find(c => c.slug === NT.to) ?? route().ch;
  if (upBusy("nbox")) { note(ic.clock, "Still uploading", "Your files are almost there. Send again in a moment.", ""); return; }
  const sl = LIVE ? slGate("nbox") : "send"; if (sl === "stop") return;
  const files = upTake("nbox", to); if (!text && !files.length) return;
  draftClear(`new|${NT.from}`);
  if (sl === "schedule") { slSchedule("nbox", to.slug, "new", text, files); closeNew(); return; }   // send later (send-later.ts)
  const x = startTask(to, text, files);
  closeNew(); refresh(); toast(to, x);
}
let toastT = 0;
// Contacts import (contacts-import.ts): reads the file here, sends parsed contacts to /api/contacts/import, then Contacts re-reads.
if (LIVE) ciInit({ api, phone, helper: () => who(main), onContacts: () => isCt(),
  me: () => ({ name: LIVE.person || BOOT?.person?.name || "", email: LIVE.email || BOOT?.person?.email || "" }),
  existing: () => CT.list.filter(c => c.sid).map(c => ({ sid: c.sid!, name: c.name, phone: c.phone, email: c.email, phones: numsOf(c).phones.map(x => x.v), emails: numsOf(c).emails.map(x => x.v), aka: c.aka, rel: c.rel })),
  imported: async () => { const d = await api("/contacts"); if (Array.isArray(d?.contacts)) { const had = new Set(CT.list.map(c => c.sid)); CT.list = d.contacts.map(ctFromApi); for (const c of CT.list) if (!had.has(c.sid)) c.fresh = true; } if (Array.isArray(d?.dups)) CT.dups = d.dups; if (isCt()) ctRefresh(); else render(); } });
function toast(ch: Channel, x: Session) {
  let el = document.getElementById("toast"); if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.innerHTML = `<span class="tok">${ic.check}</span>${av(ch, "av sm")}<span class="tmsg"><b>Task sent to ${esc(who(ch))}</b><span>${esc(x.title)}</span></span>
    <button class="tview" data-tview="#/${ch.slug}/s/${x.id}">View task</button><button class="tx" data-tclose aria-label="Dismiss">${I('<path d="M18 6 6 18M6 6l12 12"/>', 15)}</button>`;
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
  clearTimeout(toastT); toastT = window.setTimeout(hideToast, 5000);
  el.onmouseenter = () => clearTimeout(toastT); el.onmouseleave = () => { toastT = window.setTimeout(hideToast, 2500); };
}
function note(icon: string, title: string, sub: string, action: string) {
  let el = document.getElementById("toast"); if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.innerHTML = `<span class="tok ink">${icon}</span><span class="tmsg"><b>${esc(title)}</b><span>${esc(sub)}</span></span>${action}<button class="tx" data-tclose aria-label="Dismiss">${I('<path d="M18 6 6 18M6 6l12 12"/>', 15)}</button>`;
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
  clearTimeout(toastT); toastT = window.setTimeout(hideToast, 5000);
  el.onmouseenter = () => clearTimeout(toastT); el.onmouseleave = () => { toastT = window.setTimeout(hideToast, 2500); };
}
function hideToast() { document.getElementById("toast")?.classList.remove("on"); }

// ---------- Pins: any task can be pinned to the top of its channel ----------
const pinBtn = (x: Session) => `<span class="pin${x.pinned ? " on" : ""}" role="button" tabindex="0" data-pin="${x.id}" title="${x.pinned ? "Unpin" : "Pin to the top"}" aria-label="${x.pinned ? "Unpin" : "Pin"} ${esc(x.title)}">${ic.pin}</span>`;
function togglePin(id: any) {
  const ch = channels.find(c => c.sessions.some(x => String(x.id) === String(id))); if (!ch) return;
  const x = ch.sessions.find(y => String(y.id) === String(id))!; x.pinned = !x.pinned; repaint(ch); livePatch(ch, x, { pinned: !!x.pinned });
}
function repaint(ch: Channel) {
  const { s } = route(); if (route().ch !== ch) return;
  const side = document.querySelector(".sessions"); if (side) morph(side, sideList(ch, s, (document.getElementById("q") as HTMLInputElement | null)?.value ?? ""));
  const ht = document.getElementById("htasks"); if (ht) morph(ht, tasksHtml(ch));
  const mt = document.getElementById("mtasks"); if (mt) morph(mt, tasksHtml(ch));
  const dl = document.getElementById("dlist"); if (dl) morph(dl, sessRows(ch, s, (document.getElementById("dq") as HTMLInputElement | null)?.value ?? ""));
  const hp = document.getElementById("hpin"); if (hp && s) hp.outerHTML = headPin(s);
  if (s) paintHeadDone(s);
  const hh = document.querySelector(".hdate"); if (hh) hh.outerHTML = dateLine(ch);
  if (s) {
    document.querySelectorAll<HTMLElement>("[data-task-title]").forEach(el => { el.textContent = s.title; });
    const heading = document.querySelector<HTMLElement>("#stage>header.th h1"); if (heading) heading.title = s.title;
    document.title = `${s.title} · ${ch.name} · 1Helm`;
  }
  paintMobileStatus(ch, s);
}
function canRename(s: Session) { return !!LIVE && !!s.srv && !BOOT?.look; }
function renameTask(slug: string, sid: string, opener?: HTMLElement) {
  const ch = channels.find(c => c.slug === slug), task = ch?.sessions.find(s => String(s.id) === String(sid));
  if (!ch || !task || !canRename(task)) return;
  const rowScope = opener?.closest("#dlist") ? "#dlist" : opener?.closest("#side") ? "#side" : "";
  if (mState.sheet) closeSheet();
  openTaskRename(task.title, async title => {
    const v = await api(`/res/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(sid)}`, { title }, { signal: AbortSignal.timeout(20000) });
    if (v?.error) throw new Error(v.error);
    if (String(v?.id) !== sid || typeof v?.title !== "string" || !Number.isSafeInteger(v?.title_revision)) throw new Error("Couldn't confirm the saved name. Try again.");
    // Update the title only: an in-flight save must not replace newer task status/messages.
    const newest = Number(task.srv?.title_revision || 0);
    if (v.title_revision >= newest) { task.title = v.title; task.srv = { ...task.srv, title: v.title, title_manual: true, title_revision: v.title_revision }; }
    repaint(ch);
  }, () => {
    const target = opener?.isConnected ? opener : rowScope ? document.querySelector<HTMLElement>(`${rowScope} [data-rowmenu="${CSS.escape(`${slug}|${sid}`)}"]`) : document.querySelector<HTMLElement>(phone() ? ".mh [data-rename]" : "#stage [data-rename]");
    target?.focus({ preventScroll: true });
  });
}
document.addEventListener("click", e => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("[data-rename]"); if (!button) return;
  e.preventDefault(); e.stopPropagation(); const [slug, sid] = button.dataset.rename!.split("|"); renameTask(slug, sid, button);
});
// Streaming/polling repaints deliberately keep the mobile header and composer mounted.
// Its status controls must still follow the current task, just like desktop #hdone.
function paintMobileStatus(ch: Channel, s: Session | null) {
  if (!phone()) return;
  const h = document.querySelector<HTMLElement>(".mh"); if (!h) return;
  const done = h.querySelector<HTMLButtonElement>(".mdone");
  if (done && s) {
    done.classList.toggle("on", !!s.done); done.dataset.done = String(s.id);
    done.setAttribute("aria-label", s.done ? "Reopen" : "Mark done");
    morph(done, box(s).replace(/ data-done="[^"]+"/, "").replace('role="checkbox" tabindex="0"', 'aria-hidden="true"'));
  }
  let stop = h.querySelector<HTMLButtonElement>(".mstop");
  if (s && stWorking(s)) {
    if (!stop) { stop = document.createElement("button"); stop.className = "cb mstop"; stop.setAttribute("aria-label", "Stop this task"); stop.title = "Stop"; stop.innerHTML = SQ; h.insertBefore(stop, done?.parentElement || h.querySelector("[data-mtools]")); }
    stop.dataset.stop = `${ch.slug}|${s.id}`; stop.disabled = stopBusy(ch.slug, s.id);
  } else stop?.remove();
  h.querySelector("[data-watch]")?.classList.toggle("busy", pcOn(ch.slug));
}
// Done lists sort by when the task was marked done (server done_at), newest first; older rows without it fall back to updated.
function doneAt(x: Session) { return Number(x.srv ? x.srv.done_at : (x as any).doneAt) || x.updated; }
function byDone(a: Session, b: Session) { return doneAt(b) - doneAt(a); }
function setDoneAt(x: Session, at: number | null) { if (x.srv) x.srv.done_at = at; else (x as any).doneAt = at; }
// Only the person marks a task done. The helper can finish its work; the checkbox is still yours.
function toggleDone(id: any, fromUndo = false) {
  const ch = channels.find(c => c.sessions.some(x => String(x.id) === String(id))); if (!ch) return;
  const x = ch.sessions.find(y => String(y.id) === String(id))!; if (isTexts(x) && !x.done) return; x.done = !x.done; if (x.done) x.unread = false; setDoneAt(x, x.done ? Date.now() : null); repaint(ch); livePatch(ch, x, { done: !!x.done });
  if (!fromUndo && x.done) note(`${ic.check}`, "Marked done", x.title, `<button class="tview" data-undo="${x.id}">Undo</button>`);
  else if (!fromUndo) hideToast();
}
// Repaint #hdone only when its markup changed, so the status dot animation is not restarted, and refit the header at once so a
// folded .ho item is never painted visible for a frame (the new markup has no hhid class until hFit runs).
const paintHeadDone = (s: Session) => {
  const hd = document.getElementById("hdone"); if (!hd) return;
  const html = headDone(s), sig = html.replace(/animation-delay:-\d+ms/g, "");   // the spinner's phase offset changes on every call
  if (hd.dataset.sig === sig) return;
  const keep = new Set([...hd.querySelectorAll<HTMLElement>(".ho.hhid")].map(x => x.dataset.ho));
  hd.outerHTML = html; const nh = document.getElementById("hdone"); if (nh) nh.dataset.sig = sig;
  nh?.querySelectorAll<HTMLElement>(".ho").forEach(x => { if (keep.has(x.dataset.ho)) x.classList.add("hhid"); });
  hFit();
};
const headDone = (s: Session) => `<span id="hdone" class="hdone-wrap">${s.done ? "" : `<span class="meta ${astate(s)}" title="${statusText(s)}"><i class="st"></i>${statusText(s)}</span>`}${headStop(chOf(s).slug, s.id, stWorking(s))}
  ${isTexts(s) ? "" : `<span class="ho" data-ho="2"><button class="hdone${s.done ? " on" : ""}" data-done="${s.id}" aria-pressed="${!!s.done}">${box(s, true).replace(/ data-done="[^"]+"/, "").replace('role="checkbox" tabindex="0"', 'aria-hidden="true"')}<span>${s.done ? "Done" : "Mark done"}</span></button></span>`}</span>`;
window.addEventListener("click", e => {
  const d = (e.target as HTMLElement).closest<HTMLElement>("[data-done]"); if (d) { e.preventDefault(); e.stopImmediatePropagation(); toggleDone(d.dataset.done!); return; }
  const u = (e.target as HTMLElement).closest<HTMLElement>("[data-undo]"); if (u) { e.preventDefault(); e.stopImmediatePropagation(); toggleDone(u.dataset.undo!, true); hideToast(); }
}, true);
window.addEventListener("keydown", e => {
  const d = (e.target as HTMLElement).closest?.<HTMLElement>(".box[data-done]"); if (!d || (e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault(); e.stopImmediatePropagation(); toggleDone(d.dataset.done!);
}, true);
const headPin = (s: Session) => `<button id="hpin" class="hpin${s.pinned ? " on" : ""}" data-pin="${s.id}" title="${s.pinned ? "Unpin" : "Pin to the top of this channel"}">${ic.pin}<span>${s.pinned ? "Pinned" : "Pin"}</span></button>`;
window.addEventListener("click", e => {
  const p = (e.target as HTMLElement).closest<HTMLElement>("[data-pin]"); if (!p) return;
  e.preventDefault(); e.stopImmediatePropagation(); togglePin(p.dataset.pin!);
}, true);
window.addEventListener("keydown", e => {
  const p = (e.target as HTMLElement).closest?.<HTMLElement>("[data-pin]"); if (!p || (e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault(); e.stopImmediatePropagation(); togglePin(p.dataset.pin!);
}, true);

// ---------- Folding sections: Pinned / Tasks / Done headers collapse; remembered per channel + section in this browser ----------
const foldK = (ch: Channel, k: string) => `1hc-fold-${LIVE?.slug || "sandbox"}-${ch.slug}-${k}`;
const folded = (ch: Channel, k: string) => { try { return localStorage.getItem(foldK(ch, k)) === "1"; } catch { return false; } };
function setFolded(ch: Channel, k: string, shut: boolean) { try { shut ? localStorage.setItem(foldK(ch, k), "1") : localStorage.removeItem(foldK(ch, k)); } catch {} }
const foldHead = (cls: string, k: string, label: string, n: number, shut: boolean, searching = false) =>
  `<button type="button" class="${cls} fold" data-fold="${k}" aria-expanded="${!shut}"${searching ? " disabled" : ""}><span class="flbl">${label}</span>${shut && n ? `<b class="fcount">${n}</b>` : ""}<span class="fcaret">${ic.chev}</span></button>`;
document.addEventListener("click", e => {
  const f = (e.target as HTMLElement).closest<HTMLElement>("[data-fold]"); if (!f) return;
  e.preventDefault(); const { ch } = route(); setFolded(ch, f.dataset.fold!, f.getAttribute("aria-expanded") === "true"); repaint(ch);
});
// Texting conversations (the server marks them texts:true) get their own "Texts" section above the task sections; it appears with the first text.
function isTexts(x: Session) { return !!x.srv?.texts; }
// Open tasks sit in one section per state: astate(), the same state as their status dot and label, most urgent first.
// Empty sections don't show; each folds with its caret like Done (no counts).
const TSECS = [["waiting", "Waiting on you"], ["working", "Working"], ["ready", "Ready for you"], ["watching", "Watching"]] as const;
const stateGroups = (rest: Session[], group: (k: string, l: string, items: Session[], nc?: boolean) => string) =>
  TSECS.map(([k, l]) => group(k, l, rest.filter(x => !x.done && !isTexts(x) && astate(x) === k), true)).join("");
// Ranked task search (task-search.ts). Only the real app has a server to ask; the design sandbox keeps the local filter.
const RS = createRankedSearch({
  fetchRanked: (slug, q, signal) => api(`/res/${slug}/search?q=${encodeURIComponent(q)}`, undefined, { signal }).then(d => { if (!d || d.error || !Array.isArray(d.results)) throw new Error("search failed"); return d.results; }),
  onChange: () => { const { ch, s } = route(), side = document.querySelector(".sessions"), dl = document.getElementById("dlist");
    if (side) morph(side, sideList(ch, s, (document.getElementById("q") as HTMLInputElement | null)?.value ?? ""));
    if (dl) morph(dl, sessRows(ch, s, (document.getElementById("dq") as HTMLInputElement | null)?.value ?? "")); },
});
const rankSearch = (slug: string, q: string) => { if (LIVE) RS.input(slug, q); };
function sideList(ch: Channel, s: Session | null, q: string) {
  const ql = q.toLowerCase(), ranked = LIVE ? RS.ranked(ch.slug, q) : null;
  const list = ranked ? rankedRows(ch.sessions, ranked) : ch.sessions.filter(x => !ql || x.title.toLowerCase().includes(ql) || x.messages.some(m => m.body.toLowerCase().includes(ql)));
  const row = (x: Session) => { const sr = secRow(ch.slug, x, true); return `<a class="sess${x === s ? " on" : ""}${freshOnce("sess", x, x.fresh)}${x.done ? " isdone" : ""}${sr.c}"${sr.a} href="#/${ch.slug}/s/${x.id}">${box(x, true)}
      <span class="t">${esc(x.title)}</span>${LIVE && hasFeature("ambient") ? lnDot(ch.slug, x.id) : ""}${rowStop(ch.slug, x.id, x.title, stWorking(x))}${pinBtn(x)}${LIVE && x.srv ? rowMore(ch.slug, x.id, x.title) : ""}${rowTail(x)}</a>`; };
  // Searching shows every match: folded sections open while there's a query (the saved choice comes back when it's cleared).
  const group = (key: string, label: string, items: Session[], nc = false) => { if (!items.length) return ""; const shut = !ql && folded(ch, `side-${key}`);
    return `${foldHead("grp", `side-${key}`, label, nc ? 0 : items.length, shut, !!ql)}${shut ? "" : items.map(row).join("")}`; };
  const rest = list.filter(x => !x.pinned);
  if (ranked) return list.length ? list.map(row).join("") : `<div class="empty">Nothing matches.</div>`;   // a ranked answer is one flat list, most likely first, with no sections
  if (csOn(ch)) return secList(ch.slug, list, { row, head: (k, l, n, shut, srch) => foldHead("grp", `side-${k}`, l, n, shut, srch), shut: k => folded(ch, `side-${k}`), searching: !!ql, empty: `<div class="empty">Nothing matches.</div>` }) + secPlus(ch.slug, !!ql);
  return `${secPlus(ch.slug, !!ql)}${group("pinned", `${ic.pin}Pinned`, list.filter(x => x.pinned))}${group("texts", "Texts", rest.filter(x => !x.done && isTexts(x)))}${stateGroups(rest, group)}${group("done", "Done", rest.filter(x => x.done).sort(byDone))}${!list.length ? `<div class="empty">${q ? "Nothing matches." : "No tasks yet."}</div>` : ""}`;
}
const csOf2 = (ch: Channel): CS => ch.cs ??= { on: false, sections: [] };
const csOn = (ch: Channel) => csOf2(ch).on;
function clearFresh(ch: Channel) { if (ch.sessions.some(x => x.fresh) || lib(ch).some(a => a.fresh)) setTimeout(() => { ch.sessions.forEach(x => x.fresh = false); lib(ch).forEach(a => a.fresh = false); }, 600); }
function titleOf(t: string) {
  let x = t.trim().replace(/^(hey|hi|ok|okay)[,!\s]+/i, "").replace(/^(can|could|would) you (please )?/i, "").replace(/^please /i, "").replace(/[?.!]+$/, "");
  x = x.charAt(0).toUpperCase() + x.slice(1); return x.length > 48 ? x.slice(0, 46).trimEnd() + "…" : x;
}
// Patch a container to new HTML IN PLACE: same elements stay, only changed text/attributes/children move.
// Replacing innerHTML rebuilt every row on every status tick, replaying the "drop" animation and reloading images = flicker.
function morph(el: Element | null, html: string) {
  if (!el) return; const t = document.createElement("template"); t.innerHTML = html; mkids(el, t.content);
}
function mkids(a: Node, b: Node) {
  const na = [...a.childNodes], nb = [...b.childNodes];
  for (let i = 0; i < nb.length; i++) {
    const x = na[i], y = nb[i];
    if (!x) { a.appendChild(y); continue; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y, x); continue; }
    if (x.nodeType === 3 || x.nodeType === 8) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
    const ex = x as Element, ey = y as Element;
    for (const at of [...ex.attributes]) if (!ey.hasAttribute(at.name) && !(at.name === "open" && ex.tagName === "DETAILS")) ex.removeAttribute(at.name);
    for (const at of [...ey.attributes]) if (ex.getAttribute(at.name) !== at.value) { if (at.name === "style" && ex.tagName === "rect") continue; ex.setAttribute(at.name, at.value); }
    if (ex.tagName === "IMG" || ex.tagName === "VIDEO" || ex.tagName === "AUDIO") continue;
    mkids(ex, ey);
  }
  for (let i = na.length - 1; i >= nb.length; i--) na[i].remove();
}
// The arrival animation plays ONCE per row per list, ever (a task's tmp→real id swap is the same object, so it doesn't replay).
const SEEN_ROWS: Record<string, WeakSet<object>> = {};
const freshOnce = (where: string, x: object, fresh?: boolean) => { const w = SEEN_ROWS[where] ??= new WeakSet(); if (w.has(x)) return ""; w.add(x); return fresh ? " fresh" : ""; };
// Live-update lists without re-rendering the composer, so typing is never interrupted.
function refresh() {
  const { ch, s } = route(), box = document.getElementById("box") as HTMLTextAreaElement | null, typing = !!box?.value;
  if (isLib()) { const f = document.getElementById("lfiles"), c = document.getElementById("colls"); if (f) f.innerHTML = libFilesHtml(); if (c) c.innerHTML = collHtml(); const lb = document.querySelector(".lbar.first h2"); if (lb) lb.textContent = `${lib(ch).length} files`; clearFresh(ch); return; }
  if (phone()) {
    const mt = document.getElementById("mtasks"); if (!s && mt) { morph(mt, tasksHtml(ch)); $("#mhead").innerHTML = homeHead(ch); }
    else if (!typing && !mState.drawer && !isCt() && !isSch() && !(isNb() && !s)) renderM();   // the Notebook patches itself (nbPaint); rebuilding the phone screen mid-scroll sends the page back to the top   // Contacts doesn't change here; re-rendering would drop the search box's focus (Scheduled repaints itself: schPaint)
    const dl = document.getElementById("dlist"); if (dl) morph(dl, sessRows(ch, s, ($("#dq") as HTMLInputElement)?.value ?? ""));
  } else if (!s && (isNb() || isCt() || isSch())) {
    const ss = document.querySelector(".sessions"); if (ss) morph(ss, sideList(ch, s, ($("#q") as HTMLInputElement)?.value ?? ""));   // background refresh on Notebook/Contacts: only the side list
  } else if (!s) {
    morph($("#htasks"), tasksHtml(ch)); $(".hdate").outerHTML = dateLine(ch);
    morph($(".sessions"), sideList(ch, s, ($("#q") as HTMLInputElement)?.value ?? ""));
  } else if (!typing) render();
  else morph($(".sessions"), sideList(ch, s, ($("#q") as HTMLInputElement)?.value ?? ""));
  clearFresh(ch);
  paintMobileStatus(ch, s);
  stNow();
}
function startTask(ch: Channel, text: string, files: FileV[] = []) {
  if (LIVE) return liveStart(ch, text, files);
  const w = who(ch), [v1, v2] = VERB[ch.slug] ?? ["working on it", "wrapping up"], at = Date.now();
  const x: Session = { id: nextId++, title: titleOf(text), status: "open", state: "working", updated: at, fresh: true, line: `${w} is reading your request…`,
    messages: [{ id: nextId++, role: "user", body: text, at, steps: [] }, { id: nextId++, role: "agent", body: "", at, steps: [] }] };
  ch.sessions.unshift(x);
  const steps = [`${w} is ${v1}…`, `${w} is ${v2}…`];
  const tick = () => {
    const next = steps.shift(); x.updated = Date.now();
    if (next) { x.line = next; refresh(); setTimeout(tick, 2200 + Math.random() * 1200); return; }
    x.state = "complete"; x.status = "resolved"; x.unread = true; x.line = `Finished · take a look, and check it off when you're happy`;
    x.messages[1].body = `Done. I took care of “${text}”.\n\n<small>Scripted reply · design sandbox</small>`; x.messages[1].steps = ["check notes", "look it up"]; x.messages[1].at = x.updated;
    const kinds: Art["kind"][] = ["doc", "sheet", "pdf"]; lib(ch).unshift({ name: x.title, kind: kinds[x.id % 3], sid: x.id, at: x.updated, size: "New", fresh: true });
    refresh();
  };
  setTimeout(tick, 1800);
  return x;
}
const composer = (ph: string) => `<div class="ups" id="ups-box">${upsHtml("box")}</div>${rqHtml(rqKey())}<form class="composer" id="send">${cb("attach", "Attach", ic.plus)}
  <textarea id="box" rows="1" placeholder="${ph}"></textarea>
  ${LIVE ? slBtn("box") + dictBtn("box", ic.mic) : cb("mic", "Talk", ic.mic, " mic")}
  <button id="go" disabled aria-label="Send">${ic.up}</button>${LIVE ? composerStop() : ""}</form>`;
// A reply part: cards when it's OpenUI Lang (genui-render.ts), else today's markdown bubble (after the code safety net). Prose
// followed by code lines becomes a bubble plus cards. Partial code stays hidden
// while the independent Primary activity row indicates the turn is still working.
const PRE_OWNERS = new WeakMap<Msg, object[]>(), PRE_OWNER = (m: Msg, j: number) => ((PRE_OWNERS.get(m) ?? (PRE_OWNERS.set(m, []), PRE_OWNERS.get(m)!))[j] ??= {});
// Activity belongs to the ongoing turn, never to a blank or partial reply.
// Required worker-only routing reports working without a Primary stream/line;
// its workers have their own persistent indicators below this row.
function primaryWorking(s: Session) {
  if (s.state !== "working") return false; // includes confirmed user/approval waits
  if (s.streaming) return true;           // includes model waits and reconnects
  return !(Number(s.srv?.helpers) > 0 && !s.rawLine && !s.srv?.line);
}
// The turn's one progress row (tracker.ts tkProgress): the status line is the only part that changes while the turn runs.
function turnProgress(s: Session, ch: Channel) {
  const line = String(s.rawLine || s.srv?.line || ""), m = s.messages.findLast(m => m.role === "agent");
  let primary = "";
  if (primaryWorking(s)) primary = /writ|compos|respond/i.test(line) || m?.body.trim() ? "Writing the answer" : "Working";
  else if (s.state === "working" && Number(s.srv?.helpers) > 0) primary = "Subagent working";
  return tkProgress(ch.slug, s.id, who(ch), primary, (s.srv?.pending_inputs || []).length > 0, orbState(line, { waiting: !!streamState(s).waiting, body: primaryWorking(s) && !!m?.body.trim() }));
}
const MA_PARTS = new WeakMap<Msg, Map<string, string>>();
function partHtml(text: string, ch: Channel, s: Session | undefined, owner: object, live: boolean, reply: string | undefined, pre = false, message?: Msg, part = "body") {
  const t = text.trim(); if (!t) return "";
  if (LIVE && t === "Stopped.") return `<div class="stopped-note" role="status">${SQ}<span>Stopped by you</span></div>`;   // a task the person stopped (1HC stop.js)
  const bubble = (x: string, j: number) => { const y = scrubCode(x).trim(), key = `${part}-${j}`; if (!y) return "";
    if (message) MA_PARTS.get(message)!.set(key, y);
    const card = (message as TkMsg | undefined)?.card;
    return `<div class="bubble${pre ? " pre" : ""}${message ? maOpenCls(message.id, key) : ""}">${message ? maActs(message.id, key, LIVE && s && card && tkOn(ch.slug, s.id) ? card : "") : ""}<div class="body">${chatCodeHtml(chatMarkdown(y))}</div></div>`; };
  // Prose with code lines in it (or a code tail still streaming) paints part by part; a part that may still become code waits.
  // An unrelated message does not dismiss a pending clarification card.
  const request = message?.input_request;
  const sourceTurn = (message as TkMsg | undefined)?.rid;
  if (!request && message && sourceTurn) {
    const following = (s?.messages as TkMsg[] | undefined)?.slice((s?.messages.indexOf(message) ?? -1) + 1);
    const answer = following?.find(m => m.role === "user" && m.input_reply?.source_turn === sourceTurn);
    const nextUser = following?.find(m => m.role === "user");
    if (answer) reply = answer.body;
    else if (nextUser?.input_reply) reply = undefined;
  }
  if (request) {
    const answer = (s?.messages as TkMsg[] | undefined)?.find(m => m.role === "user" && m.input_reply?.question_id === request.question_id);
    reply = answer?.body ?? (request.status === "pending" ? undefined : request.answer_text ?? reply ?? "");
  }
  const ps = replyParts(t, live), claim = claimFiles(message, t);
  return ps.map((p, j) => {
    if (p.k === "text") return bubble(p.s, j);
    if (p.k === "pending") return "";
    const c = renderCard(p.s, { owner: partOwner(owner, j), ref: { ch, s, source_turn: (message as TkMsg | undefined)?.rid, input_request: message?.input_request }, sid: `${s?.id ?? ""}:${(message as TkMsg | undefined)?.rid || message?.id || ""}`, streaming: live, reply, file: n => cardFile(ch, n, claim), icon: cardIcon });
    if (c && "html" in c) return c.html || "";
    return c ? bubble(c.text, j) : "";
  }).join("");
}
// File card: a file of that name in this channel's Library opens in the file viewer; otherwise it's a static card.
// A reply that draws a File card for a file it shared is shown once: the tile the message holds for that file (m.cards, from the share event live
// and from the saved turn after a reload) is not drawn again, and a File named a little differently from the shared one ("... (preview).html")
// stands for the shared file of its type that no other File claimed. claimFiles returns that match for each File name and the claimed ids.
const FILE_CALL = /\bFile\(\s*"((?:[^"\\]|\\.)*)"/g;
function claimFiles(m: Msg | undefined, text: string) {
  const byName = new Map<string, FileV>(), ids = new Set<string>(), tiles: FileV[] = [];
  for (const c of m?.cards || []) if (c.t === "file" && c.f?.id && !tiles.some(x => x.id === c.f.id)) tiles.push(c.f);
  if (!tiles.length) return { byName, ids };
  const names = [...new Set([...String(text || "").matchAll(FILE_CALL)].map(x => x[1].replace(/\\(.)/g, "$1").trim().replace(/^.*\//, "")).filter(Boolean))];
  const ext = (n: string) => (n.toLowerCase().match(/\.([a-z0-9]{1,8})$/) || [])[1] || "";
  for (const n of names) { const t = tiles.find(f => !ids.has(f.id!) && f.name.toLowerCase() === n.toLowerCase()); if (t) { byName.set(n, t); ids.add(t.id!); } }
  for (const n of names) { if (byName.has(n)) continue; const t = tiles.find(f => !ids.has(f.id!) && ext(f.name) === ext(n) && ext(n)); if (t) { byName.set(n, t); ids.add(t.id!); } }
  return { byName, ids };
}
function cardFile(ch: Channel, name: string, claim?: { byName: Map<string, FileV> }) {
  if (!LIVE) return null; const n = name.trim().replace(/^.*\//, "");
  const t = claim?.byName.get(n), a = t ? { fid: t.id, kind: t.image ? "image" : "" } : (LIB[ch.slug] || []).find(x => x.fid && x.name.toLowerCase() === n.toLowerCase()); if (!a) return null;
  return { fv: `${ch.slug}|${a.fid}`, href: fileUrl(ch.slug, a.fid!), dl: fileUrl(ch.slug, a.fid!, true), image: a.kind === "image" ? fileUrl(ch.slug, a.fid!) : undefined };
}
const cardIcon = (name: string) => { const k = fkind(name); return `<span class="aico k-${k}">${I(KIND[k][1], 30)}</span>`; };
// Every message of a task, each knowing the next thing the person said after it (that locks a card's controls).
function msgsHtml(s: Session, ch: Channel) {
  settleBrowserCards(s);   // the live "using the browser" card goes once nothing is running, however the end was missed
  const next: (string | undefined)[] = []; let u: string | undefined;
  for (let i = s.messages.length - 1; i >= 0; i--) { next[i] = u; if (s.messages[i].role === "user") u = s.messages[i].body; }
  return s.messages.map((m, i) => msgHtml(m, ch, s.messages[i - 1], !!s.streaming && i === s.messages.length - 1, s, next[i])).join("") + turnProgress(s, ch) + (LIVE && loadFailed(s) ? `<div class="wkfail tkfail"><p>This task didn't load.</p><button class="sa mute" data-tkload>Tap to try again</button></div>` : "") + (LIVE && s.srv ? slBubbles(ch.slug, s.id) : "") + (LIVE && s.srv && !s.streaming && showCosts() ? usageNote(ch.slug, s.id) : "");
}
// The helper's reaction on a person's message (its react tool): a tapback badge on the bubble's top corner, like iMessage.
// m.turn = the server's turn id (the stream's reaction event names it); m.reaction = love | like | dislike | laugh | emphasize | question.
type RxMsg = Msg & { turn?: string; reaction?: string };
const RX: Record<string, [string, string]> = { love: ["❤️", "loved"], like: ["👍", "liked"], dislike: ["👎", "disliked"], laugh: ["😂", "laughed at"], emphasize: ["‼️", "emphasized"], question: ["❓", "questioned"] };
const rxHtml = (m: RxMsg) => { const r = m.reaction && RX[m.reaction]; return r ? `<span class="rx" data-rx="${m.id}" role="img" aria-label="Reaction: ${r[1]} this" title="Reacted ${r[0]}">${r[0]}</span>` : ""; };
// A reaction that arrives live pops in once (Web Animations, so a repaint or a reload never replays it).
function rxPop(m: Msg) {
  const el = document.querySelector<HTMLElement>(`.rx[data-rx="${m.id}"]`); if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.animate([{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1.25)", opacity: 1, offset: .6 }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.3,1.4,.5,1)" });
}
// Tracker cards (tracker.ts): a person's message knows its client id and send state (a steer: sending → joined, or failed with
// Retry); a reply knows its card (the finished-turn chip, the live steps' "Activity" link, "Show in chat").
type TkMsg = RxMsg & { input_reply?: InputReply; cid?: string; state?: "sending" | "joined" | "failed"; err?: string; card?: string; reply?: Pin | (Omit<Pin, "mr"> & { mr?: number }); rid?: string; paste?: FileV };
// Copy + Reply target the text actually rendered in each bubble, including completed preambles during streaming.
const rqKey = () => { const { ch, s } = route(); return s && !isLib() && !isNb() && !isCt() && !isSch() ? `${ch.slug}|${s.id}` : ""; };
const srvId = (m: Msg): string | null => { const t = m as TkMsg; return (m.role === "user" ? t.turn : t.card || t.rid) || null; };
const msgPlain = (m: Msg) => m.role === "user" ? String(m.body || "") : dedupeProgress([...(m.pre || []), m.body].map(x => String(x ?? ""))).map(x => copyPlain(x, { cardText, scrubCode })).filter(Boolean).join("\n\n");
const msgRich = (m: Msg) => m.role === "user" ? esc(String(m.body || "")).replace(/\n/g, "<br>") : dedupeProgress([...(m.pre || []), m.body].map(x => String(x ?? ""))).map(x => { const y = (cardText(x) || scrubCode(x)).replace(/<small>[\s\S]*?<\/small>/gi, "").trim(); return y ? chatMarkdown(y) : ""; }).join("");
function msgHtml(m: Msg, ch: Channel, prev?: Msg, live = false, s?: Session, reply?: string) {
  if ((m as any).quiet && !live && !m.cards?.length) return "";   // an internal turn that ended with no reply: nothing is drawn, as after a reload
  const first = !prev || prev.role !== m.role, tm = m as TkMsg;
  MA_PARTS.set(m, new Map());
  if (m.role === "user" && (m as any).brief) return briefMsgHtml(m, ch.slug);
  if (m.role === "user") { const rx = rxHtml(m), fl = [...(m.files || []), ...(tm.paste ? [tm.paste] : [])], mf = fl.length;
    const tk = tm.state === "joined" ? `<span class="tk-note joined">${ic.check}Joined the task</span>`
      : tm.state === "failed" ? `<button type="button" class="tk-retry" data-tkretry="${m.id}"${tm.err ? ` title="${esc(tm.err)}"` : ""}>Not sent${/a lot at once/i.test(tm.err || "") ? ": that's a lot at once" : tm.err && !/^HTTP \d+$/.test(tm.err) ? `: ${esc(tm.err)}` : ""} · <u>Retry</u></button>` : "";
    return `<div class="m user${first ? " first" : ""}${rx ? " rxd" : ""}${tm.state ? ` tk-${tm.state}` : ""}" data-mr="${m.id}">${maQuote(tm.reply)}${mf ? `<div class="mfiles">${!m.body ? rx : ""}${fl.map(f => fileCard(ch, f, true)).join("")}</div>` : ""}${m.body && !tm.paste ? `<div class="bubble${maOpenCls(m.id)}">${maActs(m.id)}${rx}${esc(m.body)}</div>` : ""}${tk}${slSentNote(tm.cid)}</div>`; }
  let steps = "";   // no step list during the turn: the progress row is the only indicator
  const tkon = !!LIVE && !!s && !!tm.card && tkOn(ch.slug, s.id);
  if (tkon && !live && ["paused", "failed", "interrupted", "stopped"].includes(tkCardView(ch.slug, s!.id, tm.card)?.status || "")) steps = tkChip(ch.slug, s!.id, tm.card);
  const slot = progressSlot(m, live);
  return `<div class="m agent${first ? " first" : ""}" data-mr="${m.id}"${tkon ? ` data-card="${esc(tm.card!)}"` : ""}>
    <div class="reply-steps">${steps}</div><div class="reply-slot" data-progress-mode="${slot.mode}">${!live && !String(m.body || "").trim() && (m.cards || []).some(c => c.t === "lnrefine") ? "" : partHtml(slot.text, ch, s, m, live, reply, false, m, slot.part)}</div>${tkon && !live && tkCardView(ch.slug, s!.id, tm.card)?.status === "paused" ? pausedNote(ch.slug, s!.id, tm.card!) : ""}${live ? ctUsed(m) + nbSaved(m, ch) : ""}${chatCards(claimedOut(m, slot.text), ch, reply, m.cards || [])}</div>`;
}

document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  if (t.closest("[data-home-notes]")) { e.preventDefault(); void homeNotes(); return; }
  const c = t.closest<HTMLElement>("[data-ch]"); if (c) go(c.dataset.ch!);
  if (t.closest("[data-new]")) { e.preventDefault(); go(route().ch.slug); ($("#box") as HTMLTextAreaElement | null)?.focus(); }
  if (t.closest("[data-ntask]")) { e.preventDefault(); openNew(); }
  if (t.closest("[data-nclose]")) closeNew();
  const nw = t.closest<HTMLElement>("[data-nwho]"); if (nw) { NT.to = nw.dataset.nwho!; NT.pick = false; paintNew(); nboxSave((document.getElementById("nbox") as HTMLTextAreaElement).value); }
  if (t.closest("[data-npick]")) { NT.pick = !NT.pick; paintNew(); }
  const tv = t.closest<HTMLElement>("[data-tview]"); if (tv) { e.preventDefault(); hideToast(); mState.drawer = false; location.hash = tv.dataset.tview!; }
  if (t.closest("[data-tclose]")) hideToast();
  const cl = t.closest<HTMLElement>("[data-coll]"); if (cl) { L.coll = cl.dataset.coll!; libUpdate(); }
  const sc = t.closest<HTMLElement>("[data-scope]"); if (sc && sc.dataset.scope !== L.scope) { L.scope = sc.dataset.scope as "ch" | "all"; L.coll = "all"; L.q = ""; L.type = "all"; libUpdate(true); }
  const ty = t.closest<HTMLElement>("[data-type]"); if (ty) { L.type = ty.dataset.type!; libUpdate(); }
  const vw = t.closest<HTMLElement>("[data-view]"); if (vw) { L.view = vw.dataset.view as "list" | "grid"; libUpdate(); }
  const ol = t.closest<HTMLAnchorElement>('a[href*="/library"]'); if (ol) { e.preventDefault(); const m = ol.getAttribute("href")!.match(/c=([^&]+)/); openLib(route().ch, m ? m[1] : undefined); mState.pendingClose = true; }
});
document.addEventListener("input", e => {
  const t = e.target as HTMLElement;
  if (t.id === "q") { render(); rankSearch(route().ch.slug, (t as HTMLInputElement).value); }
  if (t.id === "lq") { L.q = (t as HTMLInputElement).value; $("#lfiles").innerHTML = libFilesHtml(); }
  if (t.id === "chq") $("#chlist").innerHTML = chRows((t as HTMLInputElement).value);
  if (t.id === "dq") { const { ch, s } = route(); $("#dlist").innerHTML = sessRows(ch, s, (t as HTMLInputElement).value); rankSearch(ch.slug, (t as HTMLInputElement).value); }
  if (t.id === "nbox") { const b = t as HTMLTextAreaElement; nboxSave(b.value); b.style.height = "auto"; b.style.height = Math.min(b.scrollHeight, 260) + "px"; ($("#ngo") as HTMLButtonElement).disabled = !b.value.trim() && !(LIVE && UP.nbox.some(u => u.f)); }
  if (t.id === "box") { const b = t as HTMLTextAreaElement; draftSet(boxKey(), b.value); b.style.height = "auto"; b.style.height = Math.min(b.scrollHeight, 220) + "px"; const has = !!b.value.trim() || !!(LIVE && UP.box.some(u => u.f)); ($("#go") as HTMLButtonElement).disabled = !has; $("#send").classList.toggle("has", has); }
});
document.addEventListener("keydown", e => {
  const t = e.target as HTMLElement;
  if (NT.open && e.key === "Escape") { e.preventDefault(); if (NT.pick) { NT.pick = false; paintNew(); } else closeNew(); return; }
  if (t.id === "nbox" && e.key === "Enter" && !e.shiftKey && !phone()) { e.preventDefault(); sendNew(); return; }
  if (t.id === "box" && e.key === "Enter" && !e.shiftKey && !phone()) { e.preventDefault(); $("#send").requestSubmit(); return; }
  if (t.id === "q" && e.key === "Escape") { (t as HTMLInputElement).value = ""; RS.clear(); t.blur(); render(); return; }
  // ⌘K, ⌘⇧L, ⌘N (now ⌘⇧O), ⌘⇧H, ⌘1-9, ⌘, ⌘/ and ⌘⇧A live in the shortcut registry (shortcuts.ts; registered below, near initSettings).
});
document.addEventListener("submit", e => {
  e.preventDefault();
  if ((e.target as HTMLElement).id === "nsend") { sendNew(); return; }
  const text = ($("#box") as HTMLTextAreaElement).value.trim();
  let { ch, s } = route();
  if (upBusy("box")) { note(ic.clock, "Still uploading", "Your files are almost there. Send again in a moment.", ""); return; }
  const sl = LIVE ? slGate("box") : "send"; if (sl === "stop") return;
  const files = LIVE ? upTake("box", ch) : []; if (!text && !files.length) return;
  draftClear(boxKey());
  const rp = s ? rqTake(rqKey()) : null;   // a reply pinned above the box (msgreply.ts) goes with this message; the bar clears
  if (rp?.role === "zone") zoneMod?.zoneSent();   // the selection was sent with it
  if (sl === "schedule") {   // send later (send-later.ts): it's kept and goes out at the picked time
    const b = $("#box") as HTMLTextAreaElement; b.value = ""; b.style.height = "auto"; ($("#go") as HTMLButtonElement).disabled = true; $("#send").classList.remove("has");
    slSchedule("box", ch.slug, s ? (s.srv ? String(s.id) : null) : "new", text, files, refOf(rp)); return;
  }
  if (!s) { // Home: the thought becomes a task and drops into the list; you stay here for the next one.
    const b = $("#box") as HTMLTextAreaElement, x = startTask(ch, text, files);
    b.value = ""; b.style.height = "auto"; ($("#go") as HTMLButtonElement).disabled = true; $("#send").classList.remove("has");
    refresh(); const h = document.getElementById("hhint");
    if (h) { h.textContent = `Started “${x.title}”. ${who(ch)} is on it.`; h.classList.add("ok"); setTimeout(() => { if (h.isConnected) { h.textContent = phone() ? "" : HINT; h.classList.remove("ok"); } }, 2600); }
    if (!phone()) b.focus(); return;
  }
  if (LIVE) { liveReply(ch, s, text, files, false, undefined, rp); return; }
  { const b = $("#box") as HTMLTextAreaElement; b.value = ""; b.style.height = "auto"; ($("#go") as HTMLButtonElement).disabled = true; $("#send").classList.remove("has"); }   // the sandbox empties the box on send, as the live reply does
  sandReply(ch, s, text, rp);
});
function sandReply(ch: Channel, s: Session, text: string, rp: Pin | null = null) {
  const at = Date.now();
  s.messages.push({ id: nextId++, role: "user", body: text, at, steps: [], ...(rp ? { reply: rp } : {}) } as TkMsg);
  const reply: Msg = { id: nextId++, role: "agent", body: "", at, steps: [] }; s.messages.push(reply);
  s.updated = at; s.status = "open"; s.done = false; s.state = "working";
  location.hash = `/${ch.slug}/s/${s.id}`; render();
  setTimeout(() => { reply.body = `On it. Check this task off whenever you're happy with it.\n\n<small>Scripted reply · design sandbox</small>`; s.state = "complete"; s.status = "resolved"; render(); }, 800);
}
// Deck styles (deck-styles.ts): a tap on a style sends the person's own words into the task, through the same path as typing them.
dsInit({ send: (slug, sid, text) => { const c = channels.find(x => x.slug === slug); if (!c) return; const s = (sid && c.sessions.find(x => String(x.id) === sid)) || route().s; if (!s) return; if (LIVE) liveReply(c, s, text, [], true); else sandReply(c, s, text); } });
dsWire();
// Cards in chat: a tap sends a normal message through the same path as typing it (the composer draft is left alone).
wireCards({
  onSend: async ({ ch, s, source_turn, input_request }: { ch: Channel; s?: Session; source_turn?: string; input_request?: InputRequest }, text: string, meta?: { action?: string; response_id?: string }) => { if (!s) return;
    const binding = replyBinding(s.srv?.pending_inputs || [], source_turn, input_request);
    const go = () => { if (LIVE) liveReply(ch, s, text, [], true, undefined, null, { ...binding, response_id: meta?.response_id || responseId(), ...(meta?.action ? { action: meta.action } : {}) }); else sandReply(ch, s, text); };
    // "Share my location" (the helper's card button): the browser's location first (inside this tap), then the tap's words.
    if (meta?.action === "share_location") { if (await dpShareNow()) go(); return; }
    go(); },
  onChange: ({ s }: { s?: Session }) => { if (s && route().s === s) paintChat(s); },
});
// Copy + Reply on the open task's bubbles, the pinned reply above its composer (msgreply.ts).
initChatCodeCopy((t, b) => note(ic.clock, t, b, ""));
maInit({ key: rqKey,
  msg: (mr, part) => { const m = route().s?.messages.find(x => x.id === mr); if (!m) return null;
    const text = part ? MA_PARTS.get(m)?.get(part) : undefined;
    if (part && text == null) return null;
    return { mr, role: m.role as Role, id: srvId(m), plain: text == null ? msgPlain(m) : copyPlain(text), html: text == null ? msgRich(m) : chatMarkdown(text) }; },
  locate: r => { const ms = route().s?.messages || []; if (r.mr && ms.some(x => x.id === r.mr)) return r.mr;
    const byId = r.id ? ms.find(x => x.role === r.role && srvId(x) === r.id) : undefined; if (byId) return byId.id;
    const q = r.text.replace(/…$/, "").slice(0, 60); const byText = q ? ms.find(x => x.role === r.role && excerpt(msgPlain(x)).startsWith(q)) : undefined; return byText ? byText.id : null; },
  who: role => role === "user" ? "You" : who(route().ch),
  repaint: () => { const { s } = route(); if (s) paintChat(s); },
  note: (t, b) => note(ic.clock, t, b, "") });
window.addEventListener("hashchange", () => { const s = route().s; if (LIVE && s && !s.loaded) s.loadFailAt = 0; });   // opening a task again tries its load again, even right after a failure
window.addEventListener("hashchange", render);
matchMedia("(max-width: 767px)").addEventListener("change", render);


// ---------- Phone: Muse-style chat with a tasks drawer; channels switch from a sheet (no channel-list page) ----------
const mState = { drawer: false, sheet: "", pendingClose: false, last: "", tools: "" };
const isHome = () => !/^#\/[^/]+/.test(location.hash);
const who = (c: Channel) => AGENT[c.slug] ?? c.name;
const latest = (c: Channel) => c.sessions.reduce<Session | null>((a, x) => !a || x.updated > a.updated ? x : a, null);
function plain(m: string) { const d = document.createElement("div"); d.innerHTML = md(cardText(m) || plainPreview(m)); d.querySelectorAll("small,table").forEach(x => x.remove()); return (d.textContent || "").replace(/\s+/g, " ").trim(); }
function day(t: number) {
  const d = new Date(t), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return clock(t);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  if (n.getTime() - t < 6 * 864e5) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// The channel sheet (phone): every channel with its latest line; the open one is checked. Tap one to switch (the drawer stays open).
const chTile = (c: Channel) => c.slug === "main" ? av(c) : mono(c);
function chRows(q: string) {
  const ql = q.trim().toLowerCase(), cur = route().ch;
  const list = channels.filter(c => !ql || c.name.toLowerCase().includes(ql) || who(c).toLowerCase().includes(ql) || c.sessions.some(x => x.title.toLowerCase().includes(ql)));
  return list.map(c => {
    const last = latest(c), m = last?.messages.filter(x => x.body).at(-1);
    const prev = LIVE ? (plainPreview(last?.srv?.preview || "") || c.purpose) : m ? (m.role === "user" ? "You: " : "") + plain(m.body) : c.purpose;
    return `<a class="chr${c === cur ? " on" : ""}" href="#/${c.slug}" data-mch>${c.sessions.some(rowLit) ? `<i class="udot"></i>` : ""}<span class="chtile">${chTile(c)}</span>
      <span class="ctext"><span class="ctop"><b>${esc(c.name)}</b><span>${c === cur ? ic.check : last ? day(last.updated) : ""}</span></span><span class="cprev">${esc(prev || "")}</span></span></a>`;
  }).join("") || `<div class="mempty">Nothing matches “${esc(q)}”.</div>`;
}
function sessRows(ch: Channel, s: Session | null, q: string) {
  const ql = q.trim().toLowerCase(), ranked = LIVE ? RS.ranked(ch.slug, q) : null;
  const list = ranked ? rankedRows(ch.sessions, ranked) : [...ch.sessions].sort((a, b) => b.updated - a.updated).filter(x => !ql || x.title.toLowerCase().includes(ql) || x.messages.some(m => m.body.toLowerCase().includes(ql)));
  const one = (x: Session) => { const sr = secRow(ch.slug, x, false); return `<a class="ds${x === s ? " on" : ""}${x.done ? " isdone" : ""}${sr.c}" href="#/${ch.slug}/s/${x.id}" data-mgo>${box(x)}<span>${esc(x.title)}</span>${rowStop(ch.slug, x.id, x.title, stWorking(x))}${pinBtn(x)}${LIVE && x.srv ? rowMore(ch.slug, x.id, x.title) : ""}${rowTail(x, false)}</a>`; };
  // The same sections as the desktop side panel (sideList): Pinned, Texts, the task-state sections, Done, each folding with its caret. Same fold keys,
  // so a section folded here is folded there too (in this browser). Searching opens every section.
  const group = (key: string, label: string, items: Session[], nc = false) => { if (!items.length) return ""; const shut = !ql && folded(ch, `side-${key}`);
    return `${foldHead("dsub", `side-${key}`, label, nc ? 0 : items.length, shut, !!ql)}${shut ? "" : items.map(one).join("")}`; };
  const rest = list.filter(x => !x.pinned);
  if (ranked) return list.length ? list.map(one).join("") : `<div class="mempty">No tasks match.</div>`;   // one flat list, most likely first
  if (csOn(ch)) return secList(ch.slug, list, { row: one, head: (k, l, n, shut, srch) => foldHead("dsub", `side-${k}`, l, n, shut, srch), shut: k => folded(ch, `side-${k}`), searching: !!ql, empty: `<div class="mempty">No tasks match.</div>` }) + secPlus(ch.slug, !!ql);
  return list.length ? `${secPlus(ch.slug, !!ql)}${group("pinned", `${ic.pin}Pinned`, list.filter(x => x.pinned))}${group("texts", "Texts", rest.filter(x => !x.done && isTexts(x)))}${stateGroups(rest, group)}${group("done", "Done", rest.filter(x => x.done).sort(byDone))}` : `<div class="mempty">${ql ? "No tasks match." : "No tasks yet."}</div>`;
}
function renderM() { keepPaneFloats(() => keepDraft(renderPhone)); }
function renderPhone() {
  zoneGuard();
  requestAnimationFrame(nbBeePaint);
  const m = $("#m");
  // No channel-list page on phone: "#/" opens the last channel (its drawer header switches channels).
  if (isHome()) history.replaceState(null, "", `#/${channels.some(c => c.slug === mState.last) ? mState.last : main.slug}`);
  const { ch, s } = route(); mState.last = ch.slug;
  const other = ch.sessions.some(x => x !== s && rowLit(x)), elsewhere = channels.some(c => c !== ch && c.sessions.some(rowLit));
  const head = `<header class="mh"><button class="cb" data-mdrawer aria-label="Tasks and channels" aria-controls="mobile-tasks" aria-expanded="${mState.drawer}">${ic.menu}${other || elsewhere ? `<i class="udot"></i>` : ""}</button>
    ${s && canRename(s) ? `<div class="mpill task-pill"><button class="task-about" data-msheet="about" aria-label="About ${esc(ch.name)}" title="About ${esc(ch.name)}">${av(ch, "av sm")}</button><button class="task-title" data-rename="${esc(ch.slug)}|${esc(s.id)}" aria-label="Rename task" title="Rename task"><span data-task-title>${esc(s.title)}</span></button></div>` : `<button class="mpill" data-msheet="about">${isSch() ? `<span class="pico">${ic.clock}</span>` : isLib() ? `<span class="pico">${ic.lib}</span>` : isCt() ? `<span class="pico">${ic.people}</span>` : isNb() ? `<span class="pico">${ic.nb}</span>` : av(ch, "av sm")}<span>${esc(isSch() ? "Scheduled" : isCt() ? (ctSel() ? ctSel()!.name : "Contacts") : isNb() ? `${who(ch)}'s notebook` : isLib() ? `${ch.name} Library` : s ? s.title : `${ch.name} Home`)}</span></button>`}<span class="grow"></span>${LIVE ? pomoGlobalBtn(true) : ""}${LIVE && s ? `<span class="mo" data-mo="3">${hasFeature("ambient") ? lnBtn(ch.slug, s.id, true) : ""}${pomoBtn(ch.slug, s.id, true)}</span><span class="mo" data-mo="5">${todoBtn(ch.slug, s.id, true)}</span><span class="mo" data-mo="4">${tkBtn(ch.slug, s.id, true)}</span>` : ""}${LIVE ? `<span class="mo" data-mo="2"><button class="cb${ch.sessions.some(x => x.state === "working") ? " busy" : ""}" data-watch="${esc(ch.slug)}" aria-label="Open ${esc(who(ch))}'s computer">${ic.screen}</button></span>` : ""}${s && stWorking(s) ? `<button class="cb mstop" data-stop="${esc(ch.slug)}|${esc(s.id)}" aria-label="Stop this task" title="Stop">${SQ}</button>` : ""}${s ? `<span class="mo" data-mo="4"><button class="cb mdone${s.done ? " on" : ""}" data-done="${s.id}" aria-label="${s.done ? "Reopen" : "Mark done"}">${box(s).replace(/ data-done="[^"]+"/, "").replace('role="checkbox" tabindex="0"', 'aria-hidden="true"')}</button></span>` : ""}<span class="mo" data-mo="1"><button class="cb" data-ntask aria-label="New task">${ic.newS}</button></span><button class="cb mmore" data-mmore aria-label="More actions" aria-haspopup="dialog" hidden>${MORE}</button></header>`;
  if (s) { if (LIVE && s.unread) livePatch(ch, s, { seen: true }); s.unread = false; if (LIVE) openLoad(ch, s); }
  if (isNb() && !s) { nbSync(ch); void nbpLoad(ch); }
  const chat = isSch() ? `${head}${schPage(ch.slug).replace('class="dhome" id="scroll"', 'class="scroll" id="scroll"')}` : isCt() ? `${head}${ctPage().replace('class="dhome" id="scroll"', 'class="scroll" id="scroll"')}` : isNb() ? `${head}${nbPage(ch).replace('class="dhome" id="scroll"', 'class="scroll" id="scroll"')}` : isLib() ? `${head}${libPage(ch).replace('class="dhome" id="scroll"', 'class="scroll" id="scroll"')}` : s
    ? LIVE && ivIs(ch.slug, s.id) ? `${head}${ivView()}` : `${head}${liveNotesWrap(ch.slug, s.id, `<div class="scroll" id="scroll"><div class="msgs">${msgsHtml(s, ch)}</div></div><div class="dock">${composer(`Message ${esc(who(ch))}`)}</div>`)}`
    : `${head}<div class="scroll" id="scroll"><div class="mhome"><div id="mhead">${homeHead(ch)}</div><div id="mtasks">${tasksHtml(ch)}</div></div></div>
      <div class="dock"><p class="hhint" id="hhint"></p>${composer(`Give ${esc(who(ch))} a task`)}</div>`;
  document.title = isSch() ? "Scheduled · 1Helm" : isCt() ? "Contacts · 1Helm" : isNb() ? `${who(ch)}'s notebook · 1Helm` : isLib() ? `${ch.name} Library · 1Helm` : s ? `${s.title} · ${ch.name} · 1Helm` : `${ch.name} Home · 1Helm`;
  m.innerHTML = `<div class="cv${mState.drawer ? " open" : ""}">
    <aside class="dm" id="mobile-tasks" aria-label="Tasks and channels" ${mState.drawer ? "" : "inert"}><div class="dtop"><button class="dchsw" data-mchsw aria-haspopup="dialog" aria-label="${esc(ch.name)}. Switch channel">${chTile(ch)}<b>${esc(ch.name)}</b>${channels.length > 1 ? `<span class="dcaret">${ic.down}</span>` : ""}${elsewhere ? `<i class="udot"></i>` : ""}</button>${channels.length > 1 ? "" : `<button class="cb dadd" data-newch aria-label="New channel">${ic.plus}</button>`}<button class="cb dadd" data-mclose aria-label="Close tasks and channels">${g("x", 20)}</button></div>
      <nav class="dnav" aria-label="${esc(ch.name)}">${dTile(`#/${ch.slug}`, !s && !isLib() && !isNb() && !isCt() && !isSch(), ic.home, "Home")}${dTile(`#/${ch.slug}/library`, isLib(), ic.lib, "Library")}${dTile(`#/${ch.slug}/notebook`, isNb(), ic.nb, "Notebook")}${dTile(`#/${ch.slug}/contacts`, isCt(), ic.people, "Contacts")}${dTile(`#/${ch.slug}/scheduled`, isSch(), ic.clock, "Scheduled")}</nav>
      <div id="dlist" class="dl">${sessRows(ch, s, "")}</div>
      <div class="dbar"><button class="cb" data-mset aria-label="Settings" aria-haspopup="dialog">${g("gear", 20)}</button><label class="spill">${ic.search}<input id="dq" placeholder="Search" autocomplete="off" enterkeyhint="search"></label><button class="cb" data-ntask aria-label="New task">${ic.newS}</button></div></aside>
    <section class="chat">${chat}<div class="shade" data-mclose></div></section></div>`;
  const sc = document.getElementById("scroll"); if (sc && s) sc.scrollTop = sc.scrollHeight;
  if (isCt()) clMount();
  if (LIVE && s) { tkSync(ch.slug, s.id); pomoSync(ch.slug, s.id); if (hasFeature("ambient")) lnSync(ch.slug, s.id); }
  clearFresh(ch);
  stNow();
  bindDrawerGesture(m.querySelector<HTMLElement>(".cv")!);
  if (mState.pendingClose) { mState.pendingClose = false; requestAnimationFrame(() => requestAnimationFrame(() => setDrawer(false))); }
}
function setDrawer(open: boolean) {
  mState.drawer = open;
  const cv = document.querySelector<HTMLElement>("#m .cv"); if (!cv) return;
  cv.classList.toggle("open", open);
  const drawer = cv.querySelector<HTMLElement>(".dm"); if (drawer) drawer.inert = !open;
  cv.querySelector("[data-mdrawer]")?.setAttribute("aria-expanded", String(open));
}
function bindDrawerGesture(cv: HTMLElement) {
  bindTouchSwipe(cv, (target, touch) => {
    const open = mState.drawer, chat = cv.querySelector<HTMLElement>(".chat")!;
    // Main content can reveal the task drawer; preserve the browser's outer edge and composer.
    if (touch.clientX < 24 || gestureValueControl(target) || scrollerOwns(target, cv, "x")) return null;
    if (!open && target.closest(".dock")) return null;
    const width = chat.clientWidth * (innerWidth < 360 ? 0.90 : 0.86);
    return { axis: "x", direction: open ? -1 : 1, distance: Math.min(120, width * 0.3),
      valid: () => mState.drawer === open,
      move: dx => { cv.classList.add("dragging"); cv.style.setProperty("--drawer-progress", String(Math.max(0, Math.min(1, (open ? 1 : 0) + (open ? -dx : dx) / width)))); },
      finish: commit => { cv.classList.remove("dragging"); cv.style.removeProperty("--drawer-progress"); if (commit) setDrawer(!open); } };
  });
}
// One drawer tile: icon over a small label (no item counts: the Captain wants labels and icons only). Library/Notebook/Contacts/Scheduled were full-width rows before.
function dTile(href: string, on: boolean, icon: string, label: string) {
  return `<a class="dt${on ? " on" : ""}" href="${href}" data-mgo${on ? ' aria-current="page"' : ""}><span class="dti">${icon}</span><span class="dtl">${label}</span></a>`;
}
// Native disclosure keeps every task tool in one predictable place. Remember its
// state across background header repaints, but never carry it to another task.
function closeMobileTools(focus = false) {
  const details = document.querySelector<HTMLDetailsElement>("[data-mtools]");
  mState.tools = "";
  if (!details?.open) return;
  details.open = false;
  if (focus) details.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
}
document.addEventListener("toggle", e => {
  const d = e.target as HTMLDetailsElement;
  if (d.matches?.("[data-mtools]") && d.isConnected) mState.tools = d.open ? d.dataset.toolsKey! : "";
}, true);
document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  if (!t.closest("[data-mtools]") || t.closest(".mtools-panel button")) closeMobileTools();
}, true);
window.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.querySelector("[data-mtools][open]")) { e.preventDefault(); e.stopImmediatePropagation(); closeMobileTools(true); }
}, true);
window.addEventListener("hashchange", () => closeMobileTools());
function sheetHtml(kind: string) {
  // About this channel: who it is, what it's for, its notebook and schedule, and (live) deleting. Opened from the task header's title
  // and from the channel sheet. The three-note "remembers" preview is gone: the Notebook row says how much there is and opens it.
  if (kind === "about") {
    const { ch, s } = route();
    // The header's title pill can ellipsize a long task title on a phone: its full title is here.
    return `<div class="about">${av(ch, "av xl")}<h2>${esc(who(ch))}</h2><p class="sub">${esc(ch.name)}</p>${ch.purpose ? `<p class="purp">${esc(ch.purpose)}</p>` : ""}</div>
      ${s ? `<div class="sgroup"><div class="srow atask"><span><small>This task</small>${esc(s.title)}</span></div></div>` : ""}
      <div class="sgroup"><a class="srow nav" href="#/${ch.slug}/notebook" data-sclose data-mgo>${ic.nb}<span>Notebook<small>What ${esc(who(ch))} remembers here</small></span>${ic.chev}</a><a class="srow nav" href="#/${ch.slug}/scheduled" data-sclose data-mgo>${ic.clock}<span>Scheduled<small>Repeats, follow-ups, send later</small></span>${ic.chev}</a></div>${LIVE ? ((r) => r ? `<div class="sh"></div><div class="sgroup">${r}</div>` : "")(sheetRows(ch.slug, route().s?.srv ? route().s!.id : null)) : ""}`;
  }
  // Channels: switch, see what's new in each, start a new one. Replaces the phone's old channel-list page.
  if (kind === "chs") {
    const { ch } = route();
    return `<div class="shead"><h2 class="stitle">Channels</h2><button class="txtbtn" data-msheet="about">About ${esc(ch.name)}</button></div>
      ${channels.length > 6 ? `<label class="spill chq">${ic.search}<input id="chq" placeholder="Find a channel" autocomplete="off" enterkeyhint="search"></label>` : ""}
      <div class="sgroup chlist" id="chlist">${chRows("")}</div>
      <div class="sgroup"><button class="srow nav" data-newch>${ic.plus}<span>New channel</span></button></div>`;
  }
  // Settings (the drawer's bottom-left button): the same things as the desktop account menu, as a sheet.
  if (kind === "set") {
    const ml = hasFeature("billing") ? monthLine(LIVE ? BOOT?.account?.month : { pct: 12, used: "$2.40", allowance: "$20.00" }, Math.max(0, Math.min(100, Number(BOOT?.account?.usagePercent || 0)))) : { pct: 0, text: "" };
    const plan = LIVE ? String(BOOT?.account?.plan || "Plus") : "Plus";
    return `<button class="sacct" data-sgo="account"><span class="sme">${esc(INITIALS)}</span><span class="srt"><b>${esc(PERSON)}</b><span>${esc(EMAIL)}</span></span>${ic.chev}</button>
      <div class="sgroup"><button class="srow nav" data-sgo="">${g("gear")}<span>Settings</span>${ic.chev}</button>
        ${hasFeature("billing") ? `<button class="srow nav suse" data-sgo="">${g("wallet")}<span>${esc(plan)} plan<small>${ml.pct}% of this month's AI used</small><i class="mbar"><i style="width:${ml.pct}%"></i></i></span>${ic.chev}</button>` : `<button class="srow nav suse" data-sgo="general">${g("key")}<span>Your own AI key</span>${ic.chev}</button>`}
        ${hasFeature("connected_apps") ? `<button class="srow nav" data-apps>${ic.apps}<span>Apps</span>${ic.chev}</button>` : ""}
        <div class="srow">${g("sun")}<span>Appearance</span><span class="seg mseg" role="radiogroup" aria-label="Appearance">${[["light", "sun", "Light"], ["dark", "moon", "Dark"], ["system", "mon", "Match my device"]].map(([k, i, l]) => `<button class="${S.theme === k ? "on" : ""}" role="radio" aria-checked="${S.theme === k}" data-mtheme="${k}" aria-label="${l}">${g(i, 16)}</button>`).join("")}</span></div></div>
      <div class="sgroup"><button class="srow nav" data-sgo="help">${g("help")}<span>Help & support</span>${ic.chev}</button>
        <button class="srow nav" data-rpopen>${g("bug")}<span>Report an issue</span>${ic.chev}</button>
        ${piKind() ? `<button class="srow nav" data-pwainst>${I(PI_ICON, 20)}<span>Install 1Helm app<small>${esc(piSub(piKind(), true))}</small></span>${ic.chev}</button>` : ""}
        ${touchy() ? "" : `<button class="srow nav" data-sgo="shortcuts">${g("kbd")}<span>Keyboard shortcuts</span>${ic.chev}</button>`}</div>
      <div class="sgroup"><button class="srow" data-snote="logout">${g("out")}<span class="red">Log out</span></button></div>`;
  }
  return "";
}
function openSheet(kind: string) {
  mState.sheet = kind; const w = $("#sheet");
  w.innerHTML = `<div class="backdrop" data-sclose></div><div class="sheet" role="dialog"><button type="button" class="grab" data-sclose aria-label="Close panel"></button>${sheetHtml(kind)}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add("on")));
  dragToClose(w.querySelector<HTMLElement>(".sheet")!);
  nbBeePaint();
}
// Shared by the Library picker, Send later, To-dos, Focus timer and Activity sheets.
function dragToClose(el: HTMLElement, close: () => void = closeSheet) {
  bindSheetDismiss(el, () => guarded(close));
}
function closeSheet() { const w = $("#sheet"); w.classList.remove("on"); mState.sheet = ""; setTimeout(() => { if (!mState.sheet) w.innerHTML = ""; }, 320); }
// New channel (newchannel.ts): name + what it's for, on the person's one helper. Live creates it through the API; the sandbox mocks it.
function addChannel(c: { id: number; slug: string; name?: string; purpose?: string }): Channel {
  let ch = channels.find(x => x.slug === c.slug);
  if (!ch) { ch = { id: c.id, slug: c.slug, name: LIVE ? liveName(c) : c.name || c.slug, purpose: c.purpose || "", memory: [], notes: [], jobs: [], sessions: [] }; channels.push(ch); }
  AV[ch.slug] = AV[main.slug]; AGENT[ch.slug] = AGENT[main.slug];
  return ch;
}
function newChannel() {
  if (mState.sheet) closeSheet();
  openNewChannel({ helper: { name: who(main), avatar: AV[main.slug] ?? 8 },
    create: LIVE ? (name, purpose) => createViaApi(LIVE.api, name, purpose) : async (name, purpose): Promise<NewChannel> => {
      const dup = channels.find(c => c.name.trim().toLowerCase() === name.toLowerCase());
      if (dup) throw Object.assign(new Error(`You already have a channel called “${dup.name}”.`), { code: "duplicate" });
      let slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
      for (let i = 2, b = slug; channels.some(c => c.slug === slug); i++) slug = `${b}-${i}`;
      return { id: nextId++, slug, name, purpose };
    },
    done: (c) => { addChannel(c); mState.drawer = false; go(c.slug); } });
}
document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  // Touch tablets: Search is a tile; tapping it shows the search box above the task list (it hides again when empty and left).
  if (t.closest("[data-sidesrch]")) { const sd = $("#side"); sd.classList.add("sopen"); ($("#q") as HTMLInputElement).focus(); }
  const sh = t.closest<HTMLElement>("[data-msheet]"); if (sh) openSheet(sh.dataset.msheet!);
  if (t.closest("[data-mchsw]")) openSheet("chs");
  if (t.closest("[data-mset]")) openSheet("set");
  if (t.closest("#sheet [data-mch], #sheet [data-sgo], #sheet [data-apps], #sheet [data-snote]")) closeSheet();
  const mt = t.closest<HTMLElement>("[data-mtheme]"); if (mt) { S.theme = mt.dataset.mtheme!; try { localStorage.setItem("v3theme", S.theme); } catch {} applyTheme(); mt.parentElement!.querySelectorAll<HTMLElement>("[data-mtheme]").forEach(x => { x.classList.toggle("on", x === mt); x.setAttribute("aria-checked", String(x === mt)); }); }
  if (t.closest("[data-sclose]")) closeSheet();
  if (t.closest("[data-mdrawer]")) setDrawer(true);
  if (t.closest("[data-mclose]")) setDrawer(false);
  if (t.closest("[data-mnew]")) { mState.pendingClose = true; location.hash = `/${route().ch.slug}`; }
  if (t.closest("[data-mgo]")) { mState.pendingClose = true; if (t.closest<HTMLAnchorElement>("a")!.getAttribute("href") === location.hash) { e.preventDefault(); renderM(); } }
  if (t.closest("[data-newch]")) { e.preventDefault(); newChannel(); }
});


// ---------- Settings: menu button → popover (Muse) → two-pane modal (Town/Muse); phone = full-screen list → detail ----------
const BRAND: Record<string, [string, string]> = {"gmail": ["M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z", "#EA4335"], "googlecalendar": ["M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z", "#4285F4"], "googledrive": ["M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z", "#1FA463"], "google": ["M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z", "#4285F4"], "notion": ["M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z", "currentColor"], "youtube": ["M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z", "#FF0000"], "dropbox": ["M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z", "#0061FF"], "slack": ["M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z", "#4A154B"], "imessage": ["M5.285 0A5.273 5.273 0 0 0 0 5.285v13.43A5.273 5.273 0 0 0 5.285 24h13.43A5.273 5.273 0 0 0 24 18.715V5.285A5.273 5.273 0 0 0 18.715 0ZM12 4.154a8.809 7.337 0 0 1 8.809 7.338A8.809 7.337 0 0 1 12 18.828a8.809 7.337 0 0 1-2.492-.303A8.656 7.337 0 0 1 5.93 19.93a9.929 7.337 0 0 0 1.54-2.155 8.809 7.337 0 0 1-4.279-6.283A8.809 7.337 0 0 1 12 4.154", "#34C759"], "whatsapp": ["M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z", "#25D366"], "stripe": ["M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z", "#635BFF"]};
const G: Record<string, string> = {
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="14" rx="1.5"/><rect width="7" height="7" x="3" y="14" rx="1.5"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  wave: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  legal: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  out: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  kbd: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  dl: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  mon: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  ext: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  spark: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  imp: '<path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/>',
};
const g = (k: string, s = 17) => I(G[k], s);
G.loc = DP_ICON.loc;   // Settings → Location & mic
const brand = (k: string) => { const [d, c] = BRAND[k]; return `<span class="bico"><svg viewBox="0 0 24 24" width="20" height="20" fill="${c}" aria-hidden="true"><path d="${d}"/></svg></span>`; };
const APP: Record<string, [string, string]> = {
  gmail: ["Gmail", "Read, sort and draft your email"], googlecalendar: ["Google Calendar", "See your schedule and add events"], googledrive: ["Google Drive", "Find and create documents"],
  notion: ["Notion", "Read and update your pages"], slack: ["Slack", "Read and send messages"], dropbox: ["Dropbox", "Find and save files"], youtube: ["YouTube", "Your channel, videos and comments"],
};
const S = {
  open: false, sec: "general", menu: false, theme: localStorage.getItem("v3theme") || "system", eye: false, adding: false,
  conn: { gmail: !LIVE, googlecalendar: !LIVE, googledrive: false, notion: false, slack: false, dropbox: false, youtube: false } as Record<string, boolean>,
  link: false, perm: { apps: "some", web: "some" } as Record<string, string>,
  sw: { text: !LIVE, quiet: true, needs: true, finished: true, sound: true } as Record<string, boolean>,
  logins: LIVE ? [] : [{ site: "costco.com", user: "you@example.com" }, { site: "delta.com", user: "joseph.yaksich" }],
  keys: LIVE ? [] : [{ name: "OPENWEATHER_KEY", host: "api.openweathermap.org" }],
  allowed: LIVE ? [] : [{ site: "delta.com", where: "Japan trip" }, { site: "weather.gov", where: "every channel" }],
};
const TX: { loaded: boolean; st: any } = { loaded: false, st: null };
// Wallet (live): Link by Stripe, connected like pairing a TV: Link shows a phrase, the person confirms it in the Link app.
const LK: { loaded: boolean; st: any; busy: boolean; poll: number } = { loaded: false, st: null, busy: false, poll: 0 };
function loadLink() { if (!LIVE) return; LK.loaded = true; fetch(`${LIVE.api}/link/status`, { credentials: "same-origin" }).then(r => r.json()).then(d => {
  LK.st = d; if (d.pending && !LK.poll) LK.poll = window.setInterval(loadLink, 5000); if (!d.pending && LK.poll) { clearInterval(LK.poll); LK.poll = 0; }
  if (d.just_connected) note(ic.check, "Link added", "You'll approve every purchase in the Link app.", "");
  if (S.open && S.sec === "wallet") sRender(); }).catch(() => { if (!LK.st) LK.loaded = false; }); }
// Purchases list: when a purchase was asked for. Today shows the time and an earlier day shows the date, to keep each row short; the row's title attribute has both.
function purchaseWhen(t: number, full = false) {
  const d = new Date(t); if (isNaN(+d)) return "";
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return full ? `${day}, ${time}` : d.toDateString() === new Date().toDateString() ? time : day;
}
function walletHtml() {
  if (!LK.loaded) loadLink();
  const st = LK.st || {}, money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const row = st.connected ? srow(brand("stripe"), "Link by Stripe", `${esc(st.email || "Connected")} · You approve each purchase`, `${ok("Added")}${sa(LK.busy ? "Removing…" : "Remove", "data-lkoff", "mute")}`)
    : st.pending ? srow(brand("stripe"), "Finish in Link", `Open Link and confirm the code <b class="lkcode">${esc(st.phrase || "")}</b>`, `<a class="sa blue" href="${esc(st.url || "#")}" target="_blank" rel="noopener">Open Link</a>`)
    : srow(brand("stripe"), "Link by Stripe", st.error ? esc(st.error) : st.expired ? "That code expired. Start again." : !LK.st ? "Checking…" : "Pay with the cards you've saved in Link", sa(LK.busy ? "Opening…" : "Add", "data-lkon", "blue"));
  const ps = (st.purchases || []) as any[];
  return `${row}</div>${st.connected ? `<h3>Purchases</h3><div class="sc">${ps.length ? ps.map(p => srow(`<span class="favi">${esc(((p.merchant_name || "?")[0] || "?").toUpperCase())}${logoOver(p.merchant_url || "", 38)}</span>`, esc(p.merchant_name || "Purchase"), `${money(p.amount)} · ${esc(p.outcome?.text || "Ask your helper what happened")}${p.test ? " · test" : ""} · ${esc(purchaseWhen(p.created_at))}`, "", ` title="${esc(purchaseWhen(p.created_at, true))}"`)).join("") : srow("", "Nothing bought yet", `Purchases ${esc(who(main))} makes will show up here.`, "")}</div>` : ""}<div>`;
}
// Official store destinations: https://link.com/download. Notifications and approvals belong to Link.
function linkAppHtml() {
  return `<h3>Link on your phone</h3><div class="sc lkapp"><p>Get push notifications for agent purchase requests, approve or decline them, and manage your saved payment methods in the Link app. Allow notifications when prompted to receive alerts.</p><div class="lkdownloads"><a class="sa" href="https://apps.apple.com/app/link-a-smarter-way-to-pay/id1623228342" target="_blank" rel="noopener noreferrer">Download for iOS</a><a class="sa" href="https://play.google.com/store/apps/details?id=com.stripe.link.android" target="_blank" rel="noopener noreferrer">Download for Android</a></div></div>`;
}
// Add credits (live): $10 / $25 / $50 on the card already on file; falls back to Stripe Checkout if that card can't be charged.
const CR: { open: boolean; busy: number; pick: number; info: { card: { brand: string; last4: string } | null; confirm: string } | null } = { open: false, busy: 0, pick: 0, info: null };
const CARD_BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };
function crAsk(): string {   // the line under the amounts: the charge question once the person has tapped one, else the usual note
  const i = CR.info; if (!CR.pick || !i) return "Charged to the card on your plan.";
  return i.card ? `Charge $${CR.pick} to ${esc(CARD_BRANDS[i.card.brand] || "your card")} ending ${esc(i.card.last4)}?` : `No saved card. A payment page opens for $${CR.pick}.`;
}
// A payment's credits are added by the payment webhook, which can land after the page's answer. Ask for the account numbers every
// 2 seconds, at most 12 times, until the balance changes, then repaint the usage bar and rows. Stops early if the page can't reach the server.
async function creditsRefresh() {
  if (!LIVE || !BOOT) return;
  const num = (v: any) => Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0, before = num(BOOT.account?.balance);
  for (let i = 0; i < 12; i++) {
    await new Promise(z => setTimeout(z, i ? 2000 : 1500));
    const d = await api(`/app/boot?light=1`, undefined, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!d?.account) continue;
    const changed = num(d.account.balance) > before;   // a turn spending meanwhile only lowers it; the top-up raises it
    BOOT.account = d.account;
    if (changed) {
      if (S.open) sRender();
      if (mState.sheet === "set") { const sh = document.querySelector<HTMLElement>("#sheet .sheet"); const fresh = new DOMParser().parseFromString(`<div>${sheetHtml("set")}</div>`, "text/html").querySelector(".suse"), old = sh?.querySelector(".suse"); if (fresh && old) old.replaceWith(fresh); }
      return;
    }
  }
}
// Connected apps (live): ONE store for Settings → Connected accounts and the Apps popup. Last known list is cached per workspace
// (localStorage) and drawn at once; GET /api/apps refreshes it quietly at boot, on open, and after a sign-in. Rows are Composio's own data.
// Several accounts per app (two Gmails…): each has a label (its email/username, else "Account 2") and one per app is the default.
type Acct = { id: string; app: string; name: string; logo: string; status: string; email: string; label?: string; default?: boolean; since: string; retired?: boolean; note?: string; memo?: string };   // note: the retired-app notice; memo: their note for the helper (acct-note.ts)
const acLabel = (a: Acct) => a.label || a.email || a.name;
const CXK = `1hc-cx-${LIVE?.slug || ""}`;
const CX: { list: Acct[] | null; busy: string; at: number; err: string; loading: boolean } = { list: (() => { try { return LIVE ? JSON.parse(localStorage.getItem(CXK) || "null") : null; } catch { return null; } })(), busy: "", at: 0, err: "", loading: false };
const GG = { get busy() { return !!CX.busy; } };   // older callers
function cxSet(list: Acct[] | null) {
  if (!Array.isArray(list)) return; const was = JSON.stringify(CX.list); CX.list = list; CX.at = Date.now();
  try { localStorage.setItem(CXK, JSON.stringify(list)); } catch {}
  logoWarm(list); syncCon(); if (was !== JSON.stringify(list)) { if (S.open && S.sec === "accounts") sRender(); appsRefresh(); }
}
// The list never spins forever (Captain, 10-07): 30 s at most, and any error or timeout becomes a plain message with Try again
// (accountsHtml). After an error it waits for Try again instead of asking again on every repaint.
const CX_WAIT = 30000;   // the server gives a slow Composio list one retry (10 s each), so wait a little longer than that
const cxReason = (m: string) => String(m || "").replace(/\s*Try again(?: in a minute)?\.?\s*$/i, "").replace(/\.$/, "").trim();
function cxLoad(force = false) {
  if (!LIVE || CX.loading || (!force && (CX.err || Date.now() - CX.at < 15000))) return;
  CX.at = Date.now(); CX.loading = true;
  const paint = () => { if (S.open && S.sec === "accounts") sRender(); };
  const fail = (why: string) => { CX.loading = false; CX.err = why || "Something went wrong on our side"; paint(); };
  withRetries(signal => fetch(`${LIVE.api}/apps${force ? "?fresh=1" : ""}`, { credentials: "same-origin", signal }).then(r => r.json()), { tries: 2, timeoutMs: CX_WAIT })   // a timeout while the page was hidden or frozen is not counted (task-load.ts)
    .then(d => { cmSet(d); if (!Array.isArray(d?.accounts)) return fail(cxReason(d?.error)); CX.loading = false; CX.err = ""; cxSet(d.accounts); paint(); })
    .catch(e => fail(/timeout|abort/i.test(`${e?.name} ${e?.message}`) ? "It took too long to answer" : "Couldn't reach 1Helm"));
}
function cxErrRow() {
  return srow(`<span class="bico">${g("help", 18)}</span>`, `Couldn't load your ${cmMode() === "self" ? "Composio " : ""}apps`, `${esc(CX.err)}.`, sa("Try again", "data-cxretry", "blue"), " data-cxerr");
}
// Self-managed (apps-mode.ts): Composio's own page opens in a new tab and can't send the person back, so the connect waits here and the
// list is checked again when they come back to this tab. An offer card's connect then goes through /apps/done like a Managed one does.
// known: the app's connected account ids when they tapped Add another (another account), so only a NEW one counts as done.
const CXPEND: { app: string; label: string; offer: { ch: string; id: number } | null; at: number; known: string[] | null } = { app: "", label: "", offer: null, at: 0, known: null };
const wsBase = () => (LIVE?.api || "").replace(/\/api$/, "");
const offerDone = (app: string, offer: { ch: string; id: number }) => `${wsBase()}/apps/done?app=${encodeURIComponent(app)}&from=offer&ch=${encodeURIComponent(offer.ch)}&oid=${offer.id}`;
// Coming back to the tab fires both "visibilitychange" and "focus", and every check lists the person's Composio accounts, so one check
// runs at a time and at most one every 5 s (composio-ratelimit: Composio's request limit is per organization, per minute).
let cxPendBusy = false, cxPendLast = 0;
function cxPendCheck() {
  if (!LIVE || !CXPEND.app || document.hidden || cxPendBusy) return;
  if (Date.now() - CXPEND.at > 20 * 60e3) { CXPEND.app = ""; return; }
  if (Date.now() - cxPendLast < 5000) return;
  cxPendBusy = true; cxPendLast = Date.now();
  fetch(`${LIVE.api}/apps?fresh=1`, { credentials: "same-origin" }).then(r => r.json()).then(d => {
    cmSet(d); cxSet(d.accounts); const p = { ...CXPEND }; if (!p.app) return;
    const a = (d.accounts || []).find((x: Acct) => x.app === p.app && x.status === "connected" && !(p.known || []).includes(x.id)); if (!a) return;
    CXPEND.app = "";
    if (p.offer) { location.assign(offerDone(p.app, p.offer)); return; }
    note(ic.check, `${a.name || p.label || p.app} connected`, `${who(main)} can use it now. Just ask.`, "");
  }).catch(() => {}).finally(() => { cxPendBusy = false; cxPendLast = Date.now(); });
}
document.addEventListener("visibilitychange", cxPendCheck); window.addEventListener("focus", cxPendCheck);
// The server answers { wait } instead of a link while Composio's one-minute request limit is spent (or right after another link was made for
// this workspace). The button keeps showing "Opening", the new tab stays as it is, and the request is made again when the wait is over, so the
// person never lands on Composio's "Too many requests" page. Only a wait of more than 6 s gets a line of its own.
function appConnect(app: string, from: string, label = "", offer: { ch: string; id: number } | null = null, another = false) {
  if (!LIVE || CX.busy) return; CX.busy = app; appsRefresh(); if (S.open) sRender();
  const tab = cmNewTab(app) ? window.open("about:blank", "_blank") : null;   // opened now, while it's still the tap (no popup block)
  const done = () => { CX.busy = ""; appsRefresh(); if (S.open) sRender(); };
  let told = false;
  const ask = (tries: number): Promise<void> => fetch(`${LIVE.api}/apps/connect`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ app, from: offer ? "offer" : from, ...(offer ? { offer } : {}), ...(another ? { another: true } : {}) }) }).then(r => r.json())
    .then(d => {
      if (d.wait && tries < 8) {
        if (d.wait > 6 && !told) { told = true; note(g("help", 14), `Getting the ${label || "app"} sign-in page ready`, "It opens by itself in a moment.", ""); }
        setTimeout(() => { ask(tries + 1); }, Math.min(65, Math.max(1, d.wait)) * 1000 + 250); return;
      }
      if (d.wait) { tab?.close(); done(); note(g("help", 14), `Couldn't open ${label || "that app"}`, "Composio is busy. Try again in a minute.", ""); return; }
      if (d.already) { tab?.close(); done(); cxLoad(true); if (offer) location.assign(offerDone(app, offer)); else note(ic.check, `${label || "That app"} is already connected`, `It's connected in your Composio account. ${who(main)} can use it now.`, ""); return; }
      if (d.url && d.newtab) {
        if (tab && !tab.closed) tab.location.href = d.url; else window.open(d.url, "_blank");
        Object.assign(CXPEND, { app, label, offer, at: Date.now(), known: another ? (CX.list || []).filter(x => x.app === app).map(x => x.id) : null }); done();
        note(g("help", 14), `Finish connecting ${label || "the app"} in the Composio tab`, "Then come back to this tab. It updates by itself.", ""); return;
      }
      tab?.close();
      if (d.url) location.assign(d.url); else { done(); note(g("help", 14), `Couldn't open ${label || "that app"}`, d.error || "Try again in a minute.", ""); }
    })
    .catch(() => { tab?.close(); done(); });
  ask(0);
}
const fmtDay = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
// App logos (Connected accounts, the connect card, the Apps list, app detail): logo.ts appLogo — tinted initial tile at once, the
// logo fades in over it via /applogo/<app> on live, and the tile stays if it fails.
const appImg = (a: { logo: string; name: string }) => appLogo(a.logo, a.name, "bico", 24);
// Long lists: one entry per app (a multi-account app is one entry), 8 entries a page with Prev/Next, and a search box once there are more than 8.
// The page and search stay put while Settings is open (e.g. after a disconnect); opening Settings again starts at page 1.
const CX_PAGE = 8, CXP = { page: 0, q: "" };
function cxEntries() {
  // One entry per app (in the order they were first connected).
  const apps: string[] = []; for (const a of [...(CX.list || [])].reverse()) if (!apps.includes(a.app)) apps.push(a.app);
  return apps.map(app => ({ app, as: CX.list!.filter(a => a.app === app).reverse() }));
}
function cxEntryHtml(app: string, accounts: Acct[]) {
  const a = accounts[0], count = accounts.length > 1 ? `<span class="sval">${accounts.length} accounts</span>` : "";
  return srow(appImg(a), esc(a.name), "", `${count}${chev()}`, ` role="button" tabindex="0" data-adetail-key data-adetail="${esc(app)}" data-cxrow="${esc(app)}"`);
}
// The list itself (inside #cxlist, so typing in the search box only repaints this part).
function cxListInner() {
  const ents = cxEntries(), q = CXP.q.trim().toLowerCase();
  // Search still finds an app by any of its account labels, email addresses or saved notes.
  const hits = !q ? ents : ents.filter(e => `${e.as[0].name} ${e.app}`.toLowerCase().includes(q)
    || e.as.some(a => `${acLabel(a)} ${a.email || ""} ${a.memo || ""}`.toLowerCase().includes(q)));
  if (q && !hits.length) return `<div class="sc">${srow("", "No apps match", `Nothing connected matches “${esc(CXP.q.trim())}”.`, "")}</div>`;
  const pages = Math.max(1, Math.ceil(hits.length / CX_PAGE)); CXP.page = Math.min(Math.max(0, CXP.page), pages - 1);
  const from = CXP.page * CX_PAGE, shown = hits.slice(from, from + CX_PAGE), last = CXP.page === pages - 1;
  const rows = shown.map(e => cxEntryHtml(e.app, e.as)).join("");
  const prev = I('<path d="m15 18-6-6 6-6"/>', 15), next = I('<path d="m9 18 6-6-6-6"/>', 15);
  const pager = pages < 2 ? "" : `<nav class="cxpager" aria-label="Connected apps pages"><span class="cxpn" aria-live="polite">${from + 1}–${from + shown.length} of ${hits.length} ${q ? "matching apps" : "apps"}</span>
    <span class="cxpb"><button type="button" class="sa cxpbtn" data-cxpg="-1"${CXP.page ? "" : " disabled"} aria-label="Previous page">${prev}<span>Prev</span></button><button type="button" class="sa cxpbtn" data-cxpg="1"${last ? " disabled" : ""} aria-label="Next page"><span>Next</span>${next}</button></span></nav>`;
  return `<div class="sc">${rows || srow("", "Nothing connected yet", "Browse all apps to connect your first app.", "")}</div>${pager}`;
}
function accountsHtml() {
  cxLoad();
  if (CX.err && !CX.loading && !CX.list) return `<div class="sc">${cxErrRow()}</div>`;
  if (!CX.list) return `<div class="sc">${srow(`<span class="bico"><i class="apspin"></i></span>`, "Checking your apps…", "", "")}</div>`;
  if (CX.err && !CX.loading) return `<div class="sc">${cxErrRow()}</div>${accountsList()}`;
  return accountsList();
}
function accountsList() {
  const n = cxEntries().length;
  if (n <= CX_PAGE) CXP.q = "";
  return `${n > CX_PAGE ? `<label class="lsearch kysearch cxfind">${ic.search}<input id="cxfq" type="search" placeholder="Search apps or accounts" aria-label="Search connected apps" value="${esc(CXP.q)}" autocomplete="off" autocapitalize="none" spellcheck="false"></label>` : ""}<div id="cxlist">${cxListInner()}</div>`;
}
function cxListPaint(top = false) {
  const l = document.getElementById("cxlist"); if (!l || !CX.list) return; l.innerHTML = cxListInner();
  // After Prev/Next, bring the top of the list into view if it scrolled away.
  const b = l.closest(".sbody") as HTMLElement | null, f = (document.querySelector(".cxfind") as HTMLElement | null) || l;
  if (top && b && f.getBoundingClientRect().top < b.getBoundingClientRect().top) b.scrollTop += f.getBoundingClientRect().top - b.getBoundingClientRect().top - 12;
}
document.addEventListener("input", e => { const t = e.target as HTMLInputElement; if (t.id === "cxfq") { CXP.q = t.value; CXP.page = 0; cxListPaint(); } });
document.addEventListener("click", e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-cxpg]"); if (!b || b.disabled) return; CXP.page += Number(b.dataset.cxpg) || 0; cxListPaint(true); });
if (LIVE && hasFeature("connected_apps")) { if (CX.list) { setTimeout(() => syncCon()); logoWarm(CX.list); } if (!CX.list?.length) logoWarm(CX_SUGG.map(k => ({ logo: `https://logos.composio.dev/api/${k}` }))); cxLoad(true); }
// Settings → Connected accounts → Apps I use (proto apps-used.js, GET/POST /api/apps-used): the apps they said they use (Get to know
// you, the helper's apps_i_use, or here). A heads-up for the helper: it offers to connect one when it comes up, never on its own.
// Edit opens the same picker as the interview question (apps-pick.ts); Save sends the whole list. Unsaved changes ask first.
type AuData = { apps: string[]; names: Record<string, string>; none: boolean; answered: boolean; options: AppOpt[] };
const AU = { d: null as AuData | null, loading: false, err: false, edit: false, draft: [] as string[], busy: false };
function auLoad(force = false) {
  if (!LIVE || AU.loading || (AU.d && !force)) return; AU.loading = true; AU.err = false;
  api("/apps-used").then((d: AuData) => { AU.loading = false; if (d && Array.isArray(d.options)) AU.d = d; else AU.err = true; auPaint(); })
    .catch(() => { AU.loading = false; AU.err = true; auPaint(); });
}
const auExtras = (): AppOpt[] => (AU.d?.apps || []).filter(k => !AU.d!.options.some(o => o.v === k)).map(k => ({ v: k, label: AU.d!.names[k] || k, logo: k }));
const auName = (k: string) => AU.d?.options.find(o => o.v === k)?.label || AU.d?.names[k] || k;
const auLogoOf = (k: string) => AU.d?.options.find(o => o.v === k)?.logo || k;
apkRegister("set-apps", { opts: [], none: "none", get: () => AU.draft, set: p => { AU.draft = p; }, extras: auExtras });
function auInner() {
  if (!AU.d) return `<div class="sc">${AU.err ? srow(`<span class="bico">${g("help", 16)}</span>`, "Couldn't load your apps", "Check your connection and try again.", sa("Try again", "data-auretry")) : srow(`<span class="bico"><i class="apspin"></i></span>`, "Loading…", "", "")}</div>`;
  const d = AU.d, h = esc(who(main));
  if (AU.edit) {
    apkRegister("set-apps", { opts: d.options, none: "none", get: () => AU.draft, set: p => { AU.draft = p; }, extras: auExtras });
    return `<form class="sc au-ed" id="auf" data-unsaved="appsused" data-unsaved-key="apps"><p class="au-lead">Pick the apps you use. ${h} won't connect anything; it just offers when one comes up.</p>
      ${apkHtml("set-apps", "Apps I use")}
      <div class="sbtns"><button class="sprim" type="submit"${AU.busy ? " disabled" : ""}>${AU.busy ? "Saving…" : "Save"}</button>${sa("Cancel", 'type="button" data-aucancel')}</div></form>`;
  }
  const list = d.apps, logos = list.slice(0, 4).map(k => appLogo(auLogoOf(k), auName(k), "au-l", 22)).join("");
  const sub = list.length ? esc(list.map(auName).join(", ")) : d.none ? "None of the common ones." : `Not set yet. Tell ${h} which apps you use, so it can offer to connect one when it comes up.`;
  return `<div class="sc">${srow(list.length ? `<span class="au-logos">${logos}</span>` : `<span class="bico">${ic.apps}</span>`, "Apps I use", sub, sa(list.length || d.none ? "Edit" : "Add", "data-auedit", "blue"), " data-aurow")}</div>`;
}
function auHtml() { auLoad(); return `<h3>Apps I use</h3><div id="auwrap">${auInner()}</div>`; }
function auPaint() { const w = document.getElementById("auwrap"); if (w && S.open && S.sec === "accounts") w.innerHTML = auInner(); }
function auSave() {
  if (!AU.d || AU.busy) return; AU.busy = true; auPaint();
  const body = { apps: AU.draft.filter(x => x !== "none"), none: AU.draft.includes("none") };
  api("/apps-used", body).then((d: AuData) => { AU.busy = false; if (!d || (d as any).error || !Array.isArray(d.apps)) throw new Error((d as any)?.error || "save failed");
    AU.d = d; AU.edit = false; apkReset("set-apps"); auPaint(); note(ic.check, "Saved", `${who(main)} knows which apps you use.`, ""); })
    .catch(() => { AU.busy = false; auPaint(); note(g("help", 14), "Couldn't save that", "Check your connection and try again.", ""); });
}
document.addEventListener("click", e => {
  const t = e.target as HTMLElement; if (!t.closest?.("#auwrap")) return;
  if (t.closest("[data-auretry]")) { auLoad(true); auPaint(); return; }
  if (t.closest("[data-auedit]") && AU.d) { AU.edit = true; AU.draft = AU.d.apps.length ? [...AU.d.apps] : AU.d.none ? ["none"] : []; apkReset("set-apps"); auPaint();
    if (!phone()) setTimeout(() => (document.getElementById("apq-set-apps") as HTMLInputElement | null)?.focus({ preventScroll: true }), 30); return; }
  if (t.closest("[data-aucancel]")) { AU.edit = false; apkReset("set-apps"); auPaint(); }
});
// Capture: before the chat composer's submit handler (it would read #box, which a task without a composer doesn't have).
document.addEventListener("submit", e => { if ((e.target as HTMLElement).id !== "auf") return; e.preventDefault(); e.stopImmediatePropagation(); auSave(); }, true);
unsavedKind("appsused", { hash: false, leave: "[data-sgo],[data-sclose],[data-apps]", busy: () => AU.busy,
  active: () => S.open && S.sec === "accounts" && AU.edit, save: () => auSave(),
  title: () => "Save the apps you use?", body: () => "You changed the list but haven't saved it.",
  state: () => JSON.stringify([...AU.draft].sort()),
  discard: () => { AU.edit = false; apkReset("set-apps"); auPaint(); } });
const fmtTel = (e: string) => { const m = String(e || "").match(/^\+1(\d{3})(\d{3})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(e || ""); };
function applyTheme() { const r = document.documentElement; if (S.theme === "system") r.removeAttribute("data-theme"); else r.dataset.theme = S.theme; }
applyTheme();
// Passwords & keys (live): saved logins (/api/logins) and keys (/api/vault). Passwords and key values go up once and are never sent back.
// edit: the one login whose Edit form is open (in place of its row); note is null until its saved note has loaded.
const KY: { logins: any[] | null; keys: any[] | null; err: string; at: number; busy: string; addkey: boolean; q: string; show: number; edit: null | { site: string; username: string; note: string | null } } = { logins: null, keys: null, err: "", at: 0, busy: "", addkey: false, q: "", show: 8, edit: null };
// Logins can number in the hundreds after a Chrome import: show a few, "Show more" adds 50, and search covers all of them.
const KY_FIRST = 8, KY_MORE = 50;
function kyLoginList() {
  const all = KY.logins || [], q = KY.q.trim().toLowerCase();
  const hits = q ? all.filter(l => l.site.includes(q) || String(l.username || "").toLowerCase().includes(q)) : all;
  const cap = q ? KY_MORE : KY.show, shown = hits.slice(0, cap), left = hits.length - shown.length;
  if (!all.length) return `<div class="sc">${srow("", "No logins yet", `Add one so ${esc(who(main))} can sign in for you.`, "")}</div>`;
  if (!hits.length) return `<div class="sc">${srow("", "No logins match", `Nothing saved for “${esc(KY.q.trim())}”.`, "")}</div>`;
  const isEd = (l: any) => !!KY.edit && KY.edit.site === l.site && KY.edit.username === (l.username || "");
  return `<div class="sc">${shown.map(l => isEd(l) ? loginForm(KY.edit) : srow(`<span class="favi">${esc((l.site[0] || "?").toUpperCase())}${logoOver(l.site, 38)}</span>`, esc(l.site), `${l.username ? esc(l.username) : "No username"}${l.has_note ? " · Has a note" : ""}${kyDay(l.created_at) && !phone() ? ` · Saved ${kyDay(l.created_at)}` : ""}`,
    `${sa("Edit", `data-kyed="${esc(l.site)}" data-kyu="${esc(l.username || "")}"`, "blue")}${sa(KY.busy === `l:${l.site}\n${l.username || ""}` ? "Removing…" : "Remove", `data-kyrml="${esc(l.site)}" data-kyu="${esc(l.username || "")}"`, "mute")}`, ' data-kyrow')).join("")}</div>
    ${left <= 0 ? "" : q ? `<p class="sfine kyleft">${left.toLocaleString()} more match${left === 1 ? "" : "es"}. Keep typing to narrow it down.</p>` : `<div class="sadd kymore">${sa(`Show more <span class="kyn">(${left.toLocaleString()})</span>`, 'type="button" data-kymore', "blue")}</div>`}`;
}
function kyListPaint() { const l = document.getElementById("kylist"); if (l) l.innerHTML = kyLoginList(); }
const kyApi = (path: string, body?: any) => fetch(`${LIVE!.api}/${path}`, body ? { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" })
  .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok || d?.error) throw new Error(d?.error || `Something went wrong (${r.status}).`); return d; });
// Re-render without losing what's typed in an open form.
function kyRender() {
  if (!S.open || S.sec !== "keys") return;
  const ids = ["lw", "lu", "lp", "ln", "kn", "kh", "kv"], vals = ids.map(i => (document.getElementById(i) as HTMLInputElement | null)?.value);
  sRender(); ids.forEach((i, n) => { const el = document.getElementById(i) as HTMLInputElement | null; if (el && vals[n] != null) el.value = vals[n]!; });
}
const acueSec = hasFeature("ambient") ? createAmbientCue({ LIVE, BOOT, shown: () => S.open && S.sec === "ambient", sRender, esc, helper: () => who(main), note, ic }) : () => "";
function kyLoad(force = false) {
  if (!LIVE || (!force && Date.now() - KY.at < 15000)) return; KY.at = Date.now();
  Promise.all([kyApi("logins"), kyApi("vault")]).then(([l, k]) => { KY.logins = Array.isArray(l) ? l : []; KY.keys = Array.isArray(k) ? k : []; KY.err = ""; kyRender(); })
    .catch(() => { KY.at = 0; KY.err = "Couldn't load your passwords and keys."; kyRender(); });
}
// "https://www.Costco.com/login" → "costco.com" (the server does the same).
const normSite = (v: string) => String(v || "").trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^/?#]*@/, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
const okSite = (h: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]{1,62}$/.test(h);
const normHost = (v: string) => { const w = String(v || "").trim().toLowerCase(), star = w.startsWith("*.") ? "*." : ""; return star + normSite(w.slice(star.length)).replace(/^\*\./, ""); };
const keyHosts = (k: any): string[] => { try { const h = typeof k.hosts === "string" ? JSON.parse(k.hosts) : k.hosts; return Array.isArray(h) ? h : []; } catch { return []; } };
const kyDay = (ms: any) => Number(ms) ? fmtDay(new Date(Number(ms)).toISOString()) : "";
const pwField = (id: string, label: string, ph = "") => `<label class="sf"><span>${label}</span><span class="spw"><input id="${id}" type="${S.eye ? "text" : "password"}" placeholder="${ph}" autocomplete="new-password" spellcheck="false"><button type="button" class="seye${S.eye ? " on" : ""}" data-eye="${id}" aria-label="Show ${label.toLowerCase()}">${g("eye", 17)}</button></span></label>`;
function keysLive() {
  kyLoad();
  const loading = srow(`<span class="bico"><i class="apspin"></i></span>`, "Loading…", "", ""), failed = srow("", "Couldn't load", "Check your connection and try again.", sa("Try again", "data-kyretry", "blue"));
  const loginRows = KY.logins === null ? `<div class="sc">${KY.err ? failed : loading}</div>` : `<div id="kylist">${kyLoginList()}</div>`;
  const keyRows = KY.keys === null ? (KY.err ? failed : loading) : KY.keys.length ? KY.keys.map(k => srow(`<span class="favi">${g("key", 16)}${logoOver(keyHosts(k)[0] || "", 38)}</span>`, `<code>${esc(k.name)}</code>`, `Only ever sent to ${esc(keyHosts(k).join(", ") || "its sites")}`, sa(KY.busy === `k:${k.name}` ? "Removing…" : "Remove", `data-kyrmk="${esc(k.name)}"`, "mute"))).join("")
    : srow("", "No keys yet", `For services ${esc(who(main))} uses from code, like a weather API.`, "");
  return `<h2>Passwords & keys</h2><p class="slead">Logins and keys ${esc(who(main))} can use, without ever seeing the real password or key. 1Helm fills it in only on the site it belongs to.</p>
      ${S.adding ? `<div class="sc">${loginForm(null)}</div>` : ""}
      <h3>Logins${KY.logins?.length ? ` <span class="h3n">${KY.logins.length.toLocaleString()}</span>` : ""}</h3>
      ${piHtml()}
      ${(KY.logins?.length || 0) > KY_FIRST ? `<label class="lsearch kysearch">${ic.search}<input id="kyq" type="search" placeholder="Search websites or usernames" value="${esc(KY.q)}" autocomplete="off" autocapitalize="none" spellcheck="false"></label>` : ""}
      ${loginRows}
      ${S.adding ? "" : `<div class="sadd">${sa(`${ic.plus}<span>Add a login</span>`, "data-addlogin", "blue")}${PI.plan || PI.err ? "" : sa(`${g("imp", 15)}<span>Import from Chrome</span>`, "data-pipick", "blue")}</div>`}
      ${PI.plan || PI.err ? "" : `<p class="sfine pihow">In Chrome: Password Manager → Settings → Export passwords. Then import that file here${phone() ? "" : " or drop it on this page"}.</p>`}
      <input type="file" id="pifile" accept=".csv,text/csv" hidden>
      <h3>Keys</h3>
      ${KY.addkey ? `<form class="sc sform" id="keyf" novalidate data-unsaved="key"><div class="sfh">${g("key")}<b>Add a key</b></div>
          <p>For a service ${esc(who(main))} uses from code. It only gets a stand-in; 1Helm swaps in the real key when it goes to these sites.</p>
          <label class="sf"><span>Name</span><input id="kn" placeholder="OPENWEATHER_KEY" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
          <label class="sf"><span>Sites it's for</span><input id="kh" placeholder="api.openweathermap.org" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url"></label>
          ${pwField("kv", "Key")}
          <div class="sbtns"><button class="sprim" type="submit">Save key</button>${sa("Cancel", 'type="button" data-addkey')}</div></form>` : ""}
      <div class="sc">${keyRows}</div>
      ${KY.addkey ? "" : `<div class="sadd">${sa(`${ic.plus}<span>Add a key</span>`, "data-addkey", "blue")}</div>`}
      <p class="sfine">Saved passwords and keys can't be shown again. To change a login, tap Edit. To change a key, save it again with the same name.</p>`;
}
// Add a login / Edit a login (live): website, username, password, optional note. Same store as Import from Chrome: one login per
// website + username, so saving a pair that's already saved updates it instead of adding a second one. Editing can leave the
// password blank to keep it; the note is sealed like the password and only loaded into this form.
function loginForm(ed: { site: string; username: string; note: string | null } | null) {
  return `<form class="sform" id="loginf" novalidate data-unsaved="login" data-unsaved-key="${ed ? `${esc(ed.site)}|${esc(ed.username)}|${ed.note === null ? "loading" : "ready"}` : "new"}"${ed ? ` data-was="${esc(ed.site)}" data-wasu="${esc(ed.username)}"` : ""}><div class="sfh">${g("lock")}<b>${ed ? "Edit login" : "Add a login"}</b></div>
    <label class="sf"><span>Website</span><input id="lw" placeholder="costco.com" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url"${ed ? ` value="${esc(ed.site)}"` : ""}></label>
    <label class="sf"><span>Username or email</span><input id="lu" autocomplete="off" autocapitalize="none" spellcheck="false"${ed ? ` value="${esc(ed.username)}"` : ""}></label>
    ${pwField("lp", ed ? "New password" : "Password", ed ? "Leave blank to keep the saved one" : "")}
    <label class="sf"><span>Note <i class="sopt">optional</i></span><textarea id="ln" rows="2" maxlength="2000" placeholder="${ed && ed.note === null ? "Loading…" : "Which account this is, a membership number…"}"${ed && ed.note === null ? " disabled" : ""}>${ed && ed.note ? esc(ed.note) : ""}</textarea></label>
    <div class="sbtns"><button class="sprim" type="submit"${ed && ed.note === null ? " disabled" : ""}>${ed ? "Save changes" : "Save login"}</button>${sa("Cancel", ed ? 'type="button" data-kyedx' : 'type="button" data-addlogin')}</div></form>`;
}
// ---------- Import from Chrome: "Chrome Passwords.csv" is read here in the browser (src/pwimport.ts) and only the
// {site, username, password} rows go to /api/logins/import. The file is never uploaded, stored or put in the Library.
// Parsed passwords live in PI.plan until Import or Cancel, never in the page's HTML, and are never logged.
const PI: { plan: PwPlan | null; off: Set<number>; err: string; name: string; busy: boolean; why: boolean; done: null | { added: number; updated: number; skipped: number; merged: number }; drag: number } =
  { plan: null, off: new Set(), err: "", name: "", busy: false, why: false, done: null, drag: 0 };
const piKey = (site: string, u: string) => `${site}\n${u || ""}`;
function piDrop() { PI.plan = null; PI.off = new Set(); PI.err = ""; PI.name = ""; PI.why = false; PI.busy = false; const i = document.getElementById("pifile") as HTMLInputElement | null; if (i) i.value = ""; }
// Re-render, keeping the preview list's scroll position.
function piRender() { const top = document.querySelector(".pilist")?.scrollTop || 0; kyRender(); const l = document.querySelector(".pilist"); if (l) l.scrollTop = top; }
function piRead(f: File | undefined) {
  if (!f || !LIVE) return;
  piDrop(); PI.done = null; S.adding = KY.addkey = false; PI.name = f.name;
  if (!/\.csv$/i.test(f.name) && !/csv/.test(f.type)) { PI.err = "That isn't a .csv file. Pick the “Chrome Passwords.csv” that Chrome saved."; piRender(); return; }
  if (f.size > 20e6) { PI.err = "That file is too big for a passwords export. Pick the “Chrome Passwords.csv” that Chrome saved."; piRender(); return; }
  f.text().then(t => { const p = planImport(t); if ("error" in p) PI.err = p.error; else PI.plan = p; piRender(); })
    .catch(() => { PI.err = "Couldn't read that file. Try exporting it from Chrome again."; piRender(); });
}
function piHtml() {
  if (PI.done) { const d = PI.done;
    return `<div class="sc sform pidone"><div class="sfh">${ic.check}<b>Imported ${d.added + d.updated} login${d.added + d.updated === 1 ? "" : "s"}</b></div>
      <p>${d.added} new, ${d.updated} updated${d.merged ? `, ${d.merged} duplicate${d.merged === 1 ? "" : "s"} merged` : ""}${d.skipped ? `, ${d.skipped} skipped` : ""}. ${esc(who(main))} can sign in to these sites now.</p>
      <p class="piwarn">${g("help", 15)}<span>Delete the Chrome Passwords.csv file from your computer. It isn't encrypted.</span></p>
      <div class="sbtns">${sa("Done", 'type="button" data-pidone', "mute")}</div></div>`; }
  if (PI.err) return `<div class="sc sform"><div class="sfh">${g("imp")}<b>Import from Chrome</b></div><p class="pierr">${esc(PI.err)}</p>
      <div class="sbtns"><button class="sprim" type="button" data-pipick>Choose another file</button>${sa("Cancel", 'type="button" data-picancel')}</div></div>`;
  const p = PI.plan; if (!p) return "";
  const have = new Set((KY.logins || []).map(l => piKey(l.site, l.username))), on = p.rows.filter((_, i) => !PI.off.has(i));
  const upd = on.filter(r => have.has(piKey(r.site, r.username))).length, add = on.length - upd, sk = p.skipped.length;
  const row = (r: PwPlan["rows"][number], i: number) => `<label class="pir"><input type="checkbox" data-piu="${i}"${PI.off.has(i) ? "" : " checked"}${PI.busy ? " disabled" : ""}><span class="favi pifav">${esc((r.site[0] || "?").toUpperCase())}${logoOver(r.site, 28)}</span><span class="srt"><b>${esc(r.site)}</b><span>${r.username ? esc(r.username) : "No username"}</span></span>${have.has(piKey(r.site, r.username)) ? `<em class="stag">Update</em>` : ""}</label>`;
  return `<div class="sc sform piw"><div class="sfh">${g("imp")}<b>Import from Chrome</b>${PI.name ? `<em class="stag">${esc(PI.name)}</em>` : ""}</div>
    <div class="pistats"><span><b>${add}</b> new</span><span><b>${upd}</b> will update a saved login</span>${p.merged ? `<span title="Chrome saved these logins more than once (once per page address). Each one is imported once."><b>${p.merged}</b> duplicate${p.merged === 1 ? "" : "s"} merged</span>` : ""}${sk ? `<button type="button" class="pisk${PI.why ? " on" : ""}" data-piwhy aria-expanded="${PI.why}"><b>${sk}</b> skipped${ic.chev}</button>` : `<span><b>0</b> skipped</span>`}</div>
    ${PI.why && sk ? `<ul class="piwhy">${p.skipped.map(x => `<li><b>${esc(x.site)}</b><span>${esc(x.reason)}</span></li>`).join("")}</ul>` : ""}
    ${p.rows.length ? `<label class="pir piall"><input type="checkbox" data-piall${on.length === p.rows.length ? " checked" : ""}${PI.busy ? " disabled" : ""}><span class="srt"><b>${on.length === p.rows.length ? "All" : `${on.length} of ${p.rows.length}`} selected</b></span></label>
    <div class="pilist">${p.rows.map(row).join("")}</div>` : `<p>Nothing in this file can be imported.</p>`}
    <p>Passwords stay hidden. 1Helm locks each one away and never shows it again, not even to ${esc(who(main))}.</p>
    <div class="sbtns"><button class="sprim" type="button" data-pigo${on.length && !PI.busy ? "" : " disabled"}>${PI.busy ? "Importing…" : `Import ${on.length} login${on.length === 1 ? "" : "s"}`}</button>${sa("Cancel", `type="button" data-picancel${PI.busy ? " disabled" : ""}`)}</div></div>`;
}
function piGo() {
  const p = PI.plan; if (!p || PI.busy) return;
  let rows = p.rows.filter((_, i) => !PI.off.has(i)); if (!rows.length) return;
  PI.busy = true; piRender();
  kyApi("logins/import", { logins: rows }).then(d => {
    const merged = p.merged; rows = []; piDrop(); const n = (d.added || 0) + (d.updated || 0);
    PI.done = { added: d.added || 0, updated: d.updated || 0, skipped: (d.skipped || []).length, merged };
    note(ic.check, `Imported ${n} login${n === 1 ? "" : "s"}`, "Delete the Chrome Passwords.csv file from your computer. It isn't encrypted.", "");
    KY.at = 0; kyLoad(true); kyRender(); document.querySelector(".pidone")?.scrollIntoView({ block: "nearest" });
  }).catch(err => { rows = []; PI.busy = false; piRender(); note(g("help", 14), "Couldn't import the logins", err.message || "Try again in a minute.", ""); });
}
document.addEventListener("change", e => {
  const t = e.target as HTMLInputElement;
  if (t.id === "pifile") { const f = t.files?.[0]; t.value = ""; piRead(f); return; }
  if (!PI.plan || PI.busy) return;
  if (t.matches("[data-piu]")) { const i = +t.dataset.piu!; t.checked ? PI.off.delete(i) : PI.off.add(i); piRender(); }
  else if (t.matches("[data-piall]")) { PI.off = t.checked ? new Set() : new Set(PI.plan.rows.map((_, i) => i)); piRender(); }
});
// Drop the CSV on Settings → Passwords & keys. Capture phase, so the channel's own drop-to-upload never sees it.
{ const ok = (e: DragEvent) => !!LIVE && S.open && S.sec === "keys" && [...(e.dataTransfer?.types || [])].includes("Files");
  const mark = () => document.getElementById("setw")?.classList.toggle("pidrag", PI.drag > 0);
  window.addEventListener("dragenter", e => { if (!ok(e)) return; e.stopPropagation(); PI.drag++; mark(); }, true);
  window.addEventListener("dragleave", e => { if (!ok(e)) return; e.stopPropagation(); PI.drag = Math.max(0, PI.drag - 1); mark(); }, true);
  window.addEventListener("dragover", e => { if (!ok(e)) return; e.stopPropagation(); e.preventDefault(); }, true);
  window.addEventListener("drop", e => { if (!ok(e)) return; e.stopPropagation(); e.preventDefault(); PI.drag = 0; mark(); piRead(e.dataTransfer?.files?.[0]); }, true); }
const SECS: [string, string, string][] = [["general", "General", "gear"], ["accounts", "Connected accounts", "grid"], ["wallet", "Wallet", "wallet"], ["keys", "Passwords & keys", "key"],
  ["perm", "Permissions", "hand"], ["device", "Location & mic", "loc"], ["texting", "Texting", "msg"], ["ambient", "Ambient", "wave"], ["notif", "Notifications", "bell"], [CMCP_SEC, "Advanced", "sliders"], ["", "", ""], ["help", "Help & support", "help"], ["legal", "Legal", "legal"]];
const LIVE_HIDE = new Set<string>([]);   // not real yet on Cloud: hidden, not faked (none today)
const secShown = (k: string) => {
  if (!k || !LIVE) return true;
  const gated: Record<string, string> = { accounts: "connected_apps", [CMCP_SEC]: "connected_apps", wallet: "billing", texting: "texting", ambient: "ambient" };
  return !LIVE_HIDE.has(k) && (!gated[k] || hasFeature(gated[k]));
};
const secName = (k: string) => k === NETWORK_SEC ? "Computer connections" : k === "shortcuts" ? "Keyboard shortcuts" : k === "account" ? "Your account" : k === BYK_SEC ? BYK_TITLE : k === AP_SEC ? AP_TITLE : SECS.find(x => x[0] === k)?.[1] ?? "Settings";
// Sub-pages: where their back button goes (and, on desktop, which section stays highlighted). Your account goes back to General on
// desktop; on phone, to wherever it was opened from (AC.back).
const secParent = (k: string, desk = !phone()) => k === NETWORK_SEC ? (hasFeature("connected_apps") ? "accounts" : "perm") : k === "shortcuts" ? "help" : k === BYK_SEC || k === AP_SEC ? "general" : k === "account" ? (desk ? "general" : AC.back) : "";
const tg = (k: string, label: string) => `${LIVE ? SP : ""}<button class="tg${S.sw[k] ? " on" : ""}" role="switch" aria-checked="${S.sw[k]}" aria-label="${esc(label)}" ${LIVE ? `data-soon="${k === "text" || k === "quiet" ? "texting" : "notif"}"` : `data-sw="${k}"`}><i></i></button>`;
// Settings → General → AI data privacy (proto src/privacy.js, POST /api/account/privacy { level }): which AI providers may handle the
// person's requests. One server-validated choice per account; the same three options as onboarding. Unset accounts read as ZDR. A change
// governs requests from then on (background and scheduled work included); it can't recall requests already sent.
const AP_SEC = "aipriv", AP_TITLE = "AI data privacy";
const AP_OPTS: [string, string, string][] = [
  ["unrestricted", "Unrestricted", "Allow eligible providers that may retain requests or use them to improve and train AI models. This gives us the widest selection of discounted models and can make your usage balance last longer."],
  ["no_training", "No Training", "Use providers that don't train on your requests. They may keep them for a limited time under their own policies, often up to 30 days. Some discounted models aren't available."],
  ["zdr", "Zero Data Retention", "Use only AI providers with verified zero-data-retention coverage for your requests. This rules out some models and discounts."]];
// Saving is optimistic, like the other settings: the choice flips at once, then one request at a time goes up (the newest pick wins);
// "Saved" shows quietly for a moment, and a failure puts the last saved choice back with a clear message. ok = what the server has.
const AP: { level: string; ok: string; sending: boolean; next: string; st: "" | "saved" | "err"; err: string } = { level: (LIVE ? BOOT?.account?.ai_privacy?.level : "zdr") || "zdr", ok: "", sending: false, next: "", st: "", err: "" };
AP.ok = AP.level;
let apTimer = 0;
const apLabel = () => AP_OPTS.find(o => o[0] === AP.level)?.[1] || "Zero Data Retention";
const apRow = () => srow(g("lock"), AP_TITLE, "Which AI providers may handle your requests", `<span class="sval">${esc(apLabel())}</span>${chev()}`, nav(AP_SEC));
const apSt = () => AP.st === "saved" ? `${ic.check}Saved` : AP.st === "err" ? esc(AP.err) : "";
function apPage() {
  const bk = LIVE ? BOOT?.account?.ai_privacy?.byok : null;
  return `<h2>${AP_TITLE}</h2><p class="slead">Choose how AI providers may use your data. All plans include these choices.</p>
    <div class="sc" role="radiogroup" aria-label="How AI providers may use your data">${AP_OPTS.map(([k, t, d]) => { const on = AP.level === k;
      return `<button type="button" class="sr sradio${on ? " on" : ""}" role="radio" aria-checked="${on}" data-apset="${k}"><span class="srt"><b>${t}</b><span>${d}</span></span><span class="rck">${ic.check}</span></button>`; }).join("")}</div>
    ${bdRow()}
    <p class="sfine apst${AP.st ? ` ${AP.st}` : ""}" id="apst" role="status" aria-live="polite">${apSt()}</p>
    <p class="sfine">Requests can include messages, attachments, memory, and connected-app information used to answer you. This setting concerns AI providers; 1Helm's saved chats and connected services have separate storage policies. A change applies to requests from then on, including scheduled and background work; it can't recall requests already sent.</p>
    ${bk === "openrouter" ? `<p class="sfine">Your own AI key (Sign in with OpenRouter) follows this setting too. If no provider of your chosen model fits it, ${esc(who(main))} tells you instead of switching models.</p>`
      : bk === "other" ? `<p class="sfine">Your own AI key goes to your own AI service under its terms, so this setting can't be applied there. It applies to the AI providers 1Helm uses for you.</p>` : ""}`;
}
// Paint the choice and the status line in place (no re-render, so focus and scroll stay put); General's row picks it up when shown.
function apPaint() {
  document.querySelectorAll<HTMLElement>("[data-apset]").forEach(b => { const on = b.dataset.apset === AP.level;
    b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
  const bt = document.querySelector<HTMLElement>("[data-bdesign]"); if (bt) { const on = bdOn(); bt.classList.toggle("on", on); bt.setAttribute("aria-checked", String(on)); }
  const st = document.getElementById("apst"); if (st) { st.className = `sfine apst${AP.st ? ` ${AP.st}` : ""}`; st.innerHTML = apSt(); }
}
function apSend(lv: string) {
  AP.sending = true; AP.next = "";
  kyApi("account/privacy", { level: lv }).then(d => {
    AP.ok = d?.ai_privacy?.level || lv; if (BOOT?.account) BOOT.account.ai_privacy = { ...(BOOT.account.ai_privacy || {}), ...(d?.ai_privacy || { level: AP.ok }) };
    cmodelsPrivacy(d?.custom_models);   // Custom Model Selection: models that the new level doesn't allow must be replaced before chat continues
    if (!AP.next) { AP.level = AP.ok; AP.st = "saved"; clearTimeout(apTimer); apTimer = window.setTimeout(() => { if (AP.st === "saved") { AP.st = ""; apPaint(); } }, 2200); }
  }).catch(err => {
    if (!AP.next) { AP.level = AP.ok; AP.st = "err"; AP.err = `Couldn't save that, so it's still ${apLabel()}. ${err instanceof TypeError ? "Check your connection and try again." : err.message || "Try again in a minute."}`; }
  }).finally(() => { AP.sending = false; if (AP.next && AP.next !== AP.ok) apSend(AP.next); else AP.next = ""; apPaint(); });
}
document.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-apset]"); if (!b) return;
  e.preventDefault(); const lv = b.dataset.apset || ""; if (!lv || lv === AP.level) return;
  AP.level = lv; AP.st = ""; clearTimeout(apTimer); apPaint();
  if (!LIVE) { AP.ok = lv; return; }
  if (AP.sending) AP.next = lv; else apSend(lv);
});
document.addEventListener("keydown", e => {   // arrow keys move the choice, like native radios
  const b = (e.target as HTMLElement).closest?.<HTMLElement>("[data-apset]"); if (!b || !["ArrowDown", "ArrowUp"].includes(e.key)) return;
  e.preventDefault(); const ks = AP_OPTS.map(o => o[0]), i = ks.indexOf(b.dataset.apset || ""), n = ks[(i + (e.key === "ArrowDown" ? 1 : ks.length - 1)) % ks.length];
  document.querySelector<HTMLElement>(`[data-apset="${n}"]`)?.focus();
});
// Settings → AI data privacy → "Better Design for page design" (the private build shows it on Advanced, which the public edition hides without the Cloud connected apps feature; proto src/better-design.js, POST /api/account/prefs { better_design }): Better Design keeps what it is
// sent and may train on it, so it follows the AI data privacy level. Effective value = the person's own choice if they ever made one, else on only for
// Unrestricted. BOOT.account.better_design = { choice: "on" | "off" | null, on }; the level comes from AP, so changing it here updates the row.
const BDS: { choice: "on" | "off" | null; busy: boolean; err: string } = { choice: LIVE ? (BOOT?.account?.better_design?.choice ?? null) : null, busy: false, err: "" };
const bdOn = () => BDS.choice ? BDS.choice === "on" : AP.level === "unrestricted";
const bdRow = () => `<div class="sc">${srow("", "Better Design for page design", "Sends the description of a page you ask for to Better Design, which keeps it and may train on it.",
  `<button type="button" class="tg${bdOn() ? " on" : ""}" role="switch" aria-checked="${bdOn()}" aria-label="Better Design for page design" data-bdesign${BDS.busy ? " disabled" : ""}><i></i></button>`, " data-bdrow")}</div>${BDS.err ? `<p role="alert" class="meta">${esc(BDS.err)}</p>` : ""}`;
document.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-bdesign]"); if (!b) return;
  e.preventDefault(); if (BDS.busy) return;
  const was = BDS.choice, next = !bdOn() ? "on" : "off";
  BDS.choice = next; BDS.err = "";
  if (!LIVE) { sRender(); return; }
  BDS.busy = true; sRender();
  kyApi("account/prefs", { better_design: next === "on" }).then(d => { if (BOOT?.account) BOOT.account.better_design = d?.better_design || { choice: next, on: next === "on" }; })
    .catch(err => { BDS.choice = was; BDS.err = err.message || "Couldn't save that. Try again in a minute."; })
    .finally(() => { BDS.busy = false; sRender(); document.querySelector<HTMLButtonElement>("[data-bdesign]")?.focus(); });
});
// Settings → General → Usage → "Show estimated costs" (proto tenants.show_costs, POST /api/account/prefs): per account, OFF by default.
// Off hides the estimate under a task ("This task: about $0.04"). Never hidden: the spend-guard pause cards (safety), the balance and
// month meter, billing, and Live notes' own running "$x" chip.
const costRow = () => srow("", "Show estimated costs", "What each task has used so far, under its messages",
  `<button type="button" class="tg${showCosts() ? " on" : ""}" role="switch" aria-checked="${showCosts()}" aria-label="Show estimated costs" data-costs><i></i></button>`, " data-costrow");
const spendPauseRow = () => srow('', 'Pause to check spending',
  'On: check in when work is costly, long, or repetitive. Off: keep working without these pauses, even if it uses all available credits. Purchases and other approvals still apply. Changes affect active work at its next safe step; already paused tasks need Keep going once.',
  `<button type="button" class="tg${spendPauses() ? ' on' : ''}" role="switch" aria-checked="${spendPauses()}" aria-label="Pause to check spending" data-spend-pauses${SPEND.busy ? ' disabled aria-busy="true"' : ''}><i></i></button>`, ' data-spend-pause-row') +
  (SPEND.error ? `<p role="alert" class="meta">${esc(SPEND.error)}</p>` : '');
document.addEventListener('click', async e => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-spend-pauses]');
  if (!button || SPEND.busy) return;
  e.preventDefault();
  const enabled = !spendPauses(), focused = document.activeElement === button;
  const paint = () => { sRender(); if (focused) document.querySelector<HTMLButtonElement>('[data-spend-pauses]')?.focus(); };
  SPEND.busy = true; SPEND.error = ''; paint();
  try {
    const result = LIVE ? await kyApi('account/spend-pauses', { enabled }) : { enabled };
    if (typeof result.enabled !== 'boolean') throw new Error('The setting was not confirmed. Try again.');
    SPEND.on = result.enabled;
    if (BOOT?.account) BOOT.account.spend_pauses = result.enabled;
  } catch (err: any) { SPEND.error = err.message || 'Could not save that. Try again.'; }
  finally { SPEND.busy = false; paint(); }
});
document.addEventListener("click", e => {
  if (!(e.target as HTMLElement).closest("[data-costs]")) return;
  e.preventDefault(); if (CO.busy) return;
  const was = showCosts(), paint = () => { sRender(); const { ch, s } = route(); if (s) paintChat(s); else repaint(ch); };
  CO.on = !was; paint();
  if (!LIVE) return;
  CO.busy = true;
  kyApi("account/prefs", { show_costs: CO.on }).then(() => { if (BOOT?.account) BOOT.account.show_costs = CO.on; })
    .catch(err => { CO.on = was; paint(); note(g("help", 14), "Couldn't save that", err.message || "Try again in a minute.", ""); })
    .finally(() => { CO.busy = false; });
});
const srow = (icon: string, title: string, sub: string, right: string, attrs = "", tag: "div" | "a" = "div") => `<${tag} class="sr"${attrs}>${icon}<span class="srt"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</span>${attrs.includes("data-soon") ? SP : ""}${right}</${tag}>`;
const sa = (label: string, attr: string, cls = "") => { const k = attr.match(/data-snote="([^"]+)"/)?.[1]; return k && isSoon(k) ? `<button class="sa soonb${cls ? " " + cls : ""}" data-soon="${k}">${label}${SP}</button>` : `<button class="sa${cls ? " " + cls : ""}" ${attr}>${label}</button>`; };
const chev = () => `<span class="schev">${ic.chev}</span>`;
const nav = (k: string) => ` role="button" tabindex="0" data-sgo="${k}"`;
const snote = (k: string) => ` role="button" tabindex="0" data-${isSoon(k) ? "soon" : "snote"}="${k}"`;
const ok = (t: string) => `<span class="sok">${ic.check}${t}</span>`;
function radio(area: string, v: string, title: string, sub: string) {
  const on = S.perm[area] === v;
  return `<button class="sr sradio${on ? " on" : ""}" role="radio" aria-checked="${on}" ${LIVE ? 'data-soon="perm"' : `data-perm="${area}:${v}"`}><span class="srt"><b>${title}</b><span>${sub}</span></span><span class="rck">${ic.check}</span></button>`;
}
function usageCard() {
  if (LIVE && !hasFeature("billing")) return `<div class="sc"><div class="susage"><div class="sut"><b>Your own AI key</b></div><p>AI calls use the key in your account settings. ${esc(who(main))} pauses and asks before a task runs long.</p></div></div>`;
  const ml = monthLine(LIVE ? BOOT?.account?.month : { pct: 12, used: "$2.40", allowance: "$20.00" }, Math.max(0, Math.min(100, Number(BOOT?.account?.usagePercent || 0))));
  const pct = bykSbOn() ? 0 : ml.pct;
  const guard = `If a task runs long, ${who(main)} pauses and asks before going on.`;
  const detail = bykSbOn() ? `AI runs on your own key. ${bykSbCredits()} in credits for the computer, browser, web search and memory. ${guard}`   // sandbox: after a pretend switch now
    : LIVE && BOOT?.account?.byok ? `AI runs on your own key. ${BOOT?.account?.balance || "$0.00"} in credits for the computer, browser, web search and memory. ${guard}`   // Bring your own key plan
    : LIVE ? `${ml.text ? `${ml.text} ` : ""}${BOOT?.account?.balance || "$25.00"} available. ${guard}` : `${ml.text} Resets Oct 22. ${guard}`;
  const planName = LIVE ? String(BOOT?.account?.plan || "Plus") : bykSbOn() ? "Bring your own key" : "Plus";
  return `<div class="sc"><div class="susage"><div class="sut"><b>${esc(planName)} plan</b><span>${pct}% used</span></div><p>${esc(detail)}</p><div class="sbar"><i style="width:${pct}%"></i></div>${bykUsageNote()}</div>
    <div class="sfoot">${sa("Change plan", `data-stplans aria-expanded="${storPlansOpen()}"`, "blue")}${LIVE ? sa("Add credits", "data-crt", "blue") : sa("Add credits", 'data-snote="credits"', "blue")}${bcxUsage("foot")}</div>${storPlans()}${bcxUsage("card")}
    ${LIVE && CR.open ? `<div class="crpick">${[10, 25, 50].map(n => `<button class="crb${CR.pick === n ? " on" : ""}" data-crp="${n}"${CR.busy ? " disabled" : ""}>${CR.busy === n ? "Adding…" : `$${n}`}</button>`).join("")}<div class="crask"><span>${crAsk()}</span>${CR.pick && CR.info ? `<button class="crb" data-crgo${CR.busy ? " disabled" : ""}>${CR.info.card ? "Confirm" : "Continue"}</button><button class="crb crx" data-crno${CR.busy ? " disabled" : ""}>Cancel</button>` : ""}</div></div>` : ""}</div>`;
}
const accountRow = (go: boolean) => srow(`<span class="sme">${esc(INITIALS)}</span>`, esc(PERSON), esc(EMAIL), chev(), nav("account"));
// ---------- Settings → General → Your account (proto src/account.js): name, sign-in email, signed-in devices ----------
// 1Helm has no passwords (sign-in is a one-time emailed code or link), so this says so instead of offering one. A new email switches only
// after the link sent to that address is opened; the old address is told. In the sandbox it's the same page on made-up data.
G.mail = '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>';
G.cell = '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>';
type AcDev = { id: string; current: boolean; device: string; place: string; created: number };
type AcData = { name: string; email: string; pending: null | { email: string; expires: number }; sessions: AcDev[] };
const AC: { d: AcData | null; err: string; at: number; busy: string; edit: "" | "name" | "email"; link: string; back: string } = { d: null, err: "", at: 0, busy: "", edit: "", link: "", back: "" };
function acLoad(force = false) {
  if (!LIVE) { AC.d ??= { name: PERSON, email: EMAIL, pending: null, sessions: [{ id: "a", current: true, device: "Chrome on Mac", place: "Denver, CO, US", created: Date.now() - 2 * 864e5 }, { id: "b", current: false, device: "Safari on iPhone", place: "Denver, CO, US", created: Date.now() - 9 * 864e5 }] }; return; }
  if (!force && Date.now() - AC.at < 15000) return; AC.at = Date.now();
  kyApi("account").then(d => { AC.d = d; AC.err = ""; if (!d.pending) AC.link = ""; acRender(); }).catch(() => { AC.at = 0; AC.err = "x"; acRender(); });
}
// Re-render without losing what's typed.
function acRender() {
  if (!S.open || S.sec !== "account") return;
  const ids = ["acn", "acm"], vals = ids.map(i => (document.getElementById(i) as HTMLInputElement | null)?.value);
  sRender(); ids.forEach((i, n) => { const el = document.getElementById(i) as HTMLInputElement | null; if (el && vals[n] != null) el.value = vals[n]!; });
}
const acWhen = (ms: number) => { const d = Math.floor((Date.now() - ms) / 864e5); return d < 1 ? "today" : d < 2 ? "yesterday" : fmtDay(new Date(ms).toISOString()); };
function accountSec() {
  acLoad();
  const d = AC.d, h = esc(who(main));
  if (!d) return `<h2>Your account</h2><div class="sc">${AC.err ? srow("", "Couldn't load your account", "Check your connection and try again.", sa("Try again", "data-acretry", "blue")) : srow(`<span class="bico"><i class="apspin"></i></span>`, "Loading…", "", "")}</div>`;
  const nameBox = AC.edit === "name" ? `<form class="sform" id="acnamef" novalidate data-unsaved="acname"><label class="sf"><span>Your name</span><input id="acn" value="${esc(d.name)}" maxlength="80" autocomplete="name"></label>
      <div class="sbtns"><button class="sprim" type="submit">Save</button>${sa("Cancel", 'type="button" data-acedit=""')}</div></form>`
    : srow(`<span class="sme">${esc(initialsOf(d.name || "?"))}</span>`, esc(d.name || "No name yet"), `What ${h} calls you`, sa("Change", 'data-acedit="name"', "blue"), " data-acname");
  const p = d.pending;
  const mailBox = AC.edit === "email" ? `<form class="sform" id="acmailf" novalidate><label class="sf"><span>New sign-in email</span><input id="acm" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com"></label>
      <p class="acfine">We'll email a link to the new address. Nothing changes until you open it, and we'll let ${esc(d.email)} know when it does.</p>
      <div class="sbtns"><button class="sprim" type="submit">Send link</button>${sa("Cancel", 'type="button" data-acedit=""')}</div></form>`
    : srow(`<span class="bico">${g("mail", 18)}</span>`, esc(d.email), "Your sign-in codes and links are sent here", sa("Change", 'data-acedit="email"', "blue"), " data-acmail")
      + (p ? srow(`<span class="bico">${ic.clock}</span>`, `Waiting for ${esc(p.email)}`, `Open the link we sent there to switch. It works for an hour.${AC.link ? ` <a class="aclink" href="${esc(AC.link)}">Open the test link</a>` : ""}`, sa(AC.busy === "cancel" ? "Cancelling…" : "Cancel", "data-accancel", "mute"), " data-acpend") : "");
  const others = d.sessions.filter(x => !x.current);
  const dev = (x: AcDev) => srow(`<span class="bico">${g(/iPhone|Android phone/.test(x.device) ? "cell" : "mon", 18)}</span>`, `${esc(x.device || "A browser")}${x.current ? `<em class="stag acthis">This device</em>` : ""}`,
    [x.place, `Signed in ${acWhen(x.created)}`].filter(Boolean).map(esc).join(" · "), x.current ? "" : sa(AC.busy === x.id ? "Signing out…" : "Sign out", `data-acout="${esc(x.id)}"`, "mute"), " data-acdev");
  return `<h2>Your account</h2><p class="slead">Your name, how you sign in, and where you're signed in.</p>
    <h3>Name</h3><div class="sc">${nameBox}</div>
    <h3>Sign-in email</h3><div class="sc">${mailBox}</div>
    <h3>Password</h3><div class="sc">${srow(`<span class="bico">${g("lock", 18)}</span>`, "No password needed", "1Helm doesn't use passwords. When you sign in, we email you a code and a link that work once, so there's nothing to remember, reuse or leak.", "", " data-acpw")}</div>
    <h3>Signed-in devices${d.sessions.length > 1 ? ` <span class="h3n">${d.sessions.length}</span>` : ""}</h3><div class="sc">${d.sessions.map(dev).join("")}</div>
    ${others.length ? `<div class="sadd">${sa(AC.busy === "all" ? "Signing out…" : others.length === 1 ? "Sign out the other device" : `Sign out all ${others.length} other devices`, "data-acoutall", "blue")}</div>` : ""}
    <p class="sfine">Don't recognize a device? Sign it out, then check that your email account is secure, since sign-in codes and links go there.</p>`;
}
function acSetName(name: string) {
  PERSON = name; INITIALS = initialsOf(name); if (AC.d) AC.d.name = name;
  document.querySelectorAll<HTMLElement>(".me[data-sgo]").forEach(b => { b.textContent = INITIALS; b.title = `${name} · Settings`; });
}
document.addEventListener("click", e => {
  if (!S.open || S.sec !== "account") return;
  const t = e.target as HTMLElement, d = AC.d;
  const ed = t.closest<HTMLElement>("[data-acedit]"); if (ed) { AC.edit = ed.dataset.acedit as any; sRender(); (document.getElementById(AC.edit === "name" ? "acn" : "acm") as HTMLInputElement | null)?.focus(); return; }
  if (t.closest("[data-acretry]")) { AC.err = ""; sRender(); acLoad(true); return; }
  if (!d || AC.busy) return;
  if (t.closest("[data-accancel]")) {
    if (!LIVE) { d.pending = null; sRender(); return; }
    AC.busy = "cancel"; sRender();
    kyApi("account/email/cancel", {}).then(() => { d.pending = null; AC.link = ""; note(ic.check, "Email change cancelled", `You still sign in with ${d.email}.`, ""); })
      .catch(err => note(g("help", 14), "Couldn't cancel", err.message || "Try again in a minute.", "")).finally(() => { AC.busy = ""; acRender(); });
    return;
  }
  const out = t.closest<HTMLElement>("[data-acout]"), all = !out && t.closest("[data-acoutall]");
  if (out || all) {
    const id = out?.dataset.acout || "", x = d.sessions.find(y => y.id === id), n = d.sessions.filter(y => !y.current).length;
    const go = () => {
      const drop = () => { d.sessions = d.sessions.filter(y => all ? y.current : y.id !== id); };
      if (!LIVE) { drop(); sRender(); return; }
      AC.busy = all ? "all" : id; sRender();
      kyApi("account/signout", all ? { others: true } : { id }).then(r => { drop(); note(ic.check, all ? "Signed out everywhere else" : "Signed out", all ? `${r.signed_out || n} other device${(r.signed_out || n) === 1 ? "" : "s"} will need to sign in again.` : `${x?.device || "That device"} will need to sign in again.`, ""); })
        .catch(err => note(g("help", 14), "Couldn't sign out", err.message || "Try again in a minute.", "")).finally(() => { AC.busy = ""; acRender(); });
    };
    if (out) return go();
    ask({ title: n === 1 ? "Sign out the other device?" : `Sign out ${n} other devices?`, body: "You stay signed in here. Anywhere else will need a new sign-in code or link from your email.", confirm: "Sign out", danger: true }).then(ok => { if (ok) go(); });
  }
});
document.addEventListener("submit", e => {
  const f = e.target as HTMLElement; if (f.id !== "acnamef" && f.id !== "acmailf") return;
  e.preventDefault(); e.stopImmediatePropagation();
  const btn = f.querySelector(".sprim") as HTMLButtonElement, d = AC.d; if (btn.disabled || !d) return;
  const bad = (id: string, a: string, b: string) => { note(g("help", 14), a, b, ""); (document.getElementById(id) as HTMLInputElement).focus(); };
  const busy = (on: boolean, label = "") => { btn.disabled = on; if (label) btn.textContent = label; };
  if (f.id === "acnamef") {
    const name = (document.getElementById("acn") as HTMLInputElement).value.replace(/\s+/g, " ").trim();
    if (!name) return bad("acn", "Type your name", `${who(main)} uses it when talking to you.`);
    if (!LIVE) { acSetName(name); AC.edit = ""; sRender(); return; }
    busy(true, "Saving…");
    kyApi("account/name", { name }).then(r => { acSetName(r.name); AC.edit = ""; sRender(); note(ic.check, "Name saved", `${who(main)} will call you ${r.name}.`, ""); })
      .catch(err => { busy(false, "Save"); note(g("help", 14), "Couldn't save your name", err.message || "Try again in a minute.", ""); });
    return;
  }
  const email = (document.getElementById("acm") as HTMLInputElement).value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("acm", "Check the email", "Type the whole address, like you@example.com.");
  if (email === d.email.toLowerCase()) return bad("acm", "That's your email now", "Type the new address you want to sign in with.");
  if (!LIVE) { d.pending = { email, expires: Date.now() + 3600e3 }; AC.edit = ""; sRender(); return; }
  busy(true, "Sending…");
  kyApi("account/email", { email }).then(r => { d.pending = { email: r.sent_to, expires: r.expires }; AC.link = r.test_link || ""; AC.edit = ""; sRender();
    note(ic.check, `Check ${r.sent_to}`, "Open the link we sent there to switch. Until then, nothing changes.", ""); })
    .catch(err => { busy(false, "Send link"); note(g("help", 14), "Couldn't send the link", err.message || "Try again in a minute.", ""); });
}, true);
// Unsaved edits in Settings (unsaved.ts): another section, ✕, Esc, ⌘, or a reload ask first. Route changes don't (Settings floats over every page).
{ const sbusy = (id: string) => () => /…$/.test(document.querySelector(`#${id} .sprim`)?.textContent?.trim() || "");   // "Saving…" while it saves
  const leave = "[data-sgo],[data-sclose],[data-apps]";
  const v = (el: HTMLElement, ids: string[]) => JSON.stringify(ids.map(i => (el.querySelector(`#${i}`) as HTMLInputElement | null)?.value.trim() || ""));
  unsavedKind("login", { hash: false, leave: `${leave},[data-kyed],[data-addlogin],[data-addkey],[data-pipick]`, busy: sbusy("loginf"),
    active: () => S.open && S.sec === "keys" && !!(S.adding || KY.edit),
    title: el => el.dataset.was ? `Save changes to the login for ${el.dataset.was}?` : "Save this login?",
    body: el => el.dataset.was ? "You changed this login but haven't saved it." : "You started a login but haven't saved it.",
    state: el => v(el, ["lw", "lu", "lp", "ln"]),
    discard: () => { S.adding = false; KY.edit = null; S.eye = false; sRender(); } });
  unsavedKind("key", { hash: false, leave: `${leave},[data-kyed],[data-addlogin],[data-addkey],[data-pipick]`, busy: sbusy("keyf"),
    active: () => S.open && S.sec === "keys" && KY.addkey,
    title: () => "Save this key?", body: () => "You started a key but haven't saved it.",
    state: el => v(el, ["kn", "kh", "kv"]),
    discard: () => { KY.addkey = false; sRender(); } });
  unsavedKind("acname", { hash: false, leave: `${leave},[data-acedit]`, busy: sbusy("acnamef"),
    active: () => S.open && S.sec === "account" && AC.edit === "name",
    title: () => "Save your new name?", body: () => "You changed your name but haven't saved it.",
    state: el => JSON.stringify((el.querySelector("#acn") as HTMLInputElement | null)?.value.replace(/\s+/g, " ").trim() || ""),
    discard: () => { AC.edit = ""; sRender(); } });
  unsavedKind("byok", { hash: false, leave, busy: bykBusy,
    active: () => S.open && S.sec === BYK_SEC && bykEditing(),
    title: () => "Save your AI key settings?", body: () => "You changed them but haven't saved. Saving tests the connection first.",
    state: el => v(el, ["byk-base", "byk-key", "byk-model", "byk-fast"]),
    discard: () => { bykDiscard(); sRender(); } }); }
// Install 1Helm as an app (pwainstall.ts): only when this browser can install it and it isn't already the installed app.
function piRow() { const k = piKind(); return k ? `<h3>App</h3><div class="sc">${srow(I(PI_ICON, 17), "Install 1Helm app", piSub(k, phone()), sa(piLabel(k), "data-pwainst", "blue"), " data-pirow")}</div>` : ""; }
function secHtml(sec: string): string {
  if (!secShown(sec)) return "";
  switch (sec) {
    case "general": return `<h2>General</h2>
      <div class="sc">${srow(`<span class="sme">${esc(INITIALS)}</span>`, esc(PERSON), phone() ? "Name, sign-in email, devices" : `${esc(EMAIL)} · Name, sign-in email, devices`, chev(), nav("account"))}</div>
      <h3>Usage</h3>${phone() ? "" : `${usageCard()}${storCard()}`}<div class="sc">${costRow()}${spendPauseRow()}</div>
      <h3 data-settings-appearance>Appearance</h3>
      <div class="sc">${srow("", "Mode", "", `<div class="seg" role="radiogroup">${[["light", "sun", "Light"], ["dark", "moon", "Dark"], ["system", "mon", "Match my device"]].map(([k, i, l]) =>
        `<button class="${S.theme === k ? "on" : ""}" role="radio" aria-checked="${S.theme === k}" data-mode="${k}" title="${l}" aria-label="${l}">${g(i, 16)}</button>`).join("")}</div>`)}
</div>
      ${piRow()}
      <h3>Your AI</h3>
      <div class="sc">${apRow()}${bykRow()}</div>
      <div class="sdanger">${sa("Delete account", LIVE ? "data-delacct" : 'data-snote="delete"', "red")}</div>`;
    case "accounts": return `<h2>Connected accounts</h2><p class="slead">Let ${esc(who(main))} read and act in your apps. You can disconnect anytime.</p>
      ${LIVE ? `<div class="sc">${srow(g("mon"), "Computer connections", "Native SSH keys, sessions and Tailscale for each channel computer", chev(), nav(NETWORK_SEC))}</div>` : ""}
      ${LIVE ? cmHtml() : ""}<button class="sbrowse cxbrowse" data-apps>${ic.apps}<span>Browse all apps</span><em>1,500+</em>${ic.chev}</button>
      ${LIVE ? accountsHtml() : `<div class="sc">${srow(brand("google"), `${esc(EMAIL)}<em class="stag">Primary</em>`, "Connected Sep 26, 2026", `${ok("Connected")}${sa("Disconnect", 'data-snote="disc"', "mute")}`)}
        ${["gmail", "googlecalendar", "googledrive"].map(k => srow(brand(k), APP[k][0], APP[k][1], S.conn[k] ? `${ok("On")}${sa("Turn off", `data-conn="${k}"`, "mute")}` : sa("Enable", `data-conn="${k}"`, "blue"))).join("")}</div>`}
      <p class="sfine">You sign in on each app's own page. 1Helm never sees those passwords.</p>`;
    case "wallet": if (LIVE) return `<div class="shero"><span class="shico">${g("wallet", 26)}</span><h2>Wallet</h2><p>Let ${esc(who(main))} buy things for you. You approve every purchase on your phone before any money moves.</p></div>
      <div class="sc">${walletHtml()}</div>${linkAppHtml()}`;
    return `<div class="shero"><span class="shico">${g("wallet", 26)}</span><h2>Wallet</h2><p>Let ${esc(who(main))} buy things for you. You approve every purchase on your phone before any money moves.</p></div>
      <div class="sc">${srow(brand("stripe"), "Link by Stripe", S.link ? `${esc(EMAIL)} · You approve each purchase` : "Pay with the cards you've saved in Link", S.link ? `${ok("Added")}${sa("Remove", "data-link", "mute")}` : LIVE ? sa("Add", 'data-snote="wallet-chat"', "blue") : sa("Add", "data-link", "blue"))}
        ${S.link ? srow("", "Spending limit", `The most ${esc(who(main))} can ask for in one purchase`, `<span class="sval">$500</span>${chev()}`, snote("limit")) : ""}</div>
      ${S.link ? `<h3>Purchases</h3><div class="sc">${srow("", "Nothing bought yet", `Purchases ${esc(who(main))} makes will show up here with a receipt.`, "")}</div>` : ""}${linkAppHtml()}`;
    case "keys": if (LIVE) return keysLive(); return `<h2>Passwords & keys</h2><p class="slead">Logins and keys ${esc(who(main))} can use, without ever seeing the real password. 1Helm fills it in only on the site it belongs to.</p>
      ${S.adding ? `<form class="sc sform" id="loginf" data-unsaved="login" data-unsaved-key="new"><div class="sfh">${g("lock")}<b>Add a login</b></div>
          <label class="sf"><span>Website</span><input id="lw" placeholder="costco.com" autocomplete="off"></label>
          <label class="sf"><span>Username or email</span><input id="lu" autocomplete="off"></label>
          <label class="sf"><span>Password</span><span class="spw"><input id="lp" type="${S.eye ? "text" : "password"}" autocomplete="new-password"><button type="button" class="seye${S.eye ? " on" : ""}" data-eye aria-label="Show password">${g("eye", 17)}</button></span></label>
          <div class="sbtns"><button class="sprim" type="submit">Save login</button>${sa("Cancel", 'type="button" data-addlogin')}</div></form>` : ""}
      <h3>Logins</h3>
      <div class="sc">${S.logins.length ? S.logins.map((l, i) => srow(`<span class="favi">${esc(l.site[0].toUpperCase())}${logoOver(l.site, 38)}</span>`, esc(l.site), esc(l.user), sa("Remove", `data-rmlogin="${i}"`, "mute"))).join("") : srow("", "No logins yet", `Add one so ${esc(who(main))} can sign in for you.`, "")}</div>
      ${S.adding ? "" : `<div class="sadd">${sa(`${ic.plus}<span>Add a login</span>`, LIVE ? 'data-snote="addlogin"' : "data-addlogin", "blue")}</div>`}
      <h3>Keys</h3>
      <div class="sc">${S.keys.map(k => srow(`<span class="favi">${g("key", 16)}${logoOver(k.host, 38)}</span>`, `<code>${esc(k.name)}</code>`, `Only ever sent to ${esc(k.host)}`, sa("Remove", 'data-snote="rmkey"', "mute"))).join("")}</div>
      <p class="sfine">Tip: the key button next to the message box saves a login without leaving the chat.</p>`;
    case "perm": if (LIVE) return pmHtml() + (!hasFeature("connected_apps") ? `<div class="sc">${srow(g("mon"), "Computer connections", "SSH keys, sessions and Tailscale for each channel computer", chev(), nav(NETWORK_SEC))}</div>` : ""); return `<h2>Permissions</h2><p class="slead">When should your helper check with you first?</p>
      <h3>Your connected apps</h3><div class="sc" role="radiogroup">${radio("apps", "some", "Ask for important actions", "Before it sends, shares, buys or deletes something")}${radio("apps", "all", "Always ask", "Before anything it does in your apps")}</div>
      <h3>Websites</h3><div class="sc" role="radiogroup">${radio("web", "some", "Ask for important actions", "When it would send your info, or the site is new to it")}${radio("web", "all", "Always ask", "Before it visits any website")}</div>
      <h3>Always allowed</h3><div class="sc">${S.allowed.length ? S.allowed.map((a, i) => srow(`<span class="favi">${g("globe", 16)}${logoOver(a.site, 38)}</span>`, esc(a.site), `Allowed in ${esc(a.where)}`, sa("Remove", `data-rmallow="${i}"`, "mute"))).join("") : srow("", "Nothing yet", "When you tap “Always allow” on a request, it shows up here.", "")}</div>`;
    case "texting": {
      if (LIVE && !TX.loaded) { TX.loaded = true; fetch(`${LIVE.api}/texting`, { credentials: "same-origin" }).then(r => r.json()).then(d => { TX.st = d; if (S.open && S.sec === "texting") sRender(); }).catch(() => { TX.loaded = false; }); }   // a failed read is asked again the next time Settings draws
      const st = TX.st?.status, on = st === "connected", mid = st === "signup" || st === "awaiting_code";
      const sub = !LIVE ? "(•••) •••-4821" : on ? `Connected · texts ${esc(fmtTel(TX.st.phone))} from ${esc(fmtTel(TX.st.assigned))}` : mid ? "Almost done: finish setting it up" : TX.loaded && !TX.st ? "Checking…" : "Text your helper from your phone";
      const btn = !LIVE ? tg("text", "Texting") : on ? sa("Manage", `data-texting`, "mute") : sa(mid ? "Continue" : "Set up", `data-texting`, "blue");
      return `<h2>Texting</h2><p class="slead">Text ${esc(who(main))} from your phone like a friend, and get a text when something needs you.</p>
      <div class="sc">${srow(brand("imessage"), `Text with ${esc(who(main))}`, sub, btn)}${LIVE ? "" : srow("", "Quiet hours", "No texts from 10 PM to 7 AM unless it's urgent", tg("quiet", "Quiet hours"))}</div>`;
    }
    case "ambient": return `<h2>Ambient</h2><p class="slead">Connect devices and services that help ${esc(who(main))} remember your day.</p><div class="sc">${beeOverview()}</div>`;
    case "bee": return beeSec() + acueSec();
    case "device": return dpSec();   // devperm.ts
    case "notif": return nfHtml();   // notif.ts
    case "help": return `<h2>Help & support</h2><p class="slead">Stuck, or something looks wrong? We read every message.</p>
      <div class="sc">${touchy() ? "" : srow(g("kbd"), "Keyboard shortcuts", "", `${scLabel("shortcuts", false) ? `<kbd>${scLabel("shortcuts", false)}</kbd>` : ""}${chev()}`, nav("shortcuts"))}${srow(g("bug"), "Report an issue", "Tell us what happened. A screenshot helps.", chev(), ' role="button" tabindex="0" data-rpopen')}
        <a class="sr" href="${esc(rpMailto(LIVE?.slug || "", supportEmail))}">${g("msg")}<span class="srt"><b>Contact us</b><span>${esc(supportEmail)}</span></span>${chev()}</a></div>`;
    case BYK_SEC: return bykPage();
    case CMCP_SEC: return hasFeature("smart_routing") ? `${cmcpPage()}${cmodelsCard()}` : cmcpPage();
    case AP_SEC: return apPage();
    case NETWORK_SEC: return LIVE ? networkHtml() : "";
    case "account": return accountSec();
    case "shortcuts": return scPage();   // shortcuts.ts: every registered action, rebindable
    case "legal": return `<h2>Legal</h2>
      <div class="sc">${[["Terms of service", "https://1helm.com/terms/"], ["Privacy policy", "https://1helm.com/privacy/"], ["Open-source licenses", "https://github.com/gitcommit90/1Helm/blob/main/LICENSE"]].map(([label, href]) => `<a class="sr" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${label} (opens in a new tab)"><span class="srt"><b>${label}</b></span><span class="schev" aria-hidden="true">${g("ext", 15)}</span></a>`).join("")}</div>`;
  }
  return "";
}
function sDesk() {
  const cur = secParent(S.sec) || S.sec;
  return `<div class="sback" data-sclose></div><div class="smodal" role="dialog" aria-modal="true" aria-label="Settings">
    <nav class="snav"><div class="snh">Settings</div>${SECS.filter(([k]) => secShown(k)).map(([k, l, i]) => k ? `<button class="sn${k === cur ? " on" : ""}"${k === cur ? ' aria-current="page"' : ""} data-sgo="${k}">${g(i, 16)}<span>${l}</span></button>` : `<i class="snsep"></i>`).join("")}
      <span class="grow"></span><button class="sn" data-snote="logout">${g("out", 16)}<span>Log out</span></button></nav>
    <section class="sbody">${secParent(S.sec) ? `<button class="sbk" data-sgo="${secParent(S.sec)}">${ic.back}<span>${esc(secName(secParent(S.sec)))}</span></button>` : ""}${secHtml(S.sec)}</section>
    <button class="sx" data-sclose aria-label="Close settings">${g("x", 18)}</button></div>`;
}
function sPhone() {
  const back = secParent(S.sec);
  if (!S.sec) {
    const r = (k: string) => { const [, l, i] = SECS.find(x => x[0] === k)!; return srow(g(i), l, "", chev(), nav(k)); };
    return `<div class="smodal sphone" role="dialog" aria-modal="true" aria-label="Settings"><div class="sph"><span class="sp"></span><h1>Settings</h1><button class="cb" data-sclose aria-label="Close settings">${g("x", 20)}</button></div>
      <section class="sbody"><div class="sc">${accountRow(true)}</div>${usageCard()}${storCard()}
        <div class="sc">${["accounts", "wallet", "keys", "perm", "device", "texting", "ambient"].filter(secShown).map(r).join("")}</div>
        <div class="sc">${secShown("notif") ? r("notif") : ""}${secShown(CMCP_SEC) ? r(CMCP_SEC) : ""}${srow(g("sun"), "Appearance & more", "", chev(), nav("general"))}</div>
        <div class="sc">${r("help")}${r("legal")}</div>
        <div class="sc">${srow("", `<span class="red">Log out</span>`, "", "", snote("logout"))}</div></section></div>`;
  }
  return `<div class="smodal sphone sdet" role="dialog" aria-modal="true" aria-label="${esc(secName(S.sec))}"><div class="sph"><button class="cb" data-sgo="${back}" aria-label="Back">${ic.back}</button><h1>${esc(secName(S.sec))}</h1><span class="sp"></span></div>
    <section class="sbody">${secHtml(S.sec)}</section></div>`;
}
// Phone Settings is a stack of full-screen pages. Going to another page (dir 1 deeper, -1 back) slides once: the new page in from
// the right over the old one, or the old one off to the right over the new one, both opaque, so the channel underneath never shows
// (Captain, 10-07: opening a panel flickered the channel and jumped). Any other repaint (a list loading, a busy button) updates the
// page that's on screen in place, so it never restarts the slide.
const SLIDE_MS = 240, SLIDE_EASE = "cubic-bezier(.2,.8,.2,1)";
let slideEnd: (() => void) | null = null;
const settingsGestureBound = new WeakSet<HTMLElement>();
let settingsContact: { page: HTMLElement; repaint: boolean; keep: boolean } | null = null;
function bindSettingsGesture(page: HTMLElement) {
  if (settingsGestureBound.has(page)) return; settingsGestureBound.add(page);
  bindTouchSwipe(page, (target, touch) => {
    // The whole page participates, including action rows; taps still activate them.
    // Leave the browser edge, editable/value controls and horizontal scrollers alone.
    if (!S.open || page.inert || touch.clientX < 24 || gestureValueControl(target) || scrollerOwns(target, page, "x")) return null;
    const sec = S.sec;
    return { axis: "x", direction: 1, distance: 100, valid: () => S.open && S.sec === sec && !page.inert,
      move: () => {}, // existing Settings stack animates the correct parent after committing
      finish: commit => { if (commit) guarded(() => { if (sec) sGo(secParent(sec)); else closeSettings(); }); } };
  });
  // Async account/list updates must not remove the touch target: subsequent touch
  // events follow that original node, even after it has been detached from the page.
  page.addEventListener("touchstart", () => { if (!page.inert && !settingsContact) settingsContact = { page, repaint: false, keep: true }; }, { passive: true });
  const release = (e: TouchEvent) => {
    if (e.touches.length || settingsContact?.page !== page) return;
    const contact = settingsContact; settingsContact = null;
    // Let the touch's compatibility click activate its original button first.
    setTimeout(() => { if (contact.repaint && S.open && page === document.querySelector("#setw .smodal.sphone:not(.sout)")) sRender(contact.keep); }, 0);
  };
  page.addEventListener("touchend", release);
  page.addEventListener("touchcancel", release);
}
function sRender(keep = true, dir = 0) {
  cmcpBefore();
  if (LIVE) networkVisible(S.open && S.sec === NETWORK_SEC);
  const w = document.getElementById("setw"); if (!w || !S.open) return;
  if (dir || !phone()) slideEnd?.();   // another page while one is still sliding: that slide finishes at once
  const cur = w.querySelector<HTMLElement>(".smodal.sphone");
  if (dir || !phone()) settingsContact = null;
  else if (settingsContact?.page === cur) { settingsContact.repaint = true; settingsContact.keep &&= keep; return; }
  const b = w.querySelector(".sbody") as HTMLElement | null, top = keep && b ? b.scrollTop : 0;
  if (phone() && cur) {
    const t = document.createElement("template"); t.innerHTML = sPhone().trim();
    const page = t.content.firstElementChild as HTMLElement;
    if (!dir) {   // same page: new contents, same element (a running open fade or slide carries on)
      for (const a of [...cur.attributes]) if (!page.hasAttribute(a.name)) cur.removeAttribute(a.name);
      const keepCls = ["stop", "sunder"].filter(c => cur.classList.contains(c));
      for (const a of [...page.attributes]) cur.setAttribute(a.name, a.value);
      cur.classList.add(...keepCls);
      cur.replaceChildren(...page.childNodes);
    } else {
      cur.querySelectorAll("[id]").forEach(e => e.removeAttribute("id")); cur.inert = true; cur.setAttribute("aria-hidden", "true"); cur.classList.add("sout");
      w.insertBefore(page, cur);   // the live page first in the DOM; z-index decides which one is on top
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const o = { duration: SLIDE_MS, easing: SLIDE_EASE }, fwd = dir > 0;
        page.classList.add(fwd ? "stop" : "sunder"); w.classList.add("sslide");
        const an = [page.animate({ transform: fwd ? ["translateX(100%)", "none"] : ["translateX(-28%)", "none"] }, o),
          cur.animate({ transform: fwd ? ["none", "translateX(-28%)"] : ["none", "translateX(100%)"] }, o)];
        slideEnd = () => { slideEnd = null; an.forEach(a => a.cancel()); cur.remove(); page.classList.remove("stop", "sunder"); w.classList.remove("sslide"); };
        an[0].finished.then(() => slideEnd?.(), () => {});
      } else cur.remove();
    }
  } else w.innerHTML = phone() ? sPhone() : sDesk();
  const gesturePage = w.querySelector<HTMLElement>(".smodal.sphone"); if (gesturePage) bindSettingsGesture(gesturePage);
  const nb = w.querySelector(".sbody") as HTMLElement | null; if (nb) nb.scrollTop = top;
  cmcpAfter();   // Advanced: typed fields back in, polling
  bykAfter();   // the typed AI key goes back into its field (never into the HTML)
  acctNoteAfter();   // an open account-note box keeps its focus
  pmAfter();
}
function openSettings(sec: string) {
  if (!secShown(sec)) sec = "general";
  closeMenu(); closeNew(); hideToast();
  CXP.page = 0; CXP.q = ""; acctNoteReset();   // Connected accounts starts at page 1 each time Settings opens
  let w = document.getElementById("setw"); if (!w) { w = document.createElement("div"); w.id = "setw"; document.body.appendChild(w); }
  S.open = true; S.sec = sec || (phone() ? "" : "general"); S.adding = KY.addkey = false; KY.edit = null; AC.edit = ""; KY.q = ""; KY.show = KY_FIRST; piDrop(); PI.done = null; sRender(false);
  requestAnimationFrame(() => requestAnimationFrame(() => w!.classList.add("on")));
  if (!touchy()) (w.querySelector(".sn.on, .sph .cb") as HTMLElement | null)?.focus();   // on touch a focus ring on ✕ just looks stuck
}
function closeSettings() { scReset(); const w = document.getElementById("setw"); S.open = false; settingsContact = null; networkVisible(false); slideEnd?.(); piDrop(); PI.done = null; if (!w) return; w.classList.remove("on"); setTimeout(() => { if (!S.open) w.innerHTML = ""; }, 240); }
function sGo(sec: string) { if (!secShown(sec)) sec = "general"; if (!S.open) return openSettings(sec); acctNoteReset(); if (sec !== "shortcuts") scReset(); if (!phone() && !sec) sec = "general"; if (sec === "account" && S.sec !== "account") AC.back = S.sec === "general" ? "general" : "";
  const depth = (k: string) => !k ? 0 : secParent(k) ? 2 : 1, dir = sec === S.sec ? 0 : depth(sec) < depth(S.sec) ? -1 : 1;
  AC.edit = ""; KY.edit = null; S.sec = sec; S.adding = KY.addkey = false; KY.q = ""; KY.show = KY_FIRST; piDrop(); PI.done = null; sRender(false, phone() ? dir : 0); }
// Reply actions retain the current task/hash and pass through the same unsaved
// editor guard as Settings navigation. No setting is changed by opening it.
document.addEventListener("click", e => {
  const button = (e.target as Element).closest<HTMLElement>("button[data-settings-link]");
  const id = settingsDestination(button?.dataset.settingsLink || ""); if (!id) return;
  e.preventDefault();
  guarded(() => {
    const target = settingsTarget(id, phone());
    sGo(target.section);
    if (id === "checkins") { pmFocusCheckins(); return; }
    const focus = "focus" in target ? target.focus : ".sbody h2, .sph h1";
    const el = document.getElementById("setw")?.querySelector<HTMLElement>(focus);
    if (el) { el.tabIndex = -1; el.scrollIntoView({ block: "start" }); el.focus({ preventScroll: true }); }
  });
});
function openMenu() {
  let w = document.getElementById("smenuw"); if (!w) { w = document.createElement("div"); w.id = "smenuw"; document.body.appendChild(w); }
  S.menu = true;
  w.innerHTML = `<div class="smenu" role="menu"><button role="menuitem" data-sgo="shortcuts">${g("kbd")}<span>Keyboard shortcuts</span>${scLabel("shortcuts") ? `<kbd>${scLabel("shortcuts")}</kbd>` : ""}</button>
    ${hasFeature("connected_apps") ? `<button role="menuitem" data-apps>${ic.apps}<span>Apps</span>${scLabel("apps") ? `<kbd>${scLabel("apps")}</kbd>` : ""}</button>` : ""}<button role="menuitem" data-rpopen>${g("bug")}<span>Report an issue</span></button>
    ${piKind() ? `<button role="menuitem" data-pwainst>${I(PI_ICON, 16)}<span>Install 1Helm app</span></button>` : ""}<hr><button role="menuitem" data-sgo="general">${g("gear")}<span>Settings</span>${scLabel("settings") ? `<kbd>${scLabel("settings")}</kbd>` : ""}</button></div>`;
  (w.querySelector("button") as HTMLElement).focus();
}
function closeMenu() { S.menu = false; const w = document.getElementById("smenuw"); if (w) w.innerHTML = ""; }
const SNOTE: Record<string, [string, string]> = {
  account: ["Your account", "Opens password, sign-in and personal details."], plan: ["Change plan", "Opens plans and billing."], credits: ["Add credits", "Opens a one-time top-up."],
  lang: ["Language", "Opens the language list."], delete: ["Delete account", "Asks you to confirm twice, then deletes everything."], disc: ["Disconnect Google", "Turns off Gmail, Calendar and Drive for your helper."],
  limit: ["Spending limit", "Lets you pick the most your helper can ask for."], rmkey: ["Remove key", "Removes it from every channel."], bug: ["Report an issue", "Opens a short form with an optional screenshot."],
  contact: ["Contact us", `Opens an email to ${supportEmail}.`], apps: ["Download apps", "Opens the Mac, iPhone and Android downloads."], logout: ["Log out", "Signs you out on this device."], "google-next": ["Connect Google", "Google connection is the next fresh-customer slice; this account is not connected."], "wallet-chat": ["Wallet", "Ask your helper to set up Link when you want it to make a purchase."], "connections-next": ["Connected accounts", "More one-click app connections are the next fresh-customer slice."],
  terms: ["Terms of service", "Opens in a new tab."], privacy: ["Privacy policy", "Opens in a new tab."], licenses: ["Open-source licenses", "Opens in a new tab."],
};
document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  if (S.menu && !t.closest(".smenu") && !t.closest("[data-smenu]")) closeMenu();
  if (t.closest("[data-smenu]")) { S.menu ? closeMenu() : openMenu(); return; }
  const go = t.closest<HTMLElement>("[data-sgo]"); if (go) { e.preventDefault(); closeMenu(); sGo(go.dataset.sgo!); return; }
  // Install 1Helm app (pwainstall.ts): the browser's own install prompt, inside this tap; or our steps sheet on Safari / iPhone.
  if (t.closest("[data-pwainst]")) { e.preventDefault(); closeMenu(); if (mState.sheet === "set") closeSheet(); piInstall((a, b) => note(ic.check, a, b, "")); return; }
  if (LIVE && t.closest("[data-texting]")) { location.assign(`/w/${LIVE.slug}/texting`); return; }
  if (LIVE && cmClick(t)) return;   // How apps connect (apps-mode.ts)
  if (LIVE && t.closest("[data-cxretry]")) { CX.err = ""; cxLoad(true); sRender(); return; }
  if (LIVE && t.closest("[data-crt]")) { CR.open = !CR.open; CR.pick = 0; CR.info = null; sRender(); return; }
  const crJson = (path: string, body: object) => fetch(`${LIVE.api}${path}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  const crFail = (msg?: string) => { CR.busy = 0; CR.pick = 0; CR.info = null; sRender(); note(g("help", 14), "Couldn't add credits", msg || "Try again in a minute.", ""); };
  const crp = t.closest<HTMLElement>("[data-crp]"); if (LIVE && crp && !CR.busy) {   // step 1: ask the server for the saved card and a confirm token; nothing is charged yet
    const n = +crp.dataset.crp!; CR.pick = n; CR.info = null; sRender();
    crJson("/topup/confirm", { pack: n }).then(d => { if (CR.pick !== n) return; if (!d.confirm) return crFail(d.error); CR.info = { card: d.card, confirm: d.confirm }; sRender(); }).catch(() => crFail());
    return;
  }
  if (LIVE && t.closest("[data-crno]") && !CR.busy) { CR.pick = 0; CR.info = null; sRender(); return; }
  if (LIVE && t.closest("[data-crgo]") && !CR.busy && CR.pick && CR.info) {   // step 2: the person confirmed, so the server may charge
    const n = CR.pick; CR.busy = n; sRender();
    crJson("/topup", { pack: n, confirm: CR.info.confirm }).then(d => {
      if (d.url) { location.assign(d.url); return; }
      if (d.status === "succeeded") { note(ic.check, `$${n} added`, "It shows in your balance in a few seconds.", ""); creditsRefresh(); }
      else note(g("help", 14), "Couldn't add credits", d.error || "Try again in a minute.", "");
      CR.busy = 0; CR.open = false; CR.pick = 0; CR.info = null; sRender(); }).catch(() => crFail());
    return;
  }
  if (LIVE && t.closest("[data-lkon]") && !LK.busy) {
    LK.busy = true; sRender();
    fetch(`${LIVE.api}/link/connect`, { method: "POST", credentials: "same-origin" }).then(r => r.json()).then(d => {
      LK.busy = false; if (d.error) { note(g("help", 14), "Couldn't open Link", d.error, ""); sRender(); return; }
      LK.st = { connected: false, pending: true, phrase: d.phrase, url: d.url }; if (d.url) window.open(d.url, "_blank", "noopener");
      if (!LK.poll) LK.poll = window.setInterval(loadLink, 5000); sRender(); }).catch(() => { LK.busy = false; sRender(); });
    return;
  }
  if (LIVE && t.closest("[data-lkoff]") && !LK.busy) {
    ask({ title: "Remove Link?", body: `${who(main)} won't be able to buy things until you add it again.`, confirm: "Remove", danger: true }).then(ok => {
      if (!ok || LK.busy) return;
      LK.busy = true; sRender(); fetch(`${LIVE.api}/link/disconnect`, { method: "POST", credentials: "same-origin" }).then(() => { LK.busy = false; LK.st = { connected: false }; sRender(); }).catch(() => { LK.busy = false; sRender(); });
    });
    return;
  }
  const sn = t.closest<HTMLElement>("[data-snote]"); if (sn) {
    closeMenu();
    if (LIVE && sn.dataset.snote === "logout") {
      fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).then(r => {
        if (r.status !== 204) throw new Error("Logout failed");
        location.assign("/");
      }).catch(() => note(g("help", 14), "Couldn't log out", "We couldn't confirm that you were logged out. Please try again.", ""));
      return;
    }
    const [a, b] = SNOTE[sn.dataset.snote!] ?? ["Coming soon", ""]; note(g("help", 14), a, `${b}${LIVE ? "" : " (Not wired up in the sandbox.)"}`, ""); return;
  }
  if (!S.open) return;
  if (t.closest("[data-sclose]")) { closeSettings(); return; }
  const md = t.closest<HTMLElement>("[data-mode]"); if (md) { S.theme = md.dataset.mode!; localStorage.setItem("v3theme", S.theme); applyTheme(); sRender(); return; }
  const sw = t.closest<HTMLElement>("[data-sw]"); if (sw) { const k = sw.dataset.sw!; S.sw[k] = !S.sw[k]; sw.classList.toggle("on", S.sw[k]); sw.setAttribute("aria-checked", String(S.sw[k])); return; }
  if (LIVE && pmClick(t)) return;   // perms.ts: level, Remove
  if (LIVE && networkClick(t)) return;
  const pm = t.closest<HTMLElement>("[data-perm]"); if (pm) { const [a, v] = pm.dataset.perm!.split(":"); S.perm[a] = v; sRender(); return; }
  const cn = t.closest<HTMLElement>("[data-conn]"); if (cn) { const k = cn.dataset.conn!; S.conn[k] = !S.conn[k]; sRender(); note(ic.check, `${APP[k][0]} ${S.conn[k] ? "connected" : "turned off"}`, S.conn[k] ? `${who(main)} can use it now.` : `${who(main)} can't use it anymore.`, ""); return; }
  if (t.closest("[data-link]")) { S.link = !S.link; sRender(); if (S.link) note(ic.check, "Link added", "You'll approve every purchase in the Link app.", ""); return; }
  if (t.closest("[data-addlogin]")) { S.adding = !S.adding; KY.addkey = false; KY.edit = null; S.eye = false; sRender(); if (S.adding) ($("#lw") as HTMLInputElement).focus(); return; }
  if (LIVE && t.closest("[data-addkey]")) { KY.addkey = !KY.addkey; S.adding = false; S.eye = false; sRender(); if (KY.addkey) ($("#kn") as HTMLInputElement).focus(); return; }
  if (t.closest("[data-eye]")) { const b = t.closest<HTMLElement>("[data-eye]")!; S.eye = !S.eye; const i = $(`#${b.dataset.eye || "lp"}`) as HTMLInputElement; i.type = S.eye ? "text" : "password"; b.classList.toggle("on", S.eye); return; }
  if (LIVE && t.closest("[data-pipick]") && !PI.busy) { ($("#pifile") as HTMLInputElement | null)?.click(); return; }
  if (LIVE && t.closest("[data-picancel]") && !PI.busy) { piDrop(); kyRender(); return; }
  if (LIVE && t.closest("[data-pidone]")) { PI.done = null; kyRender(); return; }
  if (LIVE && t.closest("[data-piwhy]")) { PI.why = !PI.why; piRender(); return; }
  if (LIVE && t.closest("[data-pigo]")) { piGo(); return; }
  if (LIVE && t.closest("[data-kymore]")) { KY.show += KY_MORE; kyListPaint(); return; }
  if (LIVE && t.closest("[data-kyretry]")) { KY.err = ""; KY.logins = KY.keys = null; sRender(); kyLoad(true); return; }
  const kl = t.closest<HTMLElement>("[data-kyrml]"); if (LIVE && kl && !KY.busy) {
    const site = kl.dataset.kyrml!, username = kl.dataset.kyu ?? "";
    ask({ title: `Remove the login for ${site}?`, body: `${username ? `${username} on ${site}` : site}: ${who(main)} won't be able to sign in there for you until you add it again.`, confirm: "Remove", danger: true }).then(ok => {
      if (!ok || KY.busy) return;
      KY.busy = `l:${site}\n${username}`; kyRender();
      kyApi("logins/delete", { site, username }).then(() => { KY.logins = (KY.logins || []).filter(x => !(x.site === site && (x.username || "") === username)); note(ic.check, "Login removed", `${who(main)} can't sign in to ${site}${username ? ` as ${username}` : ""} for you anymore.`, ""); })
        .catch(err => note(g("help", 14), "Couldn't remove that login", err.message || "Try again in a minute.", "")).finally(() => { KY.busy = ""; kyRender(); });
    });
    return;
  }
  // Edit one login: its form opens in place of its row; the saved note loads into it (the password never comes back).
  const ke = t.closest<HTMLElement>("[data-kyed]"); if (LIVE && ke && !KY.busy) {
    const site = ke.dataset.kyed!, username = ke.dataset.kyu ?? "", ed = { site, username, note: null as string | null };
    KY.edit = ed; S.adding = KY.addkey = false; S.eye = false; kyRender(); ($("#lp") as HTMLInputElement | null)?.focus();
    kyApi(`logins/note?site=${encodeURIComponent(site)}&username=${encodeURIComponent(username)}`).then(d => { ed.note = String(d.note || ""); })
      .catch(() => { ed.note = ""; }).finally(() => { if (KY.edit !== ed) return; const keep = ["lw", "lu", "lp"].map(i => ($(`#${i}`) as HTMLInputElement | null)?.value); kyListPaint(); ["lw", "lu", "lp"].forEach((i, n) => { const el = $(`#${i}`) as HTMLInputElement | null; if (el && keep[n] != null) el.value = keep[n]!; }); });
    return;
  }
  if (LIVE && t.closest("[data-kyedx]")) { KY.edit = null; S.eye = false; kyRender(); return; }
  const kk = t.closest<HTMLElement>("[data-kyrmk]"); if (LIVE && kk && !KY.busy) {
    const name = kk.dataset.kyrmk!;
    ask({ title: `Remove the key ${name}?`, body: "Tasks and scheduled jobs that use it will stop working until you add it again.", confirm: "Remove", danger: true }).then(ok => {
      if (!ok || KY.busy) return;
      KY.busy = `k:${name}`; kyRender();
      kyApi("vault/delete", { name }).then(() => { KY.keys = (KY.keys || []).filter(x => x.name !== name); note(ic.check, "Key removed", `${name} is gone from every channel.`, ""); })
        .catch(err => note(g("help", 14), "Couldn't remove that key", err.message || "Try again in a minute.", "")).finally(() => { KY.busy = ""; kyRender(); });
    });
    return;
  }
  const rl = t.closest<HTMLElement>("[data-rmlogin]"); if (rl) { const [x] = S.logins.splice(+rl.dataset.rmlogin!, 1); sRender(); note(ic.check, "Login removed", x.site, ""); return; }
  const ra = t.closest<HTMLElement>("[data-rmallow]"); if (ra) { const [x] = S.allowed.splice(+ra.dataset.rmallow!, 1); sRender(); note(ic.check, "Removed", `Your helper will ask before using ${x.site} again.`, ""); return; }
});
document.addEventListener("submit", e => {
  const f = e.target as HTMLElement;
  if (LIVE && (f.id === "loginf" || f.id === "keyf")) {
    e.preventDefault(); e.stopImmediatePropagation();
    const btn = f.querySelector(".sprim") as HTMLButtonElement; if (btn.disabled) return;
    const v = (id: string) => ($(`#${id}`) as HTMLInputElement).value, bad = (id: string, a: string, b: string) => { note(g("help", 14), a, b, ""); $(`#${id}`).focus(); };
    let path: string, body: any, done: (d: any) => void;
    if (f.id === "loginf") {
      const site = normSite(v("lw")), username = v("lu").trim(), password = v("lp"), noteTxt = v("ln").trim(), was = f.dataset.was != null ? { site: f.dataset.was, username: f.dataset.wasu || "" } : null;
      if (!site || !okSite(site)) return bad("lw", "Check the website", "Type the site's address, like costco.com.");
      if (!password && !was) return bad("lp", "Add the password", "Your helper needs it to sign in for you.");
      ($("#lw") as HTMLInputElement).value = site;
      path = "logins"; body = { site, username, password, note: noteTxt, ...(was ? { was } : {}) };
      const dup = !was && (KY.logins || []).some(x => x.site === site && (x.username || "") === username);
      done = d => { const gone = (x: any, s: string, u: string) => x.site === s && (x.username || "") === (u || "");
        KY.logins = [...(KY.logins || []).filter(x => !gone(x, d.site, d.username) && !(was && gone(x, was.site, was.username))), { site: d.site, username: d.username, created_at: Date.now(), ...(d.has_note || (!was && noteTxt) ? { has_note: true } : {}) }].sort((a, b) => a.site.localeCompare(b.site) || String(a.username || "").localeCompare(String(b.username || ""))); S.adding = false; KY.edit = null;
        const acct = `${d.site}${d.username ? ` · ${d.username}` : ""}`;
        if (d.merged) note(ic.check, "Logins merged", `${acct} was already saved, so the two are now one login.`, "");
        else if (d.updated || dup) note(ic.check, "Login updated", `${acct} was already saved. Its password is replaced, not added twice.`, "");
        else note(ic.check, was ? "Login updated" : "Login saved", `${acct} · ${who(main)} can sign in now.`, ""); };
    } else {
      const name = v("kn").trim().toUpperCase().replace(/[\s-]+/g, "_"), hosts = v("kh").split(/[\s,]+/).map(normHost).filter(Boolean), value = v("kv");
      if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(name)) return bad("kn", "Check the name", "Use letters, numbers and _ and start with a letter, like OPENWEATHER_KEY.");
      if (!hosts.length || hosts.some(h => !/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/.test(h))) return bad("kh", "Check the sites", "Type the address the key is for, like api.openweathermap.org. Separate several with commas.");
      if (!value) return bad("kv", "Add the key", "Paste the key from the service's website.");
      if (value.length > 8000) return bad("kv", "That key is too long", "Keys can be up to 8,000 characters.");
      ($("#kn") as HTMLInputElement).value = name; ($("#kh") as HTMLInputElement).value = hosts.join(", ");
      path = "vault"; body = { name, hosts, value };
      done = d => { KY.keys = [...(KY.keys || []).filter(x => x.name !== d.name), { name: d.name, hosts: d.hosts, created_at: Date.now() }].sort((a, b) => a.name.localeCompare(b.name)); KY.addkey = false;
        note(ic.check, "Key saved", `${who(main)} can use $${d.name} with ${d.hosts.join(", ")}.`, ""); };
    }
    const label = btn.textContent; btn.disabled = true; btn.textContent = "Saving…";
    kyApi(path, body).then(d => { S.eye = false; done(d); sRender(); })
      .catch(err => { btn.disabled = false; btn.textContent = label; note(g("help", 14), f.id === "loginf" ? "Couldn't save the login" : "Couldn't save the key", err.message || "Try again in a minute.", ""); });
    return;
  }
  if (f.id === "loginf") {
    e.preventDefault(); e.stopImmediatePropagation();
    const w = ($("#lw") as HTMLInputElement).value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""), u = ($("#lu") as HTMLInputElement).value.trim(), p = ($("#lp") as HTMLInputElement).value;
    if (!w) { $("#lw").focus(); return; } if (!p) { $("#lp").focus(); return; }
    S.logins.unshift({ site: w, user: u || "No username" }); S.adding = false; sRender(); note(ic.check, "Login saved", `${w} · ${who(main)} can sign in now.`, "");
  }
}, true);
window.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.querySelector(".cmback")) return;   // the model picker (custom-models.ts) closes first; Settings stays open behind it
  if (e.key === "Escape" && S.menu) { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(); return; }
  if (e.key === "Escape" && S.open) { e.preventDefault(); e.stopImmediatePropagation(); const form = S.adding || KY.addkey || KY.edit || AC.edit || ((PI.plan || PI.err) && !PI.busy), sec = S.sec;
    guarded(() => { if (form) { S.adding = KY.addkey = false; KY.edit = null; AC.edit = ""; piDrop(); sRender(); } else if (phone() && sec) sGo(secParent(sec)); else closeSettings(); }); return; }
  if (S.open && (e.key === "Enter" || e.key === " ")) { const r = (e.target as HTMLElement).closest?.<HTMLElement>('[role="button"]'); if (r) { e.preventDefault(); r.click(); } }
}, true);
matchMedia("(max-width: 767px)").addEventListener("change", () => { if (S.open) { if (!phone() && !S.sec) S.sec = "general"; sRender(false); } });

// ---------- Live mode (1Helm Cloud): tasks, replies, status, approvals come from the channel's resident ----------
const HOST_OF = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
function applySrv(x: Session, v: any) {
  if (v && Number(v.title_revision || 0) < Number(x.srv?.title_revision || 0)) v = { ...v, title: x.title, title_manual: x.srv.title_manual, title_revision: x.srv.title_revision };
  if (!v) return; x.srv = v; x.id = v.id; x.title = v.title; x.pinned = v.pinned; x.done = v.done; x.updated = v.updated;
  if (route().s !== x) x.unread = v.unread;
  if (!x.streaming) { x.state = v.state === "working" ? "working" : "idle"; x.rawLine = v.line || ""; }
  x.status = v.state === "waiting" ? "waiting" : v.state === "watching" ? "open" : "resolved";
}
function liveLine(x: Session) {
  const w = who(chOf(x)), v = x.srv || {};
  if (x.done) return "Done";
  if (v.queued && !x.streaming) return "Waiting · starts when another task finishes";   // 3 tasks already working (spendguard.js)
  if (x.streaming || x.state === "working") return `${w} is ${x.rawLine || v.line || "thinking"}…`;
  if (v.state === "waiting") return v.waiting === "checkin" ? "Waiting on you · keep going or stop here" : v.waiting === "browser" ? "Waiting on you in the browser" : v.waiting === "link" ? "Waiting on you · approve the purchase in Link" : v.waiting === "plan" ? "Waiting on you · a plan to approve" : v.waiting === "interview" ? "Waiting on your answers" : (v.waiting === "question" || v.waiting === "answer") ? "Waiting for your answer" : "Waiting on you · approve a request";
  if (v.state === "watching") return `Watching · ${v.jobs} scheduled ${v.jobs === 1 ? "check" : "checks"}`;
  // First real sentence of the latest reply ("1." or "Done!" alone isn't useful), capped for one line.
  const parts = plainPreview(String(v.preview || "")).replace(/^\s*(\d+[.)]|[-•])\s*/, "").split(/(?<=[.!?])\s+/);
  let p = ""; for (const x of parts) { p = p ? `${p} ${x}` : x; if (p.length >= 24) break; }
  p = p.replace(/\s*\d+[.)]$/, "").replace(/:$/, "");
  return p ? (p.length > 110 ? p.slice(0, 108).replace(/\s+\S*$/, "") + "…" : p) : "Ready for you";
}
async function api(path: string, body?: any, options?: { signal?: AbortSignal }) {
  const r = await fetch(`${LIVE!.api}${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), ...(options?.signal ? { signal: options.signal } : {}) });
  if (!r.ok && r.headers.get("content-type")?.includes("json") !== true) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function livePatch(ch: Channel, x: Session, b: any) {
  if (!LIVE || !x.srv) return;
  api(`/res/${ch.slug}/sessions/${x.id}`, b).then(v => { if (!v.error) { const u = x.unread; applySrv(x, v); if (b.seen) x.unread = false; else x.unread = u && !b.done; repaint(ch); } }).catch(() => {});
}
// Collapse runs of the same step ("working on its computer" ×6).
function toSteps(lines: string[]) {
  const out: string[] = []; let last = "", n = 0;
  const flush = () => { if (last) out.push(n > 1 ? `${last} ×${n}` : last); };
  for (const l of lines) { if (l === last) n++; else { flush(); last = l; n = 1; } } flush(); return out;
}
let nbPullT = 0;
if (LIVE) ivInit({ api, phone, helper: () => who(main), avatar: () => av(main, "av"), done: () => !!route().s?.done,
  notebook: () => { clearTimeout(nbPullT); nbPullT = window.setTimeout(() => nbSync(main, true), 700); },   // re-read the Notebook (new rows show as New, the count updates)
  home: () => { location.hash = `/${main.slug}`; },
  removed: sid => { const i = main.sessions.findIndex(x => String(x.id) === sid); if (i >= 0) main.sessions.splice(i, 1); location.hash = `/${main.slug}`; render(); note(ic.check, "Get to know you removed", "Your answers stay in the Notebook.", ""); } });
// Deleting (delete.ts): a chat, a channel, the account. The server deletes; here the app forgets what's gone.
hInit();
if (hasFeature("ambient")) beeLibInit({ live: !!LIVE, api, url: path => `${LIVE!.api}${path}`, repaint: () => { if (isLib()) libUpdate(); } }, t => { L.type = t; libUpdate(); });
secInit({ live: !!LIVE, api, tasks: slug => channels.find(c => c.slug === slug)?.sessions ?? [], cs: slug => csOf2(channels.find(c => c.slug === slug)!),
  setCs: (slug, cs) => { const c = channels.find(y => y.slug === slug); if (c) c.cs = cs; }, repaint: slug => { const c = channels.find(y => y.slug === slug); if (c) repaint(c); },
  patch: (slug, sid, body) => { const c = channels.find(y => y.slug === slug), x = c?.sessions.find(y => String(y.id) === String(sid)); if (c && x) livePatch(c, x, body); }, current: () => route().ch.slug });
if (LIVE) delInit({ api, note: (t, sub) => note(ic.trash, t, sub, ""), closeSheet: () => { if (mState.sheet) closeSheet(); },
  ...(!BOOT?.look ? { rename: renameTask } : {}),
  moveSection: (slug, sid, opener) => moveMenu(slug, sid, opener), canMove,
  working: (slug, sid) => { const x = channels.find(c => c.slug === slug)?.sessions.find(y => String(y.id) === sid); return !!x && stWorking(x); }, stop: (slug, sid) => void stopTask(slug, sid),
  chat: (slug, sid) => { const x = channels.find(c => c.slug === slug)?.sessions.find(y => String(y.id) === sid); return x ? { title: x.title, jobs: Number(x.srv?.jobs || 0) } : null; },
  channelName: slug => channels.find(c => c.slug === slug)?.name ?? null,
  chatGone: (slug, sid) => { const ch = channels.find(c => c.slug === slug); if (!ch) return; const i = ch.sessions.findIndex(y => String(y.id) === sid); const open = route().s === ch.sessions[i];
    if (i >= 0) ch.sessions.splice(i, 1); if (open) location.hash = `/${slug}`; render(); },
  channelGone: slug => { const i = channels.findIndex(c => c.slug === slug); if (i >= 0) channels.splice(i, 1); location.hash = `/${main.slug}`; render(); } });
// Cancel plan (cancel.ts): Settings → Usage, and the "your plan ends" banner while cancelling. Sandbox: a pretend plan.
if (hasFeature("billing")) bcxInit({ api: LIVE ? api : null, repaint: () => sRender(), note: (t, s) => note(ic.check, t, s, "") });
// Payment failed (pastdue.ts): read-only at once. Banner with Fix payment; composers off. Sandbox: ?pastdue.
if (hasFeature("billing")) pdInit({ api: LIVE ? api : null, boot: () => BOOT, note: (t, s) => note(g("help", 14), t, s, "") });
storInit({ api: LIVE ? api : null, repaint: () => sRender(), note: (t, s, good) => note(good ? ic.check : g("help", 14), t, s, ""),
  openUsage: () => { if (phone()) { if (!S.open) openSettings(""); else sGo(""); } else if (!S.open) openSettings("general"); else sGo("general"); },
  planName: () => String(BOOT?.account?.plan || "Plus"), boot: () => BOOT?.account?.storage || null,
  reload: () => location.assign(`${location.pathname}?plan=changed${location.hash}`), switchToByok: () => { void billingByok.bykSwitchNow(); } });
document.addEventListener("click", e => { if ((e.target as HTMLElement).closest("[data-stplans]")) { e.preventDefault(); storTogglePlans(); } }, true);
if (hasFeature("ambient")) beeInit({ live: LIVE, repaint: () => { if (S.open && S.sec === "ambient") sRender(); }, shown: () => S.open && S.sec === "ambient", note: (t, s, bad) => note(bad ? g("help", 14) : ic.check, t, s, ""), srow, helper: () => who(main), phone });
// Keyboard shortcuts (shortcuts.ts): the registry. Defaults, the old key that still works where the browser delivers it, what each does.
// ⌘N / ⌘T / ⌘W are the browser's in a tab (Chromium reserves them; only an installed app gets them), so New task is ⌘⇧O and ⌘N stays as an app-only alias.
registerShortcut({ id: "new-task", label: "New task", def: "Mod+Shift+O", alias: ["Mod+N"], run: () => { NT.open ? closeNew() : openNew(); } });
registerShortcut({ id: "search", label: "Search", def: "Mod+K", run: () => { if (!isLib()) sidebarReveal(); (document.getElementById(isLib() ? "lq" : "q") as HTMLInputElement | null)?.focus(); } });
registerShortcut({ id: "home", label: "Channel Home", def: "Mod+Shift+H", run: () => { go(route().ch.slug); ($("#box") as HTMLTextAreaElement | null)?.focus(); } });
registerShortcut({ id: "library", label: "Library", def: "Mod+Shift+L", run: () => { openLib(route().ch); } });
if (hasFeature("connected_apps")) registerShortcut({ id: "apps", label: "Apps", def: "Mod+Shift+A", run: () => { AS.open ? closeApps() : S.open ? guarded(() => openApps()) : openApps(); } });   // Apps closes Settings: ask about an unsaved form first
registerShortcut({ id: "nav-back", label: "Back", def: "Mod+[", note: "Alt+Left also goes back.", run: e => { navKey(e, "back"); } });
registerShortcut({ id: "nav-forward", label: "Forward", def: "Mod+]", note: "Alt+Right also goes forward.", run: e => { navKey(e, "forward"); } });
registerShortcut({ id: "jump", label: "Jump to a channel", def: "Mod+1-9", digits: true, run: (_e, n) => { const x = channels[(n || 0) - 1]; if (!x) return false; go(x.slug); } });
registerShortcut({ id: "settings", label: "Settings", def: "Mod+,", run: () => { S.open ? guarded(closeSettings) : openSettings("general"); } });
// Pomodoro (pomodoro.ts, pomodoro-global): start / pause-resume / stop. Option+letter types a symbol on a Mac, so these match the physical key (shortcuts.ts does that).
if (LIVE) {
  registerShortcut({ id: "pomodoro-start", label: "Start Pomodoro", def: "Alt+Shift+P", run: () => { void pomoShortcut("start"); } });
  registerShortcut({ id: "pomodoro-toggle", label: "Pause or resume Pomodoro", def: "Alt+Shift+O", run: () => { void pomoShortcut("toggle"); } });
  registerShortcut({ id: "pomodoro-stop", label: "Stop Pomodoro", def: "Alt+Shift+X", run: () => { void pomoShortcut("stop"); } });
}
registerShortcut({ id: "shortcuts", label: "Keyboard shortcuts", def: "Mod+/", run: () => { sGo("shortcuts"); } });
scInit({ live: LIVE, boot: BOOT?.account?.shortcuts, slug: LIVE?.slug || "sandbox", repaint: () => { if (S.open && S.sec === "shortcuts") sRender(); },
  relabel: () => { render(); }, note: (t, sub, bad) => note(bad ? g("help", 14) : ic.check, t, sub, ""), srow, sa });
nfInit({ live: LIVE, look: !!BOOT?.look, blocked: () => dpSheetOpen(), texting: hasFeature("texting"), ambient: hasFeature("ambient"), repaint: () => { if (S.open && S.sec === "notif") sRender(); }, note: (t, s, bad) => note(bad ? g("help", 14) : ic.check, t, s, ""), srow, helper: () => who(main) });
rpInit({ live: LIVE, before: () => { closeMenu(); if (mState.sheet === "set") closeSheet(); } , note: (t, s) => note(ic.check, t, s, "") });
if (hasFeature("smart_routing")) cmodelsInit({ api: LIVE ? (path, init) => fetch(`${LIVE.api}/${path}`, { method: init?.method || "GET", credentials: "same-origin", cache: "no-store", ...(init?.body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}) })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok || d?.error) throw new Error(typeof d?.error === "string" ? d.error : `Something went wrong (${r.status}).`); return d; }) : null,
  repaint: () => sRender(), shown: () => S.open && S.sec === CMCP_SEC, srow: (i, t, s, r, a = "") => srow(i, t, s, r, a), ask: o => ask(o),
  openAdvanced: () => { if (S.open) sGo(CMCP_SEC); else openSettings(CMCP_SEC); }, version: String((LIVE as any)?.v || ""), noteBoot: v => { if (BOOT?.account) BOOT.account.custom_models = v; } }, BOOT?.account?.custom_models);
if (hasFeature("connected_apps")) cmcpInit({ api: LIVE ? (path, init) => fetch(`${LIVE.api}/${path}`, { method: init?.method || "GET", credentials: "same-origin", ...(init?.body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}) })
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) { const er = d?.error, e: any = new Error((typeof er === "string" ? er : er?.message) || `Something went wrong (${r.status}).`); e.status = r.status; e.code = er?.code; throw e; } return d; }) : null,
  repaint: () => sRender(), shown: () => S.open && S.sec === CMCP_SEC, srow: (i, t, s, r, a = "") => srow(i, t, s, r, a), icon: (k, z = 17) => G[k] ? g(k, z) : (ic as any)[k] || "",
  ask: o => ask(o), note: (good, t, s) => note(good ? ic.check : g("help", 14), t, s, ""), go: url => location.assign(url) });
bykInit({ api: LIVE ? api : null, orStart: LIVE ? `${LIVE.api.replace(/\/api$/, "")}/byok/openrouter/start` : null, repaint: () => sRender(), open: () => openSettings(BYK_SEC), note: (good, t, s) => note(good ? ic.check : g("help", 14), t, s, ""), who: () => who(main),
  srow: (i, t, s, r, a = "") => srow(i, t, s, r, a), icon: (k, z = 17) => G[k] ? g(k, z) : (ic as any)[k] || "", shown: () => S.open && (S.sec === "general" || S.sec === BYK_SEC || (phone() && !S.sec)),
  // Add credits (a reply's "Add credits" link, the backup-in-use banner): Settings → Usage with the $10 / $25 / $50 picker open.
  credits: () => { CR.open = true; if (phone()) { if (!S.open) openSettings(""); else sGo(""); } else if (!S.open) openSettings("general"); else sGo("general");
    setTimeout(() => document.querySelector(".crpick")?.scrollIntoView({ block: "center", behavior: "smooth" }), 120); } });
if (LIVE) dictInit({ api: LIVE.api, note: (t, s) => note(ic.mic, t, s, "") });
// A new build was deployed: reload silently at a safe moment (src/auto-reload.ts). Uploads or attachments not sent yet, dictation and Live notes recording block it.
if (LIVE) installAutoReload({ api: LIVE.api, loaded: LIVE.v || new URL(import.meta.url).searchParams.get("v") || "", busy: () => dictActive() || micInfo().state !== "off" || Object.values(UP).some(l => l.length > 0) });
// Location + microphone (devperm.ts): Settings → Location & mic, the coarse fix sent with messages, and (after boot) the once-per-device sheet.
dpInit({ api: LIVE?.api || null, note: (t, s, bad) => note(bad ? g("help", 14) : ic.check, t, s, ""), repaint: () => { if (S.open && S.sec === "device") sRender(); },
  shown: () => S.open && S.sec === "device", helper: () => who(main), srow, sa, look: !!BOOT?.look,
  nf: { perm: nfPerm, ask: nfAsk, elsewhere: nfElsewhere } });   // the installed app's sheet covers notifications too
// Install 1Helm app (pwainstall.ts): the browser offered it, or it got installed. Repaint the places the button lives.
piOn(() => { if (S.open && S.sec === "general") sRender(); if (S.menu) openMenu();
  const sh = document.querySelector("#sheet .sheet"); if (mState.sheet === "set" && sh) sh.innerHTML = `<i class="grab"></i>${sheetHtml("set")}`; });
// Scheduled (scheduled.ts): one view for repeats, follow-ups and Send later, across channels. No count on its nav entries;
// schPaint() keeps the open view current.
schInit({ live: !!LIVE, api, channels: () => channels, helper: slug => who(channels.find(c => c.slug === slug) ?? main), note: (t, b) => note(ic.clock, t, b, ""),
  task: (slug, sid) => channels.find(c => c.slug === slug)?.sessions.find(x => String(x.id) === String(sid))?.title ?? null,
  open: (slug, sid) => { location.hash = `/${slug}/s/${sid}`; }, changed: () => schPaint() });
// Settings → Permissions (perms.ts): the level and everything always allowed, from /api/permissions.
if (LIVE) pmInit({ api, ask, rerender: () => { if (S.open && S.sec === "perm") sRender(); }, note: (t, x) => note(ic.check, t, x, ""), helper: () => who(main), esc,
  srow, sa, icon: (k, n = 17) => k === "check" ? ic.check : g(k, n), logoOver });
if (LIVE) networkInit({ api, channels: () => channels.map(c => ({ slug: c.slug, name: c.name })), current: () => route().ch.slug,
  render: () => { if (S.open && S.sec === NETWORK_SEC) sRender(); }, note: (t, x) => note(ic.check, t, x, ""), ask, esc });
document.addEventListener("change", event => { if (LIVE) networkChange(event.target as HTMLElement); });
// Send later (send-later.ts): which channel/task each composer sends to, and how a task repaints / reloads / opens.
if (LIVE) {
  for (const c of BOOT?.channels || []) slSet(c.slug, c.later);   // before slInit: nothing to repaint yet
  const findS = (slug: string, sid: any) => { const ch = channels.find(c => c.slug === slug); return { ch, x: ch?.sessions.find(y => String(y.id) === String(sid)) }; };
  slInit({ api, phone, dragToClose, note: (t, s, a) => note(ic.clock, t, s, a || ""), channels: () => channels.map(c => ({ slug: c.slug, name: c.name })),
    target: key => { if (key === "nbox") return NT.open ? { slug: NT.to || route().ch.slug, session: "new" } : null; const { ch, s } = route(); return { slug: ch.slug, session: s ? (s.srv ? String(s.id) : null) : "new" }; },
    current: () => { const { ch, s } = route(); return { slug: ch.slug, session: s && !isLib() && !isNb() && !isCt() ? String(s.id) : null }; },
    lists: () => schPaint(),
    repaint: (slug, sid) => { const { ch, s } = route(); if (ch.slug !== slug) return; if (s && sid && String(s.id) === String(sid)) paintChat(s); },
    reload: (slug, sid) => { const { ch, x } = findS(slug, sid); if (!ch || !x || x.streaming) return; x.loaded = false; if (route().s === x) liveLoad(ch, x); },
    open: (slug, sid) => { location.hash = `/${slug}${sid ? `/s/${sid}` : ""}`; } });
}
// Stop (stop.ts): the open task's composer stop follows every repaint.
function stNow() { if (!LIVE) return; const { ch, s } = route(); stSync(s && !isLib() && !isNb() && !isCt() ? { slug: ch.slug, sid: String(s.id), working: stWorking(s) } : null); }
// Spend guard (spendguard.ts): Stop here on a paused card, and the 50% / 80% notice once.
if (LIVE) { sgInit({ api, note: (t, b) => note(ic.check, t, b, ""), repaint: () => { const { ch, s } = route(); if (s) paintChat(s); else repaint(ch); },
  configureCheckins: () => { openSettings('perm'); pmFocusCheckins(); },
  unpause: (slug, sid, card, session) => { const cv = tkCardView(slug, sid, card); if (cv) cv.status = "complete"; const x = channels.find(c => c.slug === slug)?.sessions.find(s => String(s.id) === sid); if (x && session) applySrv(x, session); const { s } = route(); if (s && String(s.id) === sid) tkSync(slug, s.id); } });
  if (hasFeature("billing")) sgBillingInit(api);
  if (hasFeature("billing") && BOOT?.account?.notice) setTimeout(() => noticeShow(BOOT.account.notice), 600);
  else if (BOOT?.account?.storage?.notice) setTimeout(() => storNotice(BOOT.account.storage.notice), 900); }   // one banner at a time; the other shows next visit
if (LIVE) stInit({ api, note: (t, b) => note(ic.check, t, b, ""),
  working: () => channels.flatMap(c => c.sessions.filter(stWorking).map(x => ({ slug: c.slug, sid: String(x.id), title: x.title }))),
  apply: (slug, v) => { const c = channels.find(y => y.slug === slug), x = c?.sessions.find(y => String(y.id) === String(v?.id)); if (x) applySrv(x, v); },
  repaint: () => { const { ch, s } = route(); if (s && !isLib() && !isNb() && !isCt()) { paintHeadDone(s); tkSync(ch.slug, s.id); } refresh(); } });
if (LIVE) todoInit({ api, phone, dragToClose, helper: slug => { const c = channels.find(x => x.slug === slug); return c ? who(c) : ""; },
  current: () => { const { ch, s } = route(); return s && !isLib() && !isNb() && !isCt() ? `${ch.slug}|${s.id}` : ""; },
  working: (slug, sid) => !!channels.find(c => c.slug === slug)?.sessions.some(x => String(x.id) === sid && x.state === "working") });
// Focus timer per task (pomodoro.ts): header button, break overlay, offer card. Every task's timer from boot, so a phase end elsewhere shows a toast.
if (LIVE) { pomoInit({ api, phone, dragToClose, note: (i, t, b, a) => note(i, t, b, a),
  current: () => { const { ch, s } = route(); return s && !isLib() && !isNb() && !isCt() ? `${ch.slug}|${s.id}` : ""; },
  title: (slug, sid) => channels.find(c => c.slug === slug)?.sessions.find(x => String(x.id) === sid)?.title || "" });
  for (const c of BOOT.channels) for (const v of c.sessions) if (v.pomodoro) pomoSet(c.slug, v.id, v.pomodoro);
  pomoSet("*", "global", BOOT.pomodoro_global);   // the person's one global timer
  if (hasFeature("ambient")) lnInit({ api, base: () => LIVE?.api || null, look: !!BOOT?.look, phone, md, note: (t, b) => note(ic.check, t, b, ""), repaint: () => { const { ch, s } = route(); if (s && !isLib() && !isNb() && !isCt()) render(); else repaint(ch); },
    current: () => { const { ch, s } = route(); return s && !isLib() && !isNb() && !isCt() ? `${ch.slug}|${s.id}` : ""; } });
  if (hasFeature("ambient")) for (const c of BOOT.channels) for (const v of c.sessions) if (v.livenotes) lnSet(c.slug, v.id, v.livenotes);
  // Meeting reminders (meetings.ts): Take notes opens the task the server made for the meeting, then the Live notes Start sheet.
  if (hasFeature("ambient")) mtInit({ api, look: !!BOOT?.look, note: (t, b) => note(ic.clock, t, b, ""), start: (slug, sid) => lnStartFor(slug, sid),
    open: (slug, sid, title) => { const c = channels.find(x => x.slug === slug) ?? main;
      if (!c.sessions.some(y => String(y.id) === String(sid))) { const x = { id: sid, title, status: "resolved", state: "idle", updated: Date.now(), messages: [], fresh: true } as unknown as Session; applySrv(x, { id: sid, title, state: "idle", updated: Date.now() }); c.sessions.unshift(x); }
      location.hash = `/${c.slug}/s/${sid}`; } }); }
if (LIVE) tkInit({ api, base: () => LIVE.api, phone, dragToClose, plain: t => plain(t), note: (a, b) => note(ic.clock, a, b, ""),
  fileChip: (slug, f) => { const c = channels.find(x => x.slug === slug); return c ? fileCard(c, f, false) : ""; },
  savedChip: (slug, x) => { const c = channels.find(c => c.slug === slug); return c ? savedChip(x, c) : ""; },
  helper: slug => { const c = channels.find(x => x.slug === slug); return c ? who(c) : "your helper"; },
  working: (slug, sid) => !!channels.find(c => c.slug === slug)?.sessions.some(x => String(x.id) === sid && x.streaming),
  current: () => { const { ch, s } = route(); return s && !isLib() && !isNb() && !isCt() ? `${ch.slug}|${s.id}` : ""; },
  repaint: (slug, sid) => { const { ch, s } = route(); if (s && ch.slug === slug && String(s.id) === sid) paintChat(s); },
  showInChat: (slug, sid, card) => {   // close the card, bring its reply into view and flash it once
    const el = document.querySelector<HTMLElement>(`.m.agent[data-card="${CSS.escape(card)}"]`);
    if (!el) { note(ic.clock, "That reply is further back", "Scroll up in the chat to find it.", ""); return; }
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.classList.remove("tk-flash"); void el.offsetWidth; el.classList.add("tk-flash"); setTimeout(() => el.classList.remove("tk-flash"), 1700);
  } });
// Share links + published pages (share.ts): the Library / chat repaint when links or pages change.
if (LIVE) { shFiles((slug, fid) => { const a = (LIB[slug] || []).find(x => x.fid === fid); return a ? { name: a.name, mime: a.mime || "" } : null; });
  shInit({ api, phone, note: (t, s) => note(ic.check, t, s, ""), helper: slug => { const c = channels.find(x => x.slug === slug); return c ? who(c) : ""; },
    repaint: () => { if (isLib()) libUpdate(); else { const { s } = route(); if (s) paintChat(s); } } }); }
// Channel/task tools and approved plans share the same immediate discovery path. Keep the active conversation in place;
// the returned task link must already be routable before the next six-second boot poll.
function addStartedSessions(list: any[]) {
  let added = false;
  for (const it of list) {
    if (it.id != null && it.slug && !channels.some(x => x.slug === it.slug)) { addChannel({ id: it.id, slug: it.slug, name: it.name, purpose: it.purpose }); added = true; }
    const c = channels.find(x => x.slug === it.slug), v = it.session;
    const had = c?.sessions.find(y => String(y.id) === String(v?.id));
    if (had) { if (!had.streaming) applySrv(had, v); continue; }
    if (!c || !v?.id) continue;
    const x = { id: v.id, title: v.title, status: "resolved", state: "idle", updated: v.updated || Date.now(), messages: [], fresh: true } as Session;
    applySrv(x, v); c.sessions.unshift(x);
  }
  if (added) {
    if (!phone() && document.querySelector("#rail .chs")) { const top = document.querySelector("#rail .chs")?.scrollTop ?? 0; $("#rail").innerHTML = railHtml(route().ch); railWire(top); }
    else { const cl = document.getElementById("chlist"); if (cl) cl.innerHTML = chRows((document.getElementById("chq") as HTMLInputElement | null)?.value ?? ""); }
  }
  repaint(route().ch);
}
if (LIVE) planInit({ api, helper: slug => { const c = channels.find(x => x.slug === slug); return c ? who(c) : ""; }, chName: slug => channels.find(x => x.slug === slug)?.name || (LNAME[slug] ?? slug),
  hasChannel: slug => channels.some(x => x.slug === slug), repaint: () => apRepaint(),
  working: (slug, sid) => { const x = channels.find(c => c.slug === slug)?.sessions.find(y => String(y.id) === sid); return !!x && stWorking(x); }, stopMany: list => stopMany(list),
  send: (slug, sid, text) => { const c = channels.find(x => x.slug === slug), x = c?.sessions.find(y => String(y.id) === sid); if (c && x) liveReply(c, x, text, [], true); },
  addSessions: addStartedSessions });
// A turn that a restart cut off and that couldn't be picked up again (the server's turns row error "interrupted"): the honest version.
const INTERRUPTED_MSG = "1Helm restarted while I was working on this, so I stopped before replying. Send it again and I'll pick it back up.";
const HANDOFF_OPENED = new Set<string>();   // a worker handoff opens the viewer once per handoff, not on every reload
// Drawing the open task: a task that isn't loaded loads now. A repaint right after a failed load waits out the pause in task-load.ts,
// and opening the task again (the hashchange listener before render) clears the pause so it always tries.
function openLoad(ch: Channel, s: Session) { if (loadDue(s)) void liveLoad(ch, s); }
async function liveLoad(ch: Channel, s: Session, snapshot?: any) {
  s.loading = true;
  try {
    const d = snapshot || await withRetries(async signal => { const r = await api(`/res/${ch.slug}/sessions/${s.id}?n=80`, undefined, { signal }); if (r.error) throw new Error(r.error); return r; });
    todoSet(ch.slug, s.id, d.todos || []); pomoSet(ch.slug, s.id, d.session?.pomodoro); lnSet(ch.slug, s.id, d.session?.livenotes);
    tkLoad(ch.slug, s.id, d);
    pauseSet(d.pauses); usageSet(ch.slug, s.id, d.usage?.nano || 0);   // spendguard.ts
    const msgs: Msg[] = [];
    // A turn's messages: with tracker cards, every message the person sent in it (the first plus the steers) stacks before its reply.
    const userOf = (x: any, t: any, i: number): TkMsg => ({ id: nextId++, role: "user", body: x.text || "", at: x.at || t.at, steps: [], files: x.files?.length || i ? x.files || [] : t.attached || [], turn: x.id, reaction: x.reaction || undefined, cid: x.cid || undefined, ...(x.input_reply ? { input_reply: x.input_reply } : {}), ...(x.reply?.text ? { reply: x.reply } : {}), ...(x.via === "plan" ? { via: "plan" } : {}) } as TkMsg);
    for (const t of d.turns) {
      if (Array.isArray(t.msgs)) t.msgs.forEach((x: any, i: number) => msgs.push(userOf(x, t, i)));
      else if (t.kind === "chat") msgs.push({ id: nextId++, role: "user", body: t.user_text || "", at: t.at, steps: [], files: t.attached || [], turn: t.id, reaction: t.reaction } as RxMsg);
      const cv = t.card ? tkCardView(ch.slug, s.id, t.card) : undefined, from = cv?.kind === "handoff" ? cv.from?.[0] : null;
      const sp = Array.isArray(t.parts) && (t.parts.length > 1 || t.progress?.length) ? splitParts(t.parts, t.progress) : null, parts: string[] = sp ? sp.answer : [];
      const lnr = t.kind === "livenote" && t.livenote?.refine ? t.livenote.refine : null;   // "Update your meeting notes?": a card, not text
      msgs.push({ progressOmitted: Number(t.progress_omitted) || undefined, id: nextId++, role: "agent", pre: [], prog: sp?.prog || [], body: lnr ? "" : parts.length ? parts.join("\n\n") : t.reply || (t.error === "interrupted" ? INTERRUPTED_MSG : t.error ? `Something went wrong: ${t.error}` : ""), at: t.at + (t.total_ms || 0), steps: toSteps((t.steps || []).map((x: any) => x.line)), saved: (t.steps || []).flatMap((x: any) => x.saved || []),
        note: t.kind === "livenote" ? "Live notes" : from ? (from.type === "followup" ? "Follow-up it scheduled" : from.type === "connect" ? from.title || "App connected" : from.type === "permission" ? from.title || "You allowed it" : from.type === "confirm" ? from.title || "You confirmed it" : `Done in the background${from.title ? `: ${from.title}` : ""}`) : t.kind === "followup" ? "Follow-up it scheduled" : t.kind === "workflow" ? "From a scheduled check" : undefined,
        cards: [...(lnr ? [{ t: "lnrefine", r: lnr, slug: ch.slug, sid: s.id }] : []), ...(t.images || []).map((x: any) => ({ t: "image", id: x.id, url: x.url, caption: x.caption })), ...(t.shared || []).map((f: any) => ({ t: "file", f })), ...(t.deck_styles ? [{ t: "deckstyles", id: `t${t.id}` }] : []), ...(t.interviews || []).map((v: any) => ({ t: "interview", v })), ...shCards(t.offers)], ...(t.card ? { card: t.card } : {}), rid: t.id, ...(t.input_request ? { input_request: t.input_request } : {}) } as TkMsg);
    }
    // A routed worker's browser work, with no Primary turn running: the live view, or the Take control card when it handed the browser over.
    // The server keeps both, so a reload or a reopened app shows them. The reply they sit under is the one that dispatched the worker.
    const wb = d.worker_browser, lastAgent = msgs.findLast(m => m.role === "agent");
    if (wb && lastAgent) { (lastAgent.cards ??= []).push({ t: "browser", url: wb.url, text: wb.text || undefined, stored: true } as any); const key = `${s.id}|${wb.url}|${wb.text}`; if (wb.text && !HANDOFF_OPENED.has(key)) { HANDOFF_OPENED.add(key); if (route().s === s) openPC(ch.slug, wb.url, wb.text); } }
    // Primary's review of a paused worker says nothing unless it asks the person something: no reply, no live stream of it.
    if (d.live?.silent && !s.streaming) { s.messages = msgs; s.state = "working"; s.rawLine = ""; }
    else if (d.live && !s.streaming) {
      const lm = (d.live.card?.events || []).filter((e: any) => e.type === "msg");
      if (lm.length) lm.forEach((x: any, i: number) => msgs.push(userOf(x, { at: d.live.started }, i)));
      else if (d.live.user_text && !nativeResumeInput(d.live.card) && !internalHandoffInput(d.live.card)) msgs.push({ id: nextId++, role: "user", body: d.live.user_text, at: d.live.started, steps: [], turn: d.live.turn, reaction: d.live.reaction || undefined } as RxMsg);
      const r: Msg = { id: nextId++, role: "agent", body: d.live.text || "", at: Date.now(), steps: [], rid: d.live.turn, ...(d.live.input_request ? { input_request: d.live.input_request } : {}), ...(d.live.card?.id ? { card: d.live.card.id } : {}), ...(d.live.interviews?.length ? { cards: d.live.interviews.map((v: any) => ({ t: "interview", v })) } : {}) } as TkMsg; progressSnapshot(r, d.live.reply_state); liveOutputs(ch, r, d.live); msgs.push(r);
      s.messages = msgs; s.state = "working"; s.rawLine = d.live.line || ""; liveAttach(ch, s, r);
    } else if (!s.streaming && d.session?.state === "working" && !d.session.native_progress && !(Number(d.session.helpers) > 0 && !d.session.line)) {
      // A worker-only task has no Primary reply to resume. Other working tasks
      // without a live turn were interrupted by an update and should reattach.
      const r: Msg = { id: nextId++, role: "agent", body: "", at: Date.now(), steps: [] }; msgs.push(r);
      s.messages = msgs; s.state = "working"; s.rawLine = d.session.line || UPDATED_LINE; liveAttach(ch, s, r);
    } else if (!s.streaming) s.messages = msgs;
    planBriefs(s.messages, d.origin || null); planAttach(ch.slug, s.messages, d.plans || []);
    const last = [...s.messages].reverse().find(m => m.role === "agent");
    if (last) for (const a of d.approvals || []) { const m = ["ssh","ssh_hostkey"].includes(a.perm) && a.turn ? (s.messages as TkMsg[]).find(x => x.role === "agent" && x.card === a.turn) || last : last; addApproval(m, a, false); }   // native receipts stay beside their originating request
    for (const o of d.offers || []) { const m = (s.messages as TkMsg[]).find(x => x.role === "agent" && o.turn && x.card === o.turn) || last; if (m) addOffer(m, ch, o, false); }   // connect cards, under the reply that offered them
    applySrv(s, d.session && { ...d.session, pending_inputs: d.pending_inputs || d.session.pending_inputs || [] }); s.loaded = true; s.loadFailAt = 0;
  } catch { s.loadFailAt = Date.now(); }   // never "loaded": the messages already shown stay, and the next open, return to the app or refresh tries again (task-load.ts)
  s.loading = false; if (route().s === s) paintChat(s); else repaint(ch);
}
// Repaint only the open task's messages (keeps the composer and the scroll position when you've scrolled up).
function paintChat(s: Session) {
  const { ch, s: cur } = route(); if (cur !== s) { repaint(ch); return; }
  const box = document.querySelector(".msgs"), sc = document.getElementById("scroll");
  if (!box || !sc) { render(); return; }
  const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
  morph(box, msgsHtml(s, ch));
  if (near) sc.scrollTop = sc.scrollHeight;
  paintHeadDone(s);
  todoSync(ch.slug, s.id); tkSync(ch.slug, s.id); pomoSync(ch.slug, s.id); if (hasFeature("ambient")) lnSync(ch.slug, s.id); stNow();
  repaint(ch); // Include the mobile task drawer when a pause or Stop here changes the task's state.
}
// The person's message a reaction belongs to: the one with that turn id, else the one this streamed reply answers.
function rxTarget(s: Session, reply: Msg, turn?: string): RxMsg | undefined {
  const ms = s.messages as RxMsg[], byId = turn ? ms.find(m => m.role === "user" && m.turn === turn) : undefined; if (byId) return byId;
  for (let i = ms.indexOf(reply) - 1; i >= 0; i--) if (ms[i].role === "user") return ms[i];
}
function onEvent(ch: Channel, s: Session, reply: Msg, ev: any) {
  zoneMod?.zoneEvent(ch.slug, String(s.id), ev);   // the Zone watches the open task: the helper working, and a new version of its file
  if ((ev.t === "channel_created" || ev.t === "task_started") && ev.channel?.slug) { addStartedSessions([{ ...ev.channel, session: ev.session }]); return; }
  const holdingProgress = progressSlot(reply, true).mode === "progress";
  const replacing = ev.t === "text" && !!String(ev.s || "").trim() && holdingProgress;
  const finalProgress = ev.t === "done" && !ev.error && holdingProgress;
  if (ev.t === "snapshot") progressReset(reply);
  const beforeProgress = route().s === s && (replacing || finalProgress) ? progressBefore(reply.id) : undefined;
  streamProgress(s, ev);
  if (ev.t === "snapshot" && ev.input_request) reply.input_request = ev.input_request;
  if (ev.t === "snapshot" && ev.turn) (reply as TkMsg).rid = ev.turn;   // a quote of resumed text keeps its originating turn
  if (ev.t === "model_wait") { paintTask(ch, s); return; }
  if (ev.t === "snapshot") liveOutputs(ch, reply, ev);   // files and pictures shared before this watcher attached
  if (ev.t === "snapshot" && ev.card?.id) { tkEvent(ch.slug, s.id, ev); (reply as TkMsg).card = ev.card.id; }
  if (ev.t === "session") { const tmp = s.tmp; applySrv(s, ev.session); s.state = "working"; if (tmp && location.hash.endsWith(`/s/${tmp}`)) history.replaceState(null, "", `#/${ch.slug}/s/${s.id}`); }
  else if (ev.t === "user_input" && ev.input?.question_id) {
    reply.input_request = ev.input;
    (reply as TkMsg).rid = ev.input.source_turn;
    if (!reply.body.trim()) reply.body = ev.input.presentation || ev.input.question || "";
    s.srv = { ...s.srv, state: "waiting", waiting: "question", pending_inputs: [...(s.srv?.pending_inputs || []).filter((x: InputRequest) => x.question_id !== ev.input.question_id), ev.input] };
    s.status = "waiting"; s.state = "idle"; s.rawLine = "waiting for your answer";
  }
  else if (ev.t === "queued") s.rawLine = "finishing your last message first";
  else if (ev.t === "text" || ev.t === "snapshot") { if (ev.t === "snapshot") { if (!progressSnapshot(reply, ev.reply_state)) reply.body = ev.text || ""; (reply as any).snap = 1; s.rawLine = ev.line || s.rawLine; (ev.approvals || []).forEach((a: any) => addApproval(reply, a, false)); const u = rxTarget(s, reply, ev.turn); if (u && ev.reaction) u.reaction = ev.reaction; } else reply.body += ev.s; }
  else if (ev.t === "reaction") { const u = rxTarget(s, reply, ev.msg); if (!u || !RX[ev.reaction]) return; u.reaction = ev.reaction; u.turn = ev.msg; if (route().s === s) { paintChat(s); rxPop(u); } else repaint(ch); return; }
  else if (ev.t === "work") { if (!progressWorked(reply)) return; }   // classify as before; retain only the most recently confirmed note in the live slot
  else if (ev.t === "saved") (reply.saved ??= []).push(...(ev.saved || []));   // remember finished: where it really went
  else if (ev.t === "status") { s.rawLine = ev.line; const raw = (reply as any).raw ??= []; raw.push(ev.line); reply.steps = toSteps(raw); }
  else if (ev.t === "approval") { addApproval(reply, ev.approval, true); s.status = "waiting"; s.state = "idle"; s.rawLine = "waiting for your OK"; }
  // Decided (here, in another tab or inside Messages): the card stays, locked, showing the result (it used to vanish).
  else if (ev.t === "approval_done") { apCards(ch.slug, String(ev.id)).forEach(k => { if (k.st === "pending" && !k.busy) { k.st = ev.status === "denied" ? "deny" : ev.status === "approved" ? "allowed" : "expired"; k.confirm = false; } }); s.status = "resolved"; s.state = "working"; s.rawLine = "working"; }
  else if (ev.t === "browser" || ev.t === "browser_handoff") { reply.cards = (reply.cards || []).filter(c => c.t !== "browser"); reply.cards.push({ t: "browser", url: ev.url, text: ev.instructions, fresh: true });  if (ev.t === "browser_handoff" && route().s === s) openPC(ch.slug, ev.url, ev.instructions); }
  else if (ev.t === "note") { const nb = nbOf(ch), n = ev.note; if (n?.id && !nb.notes.some((x: any) => x.id === n.id)) nb.notes.unshift({ id: n.id, sec: NB_SECS.some(x => x[0] === n.sec) ? n.sec : "how", text: n.text, at: n.at || Date.now(), you: false, fresh: true } as any); }
  else if (ev.t === "link_purchase" && hasFeature("billing")) (reply.cards ??= []).push({ t: "link", p: ev.purchase, fresh: true });
  else if (ev.t === "connect_offer" && hasFeature("connected_apps")) addOffer(reply, ch, ev.offer, true);
  else if (ev.t === "connect_offer_done" && ev.offer && hasFeature("connected_apps")) cxoUpdate(ev.offer);
  else if (ev.t === "apps_changed") { if (LIVE && hasFeature("connected_apps")) fetch(`${LIVE.api}/apps`, { credentials: "same-origin" }).then(r => r.json()).then(d => { if (Array.isArray(d.accounts)) { cxSet(d.accounts); appDetailSync(d.accounts); } }).catch(() => {}); return; }   // the helper saved an account note
  else if (ev.t === "plan") { planEvent(ch.slug, reply, ev.plan); if (ev.plan?.status === "pending") { s.status = "waiting"; } }
  else if (ev.t === "todos") { todoSet(ch.slug, s.id, ev.items || [], ev.by === "helper" ? "helper" : "person"); return; }
  else if (ev.t === "spend_pause") { pauseSet([ev.pause]); (reply as any).paused = true; return; }   // why this turn is pausing (its card closes "paused" next)
  else if (ev.t === "byok_switch" && hasFeature("billing")) { noticeShow({ text: ev.notice }); bykSwitched(); return; }   // credits used up: chat now on their backup key (byok.ts), said once
  else if (ev.t === "pomodoro") { pomoSet(ch.slug, s.id, ev.pomodoro); return; }
  else if (ev.t === "pomodoro_global") { pomoSet("*", "global", ev.pomodoro); return; }
  else if (ev.t === "livenotes") { lnSet(ch.slug, s.id, ev.livenotes); return; }
  else if (ev.t === "card_open" || ev.t === "steered" || ev.t === "card_event" || ev.t === "card_update" || ev.t === "card_close" || ev.t === "helper") {
    tkEvent(ch.slug, s.id, ev);
    if (ev.t === "card_open" && ev.card?.id) {   // this reply's card; the person's message gets its server id (reactions find it)
      (reply as TkMsg).card = ev.card.id; (reply as TkMsg).rid = ev.turn || ev.card.id; const ms = s.messages as TkMsg[];
      const u = (ev.msg?.cid && ms.find(m => m.role === "user" && m.cid === ev.msg.cid)) || rxTarget(s, reply); const pc = (u as TkMsg | undefined)?.paste;
      if (pc && !pc.id) api(`/res/${ch.slug}/files`).then((d: any) => { const f = (d?.files || []).find((x: FileV) => x.bytes === pc.bytes && /^Pasted text/.test(x.name)); if (f) { Object.assign(pc, f); paintTask(ch, s); } }).catch(() => {});   // the chip opens the saved file
      if (u && ev.msg?.id) { u.turn = ev.msg.id;
        if (ev.msg.input_reply || ev.input_reply) {
          const binding: InputReply = ev.msg.input_reply || ev.input_reply;
          if (u.input_reply?.question_id && u.input_reply.question_id !== binding.question_id) {
            for (const m of s.messages) if (m.input_request?.question_id === u.input_reply.question_id) m.input_request = { ...m.input_request, status: "answered", answer_text: u.body };
          }
          u.input_reply = binding; u.body = ev.msg.text ?? u.body;
        }
      }
    }
    const em = tkMsgOf(ev); if (em) addSteer(s, reply, em);
  }
  else if (ev.t === "image") (reply.cards ??= []).push({ t: "image", id: ev.id, url: ev.url, caption: ev.caption });
  else if (ev.t === "deck_styles") { if (!(reply.cards ??= []).some((c: any) => c.t === "deckstyles")) reply.cards.push({ t: "deckstyles", id: `d${nextId++}` }); }   // show_deck_styles: the picker (deck-styles.ts)
  else if (ev.t === "interview" && ev.interview?.id) { if (!(reply.cards ??= []).some(c => c.t === "interview" && c.v.id === ev.interview.id)) reply.cards.push({ t: "interview", v: ev.interview, fresh: true }); }
  else if (ev.t === "share_offer") shEvent(reply, ev.offer);   // publish_page / share_file_link: a card for the person's tap (share.ts)
  else if (ev.t === "file") {   // share_file; the same id again = the helper updated that file in place: replace its card and Library row
    const cs = (reply.cards ??= []), i = cs.findIndex((c: any) => c.t === "file" && c.f?.id === ev.file.id); if (i >= 0) cs[i] = { t: "file", f: ev.file }; else cs.push({ t: "file", f: ev.file });
    LIB[ch.slug] = [{ ...toArt(ev.file), fresh: true }, ...(LIB[ch.slug] || []).filter((a) => a.fid !== ev.file.id)];
  }
  else if (ev.t === "done") {
    if(Number.isSafeInteger(ev.progress_omitted)&&ev.progress_omitted>0)reply.progressOmitted=ev.progress_omitted;
    // A timed-out/incomplete model response is not its final answer. Keep earlier
    // work history, but replace partial text with the server's recoverable outcome.
    if (ev.recoverable === true && ["model_timeout", "model_output_limit"].includes(ev.error) && typeof ev.reply === "string") reply.body = ev.reply;
    // A paused turn: the server's stored reply is the cleaned report (a model's own Keep going / Stop here buttons are stripped,
    // the app's paused card has them), so it replaces the streamed text. Earlier bubbles stay; a reply that joins them is trimmed to its end.
    if ((reply as any).paused && typeof ev.reply === "string" && ev.reply.trim() && !ev.error) {
      let fin = ev.reply.trim(); for (const p of reply.pre || []) if (fin.startsWith(p)) fin = fin.slice(p.length).trim();
      if (fin) reply.body = fin;
    }
    // The reply is the answer the server saved (text after the last tool call); narration folded into steps stays there, and whatever the
    // server kept in the reply (a question, a card, code, a link) is not shown twice. The same split a reload makes.
    // A turn the person did not start (a worker's result the helper only acted on) can end with nothing to say: no bubble, not even its narration.
    if (ev.quiet === true && !ev.error && !String(ev.reply || "").trim()) { reply.body = ""; reply.pre = []; reply.prog = []; (reply as any).quiet = true; }
    finishReply(reply as any, ev.reply, ev.error);
    if (!reply.body.trim() && ev.reply && !reply.pre?.length) reply.body = ev.reply;
    if (!reply.body.trim() && reply.prog?.length) reply.body = reply.prog.pop()!;
    if (!reply.body.trim() && reply.pre?.length) reply.body = reply.pre.pop()!;   // it spoke, worked, then said nothing more: its last words are the reply
    // Another turn of this task can still be streaming in this tab (a card that opened just after this reply): it stays live.
    const more = tkOn(ch.slug, s.id) && [...streamsOf(s)].some(r => r !== reply);
    usageAdd(ch.slug, s.id, Number(ev.charge) || 0);   // "This task: about $…"
    reply.at = Date.now(); if (!more) { s.streaming = false; s.attached = false; } if (ev.session) applySrv(s, ev.session); else if (!more) s.state = "idle";
    if (route().s === s) { s.unread = false; livePatch(ch, s, { seen: true }); }
  } else return;
  // Streamed text and status lines can arrive several times a frame: join them into one repaint per animation frame.
  // Anything that needs the new DOM at once (progress notes, the end of the reply, reactions) still paints now.
  if (route().s === s && !beforeProgress && (ev.t === "text" || ev.t === "status")) { paintSoon(s); return; }
  if (route().s === s) { paintChat(s); if (beforeProgress) progressAfter(beforeProgress, reply, finalProgress); } else repaint(ch);
}
const PAINT_SOON = new Set<Session>();
function paintSoon(s: Session) {
  if (PAINT_SOON.has(s)) return; PAINT_SOON.add(s);
  requestAnimationFrame(() => { PAINT_SOON.delete(s); const { ch, s: cur } = route(); if (cur === s) paintChat(s); else repaint(ch); });
}
// The replies streaming in this tab, per task (a reply that ends doesn't end the task's live state while another still streams).
const STREAMS = new WeakMap<Session, Set<Msg>>();
const streamsOf = (s: Session) => STREAMS.get(s) ?? (STREAMS.set(s, new Set()), STREAMS.get(s)!);
const newCid = () => { try { return crypto.randomUUID(); } catch { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`; } };
const paintTask = (ch: Channel, s: Session) => { if (route().s === s) paintChat(s); else repaint(ch); };
// Where a steer's bubble goes: just above the reply that's streaming now (else the latest reply).
function liveReplyAt(s: Session) { const ms = s.messages, live = streamsOf(s); for (let i = ms.length - 1; i >= 0; i--) if (live.has(ms[i])) return i; for (let i = ms.length - 1; i >= 0; i--) if (ms[i].role === "agent") return i; return ms.length; }
function joinSteer(s: Session, um: TkMsg, ev: any) {
  um.turn = ev.msg?.id || um.turn; um.state = "joined"; um.err = undefined;
  const ms = s.messages; ms.splice(ms.indexOf(um), 1); ms.splice(liveReplyAt(s), 0, um);
  setTimeout(() => { if (um.state === "joined") { um.state = undefined; const { ch, s: cur } = route(); if (cur === s) paintChat(s); else repaint(ch); } }, 2200);
}
// A person's message the server added to the open card (another tab, a text): its bubble joins this turn if it's missing.
function addSteer(s: Session, reply: Msg, e: EventView) {
  const ms = s.messages as TkMsg[], had = ms.find(m => m.role === "user" && ((e.id && m.turn === e.id) || (e.cid && m.cid === e.cid)));
  if (had) { if (e.id) had.turn = e.id; return; }
  const at = ms.indexOf(reply); ms.splice(at < 0 ? liveReplyAt(s) : at, 0, { id: nextId++, role: "user", body: e.text || "", at: e.at || Date.now(), steps: [], files: e.files || [], turn: e.id, cid: e.cid || undefined, reaction: e.reaction || undefined, ...((e as any).reply?.text ? { reply: (e as any).reply } : {}) } as TkMsg);
}
// A saved ambiguous answer can belong to another task. The server names that task;
// load its existing messages instead of moving the source task object or resending input.
async function inputRedirect(ch: Channel, source: Session, event: any) {
  const id = String(event.session || "");
  if (!id || (event.channel && event.channel !== ch.slug)) return;
  let target = ch.sessions.find(x => String(x.id) === id);
  if (!target) {
    target = { id, title: "Task", status: "resolved", state: "idle", updated: Date.now(), messages: [], srv: { id } };
    ch.sessions.unshift(target);
  }
  const follow = route().s === source;
  source.loaded = false; target.loaded = false;
  await Promise.all([liveLoad(ch, source), liveLoad(ch, target)]);
  if (follow && route().s === source) location.hash = `/${ch.slug}/s/${encodeURIComponent(id)}`;
}
// reply = null: a steer. The server decides: {"t":"steered"} = it joined the open card (no reply bubble of its own, the stream
// ends); {"t":"card_open"} = the card had just closed, so this starts a new turn and its reply bubble appears now.
async function streamTurn(ch: Channel, s: Session, text: string, reply: Msg | null, files: FileV[] = [], um?: TkMsg) {
  const lease = streamLease(s); lease.pending = true;
  try { await streamTurnOwned(ch, s, text, reply, files, um, lease); }
  finally { streamRelease(lease); }
}
async function streamTurnOwned(ch: Channel, s: Session, text: string, reply: Msg | null, files: FileV[], um: TkMsg | undefined, lease: Lease) {
  const lazy = !reply, live = streamsOf(s); let r2 = reply, joined = false, got = 0, gotDone = false, lost = "", redirected: any = null;
  if (r2) { s.streaming = true; s.state = "working"; s.rawLine = s.rawLine || "reading your request"; live.add(r2); }
  const drop = () => { if (!r2) return; live.delete(r2); s.messages = s.messages.filter(m => m !== r2); r2 = null; s.streaming = live.size > 0; if (!s.streaming) s.state = "idle"; };
  try {
    const r = await streamFetch(`${LIVE!.api}/res/${ch.slug}/stream`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: s.srv ? s.id : "new", message: text, files: files.map(f => f.id), ...(dpLoc() ? { loc: dpLoc() } : {}), ...(um?.cid ? { cid: um.cid } : {}), ...(um?.input_reply ? { input_reply: um.input_reply } : {}), ...((um as any)?.cont ? { continue: (um as any).cont } : {}), ...(um?.reply?.text ? { reply: { id: um.reply.id || null, role: um.reply.role, text: um.reply.text, ...((um.reply as any).zone ? { zone: (um.reply as any).zone } : {}) } } : {}) }) }, lease);
    if (!r.ok || !r.body) { const d = await streamErrorBody(r, lease); if (d.error === "payment_required") pdSet(d.access || null); throw Object.assign(new Error(d.error === "payment_required" ? d.message || "Your plan needs attention before I can work." : d.error || `HTTP ${r.status}`), { refused: true }); }
    await readStream(r, ev => {
      got++;
      if (ev.t === "input_redirect") {
        redirected = ev; lease.pending = false; joined = true; gotDone = true; drop();
        if (um) s.messages = s.messages.filter(m => m !== um);
        return true;
      }
      if (["card_open", "steered", "done"].includes(ev.t)) lease.pending = false;
      if (ev.t === "steered") { joined = true; tkEvent(ch.slug, s.id, ev); drop(); if (um) joinSteer(s, um, ev); paintTask(ch, s); return true; }
      if (joined) return;
      if (!r2) {
        if (ev.t === "session") return;
        r2 = { id: nextId++, role: "agent", body: "", at: Date.now(), steps: [] }; live.add(r2);
        if (um) { s.messages = s.messages.filter(m => m !== um); um.state = undefined; s.messages.push(um); }
        s.messages.push(r2); s.streaming = true; s.state = "working"; s.rawLine = "reading your request";
      }
      if (ev.t === "done" && OLD_RESET.test(String(ev.error || ""))) { lost = "1Helm was updated"; return; }   // the old helper's last words after an update: not the answer, find the resumed turn
      if (ev.t === "done") gotDone = true; onEvent(ch, s, r2, ev);
      return ev.t === "done";
    }, lease);
    if (lazy && !joined && !r2) throw new Error("The connection closed before it was sent.");
  } catch (e: any) {
    lease.pending = false;
    if (!streamCurrent(lease)) return;
    // Nothing reached the helper: the bubble says so, with Retry (same client id, so a send that did land isn't doubled).
    if (um && !joined && (e.refused || (lazy && !r2) || (!got && tkOn(ch.slug, s.id) && /a lot at once/i.test(e.message)))) { drop(); um.state = "failed"; um.err = e.message; paintTask(ch, s); return; }
    lost = String(e?.message || e || "closed");
    if (r2 && !got && !r2.body) r2.body = "I couldn't confirm this task's reply yet. Check this task before sending the request again.";
  }
  if (!streamCurrent(lease)) return;
  if (redirected) { await inputRedirect(ch, s, redirected); return; }
  if (joined || !r2) { if (r2) live.delete(r2); return; }
  if (!gotDone) {
    // The stream broke before the reply. A deploy restarts the helper (and the network can drop): never claim it's "still on it".
    // Find the turn again (attach, with backoff up to ~90 s): still running → keep streaming; picking up after an update → say so; ended → reload.
    const how = s.srv ? await reattach(ch, s, r2, lost || "closed", lease) : "gave_up";
    if (!streamCurrent(lease)) return;
    live.delete(r2);
    if (how === "done") return;
    if (!tkOn(ch.slug, s.id) || !live.size) s.streaming = false;
    if (how === "gave_up" && got && !r2.body.trim()) r2.body = "I lost the connection and couldn't find this task's reply yet. Reopen this task in a minute to see where it is.";
    if (s.srv) setTimeout(() => { s.loaded = false; if (route().s === s) liveLoad(ch, s); }, how === "idle" ? 0 : 1500);
    if (route().s === s) paintChat(s); else repaint(ch);
  } else live.delete(r2);
}
// Shown while a turn a deploy cut off is picked up again on the new code (the server's {"t":"resuming"}; Phase 1 resumable turns).
// A server from before the 10-08 fix could end a stream with "Something went wrong: Durable Object reset because its code was updated"
// when an update reset it mid-turn, while the new one carried the turn on. That's never the answer: the app re-attaches instead.
const OLD_RESET = /reset because its code was updated|Durable Object reset/i;
const UPDATED_LINE = "picking up where it left off (1Helm was just updated)";   // shown as "<helper> is …"
const pause = (ms: number) => new Promise(z => setTimeout(z, ms));
// A reply stream that broke: attach to the task's live turn again, 1, 2, 4, 8, 15 … s apart, for about 90 s.
//   "done" = the turn finished while attached (its "done" event was handled) · "idle" = nothing runs any more (reload to see how it
//   ended) · "gave_up" = no answer in time. Every try is a fresh request, so a deploy in between is just one more wait.
async function reattach(ch: Channel, s: Session, reply: Msg, why: string, lease: Lease): Promise<"done" | "idle" | "gave_up"> {
  const t0 = Date.now(), api = LIVE?.api; let wait = 1000, tries = 0, saw = false;
  streamNote(api, { e: "stream_lost", why: why.slice(0, 120), sid: String(s.id) });
  s.streaming = true; s.state = "working"; s.rawLine = "reconnecting"; paintTask(ch, s);
  while (Date.now() - t0 < 90e3) {
    await pause(wait); wait = Math.min(wait * 2, 15e3); tries++;
    if (!streamCurrent(lease)) return "gave_up";
    let ended: "" | "done" | "idle" = "", resuming = false;
    try {
      const r = await streamFetch(`${api}/res/${ch.slug}/sessions/${s.id}/attach`, { credentials: "same-origin" }, lease, t0 + 90e3, 30000); // server may await journal recovery for 25s
      if (!r.ok || !r.body) continue;
      let attached = false;
      await readStream(r, ev => {
        if (ev.t === "idle") { ended = "idle"; return true; }
        if (ev.t === "resuming") { resuming = true; s.rawLine = UPDATED_LINE; paintTask(ch, s); if (!saw) { saw = true; streamNote(api, { e: "resuming", sid: String(s.id), ms: Date.now() - t0 }); } return; }
        if (ev.t === "hb") return;
        if (ev.t === "snapshot") { attached = true; streamNote(api, { e: "resumed", sid: String(s.id), ms: Date.now() - t0, tries, after_update: saw }); }
        if (ev.t === "done" && OLD_RESET.test(String(ev.error || ""))) return;   // the reset object's error: keep looking for the resumed turn
        if (ev.t === "done") ended = "done";
        onEvent(ch, s, reply, ev);
        return ev.t === "done";
      }, lease, { deadline: () => attached ? Infinity : t0 + 90e3 });
    } catch { continue; }
    if (ended) { if (ended === "idle") streamNote(api, { e: "ended", sid: String(s.id), ms: Date.now() - t0, tries }); return ended; }
    if (resuming) wait = 1000;   // it's coming back: look again soon
  }
  streamNote(api, { e: "gave_up", sid: String(s.id), ms: Date.now() - t0, tries });
  return "gave_up";
}
async function liveAttach(ch: Channel, s: Session, reply: Msg) {
  if (s.attached) return; s.attached = true; s.streaming = true; streamsOf(s).add(reply);
  const lease = streamLease(s);
  try { await liveAttachOwned(ch, s, reply, lease); }
  finally { streamRelease(lease); }
}
async function liveAttachOwned(ch: Channel, s: Session, reply: Msg, lease: Lease) {
  let end = "", lost = "";
  try { const r = await streamFetch(`${LIVE!.api}/res/${ch.slug}/sessions/${s.id}/attach`, { credentials: "same-origin" }, lease, Infinity, 30000); await readStream(r, ev => { if (ev.t === "idle") { end = "idle"; s.streaming = false; s.loaded = false; liveLoad(ch, s); } else if (ev.t === "resuming") { s.rawLine = UPDATED_LINE; paintTask(ch, s); } else { if (ev.t === "done" && OLD_RESET.test(String(ev.error || ""))) return; if (ev.t === "done") end = "done"; onEvent(ch, s, reply, ev); } return ev.t === "idle" || ev.t === "done"; }, lease); }
  catch (e: any) { lost = String(e?.message || e); }
  if (!streamCurrent(lease)) return;
  if (!end && s.streaming) end = await reattach(ch, s, reply, lost || "closed", lease);   // the stream broke mid-turn (a deploy): find it again
  if (!streamCurrent(lease)) return;
  streamsOf(s).delete(reply); s.attached = false; if (s.streaming && end !== "done") { s.streaming = false; s.loaded = false; if (route().s === s) liveLoad(ch, s); }
}
// A live socket is not proof that a turn is still running. Check durable state without
// resending the user's message. An event/new send during this read wins over its snapshot.
async function reconcileStream(ch: Channel, s: Session, server: any) {
  if (!s.streaming || !s.srv || s.loading || !streamCheckDue(s, server)) return;
  const state = streamState(s), epoch = state.epoch, revision = state.revision;
  state.checking = true; state.checked = Date.now();
  try {
    const d = await api(`/res/${ch.slug}/sessions/${s.id}?n=80`, undefined, { signal: AbortSignal.timeout(12000) });
    if (d.error || !d.session || epoch !== state.epoch || revision !== state.revision || !s.streaming) return;
    if (!d.live && d.session.state !== "working") {
      streamInvalidate(s); streamsOf(s).clear(); s.streaming = false; s.attached = false;
      await liveLoad(ch, s, d); // replaces stale partial text/cards with the saved terminal outcome
    } else {
      tkLoad(ch.slug, s.id, d);
      if (Date.now() - state.progress >= 45000) { state.waiting = "Waiting for the current step"; paintTask(ch, s); }
    }
  } catch { /* keep the actual partial reply; a failed status check is not a failed task */ }
  finally { state.checking = false; }
}
// Over 100,000 characters the server saves the text as "Pasted text.md" and sends that file; the bubble shows the same chip at once (its id comes with the next card_open).
const pasteChip = (text: string): FileV | undefined => text.length > 100000 ? { id: "", name: "Pasted text.md", mime: "text/markdown", bytes: new TextEncoder().encode(text).length, at: Date.now() } : undefined;
function liveStart(ch: Channel, text: string, files: FileV[] = []) {
  const at = Date.now(), tmp = `t${nextId++}`;
  const reply: Msg = { id: nextId++, role: "agent", body: "", at, steps: [] };
  const um: TkMsg = { id: nextId++, role: "user", body: text, at, steps: [], files, cid: newCid(), paste: pasteChip(text) };   // a refusal leaves this bubble with its error and Retry
  const x: Session = { id: tmp, tmp, title: titleOf(text || files[0]?.name || "New task"), status: "resolved", state: "working", updated: at, fresh: true, loaded: true, rawLine: "reading your request",
    messages: [um, reply] };
  ch.sessions.unshift(x); streamTurn(ch, x, text, reply, files, um); return x;
}
function liveReply(ch: Channel, s: Session, text: string, files: FileV[] = [], keepBox = false, cont?: string, rp: Pin | null = null, input?: InputReply) {
  streamProgress(s, { t: "user_input" }); // invalidates an older in-flight status snapshot
  const at = Date.now(), b = keepBox ? null : $("#box") as HTMLTextAreaElement | null;
  if (b) { b.value = ""; b.style.height = "auto"; ($("#go") as HTMLButtonElement).disabled = true; $("#send").classList.remove("has"); }
  const rid = nextId++, um: TkMsg = { id: nextId++, role: "user", body: text, at, steps: [], files, cid: newCid(), paste: pasteChip(text) };   // ids in today's order
  const binding = input || (() => { const pending: InputRequest[] = s.srv?.pending_inputs || [];
    const quoted = rp?.role === "agent" ? pending.find(q => q.source_turn === rp.id && q.status === "pending") : undefined;
    const b = rp ? quoted ? replyBinding(pending, quoted.source_turn, quoted) : undefined : cont ? undefined : replyBinding(pending); return b ? { ...b, response_id: responseId() } : undefined; })();
  if (binding) um.input_reply = binding;
  if (cont) (um as any).cont = cont;   // Continue on a paused card: the server grants this turn one more budget
  if (rp) um.reply = rp;   // Reply on a bubble (msgreply.ts): shown above this message, sent with it
  // The helper is working on an open card: this message steers it. Its bubble joins that turn (above the reply being written) and
  // no second reply bubble appears; the server confirms with {"t":"steered"} (or opens a new card if that one just closed).
  if (s.streaming && tkLiveCard(ch.slug, s.id)) {
    um.state = "sending"; s.messages.splice(liveReplyAt(s), 0, um);
    s.done = false; s.updated = at; streamTurn(ch, s, text, null, files, um); paintChat(s); return;
  }
  const reply: Msg = { id: rid, role: "agent", body: "", at, steps: [] };
  s.messages.push(um, reply);
  s.done = false; s.updated = at; s.rawLine = "reading your request"; streamTurn(ch, s, text, reply, files, um); paintChat(s);
}
// Continue (a card paused at its budget, stop.ts): "Keep going." with one more budget; the button goes as the card stops being paused.
if (LIVE) document.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-continue]"); if (!b) return;
  e.preventDefault(); e.stopPropagation(); const [slug, sid, card] = b.dataset.continue!.split("|");
  const c = channels.find(x => x.slug === slug), x = c?.sessions.find(y => String(y.id) === sid); if (!c || !x) return;
  const cv = tkCardView(slug, sid, card); if (cv) cv.status = "complete";
  if (route().s !== x) location.hash = `/${slug}/s/${sid}`;
  liveReply(c, x, "Keep going.", [], true, card);
});
// "This task didn't load. Tap to try again", and coming back to the app: a task whose load failed is loaded again.
if (LIVE) {
  document.addEventListener("click", e => { if (!(e.target as HTMLElement).closest("[data-tkload]")) return; e.preventDefault(); const { ch, s } = route(); if (s && loadDue(s, Date.now(), true)) { void liveLoad(ch, s); paintChat(s); } }, true);
  const back = () => { if (document.visibilityState === "hidden") return; const { ch, s } = route(); if (s && s.loadFailAt && loadDue(s, Date.now(), true)) void liveLoad(ch, s); };
  document.addEventListener("visibilitychange", back); window.addEventListener("focus", back);
}
// "Not sent · Retry": the same message again, with the same client id.
if (LIVE) document.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tkretry]"); if (!b) return;
  e.preventDefault(); const { ch, s } = route(); const um = s?.messages.find(m => String(m.id) === b.dataset.tkretry) as TkMsg | undefined; if (!s || !um) return;
  um.state = "sending"; um.err = undefined; s.messages = s.messages.filter(m => m !== um);
  if (!s.srv) { const r: Msg = { id: nextId++, role: "agent", body: "", at: Date.now(), steps: [] }; um.state = undefined; s.messages.push(um, r); s.rawLine = "reading your request"; streamTurn(ch, s, um.body, r, um.files || [], um); paintChat(s); return; }   // a new task that was refused: sent again as its first message
  if (s.streaming && tkLiveCard(ch.slug, s.id)) s.messages.splice(liveReplyAt(s), 0, um); else s.messages.push(um);
  streamTurn(ch, s, um.body, null, um.files || [], um); paintChat(s);
});
// Permission requests (Sentinel). One card per request id per message; every copy of a request shares its state fields.
function addApproval(m: Msg, a: any, fresh: boolean) {
  if (!a) return;
  const existing = (m.cards ??= []).find(k => k.t === "approval" && String(k.a.id) === String(a.id));
  if (existing) { if (["ssh","ssh_hostkey"].includes(a.perm) && a.status !== "pending") { existing.a = {...existing.a,...a}; existing.st = nativeReceiptStatus(a); } return; }
  m.cards.push({ t: "approval", a, st: nativeReceiptStatus(a), fresh });
}
// Connect cards (connect-card.ts): one per offer per message.
function addOffer(m: Msg, ch: Channel, o: any, fresh: boolean) {
  if (!o?.id || (m.cards ??= []).some(k => k.t === "offer" && k.o.id === o.id)) return;
  m.cards.push({ t: "offer", o, ch: ch.slug, fresh } as OfferCard);
}
const offerCards = () => channels.flatMap(c => c.sessions).flatMap(x => x.messages).flatMap(m => m.cards || []).filter(k => k.t === "offer") as OfferCard[];
const apCards = (slug: string, id: string) => approvalCards(channels, slug, id);
let akN = 0; const AK_SEEN = new Set<number>();
document.addEventListener("animationstart", e => { const k = (e.target as HTMLElement).dataset?.ak; if (k) AK_SEEN.add(+k); }, true);
const apRepaint = () => { const { ch, s } = route(); if (s) paintChat(s); else repaint(ch); };
function cardHtml(c: any, ch: Channel) {
  if (c.t === "contact") return ctSuggest(c);
  if (c.t === "plan") return planCardHtml(c);
  if (c.t === "file") return fileCard(ch, c.f, false);
  if (c.t === "deckstyles") return dsCardHtml(c, ch.slug, route().s ? String(route().s!.id) : null);
  // System cards (made by 1HC, never by the model): the /genui card look. Permission markup is shared with the card page inside Messages.
  // Arrival animation for a card that came in live, until it has started once (even if a repaint replaces the node).
  const ak = c.fresh ? (c.ak ??= ++akN) : 0, fr = ak && !AK_SEEN.has(ak) ? " gu-in" : "", akA = ak ? ` data-ak="${ak}"` : "";
  if (c.t === "share") return shCardHtml(c, akA);   // share links + published pages (share.ts)
  if (c.t === "approval") { const a = c.a, at = (k: string) => k === "cancel" ? `data-apcancel="${esc(ch.slug)}|${esc(String(a.id))}"` : `data-apv="${esc(ch.slug)}|${esc(String(a.id))}|${k === "confirm" ? "channel" : k}"${k === "confirm" ? " data-apconfirm" : ""}`;
    return approvalHtml(a, { status: c.st || "pending", confirm: c.confirm, busy: c.busy, error: c.err, fresh: !!fr }, { helper: who(ch), channel: ch.name, attr: at, id: `ap-${ch.slug}-${a.id}`, attrs: akA }); }
  if (c.t === "interview") return ivCard(c, ch, !!fr);
  if (c.t === "lnrefine" && hasFeature("ambient")) return lnRefineCard(c.slug, c.sid, c.r, { fresh: !!fr, attrs: akA });
  if (c.t === "offer" && hasFeature("connected_apps")) return offerCardHtml(c, { helper: who(ch), fresh: !!fr, attrs: akA });
  if (c.t === "browser") return `<div class="acard gu-sys${fr}"${akA}><div class="gu-sh"><span class="gu-si">${ic.lib}${logoOver(c.url || "", 32)}</span><b>${c.text ? "Your turn in the browser" : `${esc(who(ch))} is using the browser`}</b></div><p class="gu-sl">${esc(c.text || HOST_OF(c.url) || c.url || "")}</p>
      <div class="gu-btns"${c.text ? "" : ` data-computer-offer="${esc(ch.slug)}"${watchingComputer(ch.slug) ? " hidden" : ""}`}><button type="button" class="gu-b ${c.text ? "primary" : "secondary"}" data-watch="${esc(ch.slug)}" data-wurl="${esc(c.url || "")}" data-wnote="${esc(c.text || "")}">${c.text ? "Open the browser" : "Watch it live"}</button></div></div>`;
  if (c.t === "image") { const src = `${LIVE!.api}/res/${esc(ch.slug)}/shots/${esc(c.id)}.jpg`, cap = [c.caption, HOST_OF(c.url)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
    return `<button class="shot" data-shot="${src}" data-cap="${esc(cap.join(" · "))}" aria-label="Open screenshot"><img src="${src}" alt="${esc(c.caption || "Screenshot")}" loading="lazy">${cap.length ? `<span>${esc(cap.join(" · "))}</span>` : ""}</button>`; }
  if (c.t === "link" && hasFeature("billing")) { const p = c.p; return `<div class="acard gu-sys${fr}"${akA}><div class="gu-sh"><span class="gu-si">${ic.check}${logoOver(p.merchant_url || "", 32)}</span><b>Approve in Link: ${esc(p.merchant_name || "")} $${(p.amount / 100).toFixed(2)}</b></div><p class="gu-sl">Link is sending the approval to your phone. Nothing is charged unless you approve.${p.test ? " (Test mode, no real charge.)" : ""}</p></div>`; }
  return "";
}
// "Interview me" cards (interview-card.ts): answers save to /res/<ch>/interviews/<id>; Send posts the answers as the person's
// next message in that task, through the same path as typing it.
function ivCard(c: any, ch: Channel, fresh: boolean) {
  if (!LIVE) return "";
  const v = c.v, key = `${ch.slug}|${v.id}`;
  return ivcHtml(v, { key, helper: who(ch), phone, api: (b: any) => api(`/res/${ch.slug}/interviews/${v.id}`, b),
    sent: (message: string, _view, result) => { const s = ch.sessions.find(x => String(x.id) === String(v.session)); if (!s) return;
      if (result?.posted) { s.loaded = false; void liveLoad(ch, s); }
      else liveReply(ch, s, message, [], true, undefined, null, { ...(v.input_reply || {}), ...(v.turn ? { source_turn: v.turn } : {}), response_id: `interview:${v.id}` }); } }, fresh);
}
if (LIVE) {
  // Permission cards: Allow once / for this task / Always (asks "Are you sure?" first, then sends confirm:true) / Don't allow.
  // State lives on the card objects (every copy of the same request), so repaints keep the confirm step and the result.
  document.addEventListener("click", async e => {
    const t = e.target as HTMLElement, cn = t.closest<HTMLElement>("[data-apcancel]");
    if (cn) { e.preventDefault(); const [slug, id] = cn.dataset.apcancel!.split("|"); apCards(slug, id).forEach(k => k.confirm = false); apRepaint(); if (!e.detail) document.querySelector<HTMLElement>(`#ap-${slug}-${id} [data-apv$="|channel"]`)?.focus(); return; }
    const b = t.closest<HTMLElement>("[data-apv]"); if (!b) return;
    e.preventDefault(); const [slug, id, decision] = b.dataset.apv!.split("|") as [string, string, Decision], ks = apCards(slug, id);
    if (!ks.length || ks.some(k => k.busy || k.st !== "pending")) return;
    if (decision === "channel" && !b.hasAttribute("data-apconfirm")) { ks.forEach(k => { k.confirm = true; k.err = ""; }); apRepaint(); if (!e.detail) document.querySelector<HTMLElement>(`#ap-${slug}-${id} [data-apconfirm]`)?.focus(); return; }   // keyboard: move focus into the step
    ks.forEach(k => { k.busy = decision; k.err = ""; }); apRepaint();
    const r = await api(`/res/${slug}/approve`, { id: +id, decision, ...(decision === "channel" ? { confirm: true } : {}) }).catch((err) => ({ error: err.message }));
    approvalResponse(channels, slug, id, decision, r);
    apRepaint();
  }, true);
  // Keep lists fresh: other tasks finishing, scheduled checks reporting in, approvals waiting.
  let sig = "";
  const poll = async () => {
    if (document.hidden) return;
    if (Date.now() - (NB_AT.main || 0) >= 60000) nbSync(main);
    const d = await api(`/app/boot?light=1&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "")}`, undefined, { signal: AbortSignal.timeout(12000) }).catch(() => null); if (!d?.channels) return;
    pomoSet("*", "global", d.pomodoro_global);   // another device or the helper started / stopped it
    let changed = false, added = false;
    for (const c of d.channels) {
      let ch = channels.find(x => x.slug === c.slug);
      if (!ch) { ch = addChannel(c); added = true; }   // a channel made elsewhere (the helper's delegation, another tab) joins the rail
      if (c.sections) ch.cs = csOf(c.sections);   // sections added, renamed, moved or switched on another device
      ch.jobs = c.jobs || []; if (c.files && setFiles(ch, c.files)) changed = true;
      slSet(c.slug, c.later);
      for (const v of c.sessions) {
        let x = ch.sessions.find(y => y.id === v.id);
        if (!x) { x = { id: v.id, title: v.title, status: "resolved", state: "idle", updated: v.updated, messages: [], fresh: true } as Session; ch.sessions.unshift(x); changed = true; }
        const before = x.srv?.updated, nativePhaseChanged = x.srv?.native_progress?.phase !== v.native_progress?.phase; if (!x.streaming) applySrv(x, v); pomoSet(ch.slug, v.id, v.pomodoro); lnSet(ch.slug, v.id, v.livenotes);   // focus timers: every task, so a phase end elsewhere can say so
        if (x.streaming) void reconcileStream(ch, x, v);
        const hch = tkHelperCount(ch.slug, v.id, v.helpers);   // a helper started or finished: its card / handoff card shows up
        if (before !== undefined && (before !== v.updated || hch || nativePhaseChanged) && !x.streaming && x.loaded) { x.loaded = false; if (route().s === x) liveLoad(ch, x); }
      }
    }
    if (added) { if (!phone()) { const top = document.querySelector("#rail .chs")?.scrollTop ?? 0; if (document.querySelector("#rail .chs")) { $("#rail").innerHTML = railHtml(route().ch); railWire(top); } }
      else { const cl = document.getElementById("chlist"); if (cl) cl.innerHTML = chRows((document.getElementById("chq") as HTMLInputElement | null)?.value ?? ""); } }
    const nsig = JSON.stringify(d.channels.map((c: any) => c.sessions.map((v: any) => [v.id, v.state, v.line, v.done, v.pinned, v.unread, v.updated, v.texts, v.helpers, v.title, v.title_revision, v.section])).concat([d.channels.map((c: any) => c.sections || null)]));
    if (changed || nsig !== sig) { sig = nsig; const { ch, s } = route(); if (s) { repaint(ch); paintHeadDone(s); } else refresh(); stNow(); }
    schPaint();   // the Scheduled count and view: jobs (and Send later) may have changed
    { const os = route().s; nfSeen(d.channels, os ? String(os.id) : null); }   // a task started waiting on you or finished: a soft chime (Settings → Notifications → Sounds)
  };
  setInterval(poll, 6000); document.addEventListener("visibilitychange", poll);
}

// Live computer pane: the channel computer's real Chrome, streamed over VNC. noVNC loads only when the pane opens, so chat never wakes the computer.
// Layout copies Grok Bot's phone computer (Captain 10-02): the screen gets the space, a few round buttons float around it,
// "?" explains it in plain words, "⋯" holds trackpad mode, and the bottom bar has clipboard, the one main action and the keyboard.
const PC: { slug?: string; rfb?: any; mode: "view" | "control"; RFB?: any; clip?: string; tp?: boolean; px?: number; py?: number; kb?: string; handoff?: boolean; kbOpen?: boolean; vvMax?: number } = { mode: "view" };
const touchy = () => matchMedia("(pointer: coarse)").matches;
const pci = {
  x: I('<path d="M18 6 6 18M6 6l12 12"/>', 20), back: I('<path d="m15 18-6-6 6-6"/>', 22),
  help: I('<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>', 22),
  more: I('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>', 22),
  clip: I('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>', 20),
  kb: I('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M7 16h10"/>', 20),
  copy: I('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>', 18),
  paste: I('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>', 18),
  check: I('<path d="M20 6 9 17l-5-5"/>', 18),
  scroll: I('<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>', 20),
  tap: I('<path d="M9 11V5a2 2 0 0 1 4 0v6"/><path d="M13 10a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.5L4.4 15a2 2 0 0 1 3.2-2.4L9 14"/>', 20),
  menu: I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', 20),
  zoom: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>', 20),
  pad: I('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="15" cy="9" r="1.5" fill="currentColor"/>', 20),
  hand: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', 20),
};
// Cold-start progress: an honest-feeling estimate, not a spinner. The server reports this computer's typical wake time
// (median of recent wakes); the bar eases toward ~90% by then, creeps slower after, never reaches 100% until connected.
function pcWaitHtml(label: string) {
  return `<div class="pcwait" id="pcwait"><div class="pcprog"><div class="pcpl"><span id="pcplab">${esc(label)}</span><b id="pcpct">0%</b></div>
    <div class="pcbarw"><i id="pcfill"></i></div><small id="pcphase">Waking up</small></div></div>`;
}
let pcProgT = 0;
function pcProgress(estMs: number) {
  clearInterval(pcProgT); const t0 = performance.now(), est = Math.max(2500, estMs || 6000);
  const phases: [number, string][] = [[0, "Waking up"], [.25, "Loading your files"], [.55, "Starting the browser"], [.8, "Connecting"], [1.3, "Almost there"]];
  const tick = () => {
    const fill = document.getElementById("pcfill"); if (!fill) { clearInterval(pcProgT); return; }
    const r = (performance.now() - t0) / est;
    // 0→90% on an ease-out curve by the estimate, then an asymptote toward 99% so it never looks frozen or finished.
    const p = r <= 1 ? 90 * (1 - Math.pow(1 - r, 2)) : 90 + 9 * (1 - Math.exp(-(r - 1) * 1.2));
    fill.style.width = p.toFixed(1) + "%"; const pct = document.getElementById("pcpct"); if (pct) pct.textContent = Math.floor(p) + "%";
    const ph = document.getElementById("pcphase"), lab = phases.filter(([at]) => r >= at).pop()![1]; if (ph && ph.textContent !== lab) ph.textContent = lab;
  };
  tick(); pcProgT = window.setInterval(tick, 100);
}
function pcProgDone() {
  clearInterval(pcProgT); const w = document.getElementById("pcwait"); if (!w) return;
  const f = document.getElementById("pcfill"), pct = document.getElementById("pcpct");
  if (f) f.style.width = "100%"; if (pct) pct.textContent = "100%";
  w.classList.add("done"); setTimeout(() => w.remove(), 350);
}
function pcHtml(ch: Channel, url: string, note: string) {
  const n = esc(who(ch));
  return `<div class="pchead">
      <button class="pcc" id="pcclose" aria-label="Close the computer">${phone() ? pci.back : pci.x}</button>
      <span class="pcwho">${av(ch, "av sm")}<span class="pcwt"><b>${n}'s computer</b><small><span id="pcmode">Watching</span><span id="pcurl">${logoChip(url, 14)}${esc(HOST_OF(url) || "")}</span></small></span></span>
      <button class="pcc" id="pchelp" aria-label="How to use the computer">${pci.help}</button>
      <button class="pcc" id="pcmore" aria-label="More options" hidden>${pci.more}</button></div>
    ${note ? `<div class="pcnote">${esc(note)}</div>` : ""}
    <div class="pcscreen" id="pcscreen">${pcWaitHtml(`Starting ${who(ch)}'s computer`)}</div>
    <div class="pcbar"><button class="pcc" id="pcclip" aria-label="Clipboard" hidden>${pci.clip}</button>
      <button class="pcmain" id="pctake">Take control</button><button class="pcmain" id="pcback" hidden>I'm done, hand back to ${n}</button>
      <button class="pcc" id="pckey" aria-label="Keyboard" hidden>${pci.kb}</button></div>
    <textarea id="pckb" aria-hidden="true" tabindex="-1" readonly inputmode="none" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>`;
}
function pcSetMode(label: string) {
  const m = document.getElementById("pcmode"); if (m) m.textContent = label;
  const ctl = PC.mode === "control" && !!PC.rfb, asleep = label === "Asleep";
  const set = (id: string, on: boolean) => { const e = document.getElementById(id); if (e) e.hidden = !on; };
  set("pctake", !ctl && !asleep); set("pcback", ctl); set("pcclip", ctl); set("pckey", ctl && touchy()); set("pcmore", ctl && touchy());
  document.getElementById("pc")?.classList.toggle("ctl", ctl);
  if (!ctl) { pcPop(); PC.tp = false; if (PC.kbOpen) pcKbSet(false); }
}
async function pcConnect(mode: "view" | "control") {
  const base = `${LIVE!.api}/ch/${PC.slug}/browser`, scr = document.getElementById("pcscreen"); if (!scr) return;
  PC.mode = mode;
  // Progress estimate first: sleep-state never wakes the computer and says how long a wake usually takes here.
  if (document.getElementById("pcfill")) api(`/ch/${PC.slug}/browser/sleep-state`).then((st: any) => {
    if (!document.getElementById("pcfill")) return;
    pcProgress(st?.running ? 1500 : Number(st?.wake_est_ms) + 1500 || 7500); }).catch(() => pcProgress(7500));
  // A cold computer takes a while to boot; wake it with plain fetches first (a failed module import can't be retried).
  if (!PC.RFB) { let up = false;
    for (let i = 0; i < 12 && !up; i++) { up = await fetch(`${base}/novnc/core/rfb.js`, { credentials: "same-origin", cache: "no-store" }).then(r => r.ok && /javascript/.test(r.headers.get("content-type") || "")).catch(() => false); if (!up) await new Promise(r => setTimeout(r, 2500)); if (!document.body.classList.contains("pc-on")) return; }
    try { PC.RFB = (await import(/* @vite-ignore */ `${base}/novnc/core/rfb.js`)).default; }
    catch { clearInterval(pcProgT); const w = document.getElementById("pcwait"); if (w) w.textContent = "Couldn't reach the computer. Close and try again."; return; } }
  if (PC.rfb) { const old = PC.rfb; PC.rfb = null; try { old.disconnect(); } catch {} }
  scr.querySelectorAll(":scope > div:not(#pcwait)").forEach(x => x.remove());
  const ws = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + `${base}/live?mode=${mode}`;
  const rfb = new PC.RFB(scr, ws, { shared: true }); PC.rfb = rfb;
  rfb.viewOnly = mode !== "control"; rfb.scaleViewport = true; rfb.resizeSession = false; rfb.focusOnClick = !touchy(); rfb.background = "transparent";
  rfb.addEventListener("connect", pcProgDone);
  rfb.addEventListener("clipboard", (e: any) => { PC.clip = String(e.detail?.text ?? ""); });
  // If the computer went to sleep (nobody using it), show that instead of reconnecting: reconnecting would wake it again.
  rfb.addEventListener("disconnect", async () => { if (PC.rfb !== rfb || !document.body.classList.contains("pc-on")) return;
    const st = await api(`/ch/${PC.slug}/browser/sleep-state`).catch(() => null);
    if (PC.rfb !== rfb) return;
    if (st && !st.running) { pcAsleep(); return; }
    setTimeout(() => PC.rfb === rfb && pcConnect(PC.mode), 1500); });
  pcSetMode(mode === "control" ? "You're in control" : "Watching");
}
// ---- phone helpers: keys, clipboard, trackpad ----
const KS = { ctrl: 0xffe3, ret: 0xff0d, bs: 0xff08 };
const ksOf = (c: number) => c === 10 ? KS.ret : c >= 0x20 && c <= 0xff ? c : 0x01000000 | c;
function pcKeys(...combo: [number, string][]) { const r = PC.rfb; if (!r) return; combo.forEach(([k, c]) => r.sendKey(k, c, true)); [...combo].reverse().forEach(([k, c]) => r.sendKey(k, c, false)); }
// The phone keyboard types into a hidden field; every change is turned into key presses (same diff noVNC's own app uses,
// because Android keyboards don't send reliable key codes).
const KB_PAD = "_".repeat(60);
function pcKbReset() { const t = document.getElementById("pckb") as HTMLTextAreaElement | null; if (t) { t.value = KB_PAD; PC.kb = KB_PAD; } }
// The keyboard opens and closes ONLY from the keyboard button (Captain 10-02: "let ME control it"). While closed the field is
// readonly with inputmode=none, so no tap, focus or reconnect can bring the phone keyboard back. Closing it with Android's
// own back/collapse is noticed (the visible area grows back) and counts as closed.
function pcKbSet(open: boolean) {
  const k = document.getElementById("pckb") as HTMLTextAreaElement | null; PC.kbOpen = open;
  document.getElementById("pckey")?.classList.toggle("on", open); document.getElementById("pckey")?.setAttribute("aria-pressed", String(open));
  if (!k) return;
  if (open) { k.readOnly = false; k.inputMode = "text"; pcKbReset(); k.focus({ preventScroll: true }); k.setSelectionRange(k.value.length, k.value.length); }
  else { k.readOnly = true; k.inputMode = "none"; k.blur(); }
}
function pcKbWatch() { const vv = window.visualViewport; if (!vv) return;
  PC.vvMax = Math.max(PC.vvMax || 0, vv.height);
  // keyboard collapsed by the system (back button / swipe): visible height is back to full
  if (PC.kbOpen && vv.height >= (PC.vvMax || 0) - 40 && (window as any).__pcKbShown) { (window as any).__pcKbShown = false; pcKbSet(false); }
  if (PC.kbOpen && vv.height < (PC.vvMax || 0) - 120) (window as any).__pcKbShown = true; }
function pcKbInput(t: HTMLTextAreaElement) {
  const r = PC.rfb; if (!r) return; const nv = t.value, ov = PC.kb ?? KB_PAD;
  let i = 0; while (i < nv.length && i < ov.length && nv[i] === ov[i]) i++;
  for (let k = 0; k < ov.length - i; k++) r.sendKey(KS.bs, "Backspace");
  for (const ch of nv.slice(i)) r.sendKey(ksOf(ch.codePointAt(0)!));
  if (nv.length < 10 || nv.length > 200) pcKbReset(); else PC.kb = nv;
}
function pcPop(kind?: "clip" | "more") {
  document.getElementById("pcpop")?.remove(); if (!kind) return;
  const pc = document.getElementById("pc"); if (!pc) return;
  const dev = touchy() ? "Phone" : "this device";
  const d = document.createElement("div"); d.id = "pcpop"; d.className = `pcpop ${kind === "more" ? "pmore" : kind}`; d.setAttribute("role", "menu");
  d.innerHTML = kind === "clip"
    ? `<button role="menuitem" data-pcact="copy">${pci.copy}<span>Copy to ${dev}</span></button><button role="menuitem" data-pcact="paste">${pci.paste}<span>Paste from ${dev}</span></button>`
    : `<button role="menuitem" data-pcact="tp"><i class="pcchk">${PC.tp ? pci.check : ""}</i><span>Trackpad mode</span></button><button role="menuitem" data-pcact="center"><i class="pcchk"></i><span>Recenter pointer</span></button>`;
  pc.appendChild(d);
}
function pcToast(msg: string) {
  const pc = document.getElementById("pc"); if (!pc) return; document.getElementById("pctoast")?.remove();
  const t = document.createElement("div"); t.id = "pctoast"; t.textContent = msg; pc.appendChild(t); setTimeout(() => t.remove(), 2600);
}
async function pcCopy() {
  // Copy whatever is selected on the computer, then hand the text to the phone's clipboard.
  const before = PC.clip; PC.clip = undefined; pcKeys([KS.ctrl, "ControlLeft"], [0x63, "KeyC"]);
  const got = new Promise<string>(res => { let n = 0; const iv = setInterval(() => { if (PC.clip !== undefined || ++n > 12) { clearInterval(iv); res(PC.clip ?? before ?? ""); } }, 50); });
  try {
    if ((window as any).ClipboardItem && navigator.clipboard?.write) await navigator.clipboard.write([new ClipboardItem({ "text/plain": got.then(t => { if (!t) throw new Error("empty"); return new Blob([t], { type: "text/plain" }); }) })]);
    else { const t = await got; if (!t) throw new Error("empty"); await navigator.clipboard.writeText(t); }
    pcToast("Copied to your " + (touchy() ? "phone" : "clipboard"));
  } catch { pcToast((await got) ? "Your browser blocked the copy. Try again." : "Select some text on the computer first, then copy."); }
}
async function pcPaste() {
  let t = ""; try { t = await navigator.clipboard.readText(); } catch { pcToast("Allow paste when your browser asks, then try again."); return; }
  if (!t) { pcToast("Your clipboard is empty."); return; }
  PC.rfb?.clipboardPasteFrom(t); setTimeout(() => pcKeys([KS.ctrl, "ControlLeft"], [0x76, "KeyV"]), 120); pcToast("Pasted");
}
// Trackpad mode: the finger moves the pointer instead of tapping where it lands. Tap clicks at the pointer,
// double-tap-and-hold drags, two fingers scroll. Touches are caught on the way down so noVNC's own gestures don't also fire.
function pcCanvas() { return document.querySelector("#pcscreen canvas") as HTMLCanvasElement | null; }
function pcPoint(mask = 0) { const r = PC.rfb, c = pcCanvas(); if (!r || !c || PC.px === undefined) return;
  const b = c.getBoundingClientRect(); PC.px = Math.max(0, Math.min(b.width - 1, PC.px)); PC.py = Math.max(0, Math.min(b.height - 1, PC.py!));
  r._mousePos = { x: PC.px, y: PC.py }; r._sendMouse?.(PC.px, PC.py, mask); r._cursor?.move?.(b.left + PC.px, b.top + PC.py!); }
function pcCenter() { const c = pcCanvas(); if (!c) return; const b = c.getBoundingClientRect(); PC.px = b.width / 2; PC.py = b.height / 2; pcPoint(); }
function pcTrackpad(scr: HTMLElement) {
  let last: { x: number; y: number } | null = null, t0 = 0, moved = 0, two = false, acc = 0, lastTap = 0, dragging = false;
  const on = (e: TouchEvent) => PC.tp && PC.mode === "control" && !!PC.rfb;
  scr.addEventListener("touchstart", e => { if (!on(e)) return; e.stopPropagation(); e.preventDefault();
    if (PC.px === undefined) pcCenter();
    two = e.touches.length > 1; const t = e.touches[0]; last = { x: t.clientX, y: t.clientY }; t0 = Date.now(); moved = 0; acc = 0;
    if (!two && Date.now() - lastTap < 300) { dragging = true; pcPoint(1); } }, { capture: true, passive: false });
  scr.addEventListener("touchmove", e => { if (!on(e) || !last) return; e.stopPropagation(); e.preventDefault();
    const t = e.touches[0], dx = t.clientX - last.x, dy = t.clientY - last.y; last = { x: t.clientX, y: t.clientY }; moved += Math.abs(dx) + Math.abs(dy);
    if (e.touches.length > 1 || two) { two = true; acc += dy; while (Math.abs(acc) > 30) { const up = acc > 0; pcPoint(up ? 8 : 16); pcPoint(dragging ? 1 : 0); acc += up ? -30 : 30; } return; }
    const k = 1.6; PC.px! += dx * k; PC.py! += dy * k; pcPoint(dragging ? 1 : 0); }, { capture: true, passive: false });
  scr.addEventListener("touchend", e => { if (!on(e)) return; e.stopPropagation(); e.preventDefault(); if (e.touches.length) return;
    if (dragging) { dragging = false; pcPoint(0); lastTap = 0; }
    else if (!two && moved < 10 && Date.now() - t0 < 250) { pcPoint(1); pcPoint(0); lastTap = Date.now(); }
    last = null; }, { capture: true, passive: false });
}
function pcHelp() {
  const pc = document.getElementById("pc"); if (!pc) return; const n = esc(who(channels.find(c => c.slug === PC.slug)!)), t = touchy();
  const row = (icon: string, h: string, p: string) => `<div class="hrow">${icon}<div><b>${h}</b><p>${p}</p></div></div>`;
  const d = document.createElement("div"); d.id = "pchelpv"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "Using the computer");
  d.innerHTML = `<div class="hhead"><button class="pcc" id="pchelpx" aria-label="Close">${pci.x}</button><h2>Using the computer</h2></div><div class="hbody">
    <p class="hlead">This is ${n}'s own computer. You watch while ${n} works. Tap <b>Take control</b> to use it yourself.</p>
    <h3>Moving around</h3><div class="hcard">${t
      ? row(pci.scroll, "Scroll", "Drag with two fingers.") + row(pci.tap, "Click and drag", "Tap to click where you tapped. One finger drags.") + row(pci.menu, "Right-click", "Tap with two fingers, or press and hold.") + row(pci.zoom, "Zoom in", "Pinch to zoom the page.")
      : row(pci.scroll, "Scroll", "Use your mouse wheel or trackpad.") + row(pci.tap, "Click and drag", "Works like your own computer.") + row(pci.menu, "Right-click", "Right-click as usual.")}</div>
    <h3>Typing and the clipboard</h3><div class="hcard">${t ? row(pci.kb, "Type", "Tap the keyboard button in the bottom bar.") : row(pci.kb, "Type", "Click the page, then type on your keyboard.")}
      ${row(pci.clip, "Copy and paste", `Tap the clipboard button in the bottom bar for Copy to ${t ? "Phone" : "this device"} and Paste from ${t ? "Phone" : "this device"}.`)}</div>
    ${t ? `<h3>When a pointer is easier</h3><div class="hcard">${row(pci.pad, "Trackpad mode", "Turn it on from the ⋯ menu. Your finger moves the pointer. Tap to click there, double-tap and hold to drag. Recenter the pointer if it drifts.")}</div>` : ""}
    <h3>Handing it back</h3><div class="hcard">${row(pci.hand, "I'm done", `Tap <b>I'm done</b> and ${n} carries on from where you left it. Going back does the same.`)}</div></div>`;
  pc.appendChild(d); requestAnimationFrame(() => d.classList.add("on"));
}
// Guardrail: an open pane keeps the computer awake only while the person is actually there (moving, clicking, typing
// in this tab). A hidden tab or a walk-away sends nothing, so the computer sleeps after 5 min and stops costing.
// If they took control and walked away, a Netflix-style "Still there?" gives them 15 s before it sleeps.
let pcLastPing = 0, pcTick: any = 0, pcClock: any = 0, pcDeadline = 0, pcHoldUntil = 0;
const STILL_S = 15;
function pcSeen(st: any) { if (st && st.running && st.held_by === "you" && st.sleeps_in_ms != null) pcDeadline = Date.now() + st.sleeps_in_ms; else pcDeadline = 0; }
function pcActive() {
  if (!PC.slug || !PC.rfb || document.hidden || !document.body.classList.contains("pc-on") || document.getElementById("pcstill")) return;
  if (Date.now() - pcLastPing < 45e3) return; pcLastPing = Date.now();
  api(`/ch/${PC.slug}/browser/presence`, {}).then(pcSeen).catch(() => {});
}
async function pcWatch() {
  if (!PC.slug || !PC.rfb) return;
  const st = await api(`/ch/${PC.slug}/browser/sleep-state`).catch(() => null); if (st && PC.rfb) pcSeen(st);
}
function pcStillCheck() {
  if (document.getElementById("pcstill") || !pcDeadline || PC.mode !== "control" || !PC.rfb || Date.now() < pcHoldUntil) return;
  if (pcDeadline - Date.now() <= (STILL_S + 2) * 1e3) pcStill();
}
function pcStill() {
  const pc = document.getElementById("pc"); if (!pc) return;
  const d = document.createElement("div"); d.id = "pcstill"; d.setAttribute("role", "alertdialog");
  d.innerHTML = `<div class="stcard"><h3>Still there?</h3><p>The computer goes to sleep in <b id="stn">${STILL_S}</b> seconds so you're not paying for it.</p>
    <div class="stbtns"><button class="pcbtn on" id="styes">Yes</button><button class="pcbtn" id="styes30">Yes, don't ask for 30 min</button></div></div>`;
  pc.appendChild(d); requestAnimationFrame(() => d.classList.add("on")); (d.querySelector("#styes") as HTMLElement).focus();
  let n = STILL_S; const iv = setInterval(async () => {
    if (!document.getElementById("pcstill")) { clearInterval(iv); return; }
    n--; const el = document.getElementById("stn"); if (el) el.textContent = String(Math.max(n, 0));
    if (n <= 0) { clearInterval(iv); d.remove(); const slug = PC.slug; pcAsleep(); if (slug) api(`/ch/${slug}/sleep`, {}).catch(() => {}); }
  }, 1000);
}
async function pcStillAnswer(holdMin: number) {
  document.getElementById("pcstill")?.remove(); pcLastPing = Date.now();
  if (holdMin) pcHoldUntil = Date.now() + holdMin * 60e3;
  const st = await api(`/ch/${PC.slug}/browser/presence`, holdMin ? { hold_ms: holdMin * 60e3 } : {}).catch(() => null); pcSeen(st);
}
function pcAsleep() {
  pcDeadline = 0; document.getElementById("pcstill")?.remove();
  const scr = document.getElementById("pcscreen"); if (!scr) return;
  const old = PC.rfb; PC.rfb = null; try { old?.disconnect(); } catch {}
  PC.mode = "view"; pcSetMode("Asleep");
  scr.querySelectorAll("div").forEach(x => x.remove());
  const w = document.createElement("div"); w.className = "pcwait pcasleep"; w.innerHTML = `<div><p>The computer went to sleep because nobody was using it, so you're not paying for it.</p><button class="pcmain" id="pcwake">Wake it up</button></div>`; scr.appendChild(w);
}
// Phone: when the keyboard opens, shrink the pane to the visible area so the screen stays above the keyboard.
function pcFit() { const pc = document.getElementById("pc"); if (!pc) return; const vv = window.visualViewport;
  if (phone() && vv && document.body.classList.contains("pc-on")) { pc.style.height = `${vv.height}px`; pc.style.top = `${vv.offsetTop}px`; } else { pc.style.height = ""; pc.style.top = ""; } }
function openPC(slug: string, url = "", note = "") {
  const ch = channels.find(c => c.slug === slug); if (!ch) return;
  let pc = document.getElementById("pc"); if (!pc) { pc = document.createElement("section"); pc.id = "pc"; document.body.appendChild(pc); }
  if (PC.slug === slug && document.body.classList.contains("pc-on")) {
    if (url) document.getElementById("pcurl")!.innerHTML = logoChip(url, 14) + esc(HOST_OF(url) || url);
    // A handoff can arrive after the person opened the viewer themselves. Show its
    // instructions in the existing pane without reconnecting or taking control.
    if (note) { let n = pc.querySelector<HTMLElement>(".pcnote"); if (!n) { n = document.createElement("div"); n.className = "pcnote"; pc.querySelector(".pchead")!.after(n); } n.textContent = note; PC.handoff = true; }
    computerViewerChanged(slug); return;
  }
  closePC(true); PC.slug = slug; PC.px = undefined; PC.tp = false; PC.handoff = !!note; pc.innerHTML = pcHtml(ch, url, note); document.body.classList.add("pc-on"); pcFit(); pcKbReset();
  computerViewerChanged(slug);
  const scr = document.getElementById("pcscreen")!; pcTrackpad(scr);
  PC.kbOpen = false; (window as any).__pcKbShown = false; PC.vvMax = window.visualViewport?.height || 0;
  const kbx = document.getElementById("pckb") as HTMLTextAreaElement;
  kbx.addEventListener("input", e => pcKbInput(e.target as HTMLTextAreaElement));
  // a focus we didn't ask for (canvas tap, reconnect, page code) is dropped right away
  kbx.addEventListener("focus", () => { if (!PC.kbOpen) kbx.blur(); });
  // tapping the keyboard button must not move focus first (that would close the keyboard before the toggle runs)
  document.getElementById("pckey")!.addEventListener("pointerdown", e => e.preventDefault());
  (document.getElementById("pckb") as HTMLTextAreaElement).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); PC.rfb?.sendKey(KS.ret, "Enter"); } });
  pcConnect("view");
  pcLastPing = Date.now(); pcDeadline = 0; pcHoldUntil = 0; clearInterval(pcTick); clearInterval(pcClock);
  pcTick = setInterval(pcWatch, 15e3); pcClock = setInterval(pcStillCheck, 1000);
}
async function closePC(quiet = false) {
  const was = PC.mode === "control" && PC.slug; const rfb = PC.rfb; PC.rfb = null; PC.mode = "view";
  try { rfb?.disconnect(); } catch {}
  if (was) api(`/ch/${was}/browser/release`, {}).catch(() => {});
  clearInterval(pcTick); clearInterval(pcClock); pcTick = pcClock = 0; pcDeadline = 0; document.getElementById("pcstill")?.remove();
  if (!quiet) { document.body.classList.remove("pc-on"); const pc = document.getElementById("pc"); if (pc) { pc.innerHTML = ""; pc.style.height = ""; pc.style.top = ""; } PC.slug = undefined; computerViewerChanged(null); }
}
if (LIVE) {
  document.addEventListener("click", async e => {
    const t = e.target as HTMLElement, w = t.closest<HTMLElement>("[data-watch]");
    if (w) { e.preventDefault(); openPC(w.dataset.watch!, w.dataset.wurl, w.dataset.wnote); return; }
    const sh = t.closest<HTMLElement>("[data-shot]");
    if (sh) { e.preventDefault(); openShotLightbox(sh); return; }
    if (t.closest("#lb")) { document.getElementById("lb")?.remove(); return; }
    if (!t.closest("#pc")) return;
    const act = t.closest<HTMLElement>("[data-pcact]")?.dataset.pcact;
    if (!t.closest("#pcpop, #pcclip, #pcmore")) pcPop();
    if (t.closest("#pcclose")) { closePC(); return; }
    if (t.closest("#pchelp")) { pcHelp(); return; }
    if (t.closest("#pchelpx")) { document.getElementById("pchelpv")?.remove(); return; }
    if (t.closest("#pcclip")) { document.getElementById("pcpop")?.classList.contains("clip") ? pcPop() : pcPop("clip"); return; }
    if (t.closest("#pcmore")) { document.getElementById("pcpop")?.classList.contains("pmore") ? pcPop() : pcPop("more"); return; }
    if (act) { pcPop();
      if (act === "copy") pcCopy(); else if (act === "paste") pcPaste();
      else if (act === "tp") { PC.tp = !PC.tp; if (PC.tp) pcCenter(); pcToast(PC.tp ? "Trackpad mode on" : "Trackpad mode off"); }
      else if (act === "center") pcCenter();
      return; }
    if (t.closest("#pckey")) { pcKbSet(!PC.kbOpen); return; }
    if (t.closest("#styes")) { pcStillAnswer(0); return; }
    if (t.closest("#styes30")) { pcStillAnswer(30); return; }
    if (t.closest("#pcwake")) { const scr = document.getElementById("pcscreen"); if (scr) scr.innerHTML = pcWaitHtml(`Waking ${who(channels.find(c => c.slug === PC.slug)!)}'s computer`); pcLastPing = Date.now(); PC.mode = "view"; pcSetMode("Waking up"); pcConnect("view"); return; }
    if (t.closest("#pctake")) { const r = await api(`/ch/${PC.slug}/browser/control`, {}).catch((x: any) => ({ ok: false, error: x.message })); if (r.ok) pcConnect("control"); else pcToast(r.error || "Couldn't take control"); return; }
    if (t.closest("#pcback")) { pcKbSet(false); await api(`/ch/${PC.slug}/browser/release`, {}).catch(() => {}); document.querySelector(".pcnote")?.remove(); pcConnect("view");
      // Like Grok's "I'm done, continue": if the helper handed the browser over and is waiting, tell it to carry on.
      const ch = channels.find(c => c.slug === PC.slug), s = route().s;
      // A worker's browser pause counts whether the card came from a live event or from the saved task (a reload, another device): the server holds
      // the task on the browser, or the open task still shows the worker's Take control card. The message goes once; the card goes with it.
      const paused = !!s && (s.srv?.waiting === "browser" || s.messages.some(m => (m.cards || []).some(c => c.t === "browser" && c.text)));
      if (ch && s && !s.streaming && ((PC.handoff && s.status === "waiting") || paused)) {
        for (const m of s.messages) if (m.cards?.some(c => c.t === "browser")) m.cards = m.cards.filter(c => c.t !== "browser");
        if (s.srv?.waiting === "browser") s.srv = { ...s.srv, waiting: null };
        liveReply(ch, s, "I'm done in the browser. Please continue.");
      }
      PC.handoff = false; return; }
  });
  window.addEventListener("keydown", e => { if (e.key === "Escape" && document.getElementById("lb")) { e.stopImmediatePropagation(); document.getElementById("lb")!.remove(); } }, true);
  window.addEventListener("keydown", e => { if (e.key !== "Escape" || !document.body.classList.contains("pc-on")) return;
    if (document.getElementById("pchelpv")) { document.getElementById("pchelpv")!.remove(); return; }
    if (document.getElementById("pcpop")) { pcPop(); return; }
    if (!S.open && !NT.open && PC.mode !== "control") closePC(); });
  for (const ev of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, pcActive, { passive: true, capture: true });
  window.visualViewport?.addEventListener("resize", () => { pcFit(); pcKbWatch(); }); window.visualViewport?.addEventListener("scroll", pcFit);
  window.addEventListener("hashchange", () => { const { ch } = route(); if (PC.slug && ch.slug !== PC.slug) closePC(); });
}

// Back from an app's own sign-in page (Composio): say what happened, refresh the list.
// Back from Composio's sign-in for Self-managed apps (?cmp=…, apps-mode.ts).
if (LIVE && hasFeature("connected_apps") && new URLSearchParams(location.search).get("cmp")) {
  const sp = new URLSearchParams(location.search); history.replaceState(null, "", location.pathname + location.hash);
  if (!sp.get("appst")) setTimeout(() => { openSettings("accounts"); cmBack(sp); }, 50);
}
if (LIVE && hasFeature("connected_apps") && new URLSearchParams(location.search).get("appst") === "connected" && new URLSearchParams(location.search).get("app") === "composio") {
  // The "Reconnect Composio" card: back in the task, the card shows it; nothing else to say.
  history.replaceState(null, "", location.pathname + location.hash); cxLoad(true);
} else if (LIVE && hasFeature("connected_apps") && new URLSearchParams(location.search).get("appst")) {
  const sp = new URLSearchParams(location.search), app = sp.get("app") || "", okd = sp.get("appst") === "connected", back = sp.get("from"); history.replaceState(null, "", location.pathname + location.hash);
  if (back === "apps") setTimeout(() => openApps()); else if (back !== "offer") openSettings("accounts");   // offer: back in the task, the card shows it
  const already = sp.get("already") === "1";
  fetch(`${LIVE.api}/apps`, { credentials: "same-origin" }).then(r => r.json()).then(d => { cxSet(d.accounts); const mine = (d.accounts || []).filter((x: Acct) => x.app === app), a = mine.find((x: Acct) => x.status === "connected") || mine[0];
    const name = a?.name || app; const live = a?.status === "connected", n = mine.filter((x: Acct) => x.status === "connected").length, newest = mine.find((x: Acct) => x.status === "connected");
    if (live && already) { note(ic.check, `${newest ? acLabel(newest) : "That account"} was already connected`, `To add a different ${name} account, tap Add another and pick that account on the sign-in page.`, ""); return; }
    note(live ? ic.check : g("help", 14), live ? `${name} connected` : `${name} didn't connect`, live ? (back === "offer" ? `${who(main)} is carrying on with what you asked.` : n > 1 && newest ? `${acLabel(newest)} added. You have ${n} ${name} accounts; ${acLabel(mine.find((x: Acct) => x.default) || newest)} is the default.` : `${who(main)} can use it now. Just ask.`) : okd ? "It's still finishing. Check again in a moment." : "Nothing changed. Try Connect again.", ""); }).catch(() => {});
}
// Back from Stripe's plan picker: confirm, then drop the flag so a refresh doesn't repeat it.
if (LIVE && hasFeature("connected_apps") && new URLSearchParams(location.search).get("google")) {
  const sp = new URLSearchParams(location.search), gs = sp.get("google"), back = sp.get("from"); history.replaceState(null, "", location.pathname + location.hash);
  if (back === "apps") setTimeout(() => openApps()); else openSettings("accounts");
  note(gs === "connected" ? ic.check : g("help", 14), gs === "connected" ? "Google connected" : "Google didn't connect", gs === "connected" ? "Your helper can now read your email and calendar when you ask." : "Nothing changed. Try Connect again.", "");
}
if (LIVE && new URLSearchParams(location.search).get("plan") === "changed") {
  const u = new URL(location.href); u.searchParams.delete("plan"); history.replaceState(null, "", u.pathname + u.search + u.hash);
  setTimeout(() => note(ic.check, `You're on ${String(BOOT?.account?.plan || "your new")} plan`, "Upgrades apply right away. A smaller plan starts on your next bill.", ""), 400);
}
// Back from Switch now (byok.ts): the new plan is in the boot data. Say what happened, then show the usage card.
if (LIVE && new URLSearchParams(location.search).get("plan") === "byok") {
  const u = new URL(location.href), moved = u.searchParams.get("moved") || "", bill = Number(u.searchParams.get("bill")) || 0; u.searchParams.delete("plan"); u.searchParams.delete("moved"); u.searchParams.delete("bill"); history.replaceState(null, "", u.pathname + u.search + u.hash);
  setTimeout(() => { openSettings(phone() ? "" : "general"); note(ic.check, "You're on the Bring your own key plan", `${moved && moved !== "$0.00" ? `${moved} of unused plan usage is now credits. ` : ""}Your next bill is $10${bill ? ` on ${new Date(bill).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}.`, ""); }, 400);
}
// Back from Stripe (Manage billing, Add credits, Fix payment) or an email link: 1HC sends ?settings=<section> (usage: Settings → Usage),
// plus ?topup=1 / ?resubscribed=1 after a payment. Open that section, say what happened, then drop the flags so a refresh doesn't repeat it.
// (?settings=byok and ?settings=credits are byok.ts's.)
if (LIVE) {
  const u = new URL(location.href), sec = u.searchParams.get("settings") || "", topup = u.searchParams.get("topup") === "1", resub = u.searchParams.get("resubscribed") === "1";
  const known = sec === "usage" || sec === "account" || sec === "bee" || SECS.some(x => x[0] && x[0] === sec);
  if (known || topup || resub) {
    if (known) u.searchParams.delete("settings"); u.searchParams.delete("topup"); u.searchParams.delete("resubscribed");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    const usage = !known || sec === "usage";   // Usage is General's top (the phone's Settings home)
    setTimeout(() => { if (usage) openSettings(phone() ? "" : "general"); else openSettings(sec); }, 300);
    if (topup) {
      setTimeout(() => note(ic.check, "Credits added", "They show in your balance in a few seconds.", ""), 400);
      // The payment posts by webhook: pick up the new balance once it has landed.
      creditsRefresh();
    }
    if (resub) setTimeout(() => note(ic.check, "Your plan is back on", "Everything works again in a few seconds.", ""), 400);
  }
}
// ---------- Notebook: the channel's memory as a page you can read and edit (Town's wiki, our words) ----------
type Note = { id: number | string; sec: string; text: string; at: number; from?: [string, number]; fresh?: boolean; you?: boolean; src?: string };
const NB_SECS: [string, string][] = [["about", "About you"], ["how", "How you like things"], ["people", "People"], ["places", "Accounts & places"], ["now", "Right now"]];
const NBD: Record<string, { notes: Note[] }> = {};
let nbId = 1;
const nn = (sec: string, text: string, ago: number, from?: [string, number], x: Partial<Note> = {}): Note => ({ id: nbId++, sec, text, at: NOW - ago, from, ...x });
if (!LIVE) {
  NBD.main = {
    notes: [
      nn("about", "Lives in Portland, OR (97205). Pacific time.", 12 * D, undefined, { you: true }),
      nn("about", "Bikes to work most days. Wind over 15 mph matters more than light rain.", 11 * D, ["weather-watch", 10]),
      nn("how", "Short answers. The important part first, details after.", 12 * D, undefined, { you: true }),
      nn("how", "Always ask before sending, paying or deleting anything.", 12 * D, undefined, { you: true }),
      nn("how", "Texts are fine for anything urgent. Nothing between 10 PM and 7 AM.", 9 * D),
      nn("how", "Prefers an aisle seat on long flights.", 2 * H, ["trip-planning", 26], { fresh: true }),
      nn("people", "Sam: partner. Dentist Thursdays at 3:15 this month, so you do pickup.", 6 * D, ["family-schedule", 11]),
      nn("people", "Maya: daughter. Soccer Tue & Thu at 5:30 PM, starting Oct 6.", 5 * D, ["family-schedule", 12]),
      nn("people", "Grandma: birthday Oct 14. Likes a phone call in the morning.", 4 * D, ["family-schedule", 15]),
      nn("places", "Bills come from PGE, NW Natural and Comcast. Anything over $200 gets a heads-up.", 3 * D, ["home-finances", 23]),
      nn("places", "Maya's school lets out early on Wednesdays (1:15 PM).", 5 * D, ["family-schedule", 14]),
      nn("now", "Japan trip, Nov 3–13: Tokyo, then Kyoto. Watching the Delta fare ($1,742).", 6 * H, ["trip-planning", 29]),
      nn("now", "Saving for a 6-month emergency fund, about $27,000.", 1 * D, ["home-finances", 25]),
      nn("now", "Building a portfolio site, live at portfolio-7ok.pages.dev.", 3 * H, ["side-project", 20]),
    ] };
}
function nbOf(ch: Channel) {
  if (NBD[ch.slug]) return NBD[ch.slug];
  if (LIVE) {
    const rows = (ch.notes || []) as any[];
    NBD[ch.slug] = { notes: rows.filter(r => r.sec !== "ov").map(r => ({ id: r.id, sec: NB_SECS.some(x => x[0] === r.sec) ? r.sec : "how", text: r.text, at: r.at || Date.now(), you: !!r.you, src: r.src })) } as any;
    return NBD[ch.slug];
  }
  const src = (t: string) => { for (const x of ch.sessions) for (const m of x.messages) if (m.steps.some(st => st.includes(t.slice(0, 24)))) return [ch.slug, x.id] as [string, number]; return undefined; };
  NBD[ch.slug] = {
    notes: ch.memory.map((t, i) => nn(/birthday|:\s/.test(t) && /^[A-Z][a-z]+('s)? /.test(t) && !/goal/i.test(t) ? "people" : /goal|starts/i.test(t) ? "now" : "how", t, (i + 2) * D, src(t))) };
  return NBD[ch.slug];
}
const nbNotes = (ch: Channel) => nbOf(ch).notes;
const NBUI = { edit: 0 as number | string, add: "", menu: 0 as number | string };
const NB_BEE_UNREAD = notebookBeeUnread(LIVE?.slug || "sandbox", "main", (() => { try { return localStorage; } catch { return undefined; } })());
function nbBeePaint() {
  if (!hasFeature("ambient")) return ;
  document.querySelectorAll<HTMLAnchorElement>('a[href$="/notebook"]').forEach(el => {
    const channel = el.getAttribute("href")?.match(/^#\/([^/]+)\/notebook$/)?.[1]; if (!channel) return;
    const unread = channel === "main" && NB_BEE_UNREAD.unread();
    el.setAttribute("aria-label", unread ? "Notebook — new from Bee" : "Notebook");
    let dot = el.querySelector<HTMLElement>(".nbbeedot");
    if (!dot) { dot = document.createElement("i"); dot.className = "nbbeedot"; dot.setAttribute("aria-hidden", "true"); (el.querySelector(".dti") || el).appendChild(dot); }
    dot.hidden = !unread;
  });
}
function nbBeeVisit(ch: Channel) { if (!hasFeature("ambient") || ch.slug !== "main" || document.hidden) return; NB_BEE_UNREAD.visit(); nbBeePaint(); }
// Live: every change is saved on the server (the helper reads these notes at the start of each task).
const nbApi = (ch: Channel, b: any) => LIVE ? fetch(`${LIVE.api}/notebook/${ch.slug}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()) : Promise.resolve({});
// A refused secret (nosecrets: a password, key, card number or code) says where it belongs, and the unsaved copy goes away.
const nbFail = (r?: any, ch?: Channel) => { if (r?.secret) { note(g("help", 14), "Not saved: that looks like a password or key", "Secrets aren't kept in the notebook. Save logins and keys in Settings → Passwords & keys.", ""); if (ch) nbSync(ch, true); return; }
  note(g("help", 14), "Couldn't save that", "Check your connection and try again.", ""); };
// One note, drawn on the All notes page. Edit / Delete show on hover; on touch (or a narrow pane) they sit behind the more button.
const NB_MORE = I('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', 16);
const nbOrder = (ns: Note[]) => [...ns].sort((a, b) => Number(!!b.fresh) - Number(!!a.fresh) || b.at - a.at);
function nbRow(ch: Channel, n: Note) {
  const src = n.from ? channels.find(c => c.slug === n.from![0]) : null, ss = src?.sessions.find(x => x.id === n.from![1]);
  if (String(NBUI.edit) === String(n.id)) return `<div class="nbrow editing" data-nid="${n.id}" data-unsaved="note" data-unsaved-key="${n.id}"><textarea class="nedit" id="nedit" rows="2" aria-label="Edit note">${esc(n.text)}</textarea>
    <div class="nbtns"><button class="sa" data-nsave="${n.id}">Save</button><button class="sa mute" data-ncancel>Cancel</button></div></div>`;
  const chip = n.src === "bee" ? `<span class="nbchip bee">${beeMark(13)}From Bee</span>` : n.you ? `<span class="nbchip">You told me</span>` : "";
  const where = n.src === "bee" ? "" : n.you ? (n.src === "interview" ? "Get to know you" : "") : ss ? `Learned in <a href="#/${src!.slug}/s/${ss.id}">${esc(ss.title)}</a>${src !== ch ? ` · ${esc(src!.name)}` : ""}` : "Learned while working";
  const open = String(NBUI.menu) === String(n.id);
  return `<div class="nbrow${n.fresh ? " fresh" : ""}${open ? " menu" : ""}" data-nid="${n.id}"><div class="nmain"><p>${esc(n.text)}</p>
    <div class="nbmeta">${n.fresh ? `<b class="nnew">New</b>` : ""}${chip}<span>${[where, fileDate(n.at)].filter(Boolean).join(" · ")}</span></div></div>
    <span class="nact"><button class="nbi" data-nedit="${n.id}" aria-label="Edit note" title="Edit">${ic.pen}</button><button class="nbi" data-ndel="${n.id}" aria-label="Delete note" title="Delete">${ic.trash}</button></span>
    <span class="nbmw"><button class="nbi nbmore" data-nmore="${n.id}" aria-label="Edit or delete this note" aria-haspopup="menu" aria-expanded="${open}">${NB_MORE}</button>${open ? `<span class="nbmenu" role="menu"><button role="menuitem" data-nedit="${n.id}">${ic.pen}<span>Edit</span></button><button role="menuitem" class="nbdel" data-ndel="${n.id}">${ic.trash}<span>Delete</span></button></span>` : ""}</span></div>`;
}
const nbAddBox = (k: string) => NBUI.add === k ? `<div class="nbrow editing" data-unsaved="note" data-unsaved-key="add:${k}"><textarea class="nedit" id="nadd" rows="2" placeholder="Write it the way you'd tell a person" aria-label="New note"></textarea><div class="nbtns"><button class="sa" data-nsaveadd="${k}">Add</button><button class="sa mute" data-ncancel>Cancel</button></div></div>` : "";
// "New from Bee" (General only, above the article): facts the Bee app learned that aren't confirmed yet. Approve / Edit / Deny each;
// an approved (or edited) fact is confirmed in Bee with its own tags and becomes a "From Bee" note. Shown only when some are waiting.
type BeeFact = { id: number; text: string; tags?: string[]; at?: number | null };
// sent: decided here, the server not answered yet (a Notebook re-read mustn't bring them back).
const BF = { edit: 0, done: 0, sent: new Set<number>(), err: null as null | { id: number; msg: string } };
const beePending = (ch: Channel): BeeFact[] => (ch as any).beePending || [];
if (!LIVE) (window as any).__beeFactsDemo = (on = true) => { const m = channels.find(c => c.slug === "main"); if (!m) return;
  (m as any).beePending = on ? [{ id: 9101, text: "Joseph is training for the Portland marathon in May", tags: ["health"], at: NOW - 3 * H }, { id: 9102, text: "Joseph's favorite airline is Alaska", tags: ["travel"], at: NOW - 5 * H },
    { id: 9103, text: "Joseph prefers window seats on flights under three hours, and aisle seats on anything longer", tags: ["travel"], at: NOW - D }] : [];
  const nb = nbOf(m); if (on && !nb.notes.some(n => n.src === "bee")) nb.notes.push(nn("about", "Drinks oat milk lattes, extra hot", 2 * D, undefined, { src: "bee", you: true }), nn("people", "Dana is Joseph's coworker on the platform team", 2 * D, undefined, { src: "bee", you: true }));
  if (isNb()) render(); };
// The server's list (a Notebook re-read, an answer) merged into ours: our order (Skip) kept, new ones at the back, ours in flight left out.
function bfMerge(ch: Channel, srv: BeeFact[]) {
  const by = new Map(srv.filter(f => !BF.sent.has(f.id)).map(f => [f.id, f])), mine = beePending(ch).filter(f => by.has(f.id)).map(f => by.get(f.id)!);
  const have = new Set(mine.map(f => f.id)); (ch as any).beePending = [...mine, ...[...by.values()].filter(f => !have.has(f.id))];
}
// "New speaker detected" (General only, in the New from Bee area; bee-speakers.js): one card per speaker per recording, as Bee labelled
// it, with the possible Contacts matches the server sends. One click answers it (Captain 2026-10-21): exactly one match asks "Is <label> <person>?" with Yes, Not them
// and Edit; several matches show a Yes on each one; no match keeps Accept, which ends the review. Yes links that speaker in that recording to that person (and the server
// remembers the label, so the same label in another recording needs no card); nothing else is ever linked. No helper or status text: the card shows Bee's label, the name given to it, the matches,
// the speaker's own words (excerpt, two lines, as on a generic card) and the recording's time and place. An answer that names nobody (Accept, or an Edit and Not them that end with no match)
// is remembered by the server for the label, and the other waiting cards with that label leave in the same response (`cleared`).
// generic: Bee's label names nobody ("Unknown", "Speaker 2", "Others", an id). The server sends a card only for a generic label that has its own Bee speaker id
// (spk starts with "id:"); a generic label with no id is never a card, because one such voice can hold several people's words. Such a card shows the speaker's
// own words (excerpt, two lines), the recording's date and time and its place, has no Accept (Edit names it), and never shows the bare label as its headline.
type BeeSpk = { rec: string; spk: string; label: string; name: string | null; state: "new" | "accepted"; excerpt?: string; at?: number | null; place?: string | null; generic?: boolean; matches?: { id: string; name: string }[] };
const SPK = { demoNone: false, edit: "", busy: new Set<string>(), sent: new Set<string>(), matches: {} as Record<string, { id: string; name: string }[] | undefined> };
const spkKey = (x: BeeSpk) => `${x.rec}|${x.spk}`;
const spkOpen = (x: BeeSpk) => !(x.generic && !String(x.spk).startsWith("id:"));   // a generic label with no Bee speaker id is never a card (older lists too)
const beeSpk = (ch: Channel): BeeSpk[] => ((ch as any).beeSpeakers || []).filter((x: BeeSpk) => spkOpen(x) && !SPK.sent.has(spkKey(x)));
// When the recording happened, for the card: "3:12 PM" today, "Yesterday, 3:12 PM", else "Oct 9, 3:12 PM". Where: the first part of the address.
function spkWhen(t?: number | null) {
  if (!t) return ""; const d = new Date(t), day0 = new Date(NOW).setHours(0, 0, 0, 0), t0 = new Date(t).setHours(0, 0, 0, 0), diff = Math.round((day0 - t0) / D);
  return `${diff === 0 ? "" : diff === 1 ? "Yesterday, " : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, `}${clock(t)}`;
}
const spkWhere = (x: BeeSpk) => String(x.place || "").split(",")[0].trim();
// Demo variants: true (a generic label with its own Bee id: the words, time and place, no Accept), "matched" (named, with matches), "nomatch", "named" (a name Bee gave,
// with Accept), "unknown" (Bee's bare "Unknown" with no id: no card at all, the queue stays empty).
if (!LIVE) (window as any).__beeSpeakersDemo = (on: boolean | "matched" | "nomatch" | "named" | "several" | "namednone" | "unknown" = true) => { SPK.demoNone = on === "nomatch"; const m = channels.find(c => c.slug === "main"); if (!m) return;
  const words = "Yes, and the bread. … And a bottle of vinho verde.", place = "1 Ferry Building, San Francisco, CA";
  (m as any).beeSpeakers = !on ? [] : on === "named" ? [{ rec: "77", spk: "label:Marco", label: "Marco", name: null, state: "new", excerpt: words, at: NOW - 3 * H, place, generic: false, matches: [{ id: "p3", name: "Marco Rossi" }] }]
    : on === "several" ? [{ rec: "77", spk: "label:Priya", label: "Priya", name: null, state: "new", excerpt: words, at: NOW - 3 * H, place, generic: false, matches: [{ id: "p1", name: "Priya Shah" }, { id: "p4", name: "Priya Natarajan" }] }]
    : on === "namednone" ? [{ rec: "77", spk: "label:Dana", label: "Dana", name: null, state: "new", excerpt: words, at: NOW - 3 * H, place, generic: false, matches: [] }]
    : on === "unknown" ? [{ rec: "78", spk: "label:Unknown", label: "Unknown", name: null, state: "new", excerpt: words, at: NOW - 3 * H, place, generic: true }]
    : [{ rec: "77", spk: "id:s2", label: "Speaker 2", name: on === "matched" ? "Priya" : null, state: on === "matched" ? "accepted" : "new", excerpt: words, at: NOW - 3 * H, place, generic: true }];
  SPK.matches["77|id:s2"] = on === "matched" ? [{ id: "p1", name: "Priya Shah" }, { id: "p4", name: "Priya Natarajan" }] : undefined; if (isNb()) render(); };
async function spkCall(body: any): Promise<any> {
  if (LIVE) { try { return await api("/bee/speaker", body); } catch { return { net: true }; } }
  await new Promise(z => setTimeout(z, 200));
  // The sandbox answers like the server: a reviewed speaker with no possible match left (demo "nomatch", or the last "Not them") ends its review.
  if (body.op === "confirm") return { ok: true };
  if (body.op === "not_them") { const k = `${body.rec}|${body.spk}`, left = (SPK.matches[k] || []).filter(p => p.id !== body.contact && !WKQ.no.has(`${k}|${p.id}`)); return left.length ? { ok: true } : { ok: true, reviewed: true }; }
  return SPK.demoNone ? { ok: true, matches: [], reviewed: true } : { ok: true, matches: [{ id: "p1", name: "Priya Shah" }] };
}
async function spkMatches(ch: Channel, x: BeeSpk) {
  const k = spkKey(x); SPK.matches[k] = []; const r = await spkCall({ op: "matches", rec: x.rec, spk: x.spk });
  SPK.matches[k] = Array.isArray(r?.matches) ? r.matches : []; if (isNb() && !NBUI.edit && !NBUI.add && !BF.edit && !SPK.edit) nbRefresh();
}
async function spkAct(ch: Channel, op: "edit" | "accept" | "confirm", k: string, extra: any = {}) {
  const x = beeSpk(ch).find(y => spkKey(y) === k); if (!x || SPK.busy.has(k)) return;
  SPK.busy.add(k); SPK.edit = ""; if (op === "confirm") { SPK.sent.add(k); BF.done++; } nbRefresh();   // an answered card counts at once, like a fact
  const r = await spkCall({ op, rec: x.rec, spk: x.spk, ...extra }); SPK.busy.delete(k);
  if (op === "confirm" && !r?.ok) BF.done = Math.max(0, BF.done - 1);
  if (r?.ok) {
    if (r.reviewed && op !== "confirm") BF.done++;
    if (Array.isArray(r.cleared) && r.cleared.length) { const gone = new Set(r.cleared.map((y: any) => `${y.rec}|${y.spk}`)); (ch as any).beeSpeakers = ((ch as any).beeSpeakers || []).filter((y: BeeSpk) => !gone.has(spkKey(y))); }
    if (op === "confirm" || r.reviewed) (ch as any).beeSpeakers = ((ch as any).beeSpeakers || []).filter((y: BeeSpk) => spkKey(y) !== k);
    else { x.state = "accepted"; if (op === "edit") x.name = extra.name; SPK.matches[k] = Array.isArray(r.matches) ? r.matches : SPK.matches[k]; }
  }
  SPK.sent.delete(k); if (isNb()) nbRefresh();
}
function beeFactAct(ch: Channel, op: "approve" | "edit" | "deny", id: number, text = "") {
  const list = beePending(ch), f = list.find(x => x.id === id); if (!f) return;
  const nb = nbOf(ch);
  // At once: the item goes, the next one is usable, an approved fact is in the Notebook. The answer only fixes up the note's id.
  (ch as any).beePending = list.filter(x => x !== f); BF.done++; BF.edit = 0; BF.err = null; BF.sent.add(id);
  const tmp: Note | null = op === "deny" ? null : { id: `bee${id}`, sec: "about", text: text || f.text, at: Date.now(), you: true, src: "bee", fresh: true };
  if (tmp) nb.notes.push(tmp);
  nbRefresh();
  void (async () => {
    let r: any;
    if (LIVE) { try { r = await api("/bee/fact", { op, id, text }); } catch { r = { net: true }; } }
    else { await new Promise(z => setTimeout(z, 300)); r = { ok: true, ...(tmp ? { note: { id: `b${id}`, sec: "about", text: tmp.text, at: Date.now(), src: "bee" } } : {}) }; }
    BF.sent.delete(id);
    const idle = !NBUI.edit && !NBUI.add && !BF.edit && isNb();
    if (r?.ok) { if (tmp && r.note) { const moved = NB_SECS.some(x => x[0] === r.note.sec) && r.note.sec !== tmp.sec; tmp.id = r.note.id; if (moved) { tmp.sec = r.note.sec; if (idle) nbRefresh(); } } return; }
    if (tmp) { const i = nb.notes.indexOf(tmp); if (i >= 0) nb.notes.splice(i, 1); }
    if (r?.error && Array.isArray(r.pending) && !r.pending.some((x: BeeFact) => x.id === id)) { bfMerge(ch, r.pending); if (idle) nbRefresh(); return; }   // already decided (another device)
    // The call itself failed: the card comes back on top, with a line saying so.
    if (!beePending(ch).some(x => x.id === id)) (ch as any).beePending = [f, ...beePending(ch)];
    BF.done = Math.max(0, BF.done - 1);
    BF.err = { id, msg: r?.secret ? "Not saved: that looks like a password or key. Save those in Settings → Passwords & keys." : r?.net ? "Couldn't reach 1Helm, so that didn't go through. Try again." : String(r?.error || "That didn't go through. Try again.") };
    if (r?.secret && op === "edit") BF.edit = id;
    if (isNb()) nbRefresh();
  })();
}
// ---------- Notebook as pages (Memory Overhaul phase 6, DESIGN.md section 8) ----------
// Design A, "Encyclopedia": a page list on the left, one article in the middle, the portrait and facts box on the right, and one Edit button
// for the whole page. Live, the pages come from GET /notebook/<channel>/pages (a memory knowledge page per topic, read by its ## headings)
// and the screen is always on for a signed-in person (there is no older Notebook). If the pages can't
// be read, the article area shows "Couldn't load the Notebook." and a Try again button. The one public safeguard: when the server sends
// boot.flags.notebook_pages === false (the public Worker does that when memory is not set up), the screen says memory is off
// and makes no pages request. In the design sandbox (LIVE unset) the same screen runs on demo data at #/main/notebook.
// The Bee review reuses the real handlers (data-bfok, data-spkok, ...) in one queue: a slim row above the article, and on a phone a pill.
const nbPagesOff = (): boolean => !!LIVE && BOOT?.flags?.notebook_pages === false;
const wkPhone = () => matchMedia("(max-width:767px)").matches;
window.matchMedia("(max-width:767px)").addEventListener("change", () => { if (isNb()) nbRefresh(); });
window.addEventListener("hashchange", () => { if (!isNb()) NBW.sheet = false; });   // leaving the Notebook closes the Bee tray, so it is the pill on the way back
type WkSec = { id: string; h: string; text: string; sec: string };
type WkPage = { k: string; title: string; group: number; kind: "page" | "notes"; secs: WkSec[]; ready: boolean; state?: "ready" | "building" | "empty" };
const NBW = { pg: {} as Record<string, string>, ch: "", seen: "", edit: "", menu: false, sheet: false, seeded: false, saving: false, hash: "", fix: {} as Record<string, string>, info: {} as Record<string, string>, focus: "" };
const WK_GROUPS = ["Pages", "More"];
// What the server sends (API contract with the Worker): the tree and facts, then one page's markdown.
type NbpTree = { id: string; title: string; group: "pages" | "more"; kind: "page" | "notes"; updated_at: number | null };
type NbpPage = { id: string; title: string; markdown: string; updated_at: number | null; sources: { kind: string; id: string; title: string; at: number }[]; state: "ready" | "building" | "empty" };
type Nbp = { person: { first: string; name: string; photo: string | null } | null; facts: { label: string; value: string }[]; tree: NbpTree[]; ready: boolean; failed: boolean; failAt?: number; at: number; busy: boolean; preBusy: boolean; reals: number; redo: boolean;
  pages: Record<string, NbpPage | "busy" | "failed">; saved: Record<string, { at: number; markdown: string }> };
const NBP: Record<string, Nbp> = {};
const nbpState = (slug: string): Nbp => NBP[slug] ||= { person: null, facts: [], tree: [], ready: false, failed: false, at: 0, busy: false, preBusy: false, reals: 0, redo: false, pages: {}, saved: {} };
const nbpIdle = (ch: Channel) => isNb() && route().ch === ch && !NBW.edit && !NBUI.edit && !NBUI.add && !BF.edit;
// The page text is Markdown. A page is its text before the first "## " (the introduction, no heading) and then one section per "## ".
function nbpSecs(markdown: string): WkSec[] {
  const out: WkSec[] = []; let h: string | null = null, buf: string[] = [], fence = false;
  const flush = () => { const text = buf.join("\n").trim(); if (h !== null || text) out.push({ id: `s${out.length}`, h: h ?? "", text, sec: "" }); buf = []; };
  for (const l of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(l)) fence = !fence;
    const m = !fence && /^## +(.+?)(?: +#+)?\s*$/.exec(l);
    if (m) { flush(); h = m[1].trim(); }
    else if (!fence && h === null && /^# /.test(l) && !buf.some(x => x.trim()) && !out.length) continue;   // the page's own title line
    else buf.push(l);
  }
  flush(); return out;
}
const nbpMarkdown = (secs: WkSec[]) => secs.map(s => s.h ? `## ${s.h}\n\n${s.text}` : s.text).join("\n\n");
function nbpCurId(ch: Channel): string { const st = nbpState(ch.slug), id = NBW.pg[ch.slug]; return st.tree.some(t => t.id === id) ? id : st.tree[0]?.id || ""; }
async function nbpPage(ch: Channel, id: string, force = false, pre = false) {
  const st = nbpState(ch.slug), t = st.tree.find(x => x.id === id); if (!LIVE || !t || t.kind !== "page") return;
  const have = st.pages[id]; if (!force && have && have !== "failed") return;
  if (!have || have === "failed") st.pages[id] = "busy";
  let d: any; try { d = await api(`/notebook/${ch.slug}/pages/${encodeURIComponent(id)}${pre ? "?prefetch=1" : ""}`); } catch { d = null; }
  if (!d || typeof d.markdown !== "string") { if (st.pages[id] === "busy") st.pages[id] = "failed"; return; }
  if (nbpApply(ch, id, d) && nbpIdle(ch) && nbpCurId(ch) === id) nbPaint(ch);
}
// Stores one page's data, from the pages call (its "pages" map) or from the per-page route. Returns true when the page text or state changed.
// A page with no state (an older server) is "ready" when it has text and "empty" when it has none, so the article is never blank.
function nbpApply(ch: Channel, id: string, d: any): boolean {
  const st = nbpState(ch.slug), t = st.tree.find(x => x.id === id); if (!t || !d || typeof d.markdown !== "string") return false;
  const was = typeof st.pages[id] === "object" ? st.pages[id] as NbpPage : null, sv = st.saved[id];
  // An edit just saved shows at once; the page itself refreshes later, so the server's older text doesn't replace it until it catches up.
  if (sv && (d.updated_at == null || d.updated_at < sv.at) && Date.now() - sv.at < 30 * 60e3) d = { ...d, markdown: sv.markdown }; else delete st.saved[id];
  const state = d.markdown.trim() ? "ready" : d.state === "building" ? "building" : "empty";
  st.pages[id] = { id, title: String(d.title || t.title), markdown: d.markdown, updated_at: d.updated_at ?? null, sources: Array.isArray(d.sources) ? d.sources : [], state };
  return !was || was.markdown !== d.markdown || was.state !== state;
}
// pre: the background read made before the person opens the Notebook (?prefetch=1). It fills the same cache, never asks the server to build a page,
// never marks the screen failed, and only repaints if the Notebook is already open. A real open after it always reads again (st.pre), which is what asks for a build.
async function nbpLoad(ch: Channel, force = false, pre = false) {
  if (!LIVE || nbPagesOff()) return; const st = nbpState(ch.slug);
  // A real read never waits for a prefetch (in flight, failed or aborted): both run, and whichever returns first paints in place. Only a real read in flight, or a real read that
  // succeeded under 5 s ago, stops another real read (st.at is set only by a successful real read, so a failed or prefetch-only history never suppresses it).
  if (pre) { if (st.busy || st.preBusy) return; st.preBusy = true; }
  else { if (st.busy) { st.redo = true; return; } if (!force && Date.now() - st.at < 5000) return; st.busy = true; }
  const real = st.reals;
  let d: any; try { d = await api(`/notebook/${ch.slug}/pages${pre ? "?prefetch=1" : ""}`); } catch { d = null; }
  if (pre) st.preBusy = false; else st.busy = false;
  const redo = !pre && st.redo; if (!pre) st.redo = false;
  if (pre && (st.reals !== real || !(d && Array.isArray(d.tree)))) return;   // a failed prefetch changes nothing; a real read that landed first is newer
  if (!d || !Array.isArray(d.tree)) { if (!st.ready && !st.failed) { st.failed = true; st.failAt = Date.now(); if (isNb() && route().ch === ch) nbPaint(ch); } return; }   // can't be read: the Try again line shows
  if (!pre) { st.reals++; st.at = Date.now(); }
  const p = d.person || {}, first = !st.ready;
  st.person = { first: String(p.first || ""), name: String(p.name || p.first || ""), photo: p.photo ? String(p.photo) : null };
  st.facts = Array.isArray(d.facts) ? d.facts.map((f: any) => ({ label: String(f.label ?? ""), value: String(f.value ?? "") })) : [];
  st.tree = d.tree.filter((t: any) => t && typeof t.id === "string"); st.ready = true; st.failed = false;
  // The pages call carries every page, so a tap on another page draws from memory. Only a page missing from it (an older server) is read on its own.
  const all = d.pages && typeof d.pages === "object" ? d.pages : {}; for (const t of st.tree) if (t.kind === "page" && all[t.id]) nbpApply(ch, t.id, all[t.id]);
  const id = nbpCurId(ch); if (id && !all[id]) await nbpPage(ch, id, true, pre);
  if (redo) { void nbpLoad(ch, true); return; }
  if (first && isNb() && route().ch === ch) nbPaint(ch); else if (nbpIdle(ch)) nbPaint(ch);
}
function WK_DEMO(): { k: string; title: string; group: number; secs: WkSec[] }[] {
  const f = PERSON.split(" ")[0];
  return [
    { k: "about", title: `About ${f}`, group: 0, secs: [
      { id: "ab0", h: "", sec: "about", text: `${PERSON} lives in Portland, Oregon, with his partner Sam and their daughter Maya. He works in software, bikes to work most days, and keeps a close eye on household spending.` },
      { id: "ab1", h: "Home and family", sec: "people", text: "Joseph and Sam live in the Pearl District with Maya, who plays soccer on Tuesdays and Thursdays at 5:30 PM. Sam has a dentist appointment on Thursdays at 3:15 this month, so Joseph does school pickup.\n\nGrandma's birthday is October 14, and she likes a phone call in the morning." },
      { id: "ab2", h: "Work", sec: "about", text: "He works in software on the platform team, where Dana is a coworker. Most weekdays start with a bike commute of about 22 minutes, and wind over 15 mph matters more to him than light rain.\n\nHe works from home on Fridays." },
      { id: "ab3", h: "How he likes things done", sec: "how", text: "- Short answers, with the important part first.\n- Ask before sending, paying or deleting anything.\n- Texts are fine for anything urgent, but nothing between 10 PM and 7 AM.\n- A heads-up before any bill over $200." },
      { id: "ab4", h: "Money", sec: "places", text: "Bills come from PGE, NW Natural and Comcast. He is saving toward a six-month emergency fund of about $27,000, and spending has stayed under the weekly budget of $450 for the past three weeks." },
      { id: "ab5", h: "Travel", sec: "now", text: "He is planning a first trip to Japan from November 3 to 13, Tokyo first and then Kyoto. He prefers an aisle seat on long flights and is watching a Delta fare, which is $1,742 today.\n\nHe usually flies out of Portland (PDX) and likes to keep layovers under two hours." },
      { id: "ab6", h: "Projects", sec: "now", text: "A portfolio site is live at portfolio-7ok.pages.dev, and he works on it for a few hours on Saturday mornings." } ] },
    { k: "people", title: "People", group: 0, secs: [
      { id: "pe0", h: "", sec: "people", text: "Sam, Maya and Grandma are the family Skipper schedules around. Dana and Ari come up most among coworkers and friends." },
      { id: "pe1", h: "Family", sec: "people", text: "Sam is his partner. Her dentist appointments are on Thursdays at 3:15 this month.\n\nMaya is their daughter and plays soccer on Tuesdays and Thursdays at 5:30 PM, starting October 6.\n\nGrandma's birthday is October 14, and she likes a phone call in the morning." },
      { id: "pe2", h: "Work", sec: "people", text: "Dana is a coworker on the platform team." },
      { id: "pe3", h: "Friends", sec: "people", text: "Ari is a friend who recently moved, and dinner with Ari is set for Friday." } ] },
    { k: "places", title: "Places", group: 0, secs: [
      { id: "pl0", h: "", sec: "places", text: "Home is in the Pearl District in Portland (97205), and most errands stay within a few miles of it." },
      { id: "pl1", h: "Home and city", sec: "places", text: "Maya's school lets out early on Wednesdays at 1:15 PM. The bike route to work takes about 22 minutes." },
      { id: "pl2", h: "Accounts", sec: "places", text: "Bills come from PGE, NW Natural and Comcast, and anything over $200 gets a heads-up first. The portfolio site is live at portfolio-7ok.pages.dev." } ] },
    { k: "routines", title: "Routines", group: 0, secs: [
      { id: "ro0", h: "", sec: "how", text: "Weekdays follow the bike commute and Maya's soccer schedule, and weekends are for family errands and the side project." },
      { id: "ro1", h: "Weekdays", sec: "how", text: "- Bike to work, about 22 minutes.\n- Maya's soccer on Tuesdays and Thursdays at 5:30 PM.\n- School pickup on Thursdays, because of Sam's dentist." },
      { id: "ro2", h: "Weekends", sec: "how", text: "A few hours on the portfolio site on Saturday morning, then family errands." } ] },
    { k: "now", title: "What's going on", group: 0, secs: [
      { id: "no0", h: "", sec: "now", text: "The Japan trip is the main open item, and the emergency fund is on track." },
      { id: "no1", h: "This month", sec: "now", text: "The Delta fare is being watched, and the Tokyo hotel was found for $48 less a night. Saving toward the six-month emergency fund of about $27,000 continues." },
      { id: "no2", h: "Open items", sec: "now", text: "- RSVP for Maya's fall festival.\n- The PG&E bill of $214, to review.\n- A reply to Ari about dinner." } ] },
  ];
}
const WK_INFO: [string, string][] = [["Born", "March 9, 1988"], ["Lives in", "Portland, Oregon"], ["Partner", "Sam"], ["Child", "Maya"], ["Works in", "Software"], ["Time zone", "Pacific"]];
const wkFacts = (ch: Channel): [string, string][] => LIVE ? nbpState(ch.slug).facts.map(f => [f.label, f.value] as [string, string]) : WK_INFO.map(([k, v]) => [k, NBW.info[k] ?? v] as [string, string]);
let wkDemoPhoto: string | null = null;
const wkPerson = (ch: Channel) => { if (!LIVE) return { first: PERSON.split(" ")[0], name: PERSON, photo: wkDemoPhoto };
  const p = nbpState(ch.slug).person, first = p?.first || LIVE.person?.trim().split(" ")[0] || ""; return { first, name: p?.name || LIVE.person?.trim() || first, photo: p?.photo || null }; };
// The side box (portrait and facts) belongs to the first page. A channel with no facts yet shows it only in General, so a project channel's article is not squeezed.
const wkAside = (ch: Channel) => !LIVE || ch.slug === "main" || nbpState(ch.slug).facts.length > 0 || !!nbpState(ch.slug).person?.photo;
const wkText = (s: WkSec) => NBW.fix[s.id] ?? s.text;
const wkCur = (ch: Channel, pages: WkPage[]) => { const id = LIVE ? nbpCurId(ch) : NBW.pg[ch.slug]; return pages.find(p => p.k === id) || pages[0]; };
// Page text is Markdown, drawn with the app's own renderer. Links in a page open in a new tab.
const wkHtml = (t: string) => md(t).replace(/<a href="(https?:)/g, '<a target="_blank" rel="noopener noreferrer" href="$1');
// The portrait: the person's photo when there is one, otherwise the channel tile's letter (first letter of the first name) in a color taken from the name.
const wkPortrait = (p: { first: string; name: string; photo: string | null }, cls = "") => p.photo
  ? `<img class="wkph wkimg ${cls}" src="${esc(p.photo)}" alt="${esc(p.name)}">`
  : `<span class="mono wkph ${cls}" role="img" aria-label="${esc(p.name)}" style="--c:${MONO_C[[...p.first].reduce((n, c) => n + c.charCodeAt(0), 0) % MONO_C.length]}">${esc(p.first.charAt(0).toUpperCase())}</span>`;
const wkX = I('<path d="M18 6 6 18M6 6l12 12"/>', 16);
const wkChev = I('<path d="m6 9 6 6 6-6"/>', 16);
// A list is edited as plain lines, without the "- " markers, when every line of it is a plain item.
const wkList = (t: string) => { const ls = t.split("\n").filter(l => l.trim()); return ls.length > 0 && ls.every(l => /^- /.test(l)); };
const wkUnlist = (t: string) => t.split("\n").map(l => l.replace(/^- /, "")).join("\n");
const wkTa = (id: string, v0: string, label: string) => { const v = wkList(v0) ? wkUnlist(v0) : v0; return `<textarea class="nedit wkta" data-wkf="${id}" rows="1" aria-label="${esc(label)}">${esc(v)}</textarea>`; };
// A section or the lead paragraph, drawn the same way in view and Edit. In Edit the drawn text itself is editable (contenteditable), so the person never
// sees Markdown. A section holding anything the in-place editor cannot turn back into Markdown keeps the plain editor.
const WK0 = new WeakMap<HTMLElement, string>();   // each editable block's HTML as drawn, to tell an untouched block from an edited one
const wkBody = (s: WkSec, edit: boolean, label: string, lead = false) => {
  const h = wkHtml(wkText(s)), cls = lead ? "wklead" : "wkbody";
  if (!edit) return `<div class="${cls}">${h}</div>`;
  if (!wkRichOk(h)) return lead ? `<div class="wklead">${wkTa(s.id, wkText(s), label)}</div>` : wkTa(s.id, wkText(s), label);
  return `<div class="${cls} wkrt" data-wkf="${s.id}" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${esc(label)}">${h || "<p><br></p>"}</div>`;
};
const wkNotesList = (ch: Channel) => `<div class="wknotes">${NB_SECS.map(([k, t]) => { const all = nbOrder(nbNotes(ch).filter(n => n.sec === k));
  return `<section><h3>${t}</h3><div class="nblist">${nbAddBox(k)}${all.map(n => nbRow(ch, n)).join("")}</div><button class="sa mute wkaddn" data-nadd="${k}">${ic.plus}<span>Add a note</span></button></section>`; }).join("")}</div>`;
// The at-a-glance box. "box" is the Wikipedia-style panel; "band" is the single row used by direction C.
// The at-a-glance box: the portrait, the name, and the facts as rows (inputs while editing).
function wkInfo(ch: Channel, edit: boolean) {
  const rows = wkFacts(ch), p = wkPerson(ch);
  const dd = (v: string, i: number, k: string) => edit ? `<textarea class="wkfv" data-wkf="i:${i}" rows="1" spellcheck="false" aria-label="${esc(k)}">${esc(v)}</textarea>` : esc(v);
  const dl = !rows.length ? "" : `<dl>${rows.map(([k, v], i) => `<div><dt>${esc(k)}</dt><dd>${dd(v, i, k)}</dd></div>`).join("")}</dl>`;
  const cam = I('<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.5"/>', 16);
  // The portrait keeps one wrapper in both modes, so entering Edit adds overlay buttons and moves nothing.
  const over = !edit ? "" : `<button type="button" class="wkphb" data-wkphoto aria-label="${p.photo ? "Change photo" : "Add a photo"}"${NBW.saving ? " disabled" : ""}><span class="wkphc" aria-hidden="true">${cam}</span></button>${p.photo ? `<button type="button" class="wkphrm" data-wkphoto-rm aria-label="Remove photo"${NBW.saving ? " disabled" : ""}>${wkX}</button>` : ""}`;
  const portrait = `<div class="wkphw">${wkPortrait(p)}${over}</div>`;
  return `<aside class="wkinfo" aria-label="${esc(p.first)} at a glance">${portrait}<div class="wkin"><b>${esc(p.name)}</b></div>${dl}</aside>`;
}
function wkMenu(pages: WkPage[], cur: WkPage) {
  return `<div class="wkmenu" role="menu">${WK_GROUPS.map((g, i) => { const ps = pages.filter(p => p.group === i); return !ps.length ? "" : `<div class="wkmg">${g}</div>${ps.map(p => `<button role="menuitem" data-wkpage="${esc(p.k)}"${p.k === cur.k ? ` class="on" aria-current="page"` : ""}>${esc(p.title)}</button>`).join("")}`; }).join("")}</div>`;
}
const wkRail = (pages: WkPage[], cur: WkPage) =>
  `<nav class="wkrail" aria-label="Notebook pages">${WK_GROUPS.map((g, i) => { const ps = pages.filter(p => p.group === i); return !ps.length ? "" : `<div class="wkg">${g}</div>${ps.map(p => `<a href="#" data-wkpage="${esc(p.k)}"${p.k === cur.k ? ` class="on" aria-current="page"` : ""}>${esc(p.title)}</a>`).join("")}`; }).join("")}</nav>`;
function wkA(ch: Channel, pages: WkPage[]) {
  const q = wkPhone() ? wkQueue(ch) : [];   // phone: the Bee review is a pill at the bottom edge that opens a tray
  const pg = wkCur(ch, pages), ed = NBW.edit === "page" && pg.kind === "page", about = pg.k === pages[0].k && pg.kind === "page" && wkAside(ch);
  const secs = pg.secs.filter(s => ed || s.text.trim()), lead = secs.find(s => !s.h), rest = secs.filter(s => s.h);
  const secEd = NBW.edit.startsWith("sec:") && pg.kind === "page" ? NBW.edit.slice(4) : "";
  const penI = I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 14);
  const btns = `<div class="wkbtns wksecb"><button class="sa mute" data-wkcancel${NBW.saving ? " disabled" : ""}>Cancel</button><button class="sa wkpri" data-wksave${NBW.saving ? " disabled" : ""}>Save</button></div>`;
  const sec = (s: WkSec) => ed ? (s.h ? `<section class="wksec"><h2>${esc(s.h)}</h2>${wkBody(s, true, s.h)}</section>` : wkBody(s, true, "Introduction", true))
    : secEd && s.id === secEd && s.h ? `<section class="wksec" id="wk-${s.id}" data-wked data-unsaved="wk" data-unsaved-key="section:${esc(pg.k)}:${esc(s.id)}"><h2>${esc(s.h)}</h2>${wkBody(s, true, s.h)}${btns}</section>`
    : s.h ? `<section class="wksec" id="wk-${s.id}"><h2>${esc(s.h)}${pg.kind === "page" && pg.ready && !secEd && !ed ? `<button type="button" class="wkseced" data-wksec="${s.id}" aria-label="Edit ${esc(s.h)}">${penI}</button>` : ""}</h2>${wkBody(s, false, s.h)}</section>` : wkBody(s, false, "Introduction", true);
  const wait = pg.kind === "page" && pg.ready && !ed && !secs.length ? `<p class="wkstill">Still learning. This page fills in as you talk.</p>` : "";
  const body = pg.kind === "notes" ? wkNotesList(ch) : `${wait}${lead ? sec(lead) : ""}${about ? wkInfo(ch, ed) : ""}${rest.map(sec).join("")}`;
  const canEdit = pg.kind === "page" && pg.ready && (secs.length > 0 || (about && wkFacts(ch).length > 0));
  const dis = NBW.saving ? " disabled" : "";
  const act = !canEdit || secEd ? "" : ed ? `<div class="wkbtns"><button class="sa mute" data-wkcancel${dis}>Cancel</button><button class="sa wkpri" data-wksave${dis}>Save</button></div>` : `<button class="sa wkedit" data-wkedit>${ic.pen}<span>Edit</span></button>`;
  if (!q.length) NBW.sheet = false;
  if (NBW.seen !== pg.k) { if (NBW.seen) NBW.sheet = false; NBW.seen = pg.k; }   // phone: the Bee tray goes back to the pill whenever the page changes
  const layer = !q.length ? "" : NBW.sheet
    ? `<div class="wkdock"><div class="wktray" role="dialog" aria-label="New from your Bee"><button class="wkx" data-wkbee="close" aria-label="Close">${wkX}</button>${wkBeeItem(ch, q[0], BF.done + 1, BF.done + q.length, q.length > 1)}</div></div>`
    : ed ? "" : `<div class="wkdock"><button class="wkpill" data-wkbee="open" aria-haspopup="dialog" aria-label="${q.length} new from your Bee">${beeMark(14)}<span>${q.length} new</span></button></div>`;
  return `<div class="wkcols${q.length ? " wkdk" : ""}">${wkRail(pages, pg)}<article class="wkart${about ? " info" : ""}${pg.kind === "page" && !pg.ready ? " wkwait" : ""}"${ed ? ` data-wked data-unsaved="wk" data-unsaved-key="page:${esc(pg.k)}"` : ""}>
    <div class="wkhead"><div class="wkt wkmw"><h1>${esc(pg.title)}</h1><button class="wkmb" data-wkmenu aria-haspopup="menu" aria-expanded="${NBW.menu}" aria-label="Choose a page">${wkChev}</button>${NBW.menu ? wkMenu(pages, pg) : ""}</div>${act}</div>${body}</article>${layer}</div>`;
}
// The compact Bee review for the directions: one slim tray, one queue. Bee facts and new speakers share a row that shows the first item with its
// count ("1 of 3") and actions, so the article stays the main content. Skip sends any item to the back. The tray is gone when nothing is pending.
// It reuses the real review's data and its click handlers (data-bfok, data-bfno, data-bfedit, data-bfsave, data-spkok, ...), nothing else of it.
type WkQ = { k: string; at: number; f?: BeeFact; s?: BeeSpk };
const WKQ = { n: 0, rank: new Map<string, number>(), no: new Set<string>() };
function wkQueue(ch: Channel): WkQ[] {
  if (ch.slug !== "main") return [];
  const all: WkQ[] = [...beePending(ch).map(f => ({ k: `f${f.id}`, at: f.at || 0, f })), ...beeSpk(ch).map(s => ({ k: `s${spkKey(s)}`, at: s.at || 0, s }))];
  const out = all.map((x, i) => ({ x, i })).sort((a, b) => ((WKQ.rank.get(a.x.k) || 0) - (WKQ.rank.get(b.x.k) || 0)) || a.i - b.i).map(o => o.x);
  if (!out.length) BF.done = 0;   // an empty queue starts the count again, so "1 of N" is the first card of the next batch
  return out;
}
function wkBee(ch: Channel) {
  const q = wkQueue(ch); if (!q.length) return "";
  return `<section class="wkbt" id="wk-bee" aria-label="New from your Bee">${wkBeeItem(ch, q[0], BF.done + 1, BF.done + q.length, q.length > 1)}</section>`;
}
// One pending item (a fact or a speaker) with its actions. count: show "1 of 4" (the one-at-a-time views); the list shows the date only.
function wkBeeItem(ch: Channel, top: WkQ, pos: number, total: number, many: boolean, count = true) {
  const off = I('<path d="M18 6 6 18M6 6l12 12"/>', 14), pen = I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 14), skipI = I('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>', 14);
  const meta = (label: string) => `<span class="wkbmeta">${count && total > 1 ? `<span class="wkbn">${pos} of ${total}</span>` : ""}<span>${label}${top.at ? ` · ${fileDate(top.at)}` : ""}</span></span>`;
  const skip = many ? `<button class="sa mute" data-wkskip="${esc(top.k)}" title="Show this one later">${skipI}Skip</button>` : "";
  const mark = `<span class="wkbico">${beeMark(16)}</span>`;
  let inner = "";
  if (top.f) {
    const f = top.f, err = BF.err?.id === f.id ? `<p class="wkberr" role="status">${g("help", 14)}${esc(BF.err.msg)}</p>` : "";
    inner = String(BF.edit) === String(f.id)
      ? `<div class="wkbi editing" role="group" aria-label="Edit what your Bee picked up" data-unsaved="note" data-unsaved-key="bee:${f.id}">${mark}<div class="wkbbody">${meta("From your Bee")}<textarea class="nedit wkbta" id="bfedit" rows="2" aria-label="What your Bee picked up">${esc(f.text)}</textarea>${err}</div>
        <div class="wkbacts"><button class="sa mute" data-bfcancel>Cancel</button><button class="sa wkbok" data-bfsave="${f.id}">${ic.check}Save and approve</button></div></div>`
      : `<div class="wkbi" role="group" aria-label="From your Bee, ${pos} of ${total}">${mark}<div class="wkbbody"><p class="wkbp">${esc(f.text)}</p>${meta("From your Bee")}${err}</div>
        <div class="wkbacts"><button class="sa wkbno" data-bfno="${f.id}">${off}Deny</button>${skip}<button class="sa mute" data-bfedit="${f.id}">${pen}Edit</button><button class="sa wkbok" data-bfok="${f.id}">${ic.check}Approve</button></div></div>`;
  } else if (top.s) {
    const x = top.s, k = spkKey(x), busy = SPK.busy.has(k), gen = !!x.generic, have = SPK.matches[k] ?? x.matches, m = have?.filter(p => !WKQ.no.has(`${k}|${p.id}`));
    if (have === undefined && (x.state === "accepted" || !gen) && LIVE) void spkMatches(ch, x);   // the server sends the matches with the card; this only fills a gap
    const one = !gen && m?.length === 1 ? m[0] : null, none = !gen && Array.isArray(m) && !m.length, quote = x.excerpt ? `"${esc(x.excerpt)}"` : "";
    // A named label: Bee's label is the headline, the person's name beside it. A generic one: the speaker's own words (two lines), the person's name in front once given.
    const who = one ? `<p class="wkbp" title="${esc(x.excerpt || "")}">Is <b>${esc(x.label)}</b> <b>${esc(one.name)}</b>?</p>` : gen ? `<p class="wkbp wkbq" title="${esc(x.label ? `Bee labelled this voice "${x.label}"` : "")}">${x.name ? `<b>${esc(x.name)}</b> ` : ""}${quote}</p>`
      : `<p class="wkbp"><b title="${esc(x.excerpt || "")}">${esc(x.label)}</b>${x.name && x.name !== x.label ? `<span class="wkbas">${esc(x.name)}</span>` : ""}</p>`;
    const smeta = `<span class="wkbmeta">${count && total > 1 ? `<span class="wkbn">${pos} of ${total}</span>` : ""}<span class="wkbmt" title="${esc(x.place || "")}">New speaker detected${top.at ? ` · ${spkWhen(top.at)}` : ""}${spkWhere(x) ? ` · ${esc(spkWhere(x))}` : ""}</span></span>`;
    const heading = gen ? (x.name || (x.excerpt || "").slice(0, 60) || "this speaker") : x.label;
    if (SPK.edit === k) inner = `<div class="wkbi editing" role="group" aria-label="Name for ${esc(heading)}">${mark}<div class="wkbbody">${gen ? who : smeta}<input class="nedit wkbin" id="spkedit" value="${esc(x.name || (gen ? "" : x.label))}" placeholder="Name" aria-label="Name for ${esc(heading)}"></div>
      <div class="wkbacts"><button class="sa mute" data-spkcancel>Cancel</button><button class="sa wkbok" data-spksave="${esc(k)}">${ic.check}Save</button></div></div>`;
    else inner = `<div class="wkbi${gen ? " wkbg" : ""}" role="group" aria-label="New speaker detected: ${esc(heading)}">${mark}<div class="wkbbody">${who}${!gen && quote ? `<p class="wkbp wkbq">${quote}</p>` : ""}${smeta}</div>
      <div class="wkbacts">${skip}<button class="sa mute" data-spkedit="${esc(k)}"${busy ? " disabled" : ""}>${pen}Edit</button>${one ? `<button class="sa mute" data-wkno="${esc(k)}" data-wkp="${esc(one.id)}"${busy ? " disabled" : ""}>Not them</button><button class="sa wkbok" data-spkconf="${esc(k)}" data-spkp="${esc(one.id)}"${busy ? " disabled" : ""}>${ic.check}Yes</button>` : none && x.state === "new" ? `<button class="sa wkbok" data-spkok="${esc(k)}"${busy ? " disabled" : ""}>${ic.check}Accept</button>` : ""}</div></div>
      ${!one && m?.length ? `<div class="wkbm">${m.map(p => `<div class="wkbmr"><span>Is it ${esc(p.name)}?</span><button class="sa mute" data-wkno="${esc(k)}" data-wkp="${esc(p.id)}"${busy ? " disabled" : ""}>Not them</button><button class="sa wkbok" data-spkconf="${esc(k)}" data-spkp="${esc(p.id)}"${busy ? " disabled" : ""}>${ic.check}Yes</button></div>`).join("")}</div>` : ""}`;
  }
  return inner;
}
function wkDemoPages(): WkPage[] {
  return [...WK_DEMO().map(p => ({ ...p, kind: "page" as const, ready: true })), { k: "notes", title: "All notes", group: 1, kind: "notes" as const, secs: [], ready: true }];
}
function wkPages(ch: Channel): WkPage[] {
  if (!LIVE) return wkDemoPages();
  const st = nbpState(ch.slug); if (!st.ready) return [];
  return st.tree.map(t => { const p = st.pages[t.id], ok = typeof p === "object";
    return { k: t.id, title: t.title, group: t.group === "more" ? 1 : 0, kind: t.kind, secs: t.kind === "page" && ok ? nbpSecs(p.markdown) : [], ready: t.kind === "notes" || ok, state: ok ? p.state : undefined }; });
}
// The old section links (#/main/notebook/people, from "Added to Notebook") open All notes.
function wkHashPage(ch: Channel, pages: WkPage[]) {
  const h = location.hash; if (h === NBW.hash) return; NBW.hash = h;
  const sec = h.match(/^#\/[^/]+\/notebook\/([a-z]+)/)?.[1], notes = pages.find(p => p.kind === "notes");
  if (sec && NB_SECS.some(s => s[0] === sec) && notes) { NBW.pg[ch.slug] = notes.k; NBW.sheet = false; }
}
// When the pages can't be read, the article area shows one line and a Try again button, which reads them again.
function nbWiki(ch: Channel): string {
  if (!LIVE && !NBW.seeded) { NBW.seeded = true; queueMicrotask(() => { (window as any).__beeFactsDemo(true); (window as any).__beeSpeakersDemo(true); }); }
  if (NBW.ch !== ch.slug) { NBW.ch = ch.slug; NBW.seen = ""; NBW.edit = ""; NBW.menu = false; NBW.sheet = false; NBW.hash = ""; }
  if (nbPagesOff()) return `<div class="wk wkfail"><p>The Notebook needs memory, which is off for this deployment. Memory needs its Vectorize index and AI binding set up (see docs/configuration.md).</p></div>`;
  if (LIVE) { const st = nbpState(ch.slug); if (st.failed && Date.now() - (st.failAt || 0) >= 10000) { st.failed = false; st.ready = false; }   // a failed read is tried again on the next open, not kept until Try again
    if (st.failed || (st.ready && !st.tree.length)) return `<div class="wk wkfail"><p>Couldn't load the Notebook.</p><button class="sa mute" data-wkretry>Try again</button></div>`; if (!st.ready) { void nbpLoad(ch); return `<div class="wk wkcold"></div>`; } }
  const pages = wkPages(ch); wkHashPage(ch, pages);
  const cur = wkCur(ch, pages); if (LIVE && cur.kind === "page" && !cur.ready) void nbpPage(ch, cur.k);
  const bee = wkPhone() ? "" : wkBee(ch);
  return `<div class="wk wk-a">${bee ? `<div class="wkbee">${bee}</div>` : ""}${wkA(ch, pages)}</div>`;
}
// The portrait photo: the person's original file goes to POST /notebook/<channel>/photo as the raw body, unscaled (the server keeps it as it arrived and checks the type
// from the bytes). POST .../photo/delete removes it. The box keeps its size and the CSS crops the picture to it, so nothing moves.
async function wkPhoto(ch: Channel, file: File | null) {
  const st = nbpState(ch.slug);
  if (!LIVE) { wkDemoPhoto = file ? URL.createObjectURL(file) : null; nbRefresh(); return; }
  let r: any;
  try {
    if (!file) r = await api(`/notebook/${ch.slug}/photo/delete`, {});
    else { const x = await fetch(`${LIVE.api}/notebook/${ch.slug}/photo`, { method: "POST", credentials: "same-origin", headers: file.type ? { "content-type": file.type } : {}, body: file });
      r = await x.json().catch(() => ({})); if (!x.ok && !r.error) r = { ...r, error: `Upload failed (${x.status})` }; }
  } catch { r = { error: "net" }; }
  if (r?.error || !r?.ok) { wkToast(r || {}); return; }
  if (st.person) st.person.photo = file ? (r.photo ? String(r.photo) : st.person.photo) : null;
  if (isNb() && route().ch === ch) nbPaint(ch); void nbpLoad(ch, true);
}
const wkToast = (r: any) => note(g("help", 14), r?.secret ? "Not saved: that looks like a password or key" : "Couldn't save that", r?.secret ? "Secrets aren't kept in the notebook. Save logins and keys in Settings → Passwords & keys." : "Check your connection and try again.", "");
// Leaves an edit. A section edit repaints in place and keeps the scroll position; the page edit rebuilds as before.
function wkLeave(ch: Channel) {
  const sec = NBW.edit.startsWith("sec:"), sc = document.getElementById("scroll"), top = sc?.scrollTop ?? 0; NBW.edit = "";
  if (sec) { nbPaint(ch); if (sc) sc.scrollTop = top; } else nbRefresh();
}
async function wkSave() {
  const box = document.querySelector<HTMLElement>("[data-wked]"); if (!box || NBW.saving) return;
  const ch = route().ch, fields = [...box.querySelectorAll<HTMLElement>("[data-wkf]")];
  const rt = (f: HTMLElement) => f.classList.contains("wkrt"), val = (f: HTMLElement) => (f as HTMLTextAreaElement).value, same = (f: HTMLElement) => f.innerHTML === WK0.get(f);   // an untouched block keeps its Markdown exactly
  const joined = (s: string, raw: string) => wkList(s) ? raw.split("\n").map(l => l.trim()).filter(Boolean).map(l => `- ${l}`).join("\n") : raw.trim();
  if (!LIVE) {   // the sandbox keeps an edit as the person's own note, like the real thing does
    const secs = wkPages(ch).flatMap(p => p.secs); let changed = 0;
    const add = (sec: string, text: string) => { nbNotes(ch).push(nn(sec, text, 0, undefined, { you: true, fresh: true })); changed++; };
    fields.forEach(f => { const id = f.dataset.wkf!;
      if (rt(f)) { const s = secs.find(x => x.id === id); if (!s || same(f)) return; const nv = wkMdFromHtml(f), was = wkText(s); if (nv && nv !== was) { NBW.fix[id] = nv; add(s.sec, wkList(nv) ? wkUnlist(nv).replace(/\n/g, ". ") : nv); } return; }
      const v = (f.classList.contains("wkfv") ? val(f).replace(/\s*\n\s*/g, " ") : val(f)).trim();
      if (id.startsWith("i:")) { const row = wkFacts(ch)[Number(id.slice(2))]; if (row && v && v !== row[1]) { NBW.info[row[0]] = v; add("about", `${row[0]}: ${v}`); } return; }
      const s = secs.find(x => x.id === id); if (!s || !v) return; const was = wkText(s), nv = joined(was, val(f)); if (nv !== was) { NBW.fix[id] = nv; add(s.sec, wkList(was) ? wkUnlist(nv).replace(/\n/g, ". ") : nv); } });
    wkLeave(ch); if (changed) note(ic.check, "Saved to the notebook", "", ""); return;
  }
  const st = nbpState(ch.slug), id = nbpCurId(ch), page = st.pages[id]; if (typeof page !== "object") return;
  const secs = nbpSecs(page.markdown), jobs: { section: string | null; text: string; apply: () => void }[] = [];
  fields.forEach(f => { const fid = f.dataset.wkf!;
    if (rt(f)) { const s = secs.find(x => x.id === fid); if (!s || same(f)) return; const nv = wkMdFromHtml(f); if (nv && nv !== s.text) jobs.push({ section: s.h || null, text: nv, apply: () => { s.text = nv; } }); return; }
    const v = (f.classList.contains("wkfv") ? val(f).replace(/\s*\n\s*/g, " ") : val(f)).trim();
    if (fid.startsWith("i:")) { const row = st.facts[Number(fid.slice(2))]; if (row && v && v !== row.value) jobs.push({ section: null, text: `${row.label}: ${v}`, apply: () => { row.value = v; } }); return; }
    const s = secs.find(x => x.id === fid); if (!s) return; const nv = joined(s.text, val(f)); if (nv && nv !== s.text) jobs.push({ section: s.h || null, text: nv, apply: () => { s.text = nv; } }); });
  if (!jobs.length) { wkLeave(ch); return; }
  NBW.saving = true; box.querySelectorAll<HTMLButtonElement>("[data-wkcancel],[data-wksave]").forEach(b => { b.disabled = true; });
  let failed: any = null, applied = 0;
  for (const j of jobs) {
    let r: any; try { r = await api(`/notebook/${ch.slug}/pages/${encodeURIComponent(id)}/edit`, { section: j.section, text: j.text }); } catch { r = { net: true }; }
    if (!r?.ok) { failed = r || {}; break; }
    j.apply(); applied++;
  }
  NBW.saving = false;
  if (applied) { page.markdown = nbpMarkdown(secs); st.saved[id] = { at: Date.now(), markdown: page.markdown }; }
  if (failed) { wkToast(failed); box.querySelectorAll<HTMLButtonElement>("[data-wkcancel],[data-wksave]").forEach(b => { b.disabled = false; }); return; }
  wkLeave(ch); note(ic.check, "Saved to the notebook", "", ""); nbSync(ch, true);
}
// "Not them": that match is wrong for this speaker. It goes away at once, and the server remembers it so it isn't offered again.
async function wkNotThem(ch: Channel, k: string, contact: string) {
  const x = beeSpk(ch).find(y => spkKey(y) === k); if (!x) return; const key = `${k}|${contact}`;
  WKQ.no.add(key); nbRefresh();
  const r = await spkCall({ op: "not_them", rec: x.rec, sid: x.spk, spk: x.spk, contact });
  if (!r?.ok) { WKQ.no.delete(key); wkToast(r); if (isNb()) nbRefresh(); return; }
  if (r.reviewed) { BF.done++; const gone = new Set<string>([k, ...(Array.isArray(r.cleared) ? r.cleared.map((y: any) => `${y.rec}|${y.spk}`) : [])]); (ch as any).beeSpeakers = ((ch as any).beeSpeakers || []).filter((y: BeeSpk) => !gone.has(spkKey(y))); if (isNb()) nbRefresh(); }   // the last match answered: the card goes, like Confirm
}
// Fact values are textareas that take exactly the height of their text, so Edit never changes a row's height.
function wkFit() { if (CSS.supports("field-sizing", "content")) return; document.querySelectorAll<HTMLTextAreaElement>(".wkfv").forEach(t => { t.style.height = "0"; t.style.height = `${t.scrollHeight}px`; }); }
window.addEventListener("resize", () => { if (document.querySelector(".wkfv, .wkta")) { wkFit(); document.querySelectorAll<HTMLTextAreaElement>(".wkta").forEach(t => { t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; }); } });
function wkAfter() {
  document.querySelectorAll<HTMLElement>(".wkrt").forEach(e => { if (!WK0.has(e)) WK0.set(e, e.innerHTML); });
  document.querySelectorAll<HTMLTextAreaElement>(".wkta").forEach(t => { t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; });
  wkFit();
  if (NBW.focus) { const t = document.querySelector<HTMLElement>(NBW.focus); NBW.focus = ""; if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) { t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length); t.closest("[data-wked]")?.scrollIntoView({ block: "nearest" }); } }
}
document.addEventListener("click", e => {
  const t = e.target as HTMLElement; if (!isNb()) return;
  const ch = route().ch;
  if (NBW.menu && !t.closest(".wkmw")) { NBW.menu = false; nbRefresh(); }
  const sk = t.closest<HTMLElement>("[data-wkskip]"); if (sk) { if (wkQueue(ch).length > 1) { WKQ.rank.set(sk.dataset.wkskip!, ++WKQ.n); BF.edit = 0; nbRefresh(); } return; }
  const bs = t.closest<HTMLElement>("[data-wkbee]"); if (bs) { NBW.sheet = bs.dataset.wkbee === "open"; NBW.menu = false; BF.edit = 0; SPK.edit = ""; nbRefresh(); return; }
  const nt = t.closest<HTMLElement>("[data-wkno]"); if (nt) { void wkNotThem(ch, nt.dataset.wkno!, nt.dataset.wkp!); return; }
  const pgl = t.closest<HTMLElement>("[data-wkpage]"); if (pgl) { e.preventDefault(); NBW.pg[ch.slug] = pgl.dataset.wkpage!; NBW.edit = ""; NBW.menu = false; NBW.sheet = false; nbRefresh(); document.getElementById("scroll")?.scrollTo({ top: 0 }); return; }
  if (t.closest("[data-wkmenu]")) { NBW.menu = !NBW.menu; nbRefresh(); return; }
  const se = t.closest<HTMLElement>("[data-wksec]"); if (se) { const sc = document.getElementById("scroll"), top = sc?.scrollTop ?? 0; NBW.edit = `sec:${se.dataset.wksec}`; nbPaint(ch); if (sc) sc.scrollTop = top;
    document.querySelector<HTMLElement>("[data-wked] [data-wkf]")?.focus({ preventScroll: true }); return; }
  if (t.closest("[data-wkphoto-rm]")) { void wkPhoto(ch, null); return; }
  if (t.closest("[data-wkphoto]")) { pickFiles(l => { if (l[0]) void wkPhoto(ch, l[0]); }, "image/*"); return; }
  if (t.closest("[data-wkretry]")) { const st = nbpState(ch.slug); st.failed = false; st.ready = false; nbPaint(ch); return; }
  if (t.closest("[data-wkedit]")) { NBW.edit = "page"; nbRefresh(); return; }
  if (t.closest("[data-wkcancel]")) { if (!NBW.saving) { wkLeave(ch); } return; }
  if (t.closest("[data-wksave]")) { void wkSave(); return; }
});
document.addEventListener("keydown", e => {
  const t = e.target as HTMLElement; if (!isNb()) return;
  if (e.key === "Escape" && NBW.sheet && !BF.edit && !SPK.edit) { e.preventDefault(); e.stopImmediatePropagation(); NBW.sheet = false; nbRefresh(); return; }
  if (e.key === "Escape" && NBW.menu) { e.preventDefault(); e.stopImmediatePropagation(); NBW.menu = false; nbRefresh(); return; }
  if (!t.matches("[data-wkf]")) return;
  if (e.key === "Enter" && t.classList.contains("wkfv") && !e.metaKey && !e.ctrlKey) { e.preventDefault(); return; }
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); (document.querySelector("[data-wkcancel]") as HTMLElement)?.click(); }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void wkSave(); }
}, true);
// Edited text takes no formatting except bold, italic, lists and paragraphs: a paste or drop brings in plain text, and other format commands are refused.
const wkPlain = (txt: string) => { let ls = txt.replace(/\r/g, "").split("\n"); if (ls.length > 1) ls = ls.filter(l => l.trim()); ls.forEach((l, i) => { if (i) document.execCommand("insertParagraph"); if (l) document.execCommand("insertText", false, l); }); };
document.addEventListener("paste", e => { if (!(e.target as HTMLElement)?.closest?.(".wkrt")) return; e.preventDefault(); wkPlain(e.clipboardData?.getData("text/plain") ?? ""); }, true);
document.addEventListener("drop", e => { if ((e.target as HTMLElement)?.closest?.(".wkrt")) e.preventDefault(); }, true);
document.addEventListener("beforeinput", e => { if (!(e.target as HTMLElement)?.closest?.(".wkrt")) return; if ((/^format/.test(e.inputType) && !/^format(Bold|Italic)$/.test(e.inputType)) || e.inputType === "insertFromDrop") e.preventDefault(); }, true);
// Typing over all of a link's text would leave the first letter in the link and put the rest outside it, because the browser moves a cursor at the end of a
// link to just after it. So the link's text is replaced here and keeps its URL, and the letters typed straight after stay in the link until the cursor moves.
let wkLink: HTMLAnchorElement | null = null;
const wkAtEnd = (a: HTMLAnchorElement, r: StaticRange) => r.collapsed && (a.contains(r.startContainer) ? r.startContainer === a.lastChild && r.startOffset === (a.lastChild?.textContent?.length ?? 0) : (r.startContainer === a.nextSibling && r.startOffset === 0) || (r.startContainer === a.parentNode && r.startOffset === [...a.parentNode!.childNodes].indexOf(a) + 1));
const wkLinkPut = (a: HTMLAnchorElement, text: string, append: boolean) => {
  a.textContent = (append ? a.textContent : "") + text; const t = a.firstChild!, nr = document.createRange(), sel = getSelection(); nr.setStart(t, t.textContent!.length); nr.collapse(true); sel?.removeAllRanges(); sel?.addRange(nr);
  a.closest(".wkrt")?.dispatchEvent(new Event("input", { bubbles: true })); wkLink = a;
};
document.addEventListener("beforeinput", e => {
  if (!(e.target as HTMLElement)?.closest?.(".wkrt") || e.inputType !== "insertText" || !e.data || e.isComposing) { wkLink = null; return; }
  const tr = e.getTargetRanges()[0]; if (!tr) { wkLink = null; return; }
  if (wkLink?.isConnected && wkAtEnd(wkLink, tr)) { e.preventDefault(); wkLinkPut(wkLink, e.data, true); return; }
  wkLink = null;
  const sel = getSelection(), ca = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).commonAncestorContainer : null, a = ca && (ca.nodeType === 1 ? ca as Element : ca.parentElement)?.closest("a");
  if (a && sel!.toString() === a.textContent && a.textContent) { e.preventDefault(); wkLinkPut(a as HTMLAnchorElement, e.data, false); }
}, true);
document.addEventListener("keydown", e => { if (e.key.length > 1 || e.metaKey || e.ctrlKey) wkLink = null; }, true);
document.addEventListener("mousedown", () => { wkLink = null; }, true);
document.addEventListener("focusin", e => { if ((e.target as HTMLElement)?.closest?.(".wkrt")) { try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch {} } });
document.addEventListener("input", e => { const t = e.target as HTMLElement; if (t.classList.contains("wkta") || (t.classList.contains("wkfv") && !CSS.supports("field-sizing", "content"))) { (t as HTMLTextAreaElement).style.height = "0"; (t as HTMLTextAreaElement).style.height = `${t.scrollHeight}px`; } });
unsavedKind("wk", {
  active: () => !!NBW.edit,
  title: () => "Save your changes to this page?", body: () => "You changed the text but haven't saved it.",
  save: () => (document.querySelector("[data-wksave]") as HTMLElement)?.click(),
  discard: () => { wkLeave(route().ch); },
  leave: "[data-wkpage],[data-wkedit]",
});

function nbPage(ch: Channel) { return `<div class="dhome" id="scroll"><div class="lwrap wkwrap" id="nbody">${nbWiki(ch)}</div></div>`; }
// Opening the Notebook re-reads it from the server, so things the helper saved since the page loaded are there.
const NB_AT: Record<string, number> = {};
const NB_REQUEST: Record<string, number> = {};
function nbSync(ch: Channel, force = false) {
  if (!LIVE || NBUI.edit || NBUI.add || BF.edit || (!force && Date.now() - (NB_AT[ch.slug] || 0) < 3000)) return; NB_AT[ch.slug] = Date.now();
  const request = NB_REQUEST[ch.slug] = (NB_REQUEST[ch.slug] || 0) + 1;
  api(`/notebook/${ch.slug}`).then((d: any) => { if (request !== NB_REQUEST[ch.slug] || !Array.isArray(d?.notes)) return;
    if (ch.slug === "main") { NB_BEE_UNREAD.update(Array.isArray(d.bee?.pending) ? d.bee.pending : null); if (isNb() && route().ch === ch) nbBeeVisit(ch); nbBeePaint(); }
    const old = NBD[ch.slug]; (ch as any).notes = d.notes; bfMerge(ch, d.bee?.pending || []); if (ch.slug === "main") (ch as any).beeSpeakers = Array.isArray(d.bee?.speakers) ? d.bee.speakers : []; delete NBD[ch.slug]; const nb = nbOf(ch);
    if (old) { const had = new Set(old.notes.map((n: any) => String(n.id))), was = new Set(old.notes.filter((n: any) => n.fresh).map((n: any) => String(n.id)));
      nb.notes.forEach((n: any) => { if (!had.has(String(n.id)) || was.has(String(n.id))) n.fresh = true; }); }   // "New" stays until the page reloads
    if (isNb() && route().ch === ch && !NBUI.edit && !NBUI.add && !BF.edit && !NBW.edit) nbPaint(ch); }).catch(() => {});
}
function nbAfter() { wkAfter(); const t = document.getElementById("nedit") as HTMLTextAreaElement | null || document.getElementById("nadd") as HTMLTextAreaElement | null; if (t) { if (t.scrollHeight > t.clientHeight) t.style.height = `${Math.min(t.scrollHeight + 2, innerHeight * 0.5)}px`; autoFocus(t, undefined, true); } }   // a long note opens tall enough to read whole
// Unsaved edits (unsaved.ts): editing another note, leaving the Notebook, Esc, a reload... ask first.
unsavedKind("note", {
  active: () => !!(NBUI.edit || NBUI.add || BF.edit),
  title: el => el.querySelector("#nadd") ? "Add this note?" : el.querySelector("#bfedit") ? "Save and approve this?" : "Save your changes to this note?",
  body: el => el.querySelector("#nadd") ? "You started a note but haven't added it." : el.querySelector("#bfedit") ? "You changed what your Bee picked up but haven't approved it." : "You changed this note but haven't saved it.",
  save: el => el.querySelector<HTMLElement>("[data-nsave], [data-nsaveadd], [data-bfsave]")?.click(),
  discard: () => { NBUI.edit = 0; NBUI.add = ""; BF.edit = 0; nbRefresh(); },
  leave: "[data-nedit],[data-nadd],[data-bfedit]",
});
// Data that arrives after the Notebook opened (the server re-read, the pages tree, a page's text) is patched into the screen that's showing. Rebuilding #scroll
// (render() or innerHTML on it) throws away the element the finger is dragging, so the page jumped to the top mid-gesture.
function nbPaint(ch: Channel) {
  const sc = document.getElementById("scroll"); if (!sc || !isNb() || route().ch !== ch) { render(); return; }
  const t = document.createElement("template"); t.innerHTML = nbPage(ch); const n = t.content.firstElementChild; if (n) morph(sc, n.innerHTML); nbAfter();
}
// After the app has drawn and the browser is idle, read the current channel's Notebook into memory (the pages tree, its first page, the notes and Bee items),
// so opening it draws at once from the cache and then updates in place. Only for a channel the person is in, only with the pages flag, and again when the channel changes.
const NB_PRE: Record<string, number> = {};
function nbPrefetch() {
  if (!LIVE) return; const ch = route().ch; if (!ch || !channels.includes(ch) || isNb() || Date.now() - (NB_PRE[ch.slug] || 0) < 300e3) return; NB_PRE[ch.slug] = Date.now();
  void nbpLoad(ch, false, true); nbSync(ch);
}
const nbPrefetchNow = () => { try { nbPrefetch(); } catch {} };   // boot data is already in when this file runs, so the read starts at once
const nbPrefetchLater = () => { const go = () => { try { nbPrefetch(); } catch {} }; if ("requestIdleCallback" in window) (window as any).requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500); };
if (LIVE) { if (hasFeature("ambient")) setTimeout(() => beeLibEnsure(true), 1500); setTimeout(nbPrefetchNow, 0);   // the Bee conversation list is read before the Library opens, so its filter never appears under a Library that is already drawn
  window.addEventListener("hashchange", () => setTimeout(nbPrefetchLater, 800)); }
function nbRefresh() { const b = document.getElementById("nbody"); if (b) { b.innerHTML = nbWiki(route().ch); nbAfter(); } }
// "Added to …" under a reply: one chip per place a remember really saved (m.saved, from the tool's result; never guessed from
// the step line, which said Notebook even when it went to Dana's contact). The design sandbox's scripted "remember:" steps are
// Notebook notes.
function nbSaved(m: Msg, ch: Channel) {
  const list: Saved[] = LIVE ? m.saved || [] : m.steps.filter(x => /^remember:/i.test(x)).map(x => { const text = x.replace(/^remember:\s*/i, "").replace(/ ×\d+$/, "");
    return { to: "notebook", text, sec: nbNotes(ch).find(n => n.text.startsWith(text.slice(0, 20)))?.sec ?? "how" }; });
  const seen = new Set<string>();
  return list.filter(x => { const k = JSON.stringify(x); return !seen.has(k) && !!seen.add(k); }).map(x => savedChip(x, ch)).join("");
}
function savedChip(x: Saved, ch: Channel) {
  const q = x.text ? `“${esc(x.text)}”` : "", chip = (href: string, icon: string, title: string, small: string) =>
    `${href ? `<a class="nbsaved" href="${href}">` : `<div class="nbsaved">`}${icon}<span><b>${title}</b>${small ? `<small>${small}</small>` : ""}</span>${href ? `${ic.chev}</a>` : "</div>"}`;
  if (x.to === "contact") {
    const nm = String(x.name || "").trim(), lc = nm.toLowerCase(), first = lc.split(/\s+/)[0];
    const c = CT.list.find(c => c.name.toLowerCase() === lc || c.aka.some(a => a.toLowerCase() === lc)) ?? (CT.list.filter(c => c.name.toLowerCase().split(/\s+/)[0] === first).length === 1 ? CT.list.find(c => c.name.toLowerCase().split(/\s+/)[0] === first) : undefined);
    return chip(`#/main/contacts${c ? `/${c.id}` : ""}`, ic.people, nm ? `Added to ${esc(nm)}'s contact` : "Added to Contacts", x.fields?.length ? esc(x.fields.join(" · ")) : q);
  }
  const there = x.channel && x.channel !== ch.slug ? channels.find(c => c.slug === x.channel) : undefined, at = there ?? ch, inCh = x.channel && x.channel !== ch.slug ? ` in ${esc(there?.name ?? `#${x.channel}`)}` : "";
  if (x.to === "notebook") { const sec = NB_SECS.find(s => s[0] === x.sec)?.[1]; return chip(`#/${at.slug}/notebook${sec ? `/${x.sec}` : ""}`, ic.nb, `Added to ${esc(who(at))}'s Notebook${inCh}`, [sec ? esc(sec) : "", q].filter(Boolean).join(" · ")); }
  if (x.to === "account") return chip("", ic.nb, `${esc(who(ch))} will remember this about you`, ["In every channel", q].filter(Boolean).join(" · "));
  return chip("", ic.nb, `Saved to ${esc(who(at))}'s memory${inCh}`, q);   // memory only (before the Notebook): nothing to open
}
document.addEventListener("click", e => {
  const t = e.target as HTMLElement; if (!isNb()) return;
  const ch = route().ch, nb = nbOf(ch);
  // ⋯ on a note (touch / narrow): Edit and Delete in a small menu; any other click closes it
  const mo = t.closest<HTMLElement>("[data-nmore]"); if (mo) { NBUI.menu = String(NBUI.menu) === mo.dataset.nmore ? 0 : mo.dataset.nmore!; nbRefresh(); if (NBUI.menu) document.querySelector<HTMLElement>(".nbmenu [data-nedit]")?.focus(); return; }
  if (NBUI.menu && !t.closest(".nbmenu")) { NBUI.menu = 0; nbRefresh(); if (!t.closest("button, a, textarea")) return; }
  NBUI.menu = 0;
  const so = t.closest<HTMLElement>("[data-spkok]"); if (so) { void spkAct(ch, "accept", so.dataset.spkok!); return; }
  const se = t.closest<HTMLElement>("[data-spkedit]"); if (se) { SPK.edit = se.dataset.spkedit!; nbRefresh(); const i = document.getElementById("spkedit") as HTMLInputElement | null; if (i) { i.focus(); i.select(); } return; }
  if (t.closest("[data-spkcancel]")) { SPK.edit = ""; nbRefresh(); return; }
  const ss = t.closest<HTMLElement>("[data-spksave]"); if (ss) { const v = (document.getElementById("spkedit") as HTMLInputElement | null)?.value.trim(); if (!v) return; void spkAct(ch, "edit", ss.dataset.spksave!, { name: v }); return; }
  const sc = t.closest<HTMLElement>("[data-spkconf]"); if (sc) { void spkAct(ch, "confirm", sc.dataset.spkconf!, { person: sc.dataset.spkp }); return; }
  const bo = t.closest<HTMLElement>("[data-bfok]"); if (bo) { void beeFactAct(ch, "approve", Number(bo.dataset.bfok)); return; }
  const bn = t.closest<HTMLElement>("[data-bfno]"); if (bn) { void beeFactAct(ch, "deny", Number(bn.dataset.bfno)); return; }
  const be = t.closest<HTMLElement>("[data-bfedit]"); if (be) { BF.edit = Number(be.dataset.bfedit); BF.err = null; NBUI.edit = 0; NBUI.add = ""; nbRefresh(); const ta = document.getElementById("bfedit") as HTMLTextAreaElement | null; if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
  if (t.closest("[data-bfcancel]")) { BF.edit = 0; nbRefresh(); return; }
  const bs = t.closest<HTMLElement>("[data-bfsave]"); if (bs) { const v = ($("#bfedit") as HTMLTextAreaElement).value.trim(); if (!v) return; void beeFactAct(ch, "edit", Number(bs.dataset.bfsave), v); return; }
  const ed = t.closest<HTMLElement>("[data-nedit]"); if (ed) { BF.edit = 0; NBUI.edit = ed.dataset.nedit!; NBUI.add = ""; nbRefresh(); return; }
  if (t.closest("[data-ncancel]")) { NBUI.edit = 0; NBUI.add = ""; nbRefresh(); return; }
  const sv = t.closest<HTMLElement>("[data-nsave]"); if (sv) { const v = ($("#nedit") as HTMLTextAreaElement).value.trim(); if (!v) return;
    { const n = nb.notes.find(x => String(x.id) === sv.dataset.nsave)!; n.text = v; n.at = Date.now(); n.you = true; n.fresh = false; if (LIVE) nbApi(ch, { op: "edit", id: n.id, text: v }).then(r => r.error && nbFail(r, ch)).catch(() => nbFail()); }
    const fromBee = nb.notes.find(x => String(x.id) === sv.dataset.nsave)?.src === "bee";
    NBUI.edit = 0; nbRefresh(); render(); note(ic.check, fromBee ? "Saved here and in your Bee" : "Saved", `${who(ch)} uses this starting with the next task.`, ""); return; }
  const ad = t.closest<HTMLElement>("[data-nadd]"); if (ad) { NBUI.add = ad.dataset.nadd!; NBUI.edit = 0; nbRefresh(); return; }
  const sa = t.closest<HTMLElement>("[data-nsaveadd]"); if (sa) { const v = ($("#nadd") as HTMLTextAreaElement).value.trim(); if (!v) return;
    const nn2: Note = { id: nbId++, sec: sa.dataset.nsaveadd!, text: v, at: Date.now(), you: true }; nb.notes.push(nn2);
    if (LIVE) nbApi(ch, { op: "add", sec: nn2.sec, text: v }).then(r => { if (r.error) nbFail(r, ch); else nn2.id = r.id; }).catch(() => nbFail()); NBUI.add = ""; nbRefresh(); render(); note(ic.check, "Added to the notebook", `${who(ch)} uses this starting with the next task.`, ""); return; }
  const dl = t.closest<HTMLElement>("[data-ndel]"); if (dl) { const i = nb.notes.findIndex(x => String(x.id) === dl.dataset.ndel); if (i < 0) return; const [gone] = nb.notes.splice(i, 1);
    if (LIVE) nbApi(ch, { op: "delete", id: gone.id }).catch(() => nbFail());
    (window as any).__nbUndo = () => { nb.notes.splice(i, 0, gone); if (LIVE) nbApi(ch, { op: "add", sec: gone.sec, text: gone.text, ...(gone.src === "bee" ? { bee: true } : {}) }).then(r => { if (!r.error) gone.id = r.id; }); nbRefresh(); render(); hideToast(); };
    nbRefresh(); render(); note(ic.trash, gone.src === "bee" ? "Deleted from the notebook and your Bee" : LIVE ? "Deleted from the notebook and memory" : "Deleted from the notebook", gone.text, `<button class="tview" onclick="__nbUndo()">Undo</button>`); }
});
document.addEventListener("keydown", e => {
  const t = e.target as HTMLElement;
  // Esc in the contact form closes it (asking first if something changed).
  if (e.key === "Escape" && isCt() && (CT.edit || CT.adding) && document.getElementById("cxform") && (t.closest?.("#cxform, .cxwrap") || t === document.body)) {
    e.preventDefault(); e.stopImmediatePropagation(); guarded(() => { CT.edit = 0; CT.adding = false; ctRefresh(); }); return; }
  if (t.id === "cxfnew") {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); (document.querySelector("[data-cxfsave]") as HTMLElement)?.click(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); CT.fadd = 0; ctRefresh(); }
    return; }
  if (isNb() && NBUI.menu && e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); const id = NBUI.menu; NBUI.menu = 0; nbRefresh(); document.querySelector<HTMLElement>(`[data-nmore="${id}"]`)?.focus(); return; }
  if (isNb() && t.id === "spkedit") {
    if (e.key === "Enter") { e.preventDefault(); (document.querySelector("[data-spksave]") as HTMLElement)?.click(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); SPK.edit = ""; nbRefresh(); }
    return; }
  if (isNb() && t.id === "bfedit") {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); (document.querySelector("[data-bfsave]") as HTMLElement)?.click(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); guarded(() => { BF.edit = 0; nbRefresh(); }); }
    return; }
  if (!isNb() || (t.id !== "nedit" && t.id !== "nadd")) return;
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); (document.querySelector(t.id === "nadd" ? "[data-nsaveadd]" : "[data-nsave]") as HTMLElement)?.click(); }
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); guarded(() => { NBUI.edit = 0; NBUI.add = ""; nbRefresh(); }); }
}, true);


// ---------- Contacts (2026-10-01): one shared address book. The helper knows who "my husband" or "Ari" is, keep it current, and ask before adding ----------
type Contact = { id: number; name: string; rel: string; aka: string[]; phone?: string; email?: string; phones?: Num[]; emails?: Num[]; bday?: string; addr?: string; group: string; color: string;
  facts: { text: string; src: string; at: number; fresh?: boolean; id?: string }[]; seen: [string, number][]; from: string; fresh?: boolean; sid?: string; photo?: string };
const CX_COL = ["#E8D5F5", "#D5E8F5", "#F5E3D5", "#D5F5E0", "#F5D5DC", "#F2EFC9", "#D9DEF7"];
let cxId = 1;
const cx = (o: Omit<Contact, "id" | "color">): Contact => ({ id: cxId, color: CX_COL[cxId++ % CX_COL.length], ...o });
const CT = { list: [] as Contact[], q: "", grp: "All", edit: 0 as number, at: "", fadd: 0 as number, adding: false, imp: false, sugg: [] as { name: string; why: string; where: [string, number][]; rel: string }[],
  dups: [] as { a: string; b: string; why: string }[], notdup: new Set<string>() };   // live: 1HC's suggested duplicates (by server id); sandbox: pairs dismissed here
// Live: Contacts is the workspace-shared memory registry (/api/contacts). The helper reads and writes it from every project.
const ctFromApi = (c: any): Contact => cx({ sid: String(c.id), name: c.name, rel: c.rel || "Contact", aka: c.aka || [], phone: c.phone, email: c.email, phones: c.phones, emails: c.emails, bday: c.bday, addr: c.addr, group: c.group || "Family", from: c.from || "", photo: c.photo && LIVE ? `${LIVE.api}/contacts/photo/${encodeURIComponent(c.id)}` : undefined,
  facts: (c.facts || []).map((f: any) => ({ id: String(f.id), text: f.text, src: f.src === "You imported" ? "You imported" : /^You /.test(f.src) ? `You told ${who(main)}` : f.src ? `Learned in ${f.src}` : "Learned while working", at: f.at })), seen: [] });
if (LIVE && Array.isArray(BOOT?.contacts)) CT.list = BOOT.contacts.map(ctFromApi);
if (LIVE && Array.isArray(BOOT?.contactDups)) CT.dups = BOOT.contactDups;
const ctApi = (b: any) => LIVE ? fetch(`${LIVE.api}/contacts`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json()).catch(() => null) : Promise.resolve(null);
const ctSave = (c: Contact) => ctApi({ op: "save", contact: { id: c.sid, name: c.name, rel: c.rel, aka: c.aka, phone: c.phone, email: c.email, phones: numsOf(c).phones.map(x => ({ v: x.v, t: x.label.toLowerCase() })), emails: numsOf(c).emails.map(x => ({ v: x.v, t: x.label.toLowerCase() })), bday: c.bday, addr: c.addr, group: c.group } }).then((r: any) => { if (r?.id) { c.sid = String(r.id); if (r.phones) { c.phones = r.phones; c.emails = r.emails; } } });
if (!LIVE) {
  CT.list = [
    cx({ name: "Sam Rivera", rel: "Your husband", aka: ["my husband", "Sam", "hubby"], phone: "(503) 555-0187", email: "sam.rivera@gmail.com", bday: "Mar 22", group: "Family", from: "You added",
      facts: [{ text: "Dentist on Thursdays at 3:15 this month, so you do school pickup.", src: "Thursday pickup", at: NOW - 6 * D }, { text: "Likes a heads-up text, not a call, when plans change.", src: "You told Skipper", at: NOW - 9 * D },
        { text: "Grabs the wine for dinners out. Prefers a Willamette pinot.", src: "Dinner with Ari moved", at: NOW - 2 * H, fresh: true }], seen: [["main", 901], ["family-schedule", 11], ["family-schedule", 14]] }),
    cx({ name: "Maya Rivera", rel: "Your daughter", aka: ["Maya", "my daughter", "the kid"], bday: "Jun 3", group: "Family", from: "You added",
      facts: [{ text: "Soccer Tue & Thu at 5:30 PM, starting Oct 6.", src: "Soccer practice schedule", at: NOW - 5 * D }, { text: "School lets out early on Wednesdays (1:15 PM).", src: "Next week overview", at: NOW - 5 * D }],
      seen: [["family-schedule", 12], ["family-schedule", 13], ["family-schedule", 11]] }),
    cx({ name: "Grandma Ruth", rel: "Sam's mom", aka: ["Grandma", "Ruth", "my mother-in-law"], phone: "(360) 555-0119", bday: "Oct 14", addr: "Vancouver, WA", group: "Family", from: "From your iPhone",
      facts: [{ text: "Likes a phone call on her birthday morning, not a text.", src: "Grandma's birthday", at: NOW - 4 * D }, { text: "Gift ideas so far: a framed photo of Maya, a garden kneeler.", src: "Grandma's birthday", at: NOW - 4 * D }],
      seen: [["family-schedule", 15]] }),
    cx({ name: "Ari Cohen", rel: "Your boss", aka: ["my boss", "Ari"], email: "ari@northwind.co", phone: "(503) 555-0160", group: "Work", from: "Skipper added · you said yes",
      facts: [{ text: "Prefers email over Slack for anything with a deadline.", src: "You told Skipper", at: NOW - 12 * D }, { text: "Dinner with Ari and his wife is Friday at 7:30 at Nostrana.", src: "Dinner with Ari moved", at: NOW - 2 * H, fresh: true }],
      seen: [["main", 901]] }),
    cx({ name: "Dr. Patel", rel: "Family dentist", aka: ["the dentist", "Dr. Patel"], phone: "(503) 555-0133", addr: "Pearl District Dental, NW 11th Ave", group: "Services", from: "From your iPhone",
      facts: [{ text: "Books cleanings 6 months apart. Next one for you is due in November.", src: "Learned while working", at: NOW - 20 * D }], seen: [] }),
    cx({ name: "Jordan Lee", rel: "Neighbor", aka: ["Jordan", "the neighbor"], phone: "(503) 555-0175", group: "Friends", from: "From your iPhone",
      facts: [{ text: "Has a spare key. Waters the plants when you travel.", src: "You told Skipper", at: NOW - 15 * D }], seen: [["trip-planning", 27]] }),
  ];
  CT.sugg = [{ name: "Coach Rivera", rel: "Maya's soccer coach", why: "Came up in 3 tasks, and emails you every Monday", where: [["family-schedule", 12], ["family-schedule", 14]] },
    { name: "Priya (Delta agent)", rel: "Booked your Japan flights", why: "Gave you a direct line in a flight email", where: [["trip-planning", 26]] }];
  main.sessions.unshift({ id: 901, title: "Dinner with Ari moved", status: "resolved", state: "complete", updated: NOW - 2 * H, unread: true, messages: [
    { id: 9010, role: "user", at: NOW - 2 * H - 60e3, steps: [], body: "Tell my husband dinner with my boss got moved to Friday 7:30, and ask if he can grab wine" },
    { id: 9011, role: "agent", at: NOW - 2 * H, steps: ["contacts: “my husband” → Sam Rivera · “my boss” → Ari Cohen", "send text to Sam Rivera (503) 555-0187", "update calendar: Dinner with Ari · Fri 7:30 PM"], ct: [1, 4],
      body: "Texted **Sam**: “Dinner with Ari moved to Friday at 7:30. Can you grab a bottle of wine on the way? A Willamette pinot would be perfect.”\n\nI moved it on the family calendar too.\n\nThe new time came from **Dana Park**, Ari's assistant. She isn't in your contacts yet.",
      cards: [{ t: "contact", k: "dana", c: { name: "Dana Park", rel: "Ari's assistant", phone: "(503) 555-0142", email: "dana@northwind.co", where: "Re: Friday dinner · Gmail" } }] } as any,
  ] } as any);
}
const ctSel = () => { const m = location.hash.match(/\/contacts\/(\d+)/); return m ? CT.list.find(c => c.id === +m[1]) ?? null : null; };
const ctInit = (n: string) => !/\p{L}/u.test(n) ? "#" : n.replace(/\(.*?\)/g, "").replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const ctAv = (c: { name: string; color?: string; photo?: string }, cls = "cxav") => c.photo ? `<span class="${cls} ph" style="background:${c.color || "#EFEDE6"}"><img src="${esc(c.photo)}" alt="" loading="lazy"></span>` : `<span class="${cls}" style="background:${c.color || "#EFEDE6"}">${esc(ctInit(c.name))}</span>`;
const CX_GROUPS = ["All", "Family", "Work", "Friends", "Services"];
const chName = (slug: string, id: number) => { const c = channels.find(x => x.slug === slug); const t = c?.sessions.find(x => x.id === id); return t ? { c: c!, t } : null; };
function ctList() {
  const sugg = !CT.q.trim() && CT.sugg.length ? `<div class="cxsugg"><div class="cxsh">${g("spark", 14)}Suggested by ${esc(who(main))}</div>${CT.sugg.map((x, i) => `<div class="cxsrow"><span class="cxav ghost">${esc(ctInit(x.name))}</span><div class="cxmain"><b>${esc(x.name)}</b><small>${esc(x.rel)} · ${esc(x.why)}</small></div>
      <button class="sa" data-cxsadd="${i}">Add</button><button class="cb sm" data-cxsno="${i}" aria-label="Not now" title="Not now">${g("x", 15)}</button></div>`).join("")}</div>` : "";
  return clList(CT.list, { q: CT.q, grp: CT.grp, top: (CT.q.trim() ? "" : dupBanner()) + sugg, foot: LIVE ? `<button class="cxlimp" data-cximp>${g("imp", 16)}<span>Import contacts from your phone, Google or Outlook</span></button>` : "" });
}
const ctListPaint = () => { const l = document.getElementById("cxlist"); if (l) { l.innerHTML = ctList(); clMount(); } };
clInit({ av: (c, cls) => ctAv(c, cls), href: c => `#/${route().ch.slug}/contacts/${c.id}`, helper: () => who(main), phone, sel: () => ctSel()?.id || 0,
  go: c => { location.hash = `/${route().ch.slug}/contacts/${c.id}`; }, repaint: ctListPaint });
// Merging two contacts (contacts-merge.ts). Live: 1HC merges in one transaction and returns the merged card; the sandbox merges here.
const ctDups = () => LIVE ? CT.dups.map(d => ({ a: CT.list.find(c => c.sid === d.a)!, b: CT.list.find(c => c.sid === d.b)!, why: d.why })).filter(d => d.a && d.b) : findDups(CT.list, CT.notdup);
cmInit({ list: () => CT.list, av: (c, cls) => ctAv(c, cls), helper: () => who(main), phone, groups: () => CX_GROUPS.slice(1), dups: ctDups,
  notDup: (a, b) => { if (LIVE) { CT.dups = CT.dups.filter(d => !([d.a, d.b].includes(a.sid!) && [d.a, d.b].includes(b.sid!))); ctApi({ op: "notdup", a: a.sid, b: b.sid }); } else CT.notdup.add([a.id, b.id].sort().join("|")); ctListPaint(); },
  merge: async (keep, drop, pick) => {
    if (LIVE) { const r: any = await ctApi({ op: "merge", keep: keep.sid, drop: drop.sid, pick }); if (!r?.id) return false;
      Object.assign(keep, ctFromApi(r), { id: keep.id, color: keep.color, seen: [...keep.seen, ...drop.seen] });
      api("/contacts").then((d: any) => { if (Array.isArray(d?.dups)) { CT.dups = d.dups; if (isCt()) ctListPaint(); } }).catch(() => {}); }
    else mergeLocal(keep, drop, pick);
    CT.list = CT.list.filter(c => c !== drop); CT.edit = 0;
    const to = `/${route().ch.slug}/contacts/${keep.id}`; if (location.hash !== "#" + to) location.hash = to; else ctRefresh();
    note(ic.check, `Merged into ${keep.name}`, `${numsOf(keep).phones.length} ${numsOf(keep).phones.length === 1 ? "number" : "numbers"}, ${numsOf(keep).emails.length} ${numsOf(keep).emails.length === 1 ? "email" : "emails"}. ${who(main)} knows them as one person now.`, "");
    return true; } });
function ctForm(c?: Contact) {
  const v = (k: keyof Contact) => esc(String((c as any)?.[k] ?? ""));
  return `<form class="cxform" id="cxform" data-unsaved="contact" data-unsaved-key="${c ? c.id : "new"}"${c ? ` data-unsaved-name="${esc(c.name)}"` : ""}><div class="cxfhead">${c ? ctAv(c, "cxav lg") : `<span class="cxav lg ghost">${ic.people}</span>`}<h2>${c ? "Edit contact" : "New contact"}</h2></div>
    <label class="cxfield"><span>Name</span><input name="name" value="${v("name")}" placeholder="Sam Rivera" autocomplete="off" required></label>
    <label class="cxfield"><span>Who are they to you?</span><input name="rel" value="${v("rel")}" placeholder="Your husband, your boss, Maya's coach…" autocomplete="off"></label>
    <label class="cxfield"><span>Also called</span><input name="aka" value="${esc((c?.aka || []).join(", "))}" placeholder="my husband, Sam" autocomplete="off"><em>When you say any of these, ${esc(who(main))} knows who you mean.</em></label>
    ${numRows("phone", c)}${numRows("email", c)}
    <div class="cxfield"><span>Group</span>${pills("group", [...new Set([...CX_GROUPS.slice(1), ...(c?.group ? [c.group] : [])])], c?.group || "Family", "Group", "cxgpills")}</div>
    <div class="cxf2"><label class="cxfield"><span>Birthday</span><input name="bday" value="${v("bday")}" placeholder="Oct 14" autocomplete="off"></label></div>
    <div class="cxfbtn"><button class="cxbtn" type="submit">${c ? "Save" : "Add contact"}</button><button type="button" class="sa mute" data-cxcancel>Cancel</button></div></form>`;
}
// Unsaved edits (unsaved.ts): another contact, All contacts, another section, Esc, a reload... ask first.
unsavedKind("contact", {
  active: () => !!(CT.edit || CT.adding),   // not isCt(): in hashchange the address already points elsewhere
  title: el => el.dataset.unsavedName ? `Save changes to ${el.dataset.unsavedName}?` : "Save this new contact?",
  body: el => el.dataset.unsavedName ? "You changed this contact but haven't saved it." : "You started a new contact but haven't saved it.",
  state: el => { const f = el as HTMLFormElement, v = (n: string) => ((f.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value || "").trim();
    return JSON.stringify([v("name"), v("rel"), v("aka").split(",").map(x => x.trim()).filter(Boolean), readNums(f, "phone"), readNums(f, "email"), v("group"), v("bday")]); },
  discard: () => { CT.edit = 0; CT.adding = false; ctRefresh(); },
  leave: "[data-cxadd],[data-cxsadd],[data-cxdupm]",
});
function ctDetail() {
  if (CT.adding) return ctForm();
  const c = ctSel();
  if (!c) return `<div class="cxempty">${ic.people}<h2>Everyone you mention, in one place</h2><p>When you say “my husband”, “my boss” or just “Ari”, ${esc(who(main))} looks here first. It knows who you mean, how to reach them, and what matters to them.</p>
    <div class="cxeb"><button class="cxbtn" data-cxadd>${ic.plus}Add a contact</button><button class="sa" data-cximp>Import</button></div></div>`;
  if (CT.edit === c.id) return ctForm(c);
  const row = (icon: string, label: string, val?: string, pre = "") => val ? `<div class="cxinfo">${icon}<span><small>${label}</small>${pre}${esc(val)}</span></div>` : "";
  const seen = c.seen.map(([sl, id]) => chName(sl, id)).filter(Boolean) as { c: Channel; t: Session }[];
  return `<div class="cxdet"><div class="cxdhead">${ctAv(c, "cxav xl")}<div class="cxdh"><h1>${esc(c.name)}</h1><span class="cxrel">${esc(c.rel)}</span></div>
      <div class="cxdact"><button class="sa" data-cxmerge="${c.id}" title="Merge with another card for the same person">Merge</button><button class="sa" data-cxedit="${c.id}">Edit</button></div></div>
    <div class="cxaka"><span class="cxlab">${esc(who(main))} knows them as</span>${c.aka.map(a => `<span class="cxchip">“${esc(a)}”</span>`).join("")}<button class="cxchip add" data-cxedit="${c.id}">${ic.plus}</button></div>
    <div class="cxgrid">${numsOf(c).phones.map(x => row(ic.phone, `${x.label}${x.primary && numsOf(c).phones.length > 1 ? " · primary" : ""}`, x.v)).join("")}${numsOf(c).emails.map(x => row(ic.mail, `${x.label}${x.primary && numsOf(c).emails.length > 1 ? " · primary" : ""}`, x.v, logoChip(workDomain(x.v), 16))).join("")}${row(ic.cake, "Birthday", c.bday)}${row(ic.pinmap, "Address", c.addr)}</div>
    <section class="cxsec"><div class="nsh"><h2>What ${esc(who(main))} knows</h2><span>Kept up to date as things change.</span></div>
      <div class="nblist">${c.facts.map((f, i) => `<div class="nbrow${f.fresh ? " fresh" : ""}"><span class="ndot"></span><div class="nmain"><p>${esc(f.text)}</p><span class="nsrc">${f.fresh ? `<b class="nnew">New</b>` : ""}${/^You |^Learned/.test(f.src) ? esc(f.src) : `Learned in ${esc(f.src)}`} · ${fileDate(f.at)}</span></div>
        <span class="nact"><button class="cb sm" data-cxfdel="${c.id}|${i}" aria-label="Delete" title="Delete">${ic.trash}</button></span></div>`).join("")}
      ${CT.fadd === c.id ? `<div class="nbrow editing"><textarea class="nedit" id="cxfnew" rows="2" placeholder="What should ${esc(who(main))} remember about ${esc(c.name.split(" ")[0])}?"></textarea><div class="nbtns"><button class="sa" data-cxfsave="${c.id}">Add</button><button class="sa mute" data-cxfcancel>Cancel</button></div></div>`
        : `<button class="nadd" data-cxfadd="${c.id}">${ic.plus}<span>Add something to remember</span></button>`}</div></section>
    ${seen.length ? `<section class="cxsec"><div class="nsh"><h2>Came up in</h2></div><div class="cxseen">${seen.map(x => `<a href="#/${x.c.slug}/s/${x.t.id}">${av(x.c, "av xs")}<span><b>${esc(x.t.title)}</b><small>${esc(x.c.name)} · ${ago(x.t.updated)}</small></span>${ic.chev}</a>`).join("")}</div></section>` : ""}
    <p class="cxfrom">${esc(c.from)} · ${esc(c.group)}. Every project can see this contact. ${esc(who(main))} asks before changing a phone number or email.</p>
    <button class="sa red" data-cxdel="${c.id}">Delete contact</button></div>`;
}
function ctPage() {
  if ((CT.edit || CT.adding) && location.hash !== CT.at) { CT.edit = 0; CT.adding = false; }   // you went somewhere else (nothing was changed, or you chose Discard/Save): the form is closed when you come back
  const sel = ctSel();
  return `<div class="dhome" id="scroll" data-cxpage="${sel || CT.adding ? "det" : "list"}"><div class="lwrap cxwrap${sel || CT.adding ? " has" : ""}">
    <div class="lhead"><span class="lh-all">${ic.people}</span><div class="lht"><h1>Contacts</h1><p>The people in your life, shared by all your projects. ${CT.list.length} people.</p></div>
      <div class="cxhb"><button class="sa" data-cximp>Import</button><button class="cxbtn" data-cxadd>${ic.plus}<span>Add</span></button></div></div>
    <div class="cxsplit"><div class="cxleft"><label class="lsearch cxsearch">${ic.search}<input id="cxq" placeholder="Search names, “my boss”, numbers…" value="${esc(CT.q)}" autocomplete="off"></label>
      <div class="chips cxgrps">${CX_GROUPS.map(gname => `<button class="fchip${CT.grp === gname ? " on" : ""}" data-cxgrp="${gname}">${gname}</button>`).join("")}</div>
      <div class="cxlw"><div id="cxlist" class="cxscroll">${ctList()}</div><div class="cxaz" id="cxaz"></div></div></div>
      <div class="cxright" id="cxdet">${sel ? `<a class="cxback" href="#/${route().ch.slug}/contacts">${ic.back}<span>All contacts</span></a>` : ""}${ctDetail()}</div></div></div></div>${CT.imp ? ctImport() : ""}`;
}
function ctImport() {
  return `<div class="cximp"><div class="sback" data-cximpx></div><div class="cximpbox" role="dialog" aria-modal="true" aria-label="Import contacts"><div class="aphead"><div><h2>Import contacts</h2><p>${esc(who(main))} only reads names, numbers, emails and birthdays. Nothing is shared or sent.</p></div><button class="cb" data-cximpx aria-label="Close">${g("x", 18)}</button></div>
    <button class="cximprow" data-cxfrom="google">${appIco("googlecontacts")}<span><b>Google Contacts</b><small>One click. Stays in sync when you add people in Google.</small></span>${ic.chev}</button>
    <button class="cximprow" data-cxfrom="iphone"><span class="aplogo cxapple"><svg viewBox="0 0 24 24" width="22" height="22" fill="#111"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM13.8 4.9c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"/></svg></span><span><b>iPhone or iCloud</b><small>Text “send my contacts” from your iPhone and share them. Or upload a .vcf file.</small></span>${ic.chev}</button>
    <button class="cximprow" data-cxfrom="csv"><span class="aplogo cxapple">${KIND.sheet ? I(KIND.sheet[1], 20) : ""}</span><span><b>A spreadsheet</b><small>Upload a CSV or Excel file, or pick a Google Sheet.</small></span>${ic.chev}</button>
    <p class="apfoot cxnote">${g("lock", 14)}You can delete any imported contact, or all of them, anytime.</p></div></div>`;
}
function ctAfter() { clMount(); const f = document.querySelector<HTMLInputElement>('#cxform input[name="name"]'); if (f && !f.value) autoFocus(f); }
function ctRefresh(listOnly = false) { if (!isCt()) return; if (phone()) { renderM(); return; } const l = document.getElementById("cxlist"); if (l) l.innerHTML = ctList(); if (!listOnly) { $("#stage").innerHTML = ctPage(); ctAfter(); } render(); }
function ctUsed(m: any) {
  if (!m.ct?.length) return ""; const cs = m.ct.map((id: number) => CT.list.find(c => c.id === id)).filter(Boolean) as Contact[];
  return `<div class="cxused"><span>${ic.people}Knew who you meant</span>${cs.map(c => `<a class="cxuchip" href="#/main/contacts/${c.id}">${ctAv(c, "cxav xs")}<b>${esc(c.name.split(" ")[0])}</b><small>${esc(c.rel.toLowerCase())}</small></a>`).join("")}</div>`;
}
const CX_DONE: Record<string, number> = {};
function ctSuggest(card: any) {
  const c = card.c, done = CX_DONE[card.k];
  if (done) return `<div class="acard done cxdone">${ic.check}<span>Added <b>${esc(c.name)}</b> to Contacts</span><a href="#/main/contacts/${done}">View</a></div>`;
  return `<div class="cxcard"><div class="cxch">${ctAv({ name: c.name, color: "#F2EFC9" })}<div><b>Add ${esc(c.name)} to your contacts?</b><small>Found in ${esc(c.where)}</small></div></div>
    <div class="cxcf"><span><small>Who</small>${esc(c.rel)}</span><span><small>Phone</small>${esc(c.phone)}</span><span><small>Email</small>${esc(c.email)}</span></div>
    <div class="abtns"><button class="cxbtn" data-cxok="${card.k}">Add contact</button><button data-cxno="${card.k}">Not now</button></div></div>`;
}
document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  const ok = t.closest<HTMLElement>("[data-cxok]"); if (ok) { e.preventDefault(); const k = ok.dataset.cxok!, card = channels.flatMap(c => c.sessions).flatMap(x => x.messages).flatMap((m: any) => m.cards || []).find((c: any) => c.t === "contact" && c.k === k);
    if (!card) return; const n = cx({ name: card.c.name, rel: card.c.rel, aka: [card.c.name.split(" ")[0], "Ari's assistant"], phone: card.c.phone, email: card.c.email, group: "Work", from: `${who(main)} added · you said yes`, facts: [{ text: "Handles Ari's calendar and dinner plans.", src: "Dinner with Ari moved", at: Date.now(), fresh: true }], seen: [["main", 901]], fresh: true });
    CT.list.push(n); ctSave(n); CX_DONE[k] = n.id; render(); note(ic.check, `Added ${n.name}`, `Next time you say “Dana”, ${who(main)} knows who you mean.`, `<button class="tview" data-tview="#/main/contacts/${n.id}">View</button>`); return; }
  const no = t.closest<HTMLElement>("[data-cxno]"); if (no) { e.preventDefault(); const el = no.closest(".cxcard"); if (el) el.outerHTML = `<div class="acard done">${ic.check}<span>OK, I won't save them. I'll ask again only if they keep coming up.</span></div>`; return; }
  if (!isCt()) return;
  if (dupClick(t)) { ctListPaint(); return; }
  const mg = t.closest<HTMLElement>("[data-cxmerge]"); if (mg) { const c = CT.list.find(x => x.id === +mg.dataset.cxmerge!); if (c && !mergeOpen(c)) note(g("help", 14), "Couldn't open Merge", "Reload the page and try again.", ""); return; }
  const gb = t.closest<HTMLElement>("[data-cxgrp]"); if (gb) { CT.grp = gb.dataset.cxgrp!; document.querySelectorAll(".cxgrps .fchip").forEach(b => b.classList.toggle("on", b === gb)); ctRefresh(true); return; }
  if (t.closest("[data-cxadd]")) { CT.adding = true; CT.edit = 0; if (ctSel()) location.hash = `/${route().ch.slug}/contacts`; CT.at = location.hash; ctRefresh(); return; }
  const ed = t.closest<HTMLElement>("[data-cxedit]"); if (ed) { CT.edit = +ed.dataset.cxedit!; CT.adding = false; CT.at = location.hash; ctRefresh(); return; }
  if (t.closest("[data-cxcancel]")) { CT.edit = 0; CT.adding = false; ctRefresh(); return; }
  if (t.closest("[data-cximp]")) { if (LIVE) { ciOpen(); return; } CT.imp = true; ctRefresh(); return; }   // live: the real import (contacts-import.ts); the sandbox keeps its sample rows
  if (t.closest("[data-cximpx]")) { CT.imp = false; ctRefresh(); return; }
  const fr = t.closest<HTMLElement>("[data-cxfrom]"); if (fr) { const k = fr.dataset.cxfrom!; fr.innerHTML = `<span class="apspin"></span><span><b>${k === "google" ? "Connecting Google Contacts…" : k === "iphone" ? "Waiting for your text…" : "Reading the file…"}</b></span>`;
    setTimeout(() => { CT.imp = false; const add = [cx({ name: "Alex Kim", rel: "College friend", aka: ["Alex"], phone: "(206) 555-0101", group: "Friends", from: k === "google" ? "From Google Contacts" : "Imported", facts: [], seen: [], fresh: true }),
      cx({ name: "Bright Smiles Pediatrics", rel: "Maya's pediatrician", aka: ["the pediatrician", "Maya's doctor"], phone: "(503) 555-0150", group: "Services", from: k === "google" ? "From Google Contacts" : "Imported", facts: [], seen: [], fresh: true })];
      CT.list.push(...add); ctRefresh(); note(ic.check, `Imported 214 contacts`, `${who(main)} matched 6 to people you already talk about.`, ""); }, 1400); return; }
  const sa = t.closest<HTMLElement>("[data-cxsadd]"); if (sa) { const x = CT.sugg.splice(+sa.dataset.cxsadd!, 1)[0]; const n = cx({ name: x.name, rel: x.rel, aka: [x.name.split(" ")[0]], group: /coach|school/i.test(x.rel) ? "Family" : "Services", from: `${who(main)} suggested · you said yes`, facts: [{ text: x.why + ".", src: "Learned while working", at: Date.now(), fresh: true }], seen: x.where, fresh: true });
    CT.list.push(n); location.hash = `/${route().ch.slug}/contacts/${n.id}`; return; }
  const sn = t.closest<HTMLElement>("[data-cxsno]"); if (sn) { CT.sugg.splice(+sn.dataset.cxsno!, 1); ctRefresh(true); return; }
  const fd = t.closest<HTMLElement>("[data-cxfdel]"); if (fd) { const [id, i] = fd.dataset.cxfdel!.split("|").map(Number); const c = CT.list.find(c => c.id === id), [f] = c?.facts.splice(i, 1) || []; if (c?.sid && f?.id) ctApi({ op: "dropfact", id: c.sid, fact: f.id }); ctRefresh(); return; }
  // "Add something to remember": an inline box like the Notebook's (it was the browser's own prompt() dialog).
  const fa = t.closest<HTMLElement>("[data-cxfadd]"); if (fa) { CT.fadd = +fa.dataset.cxfadd!; ctRefresh(); (document.getElementById("cxfnew") as HTMLTextAreaElement | null)?.focus(); return; }
  if (t.closest("[data-cxfcancel]")) { CT.fadd = 0; ctRefresh(); return; }
  const fs = t.closest<HTMLElement>("[data-cxfsave]"); if (fs) { const c = CT.list.find(x => x.id === +fs.dataset.cxfsave!)!; const v = (document.getElementById("cxfnew") as HTMLTextAreaElement | null)?.value || ""; if (!v.trim()) { (document.getElementById("cxfnew") as HTMLTextAreaElement | null)?.focus(); return; } CT.fadd = 0; { const f: Contact["facts"][number] = { text: v.trim(), src: `You told ${who(main)}`, at: Date.now() }; c.facts.unshift(f); if (c.sid) ctApi({ op: "fact", id: c.sid, text: f.text }).then((r: any) => { if (r?.id) f.id = String(r.id); }); ctRefresh(); } return; }
  const dl = t.closest<HTMLElement>("[data-cxdel]"); if (dl) { const i = CT.list.findIndex(c => c.id === +dl.dataset.cxdel!); const [gone] = CT.list.splice(i, 1); if (gone.sid) ctApi({ op: "delete", id: gone.sid }); location.hash = `/${route().ch.slug}/contacts`;
    (window as any).__cxUndo = () => { CT.list.splice(i, 0, gone); if (gone.sid) { gone.sid = undefined; ctSave(gone).then(() => gone.facts.forEach(f => ctApi({ op: "fact", id: gone.sid, text: f.text }))); } hideToast(); render(); }; note(ic.trash, `Deleted ${gone.name}`, "", `<button class="tview" onclick="__cxUndo()">Undo</button>`); return; }
});
document.addEventListener("input", e => { const t = e.target as HTMLInputElement; if (t.id === "kyq") { KY.q = t.value; kyListPaint(); return; } if (t.id === "cxq") { CT.q = t.value; ctListPaint(); } });
document.addEventListener("submit", e => {
  const f = e.target as HTMLFormElement; if (f.id !== "cxform") return; e.preventDefault(); e.stopImmediatePropagation();
  const d = Object.fromEntries(new FormData(f)) as Record<string, string>; if (!d.name.trim()) return;
  const aka = d.aka.split(",").map(x => x.trim()).filter(Boolean);
  const phones = readNums(f, "phone"), emails = readNums(f, "email"), nums = { phones, emails, phone: phones[0]?.v, email: emails[0]?.v };
  if (CT.edit) { const c = CT.list.find(x => x.id === CT.edit)!; Object.assign(c, { name: d.name.trim(), rel: d.rel.trim() || "Contact", aka, ...nums, bday: d.bday || undefined, group: d.group }); ctSave(c); CT.edit = 0; ctRefresh(); note(ic.check, "Saved", `${who(main)} uses this starting with the next task.`, ""); return; }
  const n = cx({ name: d.name.trim(), rel: d.rel.trim() || "Contact", aka: aka.length ? aka : [d.name.trim().split(" ")[0]], ...nums, bday: d.bday || undefined, group: d.group, from: "You added", facts: [], seen: [], fresh: true });
  CT.list.push(n); ctSave(n); CT.adding = false; location.hash = `/${route().ch.slug}/contacts/${n.id}`; note(ic.check, `Added ${n.name}`, `Say “${n.aka[0]}” in any task and ${who(main)} knows who you mean.`, "");
}, true);

// ---------- Apps: the Composio catalog, same popup as 1helm.com's Integrations (rail icon above your profile, ⌘⇧A) ----------
type App = { s: string; n: string; d: string; c: string[]; t: number; o: number; f: number; b?: number; x?: number };
const AS = { split: 0, open: false, all: [] as App[], cat: 0, one: false, q: "", shown: 0, list: [] as App[], busy: "", failed: false };
const ACON: Record<string, boolean> = LIVE ? {} : { gmail: true, googlecalendar: true };
const ACATS: [string, string | null][] = [["All", null], ["Connected", "__c"], ["Popular", "__f"], ["Email", "email"], ["Docs & files", "documents|file management & storage"], ["Design", "images & design"], ["Payments & money", "payment processing|accounting"], ["Shopping", "ecommerce"], ["Social", "social media marketing|social media"], ["Scheduling", "scheduling & booking|calendar"], ["Marketing", "marketing|marketing automation|email newsletters"], ["Team chat", "team collaboration|communication"], ["Tasks", "task management|project management|productivity"], ["CRM", "crm|sales & crm|contact management"]];
const APAGE = 48;
// Only connected apps in the list the Worker serves count: it already leaves out the apps 1Helm hides (proto src/app-visibility.json), whose saved accounts stay in Settings.
const conCount = () => { const ls = new Set(AS.all.map(a => a.s)); return Object.entries(ACON).filter(([slug, on]) => on && (!ls.size || ls.has(slug))).length; };
function syncCon() { if (!LIVE) return; for (const k of Object.keys(ACON)) delete ACON[k];
  for (const a of CX.list || []) if (a.status === "connected" && !a.retired) ACON[a.app] = true; }   // a retired Google Super connection doesn't light up the Google apps
function appAction(a: App) {
  if (ACON[a.s]) return `<button class="apbtn on" data-acon="${a.s}" aria-label="Connected. Manage">${ic.chev}</button>`;
  if (LIVE && a.b) return `<span class="apbtn built">Built in</span>`;
  if (AS.busy === a.s || (LIVE && CX.busy === a.s)) return `<button class="apbtn busy" disabled><i class="apspin"></i><span>Opening</span></button>`;
  if (appIsSoon(a, !!LIVE, !!ACON[a.s])) return `<button class="apbtn soon" data-soon="app-${a.s}">Soon</button>`;
  return `<button class="apbtn" data-acon="${a.s}">${a.o ? "Connect" : "Add key"}</button>`;
}
// "Gmail is Google's email service, featuring spam protection, …" → "Google's email service, featuring spam protection, …": the first
// sentence of Composio's full description (no mid-sentence cut); the row shows one line of it, the app's own page shows it all.
const shortDesc = (a: App) => { let d = (String(a.d || "").match(/^.*?[.!?](?=\s|$)/)?.[0] || String(a.d || "")).replace(/…$/, "").replace(new RegExp(`^(the )?${a.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( app| api| toolkit)?('s)?\\s+(is|are|provides|offers|enables|lets|helps|allows)\\s+(a |an |the )?`, "i"), "").replace(/\.$/, "").trim();
  return d ? d[0].toUpperCase() + d.slice(1) : a.c.join(" · "); };
const appCard = (a: App) => `<div class="apcard${ACON[a.s] ? " on" : ""}" data-adetail="${a.s}">${appLogo(a.s, a.n, "aplogo", 40, true)}
  <div class="aptxt" role="button" tabindex="0" data-adetail-key aria-label="About ${esc(a.n)}"><b>${esc(a.n)}</b><small title="${esc(shortDesc(a))}">${esc(shortDesc(a))}</small></div>
  <div class="aprow">${appAction(a)}</div></div>`;
function appsFilter() {
  const q = AS.q.trim().toLowerCase(), c = ACATS[AS.cat][1];
  AS.list = AS.all.filter(t => !appIsSoon(t, !!LIVE, !!ACON[t.s]) && (!AS.one || t.o) && (!c || (c === "__c" ? ACON[t.s] : c === "__f" ? t.f : c.split("|").some(x => t.c.includes(x)))) && (!q || t.n.toLowerCase().includes(q) || t.s.includes(q) || t.d.toLowerCase().includes(q) || t.c.some(x => x.includes(q))));
  AS.split = 0;
  if (!q && !c && LIVE) { const on = AS.list.filter(t => ACON[t.s]); if (on.length) { AS.list = [...on, ...AS.list.filter(t => !ACON[t.s])]; AS.split = on.length; } }
  if (q) AS.list.sort((a, b) => (+b.n.toLowerCase().startsWith(q) - +a.n.toLowerCase().startsWith(q)) || (+!!b.f - +!!a.f) || b.o - a.o);
  AS.shown = 0; const g = document.getElementById("apgrid"); if (g) g.innerHTML = ""; appsMore(); appsCats();
}
function appsMore() {
  const g = document.getElementById("apgrid"), m = document.getElementById("apmeta"); if (!g || !m) return;
  if (!AS.all.length) { m.textContent = ""; g.innerHTML = AS.failed ? `<div class="apempty">Couldn't load the app list. <button class="apretry" data-aretry>Try again</button></div>` : `<div class="apempty"><i class="apspin"></i> Loading apps…</div>`; return; }
  const start = AS.shown, next = AS.list.slice(start, start + APAGE); AS.shown += next.length;
  const hd = (t: string) => `<div class="aphd">${t}</div>`;
  g.insertAdjacentHTML("beforeend", next.map((a, i) => (AS.split && start + i === 0 ? hd("Connected") : "") + (AS.split && start + i === AS.split ? hd("Available") : "") + appCard(a)).join(""));
  m.textContent = AS.list.length ? `${AS.list.length.toLocaleString()} ${AS.list.length === 1 ? "app" : "apps"}` : "";
  if (!AS.list.length) g.innerHTML = `<div class="apempty">${ACATS[AS.cat][1] === "__c" ? "Nothing connected yet." : `No apps match. Your helper can still use most sites in its own browser.`}</div>`;
}
function appsRefresh() { const g = document.getElementById("apgrid"); if (!g || !AS.open) return; const y = g.scrollTop, n = Math.max(AS.shown, APAGE); appsFilter(); while (AS.shown < Math.min(n, AS.list.length)) appsMore(); g.scrollTop = y; }
function appsCats() { const c = document.getElementById("apcats"); if (!c) return; c.innerHTML = ACATS.map(([n, k], i) => k === "__c" && !conCount() ? "" : `<button class="appill${i === AS.cat ? " on" : ""}" data-acat="${i}">${n}${k === "__c" ? ` · ${conCount()}` : ""}</button>`).join(""); apcatsWatch(c); }
// Category pill row: fade an edge only while there is more to scroll to on that side (fl = left, fr = right).
function apcatsFade(c: HTMLElement) { const max = c.scrollWidth - c.clientWidth, x = Math.abs(c.scrollLeft); c.classList.toggle("fl", max > 2 && x > 2); c.classList.toggle("fr", max > 2 && max - x > 2); }
let apcatsRO: ResizeObserver | null = null;
function apcatsWatch(c: HTMLElement) {
  apcatsFade(c);
  if (c.dataset.fw) return; c.dataset.fw = "1";   // fresh element per openApps(); wire it once
  c.addEventListener("scroll", () => apcatsFade(c), { passive: true });
  if (typeof ResizeObserver !== "undefined") { apcatsRO?.disconnect(); apcatsRO = new ResizeObserver(() => apcatsFade(c)); apcatsRO.observe(c); }
  else window.addEventListener("resize", () => { if (c.isConnected) apcatsFade(c); });
  requestAnimationFrame(() => apcatsFade(c)); document.fonts?.ready.then(() => { if (c.isConnected) apcatsFade(c); });
}
function appsHtml() {
  return `<div class="sback" data-aclose></div><div class="apmodal" role="dialog" aria-modal="true" aria-labelledby="aptitle">
    <div class="aphead"><div><h2 id="aptitle">Apps</h2><p>Connect once. Your helper takes it from there.</p></div><button class="apx" data-aclose aria-label="Close">${g("x", 18)}</button></div>
    <label class="apsearch">${I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 18)}<input id="aq" type="search" placeholder="Search 1,500+ apps" value="${esc(AS.q)}" autocomplete="off" enterkeyhint="search"></label>
    <div class="apfilters"><label class="aptoggle"><input type="checkbox" id="aone"${AS.one ? " checked" : ""}> One-click only</label><div class="apcats" id="apcats"></div></div>
    <div class="apmeta" id="apmeta"></div>
    <div class="apgrid" id="apgrid"></div>
    <p class="apfoot">${ic.key}<span>You sign in on each app's own page. 1Helm never sees those passwords.</span></p></div>`;
}
function appsLoad() {
  AS.failed = false; appsMore();
  fetch(LIVE ? "/app-static/integrations.json" : "/site/integrations.json").then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((d: App[]) => { AS.all = d; if (AS.open) appsFilter(); }).catch(() => { AS.failed = true; if (AS.open) appsMore(); });
}
function openApps(cat = 0) {
  if (!hasFeature("connected_apps")) return;
  closeSettings(); closeMenu(); hideToast();
  let w = document.getElementById("appw"); if (!w) { w = document.createElement("div"); w.id = "appw"; document.body.appendChild(w); }
  AS.open = true; AS.q = ""; AS.cat = cat; AS.one = false; w.innerHTML = appsHtml(); appsCats();
  const gEl = document.getElementById("apgrid")!; gEl.onscroll = () => { if (gEl.scrollHeight - gEl.scrollTop - gEl.clientHeight < 500 && AS.shown < AS.list.length) appsMore(); };
  if (AS.all.length) appsFilter(); else appsLoad();
  if (LIVE) { syncCon(); cxLoad(true); }
  requestAnimationFrame(() => requestAnimationFrame(() => w!.classList.add("on")));
  if (!phone()) setTimeout(() => ($("#aq") as HTMLInputElement | null)?.focus({ preventScroll: true }), 60);
}
function closeApps() { const w = document.getElementById("appw"); AS.open = false; if (!w) return; w.classList.remove("on"); setTimeout(() => { if (!AS.open) w.innerHTML = ""; }, 240); }
document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  if (hasFeature("connected_apps") && t.closest("[data-apps]")) { e.preventDefault(); e.stopPropagation(); openApps(); return; }
  if (!AS.open) return;
  if (t.closest("[data-aclose]")) { closeApps(); return; }
  if (t.closest("[data-aretry]")) { appsLoad(); return; }
  const ct = t.closest<HTMLElement>("[data-acat]"); if (ct) { AS.cat = +ct.dataset.acat!; appsFilter(); document.getElementById("apgrid")!.scrollTop = 0; return; }
  const cn = t.closest<HTMLElement>("[data-acon]"); if (cn) { const k = cn.dataset.acon!, a = AS.all.find(x => x.s === k)!;
    if (LIVE) {
      if (ACON[k]) { closeApps(); openSettings("accounts"); return; }   // disconnecting lives in Settings → Connected accounts
      if (a?.x || a?.b) return;
      appConnect(k, "apps", a?.n); return;
    }
    if (ACON[k]) { ACON[k] = false; appsRefresh(); render(); note(ic.check, `${a.n} disconnected`, `${who(main)} can't use it anymore.`, ""); return; }
    AS.busy = k; appsRefresh();
    setTimeout(() => { AS.busy = ""; ACON[k] = true; appsRefresh(); render(); note(ic.check, `${a.n} connected`, a.o ? `${who(main)} can use it in any project now. Sandbox: no real sign-in happened.` : "Sandbox: in the app you'd paste the key here.", ""); }, 1100); }
}, true);
document.addEventListener("input", e => { const t = e.target as HTMLInputElement; if (t.id === "aq") { AS.q = t.value; appsFilter(); document.getElementById("apgrid")!.scrollTop = 0; } });
document.addEventListener("change", e => { const t = e.target as HTMLInputElement; if (t.id === "aone") { AS.one = t.checked; appsFilter(); } });
window.addEventListener("keydown", e => {
  if (e.key === "Escape" && AS.open) { e.preventDefault(); e.stopImmediatePropagation(); closeApps(); }
}, true);

// Account notes (acct-note.ts): the box saves to the server, which sends the whole list back; Settings keeps it and repaints its list.
if (hasFeature("connected_apps")) initAcctNote({ api: () => LIVE?.api || null, helper: () => who(main) });
if (hasFeature("connected_apps")) amInit({ api: () => LIVE?.api || null, helper: () => who(main), ask, note: (t, sub, good) => note(good ? ic.check : g("help", 14), t, sub, ""), repaint: () => { if (S.open && S.sec === "accounts") sRender(); },
  reloadApps: () => { CX.at = 0; cxLoad(true); }, go: (u) => location.assign(u) });
if (hasFeature("connected_apps")) onAcctNote(cxSet, () => { if (S.open && S.sec === "accounts") cxListPaint(); });
// Tap an app (Apps popup, its search, Settings → Connected accounts) → its own page: full description, what the helper can do, Connect.
if (hasFeature("connected_apps")) initAppDetail({ api: LIVE?.api || null, helper: () => who(main), info: s => AS.all.find(x => x.s === s), connected: s => !!ACON[s], busy: () => !!CX.busy,
  connect: (s, n, another) => appConnect(s, AS.open ? "apps" : "settings", n, cxoFrom(s), !!another), setAccounts: cxSet, manage: () => { closeApps(); openSettings("accounts"); }, computerConnections: () => { closeApps(); openSettings(NETWORK_SEC); }, note: (a, b) => note(g("help", 14), a, b, ""), draft: cxoDraftHtml });
// "Connect YouTube?" cards the helper puts in chat (connect-card.ts), and the app-page link a texted offer carries (?appinfo=).
if (LIVE && hasFeature("connected_apps")) { cxoInit({ api: LIVE.api, helper: slug => { const c = channels.find(x => x.slug === slug); return c ? who(c) : who(main); }, connected: s => !!ACON[s],
  connect: (app, name, offer, another) => appConnect(app, "offer", name, offer, !!another), openDetail: (app, name) => openAppDetail(app, { name }), cards: offerCards,
  repaint: () => { const { ch, s } = route(); if (s) paintChat(s); else repaint(ch); }, note: (a, b) => note(g("help", 14), a, b, "") });
  cxoBoot(app => openAppDetail(app), appDetailRepaint); }


// Opening the app lands inside General (Skipper is the front door). The channel list stays one tap away (back arrow).
if (!/^#\/[^/]+/.test(location.hash)) history.replaceState(null, "", `${location.pathname}${location.search}#/${main.slug}`);
sidebarInit(LIVE?.slug || "sandbox");
render();
if (LIVE) nbSync(main); // one boot read, then reuse the foreground list poll at most once a minute
// Once per device after sign-in: "Let 1Helm use your location and microphone" (devperm.ts). It waits by itself for a calm moment
// (3 s with no input, nothing open, nothing being typed), so it never lands under a tap that's already on its way.
if (LIVE) setTimeout(() => void dpSheetMaybe(() => S.open || AS.open || !!document.querySelector(".dlgw.on")), 0);

