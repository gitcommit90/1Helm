import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import sharp from "sharp";

export type ImageDetail = "low" | "high";
export type ChatTextPart = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
export type ChatImagePart = { type: "image_url"; image_url: { url: string; detail: ImageDetail }; cache_control?: { type: "ephemeral" } };
export type ChatContentPart = ChatTextPart | ChatImagePart;
export type ChatContent = string | ChatContentPart[];
export type PreparedImage = { part: ChatImagePart; summary: string; name: string; width: number; height: number; bytes: number; sourceSha256: string };

export const MAX_VISION_IMAGES_PER_REQUEST = 8;
export const MAX_VISION_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_VISION_ENCODED_BYTES_PER_REQUEST = 12 * 1024 * 1024;
export const MAX_VISION_DECODED_PIXELS = 40_000_000;
const DIMENSIONS: Record<ImageDetail, number> = { low: 768, high: 2048 };

/** Decode, orient, resize and re-encode an image before it crosses the provider boundary. */
export async function prepareImageBytes(bytes: Buffer, name: string, detail: ImageDetail = "high"): Promise<PreparedImage> {
  if (bytes.length > MAX_VISION_SOURCE_BYTES) throw new Error(`image exceeds the ${MAX_VISION_SOURCE_BYTES / 1024 / 1024} MB vision limit`);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const normalized = await sharp(bytes, { animated: false, limitInputPixels: MAX_VISION_DECODED_PIXELS, failOn: "warning" })
    .rotate()
    .resize({ width: DIMENSIONS[detail], height: DIMENSIONS[detail], fit: "inside", withoutEnlargement: true })
    .webp({ quality: detail === "high" ? 90 : 80, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  if (!normalized.info.width || !normalized.info.height) throw new Error("image decoded without dimensions");
  const cleanName = basename(String(name || "image"));
  return {
    name: cleanName,
    width: normalized.info.width,
    height: normalized.info.height,
    bytes: normalized.data.length,
    sourceSha256,
    part: { type: "image_url", image_url: { url: `data:image/webp;base64,${normalized.data.toString("base64")}`, detail } },
    summary: `Viewed ${cleanName} as actual image input: WebP ${normalized.info.width}×${normalized.info.height}, ${detail} detail, ${normalized.data.length} encoded bytes, source SHA-256 ${sourceSha256}.`,
  };
}

export async function prepareImageFile(path: string, detail: ImageDetail = "high"): Promise<PreparedImage> {
  const bytes = await readFile(path);
  return prepareImageBytes(bytes, basename(path), detail);
}
