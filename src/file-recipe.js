// Which artifacts-skill references a background helper's job needs, found from the job's own words.
// resident.js helperRun reads them with readSkill and passes the text to helperJobText (helpers.js), so the worker's first model
// input already holds the skill's recipe for the kind of file and the worker needs no read_skill step for it. A leaf module:
// helpers.js is imported early by resident.js and must not import the skills loader.
const DECK = /\b(?:decks?|slides?|slideshows?|presentations?|power ?points?|pptx?|keynote)\b/i;
const PDF = /\b(?:pdfs?|one-?pagers?|flyers?|brochures?|invoices?)\b/i;
const DOC = /\b(?:word (?:docs?|documents?)|docx|\.dotx|memos?|cover letters?|resumes?)\b/i;
const SHEET = /\b(?:spreadsheets?|xlsx|workbooks?|csv|budget (?:sheet|tracker))\b/i;
const EDIT = /\b(?:edit|update|revise|fill in|merge|existing|change|fix|rework|redo|replace)\b/i;
// A job edits an existing file only when it names a Library file of the kind it makes (a deck, a PDF, a Word file, a sheet) and asks for a change.
// A file under /workspace/files/ of another kind is source material: "build a deck from /workspace/files/notes.txt and last year's proposal PDF" is a new deck.
const LIBRARY = (ext) => new RegExp(`/workspace/files/[^\\n"]{0,100}?\\.(?:${ext})(?![\\w])`, "i");
const KINDS = [
  ["presentation", DECK, ["presentation", "deck-templates"], ["deck-editing"], LIBRARY("html?|pptx?|potx|key|odp")],
  ["pdf", PDF, ["pdf", "pdf-design"], ["pdf-existing"], LIBRARY("pdf")],
  ["document", DOC, ["document"], ["document-editing"], LIBRARY("docx?|dotx|odt")],
  ["spreadsheet", SHEET, ["spreadsheet", "spreadsheet-formulas"], ["spreadsheet", "spreadsheet-formulas"], LIBRARY("xlsx|xlsm|xls|csv|tsv|ods")],
];
// -> { kind, refs } or null. The earliest kind named in the text wins, so "a deck with a PDF copy" is a deck.
export function fileRecipe(text) {
  const t = String(text || "").slice(0, 6000); if (!t.trim()) return null;
  let best = null;
  for (const [kind, re, fresh, edit, file] of KINDS) {
    const m = re.exec(t); if (m && (!best || m.index < best.at)) best = { at: m.index, kind, refs: EDIT.test(t) && file.test(t) ? edit : fresh };
  }
  return best ? { kind: best.kind, refs: best.refs } : null;
}
export const RECIPE_SLUG = "artifacts";
