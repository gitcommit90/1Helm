---
name: google-slides
description: Use when the message contains the words Google Slides, or its route note says Google Slides was chosen earlier in the channel. Never for a request that names no tool.
always: false
---
# Slides in Google Slides

{{^apps}}Connected apps aren't switched on here, so Google Slides isn't available. Build the deck from the artifacts skill's presentation reference.{{/apps}}{{#apps}}
Read this only when the deck goes in Google Slides: the person named Google Slides, or chose it earlier (the message says so). Otherwise a deck is the artifacts skill's HTML deck, even when Google Slides is connected.

1. Google Slides is connected: build the deck here, yourself, in this turn. A background helper can't run app actions, so don't hand a Google Slides deck to one.
2. Not connected, or the connection expired (a connected Gmail or other Google app doesn't count): `offer_connect` with app googleslides and a one-line why, then end your turn and wait. When they connect, carry on with the deck.
3. They tapped Not now, said no or asked for something else: build the built-in deck from the artifacts skill's presentation reference. Don't offer the card again in this task.

## Building the deck

- Call `app_actions` with app googleslides first, to see the action names and inputs.
- Plan the slides before any call: 6 to 10 slides, one idea per slide, short bullets, the person's own facts and wording, and a closing slide that says what to do next. Facts you aren't sure of get a `web_search` first.
- Make the whole deck in one `app_run` of GOOGLESLIDES_CREATE_SLIDES_MARKDOWN with a title and the slides as markdown text. The markdown starts with `Theme: <name>` (default, corporate_blue, modern_dark, professional_gray, creative_purple, warm_orange, forest_green or minimal_beige). Slides are separated by a line with `---`. The first slide is `# Title` plus a subtitle line. Other slides use `-` bullets, a markdown table, a `> quote`, a paragraph, or a slide of one `![description](public image URL)`. A line with `|||` splits a slide into two columns. Don't use image tags to put pictures next to text: in two-column slides and in GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE's markdown_text they become text links, not pictures.
- Pictures: add each one with GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE using `requests` (not markdown_text), one raw request per picture: `{"createImage": {"url": "<https URL>", "elementProperties": {"pageObjectId": "<slide objectId from PRESENTATIONS_GET>", "size": {"width": {"magnitude": 3600000, "unit": "EMU"}, "height": {"magnitude": 3600000, "unit": "EMU"} }, "transform": {"scaleX": 1, "scaleY": 1, "translateX": 5200000, "translateY": 700000, "unit": "EMU"} } } }`. The page is 9144000 by 5143500 EMU, the picture is fitted inside the size box, and this box is the right side of the slide. Body text spans the whole slide, so also halve its width with `updatePageElementTransform` (applyMode RELATIVE, scaleX 0.5 on the body shape's objectId), or give the picture its own slide. Google needs a public PNG, JPEG or GIF link under 50 MB and 25 megapixels, so for Wikimedia use a sized thumbnail (`https://upload.wikimedia.org/wikipedia/commons/thumb/<a>/<ab>/<File>/1280px-<File>`), never the original. If Google can't fetch a link the whole batch fails, so retry without that picture, or with another link, and tell the person which picture is missing.
- Check it before you say it's done: GOOGLESLIDES_PRESENTATIONS_GET with `fields` of `slides(objectId,pageElements(objectId,image,shape(text)))` shows the text and the picture on each slide (a bare `slides(objectId)` shows nothing). Tell the person exactly what is on the slides, and say so for any picture that isn't there. GOOGLESLIDES_PRESENTATIONS_PAGES_GET_THUMBNAIL shows a slide's layout when it matters.
- Fix a slide's text with GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE (for example replaceAllText).
- Changing a deck they already have: read it first (GOOGLESLIDES_PRESENTATIONS_GET), then change only what they asked for with GOOGLESLIDES_PRESENTATIONS_BATCH_UPDATE.
- Finish with the link the tool returned, in one short line. Never write a Google link yourself, and don't also make an HTML deck.
{{/apps}}
