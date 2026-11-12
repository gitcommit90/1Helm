# Channel computer image

`Dockerfile` builds the channel computer from Cloudflare's Sandbox 0.12.10 base. It supplies the FUSE workspace stack, Chrome and live browser view, Python and office tools, and the scripts already used by `ChannelComputer`. The public Wrangler config points its `ChannelComputer` container at this local Dockerfile, so Wrangler builds and pushes the image into the deploying Cloudflare account. No 1HC registry access is needed.

Chrome for Testing is pinned to a stable 155 build; noVNC and the browser Node packages are pinned too. Apt packages and Python packages resolve from their repositories at build time, so rebuilds can receive compatible fixes. Test a new image with a real Cloudflare Container before relying on it for files or browser tasks.

The older `Computer` container used by file preparation uses the public `node:22-bookworm` image in the Wrangler config. It does not use this Dockerfile.
