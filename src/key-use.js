// The approval lock for saved keys. A saved key's sites are the places the person has approved for it. When an outgoing request carries a key's value
// (exact or encoded, see vault-scrub.js) or its stand-in to a site that is not on that key's list, Sentinel holds the request and the person decides
// (Allow once, Always allow, Don't allow). Pure code, so it is unit tested.
//
// Unreadable bodies: a body Sentinel cannot read (compressed, binary, or over BODY_SCAN_MAX) could hold a value in a form that cannot be matched. The rule:
// such a body going to a site that is on NO saved key's list is held, naming every saved key as "might be in it". Going to a site that is on some key's
// list it is allowed, because the person has already trusted that site with a key and a hold on every upload to it would stop ordinary work. A request
// with no body, or a readable one, is checked exactly. With no saved keys nothing is held.
import { hostMatch } from "./sentinel-swap.js";

const dec = new TextDecoder("utf-8", { fatal: false });

// → { hold: false } or { hold: true, names: [...], labels: [...], unreadable: boolean }
export function keyUseCheck({ host, url = "", headers, bodyBytes = null, unreadableBody = false, scrubber }) {
  const keys = scrubber?.keys || [];
  if (!keys.length) return { hold: false };
  host = String(host || "").toLowerCase();
  const parts = [url]; for (const [, v] of headers || []) parts.push(v);
  if (bodyBytes && bodyBytes.length) parts.push(dec.decode(bodyBytes));
  const carried = scrubber.find(parts.join("\n"));
  const by = new Map(keys.map((k) => [k.name, k]));
  const bad = carried.filter((n) => by.has(n) && !hostMatch(host, by.get(n).hosts));
  if (bad.length) return { hold: true, names: bad, labels: bad.map((n) => by.get(n).label), unreadable: false };
  if (unreadableBody && !keys.some((k) => hostMatch(host, k.hosts))) return { hold: true, names: keys.map((k) => k.name), labels: keys.map((k) => k.label), unreadable: true };
  return { hold: false };
}
