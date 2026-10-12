# Source update: 2026-10-12

## Workflow spending-limit report follow-up

Classic workflows stopped by the hard spending limit can now show a bounded
partial report from completed, already-presented steps on the same card. The
report makes no new model or tool call, does not raise the limit, and explicitly
does not claim the entire workflow finished. Secret filtering and plain-text
quoting are applied; arbitrary output is not guaranteed safe by filtering alone.

Source correspondence:

- Worker: `9e5e39c25f68b416bb591be5a6f5d6fd04254480` → `f551528c4b1188db5f26c2373a53a7235812fb46`.
- Web: `7b0706aee0ffee61c9b100397287dfe75219a89c` (unchanged).
- Public base: `c5319972b8bde90cb935c75ab780154cfc635948`.

Portable receipt/security tests and an offline classic-workflow integration
test cover this path. Own-key and optional Cloud boundaries remain unchanged.
Hosted release-check environment helpers remain excluded. No web assets,
schema, installation configuration or native clients changed. This source
update is not a live-provider or deployment-transition acceptance result.

## Bounded tool-batch follow-up

This update rejects oversized or repetitious tool batches before executing any
operation from the rejected model step. It preserves existing retry behavior,
own-key provider choice and billing, and optional Cloud feature gates.

Source correspondence:

- Worker: `66d3e1c86cff0dc887c0865795d432cb2f1e15f8` → `9e5e39c25f68b416bb591be5a6f5d6fd04254480`.
- Web: `7b0706aee0ffee61c9b100397287dfe75219a89c` (unchanged).
- Public base: `24e500f0d538ae8df63f98bd0e35a94abdab2bdf`.

Portable tests cover fragmented arguments, distinct calls, malformed indices,
stream cancellation and whole-step rejection. Hosted deployment fixtures remain
excluded; this is not live-provider or full hosted append-runtime acceptance.
No web assets, schema, installation configuration or native clients changed.

## Memory-context follow-up

The comparison for this follow-up starts at public
`4705bbbddc423df1985bdea93cf689b466b15284`. Worker source is reconciled from
`39b8e9e4ce175f7bd0acc5025d55bfc04b96cbd7` through
`66d3e1c86cff0dc887c0865795d432cb2f1e15f8`; web source remains
`7b0706aee0ffee61c9b100397287dfe75219a89c`.

Context v2 now consistently describes personal memory as on-demand. Before
claiming a needed personal fact is absent, the helper is told to look it up in
the current turn, distinguish an unavailable lookup from an absent fact, and
reuse sufficient supplied facts without unrelated searches. General names the
actual source channel when answering from another channel's memory.

The public own-key runtime, optional-memory behavior and EE boundaries remain
unchanged. Local prompt-contract coverage is included in `npm run test:runtime`;
it does not establish live model behavior. Hosted deployment configuration and
release-only test harness changes remain excluded. No schema, web asset or
native-client update is included in this follow-up.

## Source correspondence

| Source | Previous reviewed snapshot | Reconciled snapshot |
| --- | --- | --- |
| Worker | `084d79ffa6d919a6a32942317ea5b4928030be76` | `39b8e9e4ce175f7bd0acc5025d55bfc04b96cbd7` |
| Web | `4cebd963315939f38073ba3785e1b72ffcf234ad` | `7b0706aee0ffee61c9b100397287dfe75219a89c` |

The public comparison starts at `7f548dd8e6f03dded2ec2c88e708ff2e87c24867`.
Reviewed runtime and regression-test content is recorded in
`bb73ae574a1e72d72d0f0e6f7b74e729e1050286`; this follow-up records source
correspondence only. These identifiers describe reviewed integration inputs;
they do not make excluded Cloud operational files part of this repository.

## Changes

This reviewed update adds strict structured responses for background work,
bounded schema retries, stable task transcripts and managed task model affinity.
The nine managed background roles retain their selected model and low reasoning
setting; provider failures do not silently substitute a different model.
Managed task selection remains inside the EE boundary. Public installs continue
to use their own provider credentials and the existing own-key task runtime.

Public response-size limits, owner sign-in, storage, backup and feature gates are
preserved. Cloud support diagnostics and operator release tooling are excluded;
this update adds no public support-access route or database migration. The native
clients are unchanged. The web bundle is rebuilt from the public source.

Run `npm run test:runtime` for the structured response, background policy,
transcript, and managed-task isolation regressions, alongside the checks below.
Synthetic local checks do not establish live provider, container, or device
behavior in another operator's environment.

## Previous source update: 2026-10-11

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
