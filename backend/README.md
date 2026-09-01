# LabRat Backend

The active backend is a NestJS + Fastify + TypeScript modular monolith. It
provides authenticated multi-Lab APIs for workbook evidence, reviewed region
understanding, Experiment Browser publication, analysis, ChartSpecs,
manuscripts, authorization, and audit. PostgreSQL is the persistent source of
truth; Drizzle supplies typed access while numbered SQL migrations remain the
schema authority.

The unversioned JavaScript dispatcher remains only as a previous-release
rollback implementation. New code and frontend callers use `/api/v1`.

The active contracts are:

- `../doc/contracts/backend-api-v1.openapi.yaml`
- `../doc/contracts/authorization-v1.md`
- `../doc/contracts/scientific-invariants-v1.md`
- `../doc/contracts/saas-database-schema-v0.md`
- `../doc/contracts/canonical-data-dictionary.md`

## Commands

Recommended full local stack:

```bash
npm run dev:docker
```

Backend-only development against the Compose PostgreSQL service:

```powershell
npm run dev:postgres
$env:DATABASE_URL="postgres://labrat:labrat_dev@127.0.0.1:5433/labrat"
npm --prefix backend run migrate
npm --prefix backend run dev
```

The backend `dev` script loads the Git-ignored root `.env` and optional
`.env.local`; it starts Nest v1 without automatic restarts. Use `dev:legacy`
only for explicit rollback comparison.

Verification:

```powershell
npm --prefix backend test
$env:LABRAT_TEST_DATABASE_URL="postgres://labrat:labrat_dev@127.0.0.1:5433/labrat"
npm --prefix backend run test:postgres
npm --prefix backend run build:v1
npm --prefix backend run smoke:v1-entry
```

PostgreSQL tests create and remove isolated schemas inside the configured test
database. They skip when `LABRAT_TEST_DATABASE_URL` is absent. The local
Compose database is exposed on port 5433 by default.

Seeded development accounts, when explicitly enabled:

```text
admin / LabRatAdmin123!
labuser / LabRatLab123!
```

Production must provide `DATABASE_URL`, a non-default `SESSION_SECRET`, durable
file storage, disabled development seed accounts, and exactly one selected AI
provider with its server-side key.

## Endpoint Families

- identity, sessions, Labs, memberships, groups, and explicit access grants
- project shells/profiles and scoped Experiment access
- FileObject upload, SourceDocument indexing, and bounded source reads
- WorkbookReviewSession/Region lifecycle and immutable accepted revisions
- DataSnapshot summaries, Experiment Browser projection/configuration, personal
  annotations, historical BrowserViews, and documentation columns
- AgentRun and reviewed AnalysisThread/PlanRevision/Run/Result workflows
- immutable accepted ChartSpec summaries/details and mutable Manuscripts

Exact paths, DTOs, errors, and capability metadata live in the OpenAPI v1
contract.

## Boundaries

- Raw files, source indexes, accepted understandings, DataSnapshots,
  AnalysisResults, and ChartSpecs preserve immutable history.
- Experiment Browser reads only active accepted experiment snapshot heads.
- AI may draft or explain; deterministic validation, authorization, explicit
  review, idempotency, and PostgreSQL transactions own mutations.
- Full workbooks, materialized run inputs, Python, complete Plotly arrays, and
  Browser rows are fetched or produced only through bounded detail workflows.
- Retired unscoped import/chart, aggregate dataset, and project-state aggregate
  paths must remain absent from v1.
- Production Python execution requires a hardened worker; the local executor is
  development-only.
