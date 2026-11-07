// The channel computer's Chrome searches with Bing. Google answers searches from the computer's data-center address with its
// image challenge (google.com/sorry), for the person who opens the computer and for a helper using the browser. Measured on
// 2026-11-07 through Cloudflare Browser Run: Bing returned a results page, google.com/search returned "unusual traffic".
// Nothing here solves or avoids a challenge. Searches are sent to an engine that serves results, and google.com stays reachable
// when someone opens it on purpose.
export const COMPUTER_SEARCH = { name: "Bing", host: "www.bing.com", url: "https://www.bing.com/search?q={searchTerms}", suggest: "https://www.bing.com/osjson.aspx?query={searchTerms}", start: "https://www.bing.com/" };

// Chrome managed policy keys (written into the policy file at every wake by browserSetupCmd).
export const SEARCH_POLICY = {
  DefaultSearchProviderEnabled: true, DefaultSearchProviderName: COMPUTER_SEARCH.name, DefaultSearchProviderKeyword: "bing",
  DefaultSearchProviderSearchURL: COMPUTER_SEARCH.url, DefaultSearchProviderSuggestURL: COMPUTER_SEARCH.suggest,
  NewTabPageLocation: COMPUTER_SEARCH.start, HomepageLocation: COMPUTER_SEARCH.start, HomepageIsNewTabPage: false,
};

const isGoogleHost = (h) => /^(www\.)?google\.[a-z.]{2,6}$/.test(h);

// A Google web-search address (google.com/search?q=...) -> the same search on the computer's engine. Anything else is returned unchanged
// (maps, images, mail and other Google pages, and a plain google.com, are left alone).
export function searchUrlFor(url) {
  let u; try { u = new URL(String(url)); } catch { return String(url); }
  if (!/^https?:$/.test(u.protocol) || !isGoogleHost(u.hostname) || u.pathname !== "/search") return String(url);
  const tbm = u.searchParams.get("tbm"), udm = u.searchParams.get("udm");
  if (tbm || (udm && udm !== "14")) return String(url);   // images, news, video and other result types stay on Google
  const q = u.searchParams.get("q"); if (!q) return String(url);
  return COMPUTER_SEARCH.url.replace("{searchTerms}", encodeURIComponent(q).replace(/%20/g, "+"));
}

// A factual note when the tab is on Google's block page, otherwise "".
export function blockedNote(url) {
  let u; try { u = new URL(String(url)); } catch { return ""; }
  if (!isGoogleHost(u.hostname) || !u.pathname.startsWith("/sorry")) return "";
  let q = ""; try { const c = new URL(u.searchParams.get("continue") || ""); q = c.searchParams.get("q") || ""; } catch {}
  return `Google blocked this computer's address with a challenge page (google.com/sorry). The computer's browser searches with ${COMPUTER_SEARCH.name}${q ? `; the same search is ${searchUrlFor(`https://www.google.com/search?q=${encodeURIComponent(q)}`)}` : ""}, and the web_search tool also searches the web.`;
}
