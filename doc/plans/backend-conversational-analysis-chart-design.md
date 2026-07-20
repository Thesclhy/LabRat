# Backend Conversational Analysis And Chart Design

Status: written review requested
Read when: designing or implementing backend model routing, reviewed calculations, DataSnapshot-backed charts, or per-placement Canvas trace selection.
Created: 2026-07-20

## Goal

Give LabRat one backend-owned conversational path that can answer project questions, plan accepted-data calculations, show the exact selected workbook evidence before execution, run user-approved Python in a LabRat-managed sandbox, validate the result, create an immutable DataSnapshot-backed ChartSpec after a second user review, and let each Manuscript Canvas placement independently choose which approved experiment traces are visible.

The target flow is:

```text
user request
  -> backend intent router
  -> read-only answer OR AnalysisThread
  -> model inspects accepted fields and experiment scope through tools
  -> model drafts exact data selection + explanation + frozen Python
  -> backend resolves source rectangles without running the calculation
  -> user reviews Excel red boxes and the plan in the LabRat conversation
  -> revise until accepted
  -> LabRat sandbox executes the accepted code against frozen inputs
  -> backend validates values, shape, units, lineage, and invariants
  -> user reviews result table + warnings + chart preview
  -> revise until accepted
  -> accept result and create ChartSpec atomically
  -> insert ChartSpec into Manuscript
  -> each Canvas placement independently shows or hides approved traces
```

## Confirmed Product Decisions

1. Browser-entered provider API keys and direct browser-to-provider calls are removed. Model access is backend-only.
2. Ordinary questions such as project purpose or explicitly scoped factual lookups return direct answers when accepted evidence is sufficient. Ambiguous field selection or novel calculations enter an AnalysisThread instead of defaulting to an `Open Experiment Browser` action.
3. The model may choose accepted fields, experiment scope, source regions, calculation method, and chart encoding, but it does not copy authoritative scientific result arrays into its response.
4. The model drafts one machine-readable calculation manifest and one exact Python program before calculation. There is no separate "simple" and "complex" calculation product path.
5. The user reviews the selected data and planned processing before any calculation runs.
6. Plan revisions are conversational and immutable. Sending modification feedback creates a new revision; it does not execute the visible revision.
7. Accepting a plan authorizes calculation only. It does not accept the result or create a ChartSpec.
8. LabRat executes the exact accepted Python in a LabRat-managed isolated runtime, not a provider-managed code execution environment.
9. The backend validates every execution result before presenting it for result review.
10. Result feedback creates a new plan revision and re-enters the pre-execution review loop.
11. The result acceptance action is explicitly labeled `Accept result and create chart`. It atomically accepts the result JSON and creates the ChartSpec.
12. A ChartSpec contains the complete accepted experiment/trace domain produced by the result, even when only a subset is initially visible.
13. The ChartSpec default visible set is the set shown during result review.
14. Each Manuscript chart placement stores its own `chartView`. Showing or hiding a trace is a visual edit and never recomputes data or mutates the ChartSpec.
15. The same ChartSpec may be inserted more than once with different visible experiment sets.
16. LangChain and LangGraph are not required for the first-party workflow. LabRat owns an explicit persisted state machine and a framework-independent backend tool registry.
17. MCP is an adapter over the same backend tool registry, not the scientific source of truth or the calculation engine. The first-party web app does not need an MCP round trip.
18. Existing source-backed ChartSpecs remain valid and separate. The new path converges with them only at validated ChartSpec rendering and Manuscript placement.

## Non-Goals

- Reintroducing DatasetCommit, generic imports, generic mapping sets, analysis views, or observation-series storage.
- Allowing the model to publish a DataSnapshot, AnalysisResult, ChartSpec, or Manuscript placement without explicit confirmation.
- Treating a successful Python process as proof that the scientific interpretation is correct.
- Sending complete workbooks, unrelated project history, or all project data to the model context.
- Using arbitrary model-generated Plotly JSON as the authoritative scientific artifact.
- Making Canvas visibility choices global across every placement of a ChartSpec.
- Adding historical migration for retired local project shapes.

## Existing Foundations To Reuse

The implementation should extend, not replace, these foundations:

- accepted WorkbookUnderstanding field semantics, units, experiment axes, and exact source refs
- accepted DataSnapshot records selected through ExperimentSnapshotHeads
- Experiment Browser field catalog and lazy experiment detail
- SourceDocument bounded range reads and Excel-like red-box review
- AgentRun status, visible tool steps, action confirmation, provider metadata, and audit conventions
- source-backed ChartSpec validation and rendering
- Manuscript chart blocks containing `chartSpecId`, `chartSpecSnapshot`, `chartView`, and editable chart layout
- existing Canvas experiment selection through `selectedExperimentIds` and `excludedExperimentIds`

The current Canvas already proves that placement-local experiment filtering works for source-backed series. The new chart path must provide a stable trace catalog from accepted AnalysisResults and generalize the view key from experiment-only selection to stable trace selection where necessary.

## Architecture

```text
React/Vite frontend
  -> authenticated Node API
      -> IntentRouter
      -> BackendModelProvider
      -> AnalysisToolRegistry
      -> AnalysisThreadService
      -> SelectionResolver
      -> AnalysisPlanValidator
      -> LabRatPythonExecutor
      -> AnalysisResultValidator
      -> AnalysisArtifactPublisher
      -> ChartSpecValidator
      -> ManuscriptStore
      -> Postgres / in-memory test store

AnalysisToolRegistry
  -> direct provider tool adapter for first-party AgentRuns
  -> optional MCP server adapter for external hosts
```

The backend tool registry owns tool schemas and authorization. Direct provider tools and an MCP adapter must call the same service functions so transport choices cannot create competing behavior.

## Intent Routing

The backend intent router replaces the current unrecognized-message fallback to `open_experiment_browser`.

Supported top-level intents:

```text
project_purpose
project_overview
experiment_overview
experiment_compare
experiment_lookup
open_or_filter_browser
upload_workbook
create_analysis_chart
manuscript_action
clarification
```

Routing rules:

1. Explicit upload, navigation, and mutation commands retain deterministic priority.
2. A backend model router may classify ambiguous natural language into the bounded intent schema.
3. Read-only project/data questions return a direct answer with no action card only when the requested scope and fields are explicit or can be resolved without a novel calculation.
4. Ambiguous data selection, derived calculations, statistical analysis, or chart requests create or continue an AnalysisThread.
5. Missing project purpose, missing accepted data, unresolved fields, or ambiguous experiment scope returns a clarification or evidence limitation, never a substitute action.
6. The router records provider/model/latency/usage metadata but no hidden reasoning.

## Backend Model Boundary

The frontend sends project-scoped messages to the backend and never receives provider credentials.

The backend provider adapter supplies:

- structured intent classification
- structured tool calls
- AnalysisPlanRevision drafting
- concise explanations of selections, calculations, warnings, and validated results
- follow-up answers grounded in accepted artifacts

The model does not:

- read database tables directly
- receive authorization tokens
- execute code before plan acceptance
- supply accepted result arrays
- persist scientific artifacts
- decide whether validation failures may be ignored

The existing frontend Anthropic key/model settings and direct `fetch` call are removed when this workflow is implemented. Provider configuration comes from backend environment and deployment secrets.

## Analysis Tools

The first-party backend exposes a small tool registry:

### `get_project_analysis_context`

Returns the project profile, accepted artifact summaries, available experiment count, and current AnalysisThread summaries.

### `list_analysis_fields`

Returns the stable unit-aware field catalog derived from accepted active DataSnapshot heads:

```json
{
  "fieldKey": "selectivity_liquid",
  "displayName": "Liquid selectivity",
  "valueType": "number",
  "unit": "percent",
  "role": "outcome",
  "coverage": {
    "available": 58,
    "totalExperiments": 60
  }
}
```

### `resolve_experiment_scope`

Resolves explicit ids, Browser selection, saved Browser filters, or semantic predicates into stable ExperimentIdentity ids and active snapshot record refs.

### `preview_analysis_selection`

Resolves fields and experiment scope into a bounded selection artifact without executing the calculation. It returns:

- `selectionId`
- exact active DataSnapshot/record dependencies
- selected field definitions and units
- selected record count and missing-value coverage
- representative rows plus a paginated full review endpoint
- source rectangles grouped by SourceDocument and sheet
- warnings, ambiguity, and stale-state metadata
- canonical selection/dependency hashes

### `inspect_analysis_selection`

Returns bounded rows, series inventories, summary statistics, or source refs for an existing selection handle. Large point arrays remain backend-owned and are read in bounded pages.

### `validate_analysis_plan`

Performs schema, authorization, field, unit, input, Python syntax, import-policy, and output-contract validation without executing the program.

The model may call planning tools repeatedly. It cannot call the Python executor directly. Execution requires an accepted plan revision id enforced by backend authorization and workflow state.

## AnalysisThread

An AnalysisThread is the durable conversational container for one analysis goal and its future follow-ups.

```json
{
  "schemaVersion": "labrat.analysisThread.v1",
  "id": "analysis_thread_123",
  "projectId": "project_1",
  "status": "planning",
  "originalRequest": "Normalize the three selectivity components and compare all experiments.",
  "messages": [],
  "planRevisionIds": [],
  "analysisRunIds": [],
  "acceptedAnalysisResultIds": [],
  "chartSpecIds": [],
  "createdBy": "user_1",
  "createdAt": "2026-07-20T00:00:00.000Z",
  "updatedAt": "2026-07-20T00:00:00.000Z"
}
```

Allowed status progression:

```text
planning
  -> awaiting_plan_review
  -> executing
  -> awaiting_result_review
  -> completed

awaiting_plan_review -> planning       (user modification)
awaiting_result_review -> planning     (user modification)
executing -> execution_failed
any open state -> cancelled
```

Historical plan revisions and runs remain immutable and linked even after a later revision succeeds.

## AnalysisPlanRevision

The model drafts a complete reviewable revision:

```json
{
  "schemaVersion": "labrat.analysisPlanRevision.v1",
  "id": "analysis_plan_revision_2",
  "analysisThreadId": "analysis_thread_123",
  "revision": 2,
  "status": "awaiting_review",
  "requestSummary": "Normalize Solid, Liquid, and Gas selectivity to 100 percent.",
  "selection": {
    "selectionId": "selection_123",
    "experimentIds": ["experiment_1"],
    "fieldKeys": [
      "selectivity_solid",
      "selectivity_liquid",
      "selectivity_gas"
    ],
    "dependencyHash": "sha256:...",
    "selectionHash": "sha256:..."
  },
  "processingSummary": [
    "Replace missing Liquid values with zero.",
    "Require Solid and Gas to be present.",
    "Add the three components for each experiment.",
    "Exclude zero-total records.",
    "Scale retained components proportionally to sum to 100 percent."
  ],
  "calculationManifest": {
    "inputs": [
      {
        "fieldKey": "selectivity_solid",
        "unit": "percent"
      },
      {
        "fieldKey": "selectivity_liquid",
        "unit": "percent"
      },
      {
        "fieldKey": "selectivity_gas",
        "unit": "percent"
      }
    ],
    "derivedFields": [
      {
        "fieldKey": "selectivity_total",
        "inputFieldKeys": [
          "selectivity_solid",
          "selectivity_liquid",
          "selectivity_gas"
        ],
        "expression": "solid + liquid + gas",
        "outputUnit": "percent"
      }
    ],
    "invariants": [
      {
        "type": "row_sum",
        "fieldKeys": [
          "selectivity_solid_normalized",
          "selectivity_liquid_normalized",
          "selectivity_gas_normalized"
        ],
        "target": 100,
        "absoluteTolerance": 0.000001
      }
    ]
  },
  "pythonProgram": {
    "runtime": "labrat-python-v1",
    "entrypoint": "analyze",
    "source": "def analyze(tables, labrat):\n    ...",
    "sourceHash": "sha256:..."
  },
  "expectedOutput": {
    "shape": "experiment_traces",
    "chartType": "stacked_bar",
    "xField": "experiment_label",
    "yFields": [
      "selectivity_solid_normalized",
      "selectivity_liquid_normalized",
      "selectivity_gas_normalized"
    ]
  },
  "warnings": [],
  "createdAt": "2026-07-20T00:00:00.000Z"
}
```

The natural-language summary and the exact program are two views of the same revision. The user sees the summary by default and may expand the exact Python. Accepting the plan freezes:

- plan revision id and revision number
- resolved experiment ids and active snapshot record refs
- selection and dependency hashes
- field definitions and units
- source rectangles
- exact Python source and source hash
- machine-readable calculation manifest, units, and declared invariants
- runtime version
- missing-value and exclusion behavior
- expected output schema and chart encoding

The backend must execute this exact source. It must not ask the model to rewrite code after acceptance.

## Selection And Excel Red-Box Review

The approved plan-review layout is:

```text
left: Excel-like source evidence
right: normal Ask LabRat conversation rail
bottom of conversation: Accept plan | gray modification input + send
```

Selection preview behavior:

- Every selected value resolves to accepted DataSnapshot records and exact source refs.
- Source cells are compressed into stable review rectangles where possible.
- Identity cells and calculation inputs may be separate labeled red boxes.
- Multiple workbooks/sheets appear in a source selector. Clicking a selection reference opens the corresponding workbook and sheet with its red boxes.
- Non-contiguous evidence remains multiple rectangles; it is never represented as one misleading bounding box.
- Large selections show bounded visible windows, counts, warnings, and lazy navigation without silently truncating the accepted selection.
- Red-box labels match the plan message, for example `A - Experiment identity` and `B - Calculation inputs`.
- The plan remains `Not executed` until accepted.

The conversation composer has two horizontal areas:

1. `Accept plan` accepts the exact visible revision.
2. A gray modification input sends feedback and creates a later revision.

Sending feedback does not execute, mutate, or silently patch the visible revision.

## LabRat-Managed Python Executor

All accepted calculations use one execution path. The distinction between simple and complex calculations is the submitted Python, not a separate product workflow.

### Input package

The executor receives a read-only package built from the accepted selection:

```text
tables.records
  __experiment_id
  __snapshot_id
  __record_index
  selected scalar fields

tables.series_points
  __experiment_id
  __snapshot_id
  __record_index
  __series_id
  __point_index
  x
  y

lineage sidecar
  source-ref ids for every input value and point
```

The model receives schema, summaries, samples, and handles while planning. Full execution inputs are transferred directly from backend storage to the executor, not copied through model text.

### Program contract

The accepted program exports:

```python
def analyze(tables, labrat):
    return {
        "result_table": result_table,
        "traces": traces,
        "lineage": lineage,
        "summary": summary,
    }
```

Row-preserving outputs must retain `__experiment_id`, `__snapshot_id`, and `__record_index`. Aggregated outputs must provide `__source_record_ids`. A trace must have a stable `traceId`, experiment/series identity where applicable, finite x/y arrays, and source record lineage.

### Runtime policy

`labrat-python-v1` is immutable and versioned. Its initial library allowlist is:

- Python standard library modules required for numeric/data work
- pandas
- numpy
- scipy

The runtime:

- has no network access
- has no provider credentials
- mounts input read-only
- exposes only an ephemeral bounded output directory
- blocks subprocess creation and unapproved imports
- runs as a non-privileged isolated worker
- enforces a default 60-second wall-clock limit
- enforces one CPU and 1 GiB memory
- caps input at 100,000 scalar records or 1,000,000 series points per run
- caps serialized output at 100 MiB
- records runtime image/version, source hash, input hash, start/end time, resource usage, stdout/stderr summary, and exit status

Production uses an isolated container or equivalent hardened worker. Development and tests may use a local adapter only when it enforces the same callable contract and clearly identifies itself as non-production.

## AnalysisRun And Result Validation

An accepted plan creates one immutable AnalysisRun:

```json
{
  "schemaVersion": "labrat.analysisRun.v1",
  "id": "analysis_run_1",
  "analysisThreadId": "analysis_thread_123",
  "acceptedPlanRevisionId": "analysis_plan_revision_2",
  "status": "awaiting_result_review",
  "inputHash": "sha256:...",
  "programHash": "sha256:...",
  "runtimeVersion": "labrat-python-v1",
  "resultPreviewHash": "sha256:...",
  "warnings": [],
  "validation": {},
  "createdAt": "2026-07-20T00:00:00.000Z"
}
```

Backend validation is independent of the model and checks:

- project ownership and accepted-plan state
- unchanged active snapshot dependencies
- exact input and program hashes
- runtime policy compliance and successful exit
- declared output schema and bounded size
- finite numeric values
- stable unique output and trace ids
- experiment/series identity preservation
- source-record lineage coverage
- compatible units for the calculations declared in the accepted manifest
- execution-reported missing-value, imputation, and exclusion behavior against the accepted manifest and output counts
- expected record/trace counts
- chart x/y type and length compatibility
- declared invariants, such as normalized components summing to 100 within tolerance
- canonical result-preview hash

A successful process with failed scientific/schema validation remains blocked and cannot create a ChartSpec.

## Result Review

After backend validation, the frontend reuses the split review workspace:

- `Source` tab: original workbooks and accepted red boxes
- `Result` tab: original and derived columns, excluded records, warnings, and lineage links
- `Chart` tab: deterministic preview of the complete accepted trace domain and current default-visible set
- right conversation: execution summary, validation results, assumptions, warnings, and revision history
- composer: `Accept result and create chart` plus the gray modification input

The result review must show:

- input and output record counts
- trace count and default-visible count
- excluded records and exact reasons
- missing-value policy actually applied
- validation invariants and tolerances
- representative original/derived value comparisons
- code/runtime/input/result hashes
- links back to source cells

Modification feedback creates a new AnalysisPlanRevision using the original request, accepted and rejected revisions, result summary, validation output, and user feedback. It never edits the prior run in place.

## Atomic Result Acceptance And ChartSpec Creation

`Accept result and create chart` is one idempotent editor-authorized transaction:

1. Recheck result-review hash and active input dependencies.
2. Mark the reviewed AnalysisResult accepted.
3. Persist the immutable accepted result JSON and content hash.
4. Create one validated DataSnapshot-backed ChartSpec.
5. Link the AnalysisThread, accepted plan, run, result, and ChartSpec.
6. Record actor, timestamp, idempotency receipt, and audit event.

If any step fails, no accepted AnalysisResult or ChartSpec is committed.

The accepted result is append-only. Later corrections create a new plan, run, result, and ChartSpec rather than overwriting history.

## DataSnapshot-Backed ChartSpec

The new ChartSpec origin is explicit:

```json
{
  "schemaVersion": "labrat.chartSpec.v2",
  "origin": "analysis_result",
  "analysisThreadId": "analysis_thread_123",
  "analysisPlanRevisionId": "analysis_plan_revision_2",
  "analysisRunId": "analysis_run_1",
  "analysisResultId": "analysis_result_1",
  "analysisResultHash": "sha256:...",
  "inputSnapshotRefs": [],
  "chartType": "scatter",
  "title": "Reaction time vs reaction rate",
  "x": {
    "fieldId": "reaction_time",
    "unit": "min"
  },
  "y": {
    "fieldId": "reaction_rate",
    "unit": "mol/g/h"
  },
  "traceCatalog": [
    {
      "traceId": "experiment_1:reaction_rate",
      "experimentId": "experiment_1",
      "experimentLabel": "Exp-001",
      "seriesId": "reaction_rate",
      "sourceRecordIds": [],
      "sourceRefs": []
    }
  ],
  "defaultChartView": {
    "visibleTraceIds": [
      "experiment_1:reaction_rate"
    ]
  },
  "analysisResultSnapshot": {
    "traces": []
  },
  "warnings": []
}
```

Rules:

- `analysisResultSnapshot` is immutable accepted plotted data, not model output.
- `traceCatalog` contains every accepted available trace, including initially hidden traces.
- list responses omit large arrays; detail/manuscript insertion loads the immutable snapshot lazily.
- exact source refs and accepted input snapshot dependencies remain available for every trace.
- source-backed `origin: source_extract` ChartSpecs continue to render through their existing immutable source snapshots.
- both origins converge on the internal renderer only after origin-specific validation.

## Canvas Trace Visibility

ChartSpec data domain and Canvas visibility are separate:

```text
ChartSpec
  = immutable accepted analysis data + every available trace

Manuscript chart block
  = ChartSpec snapshot + placement-local chartView + editable layout
```

Each chart block stores:

```json
{
  "chartSpecId": "chart_spec_123",
  "chartSpecSnapshot": {},
  "chartView": {
    "visibleTraceIds": [
      "experiment_1:reaction_rate",
      "experiment_5:reaction_rate"
    ]
  },
  "chartLayout": {}
}
```

Canvas behavior:

- insertion inherits `ChartSpec.defaultChartView`
- if result review showed all experiments, all are initially visible
- the Inspector lists every available trace with search, count, checkboxes, `Select all`, and `Clear`
- changing a checkbox updates the plot immediately
- one ChartSpec may have multiple placements with different visibility
- undo/redo, save/reload, chart context, and PPTX export preserve placement-local visibility
- hidden traces remain in the stored ChartSpec snapshot and can be restored
- visual-only visibility changes do not call the model, backend executor, or ChartSpec APIs
- requesting an experiment, field, or calculation absent from the ChartSpec starts a new AnalysisPlan loop

For compatibility, existing source-backed blocks using `selectedExperimentIds` and `excludedExperimentIds` receive bounded normalization into the trace-aware view model. This is current persisted Manuscript-shape normalization, not a retired dataset migration.

## Follow-Up Context

Future user messages can continue an AnalysisThread:

```text
"Use the same normalization, but only catalyst A and B."
"Keep the current visible experiments and fit a line."
"Restore all experiments and change Exp-005 to a dashed line."
```

Backend context includes:

- original request and compact conversation messages
- plan revision summaries and ids
- accepted plan source/hash
- run/result ids, hashes, validation, warnings, and summaries
- ChartSpec id and complete available trace catalog
- current selected Canvas block id and visible trace ids when the request originates in Canvas
- artifact handles that tools can inspect on demand

Full result arrays are not repeated in the prompt. The model calls bounded tools to inspect required artifacts.

## API Direction

The implementation contract uses these operations:

```text
POST /api/projects/:projectId/analysis-threads
GET  /api/projects/:projectId/analysis-threads
GET  /api/analysis-threads/:analysisThreadId

POST /api/analysis-threads/:analysisThreadId/plan-revisions
GET  /api/analysis-plan-revisions/:planRevisionId/selection
POST /api/analysis-plan-revisions/:planRevisionId/accept

GET  /api/analysis-runs/:analysisRunId
GET  /api/analysis-runs/:analysisRunId/result-preview
POST /api/analysis-runs/:analysisRunId/revise
POST /api/analysis-runs/:analysisRunId/accept-and-create-chart
```

Contract requirements:

- all reads/writes are project authorized
- mutation endpoints require editor role
- plan acceptance and result acceptance require idempotency
- list/state responses stay bounded
- source grids and result rows are lazy/paginated
- stale dependency/result hashes return explicit review errors before writes
- AgentRuns link to AnalysisThread and visible workflow artifacts

## MCP And Orchestration

The AnalysisToolRegistry is framework-independent business logic.

First-party flow:

```text
backend model provider tool call
  -> AnalysisToolRegistry
  -> backend service/store
```

Optional external flow:

```text
MCP host
  -> LabRat MCP adapter
  -> same AnalysisToolRegistry
  -> same backend service/store
```

The MCP adapter may expose read/plan tools and confirmation-aware execution/status tools, but it cannot bypass LabRat authorization, accepted-plan state, idempotency, sandbox policy, or result review.

LangChain/LangGraph are not introduced initially because the workflow state already has explicit domain entities and database transitions. A later implementation may adopt another runtime only if it preserves these contracts and removes demonstrated orchestration complexity rather than duplicating persistence.

## Error Handling

### Planning errors

- unresolved field or experiment alias: clarification, no plan acceptance
- incompatible units: visible blocker unless the plan contains an explicit reviewed conversion
- insufficient field coverage: warning plus explicit missing-value policy
- source refs unavailable: blocker for accepted scientific chart output
- oversized selection: bounded selection summary with explicit narrowing request
- invalid/disallowed Python: plan validation error before user acceptance

### Acceptance and staleness errors

- changed active snapshot head or dependency hash: `analysis_plan_stale`
- changed plan revision after review: `analysis_plan_revision_mismatch`
- reused idempotency key with different request: conflict
- unauthorized project/lab access: not found or forbidden according to existing conventions

### Execution errors

- timeout, memory limit, import violation, filesystem/network attempt, or non-zero exit: failed immutable AnalysisRun
- malformed or oversized output: blocked result
- missing lineage: blocked result
- mismatched record/trace identity: blocked result
- NaN/infinity or invalid x/y lengths: blocked result
- failed declared invariant: visible validation failure, no ChartSpec

The frontend presents errors in the same AnalysisThread and preserves the last accepted plan and failed run for review. Retrying execution without changing the plan creates a new AnalysisRun with the same plan/program/input hashes.

## Persistence And Audit

New persistence is JSONB-first with project/lab ownership and indexed relational links:

```text
analysis_threads
analysis_plan_revisions
analysis_runs
analysis_results
```

Store parity is required for memory and Postgres implementations.

Audit events cover:

- analysis thread creation/cancellation
- plan revision creation
- plan acceptance
- run start/completion/failure
- result revision request
- result acceptance and ChartSpec creation
- administrative sandbox/runtime configuration changes

AgentRun stores visible tool names, summarized observations, linked artifact ids, warnings, errors, provider/model/usage/latency metadata, and confirmation actions. It never stores hidden chain-of-thought.

## Security And Privacy

- Provider credentials exist only on the backend.
- Model context contains bounded project-owned summaries and tool results.
- Full selected data flows directly from LabRat storage to the LabRat executor.
- The executor has no network or project credentials.
- Input mounts are read-only and output is bounded.
- Project/lab authorization is rechecked at every tool and artifact endpoint.
- Executable source is hashed, scanned, stored, and linked to the accepted plan.
- Sandbox images and allowed libraries are versioned and auditable.
- Logs redact scientific values by default and retain bounded diagnostics.

## Testing Strategy

### Unit tests

- intent router precedence and direct read-only answers
- provider structured output validation and deterministic fallback
- selection resolution across active snapshot heads
- field/unit/coverage validation
- source-ref to red-box rectangle compression
- plan revision validation and hashing
- Python import/syntax/policy validation
- result schema, lineage, unit, finite-value, and invariant validation
- ChartSpec trace catalog and default view validation
- Canvas `chartView` normalization and renderer filtering

### Sandbox tests

- exact accepted source is executed
- input is read-only
- network is unavailable
- unauthorized files and subprocesses are blocked
- CPU, memory, time, row, point, and output limits are enforced
- runtime version and hashes are reproducible
- row-preserving and aggregate lineage contracts are enforced

### Backend integration tests

- ordinary project question returns a direct answer with no Browser action
- plan tools use accepted active snapshot evidence only
- plan feedback creates immutable revisions
- plan accept detects stale dependencies and is idempotent
- accepted plan creates a run without creating a ChartSpec
- validation failure blocks result acceptance
- result modification creates a later plan revision
- `accept-and-create-chart` is atomic and idempotent
- cross-project access is rejected
- memory/Postgres store parity

### Frontend tests

- Excel source preview shows all resolved labeled red boxes
- clicking a plan selection reference switches workbook/sheet/range
- right conversation rail renders revision history
- split composer accepts the visible plan or sends modification feedback
- no calculation starts before plan acceptance
- result tabs show source, table, chart, exclusions, warnings, and validation
- result acceptance uses the explicit combined action
- Canvas experiment/trace checkboxes update only the selected placement
- duplicate placements of one ChartSpec retain independent visibility
- undo/redo, save/reload, selected chart context, and PPTX export use visible traces

### End-to-end golden workflow

```text
accepted workbook semantics
  -> accepted DataSnapshot/heads
  -> natural-language analysis request
  -> Excel red-box plan review
  -> user modification
  -> accepted frozen plan
  -> sandbox execution
  -> backend validation
  -> result review
  -> accept result and create ChartSpec
  -> insert into Manuscript
  -> hide/show experiments
  -> reload
  -> export PPTX
```

Manual QA must include large workbooks, multiple source documents, non-contiguous red boxes, missing values, incompatible units, failed execution, stale inputs, many experiment traces, narrow desktop width, and Canvas pointer/keyboard editing.

## Delivery Slices

The implementation plan should split this design into coherent milestones:

1. Backend provider migration, intent router, direct read-only answers, and frontend provider-key removal.
2. AnalysisThread, planning tools, immutable plan revisions, selection preview, Excel red-box/conversation review, and plan acceptance.
3. LabRat Python runtime, AnalysisRun/result validation, result review, and revision loop.
4. Atomic AnalysisResult/ChartSpec publication and DataSnapshot-backed rendering.
5. Trace-aware Canvas placement selection, persistence, context, export, and compatibility normalization.
6. Optional MCP adapter over the proven AnalysisToolRegistry.

Each slice must update the active API, database, canonical-data, architecture, and AI-boundary contracts in the same reviewed change. The current contracts correctly mark DataSnapshot-backed charts unsupported; implementation must intentionally replace that restriction rather than work around it.

## Residual Risks

- A production-grade arbitrary Python sandbox is the largest security and operations risk.
- Automatic per-value lineage through arbitrary transformations is not generally inferable; the output contract must reject results that do not declare sufficient source-record lineage.
- Cross-workbook selections can produce many source rectangles; the frontend must group and page them without implying contiguous evidence.
- Large trace domains need bounded list responses, lazy detail, and Canvas rendering limits without dropping accepted traces.
- Model-selected fields and correct Python syntax do not prove scientific appropriateness; both human review stages remain mandatory.
- Result and Canvas context can grow over time; artifact handles and compact summaries must replace repeated full arrays.
