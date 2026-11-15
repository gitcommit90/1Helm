# The Claude engine container (src/ee/claude-engine.js): one per account, runs the unmodified Claude Code CLI headless with the person's own Claude subscription.
# The first stage installs the pinned @anthropic-ai/claude-code package from npm (Node LTS); the final stage is Debian slim with ca-certificates, the
# package's own native claude binary (copied byte for byte), the Node binary (it runs relay/, the model-call relay ported from the Nous Research Hermes
# plugin, see THIRD-PARTY-NOTICES.md) and nothing else. No browser, no npm packages, no other tools, no Claude Agent SDK.
# To change the CLI version, change CLAUDE_CODE_VERSION in this file and in src/ee/claude-engine.js together.
FROM node:22-bookworm-slim AS install
ARG CLAUDE_CODE_VERSION=2.1.316
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && cp "$(readlink -f /usr/local/bin/claude)" /claude && cp "$(readlink -f /usr/local/bin/node)" /node \
 && /claude --version | grep -F "${CLAUDE_CODE_VERSION}"
# Build guard: the sign-in address this CLI carries must be https on the domains the app opens (src/ee/claude-signin-url.js). A new CLI version that moves it fails the build here, not on a person's screen.
COPY relay/check-authorize-url.mjs /check-authorize-url.mjs
RUN node /check-authorize-url.mjs /claude

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 -s /bin/bash node && mkdir -p /work /home/node/.claude && chown -R node:node /work /home/node
COPY --from=install /claude /usr/local/bin/claude
COPY --from=install /node /usr/local/bin/node
COPY relay/ /opt/1hc/relay/
USER node
ENV HOME=/home/node DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
WORKDIR /work
CMD ["sleep", "infinity"]
