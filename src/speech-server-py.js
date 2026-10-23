// The Python server that runs inside the speech container (selfhost-speech.js SpeechSetup writes it to /opt/1hc-speech/speech_server.py).
// One process holds Nemotron ASR and Nemotron diarization (transformers, CPU) and starts llama.cpp's server for Qwen3-ASR (GGUF Q8_0).
// Every model is used under its own lock, because none of them takes two requests at once (measured 2026-10-22: two simultaneous requests on one
// loaded Nemotron ASR model failed). The text of this file must not hold a backtick, a dollar sign followed by a brace, or a line that says 1HC_PY.
//
// Routes (bodies are raw audio bytes, answers are JSON):
//   GET  /health                                     ready flags, load times and memory
//   POST /transcribe?model=qwen|nemotron&format=&lang=     -> { text, segs: [{s,e,t}], words: [{w,s,e}], audio_s, process_ms }
//   POST /diarize?format=&num_speakers=                    -> { turns: [{s,e,speaker}], audio_s, process_ms }
//   POST /session/<id>/chunk?seq=&at_ms=&format=     keeps the chunk (16 kHz mono PCM) on disk        -> { chunks }
//   GET  /session/<id>                               the sequence numbers held                       -> { seqs }
//   POST /session/<id>/diarize?num_speakers=         diarizes every held chunk on the session timeline -> { turns: [{start_ms,end_ms,speaker}], audio_s, process_ms }
//   DELETE /session/<id>                             removes the chunks
// process_ms is the time the request used the models, not counting the wait for a lock. Cost is worked out from it in selfhost-speech.js.
export const SPEECH_PY = String.raw`import base64, glob, hashlib, io, json, os, re, resource, shutil, subprocess, sys, threading, time, urllib.parse, urllib.request, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

T0 = time.time()
ROOT = "/opt/1hc-speech"
MODELS = ROOT + "/models"
DATA = "/var/tmp/1hc-speech-data"
THREADS = int(os.environ.get("SPEECH_THREADS", "4"))
SR = 16000
LLAMA_PORT = 8081
MAX_AUDIO_S = int(os.environ.get("SPEECH_MAX_AUDIO_S", "1800"))
SESSION_KEEP_S = 8 * 3600
STATE = {"ready": False, "load_ms": {}, "errors": {}, "started_at": T0}

class Gate:
    # One request uses the models at a time, whichever model it is. The three models are not safe for two requests at once (two simultaneous requests on one loaded
    # Nemotron ASR model failed in the 2026-10-22 measurement), and the machine has 4 vCPU, so a second model running beside the first only slows both (measured on
    # Cloudflare: Qwen 22 s and Nemotron 13 s together for work that takes 16 s and 5 s alone). One at a time also makes each request's process_ms its own compute time,
    # which is what the account is charged. Waiting requests are ordered by audio length minus the seconds already waited, so a short live chunk goes before a long
    # file and a long file still goes after a minute or so.
    def __init__(self):
        self.cond = threading.Condition()
        self.busy = False
        self.waiting = []

    def __call__(self, audio_s):
        gate = self

        class Turn:
            def __enter__(self):
                me = (audio_s, time.time())
                with gate.cond:
                    gate.waiting.append(me)
                    while gate.busy or min(gate.waiting, key=lambda w: w[0] - (time.time() - w[1])) is not me:
                        gate.cond.wait(0.5)
                    gate.waiting.remove(me)
                    gate.busy = True

            def __exit__(self, *a):
                with gate.cond:
                    gate.busy = False
                    gate.cond.notify_all()

        return Turn()


GATE = Gate()
LLAMA = {"proc": None}
SESS_LOCK = threading.Lock()
M = {}

import numpy as np


def rss_mb():
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)


def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


# ---- audio in: any container becomes 16 kHz mono 16-bit samples ----
def read_wav16(b):
    try:
        w = wave.open(io.BytesIO(b))
        if w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2:
            return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    except Exception:
        pass
    return None


def decode(b, fmt):
    if fmt == "wav":
        x = read_wav16(b)
        if x is not None:
            return x
    os.makedirs(DATA + "/tmp", exist_ok=True)
    ext = re.sub("[^a-z0-9]", "", str(fmt).lower())[:6] or "bin"
    p = "%s/tmp/%d-%d.%s" % (DATA, os.getpid(), time.time_ns(), ext)
    with open(p, "wb") as f:
        f.write(b)
    try:
        r = subprocess.run([ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-nostdin", "-i", p, "-vn", "-f", "s16le", "-ac", "1", "-ar", str(SR), "pipe:1"], capture_output=True, timeout=300)
        if r.returncode != 0:
            raise ValueError("the audio could not be read (" + r.stderr.decode("utf8", "replace")[-160:].strip() + ")")
        return np.frombuffer(r.stdout, dtype="<i2")
    finally:
        try:
            os.unlink(p)
        except OSError:
            pass


def f32(x):
    return x.astype("float32") / 32768.0


def pcm_wav(x):
    buf = io.BytesIO()
    w = wave.open(buf, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(x.astype("<i2").tobytes())
    w.close()
    return buf.getvalue()


def pieces(x, one_s=45.0, max_s=30.0):
    # [(offset_samples, samples)]. Audio up to one_s seconds stays whole. Longer audio is cut near the quietest 50 ms in the last 6 s of each max_s window.
    n = len(x)
    if n <= one_s * SR:
        return [(0, x)]
    out, i = [], 0
    win, fr = int(max_s * SR), int(0.05 * SR)
    while i < n:
        if n - i <= win:
            out.append((i, x[i:]))
            break
        lo = i + win - 6 * SR
        seg = x[lo:i + win].astype("float64")
        e = [float(np.sum(seg[k:k + fr] ** 2)) for k in range(0, len(seg) - fr, fr)]
        cut = lo + int(np.argmin(e)) * fr + fr // 2
        out.append((i, x[i:cut]))
        i = cut
    return out


# ---- Qwen3-ASR through llama.cpp ----
def start_llama():
    if LLAMA["proc"] is not None and LLAMA["proc"].poll() is None:
        return
    env = dict(os.environ, LD_LIBRARY_PATH=ROOT + "/llama")
    LLAMA["proc"] = subprocess.Popen([ROOT + "/llama/llama-server", "-m", MODELS + "/qwen/Qwen3-ASR-1.7B-Q8_0.gguf", "--mmproj", MODELS + "/qwen/mmproj-Qwen3-ASR-1.7B-Q8_0.gguf",
                                      "-t", str(THREADS), "-np", "1", "-c", "8192", "--port", str(LLAMA_PORT), "--host", "127.0.0.1", "--no-webui"],
                                     stdout=open("/tmp/llama.log", "a"), stderr=subprocess.STDOUT, env=env)
    for _ in range(480):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/health" % LLAMA_PORT, timeout=2)
            return
        except Exception:
            if LLAMA["proc"].poll() is not None:
                break
            time.sleep(0.25)
    raise RuntimeError("llama-server did not start: " + open("/tmp/llama.log").read()[-600:])


def qwen_piece(x):
    if int(np.abs(x.astype("int32")).max(initial=0)) < 30:
        return ""   # digital silence: Qwen makes words up on it
    start_llama()
    body = json.dumps({"messages": [{"role": "user", "content": [{"type": "input_audio", "input_audio": {"data": base64.b64encode(pcm_wav(x)).decode(), "format": "wav"}}]}], "temperature": 0, "max_tokens": 600}).encode()
    r = json.loads(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:%d/v1/chat/completions" % LLAMA_PORT, body, {"Content-Type": "application/json"}), timeout=1800).read())
    t = r["choices"][0]["message"]["content"]
    if "<asr_text>" in t:
        t = t.split("<asr_text>", 1)[1]
    return t.strip()


def run_qwen(x):
    segs = []
    for off, p in pieces(x):
        t = qwen_piece(p)
        if t:
            segs.append({"s": round(off / SR, 3), "e": round((off + len(p)) / SR, 3), "t": t})
    return segs, []


# ---- Nemotron 3.5 ASR (transformers, CPU) ----
def load_nemotron():
    import torch
    from transformers import AutoModelForRNNT, AutoProcessor
    torch.set_num_threads(THREADS)
    d = MODELS + "/nemotron"
    M["torch"] = torch
    M["asr_proc"] = AutoProcessor.from_pretrained(d)
    M["asr"] = AutoModelForRNNT.from_pretrained(d)
    M["asr"].eval()
    with torch.inference_mode():
        w = M["asr_proc"](np.zeros(SR * 2, dtype="float32"), sampling_rate=SR, language="en-US").to(dtype=M["asr"].dtype)
        M["asr"].generate(**w, return_dict_in_generate=True)


def words_from(ids, dur):
    proc, torch = M["asr_proc"], M["torch"]
    text, offs = proc.decode(torch.tensor([ids]), durations=torch.tensor([dur]), skip_special_tokens=True)
    words = []
    for o in offs[0]:
        tok = o["token"]
        if not words or tok.startswith(" "):
            words.append({"w": tok.strip(), "s": round(o["start"], 3), "e": round(o["end"], 3)})
        else:
            words[-1]["w"] += tok
            words[-1]["e"] = round(o["end"], 3)
    return (text if isinstance(text, str) else text[0]), [w for w in words if w["w"]]


def run_nemotron(x, lang):
    torch, proc, model = M["torch"], M["asr_proc"], M["asr"]
    lang = lang if re.fullmatch("[a-z]{2}-[A-Z]{2}", lang or "") else "en-US"
    segs, words = [], []
    with torch.inference_mode():
        for off, p in pieces(x):
            base = off / SR
            inp = proc(f32(p), sampling_rate=SR, language=lang).to(dtype=model.dtype)
            out = model.generate(**inp, return_dict_in_generate=True, max_new_tokens=int(len(p) / SR * 40) + 100)
            text, ws = words_from(out.sequences[0].tolist(), out.durations[0].tolist())
            text = text.strip()
            if text:
                segs.append({"s": round(base, 3), "e": round(base + len(p) / SR, 3), "t": text})
            words += [{"w": w["w"], "s": round(w["s"] + base, 3), "e": round(w["e"] + base, 3)} for w in ws]
    return segs, words


# ---- Nemotron 3 diarization (transformers, CPU, offline mode) ----
def load_diar():
    import torch
    from transformers import AutoModelForAudioFrameClassification, AutoProcessor
    torch.set_num_threads(THREADS)
    d = MODELS + "/diar"
    M["d_proc"] = AutoProcessor.from_pretrained(d)
    M["diar"] = AutoModelForAudioFrameClassification.from_pretrained(d)
    M["diar"].eval()
    with torch.inference_mode():
        M["diar"](**M["d_proc"](np.zeros(SR * 2, dtype="float32"), sampling_rate=SR).to(dtype=M["diar"].dtype))


def relabel(turns, num_speakers=0):
    # Speaker numbers by first appearance. With num_speakers set, the speakers who talk least are given to the speaker whose nearest turn is closest in time.
    turns = sorted(turns, key=lambda t: (t["s"], t["e"]))
    if num_speakers and num_speakers > 0:
        talk = {}
        for t in turns:
            talk[t["speaker"]] = talk.get(t["speaker"], 0.0) + t["e"] - t["s"]
        keep = set(sorted(talk, key=lambda k: -talk[k])[:num_speakers])
        kept = [t for t in turns if t["speaker"] in keep]
        for t in turns:
            if t["speaker"] not in keep and kept:
                t["speaker"] = min(kept, key=lambda k: min(abs(k["s"] - t["e"]), abs(k["e"] - t["s"])))["speaker"]
    order = {}
    for t in turns:
        order.setdefault(t["speaker"], len(order))
    return [{"s": round(t["s"], 3), "e": round(t["e"], 3), "speaker": order[t["speaker"]]} for t in turns]


def run_diar(x, num_speakers=0):
    torch, P, D = M["torch"], M["d_proc"], M["diar"]
    with torch.inference_mode():
        i = P(f32(x), sampling_rate=SR).to(dtype=D.dtype)
        lg = D(**i).logits
    segs = P.extract_speaker_dict(lg, i.attention_mask)[0]
    return relabel([{"s": float(g["Start"]), "e": float(g["End"]), "speaker": int(g["Speaker"])} for g in segs], num_speakers)


def load_all():
    try:
        t = time.time()
        start_llama()
        qwen_piece(np.full(SR, 500, dtype="int16"))
        STATE["load_ms"]["qwen"] = int((time.time() - t) * 1000)
    except Exception as e:
        STATE["errors"]["qwen"] = repr(e)[:300]
    for name, fn in (("nemotron", load_nemotron), ("diar", load_diar)):
        try:
            t = time.time()
            fn()
            STATE["load_ms"][name] = int((time.time() - t) * 1000)
        except Exception as e:
            import traceback
            traceback.print_exc()
            STATE["errors"][name] = repr(e)[:300]
    STATE["ready"] = len(STATE["load_ms"]) == 3
    STATE["ready_at"] = time.time()
    STATE["boot_to_ready_ms"] = int((time.time() - T0) * 1000)


# ---- sessions: each chunk is kept as raw PCM under DATA/sessions/<hash of the id> ----
def sdir(sid):
    return DATA + "/sessions/" + hashlib.sha1(sid.encode()).hexdigest()[:24]


def sweep_sessions():
    base = DATA + "/sessions"
    if not os.path.isdir(base):
        return
    for d in os.listdir(base):
        p = base + "/" + d
        try:
            if time.time() - os.path.getmtime(p) > SESSION_KEEP_S:
                shutil.rmtree(p, ignore_errors=True)
        except OSError:
            pass


def seqs_of(sid):
    d = sdir(sid)
    if not os.path.isdir(d):
        return []
    return sorted(int(f[:-4]) for f in os.listdir(d) if re.fullmatch("[0-9]+\\.pcm", f))


def session_audio(sid):
    # The held chunks in order on one timeline. A gap before a chunk (its at_ms is later than the audio so far) is filled with at most 2 s of silence.
    # Returns the samples and the map [(assembled_ms, timeline_ms)] used to turn times in the assembled audio back into session times.
    d = sdir(sid)
    parts, marks, have = [], [], 0
    for q in seqs_of(sid):
        x = np.fromfile("%s/%d.pcm" % (d, q), dtype="<i2")
        try:
            at = int(json.load(open("%s/%d.json" % (d, q))).get("at_ms", -1))
        except Exception:
            at = -1
        have_ms = have * 1000 // SR
        if at > have_ms:
            gap = min(at - have_ms, 2000)
            parts.append(np.zeros(gap * SR // 1000, dtype="<i2"))
            have += len(parts[-1])
            have_ms = have * 1000 // SR
        marks.append((have_ms, at if at >= 0 else have_ms))
        parts.append(x)
        have += len(x)
    return (np.concatenate(parts) if parts else np.zeros(0, dtype="<i2")), marks


def to_timeline(ms, marks):
    best = marks[0]
    for m in marks:
        if m[0] <= ms:
            best = m
    return max(0, best[1] + (ms - best[0]))


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/health":
            return self.send(200, {"ready": STATE["ready"], "load_ms": STATE["load_ms"], "errors": STATE["errors"], "boot_to_ready_ms": STATE.get("boot_to_ready_ms"), "uptime_s": round(time.time() - T0, 1), "peak_rss_mb": rss_mb()})
        m = re.fullmatch("/session/([^/]+)", u.path)
        if m:
            return self.send(200, {"seqs": seqs_of(urllib.parse.unquote(m.group(1)))})
        self.send(404, {"error": "no route"})

    def do_DELETE(self):
        m = re.fullmatch("/session/([^/]+)", urllib.parse.urlparse(self.path).path)
        if not m:
            return self.send(404, {"error": "no route"})
        shutil.rmtree(sdir(urllib.parse.unquote(m.group(1))), ignore_errors=True)
        self.send(200, {"ok": True})

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        data = self.body()
        t0 = time.time()
        if not STATE["ready"]:
            return self.send(503, {"error": "loading", "load_ms": STATE["load_ms"], "errors": STATE["errors"]})
        try:
            fmt = q.get("format", "wav")
            if u.path == "/transcribe":
                which = q.get("model", "qwen")
                if which not in ("qwen", "nemotron"):
                    return self.send(400, {"error": "unknown model"})
                x = decode(data, fmt)
                dec_ms = int((time.time() - t0) * 1000)
                if len(x) > MAX_AUDIO_S * SR:
                    return self.send(413, {"error": "the audio is too long"})
                with GATE(len(x) / SR):
                    t1 = time.time()
                    segs, words = run_qwen(x) if which == "qwen" else run_nemotron(x, q.get("lang", ""))
                    used = int((time.time() - t1) * 1000)
                return self.send(200, {"text": " ".join(s["t"] for s in segs), "segs": segs, "words": words, "audio_s": round(len(x) / SR, 3), "process_ms": dec_ms + used, "peak_rss_mb": rss_mb()})
            if u.path == "/diarize":
                x = decode(data, fmt)
                dec_ms = int((time.time() - t0) * 1000)
                if len(x) > MAX_AUDIO_S * SR:
                    return self.send(413, {"error": "the audio is too long"})
                with GATE(len(x) / SR):
                    t1 = time.time()
                    turns = run_diar(x, int(q.get("num_speakers") or 0))
                    used = int((time.time() - t1) * 1000)
                return self.send(200, {"turns": turns, "audio_s": round(len(x) / SR, 3), "process_ms": dec_ms + used, "peak_rss_mb": rss_mb()})
            m = re.fullmatch("/session/([^/]+)/(chunk|diarize)", u.path)
            if m:
                sid, what = urllib.parse.unquote(m.group(1)), m.group(2)
                if what == "chunk":
                    x = decode(data, fmt)
                    seq = int(q["seq"])
                    with SESS_LOCK:
                        sweep_sessions()
                        d = sdir(sid)
                        os.makedirs(d, exist_ok=True)
                        x.astype("<i2").tofile("%s/%d.pcm" % (d, seq))
                        json.dump({"at_ms": int(q.get("at_ms", -1)), "n": int(len(x))}, open("%s/%d.json" % (d, seq), "w"))
                        os.utime(d, None)
                    return self.send(200, {"ok": True, "chunks": len(seqs_of(sid)), "audio_s": round(len(x) / SR, 3), "process_ms": int((time.time() - t0) * 1000)})
                x, marks = session_audio(sid)
                dec_ms = int((time.time() - t0) * 1000)
                if not len(x):
                    return self.send(200, {"turns": [], "audio_s": 0, "process_ms": 0})
                if len(x) > MAX_AUDIO_S * SR:
                    return self.send(413, {"error": "the session is too long"})
                with GATE(len(x) / SR):
                    t1 = time.time()
                    turns = run_diar(x, int(q.get("num_speakers") or 0))
                    used = int((time.time() - t1) * 1000)
                out = [{"start_ms": to_timeline(int(t["s"] * 1000), marks), "end_ms": to_timeline(int(t["e"] * 1000), marks), "speaker": t["speaker"]} for t in turns]
                return self.send(200, {"turns": out, "audio_s": round(len(x) / SR, 3), "process_ms": dec_ms + used, "peak_rss_mb": rss_mb()})
            self.send(404, {"error": "no route"})
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send(500, {"error": repr(e)[:300]})


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):
        # The standard bind looks up the host name with getfqdn, which fails in a container whose host name is too long for the IDNA codec (seen on Cloudflare).
        import socketserver
        socketserver.TCPServer.server_bind(self)
        self.server_name = "speech"
        self.server_port = self.server_address[1]


if __name__ == "__main__":
    os.makedirs(DATA, exist_ok=True)
    threading.Thread(target=load_all, daemon=True).start()
    Server(("0.0.0.0", 8080), H).serve_forever()
`;
