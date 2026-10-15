// Models that are chosen outside the saved model settings. The Models page lists them read only: no picker and no save.
import { lookModel } from "../sidecar.js";
import { SHADOW_MODEL, shadowOn } from "./decision-shadow.js";
import { HINDSIGHT_MODELS, HINDSIGHT_SET_IN } from "./hindsight-models.js";

export function outsideModels(env) {
  const flag = String(env?.DECISION_SHADOW || "").trim() || "unset", look = lookModel(env), own = !!String(env?.SIDECAR_LOOK_MODEL || "").trim();
  return [
    { id: "browser_look", title: "Browser look", items: [{ label: "Reads a browser page picture", model: look, detail: own ? "Set by the SIDECAR_LOOK_MODEL variable." : "Moondream 3.1 on Cloudflare. The SIDECAR_LOOK_MODEL variable can replace it." }] },
    { id: "decision_shadow", title: "Decision shadow", items: [{ label: "Second opinion on routing and browser steps", model: SHADOW_MODEL, detail: `${shadowOn(env) ? "On" : "Off"} (DECISION_SHADOW is ${flag}). It runs only on dev, and its answer is only recorded.` }] },
    { id: "hindsight", title: "Memory server (Hindsight)", note: `Set in ${HINDSIGHT_SET_IN}. A check script compares this list with the host.`,
      items: HINDSIGHT_MODELS.map((m) => ({ label: m.label, model: m.model, detail: [m.effort ? `reasoning ${m.effort}` : "", m.note || ""].filter(Boolean).join(", ") })) },
  ];
}
