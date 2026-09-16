# Main And Backend v1 API Reconciliation Plan

Status: implemented and verified locally; release validation pending
Read when: reconciling remote `main` chart-template work with the NestJS `/api/v1` architecture.
Last reviewed: 2026-09-11

## Purpose

This plan records the agreed integration path for bringing the product, chart-template,
and scientific-workflow changes from remote `main` into the NestJS `/api/v1`
architecture. It is the implementation source of truth for this reconciliation.
The original 2026-09-07 checkpoint only saved this plan; the subsequent
implementation request authorized the local integration described below.

The reconciliation must preserve two things at the same time:

- the product behavior and scientific semantics already added on `main`; and
- the contract-first NestJS, OpenAPI, Drizzle, and `/api/v1` direction already built
  on the migration branch.

## Implementation Checkpoint — 2026-09-10

- [x] Created `codex/v1-main-reconcile` from the fixed `main` baseline and replayed
  `62ba4d9` as `e5ce047`, then `8c2cdaf` as `4d85b0f`.
- [x] Preserved `codex/onboarding-chat@8c2cdaf` and reconciled provider retry/budget
  behavior by intent.
- [x] Retained main migrations 024-026, renumbered authorization to 027, and added
  all six Drizzle tables plus `analysis_threads.input_mode`.
- [x] Implemented the twelve operations directly in `ReusableChartsModule`,
  including bounded collection queries, full-project authorization, immutable
  versions, audit events, and transactional application idempotency.
- [x] Updated OpenAPI and generated client types; moved React template helpers
  and project-state resource composition onto `/api/v1`.
- [x] Propagated chart input mode and resolved geometry. Preserved accepted
  `numericScale` through materialized experiment inputs; fraction percentages
  now reach the deterministic renderer without a false incompatibility error.
- [x] Added Nest/PostgreSQL lifecycle coverage for all twelve operations,
  read/propose/approve boundaries, shell concealment, project isolation,
  201/200/409 idempotency, explicit ChartSpec acceptance, and stale-head rejection.
- [x] Exercised the real migration runner against fresh, main-first, and
  former-authorization-first disposable schemas. The old authorization ledger
  entry is retained, checksums are verified, and repeated startup applies nothing.
- [x] Repaired both Compose dependency volumes using their lockfiles. Development
  compiles TypeScript before launching Nest so dependency-injection metadata is
  present. Existing local PostgreSQL and uploaded-file volumes are retained.
- [x] Passed `npm run codex:verify` and separate PostgreSQL suites (legacy 2/2,
  Nest v1 8/8). Recorded results and conditional skips in `doc/PROGRESS.md` and
  `doc/current-milestone.md`; all three local Compose services are healthy.
- [ ] Repeat verification in GitHub CI and perform separately authorized
  production canary/rollback checks before release.

Template writes reuse the established explicit PostgreSQL transactions, while
Nest owns transport, validation, authorization, and bounded Drizzle collection
reads. The Analysis module consumes the exported repository without a reverse
module dependency. No scientific snapshot or historical result is rewritten.

## Independent Branch Publication — 2026-09-11

The publication/review target is `origin/codex/backend-v1-architecture`, created
from the completed local integration work on `codex/v1-main-reconcile`. This
preserves the fixed integration baseline and the original migration branch.
The user requested a separate branch, not a merge into `main` or deployment.
Local credentials, cookies, temporary/agent directories, and private workbook
fixtures are excluded from the commit.

The existing Lightsail workflow is triggered only by `main` pushes or explicit
manual dispatch; this branch upload does not trigger it. Independent remote CI
and separately authorized production canary/rollback checks are still required.

## Confirmed Git Baseline

| Role | Ref | Commit |
| --- | --- | --- |
| Integration base | `origin/main` | `7e6d729bc00f86705689937b11b85ebd6537c23c` |
| Migration source and rollback reference | `codex/onboarding-chat` | `8c2cdafd9f4bdf9e5f4587e24971d1546f9f1cbc` |
| Merge base | shared history | `1e3740c899b0ff849a0210be6e7f2d2acde9fbe0` |

At the time of planning, `origin/main` has eight commits not present on the migration
branch, while `codex/onboarding-chat` has two commits not present on `main`.

Recorded integration sequence:

1. Create `codex/v1-main-reconcile` from `origin/main@7e6d729`.
2. Keep `codex/onboarding-chat@8c2cdaf` unchanged as the migration source and
   rollback reference.
3. Replay the migration work in order, beginning with `62ba4d9` and then `8c2cdaf`.
4. Resolve conflicts by intent; do not select one branch wholesale.

Conflict ownership is fixed as follows:

- `main` wins for product UI, chart-template workflows, and scientific semantics.
- The migration branch wins for NestJS controllers/modules, OpenAPI ownership,
  Drizzle persistence, generated `/api/v1` clients, and production entry wiring.
- Provider work must combine both branches: keep `main`'s concise, non-thinking
  truncation retry and accumulated usage reporting, together with the migration
  branch's 16k initial response limit and 32k truncation-only retry limit.
- Documentation must be reconciled and rewritten to describe the resulting system;
  do not resolve documentation conflicts with an unconditional ours/theirs choice.

## Target API Rules

All first-party browser-to-backend calls must use `/api/v1`. No compatibility route
under unversioned `/api` will be added for this work.

Common rules for the new resources are:

- Collection reads accept the existing cursor conventions, including `limit`,
  `cursor`, and `includeArchived`, and return `{ items, nextCursor }`.
- Project-scoped reads require effective full-project `read` permission.
- Create, new-version, archive, and template-application operations require effective
  full-project `propose` permission.
- Accepting a final ChartSpec remains an `approve` operation and is not weakened by
  template permissions.
- An identifier from another project must resolve as `404`, not disclose the foreign
  resource through `403` or metadata.
- Template application accepts `{ experimentIds, bindings }` and requires an
  `Idempotency-Key` header. A new application returns `201`, an exact replay returns
  `200`, and reuse of the key for a different request returns `409`.

## Twelve New API Operations

| # | Method | Final path | Purpose |
| ---: | --- | --- | --- |
| 1 | `GET` | `/api/v1/projects/{projectId}/chart-style-profiles` | List visible style profiles for a project. |
| 2 | `POST` | `/api/v1/projects/{projectId}/chart-style-profiles` | Create a style profile and its first immutable version. |
| 3 | `GET` | `/api/v1/chart-style-profiles/{chartStyleProfileId}` | Read a profile and its versions. |
| 4 | `POST` | `/api/v1/chart-style-profiles/{chartStyleProfileId}/versions` | Add an immutable profile version. |
| 5 | `POST` | `/api/v1/chart-style-profiles/{chartStyleProfileId}/archive` | Archive a profile without deleting history. |
| 6 | `GET` | `/api/v1/projects/{projectId}/reusable-chart-templates` | List reusable chart templates for a project. |
| 7 | `POST` | `/api/v1/projects/{projectId}/reusable-chart-templates` | Create a template and its first immutable version. |
| 8 | `GET` | `/api/v1/reusable-chart-templates/{reusableChartTemplateId}` | Read a template and its versions. |
| 9 | `POST` | `/api/v1/reusable-chart-templates/{reusableChartTemplateId}/versions` | Add an immutable template version. |
| 10 | `POST` | `/api/v1/reusable-chart-templates/{reusableChartTemplateId}/archive` | Archive a template without deleting history. |
| 11 | `GET` | `/api/v1/chart-specs/{chartSpecId}/template-eligibility` | Explain whether an accepted chart can become a reusable template. |
| 12 | `POST` | `/api/v1/reusable-chart-template-versions/{templateVersionId}/applications` | Apply a template version to explicit experiments and bindings. |

These operations must be added to the canonical OpenAPI document first, generated
into the client, and then implemented by NestJS. They must not be routed through the
legacy HTTP dispatcher.

## Existing API Adaptation Matrix

| Existing operation or surface | Required adaptation | Compatibility and authorization notes |
| --- | --- | --- |
| `GET /api/v1/projects` | Add a permission-scoped `workflowSummary` with experiment, ChartSpec, style-profile, and reusable-template counts. | Users with shell-only project visibility must not receive project-level asset counts. |
| `POST /api/v1/projects/{projectId}/analysis-threads` | Accept optional `inputMode` with `experiment_browser` or `workbook`. The UI defaults new chart work to `experiment_browser`. | Infer a safe mode for historical rows where `input_mode` is null; do not rewrite their history. |
| `POST /api/v1/projects/{projectId}/agent/runs` | Propagate `selectedContext.chartInputMode` into planning and execution context. | Reject internally inconsistent context instead of silently changing modes. |
| Analysis thread and plan responses | Expose `inputMode` and enforce that one chart task cannot mix workbook and Experiment Browser inputs. | Historical responses remain readable through bounded normalization. |
| `POST /api/v1/analysis-runs/{runId}/execute` | Add the deterministic `chart_template_v1` operation. | This operation must not invoke a model or Python executor. |
| `GET /api/v1/analysis-runs/{runId}/result-preview` | Return `resolvedGeometry`; for Browser-derived preview cells also return `storedType`, `unit`, `numericScale`, and bounded `sourceRefs`. | Preserve source lineage and do not synthesize scientific values. |
| Experiment Browser list/detail APIs | Surface persisted type information, percentage scale, and source lineage required for template binding and preview. | Do not rewrite historical DataSnapshots; normalize only at the read boundary where needed. |
| `POST /api/v1/analysis-runs/{runId}/accept-and-create-chart` | Keep the request contract stable while preserving `templateLineage` and `resolvedGeometry` in the accepted ChartSpec. | Translate a stale accepted-snapshot head into the stable `chart_template_inputs_stale` error. Final acceptance still requires `approve`. |
| Project-state frontend composition | Compose explicit `/api/v1` resources, including style-profile and template collections. | Do not restore `GET /api/projects/{projectId}/state`. |
| Manuscript chart creation | Keep this as frontend composition using accepted ChartSpecs and explicit placement. | No new manuscript-first backend endpoint is introduced. |

## Persistence And Migration Reconciliation

Remote `main` already assigns the following immutable migration numbers:

- `024_reusable_chart_templates`
- `025_reusable_chart_template_applications`
- `026_analysis_chart_input_mode`

The migration branch's unpublished `024_authorization_v1` must therefore be
renumbered to `027_authorization_v1` when replayed. Do not edit or delete migration
ledger rows manually.

The local development database may already contain the old
`024_authorization_v1`. The new `027_authorization_v1` must be idempotent against that
state so that applying it again is safe. Migration verification must cover all three
starting points:

1. a fresh empty database;
2. the current local database with the former authorization migration applied; and
3. a production-like `main` database with migrations 024 through 026 applied before
   027.

The Drizzle model must gain the six reusable-chart tables introduced by `main` and
`analysis_threads.input_mode`. Existing lineage, resolved geometry, and numeric-scale
payloads remain in their agreed JSONB boundaries rather than triggering a broad
schema normalization during this reconciliation.

## NestJS Module Boundary

Add a `ReusableChartsModule` that owns the 12 new operations and their OpenAPI
contracts. Use normal Drizzle repository queries for bounded reads. Use explicit
transactions, locking, and idempotency handling for version creation and template
application, where concurrent writes affect immutable lineage.

The module must export a narrow repository port to the Analysis module so the
deterministic `chart_template_v1` executor can read accepted templates without
creating a circular dependency.

Reuse the already tested JavaScript domain algorithms from `main` for template
eligibility, compatibility, binding, geometry, and lineage during this integration.
A mass TypeScript rewrite of those algorithms is deliberately deferred. NestJS must
own HTTP transport directly; do not add a Nest-to-legacy-dispatcher bridge.

## Frontend Reconciliation

Preserve the `main` product flows:

- `Create chart`, `Use template`, and `Approved charts` entry points;
- `Save as template` from an eligible accepted chart;
- the template picker and experiment/binding review;
- Manuscript insertion through its context menu and explicit placement behavior.

Adapt every new or changed helper to the generated `/api/v1` contract through the
existing `apiV1Request` boundary. Project loading must compose the explicit resources
it needs, including style-profile and reusable-template lists. A user with shell-only
visibility receives no project-level chart/template assets.

Add or retain a guard test that rejects first-party frontend calls to unversioned
`/api`. Do not reintroduce the retired monolithic project-state endpoint.

The following product extensions are outside this reconciliation:

- a broader template-management UI beyond the flows already on `main`;
- automatic style extraction from reference figures;
- arbitrary user-authored transformation recipes; and
- a broad TypeScript rewrite of stable scientific domain logic.

## Implementation Order

Implement one reviewable milestone at a time:

1. **Integration baseline:** create the integration branch from the fixed `main` ref,
   replay the two migration commits, and resolve conflicts using the ownership rules
   above.
2. **Migrations and schema:** reconcile 024-027, add Drizzle definitions, and prove
   the three migration starting states.
3. **NestJS contract and module:** update OpenAPI, regenerate the client, implement
   `ReusableChartsModule`, connect the Analysis repository port, and add backend
   authorization/idempotency tests.
4. **React adaptation:** retain the `main` UX while replacing its unversioned helpers
   and project-state assumptions with explicit generated `/api/v1` calls.
5. **Runtime, documentation, and release:** repair local Compose dependency
   bootstrapping, run the full verification suite, update active documentation, and
   release only after all gates pass.

The original runtime failure was an old backend dependency volume missing `tsx`.
Runtime verification also exposed missing Nest decorator metadata in direct
`tsx` startup and missing `openapi-fetch` in the frontend dependency volume.
Compose now compares each lockfile with the installed-volume marker, restores
dependencies with `npm ci --include=dev` when needed, and only records success
after installation. The backend starts the TypeScript-compiled entry after
migration, retaining local environment-file loading and explicit restarts.

## Verification Plan

### Contract, authorization, and persistence

- Verify all 12 operations against generated OpenAPI types.
- Cover lifecycle create/read/version/archive behavior.
- Cover full-project `read`, `propose`, and final `approve` boundaries.
- Cover shell-only visibility and cross-project `404` behavior.
- Cover template-application idempotency: new `201`, replay `200`, conflicting key
  `409`.
- Cover all three migration starting states.

### Scientific and analysis behavior

- Verify template eligibility and experiment compatibility.
- Reject stale snapshot heads with `chart_template_inputs_stale`.
- Prove `chart_template_v1` invokes neither the model nor Python.
- Preserve resolved geometry, stored types, units, percentage scale, bounded source
  references, and template lineage.
- Require explicit human acceptance before creating the final ChartSpec.
- Verify `inputMode` rules and historical null compatibility without snapshot
  rewrites.

### Frontend behavior

- Verify Create chart, Use template, Approved charts, Save as template, picker, and
  Manuscript placement flows.
- Verify shell-only users receive no unauthorized asset summaries or collections.
- Verify no first-party frontend request targets unversioned `/api`.

### Commands

Implementation verification commands:

    npm run generate:api:v1
    npm run check:api:v1
    npm --prefix backend test
    npm --prefix backend run build:v1
    npm --prefix backend run test:postgres
    npm test
    npm run build
    npm run codex:verify
    git diff --check

## Release Gates

Release is allowed only when:

- CI and the full verification commands are green;
- the fresh, old-local-auth, and production-main migration paths all pass;
- local Compose reports healthy frontend, backend, and PostgreSQL services;
- all first-party frontend calls use `/api/v1`;
- every OpenAPI route in this scope is owned directly by NestJS; and
- the prior stable release remains available for one rollback window.

The local implementation checkpoint does not activate production. Production
deployment remains a separate operation after these gates pass.

## Open Questions

None. The baseline, ownership rules, API surface, migration numbering, sequence, and
release gates are confirmed.
