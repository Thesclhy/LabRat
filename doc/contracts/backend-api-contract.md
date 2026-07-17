# Backend API Contract

Status: active compatibility note
Last reviewed: 2026-07-16

The backend is server-first. The complete implemented project API is defined in `doc/contracts/saas-api-contract-v0.md` and routed by `backend/src/saas/routes/saasRoutes.js`.

## Service Boundary

The HTTP service exposes:

- `GET /health`
- authenticated SaaS/project routes under `/api/auth`, `/api/admin`, `/api/labs`, `/api/projects`, `/api/source-documents`, `/api/source-regions`, `/api/workbook-review-sessions`, `/api/source-extract-proposals`, `/api/agent-runs`, `/api/chart-proposal-sets`, and `/api/manuscripts`

Unknown or retired routes return `404`.

## Workbook Processing

Workbook parsing remains deterministic and conservative:

- scan workbook/sheet structure
- detect bounded candidate regions
- preserve source cells, formulas, comments/styles/hidden hints when available
- classify layouts without inventing rows or scientific semantics
- store SourceDocument/SourceRegion evidence for later review

Parser services are internal implementation details. New frontend code must use authenticated project-scoped upload, import-run, SourceDocument, and WorkbookReviewSession APIs.

## Removed Unscoped Endpoints

These development endpoints are intentionally absent:

```text
POST /api/import/scan
POST /api/import/normalize
POST /api/import/semantic-map
POST /api/charts/propose
POST /api/charts/interpret
```

They must not be restored as a second product path. Generic normalization/mapping output is not a valid Browser source.

## Error Envelope

Project routes return JSON errors with a stable code and message:

```json
{
  "error": {
    "code": "source_snapshot_required",
    "message": "Chart specs require an immutable sourceSnapshot.",
    "details": {}
  }
}
```

Status code guidance:

- `400`: invalid request or schema
- `401`: unauthenticated
- `403`: insufficient lab role
- `404`: resource/route absent or outside project scope
- `409`: stale review, idempotency conflict, or intentionally unsupported transition
- `413`: bounded read/upload limit exceeded
- `500`: unexpected server failure

## Current Output Contracts

- Accepted workbook data is produced only by reviewed DataPlan publish into immutable DataSnapshots.
- Experiment Browser rows are derived only from active experiment snapshot heads.
- Durable charts currently require source-backed immutable snapshots.
- Manuscript blocks store chart snapshots and do not recalculate scientific values.

## Verification

Changes to import parsing, project routes, accepted-data publication, or chart contracts require:

```bash
npm --prefix backend test
npm test
npm run build
```
