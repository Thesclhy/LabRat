# LabRat Backend

This folder contains the current LabRat backend. It provides local/dev workbook scan, approved normalization, semantic mapping proposals, generic chart proposals, and the first SaaS Auth v0 API foundation for accounts, labs, projects, files, import runs, dataset commits, chart specs, manuscripts, and audit events.

The existing import/chart endpoints remain stateless compatibility endpoints. New SaaS endpoints wrap those services in authenticated project-scoped APIs instead of replacing the parser first.

## Commands

Recommended local stack:

```bash
npm run dev:docker
```

This uses `docker-compose.yml` to start Postgres, run backend migrations, seed development accounts, start the backend on `8787`, and start the frontend on `5173`.

Backend-only/manual commands:

```bash
npm --prefix backend run dev
npm --prefix backend start
npm --prefix backend run migrate
npm --prefix backend test
npm --prefix backend run test:postgres
```

For local seeded account testing without Postgres:

```bash
$env:LABRAT_SEED_DEV_ACCOUNTS="true"
$env:SESSION_SECRET="dev-secret"
npm --prefix backend run dev
```

Seeded accounts:

```text
admin / LabRatAdmin123!
labuser / LabRatLab123!
```

For manual Postgres mode, set `DATABASE_URL`, install backend dependencies, run `npm --prefix backend run migrate`, then start the backend with the same env. Docker Compose sets these automatically:

```text
DATABASE_URL=postgres://labrat:labrat_dev@postgres:5432/labrat
SESSION_SECRET=dev-secret
LABRAT_SEED_DEV_ACCOUNTS=true
PORT=8787
```

## Current Endpoints

- `GET /health`
- `POST /api/import/scan`
- `POST /api/import/normalize`
- `POST /api/import/semantic-map`
- `POST /api/charts/propose`
- `POST /api/charts/interpret`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/admin/labs`
- `POST /api/admin/labs`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:userId`
- `POST /api/admin/users/:userId/reset-password`
- `GET /api/labs`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `PATCH /api/projects/:projectId/profile`
- `GET /api/projects/:projectId/state`
- `POST /api/projects/:projectId/ai/context`
- `POST /api/projects/:projectId/charts/interpret`
- `POST /api/projects/:projectId/charts/propose`
- `GET /api/projects/:projectId/files`
- `POST /api/projects/:projectId/files`
- `GET /api/projects/:projectId/import-runs`
- `POST /api/projects/:projectId/import-runs`
- `GET /api/projects/:projectId/dataset-commits`
- `GET /api/projects/:projectId/mapping-sets`
- `POST /api/projects/:projectId/mapping-sets`
- `PATCH /api/mapping-sets/:mappingSetId`
- `GET /api/projects/:projectId/chart-proposal-sets`
- `POST /api/projects/:projectId/chart-proposal-sets`
- `PATCH /api/chart-proposal-sets/:chartProposalSetId`
- `POST /api/import-runs/:id/normalize-preview`
- `POST /api/import-runs/:id/apply`
- `POST /api/projects/:projectId/chart-specs/from-proposal`
- `GET /api/projects/:projectId/chart-specs`
- `GET /api/projects/:projectId/manuscripts`
- `POST /api/projects/:projectId/manuscripts`
- `PATCH /api/manuscripts/:manuscriptId`

## Current Boundary

- Preserve existing endpoint paths and schema envelopes.
- Return generic normalized data under `datasetPatch.genericImports[]`.
- Do not return direct HDPE `dataset.experiments[]` mutations for generic imports.
- Keep semantic mapping and chart output as proposals until a user reviews them.
- Do not send full raw workbooks to AI services; use compact summaries only.
- Keep stateless import/chart endpoints available while adding and hardening SaaS project-scoped APIs.
- Import-run apply now creates full merged dataset commits and rejects duplicate committed import ids.
- Chart spec creation validates source-backed fields against the referenced dataset commit before persistence.
- Postgres migrations are in `backend/migrations/`.
- `npm --prefix backend run test:postgres` is optional and skips unless `LABRAT_TEST_DATABASE_URL` points at a disposable Postgres test database.
- Auth v0 uses admin-created `username + password` users and httpOnly sessions.
- Local no-Postgres development can use the in-memory store; production should use Postgres.

See these docs before changing backend architecture:

- `../doc/backend-api-contract.md`: current local/dev endpoint contracts.
- `../doc/saas-database-schema-v0.md`: Postgres schema target.
- `../doc/saas-api-contract-v0.md`: authenticated SaaS API contract.
- `../doc/server-project-migration-plan.md`: server project state notes; old local-data migration is not in scope.
