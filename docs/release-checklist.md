# Release checklist

1. Put the intended version in `package.json`, `package-lock.json`, and
   `CHANGELOG.md`, merge the product candidate to `main`, and retain its exact
   40-character source commit.
2. Require a successful GitHub-hosted Source CI run for that exact commit.
3. Dispatch the independent hosted Linux and Mac build stages with the exact
   source commit and Source CI run ID. The Mac stage owns Developer ID signing,
   Apple notarization, and stapling; no Captain-owned Mac is part of the gate.
4. Run hosted artifact acceptance against the exact retained producer run IDs.
   Windows publishes no separate artifact because it consumes the Linux archive;
   record its hosted evidence or an explicit hosted-run waiver during assembly.
   Never fall back to Captain-owned LXC, VM, WSL, Mac, or live infrastructure.
5. Assemble the accepted bytes into one draft, publish it as GitHub Latest, and
   run public verification bound to the exact publish run ID. A downstream
   workflow repair reuses valid retained product artifacts rather than rebuilding
   Linux or repeating Apple notarization.
6. Treat deployment as a separate boundary. Do not update an installed 1Helm,
   restart the Captain's service, or deploy `1helm.com` unless separately asked.
