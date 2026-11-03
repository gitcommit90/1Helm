// Keep server-returned channel and file IDs inside their URL path segments.
// ver: the version a message's card shows (the server keeps every version a reply shared and serves it with ?v=); no ver = the current file.
export function fileUrl(api, slug, id, download = false, ver) {
  const q = [download ? "dl=1" : "", ver ? `v=${encodeURIComponent(String(Number(ver) || ""))}` : ""].filter(Boolean).join("&");
  return `${api}/res/${encodeURIComponent(slug)}/files/${encodeURIComponent(id)}${q ? `?${q}` : ""}`;
}
