# Source update: 2026-10-11

This update brings the Worker and web app forward to the October 11 Cloud
runtime snapshot. It includes channel/task access, task titles and checklists,
context handling, connection management, keyboard shortcuts, dictation, native
SSH/Tailscale transport, and the latest ambient and managed-app source.

The public single-owner sign-in, own-key model access, storage limits, bounded
request handling, backup tools, and EE licensing remain part of this edition.
New ambient, Composio-backed custom MCP, and managed-model administration code
is under `src/ee/` and disabled without the Cloud deployment switch. Merely
supplying a provider key does not enable those features.

Existing public documentation and `apps/` client source are retained. This is a
source update, not an installer release or a migration from the legacy Linux
product. Follow [upgrade instructions](upgrade.md), including the new transport
binding and D1 migrations, before deploying over the October 9 snapshot.

Local checks are `npm run test:core`, `npm run test:sync`, `npm run test:web`,
`npm run check:migrations`, and `npm run build`. The transport service has Go
tests in `native-transport/`. These checks do not replace sign-in, real provider,
container, backup/restore, and device checks in the operator's own account.

Source updates are reviewed integrations. Private Git history, infrastructure
configuration, test accounts, operations tools, and host-local instructions are
not part of the public source tree.
