## Summary

<!-- User-visible problem and outcome. One concern per PR. -->

## Type of change

- [ ] Fix
- [ ] Feature
- [ ] Docs / governance
- [ ] Refactor (no intended behavior change)
- [ ] Chore / CI
- [ ] Deploy / release tooling

## Release notes

Paste bullets for `CHANGELOG.md` Unreleased (or N/A):

```markdown
### Fixed
- …
```

- [ ] `CHANGELOG.md` updated (or N/A)
- [ ] `docs/VISION.md` updated if this is a product decision

## Numbered acceptance ledger

<!-- Required for a multi-item request. Preserve the user's numbering and give
one outcome/evidence line per requested item. Do not merge distinct items into
generic bullets. Delete this section only for a genuinely single-item change. -->

1. …

- [ ] Every requested item appears once and is implemented or explicitly named
  as deferred with its reason.
- [ ] This ledger is ready to be copied into the GitHub Release notes unchanged.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test` (and feature suites if present on this branch)
- [ ] `git diff --check`
- [ ] No secrets, private keys, or `data/` dumps
- [ ] Local/sandbox/installer impact considered

## Post-merge (maintainers)

- [ ] Head branch deleted
- [ ] CI green on `main`
- [ ] If shipping: [docs/release-checklist.md](../docs/release-checklist.md)
