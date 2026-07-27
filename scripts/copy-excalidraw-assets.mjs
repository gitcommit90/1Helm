import { cp, mkdir, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";

const source = join(process.cwd(), "node_modules", "@excalidraw", "excalidraw", "dist", "prod");
const target = join(process.cwd(), "public", "excalidraw");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await copyFile(join(source, "index.css"), join(target, "index.css"));
await cp(join(source, "fonts"), join(target, "fonts"), { recursive: true, force: true });

console.log("copied self-hosted Excalidraw styles and fonts");
