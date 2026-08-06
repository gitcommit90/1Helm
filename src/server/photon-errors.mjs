/** Return only bounded, user-actionable Photon errors across the sidecar
 * boundary. Unknown provider details stay private and collapse to a generic
 * failure; known recipient activation failures explain the one useful fix. */
export function publicPhotonError(error) {
  const seen = new Set();
  const parts = [];
  let current = error;
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth++) {
    seen.add(current);
    parts.push(String(current?.message || current));
    current = current?.cause;
  }
  const detail = parts.join(" ");
  if (/Target not allowed for this project/i.test(detail)) {
    return "Photon has not activated the configured Captain phone for outbound-first messages yet. Send one text from that phone to the 1Helm number shown in Settings → Connections, then ask Skipper to try again.";
  }
  return "Photon operation failed";
}
