// The only deployment switch for code reserved for the 1HC service.
// Keep route and tool admission here so a public deployment cannot enable a
// feature merely by supplying one of its provider keys.
import { deliverText } from "./texting.js";
import { BeeSync } from "./bee-sync.js";
import { LiveNotes } from "./live-notes.js";
import { Ledger } from "./ledger.js";
export const enabled = (env) => env?.ONEHELM_EE === "1hc";

const FEATURES = Object.freeze(["connected_apps", "ambient", "texting", "smart_routing", "billing"]);
export async function textConnected(env, tenantId) {
  if (!enabled(env)) return false;
  const row = await env.DB.prepare("SELECT status FROM texting WHERE tenant_id=?").bind(tenantId).first().catch(() => null);
  return row?.status === "connected";
}
export const textSend = (env, tenantId, message) => enabled(env) ? deliverText(env, tenantId, message) : Promise.resolve({ ok: false, reason: "disabled" });

const EE_TOOL_NAMES = new Set([
  "app_actions", "app_run", "app_proxy", "app_events", "apps_i_use", "find_app", "offer_connect",
  "gmail_search", "gmail_read", "gmail_draft", "gmail_send", "calendar_events", "calendar_add",
  "search_web_vertical", "note_account", "text_person", "buy_with_link", "check_purchase", "browser_fill_card", "browser_task", "start_browser_task", "list_browser_tasks", "stop_browser_task", "ambient_query",
]);
export const toolEnabled = (env, name) => enabled(env) || !EE_TOOL_NAMES.has(name);

const GLOBAL = [/^\/models(?:\/|$)/, /^\/applogo\//, /^\/c\//, /^\/composio\//, /^\/hooks\/photon\//, /^\/stripe\/webhook$/];
const WORKSPACE = [
  /^\/api\/ambient(?:\/|$)/, /^\/api\/custom-mcp(?:\/|$)/, /^\/custom-mcp(?:\/|$)/, /^\/apps\/paypal\/setup$/,
  /^\/texting$/, /^\/api\/texting(?:\/|$)/, /^\/api\/google(?:\/|$)/,
  /^\/api\/apps(?:\/|$)/, /^\/api\/apps-used$/, /^\/apps\/done$/, /^\/google\/done$/,
  /^\/composio\/connect$/, /^\/api\/connect-offer$/, /^\/api\/meetings\//,
  /^\/api\/bee(?:\/|$)/, /^\/api\/library\/bee(?:\/|$)/, /^\/api\/account\/custom-models(?:\/|$)/, /^\/api\/link(?:\/|$)/, /^\/api\/plan(?:\/|$)/, /^\/api\/portal$/,
  /^\/api\/fix-payment$/, /^\/api\/topup(?:\/confirm)?$/, /^\/api\/storage\/blocks$/, /^\/api\/test\/(?:cancel|pastdue)/,
  /^\/api\/res\/[^/]+\/sessions\/[^/]+\/livenotes(?:\/|$)/,
  /^\/api\/res\/[^/]+\/(?:event-log|event-workflow)$/,
];
const EE_SKILLS = Object.freeze(["gmail", "google-calendar", "google-drive"]);
const EE_CRONS = Object.freeze(["meetings", "bee", "cancel", "pastdue"]);
const EMPTY = Object.freeze({ routes: Object.freeze({ global: [], workspace: [] }), tools: [], crons: [], durableObjects: {}, skills: [], features: [] });
// This is the service registration surface. Public deployments get no EE entries.
export const registry = (env) => enabled(env) ? {
  routes: { global: [...GLOBAL], workspace: [...WORKSPACE] },
  tools: [...EE_TOOL_NAMES], crons: [...EE_CRONS],
  durableObjects: { BeeSync, LiveNotes, Ledger }, skills: [...EE_SKILLS], features: [...FEATURES],
} : EMPTY;
export const features = (env) => registry(env).features;
export const routeEnabled = (env, path, scope = "global") =>
  enabled(env) || !(scope === "workspace" ? WORKSPACE : GLOBAL).some((re) => re.test(path));

// Core-facing EE exports. Runtime admission remains gated by enabled().
export { appDetail } from "./app-detail.js";
export { appEventView, evOf, eventsInit, eventsMix, eventsNext } from "./app-events.js";
export { PAUSE_FACTS, appFirstBlock, callKey, navRepeatPending, repeatBlock, repeatNote, taskWords } from "./appfirst.js";
export { appLogoRoute } from "./applogo.js";
export { APPS_USED_LINE, APPS_USED_TOOL, APP_OPTIONS, NONE, appsUsedApi, appsUsedLine, appsUsedTool, getAppsUsed, optionsView, setAppsUsed, usedSlugs } from "./apps-used.js";
export { BeeSync };
export { beeCron, beeNoteDeleted, beeNoteEdited, beeNoteRestored, beeOps, beePendingFacts, beePendingSpeakers, beeRoute } from "./bee.js";
export { runBrowserTask } from "./browser-agent.js";
export { BUILTIN_APPS, BUILTIN_TEXT, builtinApps } from "./builtin-apps.js";
export { hiddenReason, isHiddenApp, isHiddenToolkitAction, visibleCatalog, connectRefusal } from "./app-visibility.js";
export { cancelApi, cancelCron, cancelSync, cancelWebhook } from "./cancel.js";
export { APP_FILE_MAX } from "./composio-files.js";
export { ENDED_PREFIX, appsMode, appsModeRoute, composioDonePage, endedToolText, isEnded, saveOnboardingChoice, selfAvailable, selfSignOut, selfStatus, signInFinish, signInStart } from "./composio-self.js";
export { ReadBatch, transportFor } from "./composio-transport.js";
export { pacedConnect } from "./connect-pace.js";
export { APP_EVENTS_TOOL, appEventsTool, composioWebhook, eventsReady } from "./composio-triggers.js";
export { APP_TOOLS, GOOGLE_TOOLS, GOOGLE_TOOL_NAMES, RETIRED_APPS, RETIRED_NOTE, SUPER_COVERS, appName, disconnectAllManaged, googleDisconnect, googleStatus, listConnections, managedCount, pickAccount, runAppTool, runGoogleTool, setAccountNote, setDefaultAccount, tidyAfterConnect } from "./composio.js";
export { CONNECT_LINES, CONNECT_TOOLS, appCatalog, catalogFile, composioSigninOffer, connectBlock, connectOfferApi, connectOfferDone, connectOfferInit, connectTool, connectWriteBlock, offerAct, offerCallbackQuery, offerConnected, offerGet, offerRow, offersFlag, offersView, statusFor } from "./connect-offer.js";
export { deciderModel } from "./decider.js";
export { hintNudge, integrationHint } from "./integration-hint.js";
export { clip, leanJSON, readMail } from "./lean.js";
export { Ledger };
export { linkApi, linkCreatePurchase, linkDisconnect, linkGetPurchase, linkListPurchases, linkNoteFill, linkNoteHandoff, linkStartConnect, linkStatus } from "./link.js";
export { lnAudio } from "./live-mic.js";
export { LiveNotes };
export { lnName, lnResidentMethods } from "./live-notes.js";
export { meetingsApi, meetingsCron } from "./meetings.js";
export { holdFromFailure, holdOf, holdView, notePaid, pastdueApi, pastdueCron, pastdueSeen, pastdueSync } from "./pastdue.js";
export { US_ONLY } from "./photon.js";
export { changePlan, nextPlan } from "./plan-change.js";
export { MAX_ATTEMPTS } from "./pool.js";
export { INACTIVE_MSG, PAUSED_TEXT, PAY_MSG } from "./readonly.js";
export { HANDOFF_PREFIX, choreRouteFor, dispatchOrder, isHandoff, markServed, policyRoute, routeTwoTurn } from "./route2.js";
export { ledgerGuard } from "./spendguard-ledger.js";
export { appLink, deliverCard, deliverReaction, deliverText, fetchTextedFile, textTyping, textingDebug, textingLine, textingNewCode, textingOff, textingPoll, textingStart, textingStatus, textingUseProject, textingWebhook } from "./texting.js";
export { VERTICAL_SEARCH_TOOL, VS_NANO, VS_TOOL_NAME, loopWords, searchNote, verticalSearch } from "./vertical-search.js";

export { ambientSettingsRoute } from "./ambient-settings.js";

export { paypalSetupRoute } from "./composio-paypal.js";

export { modelsRoute } from "./models-console.js";

export { customMcpRoute, isCustomSlug, customUsable, ownerOf, CUSTOM_DENIED, withCustomRows, CUSTOM_WORDS } from "./custom-mcp.js";

export { ambientQuery, addLocalTimes, tzOf, AMBIENT_QUERY_TOOL } from "./ambient-query.js";

export { customView, readCustom, saveCustom, pickerModels, statusOfRow, ownChorePlan } from "./custom-models.js";
export { ownKeyKind, ownKindForStatus, ownViewFor, ownPicker, saveOwn, byokRouteTurn, planForCall, byokChatChain } from "./byok-custom.js";
export { beeLibraryRoute } from "./bee-library.js";
export { modelSettingsEnv, readModelSettings, jobModel, jobModels, jobCost, modelFacts } from "./model-settings.js";
export { MOONDREAM } from "./model-seed.js";
export { dailyBillingFlag, flagTurns, FLAG_MIN_CHARGE } from "./billing-flag.js";
export { CHAT_JOB, categoryLimits, choreRouteOf, jobLimits, jobRoute, jobSetting, settingsOf, entriesOf, configuredHosts, quirkOf, effortBody, effortFor, reasoningMandatory } from "./model-jobs.js";
export { askDecider } from "./text-decision.js";
export { limitsFor, jobTimeoutFor } from "./limits-read.js";
export { holdOutNano, plannedChatHoldNano, plannedChatMaxOutput, plannedHold, plannedHoldNano, plannedMaxOutput } from "./job-limits.js";
export { dispatch, liveProviderRequest, plan } from "./model-dispatch.js";
export { dispatchMedia, firstStep, jobReserveNano, stepsOf } from "./media-job.js";
export { speakerJobReady, speakerRate, speakerReserve, diarize, mapSpeakerIds, speakerForSpan, defaultLabel, SPEAKER_MARKUP } from "./speaker-labels.js";   // speaker labels for audio and video files (the file prep in sidecar.js); the licensed Live notes module imports its own
export { browserJobsInit, browserTaskInput, browserTaskWaitMs, browserTaskMovedText, LIST_BROWSER_JOBS_TOOL, STOP_BROWSER_JOB_TOOL, START_BROWSER_JOB_TOOL, BROWSER_JOB_DEADLINE_MS, BROWSER_JOB_LEASE_MS, BROWSER_JOB_RELEASE_GRACE_MS, browserJobRow, activeBrowserJob, pendingBrowserHandoffs, browserJobNextWake, browserJobView, browserJobStartedText, browserJobNote, browserJobHandoff, browserJobInput, browserPurchaseGuard, buyControlTargeted } from "./browser-tasks.js";

export { effectiveTaskCatalog } from "./model-catalog.js";
export { usesAppendRuntime, authorizeTaskProfile, TaskAffinityBlocked, ensureTaskRuntime, recordTaskServed, bindTaskProfile, bindBackgroundRuntime } from "./task-profile.js";
export { backgroundRole, backgroundPolicy, backgroundReserve } from "./background-policy.js";
export { deliverNativeFallback, dropNativePolls, nativePollDelivered, nativePollInit, nativeVoteNext, receiveNativeVote, recoverNativeSends, recoverNativeVotes, sendNativePoll } from "./native-polls.js";
export { DONE_TOOL, ORCHESTRATOR_TOOLS, REQUEST_INPUT_TOOL, WORKER_REQUEST_TOOLS, lineRange, orchestrationPolicy, routingToolsAllowed, stepLog, storedMessages } from "./orchestrator.js";
export { deliverPhoneFiles, dropPhoneFiles, phoneFilesInit, phoneFilesNext, queuePhoneFiles } from "./phone-files.js";
export { dropPhotonReplies, photonAnswerOptions, photonMessage, photonReplyInit, photonReplyOptions, photonReplySource, photonSourceInput, recordPhotonReplySource } from "./photon-replies.js";
export { AGENT_MEMORY_TOOLS, agentMemoryNextWake, agentSessionDocuments, forgetAgentBank, agentSessionInventory, flushAgentMemory, purgeAgentSession, readAgentDocument, retainAgentMessage, retainAgentRound, searchAgentBank } from "./routing-agent-memory.js";
export { ROUTING_FILE_TOOLS, approveRoutingFiles, collectRoutingFiles, discardRoutingFiles, dropRoutingArtifacts, initRoutingArtifacts, isRoutingImageError, routingArtifactKeys, routingFileTool, routingImageFallback, stageRoutingFile } from "./routing-artifacts.js";
export { dynamicRoutingOn } from "./routing-config.js";
