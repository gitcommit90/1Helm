// Scanned-page OCR for the prep container job (sidecar.js "prepjob:<tenant>", op "ocr"): Indra OCR (Datalab), run offline.
// Since the OCR Worker (ocr-worker/, the same pipeline ported to JavaScript) reads scanned pages first, this container path is the fallback: it reads a
// page the Worker can't (a Chinese line needs rec_cjk.onnx, 9.3 MB, which doesn't fit in a Worker; a file or page over the Worker's caps; an error),
// and every page where the OCR service binding is absent (self-hosting, Live until it is configured). It is unchanged.
//
// Why Indra: in the head-to-head bench (a private benchmark on 2026-10-14, 4 cores, synthetic scans) it read the 1-page sample bill with a
// character error rate (CER) of 0.0238 and a 15-page annual report with a CER of 0.0005 at 0.32 s a page, and the Captain chose it to replace
// pdf-inspector's own OCR (PP-OCRv6 Small). pdf-inspector still decides which pages need OCR (in the Worker, and in the container "md" op).
//
// License: the Indra OCR code is Apache 2.0. The model weights are under the AI Pubs Open RAIL-M License (Modified), made by Datalab
// (https://huggingface.co/datalab-to/indra-ocr). The license text and the credit to Datalab are in THIRD-PARTY-NOTICES.md.
//
// Supply chain: everything is pinned and checked, and nothing else is fetched.
//   uv 0.11.7: a static binary, SHA-256 checked. The node:22-bookworm image has python3 (3.11) but neither pip nor venv, so uv makes the
//     virtual environment from that python3 and installs the wheels.
//   Python wheels: exact versions with SHA-256 hashes (uv pip install --require-hashes --only-binary :all: --no-deps). The list leaves out
//     huggingface_hub and its dependencies because the models are fetched here, not by Indra.
//   Models: Hugging Face datalab-to/indra-ocr at the commit that tag v3.1 points to (the model set indra-ocr 0.3.1 was built and tested
//     against), each file checked by SHA-256, then kept in INDRA_OCR_MODEL_DIR. Indra runs with HF_HUB_OFFLINE=1 and never downloads.
export const INDRA_VERSION = "0.3.1";
export const UV_URL = "https://github.com/astral-sh/uv/releases/download/0.11.7/uv-x86_64-unknown-linux-musl.tar.gz";
export const UV_SHA = "64ddb5f1087649e3f75aa50d139aa4f36ddde728a5295a141e0fa9697bfb7b0f";
export const INDRA_HF_REV = "d7c839c892bfe4b8993373db64c62f154d05d70b";   // tag v3.1 of datalab-to/indra-ocr
export const INDRA_MODELS = {
  "det.onnx": "46b0050ce4c4692f887a1a9c038480223af1c7a91b3fcced2657d9cf00290dc4",
  "rec.onnx": "e243be069b357e56a0e867a21d7482e498df42fb19678bfb67a25f48b1f06151",
  "order.onnx": "23635dd2324b4ccc00c408af961273a2dedd2e4f0386bc54dba678c41bcf6b46",
  "orient.onnx": "8d7bfce5d08bcad55955f41ca494a7f9d9d3ed5d5b6da1f6f276d5c509590729",
  "script.onnx": "5ba37030e817affede0097a7503b6829624104166c6e0b6aacecacf919fc7d11",
  "rec_cjk.onnx": "4cec840b55e1bb7f375daf30a2975404a867a71ac1a5bc5b1629c4909ce16baa",
  "meta.json": "ff6ec58f91c93a475ae9505ad21c73c3ecda0b378f1d889dd83408e10832d1bb",
};
export const INDRA_REQS = [
  "flatbuffers==25.12.19 --hash=sha256:7634f50c427838bb021c2d66a3d1168e9d199b0607e6329399f04846d42e20b4",
  "numpy==2.4.6 --hash=sha256:89cd468399cfd2504718f0ba50e410dca55a170b61a02ad92bb18c8a65186e93",
  "onnxruntime==1.31.0 --hash=sha256:d4092b78fc5bab77ce6522393098cdb2535423045ecdcff15cc0d022162d6b66",
  "opencv-python-headless==5.0.0.93 --hash=sha256:09a872a157c1376ab922a69bbf22f9a95bcc7b658a9d8b436a60212b02b2eeb4 --hash=sha256:ed709fdf9aa0bd1f2ed8549e71d19449b03a675bb581eb292285f6861953be37",
  "packaging==26.3 --hash=sha256:d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c",
  "protobuf==7.36.2 --hash=sha256:89f23aa53c24553a2416fd4fd1ec06f74fa42b14b546d8883128813f775bbfd2 --hash=sha256:bdb3a345d48db958e6ce1f18e508beb0cc981d64f24088427549c866cd039f1e",
  "pypdfium2==5.14.0 --hash=sha256:11f281613fa22313d9c7ab89947665e84eccf8ebe40e1198a84a88352305648d",
  "indra-ocr==0.3.1 --hash=sha256:9a99d2a18cf288c336c065946204be45f8cffb3bc37e96357b73939251442ed2",
].join("\n");

// The shell part of PREP_SETUP for op "ocr". $T is the install directory. Safe to run before every job: each step is skipped when its
// result is already there, and the models are re-checked only when the marker file is missing.
export function indraSetup(T) {
  const files = Object.entries(INDRA_MODELS).map(([f, h]) => `${f}:${h}`).join(" ");
  return `command -v python3 >/dev/null || { echo "python3 is missing from the image"; exit 1; }
  if [ ! -x ${T}/venv/bin/python ] || [ ! -f ${T}/venv/.indra-${INDRA_VERSION} ]; then
    [ -x ${T}/uv ] || { curl -fsSL -o u.tgz ${UV_URL}; echo "${UV_SHA}  u.tgz" | sha256sum -c - >/dev/null; tar xzf u.tgz --strip-components=1 -C ${T} uv-x86_64-unknown-linux-musl/uv; rm u.tgz; }
    rm -rf ${T}/venv; ${T}/uv venv --quiet --python "$(command -v python3)" ${T}/venv
    cat > ${T}/reqs.txt <<'1HC_REQS'
${INDRA_REQS}
1HC_REQS
    ${T}/uv pip install --quiet --python ${T}/venv/bin/python --require-hashes --only-binary :all: --no-deps -r ${T}/reqs.txt
    touch ${T}/venv/.indra-${INDRA_VERSION}
  fi
  if [ ! -f ${T}/models/.ok-${INDRA_HF_REV} ]; then
    rm -rf ${T}/models; mkdir -p ${T}/models
    for fh in ${files}; do f="\${fh%%:*}"; h="\${fh##*:}"; curl -fsSL -o ${T}/models/$f https://huggingface.co/datalab-to/indra-ocr/resolve/${INDRA_HF_REV}/$f; echo "$h  ${T}/models/$f" | sha256sum -c - >/dev/null; done
    touch ${T}/models/.ok-${INDRA_HF_REV}
  fi
  cat > ${T}/ocr.py <<'1HC_PY'
${INDRA_PY}
1HC_PY`;
}

// The Python side: OCR the requested pages of one PDF with Indra (mode "ocr": the text layer is never read) and print one JSON line.
// argv: the PDF, the 1-based page numbers (comma separated; empty means the first max pages), the most pages, the DPI.
// The requested pages are copied into a small PDF first, so only they are rendered. indra_ocr.convert_many spreads pages over one worker
// process per core (all the cores the container gives it); with fewer than 4 pages it runs one process with all cores on each page.
// It must run from a file under "if __name__ == '__main__'", because its workers are started with the spawn method.
export const INDRA_PY = String.raw`import json, os, sys, tempfile, time

def main():
    src, pages_arg, cap, dpi = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
    import pypdfium2 as pdfium
    from indra_ocr import convert_many
    t0 = time.time()
    doc = pdfium.PdfDocument(src)
    n = len(doc)
    want = []
    for x in pages_arg.split(","):
        if x.strip().isdigit() and 1 <= int(x) <= n and int(x) not in want:
            want.append(int(x))
    if not want:
        want = list(range(1, min(n, cap) + 1))
    want = want[:cap]
    sub = pdfium.PdfDocument.new()
    sub.import_pages(doc, [p - 1 for p in want])
    fd, tmp = tempfile.mkstemp(suffix=".pdf", dir=os.path.dirname(src))
    os.close(fd)
    try:
        sub.save(tmp)
        sub.close()
        doc.close()
        res = list(convert_many([tmp], path=os.environ["INDRA_OCR_MODEL_DIR"], dpi=dpi, mode="ocr"))
    finally:
        os.unlink(tmp)
    result = res[0][1]
    if not isinstance(result, list):
        print(json.dumps({"error": str(result)[:300]}))
        return
    pages = []
    for i, page in result:
        if page.source == "error":
            continue
        md = page.markdown if page.markdown is not None else "\n".join(l.text for l in page.lines)
        confs = [l.conf for l in page.lines]
        pages.append({"page": want[i], "md": md, "src": page.source, "conf": round(sum(confs) / len(confs), 4) if confs else None})
    print(json.dumps({"pages": pages, "routed": want, "ocrMs": int((time.time() - t0) * 1000)}))

if __name__ == "__main__":
    main()
`;
