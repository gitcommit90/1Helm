import { photonCaptainOwnerId, photonStatus, textPhotonCaptain } from "./photon.ts";

export const CAPTAIN_TEXTING_PERMISSION_KIND = "captain_texting_permission";
export const CAPTAIN_TEXTING_ACCEPT = "Enable texting for this channel";
export const CAPTAIN_TEXTING_DECLINE = "Not now";

/** Runtime-authored permission question — the model never phrases consent. */
export function captainTextingPermissionPayload(channelName: string): Record<string, unknown> {
  return {
    kind: CAPTAIN_TEXTING_PERMISSION_KIND,
    blocker_kind: "external_authority",
    evidence: "text_captain was called in a channel without a texting grant.",
    intro: `This agent wants to send you texts from #${channelName} (for example when something it monitors happens). Texts always go to your configured Captain phone only. Enable texting for this channel?`,
    questions: [{
      id: "q1",
      header: "Texting",
      question: `Allow #${channelName}'s agent to text you?`,
      multi_select: false,
      options: [
        { label: CAPTAIN_TEXTING_ACCEPT, description: "Unlocks texting for this channel until you revoke it in channel Settings." },
        { label: CAPTAIN_TEXTING_DECLINE, description: "Declines this time only; the agent may ask again later." },
      ],
    }],
  };
}

/** Keep the texting identity and troubleshooting rule together with the
 * capability check that controls whether the tool is actually available. */
export function captainTextingPrompt(authorized: boolean, kind: "skipper" | "resident" = "skipper"): { operating: string; context: string } {
  const photon = authorized ? photonStatus() : null;
  if (!photon?.configured) return {
    operating: kind === "skipper"
      ? "If Photon/iMessage is not connected, do not claim that you can text the Captain. You may point them to Settings → Connections when texting is relevant."
      : "",
    context: "",
  };
  if (kind === "resident") return {
    operating: "Photon/iMessage is connected and text_captain reaches only this workspace's configured Captain phone. Texting runs on a durable per-channel grant: if this channel is not unlocked yet, calling text_captain automatically shows the Captain a one-time permission question and pauses — never phrase that permission yourself, and never route texts through another agent. Once granted, texting stays unlocked until revoked in channel Settings. For \"monitor X and text me\" requests, build the durable check yourself with schedule_followup or schedule_workflow and call text_captain from the woken run when the condition is true. Send texts that serve what the Captain asked for; never turn a merely useful idea into an unsolicited text.",
    context: `<photon configured="true" connected="${Boolean(photon.connected)}">Outbound texts are restricted to the configured Captain phone. Channel texting requires the Captain's one-time grant.</photon>`,
  };
  return {
    operating: `Photon/iMessage is connected. The text_captain tool reaches only this workspace's configured Captain phone${photon.assigned_phone ? ` from the 1Helm line at ${String(photon.assigned_phone)}` : ""}. When a timely text would genuinely help, you may offer once in natural language. Send when the Captain clearly requests a text, naturally continues an existing text request, or accepts your offer; never turn a merely useful idea into an unsolicited text. For an authorized later reminder, call schedule_followup with a self-contained reason that tells your future wake to call text_captain with the exact reminder. Do not claim Photon is unknown. If and only if text_captain reports that Photon has not activated the configured Captain phone for outbound-first messages, explain that the connector is already connected, ask the Captain to send one text from the configured phone to the 1Helm number shown in Settings → Connections, and retry in this same thread afterward. Do not tell the Captain to reconnect Photon or repeat setup for that activation error.`,
    context: `<photon configured="true" connected="${Boolean(photon.connected)}" assigned_phone="${String(photon.assigned_phone || "")}">Outbound texts are restricted to the configured Captain phone and require clear conversational permission.</photon>`,
  };
}

/** Deterministic "this text mentions texting the Captain" check shared by the
 * followup and workflow authorization stamps. */
export function mentionsCaptainTexting(text: string): boolean {
  return /\btext_captain\b|\b(?:text|iMessage)\s+(?:the\s+)?(?:Captain|user)\b|\b(?:text|message)\s+me\b|\b(?:send|deliver)[\s\S]{0,40}\b(?:text|iMessage)\b/i.test(String(text || ""));
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
  // "text me" anywhere grants consent (negations rejected above): the
  // destination is hard-fixed to the Captain's own phone, so mid-sentence asks
  // like "list the drives - text me when you're done" must not be lawyered
  // away. The lookbehind rejects infinitive mentions ("should be able to text
  // me someday"); imperative infinitive requests ("I want you to text me")
  // have their own rule below.
  if (/(?<!\bto\s)\b(?:text|message)\s+me\b/i.test(current)
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
export async function deliverResidentCaptainText(botId: number, message: string): Promise<string> {
  return deliverCaptainText(photonCaptainOwnerId(), botId, message);
}
