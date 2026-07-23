# 1Helm — Native Agent Workspace Specification

**Status:** product and implementation specification  
**Date:** 2026-07-18  
**Applies to:** the 1Helm codebase and native runtime

## 1. The product in one sentence

**1Helm is a self-hosted agent workspace: create a channel for anything, and it receives a persistent AI agent, computer workspace, files, memory, and threads in which humans work with it.**

The user hires a durable helper, not a disposable chatbot.

## 2. The invariant model

```text
1Helm                         the installed environment / host
Captain                       the human owner and final authority
Skipper                       one workspace-wide, root-capable chief of staff
Channel                       one durable domain of work
Channel agent                 one resident specialist bound to that channel
Thread                        one focused, durable working session
Workspace                     the agent's filesystem, shell, files, and runtime state
Memory                        channel-owned knowledge, independent of model/provider
```

The product is deliberately simple:

```text
Create a channel
Describe what it is for
Work with its agent
```

The user must not have to create a bot, select an agent framework, attach a terminal, choose a working directory, create a memory store, install a skill, or manually wire an agent into a channel before useful work can begin.

## 3. Product principles

1. **A channel is an agent's world.** A resident agent treats its assigned channel, workspace, memory, and tools as its complete normal environment.
2. **The computer is core, not an integration.** Every useful agent has a shell-bearing environment and can create, inspect, change, run, and preserve artifacts there.
3. **One channel has one resident agent.** This is an intentional default and product invariant, not a suggestion implemented only in prompts.
4. **A thread is a session.** Threads hold focused work. The channel agent continues across many threads without becoming a new employee every time.
5. **Humans own the knowledge; models provide replaceable intelligence.** Changing provider or model must not discard the channel's identity, files, history, summaries, decisions, or memory.
6. **Skipper handles exceptions.** Channel agents work freely within their worlds; when they need broader scope, missing capability, or elevated authority, they call `@skipper` into the current thread.
7. **The Captain owns final authority.** The owner can see, direct, approve, revoke, and recover all workspace activity.
8. **Configuration is a fallback, not the normal workflow.** A user should be able to ask for a capability in natural language; the resident agent or Skipper should handle the setup.
9. **Everything important is visible in the shared workspace.** Humans do not lose the work because it happened in an opaque agent backchannel.
10. **Self-hosted state is durable.** User data stays in local storage owned by the installation, not embedded inside a particular model vendor's chat history.

## 4. Roles and authority

### Captain

The Captain is the initial workspace owner and final authority. The Captain owns the host environment, data, credentials, workspace membership, and durable policy. The first registered user is the initial Captain/admin.

The Captain can:

- create and archive channels;
- invite people into the shared workspace;
- choose or change workspace/model policy;
- approve or grant broad authority;
- inspect and repair an agent's workspace and memory;
- direct Skipper; and
- permanently remove a channel and its agent world.

### Skipper

Skipper exists exactly once per 1Helm workspace. It is the chief of staff and root operator for the installed 1Helm environment. Skipper is not an ordinary channel agent, even though it uses the same underlying model, message, tool, and streaming runtime.

Skipper can:

- operate across channels;
- provision, restore, repair, and remove channel agents;
- create channels from a direct request;
- inspect the host-level environment;
- install or expose capabilities needed by a channel agent;
- broker credentials and access that agents cannot obtain directly;
- coordinate work between channels;
- perform host-level or cross-channel actions; and
- request Captain input when human judgment or final authority is required.

Skipper has full environment authority because it is the deliberate exception path. Its actions must remain attributable and visible in the invoking thread whenever the action was initiated from a thread.

### Channel agent

A channel agent is the resident specialist for exactly one channel. It has one durable identity, one purpose, one workspace, one memory namespace, one model policy, and one channel binding.

It can:

- work with all channel participants in all channel threads;
- use its channel-scoped workspace and tools;
- create files and artifacts in its workspace;
- keep and retrieve channel-owned knowledge;
- continue work across threads and restarts; and
- summon Skipper when it needs anything outside its assigned world.

It cannot silently assume global ownership of the host, unrelated channels, or credentials outside the channel's granted scope.

### Humans

Multiple humans can participate in the same channel and therefore collaborate with the same persistent agent, shared files, shared knowledge, and authoritative transcript. A user does not get a personal copy of the agent just because they started a conversation.

## 5. Core object model

### 5.1 Agent channel

An ordinary channel is an **agent channel** by default. It owns:

- human membership and channel metadata;
- exactly one resident agent;
- purpose and operating instructions;
- a persistent filesystem workspace;
- a persistent memory namespace;
- a default provider/model policy inherited from the workspace unless overridden;
- channel-scoped tools, skills, and credentials references;
- threads/sessions, messages, files, actions, and artifacts;
- lifecycle state; and
- an escalation relationship with Skipper.

The channel is the user-facing substitute for manually creating an isolated Hermes installation, assigning it a directory, configuring a terminal, connecting tools, and remembering where the work lives.

### 5.2 Thread/session

A thread is a durable focused work session within one agent channel. The initial implementation may retain the existing `messages.parent_id` representation, but application semantics must recognize a session explicitly.

Each session has:

- a root message and title/goal;
- a status: `open`, `waiting`, `resolved`, `failed`, or `archived`;
- its participants;
- its message transcript;
- tool/action history;
- linked files and artifacts;
- a rolling working summary;
- zero or more Skipper escalations; and
- optional durable memory candidates or decisions.

Starting a new thread starts a new focused session. It does **not** create a new agent, memory, shell, or project directory.

### 5.3 Agent workspace

Each agent channel gets a durable workspace on the 1Helm host:

```text
<data-root>/channels/<channel-slug-or-id>/
├── workspace/                 agent's normal working directory
├── files/                     durable channel file store / imported assets
├── state/                     runtime state, summaries, tool journals
├── memory/                    provider-neutral channel memory store
└── profile/                   agent identity, purpose, capabilities, settings
```

The agent's normal shell working directory is the channel's `workspace/` directory. The user enters this context by entering the channel, not by locating and `cd`-ing into a host path.

The workspace survives:

- thread completion;
- browser reload;
- agent process restart;
- host restart;
- model/provider replacement; and
- a paused/archived channel.

Permanent deletion explicitly removes the workspace only after confirmation.

### 5.4 Memory and knowledge

Memory is not a raw replay of old model messages. It is a channel-owned, provider-neutral knowledge layer with provenance.

The initial memory types are:

- **session summary** — compact durable account of a thread's goal, work, result, and open items;
- **decision** — a human or agent-recorded decision with source thread and timestamp;
- **fact** — a scoped claim with source, confidence, and supersession support;
- **preference** — Captain/team/channel preference relevant to work; and
- **artifact reference** — a meaningful file, document, URL, service, or generated output.

Memory records must identify at least:

- owning channel;
- source message/thread or user action;
- author type (`human`, `agent`, `skipper`, `system`);
- creation time;
- scope (`thread`, `channel`, or explicitly workspace-wide);
- current/superseded status; and
- text/content suitable for retrieval.

The user-facing promise is continuity: the channel agent retains relevant accumulated knowledge when the serving model changes. A future retrieval engine may evolve, but the canonical records must remain under 1Helm ownership.

### 5.5 Agent identity and model policy

The resident agent's identity is durable and independent of its current model. It consists of:

- display name / mention name;
- channel purpose;
- role and operating instructions;
- created-by and creation time;
- channel binding;
- capability profile;
- workspace/memory references; and
- model policy.

Model policy resolves in this order:

```text
session override → channel override → workspace default → configured fallback
```

Changing model/provider changes the intelligence serving future turns; it does not create a new agent or erase knowledge. Existing threads, summaries, files, and identity remain intact.

## 6. Channel lifecycle

### 6.1 Create

Creating a channel must be an atomic provisioning operation from the user's perspective.

Required user input:

- channel name; and
- natural-language purpose, either at creation time or in response to Skipper's single onboarding prompt.

The system creates or records:

1. channel metadata and membership;
2. channel workspace tree;
3. resident agent identity/profile;
4. immutable agent-to-channel binding;
5. memory namespace;
6. inherited model policy;
7. default shell/computer context rooted at the channel workspace;
8. channel-scoped tool and credential policy;
9. lifecycle records/journal; and
10. a ready announcement from Skipper or the system.

The first viable native flow may use the familiar exact question:

> What is this channel all about?

Only an eligible workspace user can complete provisioning from its expected thread. Retrying after a failure must be safe and never produce duplicate resident agents.

### 6.2 Normal work

Humans and the channel agent work in ordinary channel threads. The agent responds when mentioned by default; a channel may later opt into more proactive behavior without changing the core identity.

The agent receives:

- its profile and channel purpose;
- the current session/thread transcript and summary;
- relevant retrieved channel memory;
- relevant channel files/artifact references; and
- its available tools and current workspace context.

The agent's actions and streaming output appear in the current thread, preserving one human-visible work record.

### 6.3 Escalation to Skipper

When a human or channel agent mentions `@skipper` in a thread, Skipper receives the complete authoritative thread context, plus the channel/agent identity and escalation reason when available.

Channel agents should escalate when they need:

- an action outside their workspace or capability scope;
- a missing tool, package, service, integration, or credential;
- access to another channel or workspace-level information;
- host-level/root operations;
- an environment repair; or
- Captain clarification or approval.

Skipper responds in the same thread. If Skipper changes the channel agent's world—such as adding a tool or granting a scoped capability—the change is recorded and visible.

### 6.4 Archive and restore

Archiving a channel pauses its agent runtime and scheduled activity while retaining its transcript, workspace, memory, files, identity, and policy.

Restoring the channel reactivates the same agent world. It must not create a new agent or cold-start its memory.

### 6.5 Permanent deletion

Permanent deletion is an explicit Captain/admin action. It removes the resident agent's runtime/profile, workspace, channel memory, sessions, artifacts, and channel metadata according to the configured retention policy.

The system must distinguish archive from permanent deletion. Ordinary cleanup, rebuild, model changes, and restarts never destroy the channel world.

## 7. Computer and execution model

### 7.1 1Helm runs where a shell exists

1Helm is installed in an environment with a shell. The shipped local Open-Terminal-compatible agent is the baseline execution substrate; external computers may be supported through the same protocol later.

The user experience must treat this as native:

- the terminal is a view into agent work, not a separately configured integration;
- files created by the agent are immediately part of the channel workspace;
- a user can inspect or collaborate through terminal/file views without losing context;
- an agent never needs the user to first navigate to the correct directory; and
- command output, artifacts, and resulting services can be linked back into the active thread.

### 7.2 Scope boundary

Channel agents start in their own workspaces and should be given an execution boundary appropriate to the installation. The required product abstraction is:

```text
Channel agent → its workspace, its permitted tools, its scoped credentials
Skipper       → the full 1Helm environment and system control plane
Captain       → final owner/approver of all authority
```

The local first implementation may use process-level working-directory and tool restrictions while the runtime matures. The architecture must keep the boundary explicit so hardened per-channel containers or VMs can be selected by deployment policy without changing the product model.

The agent must never need to know the literal host path as part of ordinary work. It sees `/workspace` or an equivalent stable internal working directory.

### 7.3 Tools and capabilities

Tools are channel capabilities, not arbitrary global bot settings. The initial capability surface includes:

- shell command execution in the channel workspace;
- file read/write and artifact creation;
- terminal sessions rooted in the channel workspace;
- model/provider access;
- channel memory retrieval and recording; and
- explicit escalation to Skipper.

Future capabilities—browser/computer use, application deployment, email, calendars, source control, remote computers, scheduled jobs, and integrations—attach to the channel agent or Skipper through the same capability model.

## 8. User experience requirements

### 8.1 First run

The existing first-run wizard remains useful but is simplified around the Captain and the default 1Helm environment:

1. Create the Captain account.
2. Connect a model/provider.
3. Choose/confirm the host execution environment and terminal visibility.
4. Name the workspace.
5. Enter `#main` with Skipper ready.

The setup flow must not ask a new user to build agents, configure memory, choose working directories, or wire bots into channels.

### 8.2 Create channel

The create-channel experience is the primary product action. It asks for a name and a purpose in plain language. Advanced options may exist behind an expandable control, but no advanced configuration is required to get a working channel agent.

Once ready, the channel visibly presents:

- its purpose;
- resident agent identity and `@mention` name;
- whether the agent is ready, working, waiting, or paused;
- its current model/provider, as a replaceable implementation detail;
- its files/artifacts;
- its active/recent threads; and
- an obvious `@skipper` escalation path.

### 8.3 Channel layout

Chat remains the shared work surface, but the channel is not reduced to a message feed. It provides views or panels for:

- **Threads** — active and completed sessions;
- **Files** — the channel workspace and shared artifacts;
- **Terminal** — interactive shell sessions inside the channel environment;
- **Memory/Knowledge** — channel-owned decisions, facts, summaries, and references;
- **Activity** — tool actions, long-running work, Skipper interventions, and system lifecycle; and
- **Settings** — purpose, model policy, scoped capabilities, and lifecycle controls.

These views are representations of the same channel world, not separate apps that force users to copy context between them.

### 8.4 Agent interactions

- Mention the resident agent to start or continue work in a thread.
- Create a top-level message to begin a new session; the agent's response stays in its associated thread.
- Mention `@skipper` at any point to call in the workspace-level operator.
- Let all participants see the same messages, files, tool activity, and outcomes.
- Use the terminal/files directly when desired; agent work should appear in the same durable channel context.

## 9. Runtime behavior and context assembly

### 9.1 Channel agent turn

For each resident agent turn, the runtime constructs context from:

1. immutable agent/channel identity and channel purpose;
2. current session status and rolling summary;
3. complete current thread transcript, subject to provider context limits;
4. retrieved channel memory with provenance;
5. relevant artifact/file references;
6. current tool/capability descriptions; and
7. the agent's stable working-directory contract.

Thread transcript may be compacted into a session summary when needed, but the canonical transcript remains stored under 1Helm control.

### 9.2 Skipper turn

For a Skipper mention in a thread, the runtime constructs context from:

1. complete authoritative thread transcript in server order;
2. channel and resident-agent identity;
3. explicit escalation reason, if supplied;
4. relevant workspace/channel metadata; and
5. Skipper's broader capability set.

Skipper does not require a user to summarize the thread that summoned it.

### 9.3 Durable summaries and memory candidates

The runtime should produce a structured session summary when a thread reaches a material boundary: resolution, explicit close, long inactivity, model-context compaction, or a Captain request.

Agent-generated memories are candidates rather than untraceable hidden facts. Initial policy may automatically retain low-risk summaries while exposing decisions and editable knowledge clearly in the channel.

## 10. Native data model

The current SQLite schema (`channels`, `messages`, `bots`, `bot_channels`, `bot_computers`, `model_prefs`) is a useful starting point but expresses a generic Slack-like bot product. The native 1Helm model must make the channel-agent relationship first class.

The target logical entities are:

```text
workspaces
users
channels
channel_members
agents
agent_channels              exactly one agent per ordinary channel
agent_profiles
agent_capabilities
channel_workspaces
threads
messages
thread_summaries
memory_items
artifacts
tool_actions
escalations
providers
model_policies
```

Minimum required fields:

| Entity | Required fields |
| --- | --- |
| `channels` | `id`, `name`, `purpose`, `kind`, `status`, `created_by`, `created` |
| `agents` | `id`, `kind` (`skipper`/`channel`), `name`, `display_name`, `status`, `created` |
| `agent_channels` | `agent_id`, `channel_id` with unique `channel_id` and unique channel-agent binding |
| `agent_profiles` | `agent_id`, `purpose`, `instructions`, `workspace_ref`, `memory_namespace`, `capability_policy` |
| `threads` | `root_message_id`, `channel_id`, `status`, `title`, `summary`, `opened_at`, `updated_at` |
| `memory_items` | `id`, `channel_id`, `thread_id?`, `kind`, `content`, `source_message_id?`, `author_type`, `scope`, `status`, `created` |
| `artifacts` | `id`, `channel_id`, `thread_id?`, `path/ref`, `kind`, `created_by`, `created` |
| `tool_actions` | `id`, `agent_id`, `thread_id?`, `tool`, `input_summary`, `result_summary`, `status`, `created` |
| `escalations` | `id`, `thread_id`, `from_agent_id?`, `reason`, `status`, `resolved_by?`, `created` |

`bot_channels` must no longer govern ordinary resident-agent membership. During migration it can remain for compatibility, but a resident agent must have one and only one bound ordinary channel. Skipper is modeled as a workspace-level agent and may participate anywhere without being duplicated per channel.

## 11. Migration from the current codebase

The existing code is deliberately retained where it already provides the needed mechanics:

| Existing component | Native 1Helm role |
| --- | --- |
| `channels` + `messages` | human-visible channel and transcript foundation |
| `parent_id` threads | initial thread/session roots pending explicit `threads` table |
| `bots.ts` streaming/tool loop | reusable agent-turn execution engine |
| `providers` + ChatGPT/OpenAI compatibility | replaceable model/provider layer |
| embedded `agent.ts` / Open Terminal protocol | host execution substrate |
| `terms.ts` | persistent interactive terminal sessions |
| uploads/attachments | initial channel artifacts/files |
| `setup.ts` Skipper seed | workspace-level Skipper bootstrap |
| WebSocket events | shared live collaboration/activity delivery |

The following concepts are replaced or demoted:

| Current concept | Required change |
| --- | --- |
| globally configured bots | channel agents are created by channel provisioning, not manually wired as the normal path |
| many-to-many `bot_channels` | one immutable resident-agent binding per ordinary channel |
| optional assigned computers | channel agent environment is provisioned by default; external computers become explicit capabilities |
| bot model/prompt editor as primary workflow | channel purpose creates the initial profile; advanced editing is secondary |
| terminal as an app-wide generic view | terminal opens in the selected channel's workspace by default |
| message-only history | explicit thread/session state, summaries, memory, artifacts, and action records |
| Skipper as a normal bot | Skipper becomes a first-class workspace system agent with global capability policy |

## 12. First vertical slice: Channel Agent World

The next implementation slice proves the product, rather than attempting an app catalog or broad integration marketplace.

### User journey

1. The Captain completes first-run setup and enters `#main` with Skipper.
2. The Captain creates `#launch` and writes: “This channel owns planning and coordinating the product launch.”
3. 1Helm provisions `@launch-agent` (friendly generated name acceptable), a channel workspace, memory namespace, and default model policy.
4. The system announces that the agent is ready.
5. The Captain starts a thread asking the agent to create a launch plan; the agent writes a plan and a file in its channel workspace.
6. A second human opens the same channel and sees the same agent, plan, file, transcript, and continuation context.
7. A later thread asks about a decision made in the first one; the agent retrieves the stored summary/decision without requiring a full old transcript.
8. The agent needs a package, host-level file, credential, or cross-channel information and calls `@skipper` in the current thread.
9. Skipper receives the full thread context, completes or clarifies the elevated step, and records the outcome in that same thread.
10. The Captain changes the channel's model/provider. The agent retains its name, purpose, files, memories, and history.
11. Archive/restore returns the same agent world. Permanent deletion removes it only after explicit confirmation.

### Acceptance criteria

- Creating an ordinary channel produces exactly one bound resident agent without manual bot configuration.
- A resident agent cannot be assigned to or speak as a resident in another ordinary channel.
- Each channel agent uses a stable workspace different from every other channel agent's workspace.
- Terminal sessions opened from a channel start in that channel's workspace.
- Files made through the agent shell are visible through the channel file/artifact surface.
- All humans with channel access collaborate with the same agent and see the same thread state.
- A thread has durable session status and summary metadata independent of raw message history.
- A channel agent can retrieve a persisted decision/summary from an earlier thread after a model change or server restart.
- Skipper receives the full authoritative invoking thread and can reply in that thread.
- Skipper can perform an explicitly broader action while the channel agent remains bound to its own world.
- Archive preserves workspace, memory, agent identity, and threads; restore reuses them.
- Permanent delete removes the bound agent world only after explicit confirmation.
- The normal path never asks a user to choose a directory, memory backend, terminal backend, or bot-channel membership.

## 13. Delivery sequence

### Phase 1 — Native channel-agent binding

- Add first-class `agents`, `agent_channels`, profiles, and channel lifecycle status.
- Make ordinary channel creation provision one resident agent atomically.
- Convert `#main` to Skipper's workspace-wide home while preserving it as a normal visible channel.
- Replace normal add-bot-to-channel UI with create-channel purpose/onboarding flow.
- Enforce one ordinary channel per resident agent in server logic and database constraints.

### Phase 2 — Channel workspace and terminal

- Provision per-channel workspace roots under the data directory.
- Execute resident-agent commands with that channel workspace as the fixed CWD.
- Open terminal sessions scoped to the selected channel workspace.
- Add channel Files/Artifacts view backed by durable files and attachments.
- Record tool actions and artifacts in the originating thread.

### Phase 3 — Sessions and durable memory

- Add explicit `threads`, session status, summaries, and action journals.
- Add provider-neutral memory records, decision capture, and retrieval.
- Assemble agent context from profile + session + memory + artifacts rather than transcript alone.
- Preserve continuity through model/provider changes and restart tests.

### Phase 4 — Skipper escalation and authority

- Make Skipper a first-class system agent with global context/capabilities.
- Implement complete-thread `@skipper` escalation.
- Add visible escalation/action records and Captain approval hooks where required.
- Route missing capability/environment requests through Skipper.

### Phase 5 — Stronger isolation and ecosystem capabilities

- Add deployment-selectable process/container/VM isolation behind the stable channel-world abstraction.
- Add browser/computer-use, service deployment, scheduled work, integrations, external computers, and an app catalog as scoped capabilities.
- Keep each new capability attached to the channel-agent/Skipper authority model rather than introducing disconnected configuration surfaces.

## 14. Explicit non-goals for the first vertical slice

- Rebuilding Mattermost compatibility or enterprise collaboration features.
- Rebuilding Hermes profiles/configuration as an exposed user workflow.
- A broad app catalog before the native channel-agent loop works.
- A multi-agent swarm in each channel.
- A separate GUI for every provider-specific feature.
- Provider-owned or model-owned canonical memory.
- Requiring full VM/container isolation before the product can work; the interface is stable while hardening evolves.
- Hiding Skipper escalation in opaque background orchestration.

## 15. Product language

Use language that reinforces the native model:

- **Create a channel** — not “create a bot and add it to a room.”
- **Resident agent** or simply the agent's name — not “bot instance.”
- **Workspace** — the agent's durable environment.
- **Thread** or **session** — focused unit of work.
- **Memory/Knowledge** — channel-owned continuity.
- **Call Skipper** — escalation to the workspace-level operator.
- **Captain** — final human owner.

Suggested concise positioning:

> Create a channel for anything. It comes with an agent, a computer, a workspace, and a memory.

> Stop bringing AI to your work. Give AI a place to work.

> One Helm. One Captain. One Skipper. Many channels. Many agents. Every thread is a session.

## 16. Definition of done for the product direction

1Helm has crossed from a chat app with configurable bots into its intended product when a new user can create a channel for a real area of life or work and truthfully experience the following:

> “I made a place for this. Its agent already has a computer and a home. I can return to it whenever I want, other people can work with the same helper, and if it ever needs something outside its world, Skipper can take care of it.”
