# The speech container (src/speech-container.js). The image is only Python 3.11 on Debian, pinned by digest so its reference (and so the snapshot template's version) changes only when this line does.
# curl, the OpenMP runtime, Python packages, llama.cpp and the weights are installed by the pinned setup in src/speech-setup.js, inside Cloudflare, and captured as a snapshot.
FROM python:3.11-slim-bookworm@sha256:f06d01d4ba3f8ad5af45a3ec87df19c1d317d8e8961edc0fabda61811af6f7cf
