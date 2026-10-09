// Where a remember call really saved, read from the tool's own result, for the chat's "Added to …" chip under the reply.
// The chip used to say "Added to <helper>'s Notebook" for every remember step (it read the step line, written before the call ran),
// so a fact that went to Dana's contact card still said Notebook. Every result wording remember has had is here, so older tasks
// show the truth too. Nothing saved ("Not saved: …", "error: …") → no chip.
//   notebook  this channel's Notebook (channel set: another channel's, saved from General)
//   contact   a person's contact card (the old workspace Contacts facts; today a remember about a person also sets the card's
//             birthday / phone / email / relation / other names when it gave them)
//   memory    the channel's memory only (before the Notebook existed)
//   account   about the person themselves, kept for every channel (the old workspace note)
const SELF = /^(me|myself|the person|user|you)$/i;
const SECS = ["about", "how", "people", "places", "now"];
const one = (s) => String(s ?? "").replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
const clip = (s, n = 200) => { const t = one(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const jp = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };

// What a remember call put on the contact card besides the name (empty: the card only got the name it already had).
function cardFields(a) {
  const out = [];
  if (one(a.birthday)) out.push(`Birthday ${clip(a.birthday, 40)}`);
  if (one(a.relation)) out.push(clip(a.relation, 40));
  if (one(a.phone)) out.push(clip(a.phone, 40));
  if (one(a.email)) out.push(clip(a.email, 80));
  const aka = (Array.isArray(a.also_called) ? a.also_called : [a.also_called]).map(one).filter(Boolean);
  if (aka.length) out.push(`Also called ${clip(aka.join(", "), 60)}`);
  return out;
}

// [] when nothing was saved or the tool isn't remember.
export function savedTo(tool, args, out) {
  if (tool !== "remember") return [];
  const a = typeof args === "string" ? jp(args) : args || {};
  const o = String(out ?? "").trim(), about = one(a.about), self = SELF.test(about), text = clip(a.fact);
  const sec = SECS.includes(a.section) ? a.section : self ? "about" : "people";
  // "…; Dana (Your sister) is in Contacts." names the card as it's stored (the tool's own match, not the words the model used).
  const inContacts = o.match(/; (.+?)(?: \([^()]*\))? is in Contacts\.?/);
  const card = () => { if (!inContacts) return []; const f = cardFields(a); return f.length ? [{ to: "contact", name: inContacts[1], fields: f }] : []; };
  let m;
  if (/^Saved to this channel's notebook\b/i.test(o)) return [{ to: "notebook", sec, text }, ...card()];
  if ((m = o.match(/^Saved in #([\w-]+)'s notebook only/i))) return [{ to: "notebook", channel: m[1], sec, text }];
  if ((m = o.match(/^Saved in #([\w-]+)'s memory only/i))) return [{ to: "memory", channel: m[1], text }];
  if (/^Saved in this channel's memory only/i.test(o)) return [{ to: "memory", text }, ...card()];
  if ((m = o.match(/^Saved for the whole workspace: (.+?)(?: \([^()]*\))? · fact\b/i))) return [{ to: "contact", name: m[1], text }];
  if (/^Saved for the whole workspace \(about them\)/i.test(o)) return [{ to: "account", text }];
  return [];
}
