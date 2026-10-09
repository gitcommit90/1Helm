// Keep server-returned channel and file IDs inside their URL path segments.
export function fileUrl(api, slug, id, download = false) {
  return `${api}/res/${encodeURIComponent(slug)}/files/${encodeURIComponent(id)}${download ? "?dl=1" : ""}`;
}
