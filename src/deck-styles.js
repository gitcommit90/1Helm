// Deck styles in the app: the picker of the deck templates (thumbnails in app-assets/app-static/deck-styles, made by
// scripts/build-deck-style-thumbs.mjs). Two ways in, and neither one remembers a style:
//   1. A delivered HTML deck carries the Library tag "deck" (set when share_file gives the files make_deck.sh built), so the
//      app can put a "Change style" action on its card without asking the model.
//   2. The helper tool show_deck_styles puts the same picker in the chat as a card (the stream event {t:"deck_styles"}; the transcript
//      carries deck_styles: true on that turn, so a reload shows it again).
// Picking a style sends the person's own plain message into the task ("Use the coral style", "Restyle the deck ... in the coral template").
export const DECK_TAG = "deck";
export const DECK_STYLES_STEP = "show_deck_styles";
export const DECK_STYLES_TOOL = { type: "function", function: { name: DECK_STYLES_STEP,
  description: "Show the person the deck styles as a picker card in the chat: a small picture of each template's cover and a content slide, with its name and feel. Call it when they ask to see deck styles, templates or looks, before a deck exists or for one you already made. Tapping a style sends you their message (\"Use the coral style\" or \"Restyle the deck in the coral template\"), and then you build or restyle with that template. Say at most one short line with it.",
  parameters: { type: "object", properties: {}, required: [] } } };

// The tool: the card goes out live; the answer tells the helper what the person now sees.
export function deckStylesTool(ctx = {}) {
  if (ctx.kind !== "chat" || !ctx.turn) return "error: the picker is shown to the person in a chat turn; there's no chat turn open in this run.";
  ctx.emit?.({ t: "deck_styles" });
  return "The person now sees a card with every deck style (a picture of each template's cover and a content slide, its name and its feel). Don't list the styles in words. When they tap one, their message arrives like \"Use the coral style\" or \"Restyle the deck in the coral template\".";
}

// The turn's steps include the picker: the transcript view marks it, so the card is drawn again after a reload.
export const turnHasDeckStyles = (steps) => (steps || []).some((s) => s?.tool === DECK_STYLES_STEP);
