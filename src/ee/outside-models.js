// Models and tools that are chosen outside the saved model settings. The Models page lists them read only: no picker and no save.
// The Browser look is a saved job now (model-jobs.js "look"), so it is no longer listed here.
import { HINDSIGHT_LOCAL, HINDSIGHT_SET_IN } from "./hindsight-models.js";

export function outsideModels(env) {
  return [
    { id: "ocr", title: "Text recognition (OCR)", items: [{ label: "Reads text in scanned pages and pictures", model: "no hosted model", detail: "It runs inside 1Helm, so no model call is made." }] },
    { id: "web_search", title: "Web search", items: [{ label: "Looks up web pages", model: "no model", detail: "It is a search service, not a model. DuckDuckGo answers first, and Brave answers when that fails. Cloudflare Web Search is the Web search job above." }] },
    { id: "browser_run", title: "Reading web pages", items: [{ label: "Renders and reads a web page", model: "no model", detail: "Cloudflare Browser Run opens the page for DuckDuckGo search and for fetch_url. It is a page service with nothing to choose, and it calls no model." }] },
    { id: "hindsight", title: "Memory server (Hindsight)", note: `Its language model calls and its recall ranking are the Memory jobs above. Set in ${HINDSIGHT_SET_IN}.`,
      items: HINDSIGHT_LOCAL.map((m) => ({ label: m.label, model: m.model, detail: [m.effort ? `reasoning ${m.effort}` : "", m.note || ""].filter(Boolean).join(", ") })) },
  ];
}
