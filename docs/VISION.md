# 1Helm product vision

1Helm gives an AI employee a place to work, not merely a chat box in which to
describe work. Every ordinary channel owns exactly one resident identity, one
durable workspace, one memory namespace, and—on supported Apple Silicon
Macs—one persistent private Linux computer. The human is the Captain. Skipper
is the workspace-wide operator for host, fleet, credentials, connections, and
cross-channel boundaries.

## The outcome contract

A resident owns the user's requested outcome. Routine inspection, research,
downloads, package installation, configuration, commands, retries, file work,
and reversible implementation choices happen autonomously inside its computer.
It does not turn executable work into a tutorial for the user.

When work crosses the channel boundary, the resident calls Skipper directly.
Skipper performs the boundary operation and returns the same thread to the
resident, which verifies the original end-to-end outcome. The Captain is
involved only for consequential human judgment, credentials that only they can
provide, external authority, or an irreversible commitment.

The runtime gives the model a compact factual capability map: its identity,
channel, Linux computer and `/workspace`, callable tools, memory, skill arsenal,
and authority scope. It does not inject a behavioral manifesto or grade and
rewrite the model's prose. Tool and server implementations enforce isolation,
ownership, credentials, destructive-action confirmation, and human-only
boundaries.

If work depends on time passing, it becomes a persisted obligation. 1Helm does
not equate a model ending a turn with background execution. Follow-ups and
recurring workflows have due times, retry state, computer wake obligations,
and observable completion or failure.

## Durable growth

Residents start with a substantive operational arsenal, not a handful of
generic prompt snippets. The model sees concise skill metadata and chooses when
to load one full procedure. Skills define activation, execution, authority
boundaries, recovery, retained state, and verification. Trusted
external procedures may be discovered and installed automatically only through
bounded, provenance-pinned, scanned, hashed ingestion beneath runtime policy.
Community popularity is not trust.

When a resident completes a repeatable workflow that the arsenal does not
cover, it can crystallize the proven procedure with concrete evidence. Generic
advice, unverified guesses, secrets, incident-specific personal data, and
instructions that weaken the runtime are rejected. Corrections, curated memory,
skills, artifacts, and obligations compound without binding the identity to one
model provider.

## Computer and connection boundaries

On supported Macs, each resident computer is a real Apple container machine
with the Mac home directory unmounted. The resident's command tools and the
channel Terminal share the same `/workspace`. Skipper manages CPU, memory,
disk, wake/sleep, repair, update, archive, restore, and deletion safety.

Provider accounts and native connections remain host-owned brokers. Residents
receive narrow operations, never raw OAuth tokens, Photon project secrets, or a
private host database. Gmail currently supports scoped account listing, search,
message retrieval, and draft creation. Photon/iMessage currently treats text
as the reliable contract; richer attachment fidelity remains under
verification.

## Product truth

- `https://1helm.com` is the standalone product and documentation site.
- `https://demo.1helm.com` is a separate public sandbox, not the product site
  and not a dependency of an installed workspace.
- The native consumer product targets Apple Silicon macOS and provides one
  isolated Linux computer per ordinary resident.
- Linux and Windows + WSL run a durable systemd compatibility deployment today.
  They do not yet claim per-resident VM isolation or native desktop packaging.
- 1Helm is self-hosted and open source. A hosted control plane, mobile clients,
  blind community-skill execution, and native Windows/Linux desktop apps are
  not shipped.

## What 1Helm borrows—and what it does not

Hermes demonstrates the value of a capable built-in skill library and agents
that act before escalating. Buzz demonstrates the value of honest capability
matrices, screenshot-led explanation, agent-first JSON interfaces, first-class
workflows, bounded stop hooks, outcome-first activity, auditable operations,
and public benchmarks. 1Helm adopts those durability patterns where they
strengthen outcome ownership.

1Helm does not adopt a protocol, event model, media feature, or git substrate
merely for parity. Its core bet is the compounding resident world: one identity,
one private computer, one workspace, and years of accumulated memory, skills,
corrections, artifacts, and obligations—with Skipper automatically handling
every boundary.
