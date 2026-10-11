// Settings → Permissions (live): how often the helper checks first, and everything the person has always allowed.
// The server (1HC perms.js) keeps it per account: GET/POST /api/permissions.
//   Level: Standard (default) · Careful (also asks before reading private data)
//          · Locked down (also asks before running things on its computer, visiting websites, web searches with personal details,
//          starting helpers, scheduling). Every level also asks the first time it fills in their personal details on a website
//          (kind "personal", level "standard").
//   Always allowed: the kinds of action they tapped "Always allow" on (on a permission card), and the sites they always allowed at the
//          checkpoint (per channel). Each has Remove; the next time, the helper asks again.
// v3.ts only hooks in: pmHtml() for the section, pmClick() in the Settings click handler, pmInit() once in live mode.
// Class names: pm* (never "ad…": ad blockers hide those).
type Kind = { id: string; name: string; level: string };
type Checkins = { silent: number; fast: number };
type Level = { id: string; name: string; sub: string };
type View = { level: string; levels: Level[]; kinds: Kind[]; direct_protocols?: { ssh: "deny" | "ask" | "trusted" }; allowed: { kind: string; name: string; at: number }[]; sites: { channel: string; channel_name: string; id: number; host: string; at: number }[] };
type Deps = {
  api: (path: string, body?: any) => Promise<any>;
  rerender: () => void;                                     // repaint the Settings section if it's on screen
  note: (title: string, sub: string) => void;
  ask?: (options: { title: string; body: string; confirm: string; danger?: boolean }) => Promise<boolean>;
  helper: () => string;
  esc: (s: any) => string;
  srow: (icon: string, title: string, sub: string, right: string, attrs?: string) => string;
  sa: (label: string, attr: string, cls?: string) => string;
  icon: (k: "check" | "globe" | "hand", size?: number) => string;
  logoOver: (host: string, size: number) => string;
};
let D: Deps | null = null;
const checkinDraft: Partial<Record<keyof Checkins, string>> = {};
let checkinFocus = false;
export function pmFocusCheckins() { checkinFocus = true; pmAfter(); }
export function pmAfter() {
  const section = document.getElementById('pm-checkins');
  if (!checkinFocus || !section) return;
  checkinFocus = false;
  section.scrollIntoView({ block: 'start' }); section.focus({ preventScroll: true });
}
const P: { v: View | null; err: boolean; loading: boolean; busy: string; at: number } = { v: null, err: false, loading: false, busy: "", at: 0 };
const STALE = 15e3;   // shown again after this long: fetch fresh in the background (an "Always allow" tapped in a chat since)
const ranks: Record<string, number> = { standard: 0, careful: 1, locked: 2 };
const asksAt = (level: string, kind: Kind) => kind.id === "personal" || (ranks[level] ?? 0) >= (ranks[kind.level] ?? 99);

export function pmInit(d: Deps) { D = d;
  document.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset?.pmcheckinput as keyof Checkins;
    if (key === 'silent' || key === 'fast') checkinDraft[key] = input.value;
  });
}
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
  const asks = v.kinds.filter((k) => asksAt(v.level, k));
  const allowed = new Set(v.allowed.map((a) => a.kind));
  const asksLine = asks.length ? `<p class="sfine pmasks">Asks first: ${asks.map((k) => `<span class="pmk${allowed.has(k.id) ? " off" : ""}">${esc(k.name)}${allowed.has(k.id) ? " (always allowed)" : ""}</span>`).join("")}</p>` : "";
  const rm = (attr: string, key: string) => busy === key ? `<span class="pmwait"><i class="apspin"></i></span>` : sa("Remove", attr, "mute");
  const rows = [
    ...v.allowed.map((a) => srow(`<span class="favi pmico">${icon("hand", 16)}</span>`, esc(a.name), `Always allowed${a.at ? ` since ${esc(day(a.at))}` : ""}`, rm(`data-pmrevoke="${esc(a.kind)}"`, `kind:${a.kind}`))),
    ...v.sites.map((s) => srow(`<span class="favi">${icon("globe", 16)}${D!.logoOver(s.host, 38)}</span>`, esc(s.host), `Always allowed to receive data in #${esc(s.channel_name)}`, rm(`data-pmsite="${esc(s.channel)}|${s.id}"`, `site:${s.channel}|${s.id}`))),
  ];
  return `${head}
    <div class="sc" role="radiogroup" aria-label="Permission level">${v.levels.filter(l => Object.hasOwn(ranks, l.id)).map(radio).join("")}</div>
    ${asksLine}
    <p class="sfine">Connected-app actions and website requests can require approval, including spending and unclassified actions. Saved “Always allowed” exceptions still apply. Separate checkout and publish confirmations remain in place.</p>
    <section id="pm-checkins" tabindex="-1" aria-labelledby="pm-checkins-title">
      <h3 id="pm-checkins-title">Agent check-ins</h3>
      <p class="sfine">Choose when work pauses to check with you. Applies across this account, starting with the next turn (including Keep going). Defaults: 15 calls before the first update, and 20 calls within 60 seconds.</p>
      <div class="sc">${(['silent', 'fast'] as const).map(key => {
        const saved = esc(String(checkinDraft[key] ?? (v as View & { agent_checkins?: Checkins }).agent_checkins?.[key] ?? (key === 'silent' ? 15 : 20)));
        return `<div class="sr pmcheckrow"><label class="srt" for="pm-checkin-${key}"><b>${key === 'silent' ? 'Before the first update' : 'Within 60 seconds'}</b><span>${key === 'silent' ? 'Pause after this many tool calls without an update from your agent.' : 'Pause after this many tool calls in a rolling 60-second window, even if your agent has given an update.'}</span></label><div class="pmcheckcontrol"><input id="pm-checkin-${key}" data-pmcheckinput="${key}" type="number" min="1" max="1000" step="1" value="${saved}" aria-label="${key === 'silent' ? 'Tool calls before the first update' : 'Tool calls within 60 seconds'}"${busy ? ' disabled' : ''}><button type="button" class="sa" data-pmchecksave="${key}"${busy ? ' disabled' : ''}>${busy === `checkin:${key}` ? 'Saving…' : 'Save'}</button></div></div>`;
      }).join('')}</div>
      <p class="sfine">Reading agent references and to-do bookkeeping don't count. A visible to-do list, reaction or message counts as an update. Other pause rules, spending limits and approval controls are unchanged.</p>
    </section>
    <h3>Direct network protocols</h3>
    <p class="sfine">Outbound SSH runs from the agent's 1HC computer. This account setting applies to every channel computer.</p>
    <div class="sc" role="radiogroup" aria-label="Outbound SSH">${([['deny', 'Deny', 'Block SSH. Selecting Deny also cancels pending requests and closes active managed SSH sessions.'], ['ask', 'Ask each time', 'Each new SSH session needs your approval, including reconnects.'], ['trusted', 'Allow trusted servers', 'Choose which servers to trust on their approval cards. This computer can reconnect to those exact destinations without asking again. New or changed destinations still need approval.']] as const).map(([id, label, sub]) => `<button type="button" class="sr sradio${(v.direct_protocols?.ssh || 'deny') === id ? ' on' : ''}" role="radio" aria-checked="${(v.direct_protocols?.ssh || 'deny') === id}" data-pmssh="${id}"${busy ? ' disabled' : ''}><span class="srt"><b>Outbound SSH · ${label}${id === 'deny' ? '<em class="stag">Default</em>' : ''}</b><span>${sub}</span></span><span class="rck">${busy === `ssh:${id}` ? '<i class="apspin"></i>' : icon('check')}</span></button>`).join('')}</div>
    <p class="sfine">SSH permits remote commands and SFTP using the remote account's permissions. Trust is saved separately for each channel computer, server address, port, username, route and verified server identity. Other approval settings are unchanged. Manage saved servers, public keys and sessions in Connected accounts → Computer connections.</p>
    <h3>Always allowed</h3>
    <div class="sc">${rows.length ? rows.join("") : srow("", "Nothing yet", "When you tap “Always allow” on a request, it shows up here.", "")}</div>`;
}

// → true when the click was ours.
export function pmClick(t: HTMLElement): boolean {
  if (!D || !P.v) { if (t.closest("[data-pmretry]")) { load(true); D?.rerender(); return true; } return false; }
  const v = P.v, d = D;
  const checkin = t.closest<HTMLElement>('[data-pmchecksave]');
  if (checkin) {
    if (P.busy) return true;
    const key = checkin.dataset.pmchecksave as keyof Checkins;
    if (!['silent', 'fast'].includes(key)) return true;
    const input = document.getElementById(`pm-checkin-${key}`) as HTMLInputElement | null;
    const value = input?.valueAsNumber;
    if (!input || !Number.isInteger(value) || !input.reportValidity()) { d.note('Choose a whole number', 'Enter a number from 1 to 1000.'); return true; }
    P.busy = `checkin:${key}`; d.rerender();
    d.api('/permissions', { agent_checkins: { [key]: value } }).then(r => {
      if (r?.error || r?.agent_checkins?.[key] !== value) throw new Error(r?.error || 'The server did not confirm this change.');
      delete checkinDraft[key]; P.v = r; P.at = Date.now(); d.note('Check-in updated', 'Applies from the next turn, including Keep going.');
    }).catch(err => d.note("Couldn't save the check-in", err.message || 'Try again.'))
      .finally(() => { P.busy = ''; d.rerender(); });
    return true;
  }
  const ssh = t.closest<HTMLElement>("[data-pmssh]");
  if (ssh) {
    const choice = ssh.dataset.pmssh;
    // Deny is also a retryable termination action after a partial broker failure.
    if (P.busy || !["deny", "ask", "trusted"].includes(choice || "") || (choice !== "deny" && choice === v.direct_protocols?.ssh)) return true;
    P.busy = `ssh:${choice}`; d.rerender();
    d.api("/permissions", { direct_protocols: { ssh: choice } }).then(r => {
      if (r?.error) throw new Error(r.error);
      if (r?.direct_protocols?.ssh !== choice) throw new Error("The server did not confirm the SSH permission change. Refresh and try again.");
      P.v = r; P.at = Date.now();
      d.note(`Outbound SSH: ${choice === "trusted" ? "Allow trusted servers" : choice === "ask" ? "Ask each time" : "Deny"}`, choice === "trusted" ? "Choose Approve & trust server on a connection request to allow that computer to reconnect. Other permission settings are unchanged." : choice === "ask" ? "Each new SSH session requires your approval." : "Pending SSH requests are cancelled and managed SSH sessions are closed.");
    }).catch(err => d.note("Couldn't change SSH permission", err.message || "Check your connection and try again."))
      .finally(() => { P.busy = ""; d.rerender(); });
    return true;
  }
  const lv = t.closest<HTMLElement>("[data-pmlevel]");
  if (lv) { const id = lv.dataset.pmlevel!; if (P.busy || id === v.level || !Object.hasOwn(ranks, id) || !v.levels.some(l => l.id === id)) return true;
    P.busy = `level:${id}`; d.rerender();
    void (async () => {
      try {
        const r = await d.api("/permissions", { level: id });
        if (r?.error) throw new Error(r.error);
        if (r?.level !== id) throw new Error("The server did not confirm this permission level. Refresh and try again.");
        P.v = r; P.at = Date.now(); const l = r.levels.find((x: Level) => x.id === id);
        d.note(`Permissions: ${l?.name || id}`, id === "standard" ? "Standard permission checks are restored across all channels. Saved “Always allowed” exceptions still apply. SSH controls are unchanged." : "Additional permission checks are enabled across all channels. Saved exceptions still apply; SSH controls are unchanged.");
      } catch (err: any) { d.note("Couldn't change that", err.message || "Check your connection and try again."); }
      finally { P.busy = ""; d.rerender(); }
    })();
    return true; }
  const rk = t.closest<HTMLElement>("[data-pmrevoke]");
  if (rk) { const kind = rk.dataset.pmrevoke!, name = v.allowed.find((a) => a.kind === kind)?.name || kind; if (P.busy) return true;
    P.busy = `kind:${kind}`; d.rerender();
    d.api("/permissions", { revoke: kind }).then((r) => { if (r?.error) throw new Error(r.error); P.v = r; P.at = Date.now(); const k = r.kinds.find((k: Kind) => k.id === kind); d.note("Removed", k && asksAt(r.level, k) ? `${d.helper()} will ask before “${name}” again.` : "Saved exception removed. Your current permission level still permits this action without that prompt."); })
      .catch(() => d.note("Couldn't remove that", "Check your connection and try again.")).finally(() => { P.busy = ""; d.rerender(); });
    return true; }
  const rs = t.closest<HTMLElement>("[data-pmsite]");
  if (rs) { const [channel, id] = rs.dataset.pmsite!.split("|"), host = v.sites.find((s) => s.channel === channel && String(s.id) === id)?.host || "that site"; if (P.busy) return true;
    P.busy = `site:${channel}|${id}`; d.rerender();
    d.api("/permissions", { revoke_site: { channel, id: Number(id) } }).then((r) => { if (r?.error) throw new Error(r.error); P.v = r; P.at = Date.now(); d.note("Removed", `Saved exception for ${host} removed. Future requests follow the website's permission rules.`); })
      .catch(() => d.note("Couldn't remove that", "Check your connection and try again.")).finally(() => { P.busy = ""; d.rerender(); });
    return true; }
  if (t.closest("[data-pmretry]")) { load(true); d.rerender(); return true; }
  return false;
}
