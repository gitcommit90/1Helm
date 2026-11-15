// Local-only import preparation. The source file and full photos never leave this
// browser; decoding, parsing, planning and resizing do not occupy the UI thread.
import { readContactsFile, decodeBytes, planContacts, type Existing } from "./contacts-parse.ts";

async function thumbnail(ph: { mime: string; b64: string }): Promise<string | undefined> {
  const bin = atob(ph.b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: ph.mime }));
  try {
    const s = Math.min(bmp.width, bmp.height), cv = new OffscreenCanvas(96, 96), g = cv.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, 96, 96); g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 96, 96);
    const blob = await cv.convertToBlob({ type: "image/jpeg", quality: .8 });
    const raw = new Uint8Array(await blob.arrayBuffer()); let binary = "";
    for (const b of raw) binary += String.fromCharCode(b);
    const url = "data:image/jpeg;base64," + btoa(binary);
    return url.length < 24000 ? url : undefined;
  } finally { bmp.close(); }
}

self.onmessage = async (event: MessageEvent<{ name: string; bytes: ArrayBuffer; existing: Existing[]; me: { name?: string; email?: string } }>) => {
  try {
    const { name, bytes, existing, me } = event.data;
    self.postMessage({ type: "progress", phase: "contacts" });
    const parsed = readContactsFile(name, decodeBytes(bytes));
    if ("error" in parsed) throw new Error(parsed.error);
    const plan = planContacts(parsed.kind, parsed.rows, existing, me);
    if ("error" in plan) throw new Error(plan.error);
    const photos = plan.rows.filter(r => r.c.photo);
    if (photos.length && (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function")) throw new Error("This browser can't prepare contact photos in the background. Update your browser and try again. Nothing has been imported.");
    for (let i = 0; i < photos.length; i++) {
      if (i % 10 === 0) self.postMessage({ type: "progress", phase: "photos", done: i, total: photos.length });
      // A corrupt or unsupported individual photo never drops the contact.
      photos[i].photo = await thumbnail(photos[i].c.photo!).catch(() => undefined);
      photos[i].c.photo = null;
    }
    self.postMessage({ type: "done", plan });
  } catch (error) { self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Couldn't read that file. Try exporting it again." }); }
};
