# Agent reliability contract

1Helm treats an agent turn as a durable product operation, not a transient
stream of model tokens. This contract is the acceptance standard for Skipper,
resident agents, connectors, and scheduled work.

The design was informed by production patterns visible in open-source agent
runtimes, including Hermes Agent. 1Helm keeps its own identity and product
model; the useful lesson is to encode dependable behavior in runtime state,
ownership, recovery, and tests rather than depend on a prompt alone.

## Partner behavior

- Stable identity and persona are separate from operating policy and volatile
  channel, memory, and task context. A new task must not accidentally rewrite
  who the resident or Skipper is.
- Skipper and residents are reliable operating partners: calm, candid,
  resourceful, and accountable for closure. They do not mimic momentary user
  frustration, another agent's persona, or untrusted recalled text.
- Safe, reversible action is the default. The agent inspects authoritative
  state, acts through the capability already available, verifies the observable
  result, and reports it.
- `ask_user` is reserved for evidenced human judgment, credentials, external
  authority, or irreversible commitment. Difficulty, harmless ambiguity, and
  work the agent or Skipper can inspect are not blockers.
- Read-only questions never install skills, packages, or integrations. A
  capability question is answered from authoritative state.
- Tool results are evidence. Transient failures permit a bounded retry with a
  changed strategy; an unchanged failed call is not repeated forever; expected
  human blockers and permanent failures produce one useful final explanation.
- Memory is provenance-bearing reference data, never a higher-priority source
  of instructions. Memory and behavior review happen after the user's answer is
  safely delivered.

## Turn lifecycle

- Admission persists the trigger, assistant message, progress row, lane, and
  state before the UI is told the turn exists.
- The scheduling lane is the exact agent, channel, and thread. Independent
  Skipper threads may run concurrently; turns in one thread remain FIFO.
- Queue acceptance is immediately visible, including how many turns are ahead.
- Every running turn owns a monotonically increasing writer generation. All
  body and progress writes are conditional on that generation and `running`
  state.
- One finalizer transitions the turn to `waiting`, `completed`, `failed`,
  `stopped`, or `cancelled`, freezes a hash of the visible response, and closes
  progress. Finalized text is immutable to stale streams and retry callbacks.
- Stop affects only the selected thread lane. Other turns owned by the same
  resident or Skipper keep running, and the shared status remains working while
  any of them is live.
- After restart, never-started queued turns resume in lane order. Running turns
  are marked interrupted and are not blindly replayed because external side
  effects may already have happened.

## Delivery and obligations

- An in-app final reply and an external connector delivery are distinct facts.
  Connector replies become durable obligations before the external send.
- Delivery state records pending, attempting, delivered, failed, or uncertain.
  A restart may resume a never-attempted reply. An interrupted attempt is
  surfaced as uncertain and is not blindly replayed into a duplicate.
- An external message received through Photon defaults to the Captain's
  `#main`/Skipper mapping, invokes the mapped partner, and returns the final
  response to the originating authorized conversation.
- Timers, recurring workflows, long-running follow-ups, and connector replies
  are durable obligations. Sleep, restart, or a closed renderer must not erase
  them.

## User-visible state

- Chat shows one response row per accepted turn. Activity retains chronological
  thought, tool, retry, and delivery evidence without replacing the answer.
- Provisional text may grow while a turn is running. A later round appends to a
  useful prior answer; it cannot clear or replace it.
- Structured questions remain clickable through live repaints, store one
  authoritative answer, and resume the conversation from that answer.
- Terminal prompts use the active shell's syntax and always show the current
  path. File attachments provide authenticated Open and Download actions.
- Failures are visible and honest. “Delivered” means delivery evidence exists;
  “uncertain” is used when exactly-once truth cannot be proven.

## Release acceptance matrix

Every release that touches agent behavior must keep automated coverage for:

| Area | Required adversarial proof |
| --- | --- |
| Concurrency | Three independent Skipper threads run concurrently; a same-thread follow-up queues visibly and drains FIFO. |
| Stop | Stop changes only its selected lane while another turn on the same agent completes. |
| Writers | A stale generation cannot change finalized body or progress state. |
| Restart | Queued work survives and drains; running work is never blindly replayed. |
| Blockers | A legitimate connector/credential blocker preserves the first useful response without an outcome-gate rewrite loop. |
| Questions | Selecting and submitting a structured option works after a live message repaint. |
| Connectors | A final reply is returned once; pending delivery recovers; interrupted delivery becomes visibly uncertain rather than duplicating. |
| Scheduling | Due workflows and follow-ups remain wakeable obligations across restart and computer sleep. |
| Persona | Stable partner identity/action policy remain unchanged when volatile channel/task context changes. |
| Product controls | Skipper uses native inventory/lifecycle tools; terminal paths, file Open/Download, trusted skill search, provider routing, and channel deletion are end-to-end tested. |
