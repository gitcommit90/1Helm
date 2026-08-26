import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const app = await readFile(resolve(root, "src/client/app.ts"), "utf8");
const styles = await readFile(resolve(root, "src/client/styles.css"), "utf8");
const settings = await readFile(resolve(root, "src/client/settings.ts"), "utf8");
const routing = await readFile(resolve(root, "src/client/routing.ts"), "utf8");
const desktop = await readFile(resolve(root, "desktop/main.cjs"), "utf8");
const server = await readFile(resolve(root, "src/server/index.ts"), "utf8");
const http = await readFile(resolve(root, "src/server/http.ts"), "utf8");
const serviceWorker = await readFile(resolve(root, "public/sw.js"), "utf8");

test("workspace sidebar interactions have durable, member-scoped contracts", () => {
  assert.match(app, /data(?:set)?:? \{ sidebarFavorites: "" \}/, "favorites have their own sidebar section");
  assert.match(app, /\/api\/channels\/\$\{channel\.id\}\/favorite/, "the current channel favorite action calls its typed integration endpoint");
  assert.match(app, /"\/api\/human-channels"/, "human-only channel creation uses its dedicated endpoint");
  assert.match(app, /group_unread_channels_first/, "the sidebar loads the per-user unread grouping preference");
  assert.match(app, /desktop_sidebar_collapsed/, "desktop sidebar collapse is a profile-bound UI preference");
  assert.match(app, /dataset: \{ sidebar: drawer \? "mobile" : "desktop", sidebarCollapsed: collapsed \? "true" : "false" \}/, "desktop collapse state is visible for behavioral and accessibility checks");
  assert.match(app, /class: "mobile-menu-button grid h-11 w-11[^\n]+"/, "every channel header renders the navigation button");
  assert.doesNotMatch(app, /mobile-menu-button[^\n]+(?:sm|md|lg|xl|2xl):hidden/, "no viewport is allowed to hide the channel navigation button");
  assert.match(app, /id: "mobile-navigation", class: "fixed inset-0 z-40"/, "the navigation drawer can open at every viewport size");
  assert.match(app, /app-topbar flex min-h-12 flex-col items-stretch[^\n]+md:flex-row md:items-center md:gap-3/, "the channel header stays stacked through the 640–767px tablet gap so its title and hamburger cannot be squeezed out");
  assert.doesNotMatch(app, /app-topbar flex min-h-12 flex-col[^\n]+sm:flex-row/, "the channel header never enters its single-row layout at 640px");
  assert.match(app, /workspace-sidebar hidden[^\n]+md:flex/, "the standard persistent-sidebar breakpoint remains intact");
  assert.match(styles, /@media \(min-width: 768px\) and \(max-width: 1199px\) and \(orientation: portrait\)[\s\S]*\.workspace-sidebar\[data-sidebar="desktop"\] \{ display: none !important; \}/, "tablet portrait uses the drawer while tablet landscape retains the sidebar");
  assert.match(app, /matchMedia\("\(min-width: 1200px\), \(\(min-width: 768px\) and \(orientation: landscape\)\)"\)/, "rotation into the persistent-sidebar layout closes the tablet drawer");
  assert.match(app, /title: "Expand navigation"[\s\S]*title: "Collapse navigation"/, "the compact desktop rail always retains an explicit expand control");
  assert.match(settings, /key: "group_unread_channels_first"/, "the setting persists through user UI state");
  assert.match(app, /const members = Array\.isArray\(channel\?\.members\) \? channel\.members : \[\]/, "human suggestions come only from current-channel members");
  assert.match(app, /function composerAgentCandidates\(\): Bot\[\] \{[\s\S]*?S\.channelBots\.find\(\(bot\) => bot\.id === agentBotId\)[\s\S]*?S\.bots\.find\(\(bot\) => bot\.id === agentBotId\)[\s\S]*?list\.findIndex\(\(other\) => other\?\.id === bot\.id\) === index/, "agent channels suggest their resident before Skipper, deduped when the resident is Skipper");
  assert.match(app, /const agentCandidates = composerAgentCandidates\(\);/, "the composer resolves agent suggestions through the channel-anchored candidate helper");
  assert.match(app, /k\.key === "Tab"[\s\S]*!input\.value\.trim\(\)[\s\S]*`@\$\{channel\.agent\.name\} `/, "Tab in an empty agent composer inserts the resident mention");
});

test("speech-to-text is explicit, graceful, and combination-safe", () => {
  assert.ok(http.includes('"permissions-policy": "camera=(), microphone=(self), geolocation=(), unload=(self)"'), "the web control plane permits first-party microphone access for explicit dictation");
  assert.match(app, /SpeechRecognition\?[^\n]+webkitSpeechRecognition/, "standard and prefixed browser recognition are supported");
  assert.match(app, /dataset: \{ speechToggle: "" \}/, "the composer exposes an explicit mic control");
  assert.match(app, /export function mountSpeechToTextControl/, "other text surfaces reuse the same dictation control and shortcut behavior");
  assert.match(app, /data(?:set)?: \{ listeningIndicator: "" \}/, "dictation exposes a subtle global listening indicator");
  assert.match(app, /Speech-to-text is not available in this browser/, "unsupported browsers get a useful explanation");
  assert.match(app, /event\.key === "Alt" && !event\.repeat && !event\.ctrlKey && !event\.metaKey && !event\.shiftKey/, "only a bare Option\/Alt keydown starts tap detection");
  assert.match(app, /if \(altTapOnly\) \{ altTapOnly = false; clearAltTapFallback\(\); \}/, "any combined keystroke cancels the single-tap shortcut and its swallowed-keyup fallback");
  assert.match(app, /toggleSpeechToText\(input, focused\?\.button \|\| undefined\)/, "the bare Option\/Alt shortcut carries Cowork's explicit mic button into speech recognition");
  assert.match(desktop, /permission !== "media"/, "the native shell keeps non-media permission requests denied");
  assert.match(desktop, /mediaTypes\.includes\("audio"\) && !mediaTypes\.includes\("video"\)/, "the native permission exception is microphone-only");
  assert.match(desktop, /askForMediaAccess\("microphone"\)/, "macOS uses its native microphone approval flow");
});

test("profile, naming, routing, and usage language match the visible product contract", () => {
  assert.match(app, /dataset: \{ profilePhotoCrop: "" \}/, "profile photos expose a crop preview");
  assert.match(app, /output\.width = 512; output\.height = 512/, "saved profile photos are rendered square client-side");
  assert.match(app, /toBlob\(resolve, "image\/jpeg", 0\.86\)/, "the square avatar is compressed before upload");
  assert.match(app, /Photo ready\. Adjust the crop, then choose Save profile\./, "file choice does not instantly upload the raw photo");
  assert.match(settings, /maxlength: 100/, "workspace naming allows and caps a generous 100 characters");
  assert.match(settings, /fetch\(apiUrl\("\/api\/workspace\/photo"\)[\s\S]{0,300}URL\.createObjectURL\(await response\.blob\(\)\)/, "workspace photo updates fetch the fixed authenticated asset and expose only a browser-created blob URL to the DOM");
  assert.equal([...settings.matchAll(/workspacePhotoSrc\(S\.workspace\.photo_url, Date\.now\(\)\)/g)].length, 1, "only the already-loaded workspace value may initialize the preview; update responses never become image destinations");
  assert.match(app, /dataset: \{ workspaceName: "" \}/, "the complete workspace name has a stable wrapping hook");
  assert.match(settings, /Connection availability/, "connections use direct availability wording");
  assert.doesNotMatch(settings, /More connections/, "the ambiguous connections heading is gone");
  assert.match(app, /openRoutingPopoverLazy\(event\)/, "the router-symbol header action lazily opens live routing activity");
  assert.match(routing, /popover\.append\(content\)/, "the live routing popover mounts its rendered content");
  assert.match(app, /Cumulative provider-reported usage across repeated model calls/, "thread token totals are labeled as actual cumulative usage");
  assert.doesNotMatch(app, /`Ctx /, "usage is not presented as context-window capacity");
});

test("service-worker updates never reload an active editor or conversation", () => {
  assert.doesNotMatch(app, /controllerchange[\s\S]{0,300}location\.reload\(/, "service-worker takeover must not reload a live draft");
  assert.match(app, /destroy an editor draft/, "the no-reload update contract is documented at the decision point");
  assert.match(serviceWorker, /new Response\("1Helm is offline\.", \{ status: 503/, "offline navigation always resolves to a valid Response");
  assert.match(serviceWorker, /catch\(\(\) => cached \|\| Response\.error\(\)\)/, "an uncached failed asset request never resolves FetchEvent with undefined");
});

test("Texts routes fail closed outside the Captain's private #main", () => {
  assert.match(app, /function textsAvailable\(channel\?: Channel\): boolean \{[\s\S]*S\.me\.is_admin[\s\S]*S\.photonConfigured[\s\S]*channel\.name === "main"[\s\S]*channel\.personal_main/, "Texts eligibility is centralized on the Captain's configured private #main");
  assert.match(app, /if \(view === "texts" && !textsAvailable\(requestedChannel\)\) view = "chat";/, "direct Texts URLs fall back to chat outside private #main");
  assert.match(app, /if \(view === "texts" && !textsAvailable\(S\.channels\.find/, "programmatic Texts navigation uses the same guard");
});
