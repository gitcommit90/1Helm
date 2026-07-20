## Summary

<!-- User-visible problem and outcome. One concern per PR. -->

## Type of change

- [ ] Fix
- [ ] Feature
- [ ] Docs / governance
- [ ] Refactor (no intended behavior change)
- [ ] Chore / CI
- [ ] Deploy / ops tooling

## Release notes

Paste bullets for `CHANGELOG.md` Unreleased (or N/A):

```markdown
### Fixed
- …
```

- [ ] `CHANGELOG.md` updated (or N/A)
- [ ] `docs/VISION.md` updated if this is a product decision

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test` (and feature suites if present on this branch)
- [ ] `git diff --check`
- [ ] No secrets, private keys, or `data/` dumps
- [ ] VPS/local deploy impact considered

## Post-merge (maintainers)

- [ ] Head branch deleted
- [ ] CI green on `main`
- [ ] If shipping: [docs/release-checklist.md](../docs/release-checklist.md)
