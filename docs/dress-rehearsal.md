# Dress rehearsal

1Helm's dress rehearsal answers one question: can the exact candidate behave
like a real release on Linux, Windows, and Mac?

Normal pushes run only `CI` (typecheck, build, and tests). A full rehearsal is
opt-in because this is a two-person project and signing, notarization, and three
real computers do not need to run after every development commit.

`npm test` is the everyday product suite. Dormant publication and historical
delivery machinery is checked separately with `npm run test:release-process`
when that machinery is being changed or before publication. It cannot block an
unrelated feature from reaching the local tryout loop.

## Start one rehearsal

1. Push the intended commit to `main`.
2. Set the repository variable `HELM_DRESS_REHEARSAL_SHA` to that commit's full
   40-character SHA before its `CI` run finishes. If CI has already finished,
   rerun that CI run after setting the variable.
3. The successful CI event starts `Candidate dress rehearsal` for that SHA.
4. Remove `HELM_DRESS_REHEARSAL_SHA` when the rehearsal has started.

The SHA variable is the switch. If it is absent or names another commit, the
candidate workflow is skipped and ordinary development continues normally.

## What it tests

- **Build:** make the online and complete offline Linux archives once from the
  exact commit.
- **Linux:** on the dedicated `1helm-linux-fresh` test host, install the current
  public Stable, update to the candidate, start it, preserve a durable data
  marker, cold-start it, and run the scoped uninstaller.
- **Windows:** as the ordinary `helm-ph4` account, clean-install the exact
  offline Linux candidate through WSL, uninstall it without touching an
  unrelated WSL distribution, install current Stable, update to the candidate,
  preserve data, recover through the limited-user keepalive after a cold WSL
  stop, and uninstall cleanly.
- **Mac:** as the dedicated non-admin `helm-ci` account, build, Developer ID
  sign, notarize, and staple the DMG and updater ZIP; clean-install and launch
  the candidate; install current Stable; replace it with the candidate updater;
  and verify launch and Application Support preservation.

The final job prints those three platform results and fails unless all three
passed. The platform scripts' successful exit is the evidence. There is no
secondary JSON normalizer, provenance bundle, candidate matrix, retained-copy
verifier, or promotion-bundle assembler in this workflow.

## What it does not do

The rehearsal never tags, publishes, changes Stable, deploys the website, or
touches Joseph's everyday 1Helm instance. A green rehearsal means the candidate
is ready for the owner's review and explicit publication decision; it is not
publication approval.
