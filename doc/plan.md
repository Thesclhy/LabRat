# Current Development Plan

This file is the short active plan for current work. Historical checkpoint detail lives in `doc/PROGRESS.md`; do not turn this file back into a running log.

## Current Focus

LabRat Blank has completed the local-first generic importer/browser foundation and now has a backend SaaS foundation for server-first projects. The next active milestone is connecting the frontend to authenticated server projects through the project state API. New server-mode work does not need to migrate or preserve old IndexedDB, `.labrat.json`, or previous local project shapes.

The current transition is:

```text
local-first generic importer completed
  -> backend SaaS Auth v0 foundation completed
  -> server-first project persistence completed
  -> frontend login/lab/project selection
  -> server project state loading
  -> server-backed import apply and dataset commits
  -> chart specs to manuscript UI
```

## Current State

- Blank mode starts from an empty dataset unless a saved blank project exists.
- Local project state is persisted in IndexedDB and can be exported/imported as `.labrat.json`.
- Backend scan, normalize, semantic mapping, and chart proposal endpoints exist as stateless local/dev compatibility endpoints.
- Stable content-based upload ids and normalized generic import ids exist for repeated uploads of the same workbook.
- Generic Excel Importer v2 Phase 1 is complete for grouped/multi-row header tables.
- Generic Browser integration is complete: `dataset.genericImports[]` can be shown as imported rows with source-backed detail.
- Backend SaaS Auth v0 foundation is implemented:
  - config/env guardrails
  - Postgres migration SQL
  - migration runner
  - dev/test seeded accounts
  - username/password login
  - httpOnly sessions
  - role checks
  - admin lab/user APIs
  - lab/project APIs
  - file upload records
  - persisted import runs
  - normalize preview/apply
  - refresh preview/apply for replacing active imports through immutable dataset commits
  - dataset commits
  - chart specs from proposals
  - manuscript persistence
  - audit events
- Server-first project persistence is implemented:
  - multiple projects per lab
  - `projects.metadata.projectProfile` for experiment background
  - `GET /api/projects/:projectId/state`
  - project-scoped list/create/update APIs for files, import runs, dataset commits, mapping sets, chart proposal sets, chart specs, and manuscripts
  - project-scoped AI context and chart APIs:
    - `PATCH /api/projects/:projectId/profile`
    - `POST /api/projects/:projectId/ai/context`
    - `POST /api/projects/:projectId/charts/interpret`
    - `POST /api/projects/:projectId/charts/propose`
- Backend data-integrity hardening is implemented:
  - import-run lifecycle checks around normalize/apply
  - merged full dataset commits instead of latest-patch-only commits
  - duplicate committed `genericImports[].importId` rejection
  - refresh replacement of active generic imports without mutating parent commits
  - source-backed ChartSpec validation before persistence
  - optional Postgres route parity test gated by `LABRAT_TEST_DATABASE_URL`
- Local no-Postgres development can use the in-memory SaaS store; `DATABASE_URL` mode uses the Postgres store after migrations/dependencies are installed.
- Frontend still mostly uses IndexedDB/local project persistence; login/lab/project UI has not been added yet. Do not add migration code for old local project shapes unless the user explicitly reopens that requirement.

## Active Milestone: Frontend Server Mode

Build the UI/API integration in this order:

1. Add frontend API helpers for `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/labs`, and project APIs.
2. Add a compact login screen or auth panel for server mode.
3. Show active user, lab, and project in the app shell.
4. Add lab/project selection after login.
5. Load server project state from `GET /api/projects/:projectId/state`.
6. Let users edit project background through `PATCH /api/projects/:projectId/profile`.
7. Use `POST /api/projects/:projectId/ai/context` to hydrate assistant/chart context.
8. Route workbook upload through `POST /api/projects/:projectId/files` and `POST /api/projects/:projectId/import-runs` when logged in.
9. Route normalize/apply through server import-run APIs when logged in.
10. Use project-scoped chart `interpret` / `propose` APIs for chart drafts and recommendations.
11. Store accepted chart proposals as chart specs before manuscript insertion.
12. Persist manuscript blocks/pages/canvas state through manuscript APIs.

## Deferred

These remain out of scope unless the user asks to expand:

- Import Review UI v2
- Template memory
- Methodology recompute
- MCP server
- OAuth, SSO, or email invite
- SMTP password reset
- Billing
- Cloud worker queue
- Kubernetes deployment

## Guardrails

- Keep the existing stateless local endpoints working during the SaaS migration.
- Do not build new compatibility or migration layers for old IndexedDB, `.labrat.json`, or previous local project shapes.
- Do not store plaintext passwords.
- Do not enable development seed passwords silently in production.
- Lab-scoped data must have server-side role checks; frontend hiding is not authorization.
- Do not insert accepted chart proposals into manuscripts directly. Create chart specs first.
- Preserve provenance and source refs for imported scientific data.
- AI may propose mappings/charts/explanations, but it must not commit scientific data without review.
- Use `doc/PROGRESS.md` as the only durable progress log.

## Verification

After backend or frontend behavior changes:

```bash
npm test
npm --prefix backend test
npm run build
```
