// Company and site logos (logo.dev, through 1HC's public GET /logo/<domain>?size=64|128). One rule everywhere: the logo is
// drawn OVER the fallback that was already there (the letter tile or icon). Once it loads it covers the fallback; if it
// fails (no logo, a bad domain, off, offline, the design sandbox where /logo/ doesn't exist) it removes itself and the old
// tile shows. A miss is remembered in this browser for a week so we don't ask logo.dev again. width/height are set (no
// layout shift), loading is lazy, and the logo sits on its own white chip in light and dark mode alike, so one image
// works for both themes (logo.dev logos are made for light backgrounds).

// Personal mailbox and ISP domains: their logo says nothing about a person, so contacts never show one.
export const PERSONAL = new Set(("gmail.com googlemail.com outlook.com hotmail.com hotmail.co.uk live.com msn.com yahoo.com yahoo.co.uk ymail.com rocketmail.com " +
  "icloud.com me.com mac.com aol.com proton.me protonmail.com pm.me gmx.com gmx.de gmx.net web.de mail.com zoho.com zohomail.com yandex.com yandex.ru " +
  "fastmail.com hey.com tutanota.com tuta.io duck.com comcast.net verizon.net att.net sbcglobal.net bellsouth.net cox.net charter.net earthlink.net " +
  "optonline.net frontier.com windstream.net btinternet.com sky.com virginmedia.com orange.fr free.fr laposte.net qq.com 163.com 126.com naver.com").split(" "));
const PRIVATE_TLD = new Set(["local", "localhost", "internal", "intranet", "lan", "home", "corp", "test", "example", "invalid", "arpa", "onion", "localdomain"]);

/** "https://www.Costco.com/login" → "costco.com"; "" for anything that isn't a public hostname (same rules as 1HC). */
export function logoDomain(input: string | null | undefined): string {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s || s.length > 300) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^/@?#]*@/, "").split(/[/?#\\]/)[0].replace(/:\d*$/, "").replace(/\.$/, "").replace(/^\*\./, "").replace(/^www\d?\./, "");
  if (s.length < 4 || s.length > 253) return "";
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(s)) return "";
  return PRIVATE_TLD.has(s.slice(s.lastIndexOf(".") + 1)) ? "" : s;
}
/** The work domain of an email address, or "" for a personal mailbox (gmail, outlook, icloud…). */
export function workDomain(email: string | null | undefined): string {
  const d = logoDomain(String(email || "").split("@")[1] || "");
  return d && !PERSONAL.has(d) ? d : "";
}

const MISS = "lgmiss:", WEEK = 7 * 864e5;
function missed(d: string) { try { const t = +(localStorage.getItem(MISS + d) || 0); return t > 0 && Date.now() - t < WEEK; } catch { return false; } }
/** /logo/<domain>?size=… (64 for anything shown up to ~32px, 128 above), or "" when there's nothing to ask for. */
export function logoUrl(site: string, size: 64 | 128 = 64): string {
  const d = logoDomain(site); return d && !missed(d) ? `/logo/${d}${size === 64 ? "" : `?size=${size}`}` : "";
}
// onerror: drop the logo (the fallback under it shows) and remember the miss. Only [a-z0-9.-] ever reaches this string.
const fail = (d: string, drop: string) => `${drop}.remove();try{localStorage.setItem('${MISS}${d}',Date.now())}catch(e){}`;

/** A logo laid over an existing tile (the tile needs class "lgo-host" or position:relative + overflow:hidden). */
export function logoOver(site: string, px: number): string {
  const d = logoDomain(site), src = logoUrl(d, px > 40 ? 128 : 64); if (!src) return "";
  return `<img class="lgo" src="${src}" alt="" width="${px}" height="${px}" loading="lazy" decoding="async" onerror="${fail(d, "this")}">`;
}
/** A small inline logo chip next to text (a host name, an email). Gone entirely on error. */
export function logoChip(site: string, px = 16): string {
  const d = logoDomain(site), src = logoUrl(d, 64); if (!src) return "";
  return `<span class="lgc" style="width:${px}px;height:${px}px"><img src="${src}" alt="" width="${px}" height="${px}" loading="lazy" decoding="async" onerror="${fail(d, "this.parentNode")}"></span>`;
}

// App logos (Composio apps: Settings → Connected accounts, the in-chat connect card, the Apps list, app detail). One rule everywhere:
// the app's initial on a tinted tile shows at once, and the logo fades in over it once it has loaded; if it fails it removes itself
// and the tile stays. Live asks 1HC's /applogo/<app> (Composio's logo, cached at Cloudflare and in R2), never logos.composio.dev
// directly, which can take 10+ s on a cold logo or stall (10-08: the connect card still asked it and sat as an empty white box).
// The fade-in is an inline onload, set before the image starts loading, so a cached or already-complete image can't miss it.
// A logo this page has already shown is drawn without the fade on every repaint (no blink).
export const LOGO_OK = new Set<string>();
const LIVE_APP = !!(window as any).__1HC;
/** A Composio logo URL (or a bare app slug) → the URL to load: /applogo/<app> on live, as given in the design sandbox. */
export const appLogoSrc = (logo: string) => {
  const s = /^[a-z0-9_-]{1,64}$/i.test(logo || "") ? `https://logos.composio.dev/api/${logo}` : logo || "";
  const m = /^https:\/\/logos\.composio\.dev\/api\/([a-z0-9_-]{1,64})$/i.exec(s); return LIVE_APP && m ? `/applogo/${m[1].toLowerCase()}` : s;
};
const tintOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const escA = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
/** The tile + logo. cls sizes it (e.g. "bico", "cxo-logo", "aplogo", "apdlogo"); px is the img's intrinsic size hint. */
export function appLogo(logo: string, name: string, cls = "", px = 24, lazy = false): string {
  const src = appLogoSrc(logo), seen = LOGO_OK.has(src), ch = escA(((name || "?").trim()[0] || "?").toUpperCase());
  return `<span class="${cls} cxlogo" style="--h:${tintOf(name || "")}"><b aria-hidden="true">${ch}</b>${src ? `<img class="${seen ? "in" : ""}" src="${escA(src)}" alt="" width="${px}" height="${px}"${lazy && !seen ? ` loading="lazy"` : ""} decoding="${seen ? "sync" : "async"}" onload="this.classList.add('in')" onerror="this.remove()">` : ""}</span>`;
}
// Remember every app logo that has loaded (capture: load doesn't bubble), so repaints draw it without the fade.
document.addEventListener("load", e => { const t = e.target; if (t instanceof HTMLImageElement && t.parentElement?.classList.contains("cxlogo")) { LOGO_OK.add(t.getAttribute("src") || ""); t.classList.add("in"); } }, true);
/** Preload logos as soon as a list arrives. */
export const logoWarm = (list: { logo: string }[]) => { for (const a of list) { const src = appLogoSrc(a.logo); if (src && !LOGO_OK.has(src)) { const i = new Image(); i.onload = () => LOGO_OK.add(src); i.src = src; } } };
