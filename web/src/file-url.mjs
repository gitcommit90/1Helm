// Keep server-returned channel and file IDs inside their URL path segments.
// ver: the version a message's card shows (the server keeps every version a reply shared and serves it with ?v=); no ver = the current file.
export function fileUrl(api, slug, id, download = false, ver) {
  const q = [download ? "dl=1" : "", ver ? `v=${encodeURIComponent(String(Number(ver) || ""))}` : ""].filter(Boolean).join("&");
  return `${api}/res/${encodeURIComponent(slug)}/files/${encodeURIComponent(id)}${q ? `?${q}` : ""}`;
}

// File addresses may end in a query such as ?c=<version>, so a path segment or another query value is never added by joining strings.
// urlPath() adds a path segment before the query, and urlQuery() sets query values and keeps what is already there.
const split = (u) => { const h = u.indexOf("#"), rest = h < 0 ? u : u.slice(0, h), hash = h < 0 ? "" : u.slice(h), q = rest.indexOf("?"); return { path: q < 0 ? rest : rest.slice(0, q), query: q < 0 ? "" : rest.slice(q + 1), hash }; };
export function urlQuery(u, add) {
  const p = split(u), sp = new URLSearchParams(p.query);
  for (const [k, v] of Object.entries(add)) if (v !== undefined && v !== null && v !== false) sp.set(k, String(v));
  const q = sp.toString(); return p.path + (q ? `?${q}` : "") + p.hash;
}
export function urlPath(u, segment, add = {}) {
  const p = split(u), seg = segment.replace(/^\/+/, "");
  return urlQuery(`${p.path.replace(/\/+$/, "")}/${seg}${p.query ? `?${p.query}` : ""}${p.hash}`, add);
}
