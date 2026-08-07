import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const DEFAULT_FAST_TESTS = Object.freeze([
  "test/phase1-tools.mjs",
  "test/photon.mjs",
]);

export function selectFastTests(root, args, exists = existsSync) {
  const selected = args.length ? args : [...DEFAULT_FAST_TESTS];
  return selected.map((argument) => {
    const path = resolve(root, argument);
    const local = relative(root, path);
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`) || !/^test[/\\].+\.mjs$/.test(local)) {
      throw new Error(`Fast tests must be explicit .mjs files inside test/: ${argument}`);
    }
    if (!exists(path)) throw new Error(`Fast test file does not exist: ${argument}`);
    return local.split(sep).join("/");
  });
}
