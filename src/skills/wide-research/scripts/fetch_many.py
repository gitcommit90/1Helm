#!/usr/bin/env python3
"""Fetch many public pages at once and save each as plain text (stdlib only).

Usage: python3 fetch_many.py URLS_FILE OUT_DIR [-j 6] [--timeout 20] [--max-chars 60000]
  URLS_FILE: one URL per line, or "id<TAB>url" (the id names the output file). Blank lines and lines starting with # are skipped.
  OUT_DIR:   gets <id>.txt per page (title on the first line, then the readable text) and index.tsv (id, url, status, chars, error).
Up to 10 pages are fetched at the same time (-j). A page that fails is listed in index.tsv with its error; the rest carry on.
Exit code 0 when at least one page was fetched, 1 when none were.
"""
import argparse, concurrent.futures as cf, html, os, re, sys, urllib.request
from html.parser import HTMLParser

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
SKIP = {"script", "style", "noscript", "svg", "template", "iframe", "head"}
BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer", "table", "ul", "ol", "dt", "dd"}

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.out, self.skip, self.title, self.in_title = [], 0, "", False
    def handle_starttag(self, tag, attrs):
        if tag in SKIP: self.skip += 1
        if tag == "title": self.in_title = True
        if tag in BLOCK: self.out.append("\n")
    def handle_endtag(self, tag):
        if tag in SKIP and self.skip: self.skip -= 1
        if tag == "title": self.in_title = False
        if tag in BLOCK: self.out.append("\n")
    def handle_data(self, data):
        if self.in_title: self.title += data
        elif not self.skip: self.out.append(data)

def to_text(body, ctype):
    if "html" not in ctype and not body.lstrip().startswith("<"): return "", body
    p = Text()
    try: p.feed(body)
    except Exception: pass
    t = re.sub(r"[ \t\r\f\v]+", " ", "".join(p.out)); t = re.sub(r"\n\s*\n+", "\n\n", t).strip()
    return html.unescape(p.title.strip()), t

def fetch(item, timeout, max_chars):
    pid, url = item
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            ctype = r.headers.get("content-type", ""); raw = r.read(4_000_000)
            enc = (re.search(r"charset=([\w-]+)", ctype) or [None, "utf-8"])[1]
            body = raw.decode(enc, errors="replace")
            title, text = to_text(body, ctype)
            return pid, url, r.status, title, text[:max_chars], ""
    except Exception as e:
        return pid, url, getattr(e, "code", 0) or 0, "", "", str(e)[:200]

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("urls"); ap.add_argument("out"); ap.add_argument("-j", type=int, default=6)
    ap.add_argument("--timeout", type=float, default=20); ap.add_argument("--max-chars", type=int, default=60000)
    a = ap.parse_args()
    items, seen = [], set()
    for n, line in enumerate(open(a.urls, encoding="utf-8"), 1):
        line = line.strip()
        if not line or line.startswith("#"): continue
        pid, url = line.split("\t", 1) if "\t" in line else (str(len(items) + 1), line)
        pid = re.sub(r"[^A-Za-z0-9_.-]+", "-", pid.strip())[:60] or str(len(items) + 1)
        url = url.strip()
        if not re.match(r"^https?://", url) or url in seen: continue
        seen.add(url); items.append((pid, url))
    os.makedirs(a.out, exist_ok=True)
    ok = 0
    with cf.ThreadPoolExecutor(max_workers=max(1, min(10, a.j))) as ex, open(os.path.join(a.out, "index.tsv"), "w", encoding="utf-8") as idx:
        idx.write("id\turl\tstatus\tchars\terror\n")
        for pid, url, status, title, text, err in ex.map(lambda it: fetch(it, a.timeout, a.max_chars), items):
            if text:
                ok += 1
                with open(os.path.join(a.out, f"{pid}.txt"), "w", encoding="utf-8") as f: f.write(f"{title}\n{url}\n\n{text}\n")
            idx.write(f"{pid}\t{url}\t{status}\t{len(text)}\t{err}\n")
    print(f"fetched {ok} of {len(items)} pages into {a.out} (see index.tsv)")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
