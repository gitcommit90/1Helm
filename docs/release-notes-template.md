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
| `1Helm-x.y.z-mac-arm64.zip` | `<digest>` |
| `1Helm-x.y.z-linux-node.tgz` | `<digest>` |

These three rows are the whole desktop matrix. Every one is mandatory and must
resolve to the same version and source commit. “Not applicable” is forbidden for
macOS or Linux. If any row is unavailable, this release must remain unpublished.
A release is complete only once macOS, Linux, and Windows have each been accepted.

**Windows publishes no artifact.** A Windows host is the Linux host running
inside a per-user WSL 2 distribution named `1helm`, installed with one command
in an ordinary PowerShell window:

```powershell
irm https://1helm.com/install.ps1 | iex
```

That script, `uninstall.ps1` and the keepalive payload are served from
`https://1helm.com`, not attached here. No Windows executable ships, so there is
no code signing and no signature status to disclose. Do not add a Windows row to
the table above; record Windows under Verification instead.

Source commit: `<full merged SHA>`

## Verification

- Name the exact automated suites and pass counts.
- Name public product-site/API checks when applicable.
- For macOS, state Developer ID signature, Apple notarization, stapling,
  Gatekeeper, public-download installation on the retained release host, app
  launch/smoke behavior, and Application Support preservation.
- For Linux, state archive/source/digest verification and the real prior-version
  systemd update, health-check rollback, and `/var/lib/1helm-oci-v1`
  preservation.
- For Windows, state the behavioural acceptance on real Windows 11 x64 hardware:
  a clean install via `irm https://1helm.com/install.ps1 | iex` from a
  non-elevated PowerShell window with exactly one UAC prompt, the mid-install
  restart and the resumed second run as the same signed-in user, the keepalive
  surviving a reboot with `1helm.service` active, a browser reaching
  `http://localhost:8123` and completing onboarding, the prior-version update
  through the in-distribution Linux updater with `/var/lib/1helm-oci-v1`
  retained, and removal via the site-served `uninstall.ps1`.
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
