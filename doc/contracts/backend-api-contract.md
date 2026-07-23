# Backend API Contract

Status: active compatibility note
Last reviewed: 2026-07-20

The backend is server-first. The complete implemented project API is defined in `doc/contracts/saas-api-contract-v0.md` and routed by `backend/src/saas/routes/saasRoutes.js`.

## Service Boundary

The HTTP service exposes:

- `GET /health`
- authenticated SaaS/project routes under `/api/auth`, `/api/admin`, `/api/labs`, `/api/projects`, `/api/source-documents`, `/api/source-regions`, `/api/workbook-review-sessions`, `/api/agent-runs`, `/api/analysis-threads`, `/api/analysis-plan-revisions`, `/api/analysis-runs`, `/api/chart-specs`, and `/api/manuscripts`
- backend-only model access configured by `LABRAT_AI_PROVIDER`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL`

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
      "code": "analysis_result_mismatch",
      "message": "The accepted result does not match this analysis run.",
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
- Durable charts have one supported origin: analysis-result ChartSpecs contain exact accepted-analysis hashes, confirmed-region and/or input-snapshot refs, validated trace arrays, and source-record lineage.
- Analysis-result ChartSpec creation occurs only through acceptance of the exact AnalysisResult id and a non-empty reviewed curve set after execution and validation. Project/list payloads contain bounded trace metadata; `GET /api/chart-specs/:chartSpecId` returns the complete immutable artifact.
- Manuscript blocks store a complete ChartSpec snapshot, editable layout, and placement-local `chartView.visibleTraceIds`; they do not recalculate scientific values or modify the shared ChartSpec.
- LabRat intent routing directly answers resolvable project questions, sends derived analysis/chart requests to reviewed analysis planning, and opens Experiment Browser only for explicit navigation.
- Internal analysis planning tools page through active confirmed workbook regions and inspect exact subranges; they cannot execute calculations.
- AnalysisThread/AnalysisPlanRevision routes persist immutable reviewed source selections and natural-language plans. Idempotent acceptance creates only a queued AnalysisRun; Python is generated later from its materialized input.
- Project analysis capabilities expose only public model/executor readiness plus confirmed-region and accepted snapshot/head counts. Evidence-blocked AnalysisThreads may be retried when confirmed evidence is available through an editor-authorized, claim-guarded operation that cannot execute or publish.
- AnalysisRun execution is a separate authenticated backend operation. It re-resolves accepted source selections, materializes complete multi-table inputs through bounded SourceDocument reads, generates policy-checked Python from those real inputs, and persists an immutable awaiting-review AnalysisResult only after bounded Plotly and declared-invariant validation. `trace_y_sum` checks a complete series; `x_group_y_sum` checks stacked components at each shared X category. Execution never creates a ChartSpec.
- Result acceptance is a second idempotent transaction: it checks the exact AnalysisResult id and reviewed curve ids, accepts the existing result, completes the run/thread, and creates exactly one analysis-result ChartSpec v3.

## Verification

Changes to import parsing, project routes, accepted-data publication, or chart contracts require:

```bash
npm --prefix backend test
npm test
npm run build
```
