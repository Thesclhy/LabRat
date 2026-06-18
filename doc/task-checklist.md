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

Objective: Implement `doc/plan.md` Agent-first evidence workflow on `feature/agent-first-evidence-workflow`.

Milestone: Phase 5 Source Document Index backend foundation. Uploaded Excel workbooks should persist compact source document metadata and detected source region summaries, expose source document/region/query/range APIs, and keep full source cell grids out of project state and model context.

Relevant docs read: `AGENTS.md`, `doc/plan.md`, `doc/PROGRESS.md`, `doc/saas-api-contract-v0.md`, `doc/saas-database-schema-v0.md`, `doc/canonical-data-dictionary.md`, `doc/backend-api-contract.md`, `doc/ai-boundaries.md`, `doc/source-understanding-long-term-plan.md`.

Touched areas: backend SaaS store persistence, Postgres migration, project import scan indexing, source document/region/query/range routes, backend tests, API/schema/data dictionary docs, progress log.

Verification plan: targeted SaaS route tests for source document persistence/query/range/auth behavior passed; full `npm run codex:verify` passed.

Open risks: Keep this as backend-only Phase 5 foundation; do not add Source Explorer UI, Source Extract Proposals, Controlled AgentRun, Anthropic calls, dataset promotion, arbitrary code execution, or direct AI Plotly JSON. Existing unrelated `package-lock.json` metadata remains unstaged.

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
- [x] Record token/cost/latency assumptions for new AI-backed flows. Not applicable for this deterministic backend-only milestone; no model calls were added.
- [x] Keep this milestone deterministic and do not add Anthropic or AgentRun behavior.

## Recent Checkpoints

- 2026-06-18: Implemented Phase 5 Source Document Index backend foundation. Workbook scans now persist source document metadata, region summaries, and bounded cell-grid index blobs; new source document/region/query/range APIs are covered by targeted SaaS route tests and full `npm run codex:verify` passed.

- 2026-06-18: Started Phase 5 Source Document Index backend foundation. Scope is compact source document/region persistence and bounded source query/range APIs from existing workbook scans; no Source Explorer, Source Extract Proposal, Controlled AgentRun, Anthropic integration, PDF/CSV source understanding, or dataset promotion.

- 2026-06-18: Implemented lightweight natural-language compare command in the existing chat planner. Backend `/agent/plan` now returns `compare_series` actions for simple reaction-rate compare prompts after resolving active compatible ObservationSeries, and the frontend action card creates the AnalysisView plus chart proposal through existing APIs. Targeted backend/frontend tests and full `npm run codex:verify` passed.

- 2026-06-18: Started lightweight natural-language compare command milestone. Scope is deterministic `/agent/plan` recognition and confirmable frontend execution through the already implemented AnalysisView -> chart proposal -> Chart Review flow; no full AgentRun, Anthropic, Source Explorer, or Source Extract Proposal.

- 2026-06-18: Implemented frontend Compare series entrypoint milestone. Overview, Supplemental Workbooks manager, and Imported Browser can open a deterministic Compare series modal; the modal creates a `series_compare` AnalysisView, derives a normal chart proposal set, and opens existing Chart Review. Verification: targeted frontend tests and full `npm run codex:verify` passed.

- 2026-06-18: Implemented Phase 3 Dynamic Series Chart Rendering with ChartSpec v1.4 `seriesScope`, series-backed validation, multi-trace frontend rendering, Manuscript selectedExperimentIds coverage, docs, targeted tests, and full `npm run codex:verify`.

- 2026-06-18: Implemented Phase 2 Series Compare AnalysisViews with persistence, API routes, resolver, AnalysisView-derived chart proposal sets, docs, targeted route tests, and full `npm run codex:verify`.

- 2026-06-18: Implemented Phase 1 ObservationSeries registry foundation with reaction-rate supplement derivation, stale marking, state/list API wiring, persistence methods, migration docs, targeted backend tests, and full `npm run codex:verify`.

- 2026-06-18: Added durable Codex long-task execution loop environment

- 2026-06-18: Created the durable Codex workflow checklist template.
