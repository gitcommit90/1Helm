// Sandbox samples of the media and memory jobs on the Models page: for each job, the real request it sends to its model, with invented inputs.
//
// Each sample is { job, via, meta, build }. via is "<module>#<function>", the exported function the real job calls to reach its model, and build(env, ctx) returns
// { request, files }: request is the argument the real job passes to that function (after its env and job id), files lists the fake attached files with their
// path under /app-static/sandbox/. Wherever file bytes go, the request holds a placeholder { "$file": "<name>", "as": "data_url" | "base64" | "bytes" | "text" } in the
// same place the real job puts them, and the page replaces it with the file's content before sending.
//
// The requests of the speech, search, picture and embedding jobs are made by the same functions the real jobs call, with invented inputs, so a change to a job
// shows here with no extra step. 
import { LIVE_CHUNK_HEADERS } from "../../transcribe-live-chunks.js";
import { embedRequest, chunkTexts, visionRequest, VISION_FORMAT, lookBodies } from "../../sidecar.js";
import { chunksOf, sectionsOf } from "../../sidecar-convert.js";
import { structuredBody } from "../../structured-output.js";
import { searchRequest } from "../../websearch.js";
import { MISSION } from "../../mem0.js";

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

// ---- memory jobs: the bodies of the Mem0 calls ----
const FIRST = "Sam", HELPER = "Ollie";
// The extraction call of Memory: extract. Mem0 adds its own long extraction prompt, so the sample is the mission and the lines of the same invented turn.
const memExtractBody = () => ({ messages: [{ role: "system", content: `${MISSION}\nReply with only JSON: {"memory":[{"id":"0","text":"...","category":"..."}]}` },
  { role: "user", content: `[2026-10-19T09:29:41-07:00] ${FIRST} (user) (app): Please add the Maple Street Bakery invoice for $412 to my budget sheet. I always pay the bakery on Fridays, and my sister Priya is allergic to walnuts, so no walnut orders.\n[2026-10-19T09:29:52-07:00] ${HELPER} (assistant): Added the invoice to your budget sheet. It is due Friday.` }], response_format: { type: "json_object" } });
const RERANK_QUESTION = "When does Sam pay the Maple Street Bakery invoice?";
// The facts a recall found, each one a candidate the reranker scores. The best one (index 2) is not the one that repeats the most words of the question: the first two are about
// the same bakery and invoice and say nothing about when Sam pays, and the third names the payment day in other words.
const RERANK_FACTS = [
  "[Date: October 19, 2026 (2026-10-19)] The Maple Street Bakery invoice of $412.00 was added to Sam's budget sheet.",
  "[Date: October 12, 2026 (2026-10-12)] Maple Street Bakery sends Sam an invoice on the first day of each month.",
  "[Date: October 12, 2026 (2026-10-12)] Sam settles the baker's bill every Friday afternoon and likes a reminder the evening before.",
  "Sam's sister Priya is allergic to walnuts.",
  "Sam has a dentist appointment on Thursday, November 5, 2026 at 3:30 PM.",
];

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
  mem_extract: () => ({ type: "contains", field: null, value: ["Maple Street Bakery", "412", "Friday", "walnut"] }),
  // The ranking view lists each fact by its index: the candidates are numbered from 0, so the best one, the fact that names the payment day, is "2".
  mem_rerank: () => ({ type: "choices", list: "", id: null, field: "top", value: { top: "2" } }),
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
  // Who spoke when in the recording. The sample file has one voice, so the answer is one speaker; no golden is checked, the view shows the turns.
  { job: "speaker_labels", via: via("media-job.js", "dispatchMedia"), meta: { kind: "speaker-labels" }, build: async () => ({ request: { audio: file(FILES.speech, "bytes"), format: "wav" }, files: [FILES.speech] }) },
  // The index of a long file: its markdown cut into chunks, the texts of the chunks sent for their vectors. The file itself is shown for reference, only its text is sent.
  { job: "embed_files", via: via("media-job.js", "dispatchMedia"), meta: { kind: "sidecar-embed" }, build: async () => ({ request: embedRequest(chunkTexts(DOC_MD, chunksOf(DOC_MD, sectionsOf(DOC_MD)))), files: [FILES.doc] }) },
  { job: "vision_files", golden: GOLDEN.vision_files(), via: via("media-job.js", "dispatchMedia"), meta: { kind: "sidecar-vision-picture" }, build: async () => ({ request: structuredBody(visionRequest(file(FILES.photo, "data_url")), VISION_FORMAT.name, VISION_FORMAT.schema), files: [FILES.photo] }) },
  // The browser reads a screenshot and answers a question about it (the caption and point calls use the other bodies of lookBodies).
  { job: "look", golden: GOLDEN.look(), via: via("media-job.js", "dispatchMedia"), meta: { kind: "browser-look" }, build: async () => ({ request: lookBodies(file(FILES.page, "data_url"), { question: "What is the total due at check-in?" }).answer, files: [FILES.page] }) },
  { job: "web_search", golden: GOLDEN.web_search(), via: via("model-dispatch.js", "dispatch"), meta: { kind: "web-search" }, build: async () => ({ request: searchRequest(SEARCH_QUERY, 5), files: [] }) },
  { job: "mem_extract", golden: GOLDEN.mem_extract(), via: via("model-dispatch.js", "dispatch"), meta: { kind: "memory-extract" }, build: async () => ({ request: memExtractBody(), files: [] }) },
  { job: "mem_embed", via: via("media-job.js", "dispatchMedia"), meta: { kind: "memory-embed" }, build: async () => ({ request: embedRequest(["Sam pays the Maple Street Bakery invoice on Fridays.", "Sam's sister Priya is allergic to walnuts."]), files: [] }) },
  { job: "mem_rerank", golden: GOLDEN.mem_rerank(), via: via("model-dispatch.js", "dispatch"), meta: { kind: "memory-rerank" }, build: async () => ({ request: { query: RERANK_QUESTION, contexts: RERANK_FACTS.map((text) => ({ text })) }, files: [] }) },
];
