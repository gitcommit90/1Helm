import { copyToClipboard } from "./msgreply";
const icon = (path: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const COPY = icon('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>');
const COPIED = icon('<path d="m5 12 4 4L19 6"/>');
const FAILED = icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>');
const DOWNLOAD = icon('<path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/>');

// Only call with sanitized message HTML. Build controls with DOM APIs: code text
// never enters an attribute, handler, or a second HTML parse as executable markup.
export function chatCodeHtml(html: string): string {
  if (!html.includes("<code")) return html;
  const root = document.createElement("div"); root.innerHTML = html;
  for (const code of root.querySelectorAll("code")) {
    if (code.closest(".chat-code, button")) continue;
    const pre = code.parentElement?.tagName === "PRE" ? code.parentElement : null;
    // An inline code link stays a link; put both it and Copy in the same box,
    // without nesting a button in the anchor.
    const target = pre || (code.parentElement?.tagName === "A" ? code.parentElement : code);
    const box = document.createElement(pre ? "div" : "span");
    box.className = `chat-code ${pre ? "chat-code-block" : "chat-code-inline"}`;
    const button = document.createElement("button"); button.type = "button";
    button.className = "chat-code-copy"; button.innerHTML = COPY;
    button.setAttribute("aria-label", pre ? "Copy code block" : "Copy code");
    button.title = "Copy exact text";
    target.replaceWith(box); box.append(target, button);
    if (pre) {
      const download = document.createElement("button"); download.type = "button";
      download.className = "chat-code-download"; download.innerHTML = DOWNLOAD;
      download.setAttribute("aria-label", "Download code block"); download.title = "Download exact text as code.txt";
      box.append(download);
    }
  }
  return root.innerHTML;
}

let initialized = false;
export function initChatCodeCopy(note: (title: string, text: string) => void) {
  if (initialized) return; initialized = true;
  document.addEventListener("click", e => {
    const button = (e.target as Element)?.closest<HTMLButtonElement>(".msgs .m.agent .chat-code-download");
    if (!button) return;
    const code = button.parentElement?.querySelector("code"); if (!code) return;
    e.preventDefault(); e.stopPropagation();
    // Local text only: fixed filename, no execution, no server or network request.
    const url = URL.createObjectURL(new Blob([code.textContent || ""], {type:"text/plain;charset=utf-8"}));
    const link = document.createElement("a"); link.href = url; link.download = "code.txt";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.addEventListener("click", async e => {
    const button = (e.target as Element)?.closest<HTMLButtonElement>(".msgs .m.agent .chat-code-copy");
    if (!button || button.disabled) return;
    const code = button.parentElement?.querySelector("code"); if (!code) return;
    e.preventDefault(); e.stopPropagation();
    // Snapshot before awaiting: streaming can replace or update this message.
    const text = code.textContent || "", label = button.getAttribute("aria-label")!;
    button.disabled = true;
    const ok = await copyToClipboard(text);
    button.disabled = false; button.innerHTML = ok ? COPIED : FAILED;
    button.dataset.copyState = ok ? "copied" : "failed";
    button.title = ok ? "Copied to clipboard" : "Copy failed — try again";
    button.setAttribute("aria-label", ok ? "Copied to clipboard" : "Copy failed. Try again");
    let status = document.getElementById("chat-code-status");
    if (!status) {
      status = document.createElement("span"); status.id = "chat-code-status";
      status.className = "sr-only"; status.setAttribute("role", "status"); document.body.append(status);
    }
    status.textContent = ok ? "Code copied to clipboard" : "Copy failed";
    if (!ok) note("Couldn't copy", "Your browser didn't allow copying. Select the text and copy it instead, or try again.");
    setTimeout(() => { if (button.isConnected) { button.innerHTML = COPY; delete button.dataset.copyState; button.title = "Copy exact text"; button.setAttribute("aria-label", label); } }, 1800);
  });
}
