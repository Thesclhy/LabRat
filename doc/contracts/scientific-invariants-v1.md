# Scientific Invariants v1

Status: contract
Last reviewed: 2026-09-19

## Stable Meanings

- `SourceDocument` is immutable indexed source evidence tied to an uploaded
  FileObject. It is not an experiment table and is never a published dataset.
- `WorkbookReviewRegion` is the mutable review anchor for one exact workbook
  rectangle. `RegionUnderstandingRevision` is immutable interpretation;
  new selections use the exact active accepted revision; a prepared linked
  chart-template application retains the accepted revision it already froze.
- `DataSnapshot` is immutable accepted structured scientific data. Corrections
  create another snapshot instead of overwriting history.
- `ExperimentSnapshotHead` selects one active `(dataSnapshotId, recordIndex)`
  for an ExperimentIdentity. There is no project-wide current dataset pointer.
- `AnalysisResult` is immutable backend-validated executor output awaiting a
  separate human decision. Execution cannot publish it.
- `ChartSpec` is immutable accepted chart evidence created only by accepting
  an exact AnalysisResult. A Manuscript stores a complete ChartSpec snapshot
  plus placement-local presentation state.

## Required Boundaries

```text
AI proposal
  -> deterministic schema / ownership / evidence validation
  -> visible user review
  -> explicit confirmation
  -> atomic backend transaction
  -> audit event
```

Confirming a region, accepting an analysis plan, accepting an AnalysisResult,
publishing Experiment Browser data and saving a Manuscript are independent
authorization and review boundaries. Approval at one boundary never implies
approval at a later boundary.

## Evidence And Context

- Every accepted value retains exact project-owned source refs and immutable
  dependency/content hashes.
- Missing, ambiguous or incompatible scientific values must remain missing or
  require clarification; they cannot be guessed, silently merged or converted.
- AI receives only bounded, task-relevant accepted evidence. It never receives
  credentials, private sessions, unrelated project history, full workbooks or
  entire accepted point collections.
- Source selections must stay inside active accepted regions. Experiment
  selections must resolve through frozen active snapshot heads.

Prepared linked-region chart templates are a narrow current-pointer exception:
execution/publication verify the persisted application, version, run and
accepted-plan binding, then use its exact frozen region revision even after
reconfirmation. Ordinary analysis selection and scalar snapshot-head checks are
unchanged. Missing frozen source material remains an error. See
`doc/contracts/claude-features-v1.md`.
- Model tool output and generated Python are untrusted until deterministic
  validation succeeds.

The current source-inspection payload containing both `cells` and derived
`rows` is a documented legacy implementation detail, not an invariant and not
a v1 compatibility requirement. Any later compaction must retain values,
types, formula/display distinctions, ordering and exact cell addresses.

## Current analysis review

The current plan is the maximum numeric revision, independent of API list order.
For that plan the current run follows the server's append-ordered analysisRunIds;
createdAt and id provide a deterministic fallback when no sequence is supplied.
Recent model context contains the five largest revisions in ascending order.
Public API response ordering is unchanged.

Feedback clears the visible and onboarding-saved run/result/preview and opens the
new plan for review. Historical viewing cannot replace onboarding's current IDs,
automatically execute a run, or publish a superseded result. Restoration failure
keeps publication disabled and offers retry. Late responses from a prior review
request cannot replace the current workflow.

Publication requires the current accepted plan, its latest run, an exactly
associated result and preview, explicit successful validation without errors,
and the server's awaiting_result_review state. Both publishers and their atomic
store transactions verify the association; database transactions do so after
locking the thread. Existing authorization, source/head freshness and idempotent
replay semantics remain in force. This changes no API, table or snapshot shape.

## Atomicity And Idempotency

- Plan acceptance creates one queued AnalysisRun and no result or publication.
- Execution creates at most one immutable awaiting-review AnalysisResult and
  no ChartSpec or DataSnapshot publication.
- Chart acceptance atomically accepts the exact result, completes its workflow
  and creates exactly one ChartSpec.
- Experiment publication atomically accepts the exact result, creates one
  DataSnapshot, advances only affected heads, creates publication/view
  provenance and completes the workflow.
- Stale accepted-region pointers, stale snapshot heads, conflicting
  idempotency keys, validation failure or insert failure roll back all writes.
- Same-key/same-request replay returns the recorded response; same-key/different
  request returns a conflict.

These transaction paths must continue using PostgreSQL row/advisory locks and
explicit transactions where required. Replacing SQL with an ORM API must not
weaken their isolation or lock ordering.

## Projection And Bounded Responses

- Experiment Browser rows derive only from active ExperimentSnapshotHeads.
- Project state and list responses omit raw workbook grids, complete
  DataSnapshot records, generated programs, materialized run inputs and full
  Plotly arrays.
- Detail/range APIs return bounded content with explicit pagination or size
  validation; they never silently truncate scientific evidence.
- Search, count, pagination and source navigation are filtered by authorization
  in SQL before results are returned.

## Immutable History

Framework migration, DTO changes and permission backfills must not modify
historical source files, source indexes, accepted revisions, snapshots,
AnalysisResults, ChartSpecs or Manuscript snapshots. Any future schema-version
change creates a reviewed new artifact while retaining the prior artifact.
