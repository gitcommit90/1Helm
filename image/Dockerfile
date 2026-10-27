# The same Cloudflare Sandbox base used by the 1HC channel computer.
# Wrangler builds this from image/ and pushes it into the deploying account.
FROM docker.io/cloudflare/sandbox:0.12.10

ARG CHROME_VERSION=155.0.8059.39
ARG NOVNC_VERSION=1.6.0
ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/opt/python/bin:${PATH}

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      ca-certificates curl unzip bash coreutils findutils util-linux \
      squashfuse fuse-overlayfs squashfs-tools \
      xvfb x11vnc xdotool libnss3-tools \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 \
      libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 \
      libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      poppler-utils fonts-crosextra-carlito fonts-crosextra-caladea \
      fonts-inter fonts-ibm-plex fonts-noto-core \
      python3 python3-pip python3-venv \
    && python3 -m venv /opt/python \
    && /opt/python/bin/pip install --no-cache-dir \
      python-docx openpyxl python-pptx matplotlib pypdf pillow brotli requests beautifulsoup4 imageio-ffmpeg \
    && ln -sf "$(/opt/python/bin/python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')" /usr/local/bin/ffmpeg \
    && mkdir -p /opt/chrome /opt/1hc-browser /opt/1hc \
    && curl -fsSL "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" -o /tmp/chrome.zip \
    && unzip -q /tmp/chrome.zip -d /tmp/chrome \
    && cp -a /tmp/chrome/chrome-linux64/. /opt/chrome/ \
    && curl -fsSL "https://github.com/novnc/noVNC/archive/refs/tags/v${NOVNC_VERSION}.tar.gz" -o /tmp/novnc.tar.gz \
    && mkdir -p /opt/1hc-browser/novnc \
    && tar -xzf /tmp/novnc.tar.gz -C /opt/1hc-browser/novnc --strip-components=1 \
    && cd /opt/1hc-browser && printf '{"private":true,"type":"module"}\n' > package.json \
    && npm install --omit=dev --no-audit --no-fund ws@8.22.0 \
    && cd /opt/1hc && printf '{"private":true,"type":"module"}\n' > package.json \
    && npm install --omit=dev --no-audit --no-fund playwright-core@1.56.0 \
    && apt-get download -qq libreoffice-impress \
    && dpkg-deb --fsys-tarfile libreoffice-impress_*.deb | tar -x -C / ./usr/lib/libreoffice/share/config/soffice.cfg/modules/simpress/ui \
    && rm -rf /tmp/chrome /tmp/chrome.zip /tmp/novnc.tar.gz /opt/1hc/libreoffice-impress_*.deb /var/lib/apt/lists/* /var/cache/apt/archives/*.deb /root/.npm

COPY opt/1hc/init.sh /opt/1hc/init.sh
COPY opt/1hc/save.sh /opt/1hc/save.sh
COPY opt/1hc/secure-file.py /opt/1hc/secure-file.py
COPY opt/1hc-browser/server.mjs /opt/1hc-browser/server.mjs
COPY opt/1hc-browser/request-guard.mjs /opt/1hc-browser/request-guard.mjs
COPY usr/local/bin/rg /usr/local/bin/rg
RUN chmod 755 /opt/1hc/init.sh /opt/1hc/save.sh /usr/local/bin/rg \
    && test -x /opt/chrome/chrome \
    && ffmpeg -hide_banner -devices 2>&1 | grep -q x11grab \
    && ffmpeg -hide_banner -encoders 2>&1 | grep -q ' libx264 ' \
    && test -s /opt/1hc-browser/novnc/vnc.html \
    && test -s /usr/lib/libreoffice/share/config/soffice.cfg/modules/simpress/ui/tabviewbar.ui \
    && node --version && python3 --version && soffice --version

EXPOSE 6080 5900 5901
CMD ["/opt/1hc/init.sh"]
