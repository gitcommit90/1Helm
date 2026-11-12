// What is installed in the speech container, pinned the way selfhost-models.js and sidecar-ocr.js pin theirs: every Python wheel by version and SHA-256
// (the list below was made on 2026-10-22 with "uv pip compile --python-version 3.11 --python-platform x86_64-manylinux_2_28 --format pylock.toml" for torch 2.8.0+cpu,
// transformers 5.20.2, numpy, librosa, soundfile and imageio-ffmpeg, which carries a static ffmpeg), the llama.cpp release by URL and SHA-256, and each weight file by
// the Hugging Face commit and SHA-256. Nothing else is fetched. The setup runs inside Cloudflare (this host uploads at about 1.8 MB/s, so no weights or packages go into an image)
// (the image holds only Python 3.11 on Debian, image/speech/Dockerfile, so curl and libgomp1 come from apt at the start of the setup)
// and its result is captured as a snapshot template (prep-container.js, job-template.js).
import { UV_URL, UV_SHA } from "./sidecar-ocr.js";
import { SPEECH_PY } from "./speech-server-py.js";

export const SPEECH_ROOT = "/opt/1hc-speech";
export const SPEECH_VERSION = "1";
export const SPEECH_INSTANCE = "standard-4";   // 4 vCPU, 12 GiB, 20 GB disk
export const SPEECH_MAX_INFLIGHT = 3;          // requests one container takes at once before the pool wakes another slot
export const LLAMA_URL = "https://github.com/ggml-org/llama.cpp/releases/download/b11826/llama-b11826-bin-ubuntu-x64.tar.gz";
export const LLAMA_SHA = "648412591b5779270a0d373da1e9fc244ae899eca678935d3aa201cb313f6887";
export const SPEECH_INDEX = "https://download.pytorch.org/whl/cpu";
// Weight files by folder. rev is the Hugging Face commit, each file is checked by SHA-256 after the download.
export const SPEECH_WEIGHTS = {
  qwen: { repo: "ggml-org/Qwen3-ASR-1.7B-GGUF", rev: "36a678687ba7d07a74ca70ccb0e36902e005fb80", files: {
    "Qwen3-ASR-1.7B-Q8_0.gguf": "58e22d0532d4eacaf034cfac17a6fed159f37c41390c710186783be439d1fc57",
    "mmproj-Qwen3-ASR-1.7B-Q8_0.gguf": "46c1d533af3f354ceb37ce855dbceff7da7fa7cf1e6a523df3b13440bd164c0d" } },
  nemotron: { repo: ["nvidia", "nemotron-3.5-asr-streaming-0.6b"].join("/"), rev: "ea30d66debe3740a08b573244286791d423d6b3e", files: {
    "model.safetensors": "9eebdd6590289cb3030f310858f3df93256600a800a3e8200c5993d5f967e174",
    "config.json": "62d186fd91f518e00e7867500f1f5819225e8ee95ea3e21b546514bf2048e845",
    "generation_config.json": "993e5d4cb74a6fe9d6e7084a76b3313c1446740679be4676570c23b664fdc07e",
    "processor_config.json": "ec47870f1091ea4f25539208387b45b902c92d0e3f997a30061ef88f73437ab0",
    "tokenizer.json": "3f3d481deb073b64c2082e8c7860d487a3a62774bf4e9e4faac83007e181f246",
    "tokenizer_config.json": "5c641c5b3f50702a60082690d27c1ce7fcb5a92c4a624793bcae0f21eda3d6e0" } },
  diar: { repo: ["nvidia", "Nemotron-3-Diarization"].join("/"), rev: "f667ed73aee57d40cc39428eb768b4fd87a0a29e", files: {
    "model.safetensors": "c074d86335b3b794f8fa5edc25594558f128bdb3914d27806a3a5a2e44963cb6",
    "config.json": "dd795ec07ffa09acf18d231aa3fa8642aa5c521760953754e02559a7413b6873",
    "processor_config.json": "91726746788a024a2f0f2f699a6c3667f0d74e6a0e9288fc44fe3018e23af68e" } },
};
export const SPEECH_REQS = `annotated-doc==0.0.5 --hash=sha256:117bac03a25ede5df5440e855b32d556049ca169ead221505badf432fed4b101
anyio==4.15.1 --hash=sha256:6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101
audioread==3.1.0 --hash=sha256:b30d1df6c5d3de5dcef0fb0e256f6ea17bdcf5f979408df0297d8a408e2971b4
certifi==2026.10.19 --hash=sha256:42d35340cc5b9ba78e818ddbff0c5b1c2b779de448a340fd1b989f5fa8670e1b
cffi==2.1.1 --hash=sha256:34e261f78cb6ceaaa36f42f2613f4380d94d9c759a9c73c769ee6e0247364632
charset-normalizer==3.5.2 --hash=sha256:1c50fe28bbc2ced33386f298650d91218076c05420e6cbd790b913adc41659e7 --hash=sha256:211d5a3eb6af8f513b8d4ca19a8c1b7accab1b5f0d3175f9826b03c1a920dc1f --hash=sha256:b6b751274acb69d77b3323d6b7dbaa3c7fdfc1eb829b7eb61d262f32e1af9685
click==8.5.0 --hash=sha256:255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360
cloudpickle==3.1.2 --hash=sha256:9acb47f6afd73f60dc1df93bb801b472f05ff42fa6c84167d25cb206be1fbf4a
decorator==5.3.1 --hash=sha256:f47fe6fdbd2edd623ecfe36875d37aba411624e2670dd395dddae1358689bb3c
filelock==4.2.4 --hash=sha256:301241438c57936ef93f4243a94f2559022268bfcf9b375a9a72eb0f8db8358e
fsspec==2026.9.0 --hash=sha256:8dd6e646e99ea382bd85f97a45e6b526a442d79423a7dc673f1e2756d05fcb5f
h11==0.16.0 --hash=sha256:63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86
hf-xet==1.7.0 --hash=sha256:2814a6e999d13464c4d679b788cc5d784eb5a4edfc638a31f10e9a11ab531ef8
httpcore2==2.16.0 --hash=sha256:5c4358319f2602d984ad93182c9fee5160f22e9da7babdda870a5e7c4e2dc34f
httpx2==2.16.0 --hash=sha256:fd2c5d7909e8d86fe92d53020c310ca0e4e431b838c207c5754b9bbf0308d49a
huggingface-hub==2.2.0 --hash=sha256:1667f145dc56dc210d60966069397df9ecfca9607a5d43db88b308c89dae56b3
idna==3.20 --hash=sha256:ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c
imageio-ffmpeg==0.6.0 --hash=sha256:c7e46fcec401dd990405049d2e2f475e2b397779df2519b544b8aab515195282
jinja2==3.1.6 --hash=sha256:85ece4451f492d0c13c5dd7c13a64681a86afae63a5f347908daf103ce6d2f67
joblib==1.6.0 --hash=sha256:3dbbf9f6e4b592a2357b854608e980fe6390d131d7a82f011a377ef2ebef7aba
lazy-loader==0.6 --hash=sha256:77253be3391b06124a0e16105bd663b6c54470af1a9ca8e1cf026f38d58ed056
librosa==0.11.0 --hash=sha256:0b6415c4fd68bff4c29288abe67c6d80b587e0e1e2cfb0aad23e4559504a7fa1
llvmlite==0.50.0 --hash=sha256:a6ffde00d4be8772a24e3e8b3af6bf86a79e7cf066d944ef56136b3957d707dc
markdown-it-py==4.2.0 --hash=sha256:9f7ebbcd14fe59494226453aed97c1070d83f8d24b6fc3a3bcf9a38092641c4a
markupsafe==3.0.4 --hash=sha256:6da83a088f8ef93b2d483a8232a4dbf4d69d3d8496b568a03c56becac43e1808
mdurl==0.1.2 --hash=sha256:84008a41e51615a49fc9966191ff91509e3c40b939176e643fd50a5c2196b8f8
mpmath==1.3.0 --hash=sha256:a0b2b9fe80bbcd81a6647ff13108738cfb482d481d826cc0e02f5b35e5c88d2c
msgpack==1.2.3 --hash=sha256:382b219de3d436de3baba0f4b0c6d4336e8f5858d0eb047918b13b69a71c6c55
narwhals==2.27.1 --hash=sha256:d057df13f5852b8e157596e82eb5e955fad267425df5e420e0ee9863da483b31
networkx==3.6.1 --hash=sha256:d47fbf302e7d9cbbb9e2555a0d267983d2aa476bac30e90dfbe5669bd57f3762
numba==0.68.0 --hash=sha256:68f92839637a2aaca8ae124c3abf91f648d2fade50953ea8e81ec604ac05a771
numpy==2.4.6 --hash=sha256:89cd468399cfd2504718f0ba50e410dca55a170b61a02ad92bb18c8a65186e93
packaging==26.3 --hash=sha256:d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c
platformdirs==4.13.5 --hash=sha256:53d3ec4280b815c1e0b02edad7f9ee8fda1ba9c0865dd9c2e6e63849ce82fc1e
pooch==1.9.0 --hash=sha256:f265597baa9f760d25ceb29d0beb8186c243d6607b0f60b83ecf14078dbc703b
pycparser==3.12 --hash=sha256:a076f3f489b39b43ed13563a1dafe42447445bec2e294154ec5c57fcdda4c85e
pygments==2.21.0 --hash=sha256:2363c69b61c4a97c838da3b130dcd6468f4848992b21a82f2a63ec34377137d9
pyyaml==6.0.3 --hash=sha256:b8bb0864c5a28024fac8a632c443c87c5aa6f215c0b126c449ae1a150412f31d
regex==2026.9.29 --hash=sha256:612b709381c0355b70d89cdb51b7f670591ed5cbbc0e3b5337488019dc667b65
requests==2.34.2 --hash=sha256:2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0
rich==15.0.0 --hash=sha256:33bd4ef74232fb73fe9279a257718407f169c09b78a87ad3d296f548e27de0bb
safetensors==0.8.0 --hash=sha256:fd6f3f93c9a0a7cc2788ee63fb763353d4bd2e89b0751bc78fcf7dda00bea774
scikit-learn==1.9.1 --hash=sha256:52a0703bbc07ad27f560fa63fa68e4c54dd735bfbbf65b4dd3c225dc7547b6df
scipy==1.17.1 --hash=sha256:43af8d1f3bea642559019edfe64e9b11192a8978efbd1539d7bc2aaa23d92de4
shellingham==1.5.4 --hash=sha256:7ecfff8f2fd72616f7481040475a65b2bf8af90a56c89140852d1120324e8686
soundfile==0.14.0 --hash=sha256:1e38bac1853412871318e82a1ba69a8be677619b56025bbfcccdb41b6cafe82d --hash=sha256:8ba81ae3a89fd5ab3bef8a8eb481fbbe794e806309675a89b4df48b8d31908a8
soxr==1.1.0 --hash=sha256:3da87e3ffa3e41823d873b051c7ecb2acebd8d1b6b46b752f5facf10a0d84ab9
sympy==1.14.0 --hash=sha256:e091cc3e99d2141a0ba2847328f5479b05d94a6635cb96148ccb3f34671bd8f5
threadpoolctl==3.7.0 --hash=sha256:cd8b60b5641b45c67bbf73c64c843235fc2d8a480c87389f52f5dbee893b86be
tokenizers==0.23.3 --hash=sha256:376851d22bcf9d650a5c3090bb83e6cf9e895fbf0595369fa4cd43c1f69b5f87
torch==2.8.0+cpu --hash=sha256:cb06175284673a581dd91fb1965662ae4ecaba6e5c357aa0ea7bb8b84b6b7eeb
tqdm==4.70.1 --hash=sha256:c293e525e6fef9c20e8728fd4612df02a0aa31bb5fe91ecd93e123b1b7bffa73
transformers==5.20.2 --hash=sha256:7ae75dbc1fb3922aff1b6c97b9e5479d6cf26fd86a8866bfb71324190479f807
truststore==0.10.5 --hash=sha256:9aaaedaefaf06d8b206278cf8b5012bc897f485a874503501e12d776df78951c
typer==0.27.3 --hash=sha256:e50022f28b82a86313e54501317a1db64bf8f8d036ff8cfe5ca7e47675454aff
typing-extensions==4.16.0 --hash=sha256:481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8
urllib3==2.8.0 --hash=sha256:0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3`;
const T = SPEECH_ROOT;
export function speechSetup() {
  const lines = Object.entries(SPEECH_WEIGHTS).flatMap(([dir, w]) => Object.entries(w.files).map(([name, sha]) => `${dir},${w.repo},${w.rev},${name},${sha}`)).join(" ");
  return `set -e; mkdir -p ${T}; cd ${T}
[ "$1" = speech ] || { echo "unknown setup"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is missing from the image"; exit 1; }
if ! command -v curl >/dev/null || ! ldconfig -p | grep -q libgomp; then
  apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends curl ca-certificates libgomp1 >/dev/null; rm -rf /var/lib/apt/lists/*
fi
if [ ! -x ${T}/venv/bin/python ] || [ ! -f ${T}/venv/.speech-${SPEECH_VERSION} ]; then
  [ -x ${T}/uv ] || { curl -fsSL -o u.tgz ${UV_URL}; echo "${UV_SHA}  u.tgz" | sha256sum -c - >/dev/null; tar xzf u.tgz --strip-components=1 -C ${T} uv-x86_64-unknown-linux-musl/uv; rm u.tgz; }
  rm -rf ${T}/venv; ${T}/uv venv --quiet --python "$(command -v python3)" ${T}/venv
  cat > ${T}/speech-reqs.txt <<'1HC_REQS'
${SPEECH_REQS}
1HC_REQS
  ${T}/uv pip install --quiet --python ${T}/venv/bin/python --require-hashes --only-binary :all: --no-deps --extra-index-url ${SPEECH_INDEX} --index-strategy unsafe-best-match -r ${T}/speech-reqs.txt
  touch ${T}/venv/.speech-${SPEECH_VERSION}
fi
if [ ! -x ${T}/llama/llama-server ]; then
  curl -fsSL -o l.tgz ${LLAMA_URL}; echo "${LLAMA_SHA}  l.tgz" | sha256sum -c - >/dev/null
  rm -rf ${T}/llama; mkdir -p ${T}/llama; tar xzf l.tgz --strip-components=1 -C ${T}/llama; rm l.tgz
fi
for d in ${lines}; do IFS=, read -r dir repo rev name sha <<<"$d"
  f=${T}/models/$dir/$name
  if [ ! -f $f ] || ! echo "$sha  $f" | sha256sum -c - >/dev/null 2>&1; then
    mkdir -p ${T}/models/$dir; curl -fsSL -o $f https://huggingface.co/$repo/resolve/$rev/$name; echo "$sha  $f" | sha256sum -c - >/dev/null
  fi
done
cat > ${T}/speech_server.py <<'1HC_PY'
${SPEECH_PY}
1HC_PY
cat > ${T}/start.sh <<'1HC_SH'
#!/bin/bash
export HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=4 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
exec ${T}/venv/bin/python -u ${T}/speech_server.py >> /tmp/speech-server.log 2>&1
1HC_SH
chmod +x ${T}/start.sh`;
}
// The command that must work in a finished template before it is saved.
export const SPEECH_VERIFY = `${T}/venv/bin/python -c 'import torch, transformers, librosa, soundfile, imageio_ffmpeg, numpy; assert imageio_ffmpeg.get_ffmpeg_exe()' && test -x ${T}/llama/llama-server && test -f ${T}/models/qwen/Qwen3-ASR-1.7B-Q8_0.gguf && test -f ${T}/models/nemotron/model.safetensors && test -f ${T}/models/diar/model.safetensors && test -x ${T}/start.sh`;
