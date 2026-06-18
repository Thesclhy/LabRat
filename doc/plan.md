# Current Development Plan

This is the active execution plan for the current repository state. Historical checkpoint detail belongs in `doc/PROGRESS.md`; do not turn this file into a running log.

## Current Focus

LabRat Blank has moved beyond a button-first import/chart app. The next active milestone is:

```text
Agent-first evidence workflow
  -> evidence graph primitives
  -> observation series registry
  -> analysis views
  -> controlled agent runs
  -> proposal review
  -> human-confirmed execution
  -> chart specs / dataset commits / manuscript output
```

The product goal is an AI workflow agent for lab data:

> LabRat should inspect evidence, draft auditable analysis views, propose charts/data actions, and execute only after human confirmation.

This plan supersedes the previous "server workflow hardening" active milestone. Server reliability, Docker/Postgres readiness, and audit/admin usability remain guardrails and verification requirements, but the main product implementation target is now the agent-first evidence workflow.

For the deeper long-term source architecture, also read `doc/source-understanding-long-term-plan.md`.

## Current State

Already implemented:

- Docker Compose local stack with Postgres, backend, and frontend.
- Auth v0 with users, sessions, roles, labs, and projects.
- Server-backed project dashboard, project creation/opening, profile editing, and project state loading.
- File objects, import runs, normalize previews, immutable dataset commits, refresh/replace, mapping sets, chart proposal sets, chart specs, manuscripts, supplemental import batches, and audit events.
- Generic Excel scan/normalize/apply with grouped headers, source refs, warnings, and confidence.
- Supplemental workbook flow that can attach detailed workbooks to existing experiments.
- Reaction-rate supplemental workbooks normalized as `observationSets`.
- Imported Experiment Browser rows driven by generic imports and accepted semantic mappings.
- Chart Proposal v2 and ChartSpec v1.3 with validated backend field resolution, transforms, axis options, and render style hints.
- Manuscript chart insertion from durable ChartSpecs, with chart snapshots and `chartView.selectedExperimentIds`.
- Server-backed project chat planner that returns safe action cards for uploads, supplements, chart proposals, chart interpretation, ChartSpec creation, and data queries.

Main missing pieces:

- Raw workbook source evidence is not persistently queryable after scan.
- Supplemental `observationSets` are not yet normalized into a first-class cross-experiment series registry.
- There is no persisted `AnalysisView` layer between evidence and chart proposals.
- The project chat planner is still a deterministic action-card router, not a controlled evidence/tool workflow.
- Anthropic usage/cost is not recorded.
- Manuscript compare UI exists in seed form, but does not yet provide a polished searchable multi-experiment compare interaction.

## Architecture Design

### 1. Evidence Graph

Use the term "Evidence Graph" for the conceptual model. V1 does not require a graph database; use explicit tables/records plus ids/source refs.

Core node types:

```text
FileObject
SourceDocument
SourceRegion
SourceRange
GenericImport
Experiment
ObservationSet
ObservationSeries
DatasetCommit
MappingSet
AnalysisView
ChartProposalSet
ChartSpec
ManuscriptBlock
AgentRun
AuditEvent
```

Core relationships:

```text
file contains source document
source document has source region
source region exposes source range
source range can draft source extract proposal
generic import creates experiments or observation sets
observation set belongs to one or more experiments
observation series is derived from observation set fields
analysis view uses evidence nodes
chart proposal is derived from analysis view
chart spec is created from accepted proposal
manuscript block snapshots chart spec
agent run records evidence retrieval, proposal drafting, and confirmed execution
```

Implementation default:

- Keep existing dataset commits as the accepted data source of truth.
- Add evidence records around them; do not rewrite existing committed payload shapes in place.
- Store source refs everywhere a value or chart uses source evidence.
- Keep lab/project role checks server-side for every evidence endpoint.

### 2. Observation Series Registry

Purpose: make cross-experiment supplemental data comparable.

Reaction-rate supplements currently normalize into `genericImport.observationSets[]`. V1 should derive first-class `ObservationSeries` records from those observation sets.

Example shape:

```json
{
  "seriesId": "series_exp30_reaction_rate_adjusted",
  "projectId": "project_...",
  "datasetCommitId": "commit_...",
  "experimentId": "exp_30",
  "experimentLabel": "Exp30",
  "seriesKind": "reaction_rate_time_series",
  "xField": "reaction_time_min",
  "yField": "adjusted_rate_m_s",
  "sourceImportId": "import_...",
  "observationSetId": "import_..._obsset_1",
  "sourceRefs": [],
  "summary": {
    "pointCount": 62,
    "xMin": 0,
    "xMax": 300
  },
  "status": "active"
}
```

Rules:

- Derive series from the current dataset commit.
- Include dataset commit id so stale series can be detected after refresh/replace.
- Support `reaction_rate_time_series` first.
- Design the shape so future series kinds can include GC distributions, sweep curves, calibration tables, and source-extracted component distributions.
- Do not make one ChartSpec per experiment for compare workflows; one compare ChartSpec should be able to resolve many series.

### 3. Analysis Views

Purpose: represent a reviewable analysis intent before charting or table rendering.

V1 view types:

```text
series_compare
source_range_extract
data_table
chart_ready
```

Example `series_compare` view:

```json
{
  "schemaVersion": "labrat.analysisView.v1",
  "viewType": "series_compare",
  "status": "draft",
  "title": "Reaction rate comparison",
  "seriesKind": "reaction_rate_time_series",
  "experimentIds": ["exp_1", "exp_2", "exp_3"],
  "xField": "reaction_time_min",
  "yField": "adjusted_rate_m_s",
  "groupBy": "experiment",
  "sourceRefs": [],
  "warnings": []
}
```

Rules:

- Analysis Views are proposals/drafts, not accepted scientific data.
- Chart proposals should be derived from Analysis Views when possible.
- A View can be started by chat, Supplemental Manager, Source Explorer, Browser detail, or Chart Review.
- View creation must not mutate dataset commits.

### 4. Controlled Agent Runs

LabRat should use controlled ReAct-style workflows, not a free autonomous LLM agent.

Agent loop model:

```text
reason over user goal
  -> call allowlisted read-only evidence tools
  -> observe structured evidence
  -> draft AnalysisView or proposal
  -> show visible trace and action cards
  -> wait for user confirmation
  -> call deterministic execution APIs
```

Agent run lifecycle:

```text
created
planning
retrieving_evidence
drafting_view
drafting_proposal
waiting_for_user
executing_confirmed_action
completed
failed
cancelled
```

Visible trace example:

```text
Checked project dataset
Found 3 reaction-rate supplemental series
Resolved x-axis: Reaction Time (min)
Resolved y-axis: Adjusted Rate (M/s)
Drafted a compare chart proposal
```

Do not expose hidden chain-of-thought. Store and display concise, auditable trace events.

Allowed read-only tools:

```text
getProjectSummary
searchEvidence
searchDataCatalog
listExperiments
listObservationSeries
listSourceDocuments
listSourceRegions
findSourceText
readSourceRange
inspectSourceCell
listChartSpecs
```

Allowed drafting tools:

```text
draftAnalysisView
draftSourceExtractProposal
draftChartProposal
draftViewIntent
```

Execution tools are gated by explicit user confirmation:

```text
acceptProposal
createChartSpec
applyImportRun
promoteSourceExtractToDataset
insertChartIntoManuscript
```

### 5. Source Workspace

Purpose: make uploaded Excel workbooks queryable as source evidence without sending entire workbooks to Anthropic.

Records:

```text
source_documents
source_regions
source_index_blobs
source_extract_proposals
```

Storage strategy:

- Store `source_documents`, `source_regions`, and proposal metadata in DB.
- Store large cell grids/range indexes in local file/blob storage and reference them through `source_index_blobs`.
- Do not include full source cell grids in `GET /api/projects/:projectId/state`.
- Do not send full raw workbooks to model APIs.

V1 file type:

- Excel only.
- CSV/PDF source understanding is deferred.

## Public API And Data Model Additions

### Agent APIs

Add:

```text
POST /api/projects/:projectId/agent/runs
GET  /api/agent-runs/:agentRunId
POST /api/agent-runs/:agentRunId/confirm
POST /api/agent-runs/:agentRunId/cancel
```

Keep:

```text
POST /api/projects/:projectId/agent/plan
```

`/agent/plan` remains the simple compatibility path. New agent-first workflows should use `/agent/runs`.

`POST /agent/runs` request:

```json
{
  "message": "compare reaction rate for Exp1, Exp2, Exp3",
  "selectedContext": {},
  "modeHint": "auto"
}
```

Response:

```json
{
  "agentRun": {},
  "visibleSteps": [],
  "analysisView": {},
  "proposals": [],
  "actions": [],
  "warnings": []
}
```

### Source APIs

Add:

```text
GET  /api/projects/:projectId/source-documents
GET  /api/source-documents/:sourceDocumentId/regions
POST /api/source-documents/:sourceDocumentId/query
POST /api/source-documents/:sourceDocumentId/range
POST /api/source-regions/:sourceRegionId/extract-preview
POST /api/projects/:projectId/source-extract-proposals
PATCH /api/source-extract-proposals/:proposalId
```

Permission defaults:

- Viewer can read source documents, regions, bounded ranges, and extract previews.
- Editor can create/update extract proposals.
- Cross-lab access is forbidden.
- Oversized range reads return a clear validation error.

### Observation Series And Analysis View APIs

Add:

```text
GET  /api/projects/:projectId/observation-series
POST /api/projects/:projectId/analysis-views
GET  /api/projects/:projectId/analysis-views
POST /api/analysis-views/:analysisViewId/chart-proposal
```

Rules:

- Observation series are scoped to project and dataset commit.
- Analysis Views are project-scoped draft/proposal records.
- Chart proposal creation from Analysis View should reuse existing chart proposal set review flow.

### ChartSpec v1.4 Compatibility

Preserve ChartSpec v1.3. Add v1.4-compatible fields for agent-first workflows.

For supplement compare:

```json
{
  "schemaVersion": "labrat.chartSpec.v1.4",
  "origin": "analysis_view",
  "analysisViewId": "analysis_view_...",
  "chartType": "scatter",
  "seriesScope": {
    "seriesKind": "reaction_rate_time_series",
    "xField": "reaction_time_min",
    "yField": "adjusted_rate_m_s",
    "groupBy": "experiment"
  },
  "compatibleExperimentIds": ["exp_1", "exp_2", "exp_3"]
}
```

For source-backed charts:

```json
{
  "schemaVersion": "labrat.chartSpec.v1.4",
  "origin": "source_extract",
  "sourceExtractProposalId": "source_extract_proposal_...",
  "datasetCommitId": null,
  "sourceSnapshot": {
    "fields": [],
    "rows": []
  },
  "sourceRefs": []
}
```

Validation rules:

- Dataset-backed ChartSpecs continue to require dataset commit validation.
- Analysis-view-backed ChartSpecs must resolve against the current dataset commit and compatible observation series.
- Source-backed ChartSpecs may have `datasetCommitId: null`, but must have immutable `sourceSnapshot` and exact `sourceRefs`.
- Manuscript blocks continue storing ChartSpec snapshots for historical rendering.
- UI must show chart origin: dataset-backed, analysis-view-backed, or source-backed.

## UI And Interaction Plan

### Agent Drawer

Transform the agent drawer from chat + action cards into a workflow panel.

Interaction:

1. User enters a goal, for example `compare reaction rate for Exp1, Exp2, Exp3`.
2. Frontend calls `POST /api/projects/:projectId/agent/runs`.
3. Drawer shows run status and visible trace.
4. If a view/proposal is drafted, drawer shows a compact preview card.
5. User can open full Review modal, accept proposal, create ChartSpec, or insert into Manuscript.
6. Mutating actions call confirm endpoints or existing reviewed APIs.

UI states:

- Empty: suggested project goals and examples.
- Running: step list with current step spinner.
- Needs clarification: concise question plus options when backend returns multiple plausible evidence matches.
- Waiting for confirmation: action cards with clear consequences.
- Completed: links to created AnalysisView, ChartSpec, or Manuscript insertion.
- Failed: error plus retry when safe.

### Supplemental Manager Compare Flow

Add a `Compare series` action to Supplemental Workbooks manager.

Interaction:

1. User opens Supplemental Workbooks.
2. User selects one or more applied supplement files or experiments.
3. User clicks `Compare series`.
4. Frontend starts an AgentRun with selected supplement context.
5. Agent resolves compatible `ObservationSeries`.
6. Agent drafts a `series_compare` AnalysisView and chart proposal.
7. User reviews proposal, creates ChartSpec, and inserts into Manuscript.

Important UX behavior:

- If only one supplement type is present, preselect it.
- If multiple y fields exist, default to `adjusted_rate_m_s` for reaction rate and show alternatives.
- Show source file names and target experiment labels.
- If selected experiments do not share compatible x/y fields, return a clarification instead of generating an invalid chart.

### Manuscript Compare Chart Controls

Improve current `chartView.selectedExperimentIds` interaction.

Insert modal:

- Search experiments.
- Select all / Clear.
- Show `N of M selected`.
- Show experiment labels with source file detail.
- Preview chart updates as selection changes.
- Require at least one compatible experiment before insert.

Inspector:

- Same searchable multi-select for an existing chart block.
- Show `N of M shown`.
- Show series kind and y field.
- Keep layout controls separate from data-selection controls.

Rendering:

- One selected experiment = one trace.
- Multiple selected experiments = one trace per experiment.
- Legend names use experiment labels.
- Missing/empty series show a compact warning, not a blank mysterious chart.

### Source Explorer

Add a compact Source Explorer modal/panel.

Layout:

```text
left: source documents and sheets
middle: detected regions / search results
right: range preview and extract preview
```

Interactions:

- Search source text, labels, sheet names, and ranges.
- Click a region to preview range.
- Click `Draft extract` to create a source extract proposal.
- Click `Use in agent` to start an AgentRun with that source context.
- Show raw value, formatted value, formula, source address, and warnings where available.

### Chart Review

Extend Review Chart Proposals.

Display:

- Origin badge: `Dataset`, `Analysis view`, `Source extract`, or `Agent`.
- AnalysisView summary for compare charts.
- Compatible experiments count.
- Source range citations for source-backed charts.
- Warning if a proposal uses stale series or stale dataset commit.

Actions:

- Accept / Reject.
- Create ChartSpec.
- Insert into Manuscript after ChartSpec creation.
- For source-backed proposals, show source snapshot preview.

### Overview

Add compact status surfaces:

- `Observation series`: count by type, with `Compare` action when series exist.
- `Agent runs`: active/pending runs with resume/open action.
- `Source evidence`: source documents and warnings.
- Existing charts card should still show specs, proposals, accepted/pending counts.

Keep Overview dense and workflow-oriented.

## Implementation Steps

### Phase 0: Contracts, Fixtures, And Guardrails

1. Update `doc/saas-api-contract-v0.md` with AgentRun, Source, ObservationSeries, AnalysisView, and ChartSpec v1.4 additions.
2. Update `doc/saas-database-schema-v0.md` with proposed tables/columns.
3. Update `doc/canonical-data-dictionary.md` with ObservationSeries and AnalysisView terms.
4. Update `doc/ai-boundaries.md` with controlled AgentRun rules and no-full-workbook prompt policy.
5. Add or identify fixtures for:
   - master table with Exp1/Exp2/Exp3
   - reaction-rate supplements for Exp1/Exp2/Exp3
   - source workbook with C-number distribution
   - ambiguous source range
6. Define test helper utilities for creating applied supplement commits and source scan records.

Done when contracts describe all new records and test fixtures can exercise the first acceptance workflows.

### Phase 1: Observation Series Registry

1. Add Memory/Postgres store support for `observation_series`.
2. Derive reaction-rate series from applied supplemental `observationSets`.
3. Persist or rebuild series after `supplement_import` apply.
4. Include dataset commit id, import id, observation set id, experiment id/label, x/y field, point count, and source refs.
5. Add `GET /api/projects/:projectId/observation-series`.
6. Add stale decoration when series dataset commit is not current.

Done when Exp1/Exp2/Exp3 reaction-rate supplements list as comparable active series.

### Phase 2: Series Compare Analysis Views

1. Add Memory/Postgres store support for `analysis_views`.
2. Add `POST /api/projects/:projectId/analysis-views`.
3. Implement `series_compare` resolver:
   - match experiment aliases such as `Exp1`
   - match series kind
   - choose compatible x/y fields
   - return clarification when ambiguous
4. Add `POST /api/analysis-views/:analysisViewId/chart-proposal`.
5. Reuse existing chart proposal set persistence and review state.

Done when a compare AnalysisView can become a reviewable chart proposal.

### Phase 3: Dynamic Series Chart Rendering

1. Extend chart spec normalization to accept v1.4 `seriesScope`.
2. Extend backend ChartSpec validation for analysis-view-backed series specs.
3. Extend frontend chart preview to resolve traces from `ObservationSeries`/current dataset, not only fixed sourceIds.
4. Preserve current fixed-source v1.3 rendering.
5. Add missing-series warnings and empty chart states.

Done when one ChartSpec can render multiple reaction-rate experiments as separate traces.

### Phase 4: Manuscript Compare UI

1. Improve Insert Approved Chart modal with searchable compatible experiment selection.
2. Improve chart inspector Included Experiments panel with search, Select all, Clear, and `N of M shown`.
3. Store selected experiment ids in chart block `chartView`.
4. Ensure chart blocks render only selected experiment traces.
5. Preserve selection through save/reload/export.

Done when the user can insert one reaction-rate compare chart and quickly switch which experiments are visible.

### Phase 5: Source Document Index

1. Add store support for `source_documents`, `source_regions`, and `source_index_blobs`.
2. Persist source document metadata from workbook scan.
3. Persist region summaries from existing scan regions/blocks.
4. Store large cell grid/range index payloads through blob/file references.
5. Add source list/query/range APIs.
6. Enforce range size caps and project authorization.

Done when an uploaded workbook can be searched and a specific range can be previewed after upload.

### Phase 6: Source Extract Proposals

1. Add `source_extract_proposals`.
2. Implement extract preview for generic table/range regions.
3. Implement component distribution extraction for C-number style source ranges.
4. Preserve source refs per extracted value.
5. Allow accepted source extract proposals to draft chart proposals.
6. Do not mutate dataset commits in v1.

Done when `Overall tots row 69` can become a source extract proposal with exact workbook citations.

### Phase 7: Controlled AgentRun

1. Add `agent_runs` store support.
2. Add AgentRun APIs.
3. Implement a deterministic workflow runner with visible trace events.
4. Add tool adapters for project summary, data catalog, observation series, source documents, source ranges, AnalysisView drafting, and chart proposal drafting.
5. Add optional Anthropic calls for intent/ranking/explanation only.
6. Capture token usage and estimated cost where provider usage is available.
7. Return clarification when evidence is missing or ambiguous.
8. Keep all mutations behind confirm endpoints/action cards.

Done when chat can drive both proof cases:

- `compare reaction rate for Exp1, Exp2, Exp3`
- `use Overall tots row 69 to plot Exp30 carbon number distribution`

### Phase 8: Agent-First Frontend Integration

1. Rework Agent drawer around AgentRun status, trace, proposals, and actions.
2. Wire Supplemental Manager `Compare series` to AgentRun.
3. Wire Source Explorer `Use in agent` and `Draft chart`.
4. Wire Chart Review to show analysis/source/agent origins.
5. Add Overview cards for observation series, source evidence, and active agent runs.
6. Keep existing direct buttons for users who do not want chat.

Done when chat and UI entrypoints converge on the same backend AgentRun/proposal workflow.

### Phase 9: Documentation And Hardening

1. Update README documentation map if new docs are added.
2. Update `doc/PROGRESS.md` after each meaningful implementation checkpoint.
3. Add API examples to contract docs.
4. Run full test/build verification.
5. Run Docker/Postgres smoke when schema changes.

Done when another engineer can clone, run, test, and manually verify the agent-first workflows.

## Verification Plan

### Backend Tests

Required coverage:

- Observation series derived from reaction-rate supplements.
- Observation series list endpoint enforces project/lab permissions.
- Stale series decoration after dataset refresh.
- Series compare resolver finds Exp1/Exp2/Exp3 and rejects missing experiments.
- AnalysisView persists and derives chart proposal.
- ChartSpec v1.4 validates analysis-view-backed series specs.
- Source document and source region persistence from Excel scan.
- Source range API returns raw/formatted values and rejects oversized reads.
- Source extract proposal preserves source refs.
- Source-backed ChartSpec stores source snapshot and source refs.
- AgentRun creates visible trace and does not mutate project state during planning.
- AgentRun confirmation executes only approved actions.
- Anthropic usage/cost metadata is stored when available.
- Memory and Postgres stores have parity.

### Frontend Tests

Required coverage:

- Supplemental Manager starts compare flow.
- Agent drawer displays running/completed/failed trace states.
- Agent proposal cards can open Chart Review.
- Chart Review renders dataset, analysis-view, source, and agent origin badges.
- Insert Approved Chart modal supports searchable multi-experiment selection.
- Inspector can switch included experiments for an existing chart block.
- Compare chart renders one trace per selected experiment.
- Existing dataset-backed ChartSpecs still render.
- Existing Import/Refresh, Semantic mappings, Browser, and Manuscript flows remain intact.

### Manual QA

Required scenarios:

1. Start Docker stack.
2. Login as seeded `labuser`.
3. Create/open a project.
4. Upload master table.
5. Upload Exp1/Exp2/Exp3 reaction-rate supplemental workbooks.
6. Ask Agent: `compare reaction rate for Exp1, Exp2, Exp3`.
7. Confirm it finds the right series and drafts a compare chart proposal.
8. Accept proposal and create ChartSpec.
9. Insert ChartSpec into Manuscript.
10. Toggle visible experiments in chart inspector.
11. Save/reload project and confirm selection persists.
12. Upload or inspect a workbook with a C-number distribution range.
13. Ask Agent to use a specific row/range to draft a chart.
14. Confirm no full workbook payload is sent to Anthropic.

### Commands

After behavior changes:

```bash
npm test
npm --prefix backend test
npm run build
```

For schema/Docker changes:

```bash
docker compose config
npm run dev:docker
npm --prefix backend run test:postgres
```

## AI And Cost Policy

Anthropic is optional and bounded.

Rules:

- Send compact project context.
- Send only selected source ranges when needed.
- Never send full raw workbooks or full source cell grids.
- AI may suggest intent, ranking, labels, explanations, and clarification questions.
- Backend tools retrieve and validate evidence.
- Backend tools create proposals.
- User confirmation is required before mutation.

Track on `agent_runs` and proposal metadata when available:

```text
provider
model
input_tokens
output_tokens
estimated_cost_usd
prompt_cache_read_tokens
prompt_cache_write_tokens
```

## Guardrails

- Do not turn LabRat into an autonomous data-mutating agent.
- Do not execute arbitrary Python/code for calculations.
- Do not create direct AI-generated Plotly JSON.
- Do not bypass import review, mapping review, chart proposal review, or ChartSpec validation.
- Do not hide source refs, warnings, or low-confidence evidence.
- Do not add old IndexedDB or `.labrat.json` migrations.
- Keep logged-in server project state as the source of truth.
- Keep stateless local/dev endpoints compatible where they already exist.
- Keep source-backed charts visibly different from dataset-backed charts.
- Keep `doc/PROGRESS.md` as the durable progress log.

## Deferred

- MCP server.
- PDF source understanding.
- CSV-specific source indexing beyond existing import paths.
- Dataset promotion for source extracts.
- Full methodology versioning and recompute proposals.
- Arbitrary code execution for charting or calculations.
- Template memory trusted auto-apply.
- Cloud worker queue and managed object storage hardening.
- OAuth/SSO, billing, and hosted SaaS operations.
