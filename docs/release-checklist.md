# Release checklist

1. Put the intended version in `package.json`, `package-lock.json`, and
   `CHANGELOG.md` and commit it to `main`.
2. Run the ordinary local contract: `PUPPETEER_SKIP_DOWNLOAD=1 npm ci`,
   `npm run typecheck`, `npm run build`, and `npm test`.
3. Set GitHub's `HELM_RELEASE_SHA` repository variable to the exact commit SHA
   and rerun that commit's successful `CI` workflow.
4. Watch `Candidate dress rehearsal`. It publishes automatically only after
   fresh install, version, startup, and health succeed on Linux, Windows/WSL 2,
   and Apple Silicon Mac.
5. Remove `HELM_RELEASE_SHA` after the release run starts.
6. Deploy the same commit with `sudo scripts/deploy-site.sh <sha>`, update the
   owner's installation using the published Linux archive, and verify the
   public website, release API, and three downloads.

Windows uses the Linux archive through WSL 2 and has no separate artifact.
