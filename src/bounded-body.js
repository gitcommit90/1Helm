// Read small signed requests without buffering an arbitrarily large unauthenticated body.
export class BodyTooLargeError extends Error {}
export class UnsupportedFormTypeError extends Error {}

export async function boundedText(req, maxBytes) {
  const claimed = req.headers.get("content-length");
  if (claimed != null && (!/^(0|[1-9]\d*)$/.test(claimed) || !Number.isSafeInteger(Number(claimed)) || Number(claimed) > maxBytes))
    throw new BodyTooLargeError("request body is too large");
  if (!req.body) return "";
  const reader = req.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new BodyTooLargeError("request body is too large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// Small JSON APIs use this instead of Request.json(), which buffers before an
// application limit can reject a forged or absent Content-Length.
export async function boundedJson(req, maxBytes = 8_000_000) {
  const raw = await boundedText(req, maxBytes);
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

// Our sign-in and onboarding pages submit only URL-encoded fields. Parse them after a
// streaming limit, before FormData can buffer a large unauthenticated multipart body.
export async function boundedForm(req, maxBytes = 8192) {
  if (!/^application\/x-www-form-urlencoded(?:\s*;|\s*$)/i.test(req.headers.get("content-type") || ""))
    throw new UnsupportedFormTypeError("expected URL-encoded form");
  return new URLSearchParams(await boundedText(req, maxBytes));
}
