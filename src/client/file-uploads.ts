type UploadedFile = { token: string; name: string; mime: string; size: number };

export type ResidentFileUploadSnapshot = {
  id: number;
  channelId: number;
  channelName: string;
  path: string;
  state: "queued" | "uploading" | "importing" | "complete" | "failed";
  fileName: string;
  fileIndex: number;
  fileCount: number;
  bytesSent: number;
  bytesTotal: number;
  error: string;
};

type ResidentFileUploadBatch = ResidentFileUploadSnapshot & {
  files: File[];
  origin: HTMLElement;
  wasBackgrounded: boolean;
  onComplete?: () => void | Promise<void>;
  uploadFile: (file: File, onProgress: (sent: number, total: number) => void) => Promise<UploadedFile>;
  importFile: (upload: UploadedFile, path: string) => Promise<void>;
};

const batches = new Map<number, ResidentFileUploadBatch>();
const listeners = new Set<(uploads: ResidentFileUploadSnapshot[]) => void>();
let nextBatchId = 1;
let indicator: HTMLElement | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, unknown> = {}, ...children: Array<Node | string | null>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (key === "class") node.className = String(value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") (node as unknown as Record<string, unknown>)[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

function publicSnapshots(): ResidentFileUploadSnapshot[] {
  return [...batches.values()].map(({ files: _files, origin: _origin, wasBackgrounded: _wasBackgrounded, onComplete: _onComplete, ...snapshot }) => ({ ...snapshot }));
}

function percent(batch: ResidentFileUploadSnapshot): number {
  if (batch.bytesTotal > 0) return Math.max(0, Math.min(100, Math.round((batch.bytesSent / batch.bytesTotal) * 100)));
  return batch.fileCount ? Math.round((Math.max(0, batch.fileIndex - 1) / batch.fileCount) * 100) : 0;
}

function locationLabel(batch: ResidentFileUploadSnapshot): string {
  return `#${batch.channelName} · /workspace${batch.path ? `/${batch.path}` : ""}`;
}

function dismiss(batchId: number): void {
  batches.delete(batchId);
  notify();
}

/** Re-evaluate whether an upload has left its originating Files surface. The
 * app calls this after navigation; progress events call it while bytes move. */
export function refreshResidentFileUploadIndicator(): void {
  for (const batch of batches.values()) {
    if (!batch.origin.isConnected) batch.wasBackgrounded = true;
  }
  const visible = [...batches.values()].filter((batch) => !batch.origin.isConnected && (
    batch.state === "queued" || batch.state === "uploading" || batch.state === "importing" || batch.wasBackgrounded
  ));
  if (!visible.length) { indicator?.remove(); indicator = null; return; }
  if (!indicator) {
    indicator = element("aside", { class: "resident-upload-indicator", dataset: { residentUploadIndicator: "" }, role: "status", "aria-live": "polite", "aria-label": "Background file uploads" });
    document.body.append(indicator);
  }
  indicator.replaceChildren();
  indicator.append(element("div", { class: "resident-upload-heading" }, visible.some((batch) => batch.state === "uploading" || batch.state === "importing" || batch.state === "queued") ? "File uploads" : "File upload"));
  for (const batch of visible.slice(-3).reverse()) {
    const progress = percent(batch);
    const active = batch.state === "queued" || batch.state === "uploading" || batch.state === "importing";
    const title = batch.state === "complete"
      ? `Uploaded ${batch.fileCount} item${batch.fileCount === 1 ? "" : "s"}`
      : batch.state === "failed"
        ? "Upload failed"
        : batch.state === "importing"
          ? `Finishing ${batch.fileIndex} of ${batch.fileCount}`
          : `Uploading ${batch.fileIndex} of ${batch.fileCount}`;
    const detail = batch.state === "failed" ? batch.error : batch.state === "complete" ? locationLabel(batch) : `${batch.fileName} · ${locationLabel(batch)}`;
    indicator.append(element("section", { class: "resident-upload-card", dataset: { residentUploadState: batch.state, residentUploadBatch: String(batch.id) } },
      element("div", { class: "resident-upload-copy" }, element("strong", {}, title), element("span", { title: detail }, detail)),
      active ? element("div", { class: "resident-upload-progress", "aria-label": `${progress}% uploaded` }, element("i", { style: `width:${progress}%` })) : null,
      element("div", { class: "resident-upload-foot" },
        element("span", {}, batch.state === "uploading" ? `${progress}%` : batch.state === "importing" ? "Saving to the resident computer…" : batch.state === "complete" ? "Finished" : batch.state === "failed" ? "Not uploaded" : "Waiting…"),
        batch.state === "failed" ? element("button", { type: "button", onclick: () => dismiss(batch.id) }, "Dismiss") : null)));
  }
}

function notify(): void {
  const snapshots = publicSnapshots();
  for (const listener of listeners) listener(snapshots);
  refreshResidentFileUploadIndicator();
}

export function subscribeResidentFileUploads(listener: (uploads: ResidentFileUploadSnapshot[]) => void): () => void {
  listeners.add(listener);
  listener(publicSnapshots());
  return () => listeners.delete(listener);
}

async function run(batch: ResidentFileUploadBatch): Promise<void> {
  let completedBytes = 0;
  try {
    for (let index = 0; index < batch.files.length; index++) {
      const file = batch.files[index];
      batch.state = "uploading";
      batch.fileName = file.name;
      batch.fileIndex = index + 1;
      batch.bytesSent = completedBytes;
      notify();
      const upload = await batch.uploadFile(file, (sent) => {
        batch.bytesSent = Math.min(batch.bytesTotal, completedBytes + sent);
        notify();
      });
      batch.state = "importing";
      batch.bytesSent = Math.min(batch.bytesTotal, completedBytes + file.size);
      notify();
      await batch.importFile(upload, batch.path);
      completedBytes += file.size;
      batch.bytesSent = completedBytes;
      notify();
    }
    batch.state = "complete";
    batch.fileName = "";
    batch.files = [];
    notify();
    await batch.onComplete?.();
    // Keep the finished batch briefly even when completion wins the race with
    // navigation; a just-detached origin can still surface the confirmation.
    window.setTimeout(() => dismiss(batch.id), 6000);
  } catch (error) {
    batch.state = "failed";
    batch.error = (error as Error).message || "The upload failed.";
    batch.files = [];
    notify();
  }
}

export function startResidentFileUploads(input: {
  channelId: number;
  channelName: string;
  path: string;
  files: File[];
  origin: HTMLElement;
  onComplete?: () => void | Promise<void>;
  uploadFile: ResidentFileUploadBatch["uploadFile"];
  importFile: ResidentFileUploadBatch["importFile"];
}): number | null {
  if (!input.files.length) return null;
  const id = nextBatchId++;
  const batch: ResidentFileUploadBatch = {
    id,
    channelId: input.channelId,
    channelName: input.channelName,
    path: input.path,
    state: "queued",
    fileName: input.files[0]?.name || "file",
    fileIndex: 1,
    fileCount: input.files.length,
    bytesSent: 0,
    bytesTotal: input.files.reduce((total, file) => total + file.size, 0),
    error: "",
    files: input.files.slice(),
    origin: input.origin,
    wasBackgrounded: false,
    onComplete: input.onComplete,
    uploadFile: input.uploadFile,
    importFile: input.importFile,
  };
  batches.set(id, batch);
  notify();
  void run(batch);
  return id;
}

export function bindResidentFileUploads(input: {
  channelId: number;
  channelName: () => string;
  path: () => string;
  fileInput: HTMLInputElement;
  status: HTMLElement;
  origin: HTMLElement;
  uploadFile: ResidentFileUploadBatch["uploadFile"];
  importFile: ResidentFileUploadBatch["importFile"];
  onComplete: () => void | Promise<void>;
}): void {
  subscribeResidentFileUploads((uploads) => {
    const batch = uploads.filter((upload) => upload.channelId === input.channelId && upload.state !== "complete").at(-1);
    if (!batch) return;
    if (batch.state === "failed") { input.status.textContent = `Upload failed · ${batch.error}`; return; }
    const progress = batch.bytesTotal ? Math.round((batch.bytesSent / batch.bytesTotal) * 100) : 0;
    input.status.textContent = batch.state === "importing" ? `Finishing ${batch.fileIndex} of ${batch.fileCount}…` : `Uploading ${batch.fileIndex} of ${batch.fileCount} · ${progress}%`;
  });
  input.fileInput.onchange = () => {
    const files = Array.from(input.fileInput.files || []);
    if (!files.length) return;
    const path = input.path();
    input.fileInput.value = "";
    startResidentFileUploads({ channelId: input.channelId, channelName: input.channelName(), path, files, origin: input.origin, uploadFile: input.uploadFile, importFile: input.importFile, onComplete: input.onComplete });
  };
}
