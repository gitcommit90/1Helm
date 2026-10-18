// Models that 1Helm runs itself, in the file preparation container (the same PrepContainer that reads documents and scanned pages).
// The ID of such a model is "@1hc/" followed by the Hugging Face repository the weights come from. The transport is the ID's source,
// like "@cf/" for Workers AI: model-plan.js gives the step the source "SELF", and model-dispatch.js sends an embeddings step here.
// Nothing here chooses a model. The saved settings (the Models page) say which model a job runs, and this file only knows how to run
// the weights a saved ID names.
//
// What runs: the public MIT licensed weights of pplx-embed-v1-0.6b (https://huggingface.co/perplexity-ai/pplx-embed-v1-0.6b), the ONNX
// file with int8 weights (onnx/model_quantized.onnx), through ONNX Runtime on the CPU. The output is the model's own int8 embedding
// (1024 values, tanh then round, the same kind of vector Perplexity's API returns). Weights, Python wheels and the uv binary are pinned
// by version and SHA-256 the way sidecar-ocr.js pins the OCR models, and nothing else is fetched.
//
// Equivalence with Perplexity's API (measured 2026-10-18): the vectors are close, not identical. Mean cosine
// 0.995 against the API on 364 chunks and 181 queries, the same top result for 96 to 98 percent of queries, the same hit rates, and a mean
// reciprocal rank of 0.570 to 0.577 against 0.576. model-seed.js lists each model in the other's embedding_equivalents on that evidence.
//
// Cost (measured here with a CPU quota): about 104 tokens a second on the 2 vCPU instance, and the container is
// billed for the seconds it runs, so one call costs its own container time, not a price per token. The cost reported to the caller is the
// container's measured running time at Cloudflare's published rates.
import { UV_URL, UV_SHA, INDRA_REQS } from "./sidecar-ocr.js";

export const SELF_PREFIX = "@1hc/";
export const isSelfHostedModel = (id) => typeof id === "string" && id.length <= 160 && /^@1hc\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(id);
const repoOf = (id) => String(id).slice(SELF_PREFIX.length);

// The weights, by Hugging Face repository. rev is the commit; each file is checked by SHA-256 after the download.
export const SELF_WEIGHTS = {
  "perplexity-ai/pplx-embed-v1-0.6b": {
    kind: "embedding", dims: 1024, rev: "2c4d510dd4a732063c31a0f70193e35067b51fd8",
    files: {
      "model_quantized.onnx": { path: "onnx/model_quantized.onnx", sha: "4f8df41878c7a8cb483516eac180aa61843196e3dd7ec36cc0e83c79abc2047f" },
      "model_quantized.onnx_data": { path: "onnx/model_quantized.onnx_data", sha: "4d7f80998954f14d9555e6655204d928c35f5477499f95acef3002e7eec62b91" },
      "tokenizer.json": { path: "tokenizer.json", sha: "c6fb5c5bbba5fa5f8332edfb6d8aa67bd7fb3d75365b1765f108201698eaebf5" },
    },
  },
};
export const weightsOf = (id) => (isSelfHostedModel(id) ? SELF_WEIGHTS[repoOf(id)] || null : null);

// The container: Cloudflare's published sizes and rates (https://developers.cloudflare.com/containers/platform/pricing/, checked 2026-10-18).
// CPU is billed for active use and memory and disk for the seconds the instance runs, so a busy instance costs the sum below per second.
export const EMBED_INSTANCE = "standard-3";
export const INSTANCES = { basic: { vcpu: 0.25, gib: 1, gb: 4 }, "standard-1": { vcpu: 0.5, gib: 4, gb: 8 }, "standard-2": { vcpu: 1, gib: 6, gb: 12 }, "standard-3": { vcpu: 2, gib: 8, gb: 16 }, "standard-4": { vcpu: 4, gib: 12, gb: 20 } };
export const dollarsPerSecond = (instance) => { const i = INSTANCES[instance]; return i.vcpu * 0.00002 + i.gib * 0.0000025 + i.gb * 0.00000007; };
// Limits of one container job. A job must end within the prep job limit (sidecar.js JOB_MAX_MS minus 30 seconds), and on the 2 vCPU instance
// 104 tokens a second were measured, so a job of at most EMBED_JOB_CHARS characters (about 6,000 tokens, 24,000 in the worst case of one
// token a character) stays inside it.
export const EMBED_JOB_CHARS = 24000, EMBED_JOB_TEXTS = 16, EMBED_TEXT_CHARS = 6000;

// ---- the shell setup run once in the container (and saved in the container's snapshot template) ----
const T = "/opt/1hc-prep";
// The wheels ONNX Runtime needs are the ones sidecar-ocr.js already pins (same versions and hashes), plus the tokenizers wheel (cp310 abi3, manylinux x86_64).
const SHARED = ["flatbuffers", "numpy", "onnxruntime", "packaging", "protobuf"];
export const EMBED_REQS = [...INDRA_REQS.split("\n").filter((l) => SHARED.includes(l.split("==")[0])),
  "tokenizers==0.23.3 --hash=sha256:376851d22bcf9d650a5c3090bb83e6cf9e895fbf0595369fa4cd43c1f69b5f87"].join("\n");
export const EMBED_VERSION = "1";
export function embedSetup() {
  const w = SELF_WEIGHTS["perplexity-ai/pplx-embed-v1-0.6b"];
  const downloads = Object.entries(w.files).map(([name, f]) => `${name},${f.path},${f.sha}`).join(" ");
  return `set -e; mkdir -p ${T}; cd ${T}
[ "$1" = embed ] || { echo "unknown setup"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is missing from the image"; exit 1; }
if [ ! -x ${T}/venv-embed/bin/python ] || [ ! -f ${T}/venv-embed/.embed-${EMBED_VERSION} ]; then
  [ -x ${T}/uv ] || { curl -fsSL -o u.tgz ${UV_URL}; echo "${UV_SHA}  u.tgz" | sha256sum -c - >/dev/null; tar xzf u.tgz --strip-components=1 -C ${T} uv-x86_64-unknown-linux-musl/uv; rm u.tgz; }
  rm -rf ${T}/venv-embed; ${T}/uv venv --quiet --python "$(command -v python3)" ${T}/venv-embed
  cat > ${T}/embed-reqs.txt <<'1HC_REQS'
${EMBED_REQS}
1HC_REQS
  ${T}/uv pip install --quiet --python ${T}/venv-embed/bin/python --require-hashes --only-binary :all: --no-deps -r ${T}/embed-reqs.txt
  touch ${T}/venv-embed/.embed-${EMBED_VERSION}
fi
if [ ! -f ${T}/embed-models/.ok-${w.rev} ]; then
  rm -rf ${T}/embed-models; mkdir -p ${T}/embed-models
  for d in ${downloads}; do n="\${d%%,*}"; r="\${d#*,}"; p="\${r%%,*}"; h="\${r##*,}"; curl -fsSL -o ${T}/embed-models/$n https://huggingface.co/perplexity-ai/pplx-embed-v1-0.6b/resolve/${w.rev}/$p; echo "$h  ${T}/embed-models/$n" | sha256sum -c - >/dev/null; done
  touch ${T}/embed-models/.ok-${w.rev}
fi
cat > ${T}/embed.py <<'1HC_PY'
${EMBED_PY}
1HC_PY`;
}

// ---- the Python side: texts in, one int8 vector per text out ----
// argv: the input file ({"texts": [...]}), the model directory, the number of threads. Texts are sorted by length and run in batches of
// at most MAX_BATCH_TOKENS tokens (padding is masked, so a text's vector does not depend on its batch). A text is cut at MAX_TOKENS tokens.
// Prints one JSON line: dims, n, tokens, vec (all vectors as base64 of int8 bytes, text order), load_ms, run_ms.
export const EMBED_PY = String.raw`import base64, json, sys, time

def main():
    src, model_dir, threads = sys.argv[1], sys.argv[2], max(1, int(sys.argv[3]))
    MAX_TOKENS, MAX_BATCH_TOKENS, PAD = 4096, 4096, 151643
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    texts = json.load(open(src))["texts"]
    tok = Tokenizer.from_file(model_dir + "/tokenizer.json")
    t0 = time.time()
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    sess = ort.InferenceSession(model_dir + "/model_quantized.onnx", so, providers=["CPUExecutionProvider"])
    load_ms = int((time.time() - t0) * 1000)
    enc = [tok.encode(t).ids[:MAX_TOKENS] or [PAD] for t in texts]
    order = sorted(range(len(texts)), key=lambda i: len(enc[i]))
    out = [None] * len(texts)
    batches, cur = [], []
    for i in order:
        if cur and (len(cur) + 1) * len(enc[i]) > MAX_BATCH_TOKENS:
            batches.append(cur)
            cur = []
        cur.append(i)
    if cur:
        batches.append(cur)
    t1 = time.time()
    for b in batches:
        L = max(len(enc[i]) for i in b)
        ids = np.full((len(b), L), PAD, dtype=np.int64)
        mask = np.zeros((len(b), L), dtype=np.int64)
        for r, i in enumerate(b):
            ids[r, :len(enc[i])] = enc[i]
            mask[r, :len(enc[i])] = 1
        res = sess.run(["pooler_output_int8"], {"input_ids": ids, "attention_mask": mask})[0]
        for r, i in enumerate(b):
            out[i] = res[r].astype(np.int8).tobytes()
    run_ms = int((time.time() - t1) * 1000)
    dims = len(out[0]) if out else 0
    print(json.dumps({"dims": dims, "n": len(out), "tokens": sum(len(e) for e in enc), "vec": base64.b64encode(b"".join(out)).decode(), "load_ms": load_ms, "run_ms": run_ms}))

if __name__ == "__main__":
    main()
`;

// The seconds of container time a reservation allows for each job on top of the tokens: a cold start from the snapshot (32 s measured on dev, 2026-10-18, for an 807 MB snapshot), loading the model and the wait.
export const SELF_CALL_SECONDS = 60;
export const selfCallReserveNano = (texts) => Math.ceil(embedGroups(texts).length * SELF_CALL_SECONDS * dollarsPerSecond(EMBED_INSTANCE) * 1e9);

// ---- the transport ----
const b64Bytes = (s) => { const raw = atob(s), a = new Int8Array(raw.length); for (let i = 0; i < raw.length; i++) a[i] = (raw.charCodeAt(i) << 24) >> 24; return a; };
// Splits the texts into container jobs that each stay inside the job limits, in order.
export function embedGroups(texts) {
  const groups = []; let cur = [], chars = 0;
  for (const t of texts) {
    const n = Math.min(String(t).length, EMBED_TEXT_CHARS);
    if (cur.length && (cur.length >= EMBED_JOB_TEXTS || chars + n > EMBED_JOB_CHARS)) { groups.push(cur); cur = []; chars = 0; }
    cur.push(String(t).slice(0, EMBED_TEXT_CHARS)); chars += n;
  }
  if (cur.length) groups.push(cur);
  return groups;
}
// The container binding: the snapshot class where it exists (dev and Live), else the Computer class (self hosting), as sidecar.js containerJob does.
const bindingOf = (env) => (env?.PREP_CONTAINER && env.PREP_SNAPSHOTS !== "off" ? env.PREP_CONTAINER : env?.COMPUTER) || null;
export const snapshotRuntime = (env) => !!(env?.PREP_CONTAINER && env.PREP_SNAPSHOTS !== "off");
// An OpenAI shaped embeddings answer: data[].embedding (the int8 values), usage.prompt_tokens and usage.cost (dollars of container time).
export async function selfHostedEmbeddings(env, model, texts, meta = {}) {
  const w = weightsOf(model);
  if (!w || w.kind !== "embedding") throw new Error(`${model} has no weights this server can run`);
  const binding = bindingOf(env); if (!binding) throw new Error("No container is available to run this model on this server.");
  if (!Array.isArray(texts) || !texts.length || texts.some((t) => typeof t !== "string")) throw new Error("embeddings need a list of texts");
  const tenant = String(meta.tenant || "platform").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "platform";
  const stub = binding.get(binding.idFromName(`prepjob:${tenant}`));
  const snapshots = snapshotRuntime(env), instance = snapshots ? EMBED_INSTANCE : "basic";   // the Computer class runs on its basic instance
  const data = []; let tokens = 0, ms = 0;
  for (const group of embedGroups(texts)) {
    const x = await stub.prepJob({ op: "embed", ext: "json", texts: group, template: "embed", threads: Math.max(1, Math.floor(INSTANCES[instance].vcpu)) });
    if (!x || x.error || typeof x.vec !== "string" || x.n !== group.length) throw new Error(`the embedding job failed (${String(x?.error || "no answer").slice(0, 160)})`);
    const q = b64Bytes(x.vec), dims = x.dims;
    if (dims !== w.dims || q.length !== dims * group.length) throw new Error("the embedding job returned vectors of the wrong size");
    for (let i = 0; i < group.length; i++) data.push({ embedding: Array.from(q.subarray(i * dims, (i + 1) * dims)), index: data.length });
    tokens += Number(x.tokens) || 0; ms += Number(x.ms) || 0;
  }
  const rate = dollarsPerSecond(instance);
  return { object: "list", model, data, usage: { prompt_tokens: tokens, total_tokens: tokens, cost: (ms / 1000) * rate, container_ms: ms, instance } };
}
