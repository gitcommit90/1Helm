// Settings → Permissions (live): how often the helper checks first, and everything the person has always allowed.
// The server (1HC perms.js) keeps it per account: GET/POST /api/permissions.
//   Level: Standard (the default: what it always did) · Careful (also asks before reading email, calendar, contacts, files, messages)
//          · Locked down (also asks before running things on its computer, visiting websites, web searches with personal details,
//          starting helpers, scheduling). Every level also asks the first time it fills in their personal details on a website
//          (kind "personal", level "standard").
//   Always allowed: the kinds of action they tapped "Always allow" on (on a permission card), and the sites they always allowed at the
//          checkpoint (per channel). Each has Remove; the next time, the helper asks again.
// v3.ts only hooks in: pmHtml() for the section, pmClick() in the Settings click handler, pmInit() once in live mode.
// Class names: pm* (never "ad…": ad blockers hide those).
type Kind = { id: string; name: string; level: string };
type Level = { id: string; name: string; sub: string };
type View = { level: string; levels: Level[]; kinds: Kind[]; allowed: { kind: string; name: string; at: number }[]; sites: { channel: string; channel_name: string; id: number; host: string; at: number }[] };
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  rerender: () => void;                                     // repaint the Settings section if it's on screen
  note: (title: string, sub: string) => void;
  helper: () => string;
  esc: (s: any) => string;
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  sa: (label: string, attr: string, cls?: string) => string;
  icon: (k: "check" | "globe" | "hand", size?: number) => string;
  logoOver: (host: string, size: number) => string;
};
let D: Deps | null = null;
const P: { v: View | null; err: boolean; loading: boolean; busy: string; at: number } = { v: null, err: false, loading: false, busy: "", at: 0 };
const STALE = 15e3;   // shown again after this long: fetch fresh in the background (an "Always allow" tapped in a chat since)

export function pmInit(d: Deps) { D = d; }
function load(force = false) {
  if (!D || P.loading || (P.v && !force)) return;
  P.loading = true; P.err = false;
  D.api("/permissions").then((v) => { if (v?.error) throw new Error(v.error); P.v = v; P.at = Date.now(); }).catch(() => { P.err = true; }).finally(() => { P.loading = false; D!.rerender(); });
}
const day = (ms: number) => { const d = new Date(Number(ms)); return isNaN(+d) || !ms ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };

export function pmHtml(): string {
  if (!D) return "";
  const { esc, srow, sa, icon } = D, who = esc(D.helper());
  if (!P.v) load(); else if (!P.busy && Date.now() - P.at > STALE) load(true);
  const head = `<h2>Permissions</h2><p class="slead">How often should ${who} check with you first?</p>`;
  if (!P.v) return `${head}<div class="sc">${P.err ? srow("", "Couldn't load", "Check your connection and try again.", sa("Try again", "data-pmretry", "blue")) : srow(`<span class="bico"><i class="apspin"></i></span>`, "Loading…", "", "")}</div>`;
  const v = P.v, busy = P.busy;
  const radio = (l: Level) => { const on = v.level === l.id, wait = busy === `level:${l.id}`;
    return `<button class="sr sradio pmlv${on ? " on" : ""}" role="radio" aria-checked="${on}" data-pmlevel="${esc(l.id)}"${busy ? " disabled" : ""}><span class="srt"><b>${esc(l.name)}${l.id === "standard" ? `<em class="stag">Default</em>` : ""}</b><span>${esc(l.sub)}</span></span><span class="rck">${wait ? `<i class="apspin"></i>` : icon("check")}</span></button>`; };
  // A kind with level "standard" (Fill in your personal details) asks on every level; the others from their level up.
  const asks = v.kinds.filter((k) => k.level === "standard" || (v.level === "locked" ? true : v.level === "careful" ? k.level === "careful" : false));
  const allowed = new Set(v.allowed.map((a) => a.kind));
  const asksLine = asks.length ? `<p class="sfine pmasks">Asks first: ${asks.map((k) => `<span class="pmk${allowed.has(k.id) ? " off" : ""}">${esc(k.name)}${allowed.has(k.id) ? " (always allowed)" : ""}</span>`).join("")}</p>` : "";
  const rm = (attr: string, key: string) => busy === key ? `<span class="pmwait"><i class="apspin"></i></span>` : sa("Remove", attr, "mute");
  const rows = [
    ...v.allowed.map((a) => srow(`<span class="favi pmico">${icon("hand", 16)}</span>`, esc(a.name), `Always allowed${a.at ? ` since ${esc(day(a.at))}` : ""}`, rm(`data-pmrevoke="${esc(a.kind)}"`, `kind:${a.kind}`))),
    ...v.sites.map((s) => srow(`<span class="favi">${icon("globe", 16)}${D!.logoOver(s.host, 38)}</span>`, esc(s.host), `Always allowed to receive data in #${esc(s.channel_name)}`, rm(`data-pmsite="${esc(s.channel)}|${s.id}"`, `site:${s.channel}|${s.id}`))),
  ];
  return `${head}
    <div class="sc" role="radiogroup" aria-label="Permission level">${v.levels.map(radio).join("")}</div>
    ${asksLine}
    <p class="sfine">On every level, ${who} asks before it sends, posts, buys or deletes anything for you.</p>
    <h3>Always allowed</h3>
    <div class="sc">${rows.length ? rows.join("") : srow("", "Nothing yet", "When you tap “Always allow” on a request, it shows up here.", "")}</div>`;
}

// → true when the click was ours.
export function pmClick(t: HTMLElement): boolean {
  if (!D || !P.v) { if (t.closest("[data-pmretry]")) { load(true); D?.rerender(); return true; } return false; }
  const v = P.v, d = D;
  const lv = t.closest<HTMLElement>("[data-pmlevel]");
  if (lv) { const id = lv.dataset.pmlevel!; if (P.busy || id === v.level) return true;
    const was = v.level; v.level = id; P.busy = `level:${id}`; d.rerender();
    d.api("/permissions", { level: id }).then((r) => { if (r?.error) throw new Error(r.error); P.v = r; P.at = Date.now(); const l = r.levels.find((x: Level) => x.id === id);
      d.note(`Permissions: ${l?.name || id}`, id === "standard" ? `${d.helper()} works as before, asking before it sends, posts, buys or deletes anything.` : `${d.helper()} will check with you first, with a card you can answer in one tap.`); })
      .catch(() => { v.level = was; d.note("Couldn't change that", "Check your connection and try again."); })
      .finally(() => { P.busy = ""; d.rerender(); });
    return true; }
  const rk = t.closest<HTMLElement>("[data-pmrevoke]");
  if (rk) { const kind = rk.dataset.pmrevoke!, name = v.allowed.find((a) => a.kind === kind)?.name || kind; if (P.busy) return true;
    P.busy = `kind:${kind}`; d.rerender();
    d.api("/permissions", { revoke: kind }).then((r) => { if (r?.error) throw new Error(r.error); P.v = r; P.at = Date.now(); d.note("Removed", `${d.helper()} will ask before “${name}” again.`); })
      .catch(() => d.note("Couldn't remove that", "Check your connection and try again.")).finally(() => { P.busy = ""; d.rerender(); });
    return true; }
  const rs = t.closest<HTMLElement>("[data-pmsite]");
  if (rs) { const [channel, id] = rs.dataset.pmsite!.split("|"), host = v.sites.find((s) => s.channel === channel && String(s.id) === id)?.host || "that site"; if (P.busy) return true;
    P.busy = `site:${channel}|${id}`; d.rerender();
    d.api("/permissions", { revoke_site: { channel, id: Number(id) } }).then((r) => { if (r?.error) throw new Error(r.error); P.v = r; P.at = Date.now(); d.note("Removed", `${d.helper()} will ask before sending data to ${host} again.`); })
      .catch(() => d.note("Couldn't remove that", "Check your connection and try again.")).finally(() => { P.busy = ""; d.rerender(); });
    return true; }
  if (t.closest("[data-pmretry]")) { load(true); d.rerender(); return true; }
  return false;
}
