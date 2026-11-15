// Downloads inside the 1Helm phone apps (iOS and Android). Their web view cannot save a file: a link with the download attribute does
// nothing (Android) or leaves the page (iOS), and a file the page made itself (a blob, e.g. "Download transcript") shows as plain text
// with no way back. The apps do include Capacitor's Browser plugin, which opens an address in the system browser sheet (Safari view
// controller on iOS, a Chrome tab on Android). That sheet downloads and shares files, but it has none of the web view's cookies. So when
// the page runs inside a phone app, a download is turned into: ask the server for a one-file address that expires in a few minutes
// (src/download-links.js), then open that address with Browser.open.
// Everywhere else (normal browsers, the Mac app, a phone app without the Browser plugin) nothing here runs and downloads behave as before.
type Note = (title: string, text: string) => void;
type Job = { kind: "file"; channel: string; file: string; name: string } | { kind: "bytes"; href: string; name: string };

export const MAX_BYTES = 25 * 1024 * 1024;   // the server's limit for one download made from the app
const FILE_PATH = /^\/w\/[a-z0-9-]+\/api\/res\/([a-z0-9][a-z0-9-]{0,62})\/files\/([0-9a-f-]{36})\/?$/;

/** True inside the iOS or Android app when the Browser plugin is there to open the address. */
export function nativeDownloadsAvailable(win: any = window): boolean {
  try { const C = win.Capacitor; return !!C?.isNativePlatform?.() && /^(ios|android)$/.test(String(C.getPlatform?.())) && typeof C.Plugins?.Browser?.open === "function"; } catch { return false; }
}

/** What a link with the download attribute asks for, or null when the page should leave it alone (another site's address, a plain page address). */
export function classifyDownload(href: string, origin: string, nameAttr = ""): Job | null {
  let u: URL; try { u = new URL(href, origin); } catch { return null; }
  const name = (nameAttr || "").trim();
  if (u.protocol === "blob:" || u.protocol === "data:") return { kind: "bytes", href: u.href, name };
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.origin !== origin) return null;
  const m = FILE_PATH.exec(u.pathname);
  // A Library file's current bytes: the server makes the address from the file's id. A kept older version (?v=, ?kept=) or a thumbnail is fetched instead.
  if (m && !u.searchParams.has("v") && !u.searchParams.has("kept") && u.searchParams.get("thumb") !== "1") return { kind: "file", channel: m[1], file: m[2], name };
  return { kind: "bytes", href: u.href, name };
}

/** The file name in a Content-Disposition header, or "". */
export function dispositionName(h: string | null): string {
  if (!h) return "";
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(h);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { /* fall through */ } }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(h);
  return plain ? plain[1].trim() : "";
}

const lastSegment = (href: string) => { try { const s = decodeURIComponent(new URL(href).pathname.split("/").filter(Boolean).pop() || ""); return /^[0-9a-f-]{20,}$/i.test(s) ? "" : s; } catch { return ""; } };

export function initNativeDownloads(api: string, note: Note, win: any = window, doc: Document = document): boolean {
  if (!nativeDownloadsAvailable(win)) return false;
  const origin = win.location.origin;
  let busy = false;
  const open = (url: string) => win.Capacitor.Plugins.Browser.open({ url });
  async function post(path: string, init: RequestInit): Promise<{ url: string }> {
    const r = await fetch(`${api}${path}`, { credentials: "same-origin", method: "POST", ...init });
    const j = await r.json().catch(() => ({} as any));
    if (!r.ok || !j.url) throw new Error(j.error || `The download couldn't start (${r.status}).`);
    return j;
  }
  async function run(job: Job) {
    if (busy) return; busy = true;
    try {
      if (job.kind === "file") {
        open((await post("/download-link", { headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: job.channel, file: job.file }) })).url);
        return;
      }
      const r = await fetch(job.href, { credentials: "same-origin" });
      if (!r.ok) throw new Error(`The file couldn't be read (${r.status}).`);
      const blob = await r.blob();
      if (blob.size > MAX_BYTES) throw new Error(`That file is ${Math.round(blob.size / 1048576)} MB. A download from the app can be up to ${MAX_BYTES / 1048576} MB.`);
      const name = job.name || dispositionName(r.headers.get("content-disposition")) || lastSegment(job.href) || "download";
      open((await post("/download-link/blob", { headers: { "content-type": blob.type || "application/octet-stream", "x-file-name": encodeURIComponent(name) }, body: blob })).url);
    } catch (e: any) { note("Couldn't download", String(e?.message || e).slice(0, 200)); }
    finally { setTimeout(() => { busy = false; }, 600); }
  }
  // A tap on a link that is in the page.
  doc.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[download]") as HTMLAnchorElement | null; if (!a) return;
    const job = classifyDownload(a.href, origin, a.getAttribute("download") || ""); if (!job) return;
    e.preventDefault(); e.stopImmediatePropagation(); void run(job);
  }, true);
  // A link made by the page's own code and clicked with .click() (it is usually not in the page, so no click event reaches the listener above).
  const proto = win.HTMLAnchorElement?.prototype, orig = proto?.click;
  if (proto && orig) proto.click = function (this: HTMLAnchorElement) {
    if (this.hasAttribute("download")) { const job = classifyDownload(this.href, origin, this.getAttribute("download") || ""); if (job) { void run(job); return; } }
    return orig.call(this);
  };
  return true;
}
