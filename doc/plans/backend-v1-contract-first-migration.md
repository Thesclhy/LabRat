# Backend v1 Contract-First Migration

Status: implemented and locally verified; production activation pending
Last reviewed: 2026-08-23

## Goal

Migrate the LabRat backend from the single JavaScript HTTP dispatcher to a
NestJS + Fastify + TypeScript modular monolith without weakening scientific
traceability, review boundaries, authorization, idempotency, or PostgreSQL
transaction guarantees.

The required order for every vertical slice is:

```text
inventory current behavior
  -> classify preserve / redesign / retire
  -> approve the /api/v1 contract
  -> add legacy characterization and v1 target tests
  -> migrate one writer
  -> verify PostgreSQL behavior
  -> switch the frontend caller
```

Legacy characterization describes what `/api` does today. It is not the
product contract. Only behavior explicitly classified `preserve` must match
between legacy and v1. Known defects and retired behavior receive target tests
for the intended result instead of compatibility tests.

## Locked Architecture

- Runtime: NestJS, Fastify, TypeScript, one modular-monolith process.
- API: `/api/v1`; JSON uses camelCase, ISO-8601 UTC timestamps, opaque ids,
  cursor pages, and one bounded error envelope.
- Persistence: PostgreSQL 16 with Drizzle schemas/repositories. Existing
  numbered SQL migrations remain authoritative and are applied by the existing
  migration runner.
- Complex persistence: `FOR UPDATE`, advisory locks, stale-head checks,
  idempotency receipts, and atomic publication remain explicit parameterized
  SQL inside Drizzle transactions.
- Authentication: existing server sessions and HTTP-only cookies; no JWT
  migration.
- Authorization: `Lab -> Project -> Experiment -> Artifact`, default deny,
  Lab groups, explicit grants, SQL-level filtering, and capability checks at
  controller, application-service, and repository boundaries.
- Deployment: legacy and v1 may run separately in development. Production
  switches frontend and backend as one release and rolls them back together.
  No request fan-out or writable dual-backend production topology is allowed.

## Vertical Slices

1. Platform, Identity, Tenancy, Authorization, Project and Experiment access.
2. FileObject, import lifecycle, SourceDocument, WorkbookReviewSession,
   WorkbookReviewRegion and RegionUnderstandingRevision.
3. DataSnapshot, ExperimentIdentity, ExperimentSnapshotHead, Browser
   projection, Browser configuration, annotations and documentation columns.
4. AgentRun, AnalysisThread, AnalysisPlanRevision, AnalysisRun,
   AnalysisResult, provider gateway and Python worker adapter.
5. ChartSpec and Manuscript.

Execution note (2026-08-23): all five Nest vertical slices are implemented and
locally green. React now calls only `/api/v1` through a generated OpenAPI path
map and typed request boundary. It composes its transient workspace state from
explicit authorization-scoped resources; the legacy project-state aggregate
is not part of v1. ChartSpec and Manuscript pages are followed to completion,
while intentionally bounded AgentRun and AnalysisThread summaries remain at
100 records. The production launcher selects the compiled Nest entry on port
8787, the release archive includes `dist-v1`, and the existing release symlink
plus provider-environment transaction rolls both frontend/backend code and AI
provider state back together. A production-mode entry smoke confirms that the
public health route is served by v1. Docker-backed PostgreSQL verification now
passes the two legacy integration checks and all six v1 authorization,
evidence, analysis, ChartSpec/Manuscript, migration, and schema-drift scenarios.
GitHub CI repeats the same database suite before production activation.

Every documented v1 endpoint is now owned by a Nest controller and has a closed
DTO. No v1 operation is bridged to the legacy dispatcher. The legacy server is
retained only inside the previous release for one rollback window.

## Contract Sources

- `doc/contracts/backend-api-v1.openapi.yaml`: machine-readable HTTP surface.
- `doc/contracts/authorization-v1.md`: roles, groups, capabilities,
  inheritance and query-filtering requirements.
- `doc/contracts/scientific-invariants-v1.md`: immutable evidence and reviewed
  publication rules.
- `doc/reports/backend-api-v1-migration-inventory.md`: operation ownership and
  intentional deltas.

OpenAPI is authoritative for paths, methods, public DTOs and status/error
shapes. The authorization and scientific contracts are authoritative for
behaviors that cannot be expressed completely in OpenAPI.

## Testing And Cutover

- Existing `node:test` coverage remains the legacy safety net.
- Framework-neutral HTTP scenarios normalize random ids and timestamps and
  run through legacy and v1 adapters for preserved behavior.
- New Nest tests use Vitest and Fastify injection.
- Persistence tests use disposable PostgreSQL databases created from the
  numbered migrations. In-memory stores are not proof of PostgreSQL parity.
- Each slice tests cross-Lab/project enumeration, revoked access, optimistic
  conflicts, idempotent replay, concurrent writes, rollback, immutable history
  and bounded public responses.
- Frontend API helpers use generated v1 path types, and a guard test rejects
  unversioned first-party request literals. Production activation keeps port
  8787 and ships the matching frontend plus compiled Nest backend in one
  release.
- The prior release and all additive schema changes remain rollback-compatible
  for one stable release window. Legacy implementation removal happens only
  after that window.

## Explicit Exclusions

- MCP servers and agent-framework adoption.
- Microservice extraction or a database-engine change.
- Drizzle `push`/`migrate` against production or rewriting migration history.
- Automatic cross-provider failover.
- Scientific semantic changes hidden inside framework work.
- Source-inspection `cells` plus `rows` compaction; the duplication is recorded
  as a non-normative legacy behavior and handled separately.
