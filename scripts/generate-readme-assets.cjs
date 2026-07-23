const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const logo = path.join(root, "desktop", "icons", "1helm-macos-app-logo.jpg");
const out = path.join(root, "docs", "assets", "readme-hero.png");
const media = path.join(root, "site", "public", "media");
const assets = path.join(root, "docs", "assets");

const width = 1600;
const height = 640;
const artwork = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1600" y2="640" gradientUnits="userSpaceOnUse">
      <stop stop-color="#b9cdd8"/>
      <stop offset="1" stop-color="#9db7c5"/>
    </linearGradient>
    <radialGradient id="light" cx="0" cy="0" r="1" gradientTransform="translate(1160 120) rotate(137) scale(740 580)" gradientUnits="userSpaceOnUse">
      <stop stop-color="#edf4f5" stop-opacity=".62"/>
      <stop offset="1" stop-color="#edf4f5" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="28" stdDeviation="30" flood-color="#263a55" flood-opacity=".25"/>
    </filter>
    <clipPath id="round"><rect x="1100" y="75" width="480" height="480" rx="72"/></clipPath>
  </defs>
  <rect width="1600" height="640" rx="34" fill="url(#bg)"/>
  <rect width="1600" height="640" rx="34" fill="url(#light)"/>
  <g opacity=".11" fill="none" stroke="#263a55" stroke-width="3" stroke-linecap="round">
    <path d="M0 525c180-46 315-46 495 0s315 46 495 0 315-46 610 8"/>
    <path d="M0 566c180-46 315-46 495 0s315 46 495 0 315-46 610 8"/>
  </g>
  <g font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">
    <text x="104" y="145" fill="#263a55" font-size="22" font-weight="750" letter-spacing="5">1HELM</text>
    <text x="100" y="282" fill="#263a55" font-size="100" font-weight="740" letter-spacing="-6">AI that keeps</text>
    <text x="100" y="390" fill="#263a55" font-size="100" font-weight="740" letter-spacing="-6">the job.</text>
    <text x="105" y="474" fill="#526b7c" font-size="28" font-weight="470">One resident. One private computer. A memory that compounds.</text>
  </g>
  <rect x="1100" y="75" width="480" height="480" rx="72" fill="#263a55" opacity=".18" filter="url(#shadow)"/>
</svg>`);

async function main() {
  const roundedLogo = await sharp(logo)
    .resize(480, 480, { fit: "cover" })
    .composite([{ input: Buffer.from('<svg width="480" height="480"><rect width="480" height="480" rx="72" fill="white"/></svg>'), blend: "dest-in" }])
    .png()
    .toBuffer();
  await sharp(artwork)
    .composite([{ input: roundedLogo, left: 1100, top: 75 }])
    .png({ compressionLevel: 9, quality: 95, effort: 10 })
    .toFile(out);

  for (const name of ["workspace", "skills", "connections"]) {
    const screenshot = await sharp(path.join(media, `${name}.png`))
      .resize(1440, 936, { fit: "cover", position: "top" })
      .composite([{ input: Buffer.from('<svg width="1440" height="936"><rect width="1440" height="936" rx="24" fill="white"/></svg>'), blend: "dest-in" }])
      .png()
      .toBuffer();
    const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1080" viewBox="0 0 1600 1080">
      <defs>
        <linearGradient id="frame" x1="0" y1="0" x2="1600" y2="1080" gradientUnits="userSpaceOnUse"><stop stop-color="#b9cdd8"/><stop offset="1" stop-color="#8da9b9"/></linearGradient>
        <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(1330 80) rotate(135) scale(920 740)" gradientUnits="userSpaceOnUse"><stop stop-color="#eff5f6" stop-opacity=".58"/><stop offset="1" stop-color="#eff5f6" stop-opacity="0"/></radialGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="32" stdDeviation="30" flood-color="#263a55" flood-opacity=".3"/></filter>
      </defs>
      <rect width="1600" height="1080" rx="34" fill="url(#frame)"/>
      <rect width="1600" height="1080" rx="34" fill="url(#glow)"/>
      <rect x="80" y="72" width="1440" height="936" rx="24" fill="#263a55" opacity=".28" filter="url(#shadow)"/>
    </svg>`);
    await sharp(frame)
      .composite([{ input: screenshot, left: 80, top: 72 }])
      .png({ compressionLevel: 9, quality: 92, effort: 10 })
      .toFile(path.join(assets, `readme-${name}.png`));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
