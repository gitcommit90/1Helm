#!/usr/bin/env node
import { resolve } from "node:path";
import { collectCleanupReport, formatCleanupReport } from "./cleanup-report-lib.mjs";

const HELP = `Usage: npm run cleanup:report -- [--json]

Reports counts, sizes, and age for .release-tmp/, .native-test-data/, and known
timestamped agent.ts backups. The scan is read-only and bounded to those paths.
This command has no removal mode.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (args.some((arg) => arg !== "--json")) {
  process.stderr.write(`${HELP}\nUnknown option.\n`);
  process.exit(2);
}

const report = await collectCleanupReport(resolve(import.meta.dirname, ".."));
process.stdout.write(args.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : formatCleanupReport(report));
