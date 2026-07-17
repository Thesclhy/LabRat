# LabRat Backend

The backend provides authenticated lab/project APIs for workbook evidence indexing, conversational WorkbookUnderstanding review, deterministic DataPlan/DataSnapshot publication, Experiment Browser projection, source-backed chart review, AgentRuns, manuscripts, and audit events.

The active contracts are:

- `../doc/contracts/saas-api-contract-v0.md`
- `../doc/contracts/saas-database-schema-v0.md`
- `../doc/contracts/canonical-data-dictionary.md`

## Commands

Recommended local stack:

```bash
npm run dev:docker
```

Backend-only commands:

```bash
npm --prefix backend run dev
npm --prefix backend start
npm --prefix backend run migrate
npm --prefix backend test
npm --prefix backend run test:postgres
```

For local in-memory development with seeded accounts:

```powershell
$env:LABRAT_SEED_DEV_ACCOUNTS="true"
$env:SESSION_SECRET="dev-secret"
npm --prefix backend run dev
```

The backend-only `dev` command intentionally runs without automatic file watching. The default local store is in memory, so a watch restart would silently discard login sessions and review state; restart the command manually after backend source edits.

Seeded development accounts:

```text
admin / LabRatAdmin123!
labuser / LabRatLab123!
```

Production must provide `DATABASE_URL`, a non-default `SESSION_SECRET`, durable file storage, and disabled development seed accounts.

## Endpoint Families

- health, authentication, admin, labs, projects, and project profile/state
- file upload, import-run scan, SourceDocument/SourceRegion bounded evidence reads
- WorkbookReviewSession revision/confirmation and accepted WorkbookUnderstanding
- evidence retrieval, DataPlan draft/publish, DataSnapshot summaries
- Experiment Browser list/detail and owner-scoped BrowserViews
- Agent planning/runs and review-gated confirmation
- SourceExtractProposal, source-backed chart proposals/ChartSpecs
- Manuscript create/update/list

Exact paths and payload rules live in the SaaS API contract.

## Boundaries

- Raw files and source indexes are immutable.
- Accepted scientific values come only from deterministic publish into immutable DataSnapshots.
- Experiment Browser reads active experiment snapshot heads.
- AI/tools draft and explain; explicit user confirmation and backend validation own mutations.
- Durable charts currently require exact source refs and immutable source snapshots.
- DataSnapshot-backed chart planning is not implemented yet.
- Retired unscoped normalize/semantic-map/generic chart and aggregate dataset endpoints must remain absent.
- Postgres migrations live in `backend/migrations/`; migration 011 removes retired development-schema artifacts.
- `test:postgres` is optional and skips unless `LABRAT_TEST_DATABASE_URL` points to a disposable database.
