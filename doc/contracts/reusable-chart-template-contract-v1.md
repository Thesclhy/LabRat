# Reusable Chart Template Contract v1

Status: contract
Read when: implementing reusable chart styles, templates, input binding, deterministic chart reuse, or template-derived ChartSpecs.
Last reviewed: 2026-08-18

## Purpose

LabRat keeps the existing reviewed natural-language chart workflow for new
scientific intent and adds a deterministic fast path for repeating an already
approved comparison with different compatible experiments.

```text
new scientific intent
  -> reviewed AnalysisThread / PlanRevision / generated program
  -> validated AnalysisResult
  -> accepted ChartSpec
  -> optional reusable-template authoring

approved reusable intent
  -> choose template version and experiments
  -> deterministic compatibility and slot binding
  -> chart_template_v1 AnalysisRun
  -> validated AnalysisResult
  -> accepted ChartSpec
```

Template reuse never creates a second chart truth. Both paths converge on the
existing immutable AnalysisResult and ChartSpec publication boundary.

## Terminology And Naming

The new server-owned scientific template is named `ReusableChartTemplate`.
Frontend code already contains a legacy manuscript-local `chartTemplates`
shape for chart-block presentation defaults. That shape is not this entity and
must not be reused, migrated, or overloaded. New frontend code should use
`reusableChartTemplates` and `chartStyleProfiles`.

## ChartStyleProfile v1

A project-owned presentation policy independent of scientific data and
calculation meaning.

```json
{
  "schemaVersion": "labrat.chartStyleProfile.v1",
  "id": "chart_style_profile_1",
  "projectId": "project_1",
  "name": "Lab publication style",
  "status": "active",
  "currentVersionId": "chart_style_profile_version_3"
}
```

Each accepted version is immutable:

```json
{
  "schemaVersion": "labrat.chartStyleProfileVersion.v1",
  "id": "chart_style_profile_version_3",
  "chartStyleProfileId": "chart_style_profile_1",
  "version": 3,
  "status": "accepted",
  "typography": {
    "fontFamily": "Arial",
    "titleSizePt": 18,
    "axisTitleSizePt": 14,
    "tickSizePt": 12,
    "legendSizePt": 12,
    "minimumSizePt": 9
  },
  "palette": {
    "colors": ["#245B78", "#D97935", "#4D8C57"],
    "assignment": "selection_order",
    "overflow": "marker_and_dash"
  },
  "figure": {
    "aspectRatio": 1.5,
    "preferredWidthPx": 1200,
    "preferredHeightPx": 800
  },
  "geometry": {
    "preferredPlotAreaWidthRatio": 0.76,
    "preferredPlotAreaHeightRatio": 0.72,
    "minimumPlotAreaWidthRatio": 0.65,
    "minimumPlotAreaHeightRatio": 0.62,
    "preferredMarginsPx": { "top": 60, "right": 35, "bottom": 75, "left": 85 },
    "maximumMarginsPx": { "top": 100, "right": 180, "bottom": 150, "left": 140 }
  },
  "legend": {
    "preferredPosition": "right",
    "fallbackPositions": ["bottom", "top"],
    "allowWrapping": true
  },
  "axes": {},
  "marks": {},
  "reference": {
    "fileObjectId": null,
    "extractionMethod": "manual",
    "confidence": null
  }
}
```

Rules:

- Points are used for type sizes; pixels and normalized ratios are used for
  figure geometry as named above.
- Ratios are finite numbers greater than zero and at most one. Minimum ratios
  cannot exceed their preferred ratios.
- Margins are non-negative and preferred margins cannot exceed maximums.
- Reference images, PDFs, SVGs, or PPTX files are project presentation assets,
  not SourceDocument evidence and not scientific inputs.
- Model/vision extraction may create a draft only. A user must accept the
  version before a reusable template can pin it.
- Editing creates a new version. Existing templates and ChartSpecs keep their
  pinned version or accepted snapshot.

## ReusableChartTemplate v1

A project-owned named container for immutable reusable template versions.

```json
{
  "schemaVersion": "labrat.reusableChartTemplate.v1",
  "id": "reusable_chart_template_1",
  "projectId": "project_1",
  "name": "Carbon-number distribution",
  "description": "Compare accepted carbon-number series across experiments.",
  "status": "active",
  "currentVersionId": "reusable_chart_template_version_2"
}
```

Each version pins all behavior required for deterministic replay:

```json
{
  "schemaVersion": "labrat.reusableChartTemplateVersion.v1",
  "id": "reusable_chart_template_version_2",
  "reusableChartTemplateId": "reusable_chart_template_1",
  "version": 2,
  "status": "accepted",
  "sourceChartSpecId": "chart_spec_21",
  "chartStyleProfileVersionId": "chart_style_profile_version_3",
  "experimentCardinality": {
    "minimum": 1,
    "recommendedMaximum": 6,
    "hardMaximum": 12
  },
  "inputSlots": [],
  "recipe": {},
  "encoding": {},
  "missingDataPolicy": {},
  "geometryPolicy": {},
  "validation": {},
  "contentHash": "sha256:..."
}
```

Rules:

- A template version is accepted only when derived from an accepted
  `origin: analysis_result` ChartSpec and its reviewed analysis artifacts.
- The backend derives and validates the reusable contract. The browser cannot
  submit arbitrary operations and mark them accepted.
- A template version contains no experiment ids, final values, Plotly trace
  arrays, source workbook grids, or executable code.
- `minimum <= recommendedMaximum <= hardMaximum` and all are positive bounded
  integers.
- Archiving the container removes it from normal creation choices but never
  deletes versions or historical lineage.
- A template whose source analysis cannot compile to the v1 deterministic
  recipe language is not fast-path eligible. LabRat may still save or apply
  its style through the ordinary reviewed workflow.
- Approved-chart authoring may derive one to twelve scalar slots when every
  selected experiment presents the same stable numeric column identities in
  the same order and each slot has a stable unit. Multi-component shared-axis
  charts require one compatible unit across slots; Plotly bar layout with
  `barmode: stack` compiles to `stacked_components` rather than stacking
  experiments.

## Reusable Input Slot v1

An input slot declares one reusable scientific role without naming a specific
experiment.

```json
{
  "slotId": "distribution",
  "label": "Carbon-number distribution",
  "dataKind": "series",
  "required": true,
  "cardinality": "one_per_experiment",
  "identityContract": {
    "preferredColumnId": "column_123",
    "valueType": "series",
    "readableName": "Carbon-number distribution",
    "sourceSignature": "sha256:..."
  },
  "unitContract": {
    "allowedUnits": ["mol%"],
    "conversionPolicyIds": []
  },
  "seriesContract": {
    "xValueType": "number",
    "xUnit": "carbon_number",
    "alignmentPolicy": "union_with_gaps"
  }
}
```

Binding order is deterministic:

1. exact active column/series id plus matching type and unit contract;
2. an active, previously user-approved slot binding whose source signature and
   contract still match;
3. exactly one candidate matching type, unit, readable metadata, and source
   signature, returned as `confirmation_required` on first use;
4. multiple matching candidates return `ambiguous` and require an explicit
   user binding;
5. no candidate returns `missing` and never substitutes another field.

Fuzzy or model similarity may rank visible candidates, but can never accept a
binding. Duplicate readable names are independent. Bindings are project- and
template-version-scoped, append-only decisions with active/superseded status.

The v1 fast path binds snapshot slots to fields in accepted active Experiment
Browser snapshots. Direct workbook ranges can be rebound across experiments
only through a linked-region slot (below); other workbook charts remain
one-off.

### Workbook series slots (`sourceKind: "linked_region"`)

An input slot may declare `sourceKind: "linked_region"` (the default is
`"snapshot"`, so stored templates are unchanged). Such a slot must be a
`series` slot, names the `linkedDataKind` it binds to (for example "Carbon
distribution"), and carries a `seriesContract` with `orientation`
(`header_row_categories` or `column_pair`), `xMeaning`, `xValueType`,
`yNumericScale`, and `alignmentPolicy` (`union_with_gaps`, `intersection`,
or `exact`). `identityContract.preferredColumnId` is empty;
`identityContract.sourceSignature` hashes orientation, x meaning, y unit, and
numeric scale so a changed unit fails the contract at application time.

```json
{
  "slotId": "series",
  "label": "Overall carbon distribution",
  "dataKind": "series",
  "sourceKind": "linked_region",
  "linkedDataKind": "Carbon distribution",
  "identityContract": { "preferredColumnId": "", "valueType": "series", "readableName": "Overall carbon distribution", "sourceSignature": "sha256_..." },
  "unitContract": { "allowedUnits": ["% of feed carbon"], "conversionPolicyIds": [] },
  "seriesContract": { "orientation": "header_row_categories", "xMeaning": "carbon_number", "xValueType": "number", "yNumericScale": "percent_points", "alignmentPolicy": "union_with_gaps" }
}
```

Binding is by data kind: at application time each chosen experiment resolves
to its most recently confirmed WorkbookReviewRegion whose `dataKind` matches,
and lineage freezes that region's accepted revision id instead of a snapshot
head. No cell address is stored in the template.

Eligibility of a source chart (`inspectLinkedSeriesTemplateEligibility`,
used automatically when an accepted chart has source selections and no
Experiment Browser selections): every region is a confirmed region linked to
an experiment under one data kind, each defines exactly one series, all
series share orientation, unit, and numeric scale, the chart type is
`grouped_bar`, `bar`, `scatter`, or `point`, the accepted plan's processing
steps only select and align (steps that normalise, weight, calibrate, sum,
average, convert, or otherwise compute new values are refused as
`reusable_chart_template_workbook_recomputation`), and the accepted chart has
exactly one trace per experiment. The derived recipe is `select_series`,
`align_x` (`union_with_gaps`, source order), `filter_missing`
(`preserve_gap`); encoding is `grouped` bars or `overlay` points with
`colorBy: experiment`; the missing-data policy is `missingPoint:
preserve_gap`, `missingCategory: union_with_gaps`, `missingSeries:
exclude_experiment`; `validation.eligibility` is
`linked_series_comparison_v1`. Blocker codes:
`reusable_chart_template_linked_regions_required`,
`reusable_chart_template_series_contract_mismatch`,
`reusable_chart_template_encoding_unsupported`,
`reusable_chart_template_workbook_recomputation`,
`reusable_chart_template_mixed_inputs_unsupported`.

#### Applying a workbook series template

`POST /api/reusable-chart-template-versions/:id/applications` accepts a
workbook template with the same body as a scalar template, but `bindings`
must be empty (`chart_template_binding_invalid`): the slot binds by data
kind. A version with a linked-region slot next to a snapshot slot is refused
with `chart_template_slot_mix_unsupported`. Resolution runs per selected
experiment:

1. Find that experiment's confirmed regions whose `dataKind` matches the
   slot; the most recently confirmed active region wins and any others are
   reported as a `chart_template_multiple_regions` warning. An experiment
   whose only matching regions live in a deleted review session is excluded
   with `chart_template_session_deleted`; one with no matching region is
   excluded with `chart_template_input_missing`.
2. Check the region's single series against the slot: orientation must equal
   `seriesContract.orientation` (`chart_template_series_shape_mismatch`), the
   unit must be in `unitContract.allowedUnits`, and the numeric scale must
   match `identityContract.numericScale` (`chart_template_unit_incompatible`).
3. Read the series once from the workbook index (cached formula results;
   `chart_template_range_too_large` above 2,500 cells,
   `chart_template_series_outside_region` when the series ranges leave the
   confirmed region). Blank cells, Excel errors, and non-numeric text become
   missing points with reasons `blank`, `excel_error`, `non_numeric`; a series
   with no numeric value at all excludes the experiment with
   `chart_template_input_missing`.

`missingDataPolicy.missingSeries` decides what an exclusion means:
`exclude_experiment` (default) keeps the application `ready` with the
experiment listed in `excludedExperiments`; `block` turns every exclusion
into a blocker. Zero usable experiments is always blocked.

The compatibility payload adds `sourceKind: "linked_region"`,
`linkedDataKind`, per-experiment `region` (region id, frozen revision id,
workbook, sheet, range), `pointCount`/`valueCount`/`missingCount`,
`missingCategories`, `excludedExperiments[{experimentId,label,code,message}]`,
`warnings`, `alignment {categories, policy}` (union of category labels in
first-seen order), `sourceSelections` (one exact region range per ready
experiment, `template_source_selection_n`), `frozenRegionRefs`, and
`linkedSeries` (the read points with cell addresses and missing reasons).
`frozenHeadRefs`, `experimentSelections`, and `executionBindings` are empty;
no snapshot or head is read or written.

The accepted PlanRevision uses `inputMode: "workbook"`, carries the
`sourceSelections` and matching `sourceRectangles`, and extends
`templateLineage` with `linkedDataKind` and `frozenRegionRefs`. The
application record stores `frozenRegionRefs` inside its compatibility JSON
(Postgres needs no new column). The queued run is `chart_template_v1` like a
scalar application; until the series renderer lands, executing it fails
closed with `chart_template_series_execution_unavailable` and the
application is marked `failed`.

## Deterministic Recipe v1

`labrat.chartRecipe.v1` is structured data interpreted by backend-owned code.
It contains no Python, JavaScript, Plotly arrays, prompt text, or provider
instructions.

The initial allowlist is deliberately narrow:

- `select_scalar` and `select_series` from declared input slots;
- `order_x` by numeric, natural-label, or accepted source order;
- `align_x` with `exact`, `union_with_gaps`, or `intersection`;
- `filter_missing` only according to the accepted missing-data policy;
- `normalize_sum` with an explicit target and declared zero-total behavior;
- `aggregate` with `sum` or `mean` over an explicitly declared dimension;
- `ratio` with explicit numerator, denominator, unit result, and zero handling;
- `unit_convert` only by a separately accepted conversion-policy id.

Every operation names its input and output roles. Runtime input discovery,
arbitrary expressions, dynamic code, interpolation, smoothing, regression, or
domain-specific scientific formulas are outside v1. Unsupported meaning
returns `chart_template_recipe_unsupported` and uses the ordinary reviewed
analysis path.

## Encoding And Multiple Experiments

Encoding declares behavior; the renderer does not infer a new comparison form
from experiment count.

Supported v1 comparison modes:

- `overlay`: one trace per experiment on shared axes;
- `grouped`: one bar per experiment within each category;
- `stacked_components`: reviewed components stack within an experiment, never
  experiments unless explicitly declared;
- `faceted`: one panel per experiment using an explicit grid policy.

Color assignment is either `selection_order` or an accepted project mapping.
When the palette is exhausted, the accepted overflow rule may add markers and
dashes. Indistinguishable reuse is blocked. The renderer never silently moves
between overlay, grouped, stacked, and faceted modes.

Shared axes are the default for cross-comparison. Independent facet axes must
be explicit and visibly disclosed.

## Missing-Data Contract

Missing is never zero.

- Missing required slot: application status `blocked`; preview execution does
  not start until the experiment is removed or the user approves a valid
  binding.
- Missing optional slot: the declared exclusion/display policy applies and is
  included in the preview summary.
- Missing scalar: `block`, `exclude_experiment`, or `show_missing`; a zero bar
  is forbidden.
- Missing series point: `preserve_gap`, `omit_point`, `exclude_experiment`, or
  `block`.
- Missing category: `union_with_gaps`, `intersection`, or `strict`.
- Interpolation and imputation are not v1 fallback behavior. A later recipe
  operation requires a separately reviewed method and version.
- If policy removes every trace or every comparable category, validation
  blocks result creation.

Preview responses enumerate affected experiments, slots, points, categories,
and exclusions. Acceptance preserves that summary and exact source lineage.

## Unit, Shape, And Staleness Rules

- Exact compatible units proceed.
- Numeric percentage slots also pin their accepted storage scale. Fraction
  inputs are deterministically displayed as percent points; scale mismatch
  blocks binding rather than relying on value magnitude or provider inference.
- Conversion occurs only through a pinned accepted conversion policy and
  preserves original and converted values, units, method version, and source
  refs.
- Incompatible units block a shared-axis comparison.
- Different X grids follow only the accepted alignment policy. Array position
  alone is never scientific alignment.
- Each application freezes the selected experiment snapshot heads. Execution
  and ChartSpec publication recheck them. Changed heads return
  `chart_template_inputs_stale` and require regeneration.
- Existing approved slot bindings are revalidated whenever a head changes.

## Responsive Geometry Policy v1

A template pins a style profile and may add bounded chart-specific overrides.
The resolver receives figure geometry, label demand, trace count, comparison
mode, and legend demand, then applies this order:

1. preferred figure size, aspect ratio, margins, and legend position;
2. preferred plot-area width and height ratios;
3. legend wrapping;
4. accepted fallback legend positions;
5. bounded margin growth up to declared maxima;
6. bounded figure growth for faceted layouts when allowed;
7. block with `chart_template_geometry_unreadable` rather than cross the
   minimum plot-area ratios or minimum font size.

Adding a third overlay trace normally changes only trace/color/legend content.
It must not shrink the plot area if the legend can wrap or move. Grouped bars
become narrower inside stable category bands. Faceted templates use their
declared grid and panel-size policy.

The AnalysisResult/ChartSpec stores resolved Plotly layout and a bounded
`resolvedGeometry` summary. The template keeps preferences; historical charts
never recalculate against a newer style or viewport.

Milestone 4 persists that summary as `labrat.resolvedChartGeometry.v1`. It
records the resolved figure dimensions, margins, actual/preferred/minimum plot
ratios, legend placement and wrapping, label decisions, optional facet grid and
panel size, and bounded trace style assignments. Template results without this
summary, summaries above the payload bound, non-finite geometry, and layouts
below their accepted minima fail result validation. Publication copies the
summary into the immutable ChartSpec so reload and export use the accepted
Plotly geometry rather than recalculating it.

## Template Application And Analysis Lineage

The user action `Preview` confirms applying one accepted template version to
the displayed experiment selections and bindings. It does not accept the
result as a chart.

The backend records the application through the existing analysis chain:

```text
deterministic AnalysisThread
  -> accepted deterministic AnalysisPlanRevision
  -> queued AnalysisRun(executionStrategy = chart_template_v1)
  -> backend deterministic recipe execution
  -> normal Plotly validation
  -> immutable AnalysisResult(awaiting_review)
  -> explicit accept-and-create-chart
  -> ChartSpec v3
```

Creating the deterministic accepted revision and queued run is idempotent and
transactional. Execution remains a separate claim/finalization operation even
when the frontend starts it immediately. Preview never creates a ChartSpec.

Template-derived ChartSpecs retain `origin: analysis_result` and add optional
lineage:

```json
{
  "templateLineage": {
    "reusableChartTemplateId": "reusable_chart_template_1",
    "reusableChartTemplateVersionId": "reusable_chart_template_version_2",
    "chartStyleProfileVersionId": "chart_style_profile_version_3",
    "executionStrategy": "chart_template_v1"
  }
}
```

Existing ChartSpecs without template lineage remain valid. Manuscript blocks,
placement-local trace visibility, detail loading, and PPTX export continue to
consume ordinary immutable ChartSpecs.

## API Surface

Viewer-readable, editor-writable project APIs:

```text
GET  /api/projects/:projectId/chart-style-profiles
POST /api/projects/:projectId/chart-style-profiles
GET  /api/chart-style-profiles/:chartStyleProfileId
POST /api/chart-style-profiles/:chartStyleProfileId/versions
POST /api/chart-style-profiles/:chartStyleProfileId/archive

GET  /api/projects/:projectId/reusable-chart-templates
POST /api/projects/:projectId/reusable-chart-templates
GET  /api/reusable-chart-templates/:reusableChartTemplateId
POST /api/reusable-chart-templates/:reusableChartTemplateId/versions
POST /api/reusable-chart-templates/:reusableChartTemplateId/archive
```

Milestone 2 implements the lifecycle routes above. Milestone 3 implements:

```text
POST /api/reusable-chart-template-versions/:templateVersionId/applications
```

Template creation accepts a name, accepted `sourceChartSpecId`, and optional
accepted style-profile version. It does not accept browser-authored recipe
operations as trusted input.

Approved-chart review may first call:

```text
GET /api/chart-specs/:chartSpecId/template-eligibility
```

This read-only preflight runs the same backend derivation used by creation and
returns either the bounded eligible contract or structured ineligibility
blockers. Failure or ineligibility disables template saving without changing
the already accepted ChartSpec.

Scalar eligibility is based on materialized accepted inputs, not an inert
planning flag. `includeSeries: true` blocks scalar-template compilation only
when the selected accepted record actually contains series data; an empty
series collection does not become a false blocker. Accepted `grouped_bar`,
`stacked_bar`, and `distribution_bar` ChartSpecs compile to the deterministic
`bar` rendering primitive, with stacking/grouping preserved by the immutable
comparison mode.

Application creation accepts selected experiment ids, explicit slot bindings,
and an `Idempotency-Key`. It returns compatibility results and, only when all
blockers are resolved, the deterministic accepted plan plus queued AnalysisRun.
The existing run execute, preview, revise, and accept-and-create-chart routes
remain the only result execution/review/publication path.

The deterministic executor accepts the scalar-selection recipes
compiled from eligible approved ChartSpecs. Other recipe operations fail with
`chart_template_recipe_unsupported` until their bounded interpreters are
implemented; they are never silently ignored. Baseline one/two/three experiment
rendering now includes deterministic selection-order style allocation,
grouped/stacked/overlay/faceted policies, adaptive bounded geometry, facet
growth, legend fallback, and long-label handling. Accepted project-mapping
style allocation remains unavailable until a reviewed mapping contract exists;
it fails closed instead of guessing.

Style extraction from a reference asset is deferred beyond the minimal API.
When implemented it creates a draft profile version and never accepts it.

## Persistence

Milestone 2 adds:

```text
chart_style_profiles
chart_style_profile_versions
reusable_chart_templates
reusable_chart_template_versions
```

Later milestones may add:

```text
reusable_chart_template_slot_bindings
reusable_chart_template_applications
```

Container rows own names, status, and current-version pointers. Version rows
hold immutable accepted payloads and content hashes. Slot bindings are
append-only reviewed decisions. Applications provide idempotency receipts and
point to the deterministic analysis artifacts; they do not duplicate Plotly or
scientific values.

Every row carries lab/project ownership and actor/timestamps. Project/list
responses remain bounded and omit large artifacts.

## Authorization And Audit

- Project viewers may list/read profiles, templates, compatibility, and
  accepted ChartSpecs.
- Editors, lab admins, and lab owners may create versions, applications, and
  accepted charts.
- Archive is editor-authorized and logical.
- Cross-project ids return not found without revealing ownership.
- Create/version/application/publication operations are audited.
- Application and publication writes require idempotency keys; conflicting key
  reuse returns `409`.

## Stable Error Codes

```text
chart_style_profile_invalid
chart_style_profile_not_accepted
reusable_chart_template_invalid
reusable_chart_template_not_eligible
chart_template_recipe_unsupported
chart_template_experiment_count_invalid
chart_template_input_missing
chart_template_input_ambiguous
chart_template_input_incompatible
chart_template_unit_incompatible
chart_template_alignment_incompatible
chart_template_palette_exhausted
chart_template_geometry_unreadable
chart_template_inputs_stale
chart_template_application_conflict
chart_template_binding_invalid
chart_template_slot_mix_unsupported
chart_template_session_deleted
chart_template_series_shape_mismatch
chart_template_series_outside_region
chart_template_range_too_large
chart_template_series_execution_unavailable
```

Warning code (never blocks): `chart_template_multiple_regions`.

## Non-Goals For v1

- No prompt replay as a template.
- No arbitrary Plotly JSON accepted from the browser.
- No automatic fuzzy scientific binding.
- No raw workbook-layout replay across experiments.
- No generated or stored executable template code.
- No silent interpolation, imputation, conversion, exclusion, or comparison
  mode change.
- No migration of historical ChartSpecs or manuscript-local chart templates.
