# Release checklist

1. Put the intended version in `package.json`, `package-lock.json`, and
   `CHANGELOG.md` and commit it to `main`.
2. Run the ordinary local contract: `PUPPETEER_SKIP_DOWNLOAD=1 npm ci`,
   `npm run typecheck`, `npm run build`, and `npm test`.
3. Independently install the exact release files on the dedicated Linux,
   Windows/WSL 2, and Apple Silicon Mac sandboxes. On each, check only fresh
   install, exact version, startup, and setup endpoint health. Stop on failure.
4. If all three pass, attach the digest-qualified Stable manifest and publish
   the exact draft as Latest. The removed Candidate dress rehearsal is not a
   release gate.
5. Deploy the same commit with `sudo scripts/deploy-site.sh <sha>`, update the
   owner's installation using the published Linux archive, and verify the
   public website, release API, and three downloads.

Windows uses the Linux archive through WSL 2 and has no separate artifact.
