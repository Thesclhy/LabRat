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

- Postgres at `127.0.0.1:5433` by default (override with
  `LABRAT_POSTGRES_PORT`)
- backend API at `http://127.0.0.1:8787`
- frontend at `http://127.0.0.1:5173/LabRat/`
- the development-only local Python analysis executor inside the backend
  container

Docker Compose is the default local development runtime. It keeps project
state in the Postgres volume, uploaded files in a separate backend volume, and
restarts unhealthy frontend/backend processes without relying on temporary
terminal sessions.

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
npm --prefix backend run dev
```

For local development, copy `.env.example` to the Git-ignored repository-root
`.env`. The backend `dev` command loads root `.env` and then optional
`.env.local` overrides; enable
`LABRAT_SEED_DEV_ACCOUNTS=true` only for local development. Production users
and passwords belong in the database, not in an environment file.

Docker Compose reads provider settings from the Git-ignored repository-root
`.env`. LabRat supports one deployment-selected backend provider at a time:

```env
LABRAT_AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=replace-with-a-local-key
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Set `LABRAT_AI_PROVIDER=anthropic` to use the existing
`ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` settings instead. Provider selection is
required in every environment and is read only at backend startup. A selected
key may be empty in development, where capability reports `configured: false`;
production refuses to start without it. LabRat does not automatically fail
over or send the same scientific context to multiple providers. Recreate the
backend container after changing Compose environment values:

```bash
docker compose up -d --force-recreate backend
```

When a real DeepSeek key is configured, the disposable smoke test verifies an
authenticated capability read, the Browser-surface chart-intent case, and one
synthetic reviewed plan with a read-only tool call:

```bash
npm --prefix backend run smoke:ai
```

## Blank Project Behavior

- Starts from an empty dataset when no saved blank project exists.
- Does not fetch `public/labratData.json`.
- Does not create sample experiments, accepted snapshots, or charts.
- Uses blank-specific browser storage so it does not read saved projects from the demo/research app on the same origin.
- Uses the server-backed Upload workbook flow as the active path; old local `MasterTable.xlsx` folder import behavior is not a product path.

## Current Workflow

The intended product path is now server-first for logged-in lab workspaces:

```text
Upload workbook
  -> SourceDocument / deterministic workbook index
  -> WorkbookReviewSession
  -> independently reviewed WorkbookReviewRegions
  -> accepted RegionUnderstandingRevisions
  -> Tool-Governed Evidence Retrieval
  -> reviewed DataPlan / immutable accepted DataSnapshot
  -> ExperimentIdentity / active snapshot heads
  -> Experiment Browser
  -> source-backed chart specs
  -> manuscript canvas
  -> PPTX export
```

The current app supports server login, lab/project selection, project profile editing, workbook source indexing, independent region review with immutable accepted revisions, tool-governed evidence retrieval, deterministic experiment-record previews, transactional accepted snapshot publish, a cursor-paginated Experiment Browser with shared layout, personal annotations, and detail provenance, backend-owned durable analysis threads and reviewed immutable calculation plans, accepted-run execution with validated immutable result previews, separate result acceptance into trace-complete analysis-result ChartSpecs, source-backed chart review, Manuscript placement-local trace visibility, persistence, and PPTX export.

Pristine projects begin with a full-page conversational onboarding flow. LabRat
indexes the workbook, interprets and confirms regions inline, and drafts the
reviewed Experiment Browser plan without opening the side assistant. After the
user accepts that plan, the real source materialization, built-in source
mapping, execution, and validation continue in the background while onboarding asks
about the experimental and analysis workflows. The validated preview and final
Publish to Browser action remain explicit review boundaries. Onboarding answers
and display progress are project-scoped browser state for now; they do not alter
backend analysis. This onboarding-only mapper consumes the already confirmed
row/field interpretation, preserves exact source cells, and makes no provider
call. General Experiment Browser changes, calculations, and future linked-file
workflows retain the reviewed model-generated Python path.

Analysis execution is disabled by default. For local non-production development only:

```bash
$env:LABRAT_ANALYSIS_EXECUTOR="local"
$env:LABRAT_ANALYSIS_PYTHON_COMMAND="python"
npm --prefix backend run dev
```

The Docker Compose stack configures the equivalent local executor with
`python3` inside `backend/Dockerfile.dev`; no host Python configuration is
required.

Production must use `LABRAT_ANALYSIS_EXECUTOR=worker` plus an HTTPS `LABRAT_ANALYSIS_WORKER_ENDPOINT` backed by an isolated no-network worker. The local subprocess adapter is rejected in production.

The active chart-creation program adds reusable, versioned chart styles and
scientific templates beside the existing reviewed natural-language workflow.
New chart meaning still uses reviewed planning and result acceptance. The
versioned style/template persistence, lifecycle APIs, reviewed slot bindings,
and idempotent applications are implemented. Compatible accepted Browser
experiments now use the Milestone 3 deterministic no-provider/no-Python path
and the same immutable ChartSpec boundary. Adaptive geometry and
provider-independent stored-type/percentage-scale handling are complete; the
fast template-picker UI remains the next milestone. See
`doc/plans/reusable-chart-creation-plan.md`.

Production operationalization of reviewed analysis execution remains an
engineering priority: deploy the hardened no-network worker, configure provider
secrets outside the browser, run the Postgres integration suite in CI, and add
cost/latency/audit telemetry. The local Compose stack is the development
runtime; it is not the production executor architecture. New server-mode work
does not need compatibility migrations for old IndexedDB, `.labrat.json`, or
previous local project shapes.

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

## Deployment

The low-cost production path is one AWS Lightsail Ubuntu instance running
Caddy, the Node backend, Postgres, and durable uploaded-file storage. GitHub
Actions can deploy every pushed `main` commit after tests and build pass.

Production provider secrets live only in `/etc/labrat/backend.env`. The
required GitHub Repository Variable `LABRAT_AI_PROVIDER` selects `anthropic` or
`deepseek` for the next `main`/manual deployment; GitHub Actions does not
receive or copy either provider key. The deployment updates only the provider
line atomically and restores both the old environment file and old release if
startup or health verification fails. An unsupported provider or a missing
selected key fails before release activation.

See `doc/deployment/lightsail.md` for provisioning, GitHub secrets, first-admin
bootstrap, backup, rollback, and acceptance checks.

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
- `doc/plans/reusable-chart-creation-plan.md`: milestone sequence for reusable
  styles, templates, deterministic comparison, and fast chart reuse.
- `doc/contracts/reusable-chart-template-contract-v1.md`: reusable chart style,
  input-slot, recipe, geometry, API, and lineage contract.
- `doc/qa/manual-qa-agent-first-workflow.md`: manual QA checklist for the Agent-first evidence workflow branch.
- `doc/qa/code-review.md`: standing review checklist for scientific workflow changes.
- `doc/reports/decisions.md`: durable product and architecture decisions.
- `doc/reports/doc-inventory.md`: categorized documentation inventory.
- `doc/reports/progress-archive-2026-06.md`: archived progress history.
