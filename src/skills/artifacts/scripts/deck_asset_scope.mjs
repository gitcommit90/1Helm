// Which local files an artifact's own HTML may load (used by render_audit.mjs
// and assemble_deck.mjs, which both open the source as a file:// page).
//
// The rendered page images and PDFs are handed to the person, so a page that
// could pull in an arbitrary local file (another channel file, a key stand-in)
// would leak it into a picture. Chrome hands a route handler an absolute,
// normalised URL, so one real-path comparison answers the question; symlinks
// are followed when the target exists.

import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
// --help: print the header above and exit.
if (process.argv[1] && import.meta.url.endsWith("/" + process.argv[1].split("/").pop()) && process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  const HELP = (await import("node:fs")).readFileSync(new URL(import.meta.url), "utf8").split("\n"), end = HELP.findIndex((l, i) => i > 0 && !l.startsWith("//"));
  process.stdout.write(HELP.slice(HELP[0].startsWith("#!") ? 1 : 0, end).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n" + "(A module the other scripts load; you don't run it.)\n"); process.exit(0);
}

/** The allowed directories as real paths. A missing directory adds nothing. */
export function realRootsFor(directories) {
  const roots = [];
  for (const directory of directories) {
    try {
      roots.push(realpathSync(directory));
    } catch {
      /* absent: nothing inside it can be requested */
    }
  }
  return roots;
}

/** True when a file: URL lands inside one of the roots. A missing file is
 *  judged by its path as written, so it fails as an ordinary 404. */
export function fileUrlWithinRoots(url, realRoots) {
  let path;
  try {
    path = fileURLToPath(url);
  } catch {
    return false;
  }
  let target;
  try {
    target = realpathSync(path);
  } catch {
    target = resolve(path);
  }
  return realRoots.some((root) => target === root || target.startsWith(root + sep));
}
