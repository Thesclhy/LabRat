# Backend API Contract

Status: active v1 service boundary
Last reviewed: 2026-08-23

The backend is server-first. The authoritative HTTP surface is the OpenAPI 3.1
contract in `doc/contracts/backend-api-v1.openapi.yaml` and is implemented by
the NestJS/Fastify modules under `backend/src/v1`. The unversioned JavaScript
dispatcher and `doc/contracts/saas-api-contract-v0.md` are rollback references,
not valid targets for new frontend calls.

## Service Boundary

The HTTP service exposes:

- `GET /health`
- authenticated SaaS/project routes under `/api/v1`
- backend-only model access selected at startup with `LABRAT_AI_PROVIDER=anthropic|deepseek` and the matching provider-specific key/model variables

The backend AI gateway exposes one provider-neutral structured/tool request
boundary to LabRat services. It supports Anthropic Messages and DeepSeek Chat
Completions, never performs automatic cross-provider failover, and reports only
the selected provider, model, readiness, bounded usage, latency, and sanitized
diagnostics. `LABRAT_AI_PROVIDER` has no implicit default and must be exactly
`anthropic` or `deepseek` in every environment. Development may leave the
selected key empty and reports `configured: false`; production rejects a
missing selected key during startup. The unselected key is never added to an
outbound provider request.

DeepSeek Experiment Browser plan drafting uses non-thinking JSON/tool requests.
Chart planning and generated-program requests retain high thinking. A
token-limit truncation may trigger only one concise same-provider non-thinking
retry. Provider-reported input, output, and reasoning-token usage is accumulated
across attempts and remains on a failed AgentRun rather than being replaced by
deterministic zero-token metadata.
Structured requests may configure a separate truncation-only retry budget.
Experiment Browser plan drafting uses 16,000 tokens initially and 32,000 only
for its one retry after an explicit provider length stop. The gateway retains
the original budget for empty, malformed, and schema-invalid repairs. Safe
metadata includes budgets, attempt counts, token counts (including DeepSeek's
numeric reasoning-token count), tool rounds, latency, and stop reason; hidden
reasoning content and credentials never cross the gateway boundary.

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
      "details": {},
      "requestId": "request_opaque"
  }
}
```

Status code guidance:

- `400`: invalid request or schema
- `401`: unauthenticated
- `403`: insufficient effective capability
- `404`: resource/route absent or outside project scope
- `409`: stale review, idempotency conflict, or intentionally unsupported transition
- `413`: bounded read/upload limit exceeded
- `500`: unexpected server failure

## Current Output Contracts

- Accepted workbook data is produced only by reviewed DataPlan publish into immutable DataSnapshots.
- Experiment Browser rows are derived only from active experiment snapshot heads.
- Durable charts have one supported origin: analysis-result ChartSpecs contain exact accepted-analysis hashes, confirmed-region and/or input-snapshot refs, validated trace arrays, and source-record lineage.
- Analysis-result ChartSpec creation occurs only through acceptance of the exact AnalysisResult id and a non-empty reviewed curve set after execution and validation. Project/list payloads contain bounded trace metadata; `GET /api/v1/chart-specs/:chartSpecId` returns the complete immutable artifact.
- Manuscript blocks store a complete ChartSpec snapshot, editable layout, and placement-local `chartView.visibleTraceIds`; they do not recalculate scientific values or modify the shared ChartSpec.
- LabRat intent routing directly answers resolvable project questions, sends derived analysis/chart requests to reviewed analysis planning, and opens Experiment Browser only for explicit navigation.
- Internal analysis planning tools page through active confirmed workbook regions and inspect exact subranges; they cannot execute calculations.
- AnalysisThread/AnalysisPlanRevision routes persist immutable reviewed workbook and/or active-experiment selections plus natural-language plans. Idempotent acceptance creates only a queued AnalysisRun; Python is generated later from its materialized input.
- New chart requests explicitly choose Experiment Browser (default and
  template-compatible) or Workbook (advanced one-off) input mode. Planning sees
  only the selected catalog, and schema validation rejects mixed-source chart
  plans even if a model proposes one.
- Once an analysis-planning AgentRun has created its durable AnalysisThread,
  plan drafting is server-owned and is not aborted by a browser disconnect.
  Clients recover or observe the same thread through list/detail reads. Draft
  failure is persisted as `status: plan_failed` with a bounded `planFailure` on
  thread detail; provider credentials and request headers are never returned.
- Project analysis capabilities expose only public model/executor readiness plus confirmed-region and accepted snapshot/head counts. Evidence-blocked AnalysisThreads may be retried when confirmed evidence is available through an editor-authorized, claim-guarded operation that cannot execute or publish.
- AnalysisRun execution is a separate authenticated backend operation. It re-resolves accepted source selections and materializes complete multi-table inputs through bounded SourceDocument reads. General analysis runs generate policy-checked Python from those real inputs. The full-page master-table onboarding flow may instead request the backend-owned `direct_source_mapping` program, which maps the accepted region interpretation without another model generation step. Both strategies pass through the same bounded result, provenance, and declared-invariant validation and persist an immutable awaiting-review AnalysisResult; execution never creates a ChartSpec. `trace_y_sum` checks a complete series, and `x_group_y_sum` checks stacked components at each shared X category.
- A terminal failed or validation-failed AnalysisRun may be retried through `POST /api/v1/analysis-runs/:analysisRunId/retry` with an idempotency key. Retry preserves the failed run and creates a new queued run against the same accepted plan and execution strategy; it does not revise evidence, accept results, or publish data.
- Result acceptance is a second idempotent transaction: it checks the exact AnalysisResult id and reviewed curve ids, accepts the existing result, completes the run/thread, and creates exactly one analysis-result ChartSpec v3.
- Reusable chart style/template lifecycle APIs persist immutable accepted
  versions, return bounded project summaries, and derive eligible v1 template
  definitions only from accepted same-project scalar-comparison ChartSpecs.
  Template application now resolves compatible slots against frozen accepted
  experiment heads, persists an idempotent application, and creates an
  accepted plan plus queued run. `chart_template_v1` makes no provider call,
  generates no Python, creates a normal validated AnalysisResult, and uses the
  same explicit ChartSpec acceptance endpoint. See
  `doc/contracts/reusable-chart-template-contract-v1.md`.
- Experiment Browser result preview columns expose their proposed stored type,
  unit, and optional numeric scale. Preview cells include a bounded set of the
  already-validated exact source refs so the review UI can show raw source
  value/type/location beside the proposed stored value before publication.
- Active published experiment detail exposes the actual stored value/type,
  numeric scale, and source lineage from the accepted snapshot. Provider field
  patches, including full-field replacements, cannot downgrade a deterministic
  numeric source column to string.

## Verification

Changes to import parsing, project routes, accepted-data publication, or chart contracts require:

```bash
npm --prefix backend test
npm test
npm run build
```
