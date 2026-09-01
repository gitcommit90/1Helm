type Attachment = { id: number; name: string; mime: string; size: number; workspace_path?: string | null };
type AttachmentMessage = { channel_id: number; attachments?: Attachment[] };
type AttachmentUiDeps = {
  h: any;
  icon: (name: string, size?: number) => SVGElement;
  serverAssetUrl: (path: string) => string;
  getToken: () => string;
  stageCoworkPathLazy: (channelId: number, path: string) => void;
  navigateChannelView: (view: "cowork") => void;
  openAuthenticatedFile: (path: string) => Promise<unknown>;
  downloadAuthenticatedFile: (path: string, name: string) => Promise<unknown>;
  appAlert: (message: string) => Promise<unknown> | unknown;
};
let ui: AttachmentUiDeps;
export function configureAttachmentUi(value: AttachmentUiDeps): void { ui = value; }
const h = (tag: string, attrs?: Record<string, unknown>, ...children: any[]): HTMLElement => ui.h(tag, attrs, ...children);
const fmtSize = (n: number): string => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
function coworkAttachmentPath(path: string): string | null {
  const normalized = String(path || "").replace(/^\/?workspace\/?/, "").replace(/^\/+/, "");
  return /^(notes|whiteboards|code|docs|presentations)\//.test(normalized) ? normalized : null;
}

/** Channel timelines never request root-message images. Inside a thread,
 * bounded lazy thumbnails preserve the useful preview while Open/Download
 * still resolves the original attachment. */
export function renderMessageAttachments(message: AttachmentMessage, inThread: boolean): HTMLElement | null {
  if (!message.attachments?.length) return null;
  const visible = inThread ? message.attachments : message.attachments.filter((attachment) => !attachment.mime.startsWith("image/"));
  if (!visible.length) return null;
  return h("div", { class: "attachments mt-1.5 flex flex-wrap gap-2" }, ...visible.map((attachment) => {
    const viewUrl = `/api/files/${attachment.id}`;
    const mediaUrl = `${ui.serverAssetUrl(viewUrl)}?thumbnail=1&token=${encodeURIComponent(ui.getToken())}`;
    const cowork = attachment.workspace_path ? coworkAttachmentPath(attachment.workspace_path) : null;
    const open = (event: MouseEvent): void => { event.stopPropagation(); if (cowork) { ui.stageCoworkPathLazy(message.channel_id, cowork); ui.navigateChannelView("cowork"); } else void ui.openAuthenticatedFile(viewUrl).catch((error) => ui.appAlert((error as Error).message)); };
    const actions = h("div", { class: "flex items-center gap-1 border-t border-line/70 px-2 py-1.5" },
      h("button", { class: "btn-subtle text-xs", type: "button", onclick: open }, cowork ? "Open in Cowork" : "Open"),
      h("button", { class: "btn-subtle text-xs", type: "button", onclick: (event: MouseEvent) => { event.stopPropagation(); void ui.downloadAuthenticatedFile(`${viewUrl}?download=1`, attachment.name).catch((error) => ui.appAlert((error as Error).message)); } }, "Download"));
    if (attachment.mime.startsWith("image/")) return h("article", { class: "overflow-hidden rounded-lg border border-line bg-raised" },
      h("button", { type: "button", class: "block", onclick: open }, h("img", { src: mediaUrl, class: "max-h-64 max-w-full object-contain", alt: attachment.name, loading: "lazy", decoding: "async" })), actions);
    return h("article", { class: "overflow-hidden rounded-lg border border-line bg-raised text-sm" },
      h("button", { type: "button", class: "flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-hover", onclick: open },
        h("span", { class: "grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent" }, ui.icon("file")),
        h("div", { class: "min-w-0" }, h("div", { class: "truncate font-medium text-fg" }, attachment.name), h("div", { class: "text-xs text-muted" }, fmtSize(attachment.size)))), actions);
  }));
}
