// Background memory job 3: the nightly reflection (Muse's "Dreaming", reflect + verify_reflect), run by General at night in the
// person's time zone. From the person's raw recent words across channels (never from the previous reflection: old conclusions fade),
// ONE pinned Notebook entry in General, "How to work with <first name>", replaced each night, ≤ 1,500 characters, every line backed
// by the person's quotes in the verify step. Every channel's prompt shows it with the pinned rows (the per-person block).
import { forgottenEntries, redactTurns } from "./forget.js";
import { WINDOW, clip, one, parseJson, looksSecret, when, labelTurns, renderTurns, citeTurn, RUN, COMMON, verifyClaims, stepper, skippedRun } from "./memjobs-core.js";

export const REFLECT_ID = "reflect-how", REFLECT_MAX = 1500, REFLECT_LOOKBACK_MS = 3 * 86400e3;
export function reflectPrompt({ L, tz, now, first }) {
  const who = first || "the person";
  const sys = `${RUN("reflect", first)}
This is the nightly reflection. From ${who}'s own recent words across their channels, write short working guidance for yourself: how to work with ${who}. It is pinned in every channel's instructions tomorrow.
Reflect only from the raw turns below. There is no earlier reflection to build on: older conclusions fade unless these words support them again.
Look for, in order: how ${who} wants to be spoken to (length, tone, directness, format); how they like work done (ask first or just do it, how much detail, what to confirm); corrections ${who} made to the helper (a correction is theirs, never something you caught); standing preferences and lines they drew; what they care about and are trying to get done these days.
- Guidance, not commentary: each claim is one sentence a working helper can act on ("Keep replies short; Sam skims on the phone."), at most 200 characters. 3 to 8 claims, most useful first.
- No details that belong to one project or channel (clients, amounts, file names, addresses, people's private facts): this is shown in every channel.
- Never label health, mood, romance or dependency; a sensitive trait only in ${who}'s explicit words. Never suggest messaging ${who} unprompted or being more proactive.
- Each claim cites 1 to 3 exact quotes from ${who}'s words (turn label + quote). If the words don't support real guidance, answer no_change.
${COMMON}

Shape:
{"status":"changes" | "no_change","checked":"one line","claims":[{"text":"one sentence of guidance","quotes":[{"turn":"T4","quote":"exact words"}]}]}`;
  return [{ role: "system", content: sys }, { role: "user", content: `Now: ${when(now, tz)} (${tz}).\n\n${who}'s recent turns (all channels, oldest first):\n${renderTurns(L, tz, { cross: true })}` }];
}


// ---------- 3. nightly reflection ----------
export function assembleReflection(first, claims, max = REFLECT_MAX) {
  const head = `How to work with ${first || "them"}`;
  let s = head;
  for (const c of claims) { const line = `\n- ${one(c.text)}`; if (s.length + line.length > max) break; s += line; }
  return s;
}
export async function reflect(host, run, o) {
  const now = host.now(), tz = host.tz(), first = await host.first();
  const since = o.since != null ? o.since : now - REFLECT_LOOKBACK_MS;
  const turns = await host.crossTurns(since, WINDOW.reflect.turns);   // raw turns only: the previous reflection is never read
  const L = labelTurns(turns, { chars: WINDOW.reflect.chars, replyChars: 300 });
  if (!L.length) return { status: "no_change", why: "no turns from the person in the last days", from: since, to: now, turns: 0 };
  const base = { from: since, to: L.at(-1).at, turns: L.length };
  const ask = stepper(host, run);
  const w = await ask("reflect", "write", reflectPrompt({ L, tz, now, first }));
  if (w.skipped) return skippedRun(w.skipped, base);
  const j = parseJson(w.text);
  if (!j) throw new Error("reflect: the write step's reply wasn't JSON");
  const raw = j.status === "no_change" || !Array.isArray(j.claims) ? [] : j.claims.slice(0, 10);
  const dropped = [], cand = [];
  raw.forEach((c, i) => {
    const text = clip(one(c?.text), 220); if (!text) return;
    if (host.forgotten?.(text) || (Array.isArray(c?.quotes) ? c.quotes : []).some((q) => host.forgotten?.(q?.quote))) { dropped.push({ why: "matches something the person asked to forget" }); return; }
    const cites = (Array.isArray(c?.quotes) ? c.quotes : []).slice(0, 3).map((q) => { const t = citeTurn(L, q?.turn, one(q?.quote)); return t ? { turn: t.label, quote: one(q.quote), t } : null; }).filter(Boolean);
    if (!cites.length) { dropped.push({ text, why: "no quote found in the person's words" }); return; }
    if (looksSecret(text)) { dropped.push({ why: "looks like a secret" }); return; }   // its text isn't logged
    cand.push({ id: `c${i + 1}`, text, show: text, cites });
  });
  if (!cand.length) { run.steps.push({ step: "check", dropped }); return { status: "no_change", why: raw.length ? "nothing survived the quote check" : clip(j.checked || "no real guidance in the words", 200), ...base, proposed: raw.length }; }
  const v = await verifyClaims(ask, tz, "reflect", cand, L,
    "This is guidance a helper will follow in every channel. refute also fails: guidance that is generic (true of anyone), that turns one moment into a rule the words don't support, that labels health, mood, romance or dependency, or that tells the helper to be more proactive or message the person unprompted.", { first });
  if (v.skipped) return skippedRun(v.skipped, { ...base, proposed: raw.length });
  run.steps.push({ step: "check", dropped, verdicts: v.results });
  const ok = cand.filter((c) => v.pass.has(c.id));
  if (!ok.length) return { status: "no_change", why: "nothing passed verify: the pinned entry is left as it was", ...base, proposed: raw.length, verified: 0 };
  const entry = assembleReflection(first, ok);
  const kept = ok.filter((c) => entry.includes(one(c.text)));
  const cites = kept.map((c) => ({ claim: c.text, quotes: c.cites.map((q) => ({ quote: q.quote, turn: q.t.id, at: q.t.at, channel: q.t.channel || null, session: q.t.session })) }));
  const r = await host.setReflection(entry, { run: run.id, cites, at: now });
  if (r?.kept) return { status: "no_change", why: "the person edited the pinned entry themself, so it's kept as they wrote it", ...base, proposed: raw.length, verified: ok.length };
  run.changes.push({ op: r?.replaced ? "reflection_replaced" : "reflection_new", text: entry, chars: entry.length, claims: cites });
  host.setCursor("reflect", now);
  return { status: "changed", ...base, proposed: raw.length, verified: ok.length };
}
// The Resident side: General reads other channels' turns through their Residents (General may read across); the entry is a row
// in General's Notebook (the tenant's Archive).
export const reflectHost = (res) => ({
  async crossTurns(since, limit) {
    const chans = (await res.archive().channels().catch(() => [])).filter((c) => c.kind !== "dm");
    const per = Math.max(10, Math.ceil(limit / Math.max(1, chans.length)) * 2);
    const got = await Promise.all(chans.map(async (c) => { const slug = c.slug || c.name;
      try { const R = slug === res.get("channel") ? res : res.env.RESIDENT.get(res.env.RESIDENT.idFromName(`res:${res.get("tenant")}:${slug}`)); return (await R.memjobTurns(since, per)).map((t) => ({ ...t, channel: c.name || slug })); }
      catch { return []; } }));
    // Each channel's turns arrive already redacted by its own "forgotten" list; General's own list (forgetting in General covers
    // everything) is applied on top (forget.js).
    return redactTurns(forgottenEntries(res.sql), got.flat().sort((a, b) => a.at - b.at).slice(-limit));
  },
  setReflection: (text, meta) => res.archive().reflectionSet(text, meta),
});
