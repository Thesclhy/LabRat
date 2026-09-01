# Backend API v1 Migration Inventory

Status: completed migration inventory; retained for cutover audit
Last reviewed: 2026-08-23

## Classification

- `preserve`: domain behavior and side effects remain; public DTOs may adopt
  the v1 envelope and authorization model.
- `redesign`: v1 intentionally changes authorization, DTO or endpoint
  semantics; legacy output is characterization evidence only.
- `retire`: no v1 operation is provided and requests return `404`.

No active v1 operation remains bridged. The legacy dispatcher is retained only
as a previous-release rollback implementation.

## Global Intentional Deltas

| Area | Legacy `/api` | Target `/api/v1` |
| --- | --- | --- |
| Versioning | Unversioned | `/api/v1` |
| Errors | `{error:{code,message,details?}}` | Adds bounded `requestId` |
| Lists | Mixed property names | `{items,nextCursor}` unless a named aggregate DTO is required |
| Authorization | Ranked Lab role; super-admin bypass | Capability grants; platform admin has no scientific-data bypass |
| Validation | Handler-specific | DTO validation rejects unknown/invalid input before services |
| Persistence | Store methods called from route dispatcher | Application service and scoped repository |
| Large data | Endpoint-specific | Summary/list DTO plus explicit bounded detail/range endpoint |

## Active Operations

| Method and v1 path | Classification | Migration owner | Required capability |
| --- | --- | --- | --- |
| `GET /health` | preserve | Platform | public |
| `POST /api/v1/auth/login` | preserve | Identity | public |
| `POST /api/v1/auth/logout` | preserve | Identity | authenticated |
| `GET /api/v1/auth/me` | redesign | Identity | authenticated |
| `GET, POST /api/v1/admin/labs` | redesign | Identity/Tenancy | platform admin |
| `GET, POST /api/v1/admin/users` | redesign | Identity | platform admin |
| `PATCH /api/v1/admin/users/{userId}` | redesign | Identity | platform admin |
| `POST /api/v1/admin/users/{userId}/reset-password` | preserve | Identity | platform admin |
| `GET /api/v1/labs` | redesign | Tenancy/Authorization | authenticated |
| `GET /api/v1/labs/{labId}/members` | new | Authorization | manage_access |
| `PUT, DELETE /api/v1/labs/{labId}/members/{userId}` | new | Authorization | manage_access |
| `GET, POST /api/v1/projects` | redesign | Workspace/Authorization | read or Lab admin |
| `GET, PATCH /api/v1/projects/{projectId}` | redesign | Workspace | read / propose |
| `PATCH /api/v1/projects/{projectId}/profile` | redesign | Workspace | propose |
| `GET, POST /api/v1/labs/{labId}/groups` | new | Authorization | manage_access |
| `PATCH, DELETE /api/v1/labs/{labId}/groups/{groupId}` | new | Authorization | manage_access |
| `PUT, DELETE /api/v1/labs/{labId}/groups/{groupId}/members/{userId}` | new | Authorization | manage_access |
| `GET, POST /api/v1/projects/{projectId}/access-grants` | new | Authorization | manage_access |
| `DELETE /api/v1/projects/{projectId}/access-grants/{grantId}` | new | Authorization | manage_access |
| `GET /api/v1/projects/{projectId}/access` | new | Authorization | read |
| `GET /api/v1/projects/{projectId}/analysis-capabilities` | redesign | Analysis | read |
| `POST /api/v1/projects/{projectId}/evidence/retrieve` | preserve | Evidence | read |
| `GET /api/v1/projects/{projectId}/data-plans` | preserve, historical read-only | Experiment | read |
| `GET /api/v1/projects/{projectId}/data-snapshots` | preserve | Experiment | read |
| `GET /api/v1/projects/{projectId}/experiment-browser` | redesign | Experiment | read |
| `GET /api/v1/projects/{projectId}/experiments/{experimentId}` | redesign | Experiment | read on experiment |
| `GET /api/v1/projects/{projectId}/experiment-annotations` | preserve | Experiment | read |
| `PUT, DELETE /api/v1/projects/{projectId}/experiments/{experimentId}/annotation` | preserve | Experiment | read on experiment |
| `GET, POST /api/v1/projects/{projectId}/experiment-custom-columns` | preserve | Experiment | read / propose |
| `PATCH, DELETE /api/v1/projects/{projectId}/experiment-custom-columns/{columnId}` | preserve | Experiment | propose |
| `PUT /api/v1/projects/{projectId}/experiment-custom-columns/{columnId}/experiments/{experimentId}` | preserve | Experiment | propose on experiment |
| `GET, PATCH /api/v1/projects/{projectId}/browser-config` | preserve | Experiment | read / propose |
| `GET, POST /api/v1/projects/{projectId}/browser-views` | preserve, historical | Experiment | read / propose |
| `PATCH, DELETE /api/v1/projects/{projectId}/browser-views/{viewId}` | preserve, historical | Experiment | propose |
| `GET, POST /api/v1/projects/{projectId}/files` | preserve | Evidence | read / propose |
| `GET, POST /api/v1/projects/{projectId}/import-runs` | preserve | Evidence | read / propose |
| `GET /api/v1/projects/{projectId}/source-documents` | preserve | Evidence | read |
| `GET, POST /api/v1/projects/{projectId}/workbook-review-sessions` | preserve | Evidence | read / propose |
| `GET /api/v1/projects/{projectId}/region-understandings` | preserve | Evidence | read |
| `GET /api/v1/source-documents/{sourceDocumentId}/regions` | preserve | Evidence | read owning project |
| `POST /api/v1/source-documents/{sourceDocumentId}/query` | preserve | Evidence | read owning project |
| `POST /api/v1/source-documents/{sourceDocumentId}/range` | preserve | Evidence | read owning project |
| `GET, DELETE /api/v1/workbook-review-sessions/{sessionId}` | preserve | Evidence | read / propose |
| `GET, POST /api/v1/workbook-review-sessions/{sessionId}/regions` | preserve | Evidence | read / propose |
| `GET, DELETE /api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}` | preserve | Evidence | read / propose |
| `POST /api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/interpret` | preserve | Evidence | propose |
| `GET, POST /api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/revisions` | preserve | Evidence | read / propose |
| `POST /api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/confirm` | redesign authorization | Evidence | approve |
| `POST /api/v1/workbook-review-sessions/{sessionId}/regions/{regionId}/ignore` | preserve | Evidence | propose |
| `GET, POST /api/v1/projects/{projectId}/agent/runs` | preserve | Analysis | read / propose |
| `GET /api/v1/agent-runs/{agentRunId}` | preserve | Analysis | read owning project |
| `POST /api/v1/agent-runs/{agentRunId}/cancel` | preserve | Analysis | propose owning run |
| `GET, POST /api/v1/projects/{projectId}/analysis-threads` | preserve | Analysis | read / propose |
| `GET /api/v1/analysis-threads/{threadId}` | preserve | Analysis | read owning project |
| `POST /api/v1/analysis-threads/{threadId}/plan-revisions` | preserve | Analysis | propose |
| `POST /api/v1/analysis-threads/{threadId}/retry` | preserve | Analysis | propose |
| `GET /api/v1/analysis-plan-revisions/{revisionId}/selection` | preserve | Analysis | read owning project |
| `POST /api/v1/analysis-plan-revisions/{revisionId}/accept` | redesign authorization | Analysis | approve |
| `GET /api/v1/analysis-runs/{runId}` | preserve | Analysis | read owning project |
| `POST /api/v1/analysis-runs/{runId}/execute` | preserve | Analysis | propose |
| `POST /api/v1/analysis-runs/{runId}/retry` | preserve | Analysis | propose |
| `POST /api/v1/analysis-runs/{runId}/revise` | preserve | Analysis | propose |
| `GET /api/v1/analysis-runs/{runId}/result-preview` | preserve | Analysis | read owning project |
| `POST /api/v1/analysis-runs/{runId}/accept-and-create-chart` | redesign authorization | Charts | approve |
| `POST /api/v1/analysis-runs/{runId}/accept-and-publish-experiments` | redesign authorization | Experiment | approve |
| `GET /api/v1/projects/{projectId}/chart-specs` | preserve | Charts | read |
| `GET /api/v1/chart-specs/{chartSpecId}` | preserve | Charts | read owning project |
| `GET, POST /api/v1/projects/{projectId}/manuscripts` | preserve | Manuscripts | read / propose |
| `PATCH /api/v1/manuscripts/{manuscriptId}` | preserve | Manuscripts | propose owning project |

## Retired Operations

The following families remain absent and return the standard v1 `404` error:

- unscoped import normalize/apply and mapping routes
- aggregate dataset or current-dataset routes
- WorkbookUnderstanding aggregate revision/confirmation routes
- SourceExtractProposal and ChartProposalSet routes
- direct/unreviewed chart-generation routes
- observation-series and analysis-view routes
- old local IndexedDB or `.labrat.json` synchronization routes
- the legacy project-state aggregate; React composes its transient workspace
  view from explicit, authorization-scoped v1 resources

## Current Ownership State

Nest currently owns these route families without a legacy write bridge:

- Platform health, login/logout/current user, platform Lab/User administration,
  current-user Lab listing and Lab membership management.
- Lab groups, group membership, Project/Experiment grants and effective-access
  diagnostics.
- Project list/create/detail/update/profile with SQL-filtered minimum shells.
- DataPlan summaries, scoped DataSnapshot summaries, active Experiment detail
  and Experiment Browser projection.
- Personal Experiment annotations and BrowserViews, shared Browser config, and
  shared documentation columns/values.
- File upload/reuse, import scanning, SourceDocument indexing and bounded
  query/range reads, accepted Evidence retrieval, WorkbookReviewSession
  lifecycle, WorkbookReviewRegion interpretation/revision/disposition, and
  immutable approval-gated RegionUnderstandingRevision acceptance.
- Analysis capabilities, AgentRun lifecycle, reviewed
  AnalysisThread/PlanRevision/Run/Result workflows, execution/retry, bounded
  result previews, and approval-gated atomic ChartSpec/DataSnapshot
  publication.
- Accepted analysis-result ChartSpec cursor summaries and full immutable
  detail reads, plus Manuscript cursor reads, creation, partial JSONB updates,
  and audit events.

Every active route family has a Nest owner and a closed v1 DTO. React now uses
the generated `/api/v1` path types and composes its transient workspace view
from explicit v1 resources; it no longer calls the legacy aggregate or any
unversioned first-party route. Production switches the frontend and Nest entry
together, while the old release remains a rollback-only implementation.
