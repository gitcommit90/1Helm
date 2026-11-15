#!/usr/bin/env node
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { iconBlue, iconPng, render } from "./brand-icon.mjs";

const root = resolve(import.meta.dirname, "..");
// Warm paper from the 1HC brand layer (light page). Dark launch colors live in the native night resources.
const paper = { r: 0xf3, g: 0xf2, b: 0xef, alpha: 1 };

async function icon(target, size, variant) {
  await mkdir(dirname(target), { recursive: true });
  await render(variant, size).png({ compressionLevel: 9 }).toFile(target);
}

async function opaqueIcon(target, size) {
  await mkdir(dirname(target), { recursive: true });
  await render("square", size).flatten({ background: iconBlue }).removeAlpha().png({ compressionLevel: 9 }).toFile(target);
}

const markBuffer = (size) => render("rounded", size).png().toBuffer();

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
  await sharp({ create: { width, height, channels: 4, background: paper } })
    .composite([{ input: mark, left: Math.round((width - markSize) / 2), top: Math.round((height - markSize) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(target);
}

const androidRes = join(root, "android", "app", "src", "main", "res");
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(densities)) {
  const folder = join(androidRes, `mipmap-${density}`);
  await icon(join(folder, "ic_launcher.png"), size, "rounded");
  await icon(join(folder, "ic_launcher_round.png"), size, "round");
  await icon(join(folder, "ic_launcher_foreground.png"), Math.round(size * 2.25), "foreground");
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
await opaqueIcon(join(iosAssets, "AppIcon.appiconset", "AppIcon-512@2x.png"), 1024);
for (const filename of await readdir(join(iosAssets, "Splash.imageset"))) {
  if (filename.endsWith(".png")) await launchMark(join(iosAssets, "Splash.imageset", filename), 512);
}

// The bundled connection screen shows the production icon unchanged.
await copyFile(iconPng, join(root, "mobile-gateway", "1helm-logo.png"));

console.log("Generated branded mobile icons and compact launch marks.");
