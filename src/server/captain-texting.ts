import { photonStatus, textPhotonCaptain } from "./photon.ts";

/** Keep Skipper's Photon identity and troubleshooting rule together with the
 * capability check that controls whether the tool is actually available. */
export function captainTextingPrompt(authorizedMain: boolean): { operating: string; context: string } {
  const photon = authorizedMain ? photonStatus() : null;
  if (!photon?.configured) return {
    operating: "If Photon/iMessage is not connected, do not claim that you can text the Captain. You may point them to Settings → Connections when texting is relevant.",
    context: "",
  };
  return {
    operating: `Photon/iMessage is connected. You have a 1Helm phone line${photon.assigned_phone ? ` at ${String(photon.assigned_phone)}` : ""} and the text_captain tool reaches only this workspace's configured Captain phone. When a timely text would genuinely help, you may offer once in natural language. Send when the Captain clearly requests a text, naturally continues an existing text request, or accepts your offer; never turn a merely useful idea into an unsolicited text. For an authorized later reminder, call schedule_followup with a self-contained reason that tells your future wake to call text_captain with the exact reminder. Do not claim Photon is unknown. If and only if text_captain reports that Photon has not activated the configured Captain phone for outbound-first messages, explain that the connector is already connected, ask the Captain to send one text from the configured phone to the 1Helm number shown in Settings → Connections, and retry in this same thread afterward. Do not tell the Captain to reconnect Photon or repeat setup for that activation error.`,
    context: `<photon configured="true" connected="${Boolean(photon.connected)}" assigned_phone="${String(photon.assigned_phone || "")}">Outbound texts are restricted to the configured Captain phone and require clear conversational permission.</photon>`,
  };
}

export function captainTextToolDefinitions(authorizedMain: boolean): unknown[] {
  if (!authorizedMain || !photonStatus().configured) return [];
  return [{
    type: "function",
    function: {
      name: "text_captain",
      description: "Send one iMessage now from 1Helm's Photon line to the exact configured Captain phone. The destination cannot be changed. Use when the Captain clearly requests a text, naturally continues an existing text request, or accepts your offer; never send merely because a text might be helpful.",
      parameters: { type: "object", properties: { message: { type: "string", description: "The exact useful text to send now. Do not include tool narration or invent details." } }, required: ["message"] },
    },
  }];
}

/** Deterministic external-side-effect gate for outbound Captain texts. A model
 * cannot turn a vague usefulness judgment into consent. Durable reminder wakes
 * carry a sentinel added by the runtime only after this same check passed. */
export function captainTextConsent(currentMessage: string, priorSkipperMessage = "", earlierCaptainMessage = ""): boolean {
  const current = String(currentMessage || "").trim();
  if (/\b(?:do not|don't|dont|not now|never mind|nevermind)\b/i.test(current)) return false;
  if (/^(?:@?skipper[,!:]?\s*)?(?:please\s+)?(?:text|message)\s+me\b/i.test(current)
    || /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:text|message)\s+me\b/i.test(current)
    || /\bI\s+(?:want|need|would\s+like)\s+you\s+to\s+(?:text|message)\s+me\b/i.test(current)
    || /\bsend\s+(?:me\s+)?(?:an?\s+)?(?:text|iMessage)\b|\bremind\s+me\s+(?:by|via|with)\s+(?:an?\s+)?(?:text|iMessage)\b|\btext\s+(?:this|that|the\s+reminder)\s+to\s+me\b/i.test(current)) return true;
  const acceptance = /^(?:yes|yeah|yep|sure|okay|ok|absolutely|definitely|please do|do it|go ahead|send it|sounds good)\b/i.test(current);
  const offer = /\b(?:want|like)\s+me\s+to\s+text\s+you\b|\b(?:shall|should|would)\s+I\s+text\s+you\b|\bI\s+can\s+text\s+you\b/i.test(String(priorSkipperMessage || ""));
  if (acceptance && offer) return true;
  const establishedTextRequest = Boolean(String(earlierCaptainMessage || "").trim())
    && captainTextConsent(String(earlierCaptainMessage));
  const continuation = /^(?:done[,!]?\s*)?(?:please\s+)?(?:try|send|text|message|do)(?:\s+(?:it|that|this|.+?))?(?:\s+(?:again|now))?[.!\s]*$/i.test(current)
    || /^(?:yes|yeah|yep|sure|ok(?:ay)?|go ahead|please do|do it|send it)\b/i.test(current);
  return establishedTextRequest && continuation;
}

export async function deliverCaptainText(ownerUserId: number, botId: number, message: string): Promise<string> {
  return JSON.stringify(await textPhotonCaptain({ owner_user_id: ownerUserId, bot_id: botId, body: message }));
}
