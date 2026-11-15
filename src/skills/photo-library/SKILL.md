---
name: photo-library
description: Use when the person asks to find, sort, date or locate their own photos or pictures in this channel (uploads, attachments, downloads), or when one of their photos could ground an answer ("what was that restaurant in Lisbon?").
always: false
---
# Their photos

Find the person's own photos among this channel's files, by name, by when they were taken and by where.

**What you have.** The channel's Library is on your computer: what they uploaded or attached and what the browser downloaded
in `/workspace/files`, what you made in `/workspace/workspace`. Another channel's files stay in that channel (they can see
every channel's files in the Library's All channels view).{{#apps}} If the person has Google Photos connected, search it with
`app_actions` too (read-only; anything that changes an album needs their OK on that exact change).{{/apps}} There's no access to
the photos on their phone or computer unless they upload them.

**What you can't do:** see a photo from the Library yourself. You see only pictures attached to their message (up to four).
So you find photos by their file names and camera data (date, place, camera), and you never describe what's in a photo you
haven't seen. To look at one, ask them to attach it from the Library (the + in the message box lists this channel's Library
first).

## Finding them

```
python3 /opt/1hc/skills/photo-library/scripts/photos.py stats
python3 /opt/1hc/skills/photo-library/scripts/photos.py list --after 2024-05-10 --before 2024-05-20
python3 /opt/1hc/skills/photo-library/scripts/photos.py list --near 38.7223,-9.1393 --radius 5
python3 /opt/1hc/skills/photo-library/scripts/photos.py list --name receipt
python3 /opt/1hc/skills/photo-library/scripts/photos.py info /workspace/files/IMG_2041.jpg
```

- `stats` first: how many photos, the date range, how many carry a taken date and a place. Zero means the Library has no
  photos yet in this channel: say so briefly.
- Name or count their photos only from a `stats` or `list` you ran in this turn, never from memory or an earlier answer:
  files come and go. Asked to tidy or organize them: `list` first, then propose the change on those exact files.
- `list` prints one line per photo, newest first: path, when it was taken (or when it arrived, marked "added"), the camera's
  GPS position, size and camera. `--json` for the full records.
- Start with their words: a date ("last May"), an event or trip (take its dates from memory or this
  conversation), a place, a file name.
- For a place: get its coordinates from a page you read (its official site or encyclopedia page, with `fetch_url`), then
  `--near` with a radius that fits (0.2 km for one spot, 5 for a neighbourhood, 50 for a metro area). Never guess
  coordinates.
- Photos without camera data (screenshots, messaging-app copies, downloads) have only their arrival date: say that a date
  filter can miss or misplace them.
- iPhone HEIC files can't be read until `python3 -m pip install pillow-heif` has been run once on your computer; the script
  says when that's needed.

When the person asks to find, date or locate a photo, treat it as the main job: try several filters and angles. When a photo
might just help with something else, one quick look is enough; move on if nothing fits.

## Showing what you found

- They're already in the Library: name them (file name, when and where taken) so they can open them there. Don't
  `share_file` their own photos again; that adds copies.
- When it's a specific photo they're after, say which you think it is and why (date and place match), and ask them to
  confirm, or to attach it so you can look.
- Share something only when it's new: a zip of a selection, a resized set, a contact sheet or album page you made (the
  artifacts skill for a designed file).
- Never move, rename or delete their files without their OK on exactly which ones.
- Never try to identify a person in a photo from their face. Use what they tell you about who's in it.
