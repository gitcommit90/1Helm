#!/usr/bin/env node
import { collectEnvironmentStatus, formatEnvironmentStatus, statusConfig } from "./delivery-status-lib.mjs";

const HELP = `Usage: npm run delivery:status -- [--json]

Read-only status for the source checkout, local standalone app, public website,
Linux updater fixture, and optional private dress-rehearsal evidence. Unavailable
targets are reported, not treated as a reason to change anything.

Configuration:
  HELM_STATUS_LOCAL_URL       default http://127.0.0.1:8123
  HELM_STATUS_SITE_URL        default https://1helm.com
  HELM_STATUS_FIXTURE_URL     optional; configure all three fixture values
  HELM_STATUS_FIXTURE_HOST    optional; configure all three fixture values
  HELM_STATUS_FIXTURE_ID      optional; configure all three fixture values
  HELM_STATUS_CANDIDATE_URL   optional; configure all three candidate values
  HELM_STATUS_CANDIDATE_HOST  optional local SSH alias for the Proxmox host
  HELM_STATUS_CANDIDATE_ID    optional local guest ID; evidence read is fixed
  HELM_STATUS_TIMEOUT_MS      default 3000
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

try {
  const report = await collectEnvironmentStatus(statusConfig());
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(report, null, 2)}\n` : formatEnvironmentStatus(report));
} catch (error) {
  process.stderr.write(`Status configuration error: ${error.message}\n`);
  process.exitCode = 2;
}
