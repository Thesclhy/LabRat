# Task Checklist

Status: active
Read when: starting or continuing a non-trivial LabRat milestone.
Last reviewed: 2026-07-16

This file is the reusable execution checklist for Codex work. It should describe how to run a milestone, not what the current product strategy is. Current milestone state belongs in `doc/current-milestone.md`; recent completed work belongs in `doc/PROGRESS.md`.

## Long-Task Loop

- [ ] Run or mentally perform `npm run codex:preflight`.
- [ ] Read `README.md`, `AGENTS.md`, `doc/START_HERE.md`, `doc/plan.md`, `doc/PROGRESS.md`, `doc/current-milestone.md`, and this checklist.
- [ ] Read the relevant contracts and architecture docs for the area being touched.
- [ ] Confirm the milestone scope in `doc/current-milestone.md`.
- [ ] Implement one coherent milestone, keeping changes scoped.
- [ ] Run targeted tests while developing.
- [ ] Run full verification when feasible, or record why a narrower command was chosen.
- [ ] Update `doc/PROGRESS.md` with request, changes, verification, and follow-ups.
- [ ] Update `doc/current-milestone.md` if the active milestone status, next step, risks, or verification changed.
- [ ] Re-read `doc/plan.md` and any touched contracts before continuing.
- [ ] Report code/doc conflicts instead of guessing.

## Documentation Routing

- Use `doc/plan.md` for the short active roadmap and product/engineering priority.
- Use `doc/current-milestone.md` for the active implementation milestone and immediate next steps.
- Use `doc/PROGRESS.md` for newest-first completed work and verification history.
- Use `doc/reports/decisions.md` for durable architecture or product decisions.
- Use `doc/plans/` for long-form plans; mark implemented or superseded plans clearly rather than deleting useful context.

## Milestone Checklist Template

- [ ] Confirm current plan, current milestone, and relevant contracts.
- [ ] Inspect the source files or docs to be touched.
- [ ] Identify user-owned or unrelated worktree changes and avoid reverting them.
- [ ] Implement the smallest coherent slice.
- [ ] Add or update tests matching the risk.
- [ ] Run targeted verification.
- [ ] Run full verification or record why not.
- [ ] Update progress and current milestone docs if needed.
- [ ] Record follow-ups and residual risks.

## Evidence Workflow Checklist

- [ ] Identify whether the slice touches Source Workspace, WorkbookReviewRegion/RegionUnderstandingRevision, DataPlan, DataSnapshot, Experiment Browser, AgentRun, ChartSpec, Manuscript, or audit behavior.
- [ ] Keep AI/tool actions proposal-first until explicit user confirmation.
- [ ] Use exact active accepted RegionUnderstandingRevisions or other accepted/reviewed evidence only for DataPlan-ready results.
- [ ] For Browser work, derive rows only from accepted DataSnapshots selected by experiment snapshot heads.
- [ ] Require explicit create/reuse decisions for ambiguous experiment identities.
- [ ] Keep fields with incompatible units separate unless a reviewed conversion operation exists.
- [ ] Keep transient preview hashes independent of database-assigned ids and compute accepted content hashes from final persisted records.
- [ ] Keep BrowserViews limited to personal display state; never store authoritative values in them.
- [ ] Preserve source refs, hashes, stale-state metadata, warnings, and confidence across Browser projections, proposals, ChartSpecs, and manuscript snapshots.
- [ ] Keep DataPlan/DataSnapshot review separate from chart visual review and manuscript placement.
- [ ] Add or update API/schema/data-dictionary docs in the same change when persisted shapes or contracts change.
- [ ] Record token/cost/latency assumptions for new AI-backed flows; deterministic slices should state that no provider call is added.

## Verification Guidance

- Documentation-only change: run `git diff --check`.
- Frontend-only behavior: run targeted `npm test` and `npm run build`.
- Backend/import/chart behavior: run targeted `node --test` files, `npm --prefix backend test`, and frontend tests when behavior crosses the UI.
- Schema/server workflow: run backend route tests and optional Postgres tests when `LABRAT_TEST_DATABASE_URL` is configured.
- UI/canvas/chart workflow: run app/manual QA when possible and record any skipped browser verification.
