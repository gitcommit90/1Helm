// Read a remote response only up to the size this route is willing to hold.
// A Content-Length hint can reject early, but the stream count is authoritative.
export async function cappedResponseBytes(response, maxBytes) {
  const claimed = response.headers.get("content-length");
  if (claimed != null && /^(0|[1-9]\d*)$/.test(claimed) && Number.isSafeInteger(Number(claimed)) && Number(claimed) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) return null;
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function cappedResponseJson(response, maxBytes) {
  const bytes = await cappedResponseBytes(response, maxBytes);
  if (!bytes) return null;
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return null; }
}
