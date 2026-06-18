# LabRat Blank

LabRat Blank is the new-user LabRat workspace. The long-term product goal is a reproducibility-first research command center: LabRat turns scattered lab files into a versioned, browsable, source-backed dataset, then carries that data into charts, manuscript figures, and PPTX output.

The current blank app starts with an empty project and already guides users from raw Excel workbooks through import review, generic normalization, semantic mapping proposals, chart proposals, generic Experiment Browser review, manuscript layout, and PPTX export. The active product direction is now an agent-first evidence workflow: LabRat should inspect project evidence, draft auditable analysis views, propose charts/data actions, and execute only after human confirmation.

This folder is intentionally separate from `D:\project\labrat`, which remains the research/demo project. This blank copy does not include `public/labratData.json`, does not preload HDPE research data, and does not import example templates automatically.

## Quick Start

Start the full local development stack with Docker:

```bash
npm run dev:docker
```

This starts:

- Postgres at `127.0.0.1:5432`
- backend API at `http://127.0.0.1:8787`
- frontend at `http://127.0.0.1:5173/LabRat/`

Seeded development accounts:

```text
admin / LabRatAdmin123!
labuser / LabRatLab123!
```

Stop the stack with:

```bash
npm run dev:docker:down
```

If you only want to run the frontend locally against an already-running backend:

```bash
npm install
npm run dev
```

`npm run dev` starts blank mode by default in this copy. Vite will print the local URL, usually `http://localhost:5173`.

Build the blank-mode production bundle with:

```bash
npm run build
```

The explicit aliases also remain available:

```bash
npm run dev:blank
npm run build:blank
```

Run the backend import service separately when not using Docker Compose:

```bash
npm run dev:postgres
$env:DATABASE_URL="postgres://labrat:labrat_dev@127.0.0.1:5432/labrat"
$env:SESSION_SECRET="dev-secret"
$env:LABRAT_SEED_DEV_ACCOUNTS="true"
npm --prefix backend run dev
```

## Blank Project Behavior

- Starts from an empty dataset when no saved blank project exists.
- Does not fetch `public/labratData.json`.
- Does not create sample experiments, measurements, generic imports, mapping sets, or chart proposals.
- Uses blank-specific browser storage so it does not read saved projects from the demo/research app on the same origin.
- Keeps the legacy HDPE `MasterTable.xlsx` folder import as a secondary compatibility option.

## Current Workflow

The intended product path is now server-first for logged-in lab workspaces:

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

The current app supports server login, lab/project selection, project profile editing, server project state loading, backend workbook scan, approved normalization, refresh/replace, semantic mapping proposals, chart proposal review, generic Experiment Browser rows, durable chart specs, manuscript layout, server manuscript persistence, and PPTX export.

The next major engineering goal is Agent-first Evidence Workflow v1: observation-series compare for supplemental files, Analysis Views, controlled AgentRun traces, source document/range retrieval, source extract proposals, and source-backed or analysis-view-backed ChartSpecs. Server workflow reliability, Docker/Postgres readiness, and admin/audit usability remain guardrails. New server-mode work does not need compatibility migrations for old IndexedDB, `.labrat.json`, or previous local project shapes.

## Example Templates

Example-only workbook templates are available under `public/templates/` and from the blank onboarding UI:

- `public/templates/generic-import-template.xlsx`
- `public/templates/block-import-template.xlsx`

These templates contain placeholder example rows only. They are formatting references, not active project data, and they are never imported automatically.

## Development Checks

```bash
npm test
npm --prefix backend test
npm run build
```

The backend scan, normalize, semantic mapping, and chart proposal endpoints are kept in this source copy so user-uploaded workbooks can use the existing review workflow.

## Documentation Map

- `AGENTS.md`: working instructions for AI coding agents.
- `doc/ARCHITECTURE.md`: current server-first architecture and compatibility boundaries.
- `doc/ROADMAP.md`: product roadmap led by the Agent-first evidence workflow.
- `doc/plan.md`: active Agent-first evidence workflow execution plan.
- `doc/source-understanding-long-term-plan.md`: long-term source-aware workbook/document understanding architecture.
- `doc/decisions.md`: durable product and architecture decisions.
- `doc/task-checklist.md`: working checklist template for long Codex milestones.
- `doc/code-review.md`: standing review checklist for scientific workflow changes.
- `doc/saas-database-schema-v0.md`: Postgres schema target.
- `doc/saas-api-contract-v0.md`: authenticated SaaS API contract.
- `doc/server-project-state-plan.md`: server project source-of-truth notes; old local-data migration is not in scope.
- `doc/backend-api-contract.md`: backend endpoint contracts.
- `doc/canonical-data-dictionary.md`: shared data terminology.
- `doc/ai-boundaries.md`: AI safety and review rules.
- `doc/PROGRESS.md`: durable project progress log.
