# 1Helm x.y.z

Short outcome-first summary of this release.

## What changed

For a multi-item request, preserve the original numbered acceptance ledger and
write one user-visible outcome per requested item. Do not combine distinct requests into
generic bullets. If an item was deliberately deferred, keep its number and say
so plainly instead of silently omitting it.

1. **Feature or fix name** — concrete user-visible outcome.
2. **Feature or fix name** — concrete user-visible outcome.

## Additional changes

- Include work added after the original numbered request.
- Include material licensing, migration, compatibility, or operational changes.

## Downloads and integrity

| Artifact | SHA-256 |
| --- | --- |
| `1Helm-x.y.z-arm64.dmg` | `<digest>` |
| Other published artifact, or `Not applicable` | `<digest>` |

Source commit: `<full merged SHA>`

## Verification

- Name the exact automated suites and pass counts.
- Name public demo/site/API checks when applicable.
- For macOS, state Developer ID signature, Apple notarization, stapling,
  Gatekeeper, public-download installation on the retained release host, app
  launch/smoke behavior, and Application Support preservation.
- Name anything skipped or incomplete; do not call an incomplete release fully
  verified.

## Licensing

State the license for this version and any release-boundary notice that users
need to understand.

---

Before publication, compare this file line-by-line with the originating user
request/issue, PR acceptance ledger, `CHANGELOG.md`, published artifact list,
and final verification evidence. GitHub-generated notes are optional secondary
metadata and must never replace this authored record.
