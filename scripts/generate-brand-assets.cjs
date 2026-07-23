const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "desktop", "icons", "1helm-macos-app-logo.jpg");

async function writePng(size, target) {
  await sharp(source)
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 })
    .toFile(path.join(root, target));
}

async function main() {
  await writePng(512, "public/brand/1helm-sailboat.png");
  await writePng(192, "public/icons/icon-sailboat-192.png");
  await writePng(512, "public/icons/icon-sailboat-512.png");
  await writePng(512, "public/icons/icon-sailboat-512-maskable.png");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
