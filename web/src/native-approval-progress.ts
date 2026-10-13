// Only platform-supplied card metadata identifies internal SSH continuation
// input. Never hide a person's message based on its text or a platform-like prefix.
export function nativeResumeInput(card: any): boolean {
  return card?.kind === "handoff" && Array.isArray(card.from) && card.from.some((source: any) => source?.type === "ssh");
}
// Any handoff card (a helper's report, a due follow-up, a browser job result, an app connected, an SSH continuation) starts from
// text written for the model. Only platform card metadata says so, never the text itself. The server already sends no user_text for
// these; this keeps the app from showing it as the person's message if one ever arrives.
export function internalHandoffInput(card: any): boolean {
  return card?.kind === "handoff";
}
export function nativeHandoffText(event: any): string {
  return event?.type === "handoff" && event.from?.type === "ssh"
    ? "You approved an SSH session. The agent can continue using that approved connection."
    : event?.text || "";
}
export function nativeReceiptStatus(a: any): string {
  if (!["ssh", "ssh_hostkey"].includes(a?.perm)) return "pending";
  if (a.status === "approved") return "once";
  if (a.status === "denied") return "deny";
  return ["pending", "consumed", "cancelled", "expired", "failed", "host_key_required"].includes(a.status) ? a.status : "failed";
}
