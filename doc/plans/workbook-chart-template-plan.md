# Reusable Chart Templates From Linked Workbook Data

Status: proposed
Read when: making an accepted workbook-backed comparison chart repeatable
with no provider call, or extending reusable chart templates beyond snapshot
columns.
Created: 2026-09-10
Depends on: `doc/plans/batch-workbook-experiment-linking-plan.md`
(Milestones 1-6 complete), `doc/contracts/reusable-chart-template-contract-v1.md`.

## Goal

Let a user approve one cross-experiment chart built from linked workbook
regions (for example "Carbon distribution, Exp31 vs Exp32"), save it as a
reusable template, and later pick other experiments to get the same chart
with **no model call and no generated Python**, exactly as scalar templates
work today.

```text
accepted linked-data comparison chart
  -> Save as template (slot bound to a data kind, not a snapshot column)
  -> later: choose template + experiments
  -> deterministic: linked region per experiment -> series points read from
     the confirmed range -> accepted recipe/encoding/geometry
  -> ordinary awaiting-review AnalysisResult -> explicit ChartSpec acceptance
```

## Why this is a separate program

The reusable template executor (`chart_template_v1`) binds input slots to
Experiment Browser columns inside frozen DataSnapshot heads and runs a fixed
recipe over those values. Linked workbook data has no snapshot columns: the
numbers stay in the workbook and are read through confirmed regions. So the
template needs a second slot source that resolves to a region and a
deterministic series reader, while everything after the inputs (recipe
operations, encoding, palette, geometry, validation, AnalysisResult,
ChartSpec lineage) stays shared.

## Product Decisions To Confirm

1. **Binding is by data kind.** A workbook slot binds to a `dataKind` such as
   "Carbon distribution". At application time each chosen experiment resolves
   to its most recently confirmed region of that kind. No cell addresses are
   stored in the template.
2. **Lineage freezes region revisions, not snapshot heads.** An application
   records the exact accepted RegionUnderstandingRevision id per experiment.
   Re-confirming a region creates a new revision; old ChartSpecs keep pointing
   at the old one.
3. **Values are the workbook's cached results**, consistent with the earlier
   decision. Excel error cells (`#DIV/0!`) and blanks are missing points and
   follow the template's missing-value policy; they are never invented.
4. **Provider-free.** Template application makes no model call. If the
   accepted chart's Python did more than select and align the series (for
   example re-normalising from raw areas), the chart is not eligible; the
   user is told to build the chart from a results row instead.

## Canonical Additions

### Input slot v1 extension

```json
{
  "slotId": "series",
  "label": "Overall carbon distribution",
  "dataKind": "series",
  "sourceKind": "linked_region",
  "linkedDataKind": "Carbon distribution",
  "seriesContract": {
    "orientation": "header_row_categories",
    "xMeaning": "carbon_number",
    "yUnit": "% of feed carbon",
    "yNumericScale": "percent_points",
    "alignment": "by_category_label",
    "missingPoint": "preserve_gap"
  }
}
```

`sourceKind` defaults to `"snapshot"` for every existing template, so no
migration of stored payloads is needed; the version payload is JSON.

### Deterministic series reader

`readLinkedRegionSeries({ store, region, revision })`:

- uses the accepted revision's series definition (`orientation`,
  `xHeaderRange`/`yValueRange` or `xColumn`/`yColumn`);
- reads only those ranges through the existing bounded range reader;
- keeps x labels in sheet order, parses y as numbers, marks blanks and error
  cells as missing with the cell address, and attaches one source ref per
  point;
- refuses ranges above the existing 2,500-cell analysis bound.

### Eligibility of an accepted chart

An accepted analysis-result ChartSpec is workbook-template eligible when:

- its plan carries `linkedDataComparison` (created by the Milestone 6
  picker) or every source selection is a linked region with exactly one
  series definition and one shared `dataKind`;
- all selected series share orientation and y unit and numeric scale;
- the processing steps are limited to select, align, and missing-value
  handling (the plan's `processingSteps` are checked against an allowlist,
  and the accepted Plotly trace count equals the experiment count).

Anything else returns the existing "one-off workbook chart" blocker with a
sharper message naming the reason.

### Application report

Mirrors the scalar path: per experiment `ready`, `missing_data_kind`,
`ambiguous_region` (several regions, none newer), `series_shape_mismatch`
(different orientation or unit), `range_too_large`, plus the frozen revision
ids. Missing experiments follow the template's declared policy
(`exclude_experiment` or block).

## Milestones

### Milestone A — Contract and eligibility (backend)

- Extend the input-slot schema with `sourceKind` and `linkedDataKind`; keep
  `snapshot` the default.
- Add workbook eligibility to `inspectReusableChartTemplateEligibility` and
  a definition deriver that builds the slot, recipe (`select_series`,
  `align_x`, `filter_missing`), and encoding from the accepted chart.
- Tests: eligible comparison chart, chart with recomputation steps refused,
  mixed units refused.

### Milestone B — Series reader and application (backend)

- Implement `readLinkedRegionSeries` on top of the range reader.
- Extend `prepareReusableChartTemplateApplication` to resolve
  `linked_region` slots per experiment, produce the report, and freeze
  revision ids in the application record (new nullable JSON field, no new
  table).
- Extend `executeReusableChartTemplate` to accept workbook series inputs;
  recipe, geometry, and validation unchanged.
- Tests: two experiments exact, one missing data kind, error cells as gaps,
  36 vs 37 categories aligned by label, deleted session reported missing.

### Milestone C — Frontend

- Chart Review result: "Save as template" enabled for eligible linked-data
  charts, with the blocker text otherwise.
- Template picker: for workbook templates, coverage comes from
  `linked-data-kinds` rather than Browser columns; rows without the data
  kind are shown as missing before preview.
- Result review unchanged; lineage panel shows workbook and range per trace.

### Milestone D — Lifecycle

- Re-confirming a linked region does not change existing applications;
  the picker uses the current accepted revision on the next run.
- Deleting a workbook session makes that experiment `missing_data_kind` in
  future applications; existing ChartSpecs are retained.
- Docs: reusable chart template contract v1 addendum, API contract, data
  dictionary, plan status, PROGRESS.

## Verification Matrix

- Save a Carbon distribution comparison of Exp31 and Exp32 as a template;
  apply to Exp33 to Exp40; every trace's points equal the workbook's
  `Overall tots` row values; no provider call recorded.
- A chart whose plan re-normalised raw areas is refused with a reason.
- One experiment lacks the data kind: excluded or blocked per policy.
- One workbook has `C1..C36`: aligned by label with a gap at C37.
- A blank template sheet region (all `#DIV/0!`): all points missing, the
  experiment is reported, nothing is invented.
- Re-confirm Exp32's region: the old ChartSpec keeps its revision id; a new
  application uses the new one.

## Estimated Size

Comparable to Milestones 3 and 4 of the linking plan: two backend services,
one executor extension, schema additions without migration, and two frontend
surfaces. No new provider prompts.

## Risks

- **Silent recomputation.** The eligibility allowlist is what keeps template
  output equal to the workbook's own numbers; it must stay strict.
- **Category drift.** Labs add carbon numbers over time; alignment by label
  with gaps handles it, but stacked encodings need every category present
  and should block when a category is missing.
- **Unit drift.** A later template version of the extraction template may
  change the unit; the slot's unit contract rejects it at application time
  instead of mixing scales.
