# Current Development Plan

Status: reference
Read when: implementing the long-form Agent-first evidence workflow beyond the short active plan.
Last reviewed: 2026-06-25


This is the active execution plan for LabRat Blank. Historical checkpoint detail belongs in `doc/PROGRESS.md`; do not turn this file into a running log.

## Current Focus

LabRat is moving from an import-and-chart tool toward a conversational, source-backed research workflow:

```text
Upload workbook
  -> SourceDocument / deterministic workbook index
  -> WorkbookReviewSession
  -> LLM-drafted + backend-validated WorkbookUnderstanding
  -> user confirms/corrects through chat + red boxes
  -> accepted WorkbookUnderstanding
  -> later DataPlan / DataSnapshot
  -> ChartSpec
  -> FigurePackage
  -> ManuscriptPlacement
```

The product goal is:

> Users upload messy experimental Excel files, refine LabRat's understanding through natural language and editable red boxes, then generate reviewable source-backed charts and insert approved figures into Manuscript without losing provenance or version history.

This plan supersedes the earlier "Agent-first evidence workflow" execution plan. The implemented Agent-first objects remain part of the foundation: `SourceDocument`, `SourceRegion`, `SourceExtractProposal`, `ObservationSeries`, `AnalysisView`, `AgentRun`, and ChartSpec v1.4 are still valuable. The next work adds the missing layers around them:

- readable workbook understanding
- conversational natural-language patching
- explicit DataPlan and DataSnapshot objects
- cross-compare templates that resolve against current evidence
- FigurePackage publishing
- ManuscriptPlacement versioning and update prompts
- dependency-aware stale tracking

For detailed source-workspace rationale, also read `doc/plans/source-understanding-long-term-plan.md`. For API/schema/data vocabulary work, update `doc/contracts/saas-api-contract-v0.md`, `doc/contracts/saas-database-schema-v0.md`, `doc/contracts/canonical-data-dictionary.md`, and `doc/arch/ai-boundaries.md` in the same implementation milestone.

## Loop Engineer Operating Model

Every non-trivial milestone must follow this loop:

```text
read docs
  -> update doc/current-milestone.md
  -> use doc/task-checklist.md
  -> implement one coherent milestone
  -> run targeted verification
  -> update doc/PROGRESS.md
  -> re-read doc/plan.md and touched contracts
  -> continue or stop
```

Rules:

- Start with `npm run codex:preflight`.
- Read `doc/plan.md` before deciding what to build.
- Read `doc/current-milestone.md` before continuing an active milestone.
- Read matching contracts before touching routes, schemas, persistence, import data, ChartSpec, Manuscript, or AI behavior.
- Keep each milestone small enough to verify.
- Prefer additive migrations and compatibility over rewrites.
- Update docs in the same milestone when persisted shapes or API contracts change.
- Stop and report when code and docs disagree.
- Do not commit real private workbook data or generated artifacts.

Verification levels:

```text
doc-only change
  -> npm run codex:preflight
  -> git diff --check

frontend-only behavior
  -> targeted npm test
  -> npm run build

backend/import/chart behavior
  -> targeted node --test files
  -> npm --prefix backend test
  -> npm test when frontend behavior depends on it
  -> npm run build

schema/server workflow
  -> backend route tests
  -> optional Postgres tests when LABRAT_TEST_DATABASE_URL is set
  -> docker compose config
  -> manual Docker smoke when feasible
```

## Current Implemented Foundation

Already implemented or partially implemented:

- Docker Compose local stack with Postgres, backend, and frontend.
- Auth, labs, projects, server project state, project profile, file objects, import runs, dataset commits, mapping sets, chart proposal sets, chart specs, manuscripts, and audit events.
- Generic Excel scan/source indexing with grouped headers, source refs, warnings, and confidence.
- Legacy normalize/apply and supplemental workbook flows have been removed from the active product path; their lessons now inform WorkbookUnderstanding and future DataPlan work.
- Reaction-rate observation-series support remains available as a compatibility/foundation layer for compare charts.
- `ObservationSeries` registry for reaction-rate time-series comparison.
- `AnalysisView` support for `series_compare`.
- ChartSpec v1.4 `seriesScope` rendering with stable per-series colors.
- Source Document Index for uploaded Excel workbook metadata, regions, bounded query, and bounded range reads.
- Source Extract Proposals for generic ranges and C-number/component distributions with cell-level provenance.
- Evidence-aware chart interpretation for explicit Excel ranges such as `P31:BA32`.
- Source-range cross-compare support for component-distribution series.
- Controlled deterministic `AgentRun` foundation with visible trace steps and confirmable actions.
- Chat action card path for ChartSpec creation and an insert-into-Manuscript modal request.
- Manuscript insertion from durable ChartSpecs, including selected experiment ids for compatible charts.

Important partial pieces:

- Import review is still hard for users to understand; it lacks a conversational "modify the import understanding" loop.
- Source extracts are reviewable, but they are not a general DataPlan/DataSnapshot layer.
- Cross-compare templates work for implemented cases, but the template/data snapshot/update semantics are not explicit enough.
- ChartSpecs are insertable, but final manuscript figures are not yet represented as immutable FigurePackages.
- Stale behavior is still too commit-centric; it should be based on whether the used evidence was replaced, deleted, or reinterpreted.
- Frontend review surfaces need clearer separation between data review, visual review, and manuscript placement.

## Architecture Principles

### 1. Raw Files Are Immutable Evidence

Uploaded workbooks are `FileObject`s. LabRat can index, understand, extract from, and cite them, but it must not edit them in place. Corrected files are new file versions.

### 2. Progressive Understanding Beats Full Upload-Time Normalization

Do not require every Excel workbook to become a perfect relational table at upload time. Upload should create a source index and reviewable summaries. User-confirmed facts should accumulate in `WorkbookUnderstanding`.

### 3. AI Produces Intent And Patches, Not Scientific Values

AI may parse a user message, rank evidence, explain ambiguity, and propose structured patches. It must not invent rows, y arrays, formulas, source cells, or Plotly JSON. Deterministic backend services read, validate, transform, snapshot, and render data.

### 4. Data Review, Visual Review, And Placement Are Different

Changing source range, experiment scope, fields, filters, units, or statistics requires data review. Changing colors, labels, legend, or line style requires visual/chart review. Moving or resizing a figure in Manuscript changes placement only.

### 5. Published Figures Are Versioned

Manuscript should ultimately place `FigurePackage` versions, not mutable draft charts. Users can edit a figure by creating a new draft/spec/package version, then explicitly replace a placement.

### 6. Stale Means Dependency Changed

A chart should not disappear merely because a newer dataset commit exists. It becomes stale when the actual evidence it depends on was replaced, deleted, reinterpreted, or made incompatible.

### 7. Review Boundaries Stay Visible

Source extracts, import understanding patches, DataPlans, chart proposals, ChartSpecs, FigurePackages, and manuscript placements must remain inspectable and auditable.

## Target Object Chain

```text
FileObject
  -> SourceDocument / WorkbookIndex
  -> SourceRegion / SourceRange
  -> WorkbookReviewSession
  -> WorkbookUnderstanding
  -> optional SourceExtractProposal(s) or DatasetCommit
  -> DataPlan
  -> DataSnapshot
  -> ChartSpec
  -> FigurePackage
  -> ManuscriptPlacement
```

Existing objects align as follows:

- `SourceDocument` and `SourceRegion` are the current backend foundation for `WorkbookIndex`.
- `WorkbookReviewSession` is the active review workspace for uploaded workbook understanding.
- `WorkbookUnderstanding` is the accepted semantic memory for a workbook or selected regions.
- `SourceExtractProposal` is the current review object for extracting structured data from workbook regions when a chart/table/data action needs concrete rows. It is not the default object created for every uploaded workbook.
- `ObservationSeries` is the current comparable series layer for supplemental observation data.
- `AnalysisView` is the current reviewable analysis intent layer for series compare.
- `ChartProposalSet` remains the chart review queue.
- `ChartSpec` remains the editable chart definition and near-term Manuscript insertion target.
- `AgentRun` remains the visible workflow trace and action-card container.

New or clarified objects:

## Workbook Understanding First Data Model

All uploaded Excel workbooks should first become deterministic source evidence plus reviewed understanding. A workbook confirmation records what the workbook or selected red-box regions mean; it does not by itself create normalized data or chart-ready rows.

```text
Upload workbook
  -> SourceDocument / SourceRegion / cell index
  -> WorkbookReviewSession
  -> red boxes + user natural-language corrections
  -> backend-validated WorkbookUnderstanding draft
  -> accepted WorkbookUnderstanding
  -> later one of:
       DataPlan/DataSnapshot for chart/table data
       SourceExtractProposal for bounded local extraction review
       optional DatasetCommit promotion for reusable project data
```

This avoids treating upload as "normalize now." A workbook may contain a master-like table, a reaction-rate table, carbon-number distribution cells, notes, templates, and unrelated ranges. LabRat should first ask: "What does each useful region mean, and did the user confirm that interpretation?" Concrete extraction happens later when a chart, table, Browser promotion, or analysis needs data.

### SourceExtractProposal

A reviewable proposal to turn one source region/range into structured data.

Contains:

- source document id
- source region id or explicit sheet/range
- extract type such as `experiment_master_table`, `reaction_rate_time_series`, `component_distribution`, `generic_table`, or `unknown_table`
- preview fields/rows/series
- generated explanation
- source refs down to cell/range level where available
- warnings and confidence
- status: `proposed`, `accepted`, or `rejected`

Rules:

- One workbook can produce many source extract proposals.
- A proposal can be created from automatic detection, a red-box selection, or natural-language instruction.
- Accepting a source extract confirms that the extracted structure is usable evidence; it does not automatically mean the extract is project-wide canonical data.
- Accepted source extracts can feed a DataPlan directly or be promoted into a DatasetCommit.

### DatasetCommit

A DatasetCommit is not "the whole Excel entered the dataset." It is a project-level version that promotes one or more accepted extracts into the long-lived project data model.

Use DatasetCommit when the extract should become reusable project data for:

- Experiment Browser rows and detail pages
- future chart search and chart suggestions
- cross-compare templates
- AI project context
- semantic mappings
- project-level summaries/statistics
- dependency and stale analysis across many future outputs

Do not require DatasetCommit promotion when the extract is only being reviewed for one chart or one figure. In that case, an accepted source extract can feed a chart-local DataPlan/DataSnapshot without becoming a project-wide data asset.

Examples:

```text
MasterTable_updated.xlsx!A1:K120
  -> SourceExtractProposal type=experiment_master_table
  -> accepted
  -> promote to DatasetCommit because it defines project experiments
```

```text
Reaction_Rate_Exp33.xlsx!A1:D80
  -> SourceExtractProposal type=reaction_rate_time_series
  -> accepted
  -> promote to DatasetCommit because it should power future cross-compare charts
```

```text
Calculation_Exp33.xlsx!P31:BA32
  -> SourceExtractProposal type=component_distribution
  -> accepted
  -> either chart-local DataPlan/DataSnapshot, or later promote to DatasetCommit if reused
```

Difference in plain language:

```text
AcceptedSourceExtract = "this selected Excel region was understood and reviewed."
DatasetCommit = "these reviewed extracts are now part of the project's reusable data version."
DataSnapshot = "this chart used this fixed slice of data at this moment."
```

### WorkbookIndex

The deterministic, low-risk source structure index for an uploaded workbook.

Contains:

- workbook version/file object id/checksum
- sheet names, visibility, used ranges, formulas, hidden rows/columns, merged cells
- candidate regions and table blocks
- representative samples
- source index blob pointers
- warnings and confidence

Current implementation mostly lives in `SourceDocument`, `SourceRegion`, and `source_index_blobs`.

### WorkbookUnderstanding

Versioned, reviewable facts about how LabRat should interpret a workbook or region.

Examples:

- `Sheet1!P31:BA32` is a carbon-number distribution table.
- row 31 contains component labels.
- row 32 contains percentages.
- `calculation33` refers to `Calculation_Exp33.xlsx`.
- `reaction time` means `reaction_time_min`.
- `Ctrl` and `Control` are the same category.

States:

```text
guessed
system_inferred
user_confirmed
policy_confirmed
rejected
```

Rules:

- AI may propose facts.
- Deterministic services validate facts where possible.
- User confirmation or project policy is required before a fact becomes durable trusted understanding.
- New understanding versions do not rewrite old dataset commits or FigurePackages.

### WorkbookReviewSession

A conversational state object for refining workbook understanding before any data extraction, charting, or dataset promotion.

Purpose:

- hold the current proposed `WorkbookUnderstanding` patch stack
- show a readable workbook/source preview
- accept natural-language corrections
- generate a new preview after every correction
- produce an accepted `WorkbookUnderstanding` version only after review

User examples:

```text
Sheet1 P31:BA32 is the C-number distribution.
The third row is the header.
Ignore the LDPE TEMPLATE sheet.
calculation33 belongs to Exp33.
Use minutes, not hours.
```

### UnderstandingPatch

A structured patch generated from UI actions or natural language.

Examples:

```json
{
  "target": "workbook_understanding",
  "op": "set_region_semantic_type",
  "sourceDocumentId": "source_doc_...",
  "sheetName": "Sheet1",
  "range": "P31:BA32",
  "semanticType": "component_distribution"
}
```

```json
{
  "target": "workbook_understanding",
  "op": "set_header_row",
  "sourceDocumentId": "source_doc_...",
  "sheetName": "Sheet1",
  "range": "A1:H200",
  "headerRow": 3
}
```

Rules:

- Patches must be schema-validated and project-scoped.
- Patches produce new previews, not silent commits.
- Rejected patches remain visible in session history when useful for audit.

### DataPlan

The formal intermediate plan between natural language/evidence and actual chart data.

Contains:

- source refs: dataset commit, observation series ids, source extract proposal ids, source ranges, or workbook understanding version
- bindings: x/y/group/filter/statistical fields
- operations: select, filter, unpivot, normalize category, aggregate, sort, limit for preview
- policies: missing value handling, formula cached values, unit rules, resource limits
- warnings and review status

Rules:

- AI may draft intent; backend compiles and validates the DataPlan.
- DataPlan does not contain invented data arrays.
- High-risk statistics must be explicit.
- Changing a DataPlan is a data/analysis change.

### DataSnapshot

The deterministic execution result of a DataPlan.

Contains:

- fixed rows/series used by the chart or table
- included/excluded records
- quality report
- source refs per row/series/value where possible
- content hash
- engine version
- dependency refs

Rules:

- DataSnapshot is immutable.
- Same DataPlan plus same dependencies can be cached.
- Visual changes should not recompute DataSnapshot.

## Algorithm And Backend Responsibilities

The object chain is not one big AI step. It is a sequence of deterministic services, bounded AI interpretation, user review, and versioned backend state.

### WorkbookUnderstanding Algorithms

Backend deterministic work:

- parse workbook package and sheet metadata
- compute workbook/file checksum
- identify sheet used ranges
- build sparse non-empty cell masks
- segment candidate regions using blank row/column gaps, density changes, merged cells, named ranges, and table-like boundaries
- detect header rows, unit rows, label columns, value rows, and metadata/key-value areas
- classify layout as `standard_table`, `block_table`, `reaction_rate_time_series`, `component_distribution`, `unknown_region`, or similar controlled kinds
- infer field value types: number, date, category, text, boolean, formula, mixed
- infer units from headers, nearby rows, number formats, and cell text
- score confidence from structural signals, type consistency, unit evidence, source hints, and prior confirmed understanding
- preserve source refs: workbook id, sheet, range, cell address, zero-based row/col, raw value, formatted value, formula where available

AI-bounded work:

- propose a human-readable explanation for a region
- map user wording to a candidate `UnderstandingPatch`
- rank ambiguous candidate regions when deterministic evidence is close

AI must not:

- invent values or source cells
- upgrade guessed facts to confirmed facts
- write directly to accepted WorkbookUnderstanding

### WorkbookReviewSession Backend State Machine

The session is a stateful draft, not a dataset mutation.

State includes:

- source document ids and workbook versions
- selected sheet and visible grid viewport
- draft red-box regions
- per-region status, explanation, warnings, and patch history
- user messages and system clarification messages
- current draft WorkbookUnderstanding
- current preview output

Request loop:

```text
mouse selection or user message
  -> parse candidate operation
  -> validate schema and project scope
  -> attach to one draft region when applicable
  -> run conflict checks
  -> apply to draft session state
  -> regenerate preview
  -> return explanation, warning, or clarification
```

Supporting services:

- patch parser
- patch validator
- region conflict detector
- region queue manager
- explain-selected-region service
- preview regeneration service
- audit/event recorder for accepted decisions

### SourceExtract Algorithms

Source extraction turns confirmed regions into structured rows/fields/series.

Initial extractors:

- `experiment_master_table`: row-oriented experiment table with identifiers, conditions, materials, measurements, metadata, and notes
- `reaction_rate_time_series`: x/y observation rows linked to one or more target experiments
- `component_distribution`: C-number/component labels plus value rows, with optional experiment binding
- `generic_table`: bounded table range with header/data rows but no domain-specific interpretation yet

Extractor steps:

```text
read bounded source range
  -> apply confirmed header/unit/value row understanding
  -> infer fields and row ids
  -> validate required columns/rows
  -> build preview rows or series
  -> attach cell-level source refs
  -> emit warnings for missing units, bad types, conflicting labels, or suspicious sums
```

Promotion decision:

```text
accepted source extract
  -> chart-local DataPlan/DataSnapshot
  -> or DatasetCommit promotion
```

DatasetCommit promotion should use the same extract preview, but writes a new immutable project dataset version.

### DataPlan Compiler And Validator

DataPlan is the backend-validated plan for chart/table data.

Inputs:

- user chart intent
- accepted source extracts
- dataset commits
- ObservationSeries
- WorkbookUnderstanding versions
- chart/cross-compare templates

Compiler steps:

- parse chart/task intent from natural language or template
- resolve experiment aliases against real project experiments
- resolve field aliases against accepted extracts, ObservationSeries, mappings, or dataset fields
- resolve scope: selected experiments, all matching experiments, source-selected ranges, or chart-local snapshot
- choose allowed operations: select, filter, unpivot, sort, simple aggregate, normalize category
- reject nonexistent experiments, nonexistent fields, unresolved workbooks, and incompatible source regions
- return clarification when multiple plausible bindings remain

Validator checks:

- project/lab authorization
- source evidence belongs to the project
- operation whitelist only
- no arbitrary code/formulas
- required x/y/group fields exist
- selected experiment scope is complete
- all-matching scope has enough valid series
- paired x/y rows are present
- units and value types are compatible
- resource estimates stay within limits

### DataSnapshot Executor

DataSnapshot is deterministic output from a validated DataPlan.

Executor steps:

```text
load accepted extract / dataset commit / ObservationSeries
  -> filter records
  -> pair x/y rows
  -> unpivot or pivot when requested
  -> sort categories or time values
  -> aggregate only when explicitly requested
  -> build rows or series
  -> attach source refs and dependency refs
  -> compute content hash
```

Snapshot output includes:

- rows or series
- included experiments/source regions
- skipped experiments/source regions with reasons
- quality warnings
- source refs
- dependency refs
- content hash
- executor version

Rules:

- Same input dependencies plus same DataPlan should produce stable ordering and hash.
- Visual edits must not re-run the DataSnapshot executor.
- Data edits must create a new DataPlan/DataSnapshot instead of mutating the old snapshot.

### ChartSpec

The editable chart definition over a DataSnapshot or source snapshot.

Current ChartSpec v1.4 already supports:

- `origin`
- `analysisViewId`
- `sourceExtractProposalId`
- `seriesScope`
- `compatibleExperimentIds`
- `series[]`
- `sourceSnapshot`

Future direction:

- split internal semantics into `AnalysisSpec`, `VisualSpec`, and `FigureSpec` where helpful
- keep Plotly JSON as renderer output, not AI output
- keep ChartSpec editable even after a FigurePackage is published

### FigurePackage

The approved, immutable figure version for Manuscript/export.

Contains:

- figure id/version/status
- source ChartSpec version id
- DataSnapshot or source snapshot id/hash
- renderer name/version
- generated SVG/PNG/PDF or render manifest
- caption and alt text
- provenance manifest
- review decision id

Rules:

- Do not edit a FigurePackage in place.
- Editing creates a new ChartSpec or FigurePackage version.
- Manuscript shows update availability instead of silently replacing figures.

### ManuscriptPlacement

The placement of a FigurePackage in a manuscript.

Contains:

- manuscript id
- placement id
- figure package id/version
- page/canvas position
- size
- display options
- inserted/updated actor and timestamp

Rules:

- Moving/resizing changes placement only.
- Replacing the figure package is explicit.
- Old placements remain auditable.

## Review Semantics

### Data Review Required

Require data review when a change affects:

- source workbook, sheet, range, or row/column
- experiment scope
- included/skipped experiments
- x/y/group fields
- filters
- unit conversion
- aggregation/statistics
- missing value handling
- source extract interpretation
- WorkbookUnderstanding facts that affect imported values

### Visual Review Required

Visual-only review is enough for:

- color
- marker shape
- line width
- title or axis label
- legend position
- chart size for exported figure
- caption text when it does not claim new data/statistics

### Placement Update Only

Placement-only changes include:

- moving a figure block
- resizing on the manuscript canvas
- changing page position
- changing local display crop/fit when it does not alter the published figure package

## Cross-Compare Template Semantics

Cross-compare should be represented as a reusable analysis template, not as a fixed output chart.

Example template:

```json
{
  "templateType": "cross_compare",
  "dataIntent": {
    "xConcept": "reaction time",
    "yConcept": "reaction rate",
    "groupBy": "experiment",
    "scope": "all_matching_experiments"
  },
  "visualIntent": {
    "mark": "scatter",
    "traceMode": "markers",
    "colorBy": "experiment"
  }
}
```

Application flow:

```text
apply template
  -> resolve current matching ObservationSeries or source-extract series
  -> generate DataPlan
  -> execute DataSnapshot preview
  -> show included/skipped experiments
  -> user confirms
  -> ChartSpec
  -> FigurePackage
```

Rules:

- `all experiments` means all current matching experiments with complete required data.
- New matching experiments create `Update available`, not silent manuscript changes.
- Selected experiment templates fail with clarification if any requested experiment cannot be resolved.
- All-matching templates may skip invalid candidates only when at least two valid series remain, and skipped series must be shown.
- Filtering already-snapshotted series in Manuscript can be a visual/chart view change if the underlying snapshot remains fixed; adding new data requires data review.

## Source-Range Evidence Semantics

Explicit source prompts have priority over dataset-field prompts.

Examples:

```text
draw carbon balance distribution of experiment 33, bar chart,
using c-number distribution data from P31 to BA32 in calculation33 in Sheet1
```

```text
draw a cross-compare carbon balance distribution chart for experiments 33, 34, and 35
using c-number distribution data from P31 to BA32 in calculation files
```

Rules:

- Parse workbook hints, sheet hints, range hints, row/column hints, experiment aliases, and chart intent separately.
- Resolve source documents by project, workbook hint, and experiment alias.
- Validate range shape deterministically before proposing a source extract.
- Preserve cell-level provenance, including Excel address and zero-based row/col.
- Source extract review happens before chart proposal review.
- Source-backed ChartSpecs use immutable snapshots.
- Do not ask dataset-field clarification such as "Which C-number fields?" when the user explicitly provided source evidence.

## Project Evidence Retrieval And QA

LabRat needs a project-scoped retrieval layer for read-only questions, agent planning, and evidence discovery. This is RAG-like, but it should be source-backed and structured before it becomes embedding-based.

Primary user questions:

```text
What data do we have for Exp30?
Which files are related to reaction rate?
Which charts use old data?
What fields can I use to plot gas selectivity?
Which workbook/range supports this figure?
Which experiments have gas selectivity above 10%?
```

Retrieval sources:

- project profile and methods context
- file objects and source documents
- source regions, range reads, source extract proposals, and accepted extracts
- dataset commits, generic imports, fields, mappings, and observation series
- analysis views, chart proposals, ChartSpecs, FigurePackages, manuscripts, and audit events
- dependency records once DataPlan/DataSnapshot/FigurePackage dependencies exist

Response kinds:

```text
answer
  Read-only answer grounded in cited project evidence.

evidence_results
  Ranked files, source documents, ranges, experiments, fields, extracts, charts, or manuscripts.

clarification
  The retrieval target is ambiguous or unavailable.

proposal
  A reviewable next object such as SourceExtractProposal, DataPlan, chart proposal, or UnderstandingPatch.

action_card
  A confirmable workflow action. Mutating actions must still pass through review/confirmation.
```

Retrieval strategy:

1. Structured search first: exact ids, experiment labels, filenames, sheet names, source refs, field aliases, mapping sets, chart specs, and dependency records.
2. Keyword and fuzzy search second: source region labels, sheet summaries, field display names, project notes, manuscript text, and audit labels.
3. Optional embedding search later: project profile, source document summaries, region explanations, field descriptions, notes, and manuscript prose.

Embedding/RAG rules:

- Embeddings may return candidate evidence, not final scientific values.
- Vector results must be re-resolved to project-owned ids, source refs, dataset commit ids, or source ranges before use.
- Do not embed or send full raw workbooks or full cell grids to external providers.
- Do not let retrieved prose override numeric source values, accepted mappings, or reviewed DataSnapshots.
- Answers that mention scientific values must cite the source cell/range, accepted extract, dataset commit, or DataSnapshot used.
- Agent search must respect lab/project permissions and should be logged when it affects a reviewed workflow.

This layer supports the agent, but it should also be usable directly by UI surfaces such as Project Overview search, Browser detail, Chart Review, Source Review, and Manuscript stale explanations.

## MCP Adapter Strategy

MCP is a future adapter, not the LabRat source of truth.

The implementation order should be:

```text
internal project APIs
  -> permission checks, audit, source refs, review boundaries
  -> AgentRun allowlisted tools
  -> optional MCP adapter around the same APIs
```

MCP should expose narrow, project-scoped tools/resources only after the corresponding internal API is stable. It must not bypass LabRat auth, project membership, review status, or confirmation gates.

Potential future MCP resources:

```text
labrat://projects/{projectId}/summary
labrat://projects/{projectId}/source-documents
labrat://projects/{projectId}/experiments
labrat://projects/{projectId}/chart-specs
labrat://projects/{projectId}/manuscripts
```

Potential future MCP tools:

```text
labrat.search_project_evidence
labrat.list_source_documents
labrat.query_source_document
labrat.read_source_range
labrat.resolve_experiment_alias
labrat.resolve_field_alias
labrat.propose_source_extract
labrat.propose_understanding_patch
labrat.create_data_plan_draft
labrat.validate_data_plan
labrat.create_chart_proposal
labrat.get_dependency_impact
```

MCP tool categories:

```text
read_only
  Search, list, resolve, range preview, dependency impact.

draft_or_proposal
  Create SourceExtractProposal, UnderstandingPatch, DataPlan draft, chart proposal.

confirmable_execution
  Only allowed by passing through LabRat review/confirmation APIs. MCP itself should not silently apply imports, accept extracts, create dataset commits, create durable ChartSpecs, or insert manuscript figures.
```

MCP guardrails:

- MCP returns compact project evidence and source refs, not full workbook dumps.
- MCP cannot execute arbitrary Python, SQL, JavaScript, workbook macros, or generated formulas.
- MCP cannot mutate raw scientific state without a LabRat-reviewed action.
- MCP tools should produce the same review objects as the web UI and AgentRun flow.
- MCP access should be disable-able per deployment until authentication, audit, and rate limits are ready.

## API Plan

This section is a planning target. Update `doc/contracts/saas-api-contract-v0.md` before implementation.

### Existing APIs To Preserve

```text
GET  /api/projects/:projectId/state
POST /api/projects/:projectId/files
POST /api/projects/:projectId/import-runs
POST /api/projects/:projectId/workbook-review-sessions
GET  /api/projects/:projectId/workbook-review-sessions
GET  /api/workbook-review-sessions/:sessionId
GET  /api/projects/:projectId/source-documents
GET  /api/source-documents/:sourceDocumentId/regions
POST /api/source-documents/:sourceDocumentId/query
POST /api/source-documents/:sourceDocumentId/range
POST /api/projects/:projectId/source-extract-proposals
PATCH /api/source-extract-proposals/:proposalId
GET  /api/projects/:projectId/observation-series
POST /api/projects/:projectId/analysis-views
POST /api/analysis-views/:analysisViewId/chart-proposal
POST /api/projects/:projectId/charts/interpret
POST /api/projects/:projectId/chart-specs/from-proposal
GET  /api/projects/:projectId/chart-specs
POST /api/projects/:projectId/agent/runs
POST /api/agent-runs/:agentRunId/confirm
GET  /api/projects/:projectId/manuscripts
POST /api/projects/:projectId/manuscripts
PATCH /api/manuscripts/:manuscriptId
```

### Planned Evidence Retrieval APIs

```text
POST /api/projects/:projectId/search
POST /api/projects/:projectId/evidence/resolve
POST /api/projects/:projectId/data/query
POST /api/projects/:projectId/dependencies/query
```

Purpose:

- answer read-only project questions with cited evidence
- search files, source documents, regions, experiments, fields, extracts, charts, manuscripts, and audit summaries
- resolve natural-language aliases to real project ids before an agent creates proposals
- find candidate data for Chart Review, Source Review, Browser detail, and Manuscript stale explanations
- explain dependency impact without applying any mutation

Rules:

- retrieval endpoints are read-only
- responses must identify source ids, dataset commit ids, source refs, confidence, and warnings when available
- retrieval may return `answer`, `evidence_results`, `clarification`, `proposal`, or `action_card` shapes, but mutating follow-up still happens through the relevant review endpoint
- initial implementation should use structured and keyword search; embeddings are optional later and must re-resolve to source-backed records

### Planned Workbook Review And Understanding APIs

```text
POST /api/projects/:projectId/workbook-review-sessions
GET  /api/projects/:projectId/workbook-review-sessions
GET  /api/workbook-review-sessions/:sessionId
POST /api/workbook-review-sessions/:sessionId/revisions
POST /api/workbook-review-sessions/:sessionId/confirm
```

Purpose:

- create a conversation around one workbook/source document
- submit natural language corrections and red-box updates together in each revision
- turn each revision into a backend-validated `WorkbookUnderstanding` draft
- regenerate a readable workbook/region preview after each revision
- confirm the final WorkbookUnderstanding without creating a DatasetCommit, SourceExtractProposal, ChartSpec, or ManuscriptPlacement

### Planned Workbook Understanding APIs

```text
GET  /api/projects/:projectId/workbook-understandings
GET  /api/workbook-understandings/:understandingId
POST /api/projects/:projectId/workbook-understandings
POST /api/workbook-understandings/:understandingId/versions
```

Purpose:

- persist user-confirmed facts about workbook layouts and semantics
- reuse confirmed facts across future imports and chart requests
- avoid re-asking the same clarification

### Planned Source Extract And Promotion APIs

```text
POST /api/workbook-review-sessions/:sessionId/source-extract-proposals
GET  /api/source-extract-proposals/:proposalId
PATCH /api/source-extract-proposals/:proposalId
POST /api/source-extract-proposals/:proposalId/promote-to-dataset
```

Purpose:

- create one or more reviewable source extract proposals from confirmed WorkbookUnderstanding regions only when a chart/table/data action needs concrete rows
- accept/reject each extracted region independently
- let accepted source extracts feed chart-local DataPlans directly
- optionally promote selected accepted extracts into a new DatasetCommit when they should become reusable project data

Promotion rules:

- promotion creates a new immutable DatasetCommit
- promotion does not rewrite the accepted source extract
- promotion can include one or many accepted extracts
- promotion should explain which project surfaces will use the data: Browser, AI context, future charts, cross-compare templates, or mappings

### Planned DataPlan APIs

```text
POST /api/projects/:projectId/data-plans
GET  /api/data-plans/:dataPlanId
POST /api/data-plans/:dataPlanId/validate
POST /api/data-plans/:dataPlanId/execute
GET  /api/data-snapshots/:dataSnapshotId
```

Purpose:

- create reviewable data/analysis plans from chart intents, source extracts, observation series, or templates
- execute deterministic snapshots only after validation
- make chart data reproducible and inspectable before visual review

### Planned Chart Intent Gateway Contract

All natural-language chart creation entrypoints should use one project-scoped chart intent gateway instead of each UI surface calling old chart endpoints differently.

Near-term gateway:

```text
POST /api/projects/:projectId/charts/interpret
```

Planned gateway result should be treated as a discriminated review result:

```text
clarification
source_extract_proposal
data_plan_review
chart_proposal_set
chart_spec_visual_patch
```

Rules:

- Logged-in server mode must use the project-scoped gateway, not legacy `POST /api/charts/interpret`.
- Frontend code must not decide from keywords whether a prompt is source evidence, normalized data, cross-compare, or visual edit.
- The backend may use AI plus deterministic validation to classify the request, but it must return one explicit next review object.
- Source evidence prompts return source extract review first.
- Data-affecting chart prompts return DataPlan/DataSnapshot review before ChartSpec creation once those objects exist.
- Visual-only ChartSpec edit prompts return a visual patch and must not re-execute DataPlan/DataSnapshot.
- Manuscript insertion never consumes raw prompt results directly; it inserts approved ChartSpecs now and FigurePackages later.
- Legacy compatibility endpoints may remain for local/dev tests, but frontend server project workflows should not fork behavior around them.

### Planned Figure APIs

```text
POST /api/chart-specs/:chartSpecId/figure-packages
GET  /api/projects/:projectId/figure-packages
GET  /api/figure-packages/:figurePackageId
POST /api/manuscripts/:manuscriptId/placements
PATCH /api/manuscript-placements/:placementId
POST /api/manuscript-placements/:placementId/replace-figure
```

Purpose:

- publish immutable figure versions from ChartSpecs
- insert FigurePackages into Manuscript
- replace an existing placement only through explicit user action

### Planned Dependency APIs

```text
GET  /api/dependencies/:entityId/impact
POST /api/projects/:projectId/dependencies/recompute-stale
```

Purpose:

- answer which charts/figures/manuscript placements depend on a changed source/import/understanding/data plan
- mark stale by dependency, not by broad dataset commit age alone

## Frontend Plan

### Import Review Workbench

Replace the black-box import experience with a readable workbench.

Surfaces:

- workbook list and sheet list
- full Excel-like sheet grid with row/column headers
- region overlay boxes on top of the grid
- detected regions and table candidates
- source range preview
- current understanding facts
- warnings and confidence reasons
- normalized preview table
- natural-language correction composer
- patch diff between previous and new preview
- final confirm/apply action

Expected user loop:

```text
open import review
  -> inspect readable preview
  -> type correction
  -> see proposed patch
  -> see updated preview
  -> confirm or continue correcting
  -> apply reviewed import/source extract
```

### Excel Source Review Canvas

The Import Review Workbench needs an Excel-like canvas, not only summary cards.

Behavior:

- Render the selected sheet as a spreadsheet grid with row numbers, column letters, formulas/formatted values where available, and sticky headers.
- Use virtual scrolling and bounded range reads; do not load or render the full cell grid for large workbooks.
- Overlay detected source regions as boxes on the grid.
- Support multiple red boxes in one workbook or sheet; each box is a separate draft source region.
- For high-confidence regular sheets, automatically propose one or more best data regions with red boxes, but keep them editable.
- For low-confidence messy sheets, still show the full visible sheet grid; show low-confidence candidate boxes only as suggestions.
- Allow the user to right-click or drag-select cell ranges to create, move, resize, replace, or delete red boxes.
- Context menu actions should include:
  - `Mark as data source`
  - `Describe this region`
  - `Set header row`
  - `Set value row`
  - `Set experiment binding`
  - `Ignore this region`
- Keep a region list panel showing every red box, its range, inferred type, confidence, status, and warnings.
- Process region understanding one box at a time so clarification questions stay scoped to the selected range.
- When the backend understands a selected region, generate a concise natural-language explanation and structured `UnderstandingPatch` for that region.
- When the backend cannot identify a selected region, ask a source-specific clarification such as `What does Sheet1!P31:BA32 represent?`.
- The user can keep correcting each region's explanation in natural language; each correction creates a new patch and a refreshed preview.

Draft region statuses:

```text
draft
needs_description
proposed
confirmed
ignored
```

Rules for multiple red boxes:

- Each red box has a stable draft region id.
- Each red box stores workbook id, sheet name, range, status, proposed semantic type, explanation, warnings, and patch history.
- A single WorkbookReviewSession can contain many draft regions.
- Backend clarification must reference one specific draft region/range at a time.
- Confirming one region does not automatically confirm other regions.
- Overlapping red boxes are allowed only as draft conflicts; the UI must show the conflict and require user resolution before final understanding confirmation.
- Final import/source preview can include multiple confirmed regions from the same workbook.

Example high-confidence state:

```text
Sheet1 grid
  -> red box region_1 around A1:H120
  -> red box region_2 around P31:BA32
  -> side panel: region_1 "Standard table. Header row 1. Data rows 2-120. Confidence 0.94."
  -> side panel: region_2 "Component distribution. Header row 31. Value row 32. Confidence 0.88."
```

Example low-confidence state:

```text
Sheet1 grid
  -> no confirmed region
  -> faint candidate boxes
  -> user right-click selects P31:BA32 as region_1
  -> user right-click selects D40:H60 as region_2
  -> backend asks what region_1 means, then separately asks what region_2 means if needed
```

Rules:

- Red boxes are review/edit affordances, not accepted facts by themselves.
- A selected box becomes durable only after the user confirms that region's generated patch or final import/source preview.
- All region edits must preserve workbook, sheet, range, and source refs.
- Raw workbook content shown in the grid remains local/project-scoped evidence and must not be sent wholesale to AI providers.

### Agent Drawer

Agent Drawer should become a workflow panel over `AgentRun` and import/chart sessions.

Must show:

- visible trace steps
- read-only evidence checked
- proposed patches/plans
- action cards with consequences
- links to full review surfaces
- errors/clarifications with useful options

Must not show hidden chain-of-thought.

### Unified Frontend Chart Intent Client

Add one frontend client/helper for natural-language chart requests. Existing names can vary, but the behavior should be centralized so Chart Review, the LabRat conversation drawer, and ChartSpec natural-language create/edit cannot drift.

Responsibilities:

- call the project-scoped chart intent gateway in server mode
- pass entrypoint metadata such as `chart_review`, `agent_drawer`, `chart_spec_create`, or `chart_spec_edit`
- pass optional current context such as `currentChartSpecId`, selected manuscript block, current experiment selection, selected source region, or selected workbook
- normalize gateway responses into frontend actions:
  - `clarification`: show scoped clarification with options
  - `source_extract_proposal`: open source extract review or show an action card linking to it
  - `data_plan_review`: show DataPlan/DataSnapshot preview before chart visual review
  - `chart_proposal_set`: open Chart Review with the proposal set selected
  - `chart_spec_visual_patch`: open visual patch review in ChartSpec editing
- refresh only the affected server-state slices after accepted source extract, DataPlan execution, proposal acceptance, ChartSpec creation, or FigurePackage publication
- preserve unsaved Manuscript placement/canvas state during review refreshes

Entrypoint migration matrix:

| Frontend entrypoint | New behavior |
| --- | --- |
| Chart Review one-chart prompt | Calls chart intent client; shows clarification, source extract review, DataPlan review, or chart proposal review according to backend result. |
| LabRat conversation drawer | AgentRun cards may delegate chart interpretation to the same gateway/result shapes; chat must not directly create final ChartSpecs from raw prompt output. |
| ChartSpec natural-language create | Calls the same chart intent client; data-backed charts go through source extract/DataPlan/chart proposal review before ChartSpec creation. |
| ChartSpec natural-language edit | Routes visual-only edits to visual patch review; routes data-affecting edits back to DataPlan review. |
| Manuscript insert modal | Does not call prompt interpretation; inserts active ChartSpecs now and FigurePackages later. |

Required frontend tests:

- Chart Review prompt and LabRat chat prompt receiving the same source-evidence result both show a source extract review path.
- Chart Review prompt and ChartSpec create prompt receiving the same cross-compare result both show DataPlan/chart proposal review, not direct manuscript insertion.
- ChartSpec edit prompt `make Exp35 red` opens visual patch review and does not request a new DataSnapshot.
- ChartSpec edit prompt `add Exp36 to this comparison` requests data review because it changes chart data scope.
- Manuscript insertion remains driven by approved ChartSpec/FigurePackage selection, not by natural-language prompt result.

### Chart Review

Chart Review should display the full chain:

```text
intent/template
  -> DataPlan
  -> DataSnapshot/sourceSnapshot
  -> ChartSpec draft
```

Display:

- origin badge: dataset, observation series, source extract, template, agent
- included/skipped experiments
- source workbook/sheet/range refs
- data preview rows/series
- visual preview
- warnings and review status

### Source Extract Review Bridge

When a chart prompt returns `source_extract_proposal`, the user should not hit a dead end.

Current expected bridge:

```text
source_extract_proposal card
  -> inspect extracted rows/series and source cells
  -> accept or reject source extract
  -> create chart proposal from accepted source extract
  -> review/accept chart proposal
  -> create ChartSpec
  -> insert into Manuscript
```

UI requirements:

- Show extracted rows or series inside the Chart Review result card:
  - component label, e.g. `C1`
  - parsed value, e.g. percentage
  - source cells, e.g. `Q31`, `Q32`
  - workbook/sheet/range
  - warnings, de-duplicated by code/message/range
- Show explicit actions:
  - `Accept source extract`
  - `Reject`
  - `Create chart proposal` after acceptance
- `Create chart proposal` calls:

```text
POST /api/source-extract-proposals/:proposalId/chart-proposal
```

- Returned `chartProposalSet` must be merged into the existing Chart proposals section.
- Do not create ChartSpec directly from a source extract proposal.
- LabRat chat cards and Chart Review should share the same source-extract next-step behavior.

Tests:

- source extract proposal card shows rows, source cells, and de-duplicated warnings
- accepting the source extract patches status to `accepted`
- accepted source extract enables `Create chart proposal`
- chart proposal response appears in the normal Chart proposals section
- rejected source extract cannot create chart proposal
- LabRat chat source extract action links to or opens the same review card, not a separate flow

### Overview Entry Point Governance

Project Overview should be a workflow dashboard, not a wall of unrelated "generate chart" buttons.

Why there are currently many chart-like entrypoints:

- `Chart Review` was added for normal proposal review and one-chart prompt drafting.
- `LabRat` chat was added as a general conversational action surface.
- `Compare Series` was added as a deterministic shortcut for already-normalized ObservationSeries.
- `Accepted + pending` and `Edit specs` were added as chart management shortcuts.
- Manuscript insertion gained a shortcut after ChartSpec creation.

These are different workflow states, but the labels can feel like multiple competing natural-language chart generators.

Target entrypoint model:

| Overview surface | Meaning |
| --- | --- |
| `Ask LabRat` | Conversational assistant for guided workflows and questions. |
| `Review chart proposals` | Review queue for chart proposals and one-chart prompt drafting. |
| `Compare series` | Deterministic template shortcut for compatible ObservationSeries, not a second AI prompt box. |
| `Manage approved charts` | Accepted/pending ChartSpecs and proposal maintenance. |
| `Manuscript` | Insert approved ChartSpecs/FigurePackages only. |

Rules:

- Only `Ask LabRat` and `Review chart proposals` should expose natural-language chart prompt boxes in the near term.
- `Compare series` should be labeled as a template/shortcut and should route through the same chart review boundary.
- Overview cards should use verbs that reveal the workflow state: `Review`, `Compare`, `Manage`, `Insert`.
- Do not add new prompt boxes to Overview cards.
- If multiple routes can create the same review object, they must open the same review surface instead of rendering separate card-specific flows.
- Add helper text that explains the next boundary: source extract review, chart proposal review, ChartSpec creation, or Manuscript insertion.

Tests:

- Overview has no duplicate natural-language chart prompt boxes.
- Overview chart-related buttons route to distinct surfaces: chat, review, compare, manage, manuscript.
- Compare Series creates or opens normal chart proposal review; it does not create ChartSpecs directly.
- Source extract proposal from any entrypoint lands in the same Source Extract Review Bridge.

### Manuscript

Near-term:

- continue inserting active ChartSpecs while FigurePackage is not implemented
- keep selected experiment ids and chart snapshots
- show clearer empty/stale/incompatible messages

Target:

- insert FigurePackage versions
- placement controls only change manuscript placement
- `Edit source chart` opens ChartSpec editing
- `Update available` appears when dependencies produce a newer package candidate
- `Compare` and `Replace` are explicit actions

## Implementation Phases

### Phase 0: Contracts, Fixtures, And Loop Setup

Goal: prepare the repo for the new object chain without implementation ambiguity.

Tasks:

1. Update `doc/contracts/saas-api-contract-v0.md` with WorkbookReviewSession, WorkbookUnderstanding, SourceExtract lifecycle, optional DatasetCommit promotion, DataPlan, DataSnapshot, FigurePackage, ManuscriptPlacement, and dependency APIs.
2. Update `doc/contracts/saas-database-schema-v0.md` with proposed tables/columns.
3. Update `doc/contracts/canonical-data-dictionary.md` with the new terms.
4. Update `doc/arch/ai-boundaries.md` with natural-language patch rules and DataPlan restrictions.
5. Define the frontend chart intent gateway response union and entrypoint migration matrix in API/frontend docs.
6. Add synthetic fixtures for:
   - multi-sheet workbook with one valid source range
   - ambiguous source range
   - high-confidence regular table that should auto-box one source region
   - low-confidence messy sheet that requires manual box selection
   - accepted source extract that is chart-local only
   - accepted source extract promoted into a DatasetCommit
   - reaction-rate supplements for multiple experiments
   - missing experiment prompt
   - import correction examples
6. Keep private real workbooks out of Git.

Done when contracts and fixtures can guide implementation without relying on private data.

### Phase 1: Readable WorkbookIndex And Import Preview

Goal: make uploaded workbook structure understandable before AI correction.

Tasks:

1. Reuse existing SourceDocument/SourceRegion/index blobs as the workbook index foundation.
2. Add the Excel Source Review Canvas for selected source documents/sheets.
3. Render visible worksheet cells through bounded range reads and virtual scrolling.
4. Overlay detected regions as boxes and focus high-confidence regions with red boxes.
5. For low-confidence sheets, show the grid and candidate boxes without pretending any region is accepted.
6. Let users create multiple red boxes in the same workbook/sheet and show them in a region list panel.
7. Track each draft region independently with range, status, explanation, confidence, warnings, and patch history.
8. Show source refs and confidence reasons in Import Review.
9. Add "ignore sheet/region" and "mark region type" draft UI actions without AI first.
10. Ensure project state stays compact and does not include full cell grids.

Tests:

- source document list renders after upload
- sheet grid opens bounded ranges and does not require full cell grids in project state
- high-confidence regular workbook can display one or more editable red source-region boxes
- low-confidence messy sheet still displays the grid and allows manual box selection
- right-click or drag-select can create multiple draft region selections
- each draft region appears in the region list with its own status and range
- overlapping draft regions are shown as conflicts before final apply
- warnings and confidence reasons are visible
- ignored region is represented as a draft decision, not a dataset mutation
- private workbook fixtures are not tracked

Done when a user can visually inspect the uploaded workbook, see LabRat's proposed source regions as editable red boxes, and manually select multiple new regions when automatic detection is weak.

### Phase 2: Conversational Import Review And UnderstandingPatch

Goal: let users correct import understanding with natural language.

Tasks:

1. Add `WorkbookReviewSession` persistence in Memory and Postgres.
2. Add schema for `UnderstandingPatch`.
3. Implement deterministic patch parser for common corrections:
   - sheet/range semantic type
   - header row
   - value row
   - unit override
   - experiment alias/workbook hint
   - ignore sheet/region
   - category normalization
   - selected range description
4. Add optional AI parser behind schema validation for harder corrections.
5. Add a backend explain-selected-region step that operates on one draft region id/range at a time and returns either:
   - a structured patch plus a natural-language description, or
   - a clarification asking what the selected range represents.
6. Add a region queue so the frontend can ask the backend to explain each unconfirmed red box separately.
7. Regenerate import/source preview after every accepted patch.
8. Show patch diff and rationale in the frontend.

Tests:

- `Sheet1 P31:BA32 is carbon number distribution` creates a region semantic patch
- `third row is header` changes preview header row
- manually selecting `Sheet1!P31:BA32` can produce `region_description_required` when the backend cannot infer the region
- selecting `Sheet1!P31:BA32` and `Sheet1!D40:H60` creates two independent draft region records
- backend clarification for one draft region does not overwrite or answer another draft region
- user description of a selected range creates a semantic patch and generated explanation
- generated explanation can be corrected by another natural-language message
- confirmed region patches can be combined into one refreshed import/source preview
- `calculation33 belongs to Exp33` sets workbook/experiment binding
- repeated corrections preserve conversation/session history
- invalid patch returns clarification and does not mutate preview

Done when users can iteratively improve import understanding from natural language and many mouse-selected worksheet regions without editing JSON or restarting upload.

### Phase 3: WorkbookUnderstanding Versions

Goal: persist confirmed understanding facts for reuse.

Tasks:

1. Add `workbook_understandings` and version records in Memory/Postgres.
2. Convert accepted WorkbookReviewSession patches into a new understanding version.
3. Reuse understanding versions during source extraction, DataPlan compilation, and chart evidence resolution.
4. Track decision source: user, system, policy, or AI proposal.
5. Show current understanding facts in the UI.

Tests:

- confirmed header/unit/range facts survive reload
- source evidence resolver uses confirmed workbook hint/sheet/range facts
- rejected facts are not reused
- a new uploaded workbook version does not silently inherit incompatible facts

Done when LabRat stops asking the same import/source clarification after the user has confirmed it.

### Phase 4: DataPlan And DataSnapshot Foundation

Goal: make chart data selection and transformation explicit.

Tasks:

1. Add DataPlan schema and validator.
2. Add DataSnapshot schema and deterministic executor for initial operations:
   - select promoted dataset fields
   - select accepted source extracts
   - select observation series
   - filter experiments
   - unpivot/pivot for component distributions
   - aggregate simple means/counts only when explicit
3. Store dependency refs and content hashes.
4. Expose validation errors as reviewable messages.
5. Keep existing ChartSpec paths working while new DataPlan-backed paths are added.
6. Add the unified frontend chart intent client and route Chart Review, LabRat chat chart actions, and ChartSpec natural-language create through it.
7. Add the Source Extract Review Bridge:
   - display source extract rows/series and cell refs
   - accept/reject source extract proposals
   - create chart proposal from accepted source extracts
   - merge returned chart proposal sets into the normal Chart proposals section
8. Add Overview entrypoint governance so chart-related cards are clearly labeled as chat, review, compare, manage, or manuscript insertion rather than duplicate natural-language generators.
9. Keep Manuscript insertion on approved ChartSpec/FigurePackage objects only.

Tests:

- nonexistent experiment returns clarification/no snapshot
- wrong supplement import cannot satisfy a requested experiment
- chart-local accepted source extract can create a DataPlan without DatasetCommit promotion
- promoted source extract can create a DataPlan through the DatasetCommit path
- DataSnapshot rows cite source imports/ranges regardless of whether data came from an accepted extract or promoted dataset
- invalid field alias fails validation
- same plan/dependencies produce stable snapshot ordering and hash
- Chart Review and LabRat chat produce the same review step for the same backend gateway result
- ChartSpec natural-language create does not bypass DataPlan/chart proposal review
- Manuscript insert modal does not accept raw prompt interpretation output
- source extract proposals can be accepted from Chart Review and then create chart proposals
- source extract warnings are de-duplicated in the review card
- Overview does not expose duplicate natural-language chart prompt boxes

Done when chart proposals can show "this is exactly the data that will enter the chart" before ChartSpec creation.

### Phase 5: Dataset/Observation Cross-Compare Through DataPlan

Goal: make reaction-rate cross-compare templates stable and inspectable.

Tasks:

1. Represent reaction-rate cross-compare as template plus DataPlan.
2. Resolve `all_matching_experiments` from active ObservationSeries.
3. Resolve `selected_experiments` strictly.
4. Generate DataSnapshot series with included/skipped experiment lists.
5. Preserve stable natural experiment sorting and stable colors.
6. Route ChartSpec v1.4 creation from the DataSnapshot.

Tests:

- `i want a cross-compare chart for every experiment, x axis is reaction time, y axis is reaction rate` resolves real matching series only
- repeated execution produces stable series order and colors
- selected Exp33/Exp34/Exp35 returns exactly those experiments
- missing Exp999 returns clarification
- adding Exp36 creates update availability, not silent manuscript change
- cross-compare prompts entered from Chart Review, LabRat chat, and ChartSpec create use the same DataPlan-backed result

Done when cross-compare is a reproducible data workflow rather than a one-off chart guess.

### Phase 6: Source-Range DataPlan And Component Distribution Cross-Compare

Goal: unify original-index source evidence with the same DataPlan/DataSnapshot review model.

Tasks:

1. Compile accepted source extracts into DataPlans.
2. Support single component-distribution snapshots from source ranges.
3. Support source-range cross-compare snapshots across calculation workbooks.
4. Preserve cell-level provenance in snapshot rows and series.
5. Keep source extract review before chart review.

Tests:

- `P31 to BA32 in calculation33 in Sheet1` resolves without sheet clarification when valid
- original cell refs include addresses and zero-based row/col
- selected Exp33/Exp34/Exp35 source cross-compare returns three source-backed series
- missing selected workbook blocks the selected-experiment chart
- all-matching source cross-compare skips invalid workbooks only when at least two valid series remain
- source-range prompts entered from Chart Review and LabRat chat both create source extract review, not direct ChartSpecs

Done when original Excel index prompts and normalized supplement prompts converge on the same data-review model.

### Phase 7: ChartSpec Editing And Visual Patch Flow

Goal: separate visual edits from data edits.

Tasks:

1. Add explicit visual patch schema for ChartSpec style changes.
2. Keep per-series color overrides compatible with current default palette.
3. Let natural-language style edits target series by experiment label.
4. Require DataPlan review only when data-affecting fields change.
5. Add UI affordance that labels a change as data, visual, or placement.

Tests:

- `make Exp35 red` changes only visual style when Exp35 is an existing series
- `remove Exp35` from a fixed snapshot is treated as chart view/visual selection unless a new data scope is requested
- `add Exp36` requires data review if Exp36 was not in the snapshot
- style-only change does not create a new DataSnapshot
- ChartSpec natural-language edit uses the same intent gateway for classification but dispatches visual-only and data-affecting edits to different review flows

Done when users can edit chart appearance naturally without accidentally changing scientific data.

### Phase 8: FigurePackage And ManuscriptPlacement

Goal: make Manuscript insertion versioned and publication-safe.

Tasks:

1. Add `figure_packages` storage in Memory/Postgres.
2. Add renderer/package manifest generation for ChartSpec snapshots.
3. Add `manuscript_placements` or a compatible placement payload inside manuscripts.
4. Insert FigurePackage versions into Manuscript.
5. Add `Edit source chart`, `Compare`, and `Replace` flows.
6. Keep near-term ChartSpec insertion compatible until FigurePackage insertion is ready.

Tests:

- publishing a ChartSpec creates immutable FigurePackage v1
- moving/resizing a placement does not change FigurePackage
- visual edit creates FigurePackage v2
- data edit creates new DataSnapshot/ChartSpec/FigurePackage
- old manuscript placement keeps rendering the old package until explicit replace

Done when manuscript figures are stable, editable through versions, and never silently replaced.

### Phase 9: Dependency Graph And Stale Propagation

Goal: make stale status precise and actionable.

Tasks:

1. Record dependencies from DataPlans, DataSnapshots, ChartSpecs, FigurePackages, and ManuscriptPlacements.
2. Mark stale when used source evidence is replaced/deleted/reinterpreted.
3. Mark update-available when a template can include new matching data.
4. Add impact query endpoints.
5. Add UI messages that explain why a chart/figure is stale.

Tests:

- replacing an unrelated import does not stale an unaffected figure
- replacing the supplement used by Exp35 stales figures that depend on that series
- deleting a source document stales source-backed figures using it
- new Exp36 shows update available for all-matching cross-compare templates
- historical FigurePackages remain renderable

Done when the user can trust that stale warnings correspond to real evidence dependencies.

### Phase 10: Evaluation Corpus, Red Team, And Hardening

Goal: make the workflow reliable across messy real-world Excel formats.

Tasks:

1. Build a private and synthetic golden workbook suite.
2. For each workbook, define natural-language tasks, expected source ranges, expected bindings, DataPlans, and expected numeric outputs.
3. Add regression tests for import corrections, source evidence, cross-compare, nonexistent experiments, units, and ambiguity.
4. Add prompt-injection and malicious workbook content tests.
5. Add metrics for clarification rate, review acceptance, wrong-binding prevention, and stale/update events.

Tests:

- every model/prompt/indexer/DataPlan change runs the golden suite
- ambiguous fields return options instead of guesses
- workbook content cannot override system/tool policy
- resource limits prevent oversized range reads

Done when future AI/prompt/parser changes can be evaluated instead of judged by anecdotal manual prompts.

### Phase 11: Legacy Workflow Retirement And Compatibility Cleanup

Goal: remove or quarantine old import/chart/manuscript paths after the extract-first, DataPlan-backed, gateway-driven workflow is stable.

This phase should happen late. Old paths should not be removed merely because the target architecture exists on paper.

Prerequisites:

- Chart Review, LabRat conversation drawer, and ChartSpec natural-language create/edit all use the unified chart intent client in server project mode.
- SourceExtract/DataPlan/DataSnapshot paths cover normalized supplement charts, source-range charts, source-range cross-compare, nonexistent experiment prompts, and visual-only ChartSpec edits.
- Manuscript insertion is stable through approved ChartSpecs or FigurePackages.
- Golden workbook/prompt tests pass for the old high-value user workflows through the new path.
- API contracts explicitly mark old endpoints as compatibility-only or deprecated.

Tasks:

1. Inventory old frontend entrypoints and API helpers:
   - direct calls to legacy `/api/charts/interpret`
   - direct prompt-to-ChartSpec creation paths
   - LabRat chat fallback paths that bypass AgentRun/chart gateway result shapes
   - Chart Review prompt code that handles only `chartProposalSet`
   - Manuscript insertion code that assumes every approved chart is a mutable ChartSpec
   - local-only import/chart helpers that are still needed for dev compatibility
2. Inventory old backend surfaces:
   - stateless local/dev chart interpretation endpoints
   - compatibility scan/normalize/chart proposal endpoints
   - old chart proposal shapes that do not expose DataPlan/DataSnapshot/sourceSnapshot review
   - old Agent plan actions that duplicate the gateway
3. Add temporary deprecation telemetry or console/audit warnings for server project code paths that still hit compatibility behavior.
4. Replace server project callers with the unified import review, source extract, DataPlan, chart intent gateway, ChartSpec, and FigurePackage APIs.
5. Move remaining local/dev compatibility endpoints behind explicit compatibility modules or docs.
6. Remove stale frontend branches only after parity tests prove the new path handles the same prompts.
7. Remove backend endpoints/tests only through the Backend Test Cleanup Track deletion rules.
8. Update `doc/contracts/backend-api-contract.md`, `doc/contracts/saas-api-contract-v0.md`, `doc/contracts/canonical-data-dictionary.md`, and `doc/arch/ai-boundaries.md` to show which old contracts are retired.

Tests:

- `rg`/static tests show server project frontend no longer calls legacy prompt/chart endpoints directly.
- Chart Review, LabRat chat, and ChartSpec create/edit parity tests pass for the same prompt fixtures.
- Source-range prompts do not enter dataset-field-only clarifications through any frontend entrypoint.
- Cross-compare prompts do not bypass DataPlan/DataSnapshot review through any frontend entrypoint.
- Visual-only ChartSpec edits do not create new DataSnapshots.
- Manuscript insertion uses only approved ChartSpecs/FigurePackages, never raw prompt results or raw chart proposals.
- Local/dev compatibility tests remain only for endpoints still documented as compatibility surfaces.
- `npm test`, `npm --prefix backend test`, `npm run build`, and golden workbook tests pass after each removal slice.

Done when logged-in server project workflows no longer depend on legacy import/chart shortcuts, remaining compatibility surfaces are explicitly documented, and obsolete code/tests have been removed only after replacement coverage exists.

## Backend Test Cleanup Track

This is a horizontal engineering track. It should run alongside the phases above, but it must not become a reason to delete tests before replacement coverage exists.

Goal: keep the backend test suite useful as LabRat moves from legacy import/chart endpoints toward conversational import understanding, DataPlan/DataSnapshot, FigurePackage, and dependency-aware stale behavior.

### Principles

- Do not delete a test only because the architecture plan changed.
- Delete or shrink tests only after the endpoint/module behavior is removed from contracts or covered by a newer contract-level test.
- Prefer splitting large route tests before deleting coverage.
- Preserve local/dev compatibility tests until compatibility endpoints are explicitly deprecated in docs.
- Preserve parser/scanner/normalizer tests because `WorkbookIndex` and conversational import review still depend on them.
- Preserve source evidence, AgentRun, ObservationSeries, and ChartSpec validation tests because they are the current foundation for the new plan.
- Coordinate deletion with Phase 11 so cleanup happens after frontend/backend callers have migrated.

### Classification

Create a lightweight backend test inventory with these categories:

```text
foundation
  Parser, scanner, source refs, normalization, unit/header/region detection.

compatibility
  Local/dev stateless endpoints that remain documented compatibility surfaces.

server_contract
  Authenticated SaaS routes, persistence, role checks, project state, audit.

evidence_workflow
  SourceDocument, SourceExtractProposal, AgentRun, ObservationSeries, AnalysisView.

chart_contract
  ChartIntent, DataPlan once implemented, ChartSpec validation, chart proposal creation.

golden_regression
  Prompt/workbook cases that should survive implementation changes.

deprecated_candidate
  Tests whose behavior is no longer in docs and has replacement coverage.
```

### Near-Term Actions

1. Add a short test inventory section to `doc/task-checklist.md` or a dedicated `doc/backend-test-map.md`.
2. Split oversized route coverage in `backend/src/saas/routes/saasRoutes.test.js` into focused files:
   - auth/project/profile
   - import/apply/refresh/supplement
   - source documents/extract proposals
   - chart interpret/propose/specs
   - AgentRun
   - manuscripts
3. Keep `backend/src/server.test.js` until local/dev compatibility endpoints are explicitly retired.
4. Keep deterministic workbook scanner/index tests; they become SourceDocument/WorkbookReviewSession foundation tests.
5. Convert repeated prompt cases into reusable fixture helpers for golden regression tests.
6. Mark true deletion candidates only after:
   - the old API is removed from `doc/contracts/backend-api-contract.md` or `doc/contracts/saas-api-contract-v0.md`
   - the new API has equivalent route/service coverage
   - server project frontend no longer calls the old API
   - `npm --prefix backend test` passes without the old file

### Deletion Rules

A backend test may be deleted only when all are true:

- The tested behavior is no longer part of active or compatibility docs.
- No frontend or backend code path still calls that behavior.
- Replacement tests cover the same scientific risk or user-visible contract.
- The deletion is mentioned in `doc/PROGRESS.md`.
- Full backend verification passes.

Tests should be rewritten, not deleted, when:

- the behavior still exists but the object names change
- the same endpoint starts returning a richer object
- old ChartSpec behavior remains valid alongside DataPlan-backed behavior
- compatibility mode remains documented

### Verification

For test cleanup-only milestones:

```bash
npm --prefix backend test
git diff --check
```

When route files are split or shared helpers are introduced:

```bash
node --test backend/src/saas/routes/*.test.js
npm --prefix backend test
npm run build
```

Done when backend tests are mapped to current product boundaries, oversized route tests are split, and deprecated coverage is removed only after replacement coverage is proven.

## Detailed Verification Prompts

Use these as recurring regression prompts. They should be implemented with synthetic fixtures first, then optionally smoke-tested with private real workbooks outside Git.

### Import Understanding

Prompt:

```text
Sheet1 P31 to BA32 is carbon number distribution. Use row 31 as C number labels and row 32 as percentages.
```

Expected:

- creates an `UnderstandingPatch`
- preview shows component rows with `carbon_number` and `percentage`
- source refs cite `Sheet1!P31:BA32`
- no dataset commit is created until confirmation

### Manual Multi-Region Selection

Interaction:

```text
Open uploaded workbook
  -> select Sheet1
  -> right-click drag/select P31:BA32 -> Mark as data source
  -> right-click drag/select D40:H60 -> Mark as data source
```

Expected when backend is confident:

- red boxes appear over `Sheet1!P31:BA32` and `Sheet1!D40:H60`
- each red box has its own draft region id and status
- backend returns generated explanations one region at a time
- frontend shows separate proposed `UnderstandingPatch` records
- no durable understanding or dataset commit is created until confirmation

Expected when backend is not confident:

- each red box remains as a draft selected range
- backend returns `region_description_required` for the specific draft region it cannot infer
- frontend asks the user to describe that selected range in natural language
- user description creates a patch for that region only
- once multiple regions are confirmed, the refreshed preview can combine them

### Source Extract Promotion Choice

Interaction:

```text
Confirm SourceExtractProposal for Sheet1!P31:BA32
```

Expected chart-local path:

- accepted extract remains source-backed evidence
- no DatasetCommit is created
- user can create a DataPlan/DataSnapshot for a chart from that accepted extract
- Experiment Browser and general project field inventory do not treat it as reusable project data

Expected promotion path:

```text
Promote accepted extract to project dataset
```

- a new DatasetCommit is created
- promoted fields/series become reusable by Browser, AI context, chart proposals, and cross-compare templates
- accepted extract remains separately auditable as the source of the commit
- existing chart-local snapshots are not mutated

### Explicit Source Range

Prompt:

```text
draw carbon balance distribution of experiment 33, bar chart, using c-number distribution data from P31 to BA32 in calculation33 in Sheet1
```

Expected:

- evidence intent parses range `P31:BA32`, workbook hint `calculation33`, sheet `Sheet1`, alias `Exp33`
- source extract proposal is created
- response does not ask "Which C-number fields?"
- response does not ask "Which sheet contains P31:BA32?" when `Sheet1` validates

### Reaction-Rate Cross-Compare

Prompt:

```text
i want a cross-compare chart for every experiment, x axis is reaction time, y axis is reaction rate
```

Expected:

- resolves active reaction-rate ObservationSeries
- creates DataPlan/DataSnapshot with one series per experiment
- returns included/skipped experiment summary
- ChartSpec v1.4 uses `seriesScope`
- missing experiments are not invented

### Source Cross-Compare

Prompt:

```text
draw a cross-compare carbon balance distribution chart for experiments 33, 34, and 35 using c-number distribution data from P31 to BA32 in calculation files
```

Expected:

- resolves one calculation workbook per requested experiment
- returns source extract series for Exp33, Exp34, Exp35
- blocks if any selected experiment is missing/unresolved
- preserves cell-level source refs for each series

### Nonexistent Experiment

Prompt:

```text
draw reaction rate chart for experiment 999
```

Expected:

- no ChartSpec
- no fake chart
- clarification explains Exp999 was not found

### Visual-Only Edit

Prompt:

```text
make Exp35 red and move the legend to the right
```

Expected:

- creates visual patch only
- no DataPlan/DataSnapshot re-execution
- fails with clarification if Exp35 is not a series in the current chart

### Frontend Entrypoint Parity

Prompt entered from Chart Review one-chart prompt, LabRat conversation drawer, and ChartSpec natural-language create:

```text
i want a cross-compare chart for every experiment, x axis is reaction time, y axis is reaction rate
```

Expected:

- all three entrypoints call the same project-scoped chart intent client/gateway in server mode
- all three produce the same next review object type
- no entrypoint creates a ChartSpec before the DataPlan/chart proposal review boundary
- LabRat chat may show the result as an action card, but the underlying next step matches Chart Review
- Manuscript insert only becomes available after an approved ChartSpec or FigurePackage exists

Prompt entered from Chart Review one-chart prompt and LabRat conversation drawer:

```text
draw carbon balance distribution of experiment 33, bar chart, using c-number distribution data from P31 to BA32 in calculation33 in Sheet1
```

Expected:

- both entrypoints create or link to source extract review first
- neither entrypoint falls back to dataset-field clarification
- neither entrypoint creates a ChartSpec directly from the source range prompt

## Guardrails

- Do not send full raw workbooks or full source cell grids to AI providers.
- Do not treat embedding/RAG text as scientific truth unless it resolves to source-backed records.
- Do not allow AI to generate final data arrays.
- Do not allow AI to generate arbitrary Plotly JSON.
- Do not execute arbitrary Python, SQL, JavaScript, or workbook macros for charting.
- Do not silently apply imports, source extracts, mappings, DataPlans, ChartSpecs, FigurePackages, or Manuscript placements.
- Do not hide warnings, skipped experiments, low confidence, or source ambiguity.
- Do not auto-update manuscript figures when source data changes.
- Do not delete historical ChartSpecs/FigurePackages merely because a newer dataset commit exists.
- Do not add old IndexedDB or `.labrat.json` migrations unless explicitly requested.
- Keep logged-in server project state as the source of truth.

## Deferred

- Full semantic lakehouse or relational measurement split.
- Dataset promotion for every source extract.
- Methodology versioning and recompute proposals beyond basic DataPlan dependency tracking.
- Arbitrary code execution for calculations.
- Vector/embedding search as the primary scientific source of truth.
- Full PDF source understanding.
- Public/general MCP server before internal APIs, audit, permissions, and review boundaries are stable.
- OAuth/SSO, billing, hosted operations, and cloud worker queue.
- Template memory trusted auto-apply without review.

## Near-Term Recommendation

Implement the next work in this order:

1. Immediate bridge: Source Extract Review Bridge in Chart Review and LabRat chat.
2. Immediate cleanup: Overview entrypoint governance and labels.
3. Phase 0 contracts and fixtures.
4. Evidence Retrieval contracts for read-only project search, data QA, and future MCP adapter boundaries.
5. Phase 1 readable WorkbookIndex/import preview.
6. Phase 2 conversational import review with structured patches.
7. Phase 3 WorkbookUnderstanding versions.
8. Phase 4 DataPlan/DataSnapshot foundation.
9. Phase 5 reaction-rate cross-compare through DataPlan.

Run the Backend Test Cleanup Track in parallel, starting with a test inventory and splitting `saasRoutes.test.js`. Do not delete compatibility tests until the corresponding compatibility contract is explicitly retired.

Run Phase 11 legacy workflow retirement only after the unified frontend chart intent client, DataPlan-backed chart paths, Manuscript insertion path, and golden workbook suite are passing. Treat cleanup as a series of small removal slices, not one broad rewrite.

This sequence solves the user's current pain first: users can see what LabRat imported, correct it in natural language, verify what data enters a chart, and avoid wrong-supplement or fake-experiment chart generation. FigurePackage and precise stale tracking should follow once data review and chart data snapshots are stable.
