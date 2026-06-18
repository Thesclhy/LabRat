# Task Checklist

Use this file as the working checklist for long Codex tasks. Update it before starting a long milestone, keep it current while working, and leave enough context for the next agent to continue without restarting from scratch.

## Long-Task Loop

- [x] Run or mentally perform `npm run codex:preflight`.
- [x] Read `doc/plan.md`.
- [x] Read relevant API/data-model/architecture docs for the files being touched.
- [x] Record the current objective and milestone checklist below.
- [x] Implement one coherent milestone.
- [x] Run targeted tests while developing.
- [x] Run `npm run codex:verify` before final handoff when feasible.
- [x] Update `doc/PROGRESS.md`.
- [x] Re-read `doc/plan.md` and touched contract docs before continuing.
- [x] Report code/doc conflicts instead of guessing.

## Current Objective

Objective: Implement `doc/plan.md` Agent-first evidence workflow vertical slice on `feature/agent-first-evidence-workflow`.

Milestone: Phase 1 ObservationSeries registry is implemented and under verification; continue to Phase 2 AnalysisView compare charts only after the milestone commit leaves the tree clean.

Relevant docs read: `AGENTS.md`, `doc/plan.md`, `doc/PROGRESS.md`, `doc/saas-api-contract-v0.md`, `doc/saas-database-schema-v0.md`, `doc/canonical-data-dictionary.md`, `doc/backend-api-contract.md`, `doc/ai-boundaries.md`, `doc/source-understanding-long-term-plan.md`.

Touched areas: SaaS store/routes/migrations, observation-series derivation, chart proposal/ChartSpec validation, generic chart rendering, manuscript chart selection, server API helpers, tests, progress log.

Verification plan: targeted backend route/store tests after each backend milestone, targeted frontend chart/manuscript tests for rendering work, `npm run codex:verify` before each commit when feasible.

Open risks: ChartSpec v1.4 must stay additive and must not bypass accepted proposal -> ChartSpec -> Manuscript review; source evidence and AgentRun stretch work should stop if the compare-chart slice is not clean.

## Milestone Checklist Template

- [x] Confirm current plan and contracts.
- [x] Inspect code paths to be touched.
- [x] Implement the smallest coherent slice.
- [x] Add or update tests matching the risk.
- [x] Run targeted verification.
- [x] Run full verification or record why not.
- [x] Update progress and decisions if needed.

## Agent-First Evidence Workflow Checklist

- [x] Identify whether the slice touches Evidence Graph, Source Workspace, ObservationSeries, AnalysisView, AgentRun, ChartSpec, Manuscript, or audit behavior.
- [x] Keep AI/tool actions proposal-first until explicit user confirmation.
- [x] Preserve source refs and stale-state metadata across derived views, proposals, ChartSpecs, and manuscript snapshots.
- [x] Add or update API/schema/data-dictionary docs in the same change when persisted shapes change.
- [ ] Record token/cost/latency assumptions for new AI-backed flows.

## Recent Checkpoints

- 2026-06-18: Implemented Phase 1 ObservationSeries registry foundation with reaction-rate supplement derivation, stale marking, state/list API wiring, persistence methods, migration docs, targeted backend tests, and full `npm run codex:verify`.

- 2026-06-18: Added durable Codex long-task execution loop environment

- 2026-06-18: Created the durable Codex workflow checklist template.
