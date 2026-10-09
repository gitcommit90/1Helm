#!/usr/bin/env node
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "desktop", "icons", "1helm-macos-app-logo.jpg");

async function icon(target, size) {
  await mkdir(dirname(target), { recursive: true });
  await sharp(source).resize(size, size, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(target);
}

async function markBuffer(size) {
  const radius = Math.round(size * 0.22);
  const mask = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="${radius}" fill="white"/></svg>`);
  const artwork = await sharp(source).resize(size, size, { fit: "cover" }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: artwork }, { input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function launchMark(target, canvasSize, markSize = canvasSize) {
  const mark = await markBuffer(markSize);
  await mkdir(dirname(target), { recursive: true });
  await sharp({ create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: Math.round((canvasSize - markSize) / 2), top: Math.round((canvasSize - markSize) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(target);
}

async function legacySplash(target, width, height) {
  const markSize = Math.round(Math.min(width, height) * 0.18);
  const mark = await markBuffer(markSize);
  await mkdir(dirname(target), { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: { r: 242, g: 239, b: 231, alpha: 1 } } })
    .composite([{ input: mark, left: Math.round((width - markSize) / 2), top: Math.round((height - markSize) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(target);
}

const androidRes = join(root, "android", "app", "src", "main", "res");
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(densities)) {
  const folder = join(androidRes, `mipmap-${density}`);
  await icon(join(folder, "ic_launcher.png"), size);
  await icon(join(folder, "ic_launcher_round.png"), size);
  await icon(join(folder, "ic_launcher_foreground.png"), Math.round(size * 2.25));
}

const androidSplashes = {
  "drawable/splash.png": [480, 320],
  "drawable-land-mdpi/splash.png": [480, 320],
  "drawable-land-hdpi/splash.png": [800, 480],
  "drawable-land-xhdpi/splash.png": [1280, 720],
  "drawable-land-xxhdpi/splash.png": [1600, 960],
  "drawable-land-xxxhdpi/splash.png": [1920, 1280],
  "drawable-port-mdpi/splash.png": [320, 480],
  "drawable-port-hdpi/splash.png": [480, 800],
  "drawable-port-xhdpi/splash.png": [720, 1280],
  "drawable-port-xxhdpi/splash.png": [960, 1600],
  "drawable-port-xxxhdpi/splash.png": [1280, 1920],
};
for (const [relative, [width, height]] of Object.entries(androidSplashes)) await legacySplash(join(androidRes, relative), width, height);
await launchMark(join(androidRes, "drawable-nodpi", "splash_mark.png"), 256);
await launchMark(join(androidRes, "drawable-nodpi", "splash_android12.png"), 256, 96);

const iosAssets = join(root, "ios", "App", "App", "Assets.xcassets");
await icon(join(iosAssets, "AppIcon.appiconset", "AppIcon-512@2x.png"), 1024);
for (const filename of await readdir(join(iosAssets, "Splash.imageset"))) {
  if (filename.endsWith(".png")) await launchMark(join(iosAssets, "Splash.imageset", filename), 512);
}

console.log("Generated branded mobile icons and compact launch marks.");
