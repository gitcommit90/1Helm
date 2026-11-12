// A message over LONG_MESSAGE characters is saved as a Markdown file in the channel and sent as that attachment, so no client ever sees a length refusal.
// The one place the rule lives; Resident.chatStream (every client's way into a turn) and send-later call it. save(bytes, name) stores the text as a normal
// chat upload and gives its file view. → { text, files, title } (title: the start of the pasted text, for naming a new task) | { error, status }.
export const LONG_MESSAGE = 100000, MAX_MESSAGE_FILES = 10, LONG_NAME = "Pasted text.md";
export async function splitLongMessage(text, files, { save, maxBytes, humanBytes, answer = false }) {
  text = String(text ?? ""); files = files || [];
  if (text.length <= LONG_MESSAGE) return { text, files };
  if (answer) return { error: `An answer can be at most ${LONG_MESSAGE.toLocaleString("en-US")} characters.`, status: 400 };
  if (files.length >= MAX_MESSAGE_FILES) return { error: `A message this long is saved as a file, and a message can carry at most ${MAX_MESSAGE_FILES} files. Remove one file and send again.`, status: 400 };
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > maxBytes) return { error: `That text is ${humanBytes(bytes.length)}. The limit is ${humanBytes(maxBytes)} per file.`, status: 413 };
  let f; try { f = await save(bytes, LONG_NAME); } catch (e) { if (e.code === "storage_full") return { error: e.message, status: 507, storage_full: true }; throw e; }
  return { text: "", files: [...files, f.id], title: text.slice(0, 300) };
}
