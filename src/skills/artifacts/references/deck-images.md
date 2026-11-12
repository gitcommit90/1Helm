# Photos for a deck

There's no image generator in 1Helm. Every picture is a real photo: one the person gave you, or one that is free to use. Most
decks need none: the templates are designed around type, colour and shapes, and a deck about the person's own work uses the
"media" pattern for their own screenshots. Add a photo only where the slide's pattern has a picture box and the photo shows
that slide's real subject (a slide about a temple shows that temple), never to fill space.

## Where photos come from

1. **The person's own files** (`/workspace/files`): copy the one you need to `<P>/.src/media/<name>.jpg`. No credit needed.
2. **Free-to-use sources** (Openverse and Wikimedia Commons), in one command that searches, picks the best wide photo,
   downloads it and writes `.src/media/SOURCES.md`:
   `python3 /opt/1hc/skills/image-search/scripts/images.py fetch --to <P>/.src/media "<name>=<exact subject>" ...`
   Use exact subjects ("Kiyomizu-dera Kyoto", not "temple"). A name it can't fill: try other words once, or leave the picture
   out. Never take a photo from a site that doesn't grant reuse, and never strip a watermark.

In the slide file the photo is `<img src="media/<name>.jpg" alt="...">` (or `url('media/<name>.jpg')` in a background); the
build embeds it, scaled to at most 2560 px. Give it the box's size with `width:100%;height:100%;object-fit:cover`. Take out
the picture box's sample label.

Credit every found photo: its row in `SOURCES.md` puts the credit in the speaker notes of the slide that shows it. No credit is
ever printed on a slide. Choose sharp, well-lit photos with the subject filling the frame, nothing written in them (no
screenshots, charts or other people's logos), and one kind of picture across the deck. If nothing fitting turns up, leave the
photo out.
