# LabRat Architecture

LabRat is a reproducibility-first research command center for catalysis labs. It turns scattered spreadsheets and instrument outputs into source-backed datasets, then carries those datasets into charts, manuscripts, and PPTX output without losing review history.

## Product Narrative

The core workflow is:

```text
raw files
  -> import proposals
  -> human review
  -> dataset commits
  -> evidence graph / analysis views
  -> Experiment Browser
  -> chart specs
  -> manuscript canvas
  -> PPTX export
```

The product promise is not only "upload Excel and draw charts." LabRat should answer: "How exactly was this number produced, from which raw file, using which method, and who approved it?"

## Current Implementation

The current blank app is a server-first workspace with local/dev compatibility paths:

- React/Vite frontend.
- Node API backend.
- Docker Compose local stack with Postgres, backend, and frontend.
- Postgres-backed SaaS store when `DATABASE_URL` is set.
- In-memory backend store for local no-Postgres development and tests.
- IndexedDB and `.labrat.json` retained for logged-out/local experiments, not as a server migration target.
- Local/dev stateless scan/normalize/semantic-map/chart endpoints kept for compatibility.
- Server project state is the source of truth for logged-in lab workspaces.

## Runtime Topology

Local Docker development:

```text
Browser
  -> Vite frontend :5173
      -> Node API :8787
          -> Postgres :5432
          -> local uploaded-file volume
```

The recommended command is:

```bash
npm run dev:docker
```

Docker Compose runs migrations, seeds local development accounts when enabled, starts the backend on `8787`, and serves the frontend on `5173`.

## Server Workspace Flow

- **Login** authenticates a username/password user with an httpOnly session.
- **Projects Dashboard** lists lab-scoped projects and lets a user create/open one.
- **Project Profile** stores research goal, experiment background, materials, methods, instruments, notes, and tags in `projects.metadata.projectProfile`.
- **Import/Refresh Review** persists file objects and import runs, scans workbooks, normalizes previews, and applies reviewed data as dataset commits.
- **Evidence Graph** is the planned factual layer around files, source documents, source regions, generic imports, experiments, observation series, analysis views, chart specs, manuscripts, and audit events.
- **Observation Series Registry** is the planned layer for comparable supplemental series such as reaction-rate time series across experiments.
- **Analysis Views** are planned reviewable intents such as `series_compare`, `source_range_extract`, and `data_table` before chart proposals or table rendering.
- **Experiment Browser** reads from the current dataset commit and accepted mappings.
- **Chart Proposal Review** creates reviewable chart drafts from project data and user prompts.
- **Chart Specs** are durable, validated chart definitions tied to a dataset commit.
- **Agent Runs** are the planned controlled workflow records that retrieve evidence, draft views/proposals, show visible trace steps, and wait for user confirmation before mutations.
- **Manuscript / Present** persists canvas blocks/pages and inserts charts by chart spec id plus snapshot.
- **Audit Events** record important actions and review decisions.

## Backend Components

- **Auth Service** manages users, password hashes, sessions, and lab memberships.
- **Admin Service** manages labs, users, roles, development seed accounts, and password resets.
- **Project Service** stores lab-scoped project shells and current dataset commit refs.
- **File Store** stores immutable raw file metadata and local storage keys.
- **Import Engine** wraps scan/normalize, import-run lifecycle, refresh preview/apply, warnings, and review status.
- **Source Workspace** is planned to persist source documents, source regions, bounded range reads, source index blobs, and source extract proposals.
- **Dataset Store** stores immutable full dataset commits.
- **Observation Series Store** is planned to derive comparable series from current dataset commits and supplemental observation sets.
- **Analysis View Store** is planned to persist reviewable analysis intents before chart/table rendering.
- **Mapping Store** stores semantic mapping proposal sets and user decisions.
- **Chart Store** stores chart proposal sets and durable ChartSpec records. The current implementation uses ChartSpec v1.3; the active plan adds v1.4-compatible analysis-view-backed and source-backed specs.
- **Agent Run Store** is planned to persist controlled workflow traces, proposal refs, warnings, and AI usage/cost metadata.
- **Manuscript Store** stores blocks, pages, canvas state, references, and chart spec snapshots.
- **Audit Log** records auth, admin, upload, import, dataset, mapping, chart, manuscript, and export actions.

## Core Domain Objects

- **User**: login identity with username/password hash.
- **Lab**: workspace boundary for projects and scientific data.
- **LabMembership**: user's role in a lab.
- **Project**: lab-scoped research workspace.
- **ProjectProfile**: editable experiment background in `projects.metadata.projectProfile`.
- **FileObject**: immutable uploaded raw file metadata and storage pointer.
- **ImportRun**: persisted scan/review/normalize/apply lifecycle for an uploaded file.
- **SourceDocument**: planned source index metadata for an uploaded workbook or document.
- **SourceRegion**: planned detected sheet/range/region evidence with confidence and warnings.
- **SourceExtractProposal**: planned reviewable structured extract from a source region/range.
- **DatasetCommit**: immutable accepted full dataset state.
- **ObservationSeries**: planned comparable series derived from supplemental observation sets or source extracts.
- **AnalysisView**: planned reviewable table/chart-ready view intent.
- **MappingSet**: semantic mapping proposal set plus user decisions.
- **ChartProposalSet**: reviewable chart suggestions and decisions.
- **ChartSpec**: durable chart definition that can be rendered or inserted into manuscripts.
- **Manuscript**: persisted canvas state.
- **AgentRun**: planned controlled workflow trace from user goal to evidence retrieval, proposals, and confirmed actions.
- **AuditEvent**: durable record of who did what, when, and why.

## Data Ownership Rules

- Lab-scoped records must include `lab_id`.
- API handlers must enforce membership and role checks server-side.
- Scientific payloads remain JSONB in v0 while behavior stabilizes.
- Raw files are immutable.
- Import apply creates a new dataset commit.
- Refresh/Replace creates a new dataset commit and does not mutate the parent commit.
- Dataset commits store full accepted dataset payloads, not just latest patches.
- Accepted chart proposals create chart specs before manuscript insertion.
- Dataset-backed chart specs reference dataset commits and are validated before persistence.
- Planned source-backed chart specs may use immutable source snapshots and exact source refs instead of a dataset commit.
- Planned analysis-view-backed chart specs may resolve dynamic observation series from the current dataset commit.
- Chart specs tied to replaced dataset commits may be decorated as stale; manuscript blocks keep snapshots for historical rendering.
- Manuscripts reference chart specs and store chart spec snapshots, not raw chart proposals.

## Chart Architecture

LabRat uses an internal ChartSpec contract, not direct AI-generated Plotly JSON.

```text
user prompt or proposal recipe
  -> chart intent
  -> backend field resolve
  -> ChartSpec compile/validate
  -> frontend Plotly preview/render
  -> user review
  -> durable chart_spec
```

ChartSpec v1.3 supports simple and multi-series charts plus allowlisted chart-local transforms such as normalized selectivity bars and C-number distributions, along with controlled axis/style hints such as log axes and Excel-like rendering. Transformed values are for chart rendering only; they do not rewrite dataset commits.

The active plan adds ChartSpec v1.4-compatible fields for:

- analysis-view-backed compare charts over `ObservationSeries`
- source-backed charts with immutable `sourceSnapshot` rows/fields
- explicit chart origin badges such as dataset, analysis view, source extract, or agent

## Agent-First Evidence Workflow

LabRat's next active architecture direction is a controlled workflow agent over project evidence:

```text
user goal
  -> AgentRun
  -> allowlisted evidence tools
  -> AnalysisView or source extract proposal
  -> chart/data proposal
  -> user confirmation
  -> deterministic execution API
```

Agent tools are split into read-only evidence retrieval, draft/proposal creation, and user-confirmed execution. The agent may inspect compact project state, observation series, source regions, source ranges, chart specs, and manuscripts, but it must not mutate scientific data until the user confirms a reviewed action.

## AI And MCP Positioning

AI is a proposal, ranking, explanation, and workflow-planning layer:

- It may map fields, summarize changes, suggest charts, rank candidates, explain warnings, and draft captions.
- It may help draft Analysis Views, source extract proposals, and controlled AgentRun plans.
- It should receive compact project/field/profile/source-range summaries, not full raw workbooks.
- It must not invent values, silently overwrite data, auto-commit imports, or hide uncertainty.
- High-confidence output can be shown as review-ready, but committed scientific data requires a human-reviewed action.

MCP is deferred. A future LabRat MCP server can expose permissioned resources/tools after API, audit, and role checks are stable.

## Local Compatibility

The legacy HDPE-shaped `dataset.experiments[]`, local IndexedDB project storage, `.labrat.json` export/import, and stateless local/dev endpoints remain useful for development and compatibility. New logged-in product work should use server project state and should not add old local-data migration layers unless explicitly requested.
