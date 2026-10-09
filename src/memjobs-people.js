// Background memory job 2: people (per channel, about once a day). Keeps Contacts current for the people the person talks about:
// relation, other names and facts in Muse's person-page sections (Facts / History / The relationship / In common / Open threads),
// each fact cited with the person's words. Contacts is the account-wide registry (people.js); a fact learned here is tagged with
// this channel and shows only here and in General (the memory wall). Never a contact from a mere mention; an existing contact is
// matched by id, name, alias or "my <relation>" (people.js), or the same folded name (people.js duplicates), before anything is new.
import { aliasesFor } from "./people.js";
import { WINDOW, FIRST_LOOKBACK_MS, clip, one, fold, quoteIn, sameFact, parseJson, looksSecret, dayOf, when, labelTurns, renderTurns, citeTurn, RUN, COMMON, verifyClaims, stepper, skippedRun } from "./memjobs-core.js";

export const pnorm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
export const findContact = (list, ref) => { const k = pnorm(ref); return k ? list.find((p) => aliasesFor(p).includes(k)) || null : null; };
export const SECTIONS = { facts: "", history: "History: ", relationship: "Relationship: ", in_common: "In common: ", open_threads: "Open thread: " };
export function peoplePrompt({ L, roster, tz, now, first, channel }) {
  const sys = `${RUN("people", first)}
This is the people upkeep: it keeps the person's Contacts current for the people in their life, so you know who matters and how.

Your job: for each person the new turns say something durable about, update their Contacts entry.
- Existing contact: match by full name, first name, nickname or relation ("my sister" = the contact whose relation is Your sister). People go by many names: check "also called" before deciding someone is new. Give contact_id.
- New person: only when the person's own words state a real tie to them (family, partner, friend, colleague, client, someone they've met or work with) AND give a name. Quote those words in relation_quote. A name that only appears in passing, in an article, email, search result, or a public figure or business, earns nothing. contact_id is then null.
- relation: how they relate to the person, only as the person named it, written like "Your sister", "Your manager", "Friend from college". Unnamed beats guessed: leave it empty if the words don't say.
- aliases: nicknames or short names the person used for them.
- facts, each under one section (the shape of a person page): facts (who they are, where they live, what they do, dates as "Birthday: March 12"), history (what happened, with the date the words give), relationship (how close, what it's built on, how they deal with each other, only from what the words show), in_common (shared interests, people, places), open_threads (a promise, plan or thing owed between them: "[ ] Call about the move" while open, "[x] …" when the words show it happened; time passing doesn't close a thread).
- Skip facts the contact already has. A fact that changes one they have gives that fact's id in replaces_fact_id.
- Never invent a year, a date, a surname or a relation; keep relative dates as said, with when they said it. The person themself never gets an entry.
${COMMON}

Shape:
{"status":"changes" | "no_change","checked":"one line","people":[{"contact_id":"id from Contacts, or null","name":"name as the person says it","relation":"or empty","relation_quote":"the person's exact words showing the tie (required for a new contact)","relation_turn":"T2","aliases":[],"facts":[{"section":"facts" | "history" | "relationship" | "in_common" | "open_threads","text":"one short line","quote":"the person's exact words","turn":"T2","replaces_fact_id":""}]}]}`;
  const r = roster.length ? roster.map((p) => `- id ${p.id}: ${p.name}${p.rel ? ` (${p.rel})` : ""}${p.aka?.length ? `; also called ${p.aka.join(", ")}` : ""}${p.facts?.length ? `\n  facts: ${p.facts.slice(0, 12).map((f) => `[${f.id}] ${clip(one(f.text), 160)}`).join(" · ")}` : ""}`).join("\n") : "(no contacts yet)";
  return [{ role: "system", content: sys }, { role: "user", content: `Now: ${when(now, tz)} (${tz}).\n\nContacts (people the window may mention):\n${r}\n\nNew turns in #${channel}:\n${renderTurns(L, tz)}` }];
}

// ---------- 2. people ----------
export async function people(host, run, o) {
  const now = host.now(), tz = host.tz();
  const cur = o.since != null ? o.since : (host.cursor("people") ?? now - FIRST_LOOKBACK_MS);
  const turns = await host.turnsSince(cur, WINDOW.people.turns);
  const L = labelTurns(turns, { chars: WINDOW.people.chars });
  if (!L.length) return { status: "no_change", why: "no new turns from the person", from: cur, to: cur, turns: 0 };
  const to = L.at(-1).at, base = { from: cur, to, turns: L.length, more: turns.length >= WINDOW.people.turns || L.length < turns.length };
  const all = await host.contacts(), text = L.map((t) => t.user).join("\n");
  // The roster the step sees: contacts the window names (any alias), else the 40 most recently updated (for "my sister"-style refs).
  const t2 = ` ${pnorm(text)} `, named = all.filter((p) => aliasesFor(p).some((a) => a.length > 2 && (t2.includes(` ${a} `) || t2.includes(` ${a}'s `))));
  // The wall: the step sees facts the person typed and facts learned in THIS channel, never what another channel learned.
  const mine = (p) => ({ ...p, facts: (p.facts || []).filter((f) => (/^You /.test(f.src || "") || !f.channel || f.channel === host.channel) && !host.forgotten?.(`${p.name}: ${f.text}`)) });
  const roster = [...named, ...all.filter((p) => !named.includes(p)).sort((a, b) => (b.updated || 0) - (a.updated || 0))].slice(0, 40).map(mine);
  const ask = stepper(host, run);
  const w = await ask("people", "write", peoplePrompt({ L, roster, tz, now, first: await host.first(), channel: host.channel }));
  if (w.skipped) return skippedRun(w.skipped, base);
  const j = parseJson(w.text);
  if (!j) throw new Error("people: the write step's reply wasn't JSON");
  const ps = j.status === "no_change" || !Array.isArray(j.people) ? [] : j.people.slice(0, 12);
  const byId = new Map(all.map((p) => [p.id, p])), dropped = [], cand = [];
  let n = 0;
  for (const p of ps) {
    const name = clip(one(p?.name), 120); if (!name) continue;
    // forget.js: someone or something the person asked to forget earns nothing here, and isn't logged.
    if (host.forgotten?.(name) || host.forgotten?.(p?.relation_quote)) { dropped.push({ why: "matches something the person asked to forget" }); continue; }
    // Merge with an existing contact: the id the step gave, else the same name / alias / "my <relation>" (people.js find), else
    // the same folded name (people.js duplicates). Only then is it new.
    let ex = byId.get(String(p?.contact_id || "")) || findContact(all, name) || (p?.relation ? findContact(all, `my ${one(p.relation).replace(/^(your|my) /i, "")}`) : null)
      || all.find((x) => fold(x.name).replace(/[^a-z0-9 ]/g, "") === fold(name).replace(/[^a-z0-9 ]/g, "")) || null;
    const facts = (Array.isArray(p?.facts) ? p.facts : []).slice(0, 10).map((f) => ({ section: SECTIONS[f?.section] != null ? f.section : "facts", text: clip(one(f?.text), 300), quote: one(f?.quote), turn: f?.turn, replaces: String(f?.replaces_fact_id || "").trim() || null })).filter((f) => f.text);
    let relT = null;
    if (!ex) {
      relT = p?.relation_quote ? citeTurn(L, p.relation_turn, p.relation_quote) : null;
      // A new contact needs the person's own words showing the tie, and those words must name them.
      const firstName = fold(name).split(" ")[0];
      if (!relT || !fold(p.relation_quote).includes(firstName)) { dropped.push({ name, why: "no quoted tie that names them: a mention isn't enough for a new contact" }); continue; }
    }
    // Aliases must be words the person actually used (a code check: they're not sent to verify).
    const rel = clip(one(p?.relation), 120), aka = (Array.isArray(p?.aliases) ? p.aliases : []).map((a) => clip(one(a), 60)).filter((a) => a && fold(a) !== fold(name) && quoteIn(a, text) && !(ex?.aka || []).map(fold).includes(fold(a))).slice(0, 6);
    const relKey = (r) => pnorm(r).replace(/^(your|my) /, "");
    const items = [];
    if (!ex) items.push({ id: `c${++n}`, type: "new", show: `New contact: ${name}${rel ? ` (${rel})` : ""}: the person has a real tie to them`, cites: [{ turn: relT.label, quote: one(p.relation_quote) }], turn: relT, quote: one(p.relation_quote) });
    else if (rel && relKey(rel) !== relKey(ex.rel) && p?.relation_quote) { const t = citeTurn(L, p.relation_turn, p.relation_quote); if (t) items.push({ id: `c${++n}`, type: "rel", show: `${ex.name}'s relation to the person: ${rel}`, cites: [{ turn: t.label, quote: one(p.relation_quote) }], turn: t, quote: one(p.relation_quote) }); }
    for (const f of facts) {
      if (host.forgotten?.(`${ex?.name || name}: ${f.text}`) || host.forgotten?.(f.quote)) { dropped.push({ why: "matches something the person asked to forget" }); continue; }
      const t = f.quote ? citeTurn(L, f.turn, f.quote) : null;
      if (!t) { dropped.push({ name, text: f.text, why: "quote not in the person's words" }); continue; }
      if (looksSecret(f.text) || looksSecret(f.quote)) { dropped.push({ name, why: "looks like a secret" }); continue; }   // its text isn't logged
      if (ex && (ex.facts || []).some((x) => sameFact(x.text.replace(/^(History|Relationship|In common|Open thread): /, ""), f.text))) continue;   // already on the card
      items.push({ id: `c${++n}`, type: "fact", show: `About ${ex?.name || name}: ${SECTIONS[f.section]}${f.text}`, cites: [{ turn: t.label, quote: f.quote }], turn: t, quote: f.quote, fact: f });
    }
    if (items.length) cand.push({ ex, name, rel, aka, items });
  }
  const flat = cand.flatMap((c) => c.items), proposed = flat.length + dropped.length;
  if (!flat.length) { run.steps.push({ step: "check", dropped }); return { status: "no_change", why: ps.length ? "nothing survived the quote check" : clip(j.checked || "no one new to note", 200), ...base, proposed }; }
  const v = await verifyClaims(ask, tz, "people", flat, L,
    "For a \"New contact\" claim, refute also asks: do the quoted words show a real tie to the person (family, friend, colleague, someone they know or met), not just a name in passing, an article, a business or a public figure?", { first: await host.first(), names: cand.filter((c) => c.ex).map((c) => `${c.ex.name}${c.ex.rel ? ` (${c.ex.rel})` : ""}`) });
  if (v.skipped) return skippedRun(v.skipped, { ...base, proposed });
  run.steps.push({ step: "check", dropped, verdicts: v.results });
  let verified = 0;
  for (const c of cand) {
    const ok = c.items.filter((i) => v.pass.has(i.id)); verified += ok.length;
    const isNew = c.items.find((i) => i.type === "new");
    if (isNew && !ok.includes(isNew)) continue;   // a new contact whose tie didn't verify: none of its facts land either
    if (!ok.length) continue;
    const relOk = ok.find((i) => i.type === "rel" || i.type === "new");
    const src = (t) => `Learned in #${host.channel}, ${dayOf(t.at, tz)} (background people upkeep)`;
    // An existing contact is saved again only when its relation or aliases change (each save is a new card version).
    const p = !c.ex || relOk || c.aka.length ? await host.upsertContact({ id: c.ex?.id, name: c.ex ? undefined : c.name, rel: relOk ? c.rel || undefined : undefined, aka: c.aka }, c.ex ? null : src(isNew.turn)) : c.ex;
    if (!p || p.error) { run.steps.push({ step: "apply", error: p?.error || "contact not saved" }); continue; }
    if (isNew) run.changes.push({ op: "contact_new", name: p.name, rel: p.rel || "", quote: isNew.quote, turn: isNew.turn.id, at: isNew.turn.at, id: p.id });
    else if (relOk) run.changes.push({ op: "contact_relation", name: p.name, rel: p.rel || "", quote: relOk.quote, turn: relOk.turn.id, at: relOk.turn.at, id: p.id });
    if (c.ex && c.aka.length) run.changes.push({ op: "contact_aliases", name: p.name, aka: c.aka, id: p.id });
    for (const i of ok.filter((x) => x.type === "fact")) {
      // It may replace a fact it (or the helper) learned; never one the person typed into Contacts themself ("You added").
      const replaces = i.fact.replaces && (c.ex?.facts || []).some((x) => x.id === i.fact.replaces && !/^You /.test(x.src || "") && (!x.channel || x.channel === host.channel)) ? i.fact.replaces : null;
      const f = await host.addPersonFact(p.id, `${SECTIONS[i.fact.section]}${i.fact.text}`, src(i.turn), replaces, { channel: host.channel, run: run.id, section: i.fact.section, quote: i.quote, turn: i.turn.id, session: i.turn.session, at: i.turn.at });
      if (f) run.changes.push({ op: replaces ? "fact_replaced" : "fact", name: p.name, text: `${SECTIONS[i.fact.section]}${i.fact.text}`, quote: i.quote, turn: i.turn.id, at: i.turn.at, id: f.id });
    }
  }
  host.setCursor("people", to);
  return { status: run.changes.length ? "changed" : "no_change", ...(run.changes.length ? {} : { why: "nothing passed verify" }), ...base, proposed, verified };
}

// The Resident side: Contacts lives in the tenant's Archive.
export const peopleHost = (res) => ({
  contacts: () => res.archive().peopleList(),
  upsertContact: (o, origin) => res.archive().personUpsert(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)), origin || "Learned in chat"),
  addPersonFact: (pid, text, src, replaces, cite) => res.archive().personFact(pid, text, src, replaces, cite),
});
