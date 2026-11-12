# One warm OCR process for the browser server (server.mjs starts it on the first {ocr: true} screenshot and keeps it).
# Reads one JSON per line on stdin: {"id": n, "path": "/tmp/x.jpg"}; answers one JSON per line: {"id": n, "lines": [...], "ms": n} or {"id": n, "error": "..."}.
# Engine: RapidOCR (onnxruntime) with the PP-OCRv6 small detector and recognizer that ship inside the rapidocr wheel (no download at run time).
import json, os, sys, time
from rapidocr import RapidOCR

THREADS = max(1, min(os.cpu_count() or 2, 4))
# Det.limit_side_len 1100 scales a 1280x800 screenshot up 1.4x before detection, which finds the small text a default 736 run misses.
engine = RapidOCR(params={"Global.use_cls": False, "Global.log_level": "error", "Det.limit_side_len": 1100,
                          "EngineConfig.onnxruntime.intra_op_num_threads": THREADS, "EngineConfig.onnxruntime.inter_op_num_threads": 1})
out = os.fdopen(os.dup(1), "w")
sys.stdout = sys.stderr   # library prints must never mix into the answers
print(json.dumps({"ready": True}), file=out, flush=True)

def lines_of(r):
    res = []
    if r.boxes is None or r.txts is None: return res
    for b, t, s in zip(r.boxes, r.txts, r.scores):
        t = str(t).strip()
        if not t: continue
        xs = [p[0] for p in b]; ys = [p[1] for p in b]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        res.append({"text": t, "x": round(x0), "y": round(y0), "w": round(x1 - x0), "h": round(y1 - y0), "conf": round(float(s), 3)})
    return res

for raw in sys.stdin:
    q = {}
    try:
        q = json.loads(raw); t0 = time.time()
        r = engine(q["path"])
        print(json.dumps({"id": q.get("id"), "lines": lines_of(r), "ms": round((time.time() - t0) * 1000)}), file=out, flush=True)
    except Exception as e:
        print(json.dumps({"id": q.get("id"), "error": str(e)[:200]}), file=out, flush=True)
