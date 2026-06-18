# Task Checklist

Use this file as the working checklist for long Codex tasks. Update it before starting a long milestone, keep it current while working, and leave enough context for the next agent to continue without restarting from scratch.

## Long-Task Loop

- [ ] Run or mentally perform `npm run codex:preflight`.
- [ ] Read `doc/plan.md`.
- [ ] Read relevant API/data-model/architecture docs for the files being touched.
- [ ] Record the current objective and milestone checklist below.
- [ ] Implement one coherent milestone.
- [ ] Run targeted tests while developing.
- [ ] Run `npm run codex:verify` before final handoff when feasible.
- [ ] Update `doc/PROGRESS.md`.
- [ ] Re-read `doc/plan.md` and touched contract docs before continuing.
- [ ] Report code/doc conflicts instead of guessing.

## Current Objective

No active long-running objective is checked out in this file.

When starting one, replace this section with:

```text
Objective:
Milestone:
Relevant docs read:
Touched areas:
Verification plan:
Open risks:
```

## Milestone Checklist Template

- [ ] Confirm current plan and contracts.
- [ ] Inspect code paths to be touched.
- [ ] Implement the smallest coherent slice.
- [ ] Add or update tests matching the risk.
- [ ] Run targeted verification.
- [ ] Run full verification or record why not.
- [ ] Update progress and decisions if needed.

## Agent-First Evidence Workflow Checklist

- [ ] Identify whether the slice touches Evidence Graph, Source Workspace, ObservationSeries, AnalysisView, AgentRun, ChartSpec, Manuscript, or audit behavior.
- [ ] Keep AI/tool actions proposal-first until explicit user confirmation.
- [ ] Preserve source refs and stale-state metadata across derived views, proposals, ChartSpecs, and manuscript snapshots.
- [ ] Add or update API/schema/data-dictionary docs in the same change when persisted shapes change.
- [ ] Record token/cost/latency assumptions for new AI-backed flows.

## Recent Checkpoints

- 2026-06-18: Added durable Codex long-task execution loop environment

- 2026-06-18: Created the durable Codex workflow checklist template.
