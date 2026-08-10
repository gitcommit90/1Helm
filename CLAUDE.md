# Claude Code instructions

Follow [AGENTS.md](AGENTS.md) as the authoritative delivery contract for all
work in this repository.

Default posture: edit `/root/1Helm`, deliver to the **local** running install
(`/opt/1helm`, port **8123**) so the owner can try the change, and promote to
public only when they ask to ship.

**Never touch App Review** (`/opt/1helm-review`, `1helm-review.service`, port
**8140**, e.g. `review.1helm.com`) unless the owner explicitly asks for work on
that install by name.
