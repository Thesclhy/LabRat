# Task Checklist

Status: active
Read when: starting or continuing a non-trivial LabRat milestone.
Last reviewed: 2026-09-30

This file is the reusable execution checklist for Codex work. It should describe how to run a milestone, not what the current product strategy is. Current milestone state belongs in `doc/current-milestone.md`; recent completed work belongs in `doc/PROGRESS.md`.

## Long-Task Loop

Read-only Q&A/source trace (2026-09-29):

- [x] Freeze R01–R17 before edits and update the superseding answer contract.
- [x] Protect original-tree work; use isolated codex/readonly-qa-trace.
- [x] Keep scientific review/auth boundaries; model-select bounded read tools.
- [x] Retain shape/read-ID checks, remove prose/number acceptance gates.
- [x] Persist all returned windows and grouped Sources read across history.
- [x] Review both providers’ actual answers; retain first failures and limit behavior.
- [x] Verify PostgreSQL and actual browser/second-session behavior.
- [x] Complete final full regression and record exact counts.
- [x] Deliver manual test instructions in doc/qa/readonly-qa-trace.md.

- [x] Back up production, fast-forward main to 159e50b and verify hosted deployment.
- [x] Verify active release, exact public assets, health and unauthenticated rejection.
- [ ] User manual acceptance; see doc/qa/readonly-qa-trace.md.

Release evidence: doc/qa/readonly-qa-deployment.md.

Cross-device pending Ask tasks (2026-09-28):

- [x] Inspect the isolated LangGraph pilot and choose bounded server task state.
- [x] Persist personal tasks and file links with migration 037 and v1 contracts.
- [x] Atomically link continuation to one Q&A run; preserve current review/access.
- [x] Verify two sessions, restart, concurrent continue/cancel, forced rollback,
  stale evidence, lost responses and permissions.
- [x] Complete full regression, actual two-context browser QA and narrow layout.
- [x] Record coverage/limits in `doc/qa/cross-device-ask-tasks.md`.

- [x] Back up production, publish main and verify hosted release/migration 037.
- [x] Verify live release, service, public assets and unauthenticated API rejection.
- [ ] User manual chat-panel acceptance (in progress; navigation and attachment
  feedback tracked in `doc/current-milestone.md`; fixed-answer/cross-device checks pending).

Deployed application e780cff; evidence: `doc/qa/cross-device-ask-deployment.md`.

Unified Ask extension (2026-09-28):

- [x] Reuse the isolated deployment checkout and preserve the original dirty tree.
- [x] Implement approved references, mentions, unified conversation and workbook boundaries.
- [x] Verify full regression, real PostgreSQL and actual browser interactions.
- [x] Record source/version/review contracts and manual acceptance in
  `doc/qa/unified-ask-verification.md`.
- [x] Back up production, publish main, verify hosted deployment and migration 036.
- [x] Verify exact release/assets, authorization rejection and live citation canaries.

Release evidence: `doc/qa/unified-ask-deployment.md`; application commit 0d4a9ea.

Research Q&A release (2026-09-27):

- [x] Preserve local work and integrate only Q&A on latest remote main.
- [x] Keep remote migrations 031–033; append Q&A migrations 034/035.
- [x] Preserve the completed synthetic real-provider review and original transcripts.
- [x] Complete the integrated release regression and browser/database checks.
- [x] Push the reviewed release and verify hosted deployment and production health.

Release evidence: doc/qa/research-qa-deployment.md.

Current Claude v1 integration milestone:

- [x] Preserve baseline work and create the dedicated integration branch.
- [x] Port deterministic helpers and expose eleven generated v1 operations.
- [x] Verify transactional templates, per-region confirmation and fixture upgrades.
- [x] Verify linked series, frozen sources and no-provider template execution.
- [x] Verify welcome/invitations, permissions and background-task cancellation.
- [x] Repair and verify clean installation; run full and browser acceptance.
- [ ] Rehearse actual database/file backups and real-provider comparison.
- [x] Obtain explicit approval for main publication and automatic deployment.
- [ ] Confirm hosted CI result and production health after publication.

Current invitation milestone:

- [x] Verify atomic invitation registration and issuer/revocation checks.
- [x] Verify permission presets, inheritance and membership rejoining.
- [x] Verify signup and compact Lab/platform management UI.
- [x] Verify read-only canvas and stale workspace response isolation.
- [x] Run full, PostgreSQL and browser checks; update progress.

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
