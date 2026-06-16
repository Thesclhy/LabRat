# LabRat Architecture

LabRat is a reproducibility-first research command center for catalysis labs. It turns scattered spreadsheets and instrument outputs into source-backed datasets, then carries those datasets into charts, manuscripts, and PPTX output without losing review history.

## Product Narrative

The core workflow is:

```text
raw files
  -> import proposals
  -> human review
  -> dataset commits
  -> Experiment Browser
  -> chart specs
  -> manuscript canvas
  -> PPTX export
```

The product promise is not only "upload Excel and draw charts." LabRat should answer: "How exactly was this number produced, from which raw file, using which method, and who approved it?"

## Current Local Implementation

The current blank app is local-first:

- React/Vite frontend
- IndexedDB project persistence through `src/storage/projectStorage.js`
- `.labrat.json` export/import backups
- Node backend with stateless scan/normalize/semantic-map/chart-proposal endpoints
- `dataset.genericImports[]` for approved generic imports
- `dataset.genericMappingSets[]` and `dataset.genericChartProposals[]` for review state
- legacy HDPE-shaped `dataset.experiments[]` compatibility path
- generic Experiment Browser rows derived from `dataset.genericImports[]`
- manuscript canvas and PPTX export

This local foundation should remain usable during the SaaS transition.

## Next Target: Multi-Lab SaaS v0

The next concrete architecture target is:

```text
React frontend
  -> Node API
      -> Postgres
      -> local file storage in v0
      -> admin-created username/password users
      -> role-based lab workspaces
      -> project/import/commit/chart/manuscript APIs
      -> audit events
```

Auth v0 is intentionally simple:

- admin-created accounts
- `username + password`
- httpOnly server sessions
- no email invite
- no SMTP
- no OAuth/SSO
- no billing

Development seed accounts are documented in `backend/README.md`.

## Frontend Workspaces

- **Login / Lab Selection** lets a seeded or admin-created user enter LabRat and choose a lab workspace.
- **Admin** lets a `super_admin`, `lab_owner`, or `lab_admin` create labs/users, reset temporary passwords, and inspect audit summaries.
- **Projects** lists lab-scoped projects from the server.
- **Import & Review** accepts master tables, calculation workbooks, instrument exports, and CSV files. In SaaS mode, uploads become immutable file objects and import runs.
- **Experiment Browser** reads from the current dataset commit and shows source-backed generic and curated rows.
- **Chart Builder** creates chart specs from accepted proposals, mappings, and known dataset commits.
- **Manuscript / Present** persists canvas blocks/pages server-side. Generic chart blocks should reference chart specs rather than raw chart proposals.
- **AI Agent** proposes imports, mappings, chart ideas, captions, and explanations, but does not silently commit data.

## Backend Components

- **Auth Service** manages users, password hashes, sessions, and lab memberships.
- **Admin Service** manages labs, users, roles, development seed accounts, and password resets.
- **Project Service** stores lab-scoped project shells and current dataset commit refs.
- **File Store** stores immutable raw file objects with checksum, filename, uploader, timestamp, and storage key.
- **Import Engine** wraps the existing scan/normalize pipeline and persists import runs, review decisions, previews, warnings, and apply status.
- **Dataset Store** stores immutable dataset commits. Each accepted import creates a new commit.
- **Mapping Store** stores semantic mapping proposals and accepted/rejected decisions without rewriting raw imports.
- **Chart Store** stores chart proposal sets and durable chart specs.
- **Manuscript Store** stores blocks, pages, canvas state, references, and chart spec references.
- **Audit Log** records login/logout, admin actions, uploads, import apply, dataset commits, chart spec creation, manuscript saves, and exports.

## Core Domain Objects

- **User**: login identity with username/password hash.
- **Lab**: workspace boundary for projects and scientific data.
- **LabMembership**: user's role in a lab.
- **Project**: lab-scoped research workspace.
- **FileObject**: immutable uploaded raw file metadata and storage pointer.
- **ImportRun**: persisted scan/review/normalize/apply lifecycle for an uploaded file.
- **DatasetCommit**: immutable accepted state of experiment, metadata, measurement, and field values.
- **MappingSet**: semantic mapping proposal set plus user decisions.
- **ChartProposalSet**: reviewable chart suggestions.
- **ChartSpec**: durable chart definition that can be rendered or inserted into manuscripts.
- **Manuscript**: persisted canvas state.
- **AuditEvent**: durable record of who did what, when, and why.

## Data Ownership Rules

- Lab-scoped records must include `lab_id`.
- API handlers must enforce membership/role checks server-side.
- Scientific payloads can remain JSONB in v0 while behavior stabilizes.
- Raw files are immutable.
- Import apply creates a new dataset commit.
- Accepted chart proposals create chart specs.
- Manuscripts reference chart specs, not raw proposals.
- Local IndexedDB and `.labrat.json` remain backup/migration paths.

## AI And MCP Positioning

AI is a proposal and explanation layer:

- It may map fields, summarize changes, suggest charts, explain warnings, and draft captions.
- It must not invent values, silently overwrite data, auto-commit imports, or hide uncertainty.
- High-confidence output can be shown as review-ready, but committed scientific data requires a human-reviewed action.

MCP is deferred. A future LabRat MCP server can expose permissioned resources/tools after API, audit, and role checks are stable.
