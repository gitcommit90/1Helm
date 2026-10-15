// A deterministic stand-in for the Workers AI embedding model. Words that mean the same thing (in English
// and Spanish) share one dimension, so a paraphrase query lands near the passage it describes. Unknown words
// get a small hashed component. It is only a fixture: real model quality is measured separately.
import { tokenize } from "../../src/ee/ambient-ground.js";
const CONCEPTS = [
  ["plumber", "plumbing", "plumbers", "leak", "leaks", "leaky", "pipe", "pipes", "faucet", "sink", "drip", "plomero", "fuga", "tuberia"],
  ["landlord", "landlady", "rent", "lease", "propietario", "casero", "property"],
  ["prescription", "prescripshun", "pharmacy", "medicine", "medication", "pills", "recipe", "farmacia", "receta"],
  ["cello", "violin", "guitar", "instrument", "music", "piano"],
  ["accountant", "taxes", "tax", "irs", "bookkeeper", "contador", "impuestos"],
  ["milk", "oat", "groceries", "grocery", "shopping", "leche", "compras"],
  ["dentist", "teeth", "dental", "tooth", "dentista"],
  ["invoice", "bill", "payment", "billing", "factura"],
  ["kitchen", "repaint", "paint", "painting", "cocina", "pintar"],
  ["registration", "car", "vehicle", "dmv", "coche"],
  ["library", "libary", "books", "book", "return", "returned", "borrowed"],
  ["passport", "passprt", "trip", "travel", "visa", "document", "documents"],
  ["priya", "permission", "permision", "form", "school", "paperwork"],
  ["doctor", "dr", "rivera", "appointment", "physician", "clinic", "visit"],
  ["seed", "swap", "garden", "gardening", "park", "event"],
];
const DIM = 64, byWord = new Map(); CONCEPTS.forEach((group, i) => group.forEach((w) => byWord.set(w, i)));
const stem = (w) => w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, "") : w;
export function fakeEmbed(text) {
  const v = new Array(DIM).fill(0);
  for (const { t } of tokenize(text)) {
    const c = byWord.has(t) ? byWord.get(t) : byWord.get(stem(t));
    if (c != null) v[c] += 1;
    else { let h = 7; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0; v[CONCEPTS.length + (h % (DIM - CONCEPTS.length))] += 0.12; }
  }
  return v;
}
// env.AI stand-in; calls records every request so tests can see what was sent.
export function fakeAI(calls = []) {
  return { calls, run: async (model, input) => { calls.push({ model, texts: input.text }); return { data: input.text.map(fakeEmbed), usage: { prompt_tokens: input.text.reduce((n, t) => n + Math.ceil(t.length / 4), 0) } }; } };
}
