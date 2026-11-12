---
name: image-search
description: Use when the person wants a picture found (a photo of a place, thing, animal, building or event) to see in chat or to use in something they're making, or when any file you make needs a real photo.
always: false
---
# Finding pictures

Find a real photo of exactly what was asked, that's free to use, and hand it over with its credit.

**What you have.** There's no image generator. You search openly licensed collections
(Openverse, which gathers Flickr, Wikimedia and others; and Wikimedia Commons) with the script below, plus free photo sites
(Unsplash, Pexels) and official press kits found with `web_search`. This is search by words: it can't identify an unknown
person or match a photo they send against the web.

## Search

```
python3 /opt/1hc/skills/image-search/scripts/images.py search "<subject words>" --max 8
```

It prints JSON: for each result the image link, its source page, creator, licence, size and a ready-made credit line.
`--min-width 1600` for a cover or full-width photo; `--license any` also returns NonCommercial and NoDerivatives photos
(marked `reuse_ok: false`: fine for the person to look at privately, never for anything published, sold or edited).

- Use specific words: the exact subject and place ("Kinkaku-ji golden pavilion Kyoto", not "temple"). Try the English name,
  the local name, or a narrower view if the first results are off.
- Pick the result whose title and description match the request best, not the first one. You don't see the pictures, only
  their titles, descriptions and sizes: when the look matters, give them two or three to choose from.
- Free photo sites: open the photo's page with `fetch_url` and check its licence there before using it. A brand's own press
  kit is fine for its own logo and products, credited.
- Never take a picture from a site that doesn't grant reuse (news sites, blogs, social media, shopping sites' product shots
  for anything beyond showing that product), never strip a watermark, and never present an illustration or a different
  place as a photo of the real one. One photo per place or thing: don't reuse a photo for several.

## For a file you're making: one command

```
python3 /opt/1hc/skills/image-search/scripts/images.py fetch --to /workspace/workspace/<slug>/.src/media "<name>=<subject words>" ["<name>=<subject words>" ...]
```

For each name it searches (reusable licences only), picks the best-matching wide photo (the first name, or one with "cover"
in it, at 1600 px or more; the rest 1200 px), downloads it as `<name>.jpg`, never the same photo twice, and adds a row to
`SOURCES.md` in that folder. It prints each photo's title, size and credit, then a ready `credits line`. Name photos after
where they go (a deck: the slide id). A name it couldn't fill is listed: try other words once, or leave that photo out.

## Download and check

```
python3 /opt/1hc/skills/image-search/scripts/images.py get "<image_url>" /workspace/workspace/<slug>/media/<name>.jpg --page "<page_url>"
```

It fetches the image the way another web page would (so links that refuse outside use fail now, not later), checks the bytes
really are an image of a sensible size, and prints JSON with `ok`, the path, format and pixel size. `--min-width` rejects
small images; `--jpeg` converts WEBP or PNG to JPEG (Word documents need JPEG or PNG). If it fails, try the next result rather
than retrying the same link. Write a line in `/workspace/workspace/<slug>/media/SOURCES.md` per photo: file, source page,
creator, licence.

## Hand it over

- **To show in chat, or for a file they're making themselves** (a photo for their slides): `share_file` the downloaded photo
  (it appears as a picture card) and give the credit in one line, with the creator, the licence and the source page as the
  link. CC BY and CC BY-SA require that credit; for their own file, tell them where it goes: for slides, in the speaker notes
  of the slide that uses the photo (not on the slide); for a page or document, a small caption on the page that uses it.
- **In a file you're making** (deck, PDF, page, document): follow the artifacts skill's photo rules (`read_skill` with slug
  artifacts): `.src/media/`, its SOURCES.md, and the credit (a deck: in that slide's speaker notes; otherwise a small caption).
- **A product or a place's own page:** sometimes the honest answer is the page itself. `browser_screenshot` shows the person
  the page with its pictures, and a link lets them see more.

If nothing fitting and free to use turns up, say so plainly and offer a different subject or angle rather than a wrong or
unlicensed picture.
