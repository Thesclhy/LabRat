# LabRat Architecture

LabRat is a reproducibility-first research command center for catalysis labs. It sits on top of existing raw files, turns scattered spreadsheets and instrument outputs into a living browsable dataset, and keeps every result tied to the exact source files, calculations, and human review decisions that produced it.

## Product Narrative

The core workflow is:

```text
raw files
  -> import proposals
  -> human review
  -> dataset commits
  -> Experiment Browser
  -> methodology versions and recompute proposals
  -> chart specs
  -> manuscript canvas
  -> PPTX export
```

The product promise is not simply "upload Excel and draw charts." LabRat should answer: "How exactly was this number produced, from which raw file, using which calculation method, and who approved it?"

## Frontend Workspaces

- **Onboarding / Workspace Setup** guides a new lab through project context, existing file uploads, optional public lab/project descriptions, expected data fields, calculation conventions, and chart defaults. The output is a workspace configuration proposal that the researcher confirms or edits.
- **Import & Review** accepts new master tables, calculation workbooks, GC exports, Parr logs, and CSV files. It shows detected changes, parsed structures, warnings, proposed mappings, provenance previews, and accept/edit/reject actions.
- **Experiment Browser** is the main daily workspace. It shows committed experiments, changed results, source files, methodology version, warnings, and searchable/filterable dynamic fields. Uploaded generic data should appear through a browser-row adapter, not by being forced into HDPE-specific fields.
- **Methodology / Recompute** lets users review calculation templates, formula versions, derived fields, validation rules, and recompute proposals. Changing a carbon-balance formula creates a new methodology version and a reviewable comparison, not an overwrite.
- **Chart Builder** creates source-backed chart specs from committed data, accepted mappings, dataset commit ids, and methodology versions.
- **Manuscript / Present** uses the existing canvas model for arranging text, images, and charts. Chart blocks should eventually reference chart specs plus dataset/methodology versions, so exported figures remain reproducible.
- **AI Agent** proposes imports, mappings, recomputes, chart ideas, captions, and explanations. It does not silently commit data or hide uncertainty.

## Backend Architecture

The backend should become the reproducibility layer:

```text
React frontend
  -> API server
      -> File Store
      -> Import Engine
      -> Dataset Store
      -> Methodology Engine
      -> Provenance Engine
      -> AI Proposal Engine
      -> Chart / Export Engine
      -> Audit Log
  -> Worker queue for long-running scan, recompute, render, and export jobs
```

- **File Store** keeps immutable raw file versions with checksum, filename, uploader, timestamp, and storage path. Raw files are never overwritten.
- **Import Engine** scans Excel/CSV/instrument files, detects tables and blocks, normalizes approved structures, and produces import proposals before any committed dataset change.
- **Dataset Store** keeps committed experiment, metadata, and measurement records. Future cloud work should treat each import or recompute acceptance as a new dataset commit.
- **Methodology Engine** manages calculation templates, formulas, derived fields, unit rules, validation rules, and methodology versions.
- **Provenance Engine** links every committed value to source files, sheets, cells/ranges, raw values, calculation steps, method versions, and approving actions.
- **AI Proposal Engine** produces reviewable `ImportProposal`, `MappingProposal`, `RecomputeProposal`, `ChartProposal`, and `CaptionDraft` records with confidence, rationale, source refs, warnings, and status.
- **Chart / Export Engine** stores chart specs and renders charts/PPTX output from known dataset and methodology versions.
- **Audit Log** records uploads, mapping decisions, methodology changes, recompute commits, chart insertions, exports, and role-sensitive actions.

## Current Local Implementation

The current blank app is local-first and stores project state in IndexedDB plus `.labrat.json` export/import. It already has:

- backend workbook scan, approved normalization, semantic mapping proposal, and chart proposal endpoints
- `dataset.genericImports[]` for approved generic imports
- `dataset.genericMappingSets[]` and `dataset.genericChartProposals[]` for review state
- a legacy HDPE-shaped `dataset.experiments[]` path for curated browser/detail/chart flows
- manuscript canvas and PPTX export

Near-term implementation should add an adapter that turns generic imports and mappings into Experiment Browser rows while preserving the existing HDPE browser.

## Core Domain Objects

- **ImportProposal**: a reviewable result of scanning and normalizing uploaded files.
- **DatasetCommit**: an immutable accepted state of experiment, metadata, and measurement values.
- **MethodologyVersion**: a named calculation/method bundle used to derive values.
- **RecomputeProposal**: a reviewable comparison produced by running a new methodology version over existing data.
- **ProvenanceGraph**: the trace from committed values back to files, cells, raw values, formulas, method versions, and human decisions.
- **ChartSpec**: a structured chart definition referencing dataset and methodology versions.
- **AuditEvent**: a durable record of who did what, when, and why.

The current local project file does not yet implement these as first-class database entities. They are the target architecture for the next backend evolution.

## AI And MCP Positioning

AI is a proposal and explanation layer:

- It may map fields, summarize changes, suggest recomputes, explain warnings, rank charts, and draft captions.
- It must not invent values, silently overwrite data, auto-commit methodology changes, or obscure changed values.
- High-confidence output may become `accepted_draft`, but final committed scientific data requires human review.

MCP is a future external integration layer, not the internal app backbone. A future LabRat MCP server can expose permissioned resources and tools after the API, audit model, and role checks are stable.

## Future Cloud Shape

The first cloud target should be a single-lab Docker Compose deployment:

- React frontend
- Node API
- worker process
- Postgres for structured data, commits, methods, provenance, and audit logs
- object storage for raw files, chart renders, and exported PPTX files

Kubernetes, multi-tenant SaaS, and broad MCP integrations should come after the single-lab reproducibility model works.
