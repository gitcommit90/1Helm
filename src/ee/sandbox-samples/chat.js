// Sandbox samples for the chat categories and the background chat jobs (the Models page, Sandbox view).
// Each sample builds the request its job sends to its model, by calling the same builder functions the job calls, with invented inputs.
// A change to a prompt or a tool list in the real code shows up here with no other edit, and no prompt text is copied into this file.
// Wherever the real job puts file bytes, the request holds a placeholder { "$file": name, "as": "data_url" } that the Sandbox fills in.
// Nothing here calls a model, reads an account or touches the network, except that the design tool list is fetched once when it isn't cached yet, as the chat does.
import { CATEGORIES } from "../pool.js";
import { enabled as eeEnabled } from "../index.js";   // the public edition's Cloud switch: the same prompt flags the real chat gets
import { contextV2, contextMessages } from "../../context.js";
import { cutLazy } from "../../payload-cut.js";
import { genuiEnvOn } from "../../genui.js";
import { sidecarOn, cardRequest, CARD_SCHEMA } from "../../sidecar.js";
import { kindOf, sectionsOf } from "../../sidecar-convert.js";
import { channelSkillsLine } from "../../skills/channel.js";
import { prepareDesignTools } from "../../design-tools.js";
import { placeLine, tzLabel } from "../../location.js";
import { dynamicRoutingOn } from "../routing-config.js";
import { plannedMaxOutput } from "../job-limits.js";
import { structuredFormat, structuredBody } from "../../structured-output.js";
import { jevState, jevBody } from "../route2.js";
import { buildMenu, browserDeciderState, browserNextQuestion, browserValuesMessages, browserOssRequest, BROWSER_VALUES_SCHEMA } from "../browser-agent.js";
import { labelRequest, labelSchema } from "../../tracker.js";
import { chatTitleRequest } from "../../chat-titles.js";
import { HANDOFF_PROMPT, HANDOFF_SCHEMA, chatPromptFlags, chatPinned, recentChannelLines, chatChannelOptions, composeSystemPrompt, chatBaseTools, availableChatTools, modelChatTools, currentTimeTag, chatUserText, chatTurnContext, taskDeveloperText, attachmentNote } from "../../resident.js";
import { noteMessages, finalMessages, refineMessages, notesRequest, noteWindow, noteDepth, finalDepth, tline, parseSection, renderSection, sessionHeading } from "../live-notes.js";
import { ambientExtractMessages, ambientReviewMessages, ambientRequest, ambientLines, validateAmbient } from "../ambient.js";
import { ambientReviewInput } from "../ambient-review.js";
import { AMBIENT_EXTRACT_SCHEMA, AMBIENT_REVIEW_SCHEMA } from "../../background-schemas.js";

const FIXTURE_DIR = "/app-static/sandbox/";
const file = (name, type) => ({ name, type, path: FIXTURE_DIR + name });
const PHOTO = file("sample-photo.jpg", "image/jpeg");

// The saved settings are the only place a model setting is read from, so a builder that reads them sees the Sandbox's copy.
const withSettings = (env, ctx) => ctx?.settings ? Object.assign(Object.create(env || {}), { MODEL_SETTINGS: ctx.settings }) : (env || {});
const maxOut = async (env, job) => (await plannedMaxOutput(env, job).catch(() => null)) ?? undefined;
const NOW = (ctx) => Number(ctx?.now) || Date.now();
const TZ = "America/Los_Angeles";

// ---------- invented person, channel and day (nothing from a real account) ----------
const DAY = 24 * 3600e3;
const PROFILE = { first_name: "Maya", helper_name: "Juniper", helper_tone: 1 };
const CHANNEL = { name: "General", purpose: "" };
const NOTEBOOK = (now) => [
  { id: "n1", content: "I'm Maya Okafor. I live in Portland with my husband Daniel and our daughter Zoe, who is 7.", author_type: "human", src: "notebook", sec: "profile", kind: "fact", status: "active", created: now - 90 * DAY },
  { id: "n2", content: "Keep replies short and plain. Ask me before sending any email or text for me.", author_type: "human", src: "notebook", sec: "how", kind: "preference", status: "active", created: now - 60 * DAY },
  { id: "n3", content: "When I ask for a reminder without a time, use 9 AM the day before.", author_type: "human", src: "notebook", sec: "how", kind: "preference", status: "active", created: now - 45 * DAY },
  { id: "n4", content: "Dr. Patel is our dentist. Zoe's checkup is on the first Thursday of each quarter.", author_type: "human", src: "notebook", sec: "people", kind: "fact", status: "active", created: now - 30 * DAY },
  { id: "n5", content: "Weekly groceries come from the Hawthorne market on Saturday mornings. Daniel is allergic to shellfish.", author_type: "human", src: "notebook", sec: "household", kind: "fact", status: "active", created: now - 12 * DAY },
  { id: "n6", content: "Work: product manager at Brightwell Labs. Weekly 1:1 with my manager Priya Raman on Wednesdays at 2 PM.", author_type: "human", src: "notebook", sec: "work", kind: "fact", status: "active", created: now - 8 * DAY },
];
const PROFILE_TEXT = "Maya Okafor is a product manager at Brightwell Labs who lives in Portland with her husband Daniel and daughter Zoe. She likes short, plain replies and wants to approve anything sent in her name. Her week: a 1:1 with Priya Raman on Wednesdays at 2 PM, groceries at the Hawthorne market on Saturdays, and a dental checkup for Zoe with Dr. Patel each quarter.";
const MESSAGES = (now) => [
  { created: now - 3 * DAY, body: "Can you add milk, eggs, oat flour and lemons to the grocery list?", bot_id: "None" },
  { created: now - 3 * DAY + 60e3, body: "Added all four to your grocery list for Saturday.", bot_id: "helper" },
  { created: now - 2 * DAY, body: "Draft a reply to Priya about moving our 1:1 to Thursday.", bot_id: "None" },
  { created: now - 2 * DAY + 90e3, body: "Here is a draft: \"Hi Priya, could we move Wednesday's 1:1 to Thursday at 2 PM? Thanks, Maya.\" Want me to send it?", bot_id: "helper" },
  { created: now - 2 * DAY + 200e3, body: "Yes, send it.", bot_id: "None" },
  { created: now - 1 * DAY, body: "What time is Zoe's dentist appointment?", bot_id: "None" },
  { created: now - 1 * DAY + 30e3, body: "Thursday at 3:30 PM with Dr. Patel. I set a reminder for 9 AM that morning.", bot_id: "helper" },
];
const ASKED = "Here's a photo of the pharmacy receipt from today. Can you add it to my expenses and remind me to send it to the insurance company?";
const PHOTO_BYTES = 184320;

// The flags the chat reads at the start of a turn, taken from the environment exactly as the Durable Object takes them.
function chatSetup(env) {
  const mmode = ["off", "shadow", "on"].includes(env.MEMORY) ? env.MEMORY : "off";
  const layered = contextV2(env);
  const appendRuntime = env.APPEND_TASK_RUNTIME === "on" && !env.BYOK;   // a new task starts on the append lane when this is on
  const appendLazy = appendRuntime && cutLazy(env) && layered;
  return { mmode, layered, appendRuntime, appendLazy, cards: genuiEnvOn(env), browser: env.BROWSER_AGENT === "jev", workmem: env.WORKMEM === "on" };
}

// The whole chat request for a General channel: the system prompt (core, developer rules, standing data with the pinned notes, the
// "how to work with you" notes, the profile and the recent channel messages), the turn's data, the person's message with a picture, and the tools.
export async function chatRequestFor(env, ctx = {}) {
  const e = withSettings(env, ctx), now = NOW(ctx), c = chatSetup(e);
  await prepareDesignTools(e).catch(() => {});   // the design servers' tool names, cached like the chat does before it lists tools
  const pinned = chatPinned(e, NOTEBOOK(now), c.mmode), useOn = pinned.useOn;
  const channelOptions = chatChannelOptions({ ee: eeEnabled(e), profile: PROFILE, tz: TZ, channel: "main", ch: CHANNEL, mmode: c.mmode, mem: pinned.text, recent: recentChannelLines(MESSAGES(now)),
    memoryProfile: useOn ? PROFILE_TEXT : "", keysLine: "", loginsLine: "Saved logins (browser_fill_login types them; you never see the passwords): hawthornemarket.example, brightwell-benefits.example.",
    skillsLine: channelSkillsLine([]), appsLine: "", textingLine: "", permLine: "" });
  const prompt = composeSystemPrompt(e, { flagOpts: { browser: c.browser, mode: c.mmode, betterDesign: false }, stable: true, cards: c.cards, layered: c.layered, append: c.appendRuntime, channelOptions });
  const att = [{ name: PHOTO.name, mime: PHOTO.type, bytes: PHOTO_BYTES }], pic = { type: "image_url", image_url: { url: { $file: PHOTO.name, as: "data_url" } } };
  const attNote = attachmentNote({ att, pics: [pic], sc: { got: [], saved: "", body: "" }, unseen: [], extra: 0 });
  const nowTag = currentTimeTag(now, TZ);
  const placeNote = `\n\n${placeLine({ device: { at: now - 5 * 60e3, place: "Portland, Oregon", lat: 45.52, lng: -122.68 }, tz: TZ, tzKnown: true, tzLabel: tzLabel(TZ), now, cards: c.cards }).line}`;
  const tc = { kind: "chat", appendRuntime: c.appendRuntime, appendLazy: c.appendLazy, context: c.layered ? { version: 2 } : null };
  const tools = modelChatTools(e, availableChatTools(e, chatBaseTools(e, { workmem: c.workmem, browser: c.browser, betterDesign: false, general: true, sidecars: sidecarOn(e) ? undefined : false }), () => "main", tc), tc);
  let messages;
  if (c.layered) {
    const context = { version: 2, ...prompt, developer: taskDeveloperText(prompt.developer, { appendRuntime: c.appendRuntime, appendLazy: c.appendLazy }), userText: ASKED,
      modelUserText: chatUserText({ asked: ASKED, attNote, nowTag, placeNote }), turn: chatTurnContext({ nowTag, placeNote, attNote }) };
    const userMsg = { role: "user", content: [{ type: "text", text: context.modelUserText }, pic] };
    messages = contextMessages([{ role: "system", content: context.core }, userMsg], context);
  } else {
    messages = [{ role: "system", content: prompt }, { role: "user", content: [{ type: "text", text: chatUserText({ asked: ASKED, attNote, nowTag, placeNote }) }, pic] }];
  }
  return { messages, tools, stream: true };
}
const chatBuild = async (env, ctx) => ({ request: await chatRequestFor(env, ctx), files: [PHOTO] });

// The turn so far that the hand-off notes are written from: the chat request plus the work the helper did and its reply.
async function handoffRequest(env, ctx) {
  const { messages } = await chatRequestFor(env, ctx);
  const work = [
    { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "remember", arguments: JSON.stringify({ step_title: "Saved the pharmacy receipt to expenses", fact: "Pharmacy receipt, $42.18, paid today with Maya's Visa ending 4417. Keep for the insurance claim." }) } }] },
    { role: "tool", tool_call_id: "call_1", content: "Saved to your Notebook under expenses." },
    { role: "assistant", content: "I added the pharmacy receipt ($42.18) to your expenses and set a reminder for tomorrow at 9 AM to send it to the insurance company. I did not send anything yet." },
  ];
  return { messages: [...messages, ...work, { role: "user", content: HANDOFF_PROMPT }], response_format: structuredFormat("handoff_notes", HANDOFF_SCHEMA), stream: true };
}

// The request sorter's trap: the new message is about insurance and dentists, which are also the words of both open sub-agent jobs, but it asks for something new
// (a different dentist), so it follows up on neither job and the right answer to the steer question is "none".
const DECIDER_TEXT = "Also, can you find another dentist near Hawthorne that takes our insurance and compare their prices?";
const OPEN_SUBAGENTS = [{ id: 3, name: "Insurance claim", task: "Collect the pharmacy receipt and prepare the claim form" },
  { id: 4, name: "Dental estimate", task: "Read Zoe's dental treatment estimate and list what the insurance covers and what we pay" }];
async function deciderRequest(env, ctx) {
  const e = withSettings(env, ctx), hist = [
    { role: "user", content: "Add milk, eggs, oat flour and lemons to the grocery list." }, { role: "assistant", content: "Added all four to your grocery list for Saturday." },
    { role: "user", content: "Draft a reply to Priya about moving our 1:1 to Thursday." }, { role: "assistant", content: "Here is a draft. Want me to send it?" }];
  const state = { ...jevState({ hist, text: DECIDER_TEXT, prevTools: 1, openWork: [], prevCategory: null }),
    ...(dynamicRoutingOn(e) ? { open_subagents: OPEN_SUBAGENTS } : {}) };
  return jevBody(state, e);
}

const OUTLINE = `Page: Hawthorne Family Dental, new patient form
[e1] link "Home"
[e2] link "Insurance"
[e3] heading "New patient form"
[e4] text input "Full name"
[e5] email input "Email address"
[e6] tel input "Phone number"
[e7] select "Preferred day" options: Monday | Tuesday | Wednesday | Thursday | Friday
[e8] checkbox "I have dental insurance" (unchecked)
[e9] button "Submit request"
[e10] button "Call the office"`;
const BROWSER_TASK = "Fill in the new patient form at Hawthorne Family Dental for Maya Okafor, maya.okafor@example.com, 503-555-0142, preferred day Thursday, and tell me what the page says after you submit it.";
// The step the browser decider is asked about: the name, email and phone are typed already, so the one right move is the day (Thursday). The menu also offers
// the insurance checkbox and the Submit button, which look like the next thing to do but are too early or not asked for, and typing the same details into other fields.
const BROWSER_VALUES = ["Maya Okafor", "maya.okafor@example.com", "503-555-0142"];
const BROWSER_HIST = ["Typed \"Maya Okafor\" into the Full name field → done", "Typed \"maya.okafor@example.com\" into the Email address field → done", "Typed \"503-555-0142\" into the Phone number field → done"];
const BROWSER_MENU = () => buildMenu(OUTLINE, BROWSER_VALUES, new Set()).menu;
const BROWSER_NEXT = 'Choose "Thursday" in dropdown "Preferred day"';
function browserDeciderRequest() {
  return { state: browserDeciderState({ task: BROWSER_TASK, url: "https://hawthorne-dental.example/new-patient", hist: BROWSER_HIST, outline: OUTLINE }), questions: browserNextQuestion(BROWSER_MENU()) };
}
// The id of the menu line that is the right next step (the menu numbers its lines in page order, so the id is read from the menu, not typed here).
const browserNextId = () => Object.entries(BROWSER_MENU()).find(([, label]) => label === BROWSER_NEXT)?.[0];
async function browserRequest(env, ctx) {
  const e = withSettings(env, ctx);
  return structuredBody(browserOssRequest(browserValuesMessages(BROWSER_TASK), await maxOut(e, "browser")), "browser_values", BROWSER_VALUES_SCHEMA);
}

// The first message of a new chat, an invented one, as the chat_title job receives it.
async function chatTitleRequestFor(env, ctx) {
  const e = withSettings(env, ctx);
  return { ...chatTitleRequest("Can you help me plan a small vegetable garden for a sunny balcony? I only have about two square metres.", await maxOut(e, "chat_title")), stream: false };
}
async function labelRequestFor(env, ctx) {
  const e = withSettings(env, ctx), at = NOW(ctx) - 600e3;
  const input = { card: "c1", kind: "chat", title: "New task", name: null,
    msgs: [{ seq: 1, at, text: ASKED }],
    steps: [{ seq: 2, tool: "remember", title: "Saved the pharmacy receipt to expenses", status: "ok", exit: null, ms: 420, out: "Saved to your Notebook under expenses." },
      { seq: 3, tool: "schedule_followup", title: "Set a reminder to send the receipt to insurance", status: "ok", exit: null, ms: 610, out: "Reminder set for tomorrow at 9:00 AM." }],
    handoffs: [], reply: "I added the pharmacy receipt ($42.18) to your expenses and set a reminder for tomorrow at 9 AM to send it to the insurance company.", error: null };
  return structuredBody(labelRequest(input, await maxOut(e, "label")), "task_labels", labelSchema(input));
}

// A short Bee conversation: a budget check-in between Maya and Priya. The last two lines carry the traps the live notes and the final notes have to get right: the
// pricing call moves from Tuesday to Wednesday (so the action's due day changes), and an open question is settled the other way from how it was left (so the
// question goes and a decision is added).
const MEETING = [
  ["Maya", "Okay, let's start with the Q4 budget. We're at 71 percent spent with six weeks left."],
  ["Priya", "That's fine for now. The one risk is the user research contract, it renews on November 3rd and it's quoted at 18,400 dollars."],
  ["Maya", "I'd like to renegotiate it. Can you get me the old invoice so I can compare?"],
  ["Priya", "Yes, I'll send it by Friday. Do we also want to keep the two extra interview slots?"],
  ["Maya", "Let's decide that after the pricing call. I'll book it for Tuesday."],
  ["Priya", "One more thing, the new hire starts on the 14th and needs a laptop. Who is ordering it?"],
  ["Maya", "I'll ask Daniel in IT today."],
  ["Priya", "Hold on, I'm out on Tuesday. Can we do the pricing call on Wednesday instead?"],
  ["Maya", "Wednesday works, I'll book it for Wednesday. And the budget is too tight, so let's drop the two extra interview slots, that's decided."],
];
function meetingParts(now) {
  const started = now - 42 * 60e3, ended = now - 2 * 60e3, utts = MEETING.map(([speaker, text], i) => ({ at: started + i * 5 * 60e3, speaker, text }));
  return { s: { source: "bee", started_at: started, ended_at: ended, prev: "" }, started, ended, lines: utts.map((u) => tline(u, started, false)) };
}
// The notes as they stand after the first seven lines: the pricing call is still set for Tuesday and the interview slots are still an open question.
const SECTION = (heading) => renderSection(parseSection(`${heading}
Maya and Priya review the Q4 budget, which is 71 percent spent, and the renewal of the user research contract.

### Decisions
- Renegotiate the user research contract before it renews on November 3rd.
### Action items
- [ ] Send the old research invoice to Maya — owner: Priya, due: Friday
- [ ] Book the pricing call — owner: Maya, due: Tuesday
- [ ] Ask Daniel in IT to order the new hire's laptop — owner: Maya, due: today
### Open questions
- Keep the two extra interview slots?
### Notes
- The budget is 71 percent spent with six weeks left.`), { live: true });
async function notesRequestFor(kind, env, ctx) {
  const e = withSettings(env, ctx), now = NOW(ctx), m = meetingParts(now), job = kind === "note" ? "notes" : kind === "final" ? "notes_final" : "notes_refine";
  const tz = TZ, heading = sessionHeading(1, m.started, m.ended, tz), cur = SECTION(heading), human = [];
  const text = m.lines.join("\n"), maxTokens = await maxOut(e, job);
  if (kind === "note") {
    const win = noteWindow(m.lines.slice(0, -2), m.lines.length - 2), depth = noteDepth(now - m.started);
    return notesRequest("note", noteMessages({ s: m.s, n: 1, win, lines: m.lines.slice(-2), depth, sec: cur }), maxTokens);
  }
  const depth = finalDepth(text, m.ended - m.started);
  const args = { s: m.s, title: "Q4 budget check-in", tz, cur, human, depth, text };
  return notesRequest(kind, kind === "final" ? finalMessages(args) : refineMessages(args), maxTokens);
}

async function sidecarRequest(env, ctx) {
  const name = "sample-doc.pdf";
  const md = `[Page 1]\n# Dental treatment estimate\n\nPatient: Zoe Okafor, age 7. Provider: Dr. Anita Patel, Hawthorne Family Dental. Date of estimate: October 2, 2026.\n\n## Recommended work\n- Two fluoride sealants on the lower molars, $64 each\n- Routine cleaning and exam, $118\n\n[Page 2]\n## Cost and insurance\nTotal estimate: $246. Insurance (Brightwell Benefits plan) is expected to cover $184. The patient pays $62 at the visit. The estimate is valid until December 31, 2026.\n\nTo schedule, call 503-555-0188.`;
  const job = { name, bytes: 48213, mime: "application/pdf" }, kind = kindOf(name, job.mime);
  return structuredBody(cardRequest(job, kind, md, sectionsOf(md)), "file_card", CARD_SCHEMA);
}

// One conversation for both Ambient jobs. The lines that are not plain intentions, in order: 5 is a TV advertisement (an unknown voice, and line 6 says it is the TV),
// 7 is Daniel showing Maya how to talk to the helper (an example, "say we needed..."), 8 is a thought that stops half way, 9 reports a bill already paid (it closes the
// task from line 4), and 10 changes the plan from line 2 (Saturday becomes Sunday).
export const AMBIENT_LINES = [
  ["Maya", "I really need to call the pharmacy about Zoe's refill before they close."],
  ["Daniel", "Did you book the dentist? Thursday at three thirty works for me."],
  ["Maya", "Yes it's booked. Oh, and remind me to buy lemons on Saturday for the cake."],
  ["Daniel", "On the radio they said it might rain all weekend, so maybe we skip the market."],
  ["Maya", "I have to pay the water bill by Friday."],
  ["Speaker 3", "Order in the next ten minutes and we'll double your offer, call now, operators are standing by."],
  ["Daniel", "Ugh, turn that infomercial down."],
  ["Daniel", "Okay, so for Juniper, say we needed to order a blue lamp for the hallway, you'd just say order a blue lamp."],
  ["Maya", "Right. I think I should maybe email the landlord about the"],
  ["Maya", "I already paid the water bill this morning."],
  ["Maya", "Actually, make the lemons Sunday morning instead of Saturday, since it might rain."],
];
export const AMBIENT_CONV = (now) => ({ start_time: now - 3600e3, end_time: now - 3000e3, timezone: TZ, transcriptions: [{ realtime: false, utterances:
  AMBIENT_LINES.map(([speaker, text], i) => ({ id: `u${i + 1}`, spoken_at: now - 3590e3 + i * 40e3, speaker, text })) }] });
async function ambientParts(env, ctx) {
  const lines = ambientLines(AMBIENT_CONV(NOW(ctx)));
  return { lines, e: withSettings(env, ctx) };
}
async function ambientExtractRequest(env, ctx) {
  const { lines, e } = await ambientParts(env, ctx);
  return structuredBody(ambientRequest(ambientExtractMessages(lines, []), await maxOut(e, "ambient_extract")), "ambient_extract", AMBIENT_EXTRACT_SCHEMA);
}
// What the extraction found, as the first model's answer, one entry per line of AMBIENT_LINES it picked up. The first model made two mistakes on purpose: it took the
// advertisement (line 5) and the example (line 7) for tasks, so the review has to drop them. verdict is the right answer for the review. The items go through the same
// checker the real job runs on the model's answer, which sorts them by their place in the talk; the review's candidate ids follow that order (candidate:0 is the first).
const found = (line, o) => ({ speech_act: "intention", status: "open", due_text: null, relation: null, supersedes: [], line, quote: AMBIENT_LINES[line][1], ...o });
export const AMBIENT_FOUND = [
  { verdict: "retain", ...found(0, { kind: "task", text: "Call the pharmacy about Zoe's refill before it closes", due_text: "before they close" }) },
  { verdict: "retain", ...found(2, { kind: "reminder", text: "Buy lemons on Saturday for the cake", quote: "remind me to buy lemons on Saturday for the cake", due_text: "Saturday" }) },
  { verdict: "retain", ...found(4, { kind: "task", text: "Pay the water bill by Friday", due_text: "Friday" }) },
  { verdict: "drop", ...found(5, { kind: "task", text: "Order the offer within ten minutes", quote: "Order in the next ten minutes and we'll double your offer" }) },
  { verdict: "drop", ...found(7, { kind: "task", text: "Order a blue lamp for the hallway", quote: "say we needed to order a blue lamp for the hallway" }) },
  { verdict: "uncertain", ...found(8, { kind: "task", text: "Email the landlord about a problem", quote: "I think I should maybe email the landlord about the" }) },
  { verdict: "retain", ...found(9, { kind: "task", text: "Pay the water bill this morning", status: "completed", relation: "completion", supersedes: ["line:4"] }) },
  { verdict: "retain", ...found(10, { kind: "reminder", text: "Buy lemons Sunday morning instead of Saturday", quote: "make the lemons Sunday morning instead of Saturday", due_text: "Sunday morning", relation: "correction", supersedes: ["line:2"] }) },
];
async function ambientReviewRequest(env, ctx) {
  const { lines, e } = await ambientParts(env, ctx);
  const items = validateAmbient({ items: AMBIENT_FOUND.map(({ verdict, ...item }) => item) }, lines, []);
  return structuredBody(ambientRequest(ambientReviewMessages(ambientReviewInput(items, lines, [], [])), await maxOut(e, "ambient_review")), "ambient_review", AMBIENT_REVIEW_SCHEMA);
}

// ---------- golden answers (read by the Sandbox's Golden answers panel; the contract is in app-assets/app-static/sandbox-golden.js) ----------
// Each one is what a careful reader gets from the sample's own request. The paths are from the job's real answer: the schema in background-schemas.js, or for the
// decision jobs the answers object (question id -> { choice }).
const GOLDEN = {
  // The hand-off notes' answer is { completed, changed_files, working_commands, decisions, key_facts, unfinished }. The facts the notes must carry from the turn: the
  // receipt amount ($42.18), the card's last four digits (4417), the insurance company (the claim is the open item) and the reminder ("remind" fits reminder and reminded).
  handoff: () => ({ type: "contains", field: null, value: ["42.18", "4417", "insurance", "remind"] }),
  // The task summary's answer is { title, result, summary, why: { "1": ..., "2": ... } } (one why per step, keyed by the step number). The quoted keys "1" and "2" must
  // appear, so a reply that leaves out a why fails, and the words are what the card is about. A golden has one type, so this one text check covers both.
  label: () => ({ type: "contains", field: null, value: ["\"1\"", "\"2\"", "receipt", "insurance", "remind"] }),
  // The file card's answer is { what, summary, names, numbers, dates, outline }. The facts of the estimate (sample-doc text above): the total, what insurance covers, the doctor, the date.
  sidecar_card: () => ({ type: "contains", field: null, value: ["246", "184", "Patel", "October 2"] }),
  // The clean-up pass answers like the final notes (FINAL_NOTES_SCHEMA); the facts it must keep from the meeting: the spend, the contract price, the renewal date, the moved call.
  notes_refine: () => ({ type: "contains", field: null, value: ["71", "18,400", "November 3", "Wednesday"] }),
  // Every word of a correct title for the balcony garden message includes "garden" (the message says "vegetable garden"; a title may drop "balcony" or "vegetable").
  chat_title: () => ({ type: "contains", field: null, value: ["garden"] }),
  // The browser job asks for every exact string to type. The quotes make each one an exact value in the JSON list { values: [...] }. The day is chosen, not typed.
  browser: () => ({ type: "contains", field: "values", value: BROWSER_VALUES.map((v) => `"${v}"`) }),
  // The chat's first turn for ASKED (a pharmacy receipt photo, add it to expenses, remind me about the insurance): the helper saves the receipt with remember and sets the
  // reminder with schedule_followup, and calls nothing else (the photo is in the message, so no file tool is needed). tool_calls is the reply's list of { name, arguments }.
  chat: () => ({ type: "items", list: "tool_calls", match: ["name"], value: [{ name: "remember" }, { name: "schedule_followup" }] }),
  // The review's answer is { items: [{ id, verdict, reason, context }] }; the candidate ids are the order of AMBIENT_FOUND.
  ambient_review: () => ({ type: "choices", list: "items", id: "id", field: "verdict", options: ["retain", "uncertain", "drop"],
    value: Object.fromEntries(AMBIENT_FOUND.map((f, i) => [`candidate:${i}`, f.verdict])) }),
  // The extraction's answer is { items: [{ kind, status, relation, line, ... }] }. line is the position in the sorted lines (the same as in AMBIENT_LINES).
  // Not expected: anything from lines 5 to 8 (media, example, half a thought), which the prompt says to leave out or mark as not a plan.
  ambient_extract: () => ({ type: "items", list: "items", match: ["line", "kind", "status", "relation"], value: [
    { line: 0, kind: "task" }, { line: 2, kind: "reminder" }, { line: 4, kind: "task" }, { line: 9, status: "completed" }, { line: 10, relation: "correction" }] }),
  // The sorter's answers object: the steer question has the right answer "none" (a new request, not about either open job).
  decider: () => ({ type: "choices", list: "", id: null, field: "choice", options: ["none", ...OPEN_SUBAGENTS.map((a) => String(a.id))], value: { steer: "none" } }),
  browser_decider: () => ({ type: "choices", list: "", id: null, field: "choice", value: { next: browserNextId() } }),
  // The live note-taker's answer is { ops: [...] } and the new lines are the last two (the pricing call moves to Wednesday, the interview slots question is settled).
  notes: () => ({ type: "items", list: "ops", match: ["op", "sec", "owner", "due"], value: [
    { sec: "actions", owner: "Maya", due: "Wednesday" }, { op: "add", sec: "decisions" }, { op: "remove", sec: "questions" }] }),
  // The final notes' answer has actions: [{ text, owner, due }], and the pricing call has to be due Wednesday (the live notes still say Tuesday).
  notes_final: () => ({ type: "items", list: "actions", match: ["owner", "due"], value: [
    { owner: "Priya", due: "Friday" }, { owner: "Maya", due: "Wednesday" }, { owner: "Maya", due: "today" }] }),
};

export const samples = [
  ...CATEGORIES.map((id) => ({ job: `chat:${id}`, golden: GOLDEN.chat(), via: "model-dispatch.js#dispatch", meta: { kind: "chat" }, build: chatBuild })),
  { job: "decider", golden: GOLDEN.decider(), via: "text-decision.js#askJob", build: async (env, ctx) => ({ request: await deciderRequest(env, ctx), files: [] }) },
  { job: "handoff", golden: GOLDEN.handoff(), via: "model-dispatch.js#dispatch", meta: { kind: "chat" }, build: async (env, ctx) => ({ request: await handoffRequest(env, ctx), files: [PHOTO] }) },
  { job: "chat_title", golden: GOLDEN.chat_title(), via: "model-dispatch.js#dispatch", build: async (env, ctx) => ({ request: await chatTitleRequestFor(env, ctx), files: [] }) },
  { job: "label", golden: GOLDEN.label(), via: "model-dispatch.js#dispatch", build: async (env, ctx) => ({ request: await labelRequestFor(env, ctx), files: [] }) },
  { job: "browser", golden: GOLDEN.browser(), via: "model-dispatch.js#dispatch", build: async (env, ctx) => ({ request: await browserRequest(env, ctx), files: [] }) },
  { job: "notes", golden: GOLDEN.notes(), via: "model-dispatch.js#dispatch", build: async (env, ctx) => ({ request: await notesRequestFor("note", env, ctx), files: [] }) },
  { job: "notes_refine", golden: GOLDEN.notes_refine(), via: "model-dispatch.js#dispatch", build: async (env, ctx) => ({ request: await notesRequestFor("refine", env, ctx), files: [] }) },
  { job: "notes_final", golden: GOLDEN.notes_final(), via: "model-dispatch.js#dispatch", build: async (env, ctx) => ({ request: await notesRequestFor("final", env, ctx), files: [] }) },
  { job: "sidecar_card", golden: GOLDEN.sidecar_card(), via: "model-dispatch.js#dispatch", build: async (env, ctx) => ({ request: await sidecarRequest(env, ctx), files: [] }) },
  { job: "ambient_extract", golden: GOLDEN.ambient_extract(), via: "model-dispatch.js#dispatch", build: async (env, ctx) => ({ request: await ambientExtractRequest(env, ctx), files: [] }) },
  { job: "ambient_review", golden: GOLDEN.ambient_review(), via: "model-dispatch.js#dispatch", build: async (env, ctx) => ({ request: await ambientReviewRequest(env, ctx), files: [] }) },
  { job: "browser_decider", golden: GOLDEN.browser_decider(), via: "text-decision.js#askJob", meta: { kind: "decider" }, build: async () => ({ request: browserDeciderRequest(), files: [] }) },
  { job: "workers_ai_chat", golden: GOLDEN.chat(), via: "model-dispatch.js#dispatch", meta: { kind: "chat-fallback" }, build: chatBuild },
];
