// The deck templates are static assets of the Worker (app-assets/deck-templates/, served through the ASSETS binding and never by a public
// route), not part of the script bundle. app-assets/deck-templates/manifest.json (scripts/build-deck-templates-manifest.mjs) lists, per
// template, the files a computer needs and one content hash. A computer is sent one template at a time, only when it doesn't hold that hash.
let manifest = null;   // the assets of a deployed version never change, so one read serves the Worker instance
const asset = async (env, path) => {
  if (!env?.ASSETS) throw new Error("no ASSETS binding");
  const r = await env.ASSETS.fetch(new Request(`https://assets.invalid/deck-templates/${path}`));
  if (!r.ok) throw new Error(`deck template file ${path}: ${r.status}`);
  return r.text();
};
export async function deckManifest(env) {
  if (manifest) return manifest;
  const m = JSON.parse(await asset(env, "manifest.json"));
  if (m?.version !== 1 || typeof m.templates !== "object") throw new Error("deck template manifest is not readable");
  return (manifest = m);
}
export const resetDeckManifest = () => { manifest = null; };
// { hash, files: {path: text} } for one template, or null when there is no such template.
export async function deckTemplate(env, name) {
  const t = (await deckManifest(env)).templates[name];
  if (!t) return null;
  const texts = await Promise.all(t.files.map((f) => asset(env, f)));
  return { hash: t.hash, files: Object.fromEntries(t.files.map((f, i) => [f, texts[i]])) };
}
