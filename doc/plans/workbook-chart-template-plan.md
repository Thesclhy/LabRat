# Reusable Chart Templates From Linked Workbook Data

Status: active (Milestones A-B complete, C-E proposed)
Read when: making an accepted workbook-backed comparison chart repeatable
with no provider call, or extending reusable chart templates beyond snapshot
columns.
Created: 2026-09-10
Depends on: `doc/plans/batch-workbook-experiment-linking-plan.md`
(Milestones 1-6 complete), `doc/contracts/reusable-chart-template-contract-v1.md`.

## Goal

Approve one cross-experiment chart built from linked workbook regions (for
example "Carbon distribution, Exp31 vs Exp32"), save it as a reusable
template, and later pick other experiments to get the same chart with **no
model call and no generated Python**, the way scalar templates work today.

```text
accepted linked-data comparison chart
  -> Save as template: one series slot bound to a data kind
  -> later: pick template + experiments
  -> per experiment: linked region -> accepted series definition
     -> points read from the confirmed range (deterministic)
  -> accepted recipe (select_series, align_x, filter_missing) + encoding
  -> resolved geometry -> validated Plotly -> awaiting-review AnalysisResult
  -> explicit ChartSpec acceptance with region-revision lineage
```

## Where today's code stops

| Piece | Today | Needed |
| --- | --- | --- |
| `deriveReusableChartTemplateDefinition` (`reusableChartTemplates.js`) | Rejects any chart with `sourceSelections`; builds scalar slots from snapshot fields | Accept a linked-data comparison chart; build one `series` slot bound to a data kind |
| `inspectReusableChartTemplateEligibility` | Same rejection, drives the "Template unavailable" text | Workbook eligibility with a strict recipe allowlist |
| `prepareReusableChartTemplateApplication` (`reusableChartTemplateApplications.js`) | Resolves slots to snapshot columns by `columnId`; freezes snapshot heads | Resolve `linked_region` slots to regions by data kind; freeze region revision ids |
| `buildReusableChartTemplateApplicationArtifacts` | Builds an accepted plan with `experimentSelections` and `inputMode: experiment_browser` | Build a plan with `sourceSelections` and `inputMode: workbook`, keeping `templateLineage` |
| `executeAnalysisRun` (`analysisThreads.js`) | Materializes snapshot experiments, calls `executeReusableChartTemplate` | Also materialize linked series inputs for template runs |
| `executeReusableChartTemplate` | Only `select_scalar`; x is the experiment label | Add a series renderer: x is the category or numeric axis, one trace per experiment |
| Chart Review result (`AnalysisReviewWorkspace.jsx`) | "Template unavailable" for workbook charts | Enabled when eligible, with the exact blocker otherwise |
| Template picker (`BackendScanPanel.jsx`) | Coverage from Browser columns | Coverage from `linked-data-kinds` for workbook templates |

## Product decisions to confirm

1. **Binding is by data kind.** A workbook slot binds to `linkedDataKind`
   ("Carbon distribution"). At application time each chosen experiment
   resolves to its most recently confirmed region of that kind, exactly as
   the Milestone 6 picker does. Templates never store cell addresses.
2. **Lineage freezes region revisions.** Each application records the exact
   accepted RegionUnderstandingRevision id per experiment in place of a
   snapshot head. Re-confirming a region creates a new revision; old
   ChartSpecs keep the old id and are marked stale-lineage in review, not
   rewritten.
3. **Values are the workbook's cached results.** Blank and Excel-error cells
   are missing points and follow the template's missing-point policy. Nothing
   is interpolated or invented.
4. **Provider-free by construction.** Eligibility accepts a chart only when
   its accepted plan did nothing beyond select, align, and drop missing
   points. A chart whose plan re-normalised raw areas or otherwise computed
   new values is refused with a message naming the step. Such charts stay on
   the reviewed path.
5. **Comparison modes.** `overlay` (lines or points) and `grouped` (one bar
   per experiment per category) are supported in v1. `stacked_components`
   and `faceted` are refused for series slots in v1.

## Canonical additions

### Input slot: workbook source

Additive fields on Reusable Input Slot v1. `sourceKind` defaults to
`"snapshot"`, so every stored template is unchanged and no migration is
needed (version payloads are JSON).

```json
{
  "slotId": "series",
  "label": "Overall carbon distribution",
  "dataKind": "series",
  "required": true,
  "cardinality": "one_per_experiment",
  "sourceKind": "linked_region",
  "linkedDataKind": "Carbon distribution",
  "identityContract": {
    "valueType": "series",
    "readableName": "Overall carbon distribution",
    "sourceSignature": "sha256:..."
  },
  "unitContract": { "allowedUnits": ["% of feed carbon"], "conversionPolicyIds": [] },
  "seriesContract": {
    "orientation": "header_row_categories",
    "xMeaning": "carbon_number",
    "xValueType": "number",
    "yNumericScale": "percent_points",
    "alignmentPolicy": "union_with_gaps"
  }
}
```

`sourceSignature` hashes orientation, x meaning, y unit, and numeric scale,
so a later extraction-template version that changes the unit fails the
contract at application time instead of mixing scales.

### Recipe for a workbook series template

```json
{
  "schemaVersion": "labrat.chartRecipe.v1",
  "operations": [
    { "op": "select_series", "inputSlotId": "series", "outputRole": "trace" },
    { "op": "align_x", "inputRole": "trace", "policy": "union_with_gaps", "order": "source" },
    { "op": "filter_missing", "inputRole": "trace", "policy": "preserve_gap" }
  ]
}
```

These three operations are already in the v1 allowlist; only the executor
implementation is new.

### Deterministic series reader

`readLinkedRegionSeries({ store, projectId, region, revision, series })` in a
new `backend/src/saas/linkedRegionSeries.js`:

- reads only the series ranges (`xHeaderRange` and `yValueRange`, or the two
  columns inside the region's inclusion rows) through the existing bounded
  range reader (`readSourceDocumentRange`, 2,500-cell analysis bound);
- returns `{ points: [{ x, y, xCell, yCell, missing, missingReason }],
  xLabels, yUnit, orientation, sourceRefs }` with x kept in sheet order;
- numeric parsing: numbers pass; numeric text such as `"7.22"` parses;
  blanks, text, and `type: "error"` cells are `missing` with reasons
  `blank`, `non_numeric`, `excel_error`;
- never reads outside the region and never evaluates formulas.

### Application record additions

`ReusableChartTemplateApplication` gains `frozenRegionRefs: [{ experimentId,
regionId, regionUnderstandingRevisionId, sourceDocumentId, sheetName, range
}]` beside the existing `frozenHeadRefs` (empty for workbook templates). Both
stores already persist the application as JSON; no migration.

### Eligibility rules for an accepted chart

Eligible when all of the following hold:

- the accepted ChartSpec's plan carries `linkedDataComparison` (created by the
  Milestone 6 picker), or every `sourceSelection` resolves to a linked region
  with exactly one series definition and all share one `dataKind`;
- every selected series shares `orientation`, `yUnit`, and `yNumericScale`;
- the plan's `processingSteps` match the select/align/missing allowlist
  (deterministic phrase list plus a check that no step names normalisation,
  weighting, ratios, sums, or calibration), and the accepted Plotly has
  exactly one trace per experiment;
- chart type is `grouped_bar`, `bar`, `scatter`, or `point`.

Blocker codes: `reusable_chart_template_workbook_recomputation`,
`reusable_chart_template_series_contract_mismatch`,
`reusable_chart_template_linked_regions_required`, plus the existing lineage
and unit codes.

### Application report

Per experiment: `ready`, `missing_data_kind`, `ambiguous_region` (several
regions, none newer), `series_shape_mismatch`, `range_too_large`,
`session_deleted`. Missing experiments follow the template's
`missingSeries` policy: `exclude_experiment` (default for series templates)
or `block`. The report reuses the existing `labrat.reusableChartTemplateCompatibility.v1`
shape with `frozenRegionRefs` added.

## Milestones

### Milestone A — Contract, eligibility, and definition (backend)

Status: complete on 2026-09-12 (branch `claude/batch-workbook-linking`).
Implementation notes: `inspectReusableChartTemplateEligibility` and
`deriveReusableChartTemplateDefinition` dispatch to the linked-series path
when the accepted chart has source selections and no Experiment Browser
selections; mixed charts stay on the scalar path and keep their existing
blockers. The derive function still throws the generic
`reusable_chart_template_not_eligible` code with the specific blockers in
`details`, so existing callers are unchanged. Summaries expose `sourceKind`
and `linkedDataKind`. Application and execution are Milestones B and C; a
saved workbook template cannot be applied yet.

What gets built:

- `reusableChartTemplates.js`: `validateReusableChartTemplateVersion` accepts
  `sourceKind`, `linkedDataKind`, and `seriesContract`; new
  `deriveLinkedSeriesTemplateDefinition` builds the slot, recipe, encoding
  (`overlay` for scatter/point, `grouped` for bars), missing-data policy
  (`missingPoint: preserve_gap`, `missingSeries: exclude_experiment`), and
  `validation.eligibility: "linked_series_comparison_v1"` from an accepted
  linked-data chart; `inspectReusableChartTemplateEligibility` branches on
  the presence of `sourceSelections` and applies the workbook rules above.
- `deriveReusableChartTemplateDefinition` dispatches to the new deriver when
  the chart is workbook-backed, so `POST /api/projects/:id/reusable-chart-templates`
  needs no new route.
- Contract addendum in `reusable-chart-template-contract-v1.md`
  ("Workbook series slots").

Tests: eligible Exp31/Exp32 comparison chart derives one series slot and the
three-operation recipe; a chart with a "weighted by C-Response" step is
refused with `reusable_chart_template_workbook_recomputation`; mixed units
refused; existing scalar tests unchanged.

Done when the "Save as template" eligibility call returns `eligible` for a
picker-created carbon distribution chart and the template version persists
with `sourceKind: linked_region`.

### Milestone B — Series reader and application resolution (backend)

Status: complete on 2026-09-12 (branch `claude/batch-workbook-linking`).
Implementation notes: the shared resolver is
`resolveLinkedRegionsForExperiments` in `linkedRegionSeries.js`, and
`linkedDataComparisons.js` now uses it (same error codes as before).
`prepareReusableChartTemplateApplication` dispatches to
`prepareLinkedSeriesTemplateApplication` when any slot is a linked-region
slot; that path refuses explicit bindings and mixed slot kinds. Exclusions
follow `missingDataPolicy.missingSeries` (`exclude_experiment` default,
`block`). `frozenRegionRefs` live inside the application's compatibility JSON,
so both stores persist them without a migration. Executing a queued workbook
application fails closed with `chart_template_series_execution_unavailable`
until Milestone C. Verified end to end by the route test "workbook series
templates apply by data kind and queue a run without touching snapshots".

What gets built:

- `linkedRegionSeries.js` with `readLinkedRegionSeries` and
  `resolveLinkedSeriesForExperiments({ store, projectId, linkedDataKind,
  experimentIds })`, the latter shared with `linkedDataComparisons.js`
  (refactor `pickRegion` and the linked context into it).
- `prepareReusableChartTemplateApplication`: when a slot has
  `sourceKind: linked_region`, resolve regions instead of columns, run the
  series reader to confirm shape and unit, emit the report, and return
  `frozenRegionRefs` plus `sourceSelections` (one per experiment, the exact
  region range) for the plan.
- `buildReusableChartTemplateApplicationArtifacts`: build the plan with
  `inputMode: workbook`, `sourceSelections`, `experimentSelections: []`, and
  `linkedDataComparison` lineage; thread `originalRequest` unchanged.
- `MemorySaasStore` and `PostgresSaasStore`: persist `frozenRegionRefs` on
  the application (JSON payload; no migration).

Tests: two experiments ready; one lacks the data kind and is excluded with a
report entry; two regions on one experiment picks the newer with a warning;
36 versus 37 categories reported as ready with alignment note; a deleted
session yields `session_deleted`; oversized range yields `range_too_large`;
error cells produce missing points with `excel_error`.

Done when `POST /api/reusable-chart-template-versions/:id/applications`
with a workbook template returns a `ready` compatibility and a queued run
without touching snapshots.

### Milestone C — Deterministic series execution (backend)

What gets built:

- `analysisThreads.executeAnalysisRun`: for template runs whose version has a
  `linked_region` slot, materialize `inputs.linkedSeries` through
  `readLinkedRegionSeries` using the frozen revision ids (a re-confirmed
  region is not silently swapped in), and pass them to the executor.
- `executeReusableChartTemplate`: add a `select_series` branch. Per
  experiment trace: x from the union of category labels in source order
  (`align_x`), y from the experiment's points, gaps preserved as nulls
  (`filter_missing: preserve_gap`) or dropped (`omit_point`). Encodings:
  `overlay` scatter/points and `grouped` bars. Legend is one entry per
  experiment; geometry goes through `resolveReusableChartGeometry` with
  category labels as x labels so long runs (C1 to C37) get rotation and
  margins from the existing policy.
- Source refs: one per plotted point (cell address), plus the region ranges;
  `hashes.inputHash` covers the point arrays so replays are idempotent.
- Validation: the existing Plotly/shape/limit validator runs unchanged;
  declared invariants stay empty for v1.

Tests: executor renders two overlay traces with a gap at C37 for the 36-
category workbook; grouped bars keep category order; stacked mode refused
with `chart_template_recipe_unsupported`; result source refs point at the
workbook cells; running twice yields the same `inputHash`.

Done when applying the template to Exp33 to Exp40 produces an awaiting-review
result whose y values equal the workbooks' `Overall tots` rows, with no
provider call recorded on the run.

### Milestone D — Frontend

What gets built:

- `AnalysisReviewWorkspace.jsx`: the eligibility call already gates the
  button; show the workbook-specific blocker text (recomputation, mixed
  units) instead of the generic "one-off workbook chart" sentence; on
  success the inline naming flow is unchanged.
- `BackendScanPanel.jsx` template picker: when the selected template version
  has a `linked_region` slot, load coverage from `listServerLinkedDataKinds`
  rather than Browser columns; rows without the data kind show "no linked
  <kind>" and are excluded by default with a note; the preview table lists
  workbook, sheet, and range per experiment; bindings UI is hidden because
  data-kind slots have no column choice.
- Result review: the lineage panel lists workbook and range per trace and
  marks a trace stale when its region has a newer accepted revision.
- Experiment Browser: no change; the linked-data column already shows which
  experiments can be templated.

Tests: picker shows coverage from data kinds and excludes uncovered rows;
Save as template enabled for an eligible workbook chart and disabled with the
recomputation reason otherwise; result lineage shows the region range.

Done when the whole loop runs in the app: save the Exp31/Exp32 carbon
distribution chart as a template, pick Exp33 to Exp40, preview, accept.

### Milestone E — Lifecycle and docs

- Re-confirming a linked region: existing applications keep their frozen
  revision; the next application uses the current accepted revision; the
  result review marks stale lineage.
- Deleting a workbook session: future applications report
  `session_deleted` for that experiment; accepted ChartSpecs are retained.
- Archiving an extraction template does not affect chart templates; the two
  are linked only through the data kind string, which is documented.
- Docs: contract addendum finalised, API contract (application response
  fields), data dictionary (application `frozenRegionRefs`), plan status,
  PROGRESS entry.

## Verification matrix

- Save a carbon distribution comparison of Exp31 and Exp32 as a template;
  apply to Exp33 to Exp40; every trace's points equal the workbook's `Overall
  tots` row values; the run records no provider call.
- A chart whose plan re-normalised raw areas is refused with the
  recomputation reason.
- One experiment lacks the data kind: excluded with a report entry, or
  blocked when the policy says so.
- One workbook has C1 to C36: aligned by label with a gap at C37 in overlay
  mode and an empty slot in grouped mode.
- A blank template sheet region (all `#DIV/0!`): all points missing, the
  experiment is excluded and named in the preview, nothing is invented.
- Re-confirm Exp32's region: the old ChartSpec keeps its revision id; a new
  application uses the new one and the old result shows stale lineage.
- Viewer role cannot create templates or applications; editor can.

## Estimated size

Roughly Milestones 3 plus 4 of the linking plan: one new backend module, two
extended services, an executor branch, JSON-only schema additions, and two
frontend surfaces. No migration and no new prompts.

## Risks

- **Silent recomputation.** The eligibility allowlist is the only thing that
  keeps template output equal to the sheet's own numbers; it must reject on
  doubt and say why.
- **Category drift.** Labs add carbon numbers over time; union alignment with
  gaps handles overlay, grouped bars show empty slots, and stacked mode is
  excluded in v1 for this reason.
- **Unit drift.** A new extraction-template version may change the unit; the
  slot's source signature rejects it at application time.
- **Read cost.** Forty regions of 37 points each is small; the 2,500-cell
  bound per region and the 64-experiment cap keep the worst case bounded.
