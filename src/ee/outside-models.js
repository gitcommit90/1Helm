// Models and tools that are chosen outside the saved model settings. The Models page lists them read only: no picker and no save.
// The Browser look is a saved job now (model-jobs.js "look"), so it is no longer listed here.
import { HINDSIGHT_MODELS, HINDSIGHT_SET_IN } from "./hindsight-models.js";

export function outsideModels(env) {
  return [
    { id: "ocr", title: "Text recognition (OCR)", items: [{ label: "Reads text in scanned pages and pictures", model: "no hosted model", detail: "It runs inside 1Helm, so no model call is made." }] },
    { id: "web_search", title: "Web search", items: [{ label: "Looks up web pages", model: "no model", detail: "It is a search service, not a model. DuckDuckGo answers first, and Brave answers when that fails. Cloudflare Web Search is the Web search job above." }] },
    { id: "hindsight", title: "Memory server (Hindsight)", note: `Set in ${HINDSIGHT_SET_IN}. A check script compares this list with the host.`,
      items: HINDSIGHT_MODELS.map((m) => ({ label: m.label, model: m.model, source: String(m.model).startsWith("@cf/") ? "CF" : "OR", detail: [m.effort ? `reasoning ${m.effort}` : "", m.provider ? "OpenRouter picks the provider, zero data retention" : "", m.note || ""].filter(Boolean).join(", ") })) },
  ];
}
