// Sandbox samples of the media and memory jobs on the Models page: for each job, the real request it sends to its model, with invented inputs.
//
// Each sample is { job, via, meta, build }. via is "<module>#<function>", the exported function the real job calls to reach its model, and build(env, ctx) returns
// { request, files }: request is the argument the real job passes to that function (after its env and job id), files lists the fake attached files with their
// path under /app-static/sandbox/. Wherever file bytes go, the request holds a placeholder { "$file": "<name>", "as": "data_url" | "base64" | "bytes" | "text" } in the
// same place the real job puts them, and the page replaces it with the file's content before sending.
//
// The requests of the speech, search, picture and embedding jobs are made by the same functions the real jobs call, with invented inputs, so a change to a job
// shows here with no extra step. The five memory jobs (hs_*) are called by the Hindsight memory server, so their text is Hindsight's, kept in hindsight-snapshot.js
// (version and capture date there).
import { LIVE_CHUNK_HEADERS } from "../../transcribe-live-chunks.js";
import { embedRequest, chunkTexts, visionRequest, VISION_FORMAT, lookBodies } from "../../sidecar.js";
import { chunksOf, sectionsOf } from "../../sidecar-convert.js";
import { structuredBody } from "../../structured-output.js";
import { searchRequest } from "../../websearch.js";
import { contextFor, speakerLabels, fillTemplate } from "../../hindsight-template.js";
import { convEntries, turnItem, DOC } from "../../hindsight-writers.js";
import { chatEnvelope, placeEntries } from "../../adapters/chat.js";
import { withEnvelope } from "../../memory-envelope.js";
import { HINDSIGHT_SNAPSHOT, FACT_ID, RETAIN, CONSOLIDATION, REFLECT, REFRESH } from "./hindsight-snapshot.js";

const DIR = "/app-static/sandbox/";
const fixture = (name, type) => ({ name, type, path: DIR + name });
const FILES = {
  photo: fixture("sample-photo.jpg", "image/jpeg"),
  page: fixture("sample-page.png", "image/png"),
  doc: fixture("sample-doc.pdf", "application/pdf"),
  speech: fixture("sample-speech.wav", "audio/wav"),
};
const file = (f, as) => ({ $file: f.name, as });

// ---- speech ----
// The arguments of stt() in transcribe.js, the function every speech call goes through: the recording as { bytes }, then its options. The sample is a WAV recording
// (the format AssemblyAI takes first) of 7.8 seconds. stt() builds the bodies for each model of the job itself.
const speechRequest = (job, extra = {}) => ({ src: { bytes: file(FILES.speech, "bytes") }, format: "wav", estSec: 7.8, job, ...extra });

// ---- the invented document the file search index reads ----
const DOC_MD = `# Maple Street Bakery: Supply Agreement Summary

Prepared for Jordan Rivera. Agreement no. MSB-2026-014, effective November 1, 2026.

## 1. Parties

This agreement is between Maple Street Bakery, 418 Maple Street, Springfield (the Supplier), and Rivera Catering LLC (the Customer). The Supplier will deliver baked goods to the Customer's kitchen at 92 Cedar Avenue, Springfield.

## 2. Weekly delivery

Deliveries are made every Tuesday and Friday before 7:00 AM. The Customer must tell the Supplier by 3:00 PM on the day before if an order changes. Late changes may be refused.

| Item | Quantity per week | Unit price |
| --- | --- | --- |
| Sourdough loaf | 40 | $6.50 |
| Butter croissant | 120 | $3.50 |
| Rye bread | 20 | $7.25 |
| Oat cookie box (12) | 15 | $18.00 |

## 3. Payment

The Supplier invoices the Customer on the first day of each month. Payment is due within 15 days. A late fee of 1.5 percent per month applies to any unpaid balance after the due date.

## 4. Price changes

Prices are fixed until April 30, 2027. After that date the Supplier may change prices once every six months with 30 days of written notice. The Customer may end the agreement without a fee if a price rises by more than 8 percent.

## 5. Quality and returns

The Customer may return any item that arrives damaged or past its date for a full credit if the Supplier is told within 24 hours of delivery. Photos of the item are required.

## 6. Ending the agreement

Either party may end this agreement with 60 days of written notice. The agreement renews each year on November 1 unless one party gives notice at least 60 days before that date.
`;

// ---- memory jobs: the body the memory server sends to the Worker ----
const FIRST = "Sam", HELPER = "Ollie", TZ = "UTC";
const NAMES = { first: FIRST, helper: HELPER, channel: "main" };
const cacheMark = { type: "ephemeral" };
const system = (text) => ({ role: "system", content: [{ type: "text", text, cache_control: cacheMark }] });
const toolsOf = (tools) => tools.map((t) => ({ ...t }));
// Hindsight's date format in the retain prompt: the weekday and date in words, then the ISO time with microseconds.
const eventDate = (ms) => `${new Date(ms).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: TZ })} (${new Date(ms).toISOString().replace(/\.(\d{3})Z$/, ".$1000+00:00")})`;
// The server lists metadata keys shortest first, then in alphabetical order (the order PostgreSQL keeps in a JSON column).
const metaLines = (m) => Object.entries(m).sort((a, b) => a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `  ${k}: ${v}`).join("\n");

// The retain request of one finished chat turn. The item is made by the same functions the chat writer uses (entries, context, envelope metadata) from an invented turn.
function retainBody() {
  const at = Date.UTC(2026, 9, 19, 9, 29, 41), endAt = Date.UTC(2026, 9, 19, 9, 29, 52), session = "5d7c3a1e-8b24-4f60-a9d1-2c4e6f8a0b13", turn = "0e8f2b6a-31c5-4d97-8a40-7b9d1c3e5f27";
  let entries = convEntries({ userText: "", reply: "Added the Maple Street Bakery invoice of $412.00 to your budget sheet. It is due Friday, and I will remind you on Thursday evening.", notes: "", at, endAt, kind: "chat",
    labels: speakerLabels(NAMES), tz: TZ, userMessages: [{ at, text: "Please add the Maple Street Bakery invoice for $412 to my budget sheet. I always pay the bakery on Fridays, and my sister Priya is allergic to walnuts, so no walnut orders.", origin: { surface: "app" } }] });
  const sid = session, day = "2026-10-19";
  let item = turnItem({ doc: DOC.conv(sid, day), entries, at, context: contextFor("chat", NAMES), channel: "main", session: sid, day, key: turn });
  const e = chatEnvelope({ at, endAt, tz: TZ, where: null, session: sid, turn, kind: "chat" });
  entries = placeEntries(entries, e); item = withEnvelope({ ...item, content: entries }, e, { first: FIRST });
  item.metadata.ingested_at = new Date(endAt + 1000).toISOString();   // the envelope stamps the time of the call, the sample stays the same on every build
  const chunk = `Extract facts from the following chunk.\n\nChunk: 1/1\nEvent Date: ${eventDate(at)}\nContext: ${item.context}\nMetadata:\n${metaLines(item.metadata)}\n\nContent:\n${JSON.stringify(item.content)}`;
  return { messages: [system(RETAIN.system), { role: "user", content: RETAIN.userHead + chunk }], response_format: RETAIN.responseFormat };
}

// The id of the one existing observation the new fact belongs to.
const OBSERVATION_ID = "3b6f9a14-52de-4c87-b0a3-91e7d2c48f65";
// The consolidation request: the new facts of a retain batch and the observations that may take them in.
function consolidationBody() {
  const fact = `[${FACT_ID}] ${FIRST} pays the Maple Street Bakery invoice of $412.00 on Fridays. | When: Monday, October 19, 2026 | Involving: ${FIRST} (occurred_start=2026-10-19 00:00:00+00:00, occurred_end=2026-10-19 00:00:00+00:00, mentioned_at=2026-10-19 09:29:41.000000+00:00)`;
  const existing = [{ id: OBSERVATION_ID, text: `${FIRST} orders baked goods from Maple Street Bakery and pays the invoice at the end of the week.`, proof_count: 2, mentioned_at: "2026-10-12T08:15:10+00:00",
    source_memories: [{ text: `${FIRST} asked ${HELPER} to add the Maple Street Bakery invoice for $388.00 to the budget sheet. | When: Monday, October 12, 2026 | Involving: ${FIRST}`,
      context: contextFor("chat", NAMES).slice(0, 200) + "...", mentioned_at: "2026-10-12T08:15:10+00:00" }] }];
  const user = `${CONSOLIDATION.userHead}## INPUT\n\n### New facts\n\n${fact}\n\n### Existing observations\n\n${JSON.stringify(existing, null, 2)}`;
  return { messages: [system(CONSOLIDATION.system), { role: "user", content: user }], response_format: CONSOLIDATION.responseFormat, temperature: CONSOLIDATION.temperature };
}

// A reflect call is a tool loop; the sample is its first request, which carries the one tool the server offers on that call (search_mental_models, as logged in the
// AI Gateway for the first call of a page refresh; later calls add read_mental_models, search_observations, recall, expand and done). The server's tool_choice is
// not known: the traces record that it sets one, but the gateway log shows the body after the Worker's cleaning, which drops it for models that take only automatic
// choice, so none is included. What is observed: the messages (system text from prompts/preview for hs_reflect, from the logged call for hs_refresh), the tools and
// the temperature. For hs_reflect the tools and temperature come from the refresh run's first call, because no reflect API call was in the dev gateway log; both
// jobs run the same reflect agent. The question and the invented content are mine.
const firstReflectCall = (R, question) => ({ messages: [system(R.system), { role: "user", content: question }], tools: toolsOf(R.tools), temperature: R.temperature });

// The ranking request: the question, and the facts a recall found, each one a candidate the ranking model picks from. The best answer (c2) is not the one that
// repeats the most words of the question: c0 and c1 are about the same bakery and invoice and say nothing about when Sam pays, and c2 names the payment day in other words.
const RERANK_QUESTION = "When does Sam pay the Maple Street Bakery invoice?";
// The best candidate is c2 (the ranking golden reads it from the reply's top, see rankingOf in sandbox-golden.js).
function rerankBody() {
  const question = RERANK_QUESTION;
  return { state: `Question: ${question}`, questions: { rank: { type: "choice", instructions: `Which candidate answers the question: ${question}`, criteria: {
    c0: "[Date: October 19, 2026 (2026-10-19)] The Maple Street Bakery invoice of $412.00 was added to Sam's budget sheet.",
    c1: "[Date: October 12, 2026 (2026-10-12)] Maple Street Bakery sends Sam an invoice on the first day of each month.",
    c2: "[Date: October 12, 2026 (2026-10-12)] Sam settles the baker's bill every Friday afternoon and likes a reminder the evening before.",
    c3: "Sam's sister Priya is allergic to walnuts.",
    c4: "Sam has a dentist appointment on Thursday, November 5, 2026 at 3:30 PM." } } } };
}

// ---- golden answers (the contract is in app-assets/app-static/sandbox-golden.js) ----
// The files are fixed, so what they hold is known: the speech file says SPOKEN (piper, voice en_US-lessac-medium, the spoken text is in the Sandbox sample for stt), the
// photo is the receipt of Maple Street Bakery and the page is the Lakeview Inn booking.
const SPOKEN = "Hi Ollie, please add the Maple Street Bakery invoice for four hundred and twelve dollars to my budget sheet, and remind me to pay it by Friday.";
// A speech model may write "$412" for "four hundred and twelve dollars", which counts as four word errors of 26, so the pass level is a little looser than 10 percent.
const speechGolden = () => ({ type: "text", field: null, max_wer: 0.2, value: SPOKEN });
const GOLDEN = {
  stt: speechGolden, stt_cloudflare: speechGolden, live_dictation: speechGolden,
  // The picture description's answer is { description, text }, and text copies the receipt line by line. The total is $72.88 (the subtotal is $68.75).
  vision_files: () => ({ type: "contains", field: "text", value: ["Maple Street Bakery", "Order #2047", "$72.88", "VISA ****4417"] }),
  // The browser's look answer is a sentence. The total due at check-in is $545.60, and the page also shows other amounts (the room is $418.00).
  look: () => ({ type: "contains", field: null, value: ["545.60"] }),
  // The search view is { results: [{ title, url, domain }] }. The field "results" is read as text, so the domain must appear among the results (others may appear too).
  web_search: () => ({ type: "contains", field: "results", value: ["docs.python.org"] }),
  // The extraction's answer is { facts: [{ what, ... }] } (the schema is in the snapshot). The facts of the turn: the bakery, the amount, the day and the allergy. "412" fits $412 and $412.00.
  hs_retain: () => ({ type: "contains", field: null, value: ["Maple Street Bakery", "412", "Friday", "walnut"] }),
  // The consolidation answer is { creates: [], updates: [{ observation_id, source_fact_ids, text, reason }], deletes: [] }. The new fact (pays the bakery invoice on Fridays)
  // is the same facet as the existing observation (pays the invoice at the end of the week), so the right action is one update of that observation.
  hs_consolidation: () => ({ type: "items", list: "updates", match: ["observation_id"], value: [{ observation_id: OBSERVATION_ID }] }),
  // The first reflect call offers one tool (search_mental_models) and the server expects a call of it, so the reply is exactly that call (the reply's tool_calls list is
  // [{ name, arguments }], see toolCallsOf in sandbox-golden.js).
  hs_reflect: () => ({ type: "items", list: "tool_calls", match: ["name"], extras_fail: false, value: [{ name: REFLECT.tools[0].function.name }] }),
  hs_refresh: () => ({ type: "items", list: "tool_calls", match: ["name"], extras_fail: false, value: [{ name: REFRESH.tools[0].function.name }] }),
  // The ranking view is { order, top }. The best candidate is c2.
  hs_rerank: () => ({ type: "choices", list: "", id: null, field: "top", value: { top: "c2" } }),
};

// The search query has one obvious site: the Python documentation of strptime is at docs.python.org.
const SEARCH_QUERY = "Python datetime strptime format codes documentation";
const via = (module, fn) => `${module}#${fn}`;
export const samples = [
  { job: "stt", golden: GOLDEN.stt(), via: via("transcribe.js", "stt"), meta: { kind: "transcribe" }, build: async () => ({ request: speechRequest("stt"), files: [FILES.speech] }) },
  { job: "stt_cloudflare", golden: GOLDEN.stt_cloudflare(), via: via("transcribe.js", "stt"), meta: { kind: "transcribe" }, build: async () => ({ request: speechRequest("stt_cloudflare"), files: [FILES.speech] }) },
  // A chunk of live dictation is a WAV file cut at a pause, sent with the extra header that keeps the gateway from logging it. A Cloudflare streaming model
  // (Deepgram) takes a WebSocket instead of a chunk, so only a model that takes whole recordings can answer this request.
  { job: "live_dictation", golden: GOLDEN.live_dictation(), via: via("transcribe.js", "stt"), meta: { kind: "live-dictation" }, build: async () => ({ request: speechRequest("live_dictation", { headers: LIVE_CHUNK_HEADERS }), files: [FILES.speech] }) },
  // The index of a long file: its markdown cut into chunks, the texts of the chunks sent for their vectors. The file itself is shown for reference, only its text is sent.
  { job: "embed_files", via: via("media-job.js", "dispatchMedia"), meta: { kind: "sidecar-embed" }, build: async () => ({ request: embedRequest(chunkTexts(DOC_MD, chunksOf(DOC_MD, sectionsOf(DOC_MD)))), files: [FILES.doc] }) },
  { job: "vision_files", golden: GOLDEN.vision_files(), via: via("media-job.js", "dispatchMedia"), meta: { kind: "sidecar-vision-picture" }, build: async () => ({ request: structuredBody(visionRequest(file(FILES.photo, "data_url")), VISION_FORMAT.name, VISION_FORMAT.schema), files: [FILES.photo] }) },
  // The browser reads a screenshot and answers a question about it (the caption and point calls use the other bodies of lookBodies).
  { job: "look", golden: GOLDEN.look(), via: via("media-job.js", "dispatchMedia"), meta: { kind: "browser-look" }, build: async () => ({ request: lookBodies(file(FILES.page, "data_url"), { question: "What is the total due at check-in?" }).answer, files: [FILES.page] }) },
  { job: "web_search", golden: GOLDEN.web_search(), via: via("model-dispatch.js", "dispatch"), meta: { kind: "web-search" }, build: async () => ({ request: searchRequest(SEARCH_QUERY, 5), files: [] }) },
  // The memory jobs are snapshots of what the Hindsight server sent on the capture date, with invented content. The request of a chat job is the server's body, which
// the Worker cleans with cleanChatRequest before dispatch(); the ranking body goes to dispatch() as it is.
  { job: "hs_retain", golden: GOLDEN.hs_retain(), via: via("hindsight-llm.js", "cleanChatRequest"), meta: { kind: "memory-retain" }, build: async () => ({ request: retainBody(), files: [] }) },
  { job: "hs_consolidation", golden: GOLDEN.hs_consolidation(), via: via("hindsight-llm.js", "cleanChatRequest"), meta: { kind: "memory-consolidation" }, build: async () => ({ request: consolidationBody(), files: [] }) },
  { job: "hs_reflect", golden: GOLDEN.hs_reflect(), via: via("hindsight-llm.js", "cleanChatRequest"), meta: { kind: "memory-reflect" }, build: async () => ({ request: firstReflectCall(REFLECT, "Which foods is Sam allergic to, and who in the family should I plan meals around?"), files: [] }) },
  // A page refresh is a reflect run whose question is the page's own source query, from the bank template (the Notebook page "people").
  { job: "hs_refresh", golden: GOLDEN.hs_refresh(), via: via("hindsight-llm.js", "cleanChatRequest"), meta: { kind: "memory-refresh" }, build: async () => ({ request: firstReflectCall(REFRESH, fillTemplate("general", { first: FIRST, helper: HELPER }).mental_models.find((m) => m.id === "people").source_query), files: [] }) },
  { job: "hs_rerank", golden: GOLDEN.hs_rerank(), via: via("model-dispatch.js", "dispatch"), meta: { kind: "memory-rerank" }, build: async () => ({ request: rerankBody(), files: [] }) },
];
export { HINDSIGHT_SNAPSHOT };
