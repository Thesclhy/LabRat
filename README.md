# LabRat Blank

LabRat Blank is the new-user LabRat workspace. The long-term product goal is a reproducibility-first research command center: LabRat turns scattered lab files into reviewed source understanding, then uses that evidence to create versioned data snapshots, charts, manuscript figures, and PPTX output.

The current blank app starts with an empty project and is moving to a Workbook Understanding First workflow: uploaded Excel workbooks become indexed SourceDocuments, users review LabRat's understanding through chat and red boxes, and later chart/data actions use that accepted evidence only after human confirmation.

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
- Does not create sample experiments, accepted snapshots, or chart proposals.
- Uses blank-specific browser storage so it does not read saved projects from the demo/research app on the same origin.
- Uses the server-backed Upload workbook flow as the active path; old local `MasterTable.xlsx` folder import behavior is not a product path.

## Current Workflow

The intended product path is now server-first for logged-in lab workspaces:

```text
Upload workbook
  -> SourceDocument / deterministic workbook index
  -> WorkbookReviewSession
  -> accepted WorkbookUnderstanding
  -> Tool-Governed Evidence Retrieval
  -> reviewed DataPlan / immutable accepted DataSnapshot
  -> ExperimentIdentity / active snapshot heads
  -> Experiment Browser
  -> source-backed chart specs
  -> manuscript canvas
  -> PPTX export
```

The current app supports server login, lab/project selection, project profile editing, workbook source indexing, conversational red-box review, accepted WorkbookUnderstanding persistence, tool-governed evidence retrieval, deterministic experiment-record previews, transactional accepted snapshot publish, a cursor-paginated Experiment Browser with saved views/comparison/detail provenance, source-backed chart review, Manuscript layout/persistence, and PPTX export.

The next major engineering goal is accepted DataSnapshot-backed chart planning. It must use the same experiment identities, active snapshot heads, units, source refs, and review boundaries as Experiment Browser. Server workflow reliability, Docker/Postgres readiness, and admin/audit usability remain guardrails. New server-mode work does not need compatibility migrations for old IndexedDB, `.labrat.json`, or previous local project shapes.

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

The backend workbook scan/source indexing, accepted snapshot publication, Experiment Browser, and source-backed chart endpoints are active. Old normalize/apply, aggregate dataset, mapping, analysis-view, observation-series, and unscoped chart endpoints are removed.

## Documentation Map

- `AGENTS.md`: working instructions for AI coding agents.
- `doc/START_HERE.md`: AI-agent reading guide and doc status rules.
- `doc/plan.md`: short active development plan.
- `doc/current-milestone.md`: active execution milestone, next slice, verification target, and immediate risks.
- `doc/PROGRESS.md`: recent progress log.
- `doc/task-checklist.md`: reusable execution checklist for long Codex milestones.
- `doc/contracts/saas-api-contract-v0.md`: authenticated SaaS API contract.
- `doc/contracts/saas-database-schema-v0.md`: Postgres schema target.
- `doc/contracts/server-project-state-plan.md`: server project source-of-truth notes; old local-data migration is not in scope.
- `doc/contracts/backend-api-contract.md`: backend endpoint contracts.
- `doc/contracts/canonical-data-dictionary.md`: shared data terminology.
- `doc/arch/architecture.md`: current server-first architecture and compatibility boundaries.
- `doc/arch/ai-boundaries.md`: AI safety and review rules.
- `doc/plans/roadmap.md`: product roadmap led by the Agent-first evidence workflow.
- `doc/plans/agent-first-evidence-workflow.md`: long-form active workflow plan.
- `doc/plans/source-understanding-long-term-plan.md`: long-term source-aware workbook/document understanding architecture.
- `doc/qa/manual-qa-agent-first-workflow.md`: manual QA checklist for the Agent-first evidence workflow branch.
- `doc/qa/code-review.md`: standing review checklist for scientific workflow changes.
- `doc/reports/decisions.md`: durable product and architecture decisions.
- `doc/reports/doc-inventory.md`: categorized documentation inventory.
- `doc/reports/progress-archive-2026-06.md`: archived progress history.
