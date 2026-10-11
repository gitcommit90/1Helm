import { Marked } from "marked";
import DOMPurify from "dompurify";
import { settingsLinkHtml } from "./settings-links";

// GFM mistakes SSH user@IP and local-network destinations for email addresses.
// Keep the exception narrow: real email domains and deliberate mailto links
// retain their behavior. IPv6 literals already remain plain in Marked.
function isNetworkDestination(text: string) {
  const at = text.lastIndexOf("@"); if (at < 1) return false;
  const host = text.slice(at + 1).toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && host.split(".").every(part => Number(part) <= 255);
}
const chat = new Marked({ breaks: true, renderer: {
  link(token) {
    const settings = settingsLinkHtml(token.href); if (settings) return settings;
    if (token.autolink && token.href === `mailto:${token.text}` && isNetworkDestination(token.text))
      return this.parser.parseInline(token.tokens);
    return false;
  },
} });
export const chatMarkdown = (text: string) => {
  const html = DOMPurify.sanitize(chat.parse(text, { async: false }));
  if (!/<(?:img|a)\b/.test(html)) return html;
  const root = document.createElement("div"); root.innerHTML = html;
  // Native links preserve keyboard/modifier/touch behavior. Do this after sanitizing,
  // never by interpolating model URLs or intercepting every click in the app.
  for (const link of root.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href")!.trim();
    if (!href || href.startsWith("#") || link.hasAttribute("download") || link.hasAttribute("data-fv")) continue;
    try {
      const url = new URL(href, document.baseURI);
      if (!/^https?:$/.test(url.protocol)) continue;
      // Explicit current-app routes remain in the chat shell, even as absolute URLs.
      if (url.origin === location.origin && url.pathname.replace(/\/$/, "") === location.pathname.replace(/\/$/, "") && url.hash.startsWith("#/")) continue;
      link.target = "_blank"; link.rel = "noopener noreferrer";
    } catch { /* A malformed URL never receives new navigation behavior. */ }
  }
  for (const img of root.querySelectorAll("img")) {
    // Keep deliberate image-link destinations; otherwise clicking opens the original.
    // Only safe web URLs become new links (sanitization already removed unsafe markup).
    let link = img.closest("a");
    const name = img.alt || img.title || "Image";
    const tile = document.createElement("span"); tile.className = "chat-image-tile"; tile.title = name;
    img.replaceWith(tile); tile.append(img);
    if (!link) {
      const src = img.getAttribute("src") || "";
      let safe = false; try { safe = !!src && /^https?:$/.test(new URL(src, document.baseURI).protocol); } catch {}
      if (safe) {
        link = document.createElement("a"); link.href = src; link.target = "_blank"; link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `Open ${name}`); tile.replaceWith(link); link.append(tile);
      }
    }
    link?.classList.add("chat-image-link"); img.loading = "lazy";
    const label = document.createElement("span"); label.className = "chat-image-name"; label.textContent = name; tile.append(label);
  }
  return root.innerHTML;
};
