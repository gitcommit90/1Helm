#!/usr/bin/env python3
"""Turn a deck's checked slide images into a .pptx.

Usage: build_pptx.py <slug> [title] --project-dir <abs project folder>

Reads <project>/.src/validate/page-*.png (written by render_audit.mjs --png-dir, or by validate_pdf.sh from a PDF) and
writes <project>/<slug>.pptx: one full-bleed picture per slide, the slide size taken from the image's aspect ratio so
nothing stretches, the deck title in the file's properties, and in each slide's speaker notes: its heading (from
.src/slides/deck.json), so a presenter view or screen reader still has words, then the credit of every photo that slide
shows (its media/<file> names in .src/slides/<id>.html, looked up in .src/media/SOURCES.md). Photo credits go in the notes,
never on the slide. The pictures carry no editable text; that is by design, so the file looks exactly like the checked render.
"""

import json
import re
import struct
import sys
from pathlib import Path

if __name__ == "__main__" and any(a in ("-h", "--help") for a in sys.argv[1:]):
    print(__doc__.strip()); sys.exit(0)


def manifest_slides(project_dir):
    """The slides in deck order from the assembled manifest. Missing or unreadable: [], never a failure."""
    try:
        slides = json.loads((project_dir / ".src" / "slides" / "deck.json").read_text()).get("slides", [])
    except (OSError, ValueError, AttributeError):
        return []
    return [s if isinstance(s, dict) else {} for s in slides] if isinstance(slides, list) else []


def slide_titles(project_dir, count):
    """Headings in deck order from the assembled manifest. Missing or unreadable manifest: no notes, never a failure."""
    titles = [s.get("page_title") for s in manifest_slides(project_dir)]
    titles += [None] * max(0, count - len(titles))
    return titles[:count]


def sources(project_dir):
    """file name -> credit ("<title> by <creator>, <licence>, <source page>") from .src/media/SOURCES.md (images.py's table:
    | file | title | creator | licence | source page |). A photo with no row (the person's own) gets no credit line."""
    try:
        rows = (project_dir / ".src" / "media" / "SOURCES.md").read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}
    out = {}
    for row in rows:
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[0].lower() == "file" or set(cells[0]) <= set("-: "):
            continue
        cells = [("" if c == "None" else c) for c in cells] + [""]
        title = re.sub(r"\.(jpe?g|png|webp|gif|tiff?)$", "", re.sub(r"^File:", "", cells[1]), flags=re.I).strip() or "Photo"
        by = f"{title} by {cells[2]}" if cells[2] else title
        out[Path(cells[0]).name] = ", ".join(b for b in (by, cells[3], cells[4]) if b)
    return out


def slide_credits(project_dir, count):
    """Per slide in deck order: the credits of the photos its source file shows (media/<file>, first use order, no repeats)."""
    credit, slides_dir, out = sources(project_dir), project_dir / ".src" / "slides", []
    for s in manifest_slides(project_dir)[:count]:
        try:
            html = (slides_dir / (s.get("path") or f"{s.get('id')}.html")).read_text(encoding="utf-8")
        except (OSError, TypeError):
            out.append([]); continue
        files = dict.fromkeys(re.findall(r"""(?:media/|data-media=["'])([A-Za-z0-9._-]+)""", html))   # data-media: an older, embedded deck
        out.append([credit[f] for f in files if f in credit])
    return out + [[]] * max(0, count - len(out))


def slide_notes(project_dir, count):
    """Each slide's speaker notes: its heading, then "Photo credit: ..." lines. None when there's neither."""
    notes = []
    for title, credits in zip(slide_titles(project_dir, count), slide_credits(project_dir, count)):
        lines = [title] if title else []
        if credits:
            lines.append(("Photo credit: " if len(credits) == 1 else "Photo credits: ") + "; ".join(credits))
        notes.append("\n\n".join(lines) or None)
    return notes


def page_number(path):
    match = re.search(r"page-(\d+)\.png$", path.name)
    if not match:
        raise SystemExit(f"unexpected PNG name {path.name}; expected page-N.png")
    return int(match.group(1))


def png_size(path):
    """Width and height from the PNG header."""
    with open(path, "rb") as fh:
        header = fh.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path.name} is not a PNG")
    return struct.unpack(">II", header[16:24])


def parse_args(argv):
    """Pull --project-dir out (last one wins; a value that is itself an option is treated as a title)."""
    rest, project_dir, i = [], None, 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--project-dir" and i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            project_dir = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--project-dir="):
            project_dir = arg.split("=", 1)[1]
            i += 1
            continue
        rest.append(arg)
        i += 1
    return rest, project_dir


def main(argv):
    from pptx import Presentation
    from pptx.util import Emu
    args, project_dir_arg = parse_args(argv[1:])
    if not args or not project_dir_arg or not project_dir_arg.strip():
        raise SystemExit("usage: build_pptx.py <slug> [title] --project-dir <abs project folder>")
    slug = args[0]
    title = args[1] if len(args) > 1 else slug.replace("-", " ").capitalize()
    project_dir = Path(project_dir_arg).expanduser()
    if not project_dir.is_absolute():
        raise SystemExit(f"--project-dir must be an absolute path (got {project_dir_arg})")
    validate_dir = project_dir / ".src" / "validate"
    output = project_dir / f"{slug}.pptx"

    pngs = sorted(validate_dir.glob("page-*.png"), key=page_number)
    if not pngs:
        raise SystemExit(f"no slide images in {validate_dir}; run the render check first")

    # Width fixed at 13.333 in; height follows the image so the picture fills the slide exactly.
    px_w, px_h = png_size(pngs[0])
    slide_w = Emu(12192000)
    slide_h = Emu(round(12192000 * px_h / px_w))

    prs = Presentation()
    prs.core_properties.title = title
    prs.slide_width = slide_w
    prs.slide_height = slide_h
    blank = next((layout for layout in prs.slide_layouts if layout.name == "Blank"), None)
    if blank is None:
        raise SystemExit("the default template has no 'Blank' layout")
    notes = slide_notes(project_dir, len(pngs))
    for png, note in zip(pngs, notes):
        slide = prs.slides.add_slide(blank)
        slide.shapes.add_picture(str(png), 0, 0, width=slide_w, height=slide_h)
        if note:
            slide.notes_slide.notes_text_frame.text = note
    prs.save(str(output))
    print(json.dumps({"ok": True, "pptx": str(output), "slides": len(pngs), "title": title,
                      "credited_slides": sum("Photo credit" in (n or "") for n in notes)}))


if __name__ == "__main__":
    main(sys.argv)
