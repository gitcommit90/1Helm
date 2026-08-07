# Retired dress rehearsal

The Candidate dress rehearsal is disabled and does not gate a release.

Before publication, run the release files independently on the three dedicated
sandbox computers. Each check has only four product assertions: fresh install,
exact version, successful startup, and a healthy setup endpoint. Windows uses
the Linux archive through WSL 2. Mac also checks the platform-required signing,
notarization, stapling, and Gatekeeper acceptance.

Stop on the first product failure. If all three pass, publication is a direct
maintainer action; there is no rehearsal, evidence bundle, aggregate result, or
automated release gate.
