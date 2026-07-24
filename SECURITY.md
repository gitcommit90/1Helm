# Security policy

## Supported versions

Only the latest published 1Helm release receives security fixes. Upgrade before
reporting a problem that is already fixed in the current release.

## Report privately

Use GitHub's **Report a vulnerability** flow for
[`gitcommit90/1Helm`](https://github.com/gitcommit90/1Helm/security/advisories/new).
Include the affected version, platform, impact, minimum reproduction, and any
relevant logs after removing credentials and personal data.

For non-sensitive security questions or company contact, email
[`build@1helm.com`](mailto:build@1helm.com). Do not send unpatched vulnerability
details or secrets by ordinary email; use the private advisory flow above.

Do not open a public issue for an unpatched vulnerability. Do not include API
keys, OAuth tokens, Photon project secrets, private messages, workspace data,
Apple signing material, or other people's personal information in a report.

## Security boundaries

- On supported Apple Silicon Macs, each ordinary channel uses a separate Apple
  container-machine Linux VM with no Mac home mount. Linux/WSL compatibility
  deployments do not claim this isolation.
- Skipper owns host, fleet, credential-broker, and cross-channel authority.
  Residents receive task-scoped tools, not raw host credentials.
- External skill metadata is not executable trust. Curated installs are pinned
  to immutable Git revisions, bounded, scanned, hashed, and wrapped beneath
  runtime authority. Community entries are quarantined.
- New operational activity is SHA-256 chained for tamper evidence. This is not
  a remote transparency log and does not prevent a host administrator from
  replacing the entire database.

The detailed current model and known limitations live at
[`https://1helm.com/security`](https://1helm.com/security).
