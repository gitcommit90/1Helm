# Developer module map

Use this map to find the smallest owning module before editing a hotspot. The
architecture report is advisory: `npm run architecture:report` lists large
modules, fan-in/fan-out, and import cycles without failing legacy debt. Budgets
live in `config/module-budgets.json`; lower a legacy value after an extraction,
and do not raise it for unrelated growth.

## Client

| Area | Owning module | Notes |
| --- | --- | --- |
| App boot, workspace state, navigation, transcript orchestration | `src/client/app.ts` | Coordinator. Keep pure display rules out of it. |
| Thread/progress labels, tool-body parsing, token/countdown formatting | `src/client/thread-formatters.ts` | Pure, directly testable presentation contract. |
| API transport and shared client response types | `src/client/api.ts` | Network boundary used across client features. |
| Channel files, notes, board, activity, memory, settings surfaces | `src/client/channel.ts` | Channel-level surface controller. |
| Cowork editors and collaboration UI | `src/client/cowork.ts`, `src/client/cowork-editors.ts` | Collaborative document domain. |
| Routing, onboarding, settings, terminal, mobile | Same-named modules in `src/client/` | Feature owners; avoid routing their changes through `app.ts` unless orchestration is required. |

## Server

| Area | Owning module | Notes |
| --- | --- | --- |
| Server lifecycle, REST/WS route orchestration | `src/server/index.ts` | Router/coordinator; reusable HTTP policy belongs in `http.ts`. |
| JSON/body limits, security headers, mobile CORS, rate limiting, MIME map | `src/server/http.ts` | Narrow HTTP boundary with fail-closed characterization tests. |
| Agent turn orchestration, prompts, tool catalog/execution | `src/server/bots.ts` | Runtime coordinator. Pure tool result/audit wording belongs in `bot-output.ts`. |
| Tool completion fallbacks, action summaries, command-result status | `src/server/bot-output.ts` | Pure user-visible/audit formatting contract. |
| Per-channel computer lifecycle and runtime backends | `src/server/channel-computers.ts` | Apple/OCI/native/mock provisioning, execution, mirror, readiness, fleet care. |
| Durable agent/channel worlds | `src/server/agents.ts` | Provision/archive/restore/delete, workspaces, thread helpers. |
| Database connection, additive migrations, seed/recovery | `src/server/db.ts` | High fan-in compatibility boundary. No migration or data-layout change belongs in a refactor phase. |
| Routing, storage views, events, follow-ups, skills, workflows | Same-named modules in `src/server/` | Domain owners called by the coordinators above. |

## Verification ownership

`test/phase6-modules.mjs` directly characterizes the three extracted contracts.
Runtime integration remains covered by `test/autonomy-platform.mjs`,
`test/sweep-fleet-telemetry.mjs`, browser/native suites, and the full
`npm run ci` contract. Delivery Phases 1–5 retain their named `test:phase*`
commands; modular work must not alter their artifact, promotion, or release
semantics.
