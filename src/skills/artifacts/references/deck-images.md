# Photos for a deck

There's no image generator in 1Helm. Every picture in an artifact is a real photo: one the person gave you, or one you
found that is free to use. Chosen with care, real photos make a deck look finished; chosen carelessly, they look like
stock filler. Pick each one for the slide it sits on, and keep the set consistent.

## Where photos come from

1. **The person's own files** (`/workspace/files`): use them first when they fit. A logo, product shot or team photo they
   supplied beats anything found online.
2. **Free-to-use sources** (Openverse, which gathers Flickr and Wikimedia, and Wikimedia Commons), in one command that
   searches, picks the best-matching wide photo, downloads it under the slide's name and writes `.src/media/SOURCES.md`:
   `python3 /opt/1hc/skills/image-search/scripts/images.py fetch --to <P>/.src/media "cover=<subject>" "<id>=<subject>" ...`
   It prints each photo's title, size and credit. To choose by hand among several candidates,
   `python3 /opt/1hc/skills/image-search/scripts/images.py search "<words>" --min-width 1600` lists them, and
   `python3 /opt/1hc/skills/image-search/scripts/images.py get "<image_url>" <P>/.src/media/<id>.jpg --page "<page_url>" --jpeg`
   downloads one (add its row to SOURCES.md yourself: `| file | title | creator | licence | source page |`). Unsplash, Pexels or an organisation's official press kit (for its
   own logo and products) are fine too, after checking the licence on the photo's page.
3. Never take a photo from a site that doesn't grant reuse (news sites, other people's blogs, social media), and never
   strip a watermark.

Credit every photo. On a deck the credit goes in the speaker notes of the slide that shows it, never on the slide:
make_deck.sh writes it there from SOURCES.md, so every found photo needs its row. On a document, PDF or page it is one
small muted line, under the photo or in a credits line at the end. A licence that requires attribution (CC BY, CC BY-SA)
is only met by that credit.

If nothing fitting and usable turns up for a slide, leave the photo out rather than use a wrong one. If that happens for
the cover, follow the no-photo path in the presentation reference and say so in `deck_plan.md`.

## Choosing each photo

1. **One look for the whole deck.** Real-world topics (travel, food, business, places, products) want editorial-style
   photography: natural light, real subjects, no posed stock smiles. Keep to one kind of picture across the deck; don't
   mix photos with clip art or illustrations. The style plan's "image_style" line describes the mood to look for.
2. **The subject is the slide's subject.** A slide about a temple shows that temple, not "a temple". For a how-to or a
   concept slide, the photo must show the thing itself so the slide teaches at a glance.
3. **Framing depends on the photo's job:**
   - **Full-bleed or cover** (text sits on the photo): pick a photo with a calm, low-detail area, usually along the
     bottom or one side, where the title can sit. Avoid a busy subject right where the title lands. You can move the
     focus with `background-position`.
   - **In a cell** (text sits beside the photo in its own panel): the opposite. Pick a photo the subject fills, roughly
     centred, so it crops well under `object-fit: cover`. Empty space there just becomes a dead band.
4. **Colour and light.** Prefer photos whose colours sit well with the palette and whose brightness suits the slide (rich
   and dark on a dark theme, bright with real depth on a light one). A clear, well-exposed subject with strong contrast
   always wins over matching: no foggy, washed-out, blown-out, milky or flat photos, and nothing whose colours clash.
5. **Sharp enough.** A cover or full-bleed photo needs at least 1536px on its long edge; a cell photo at least its shown
   width, ideally twice. images.py fetch already enforces 1600 px for the cover and 1200 px for the rest and prints each
   size; reject a smaller photo for a cover rather than scaling it up.
6. **Shape.** Match the photo to its slot: wide (16:9 or 3:2) for a full-bleed cover, tall for a side panel, so
   `object-fit: cover` crops as little as possible.
7. **Nothing written in it.** No photos of text, signs as the subject, screenshots, charts, dashboards, watermarks or other
   people's logos (unless the slide is about that brand). Labels and numbers go in the slide's HTML; charts are drawn
   from the data (the charts reference).

## Where photos go

The cover always has its hero photo (unless the documented no-photo path applies). Content slides get a photo where it
shows the idea (the authoring reference). Number, statement and money slides stay type and data only; never add a photo
just to raise the count.
