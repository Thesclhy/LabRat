# Claude Workbook Features On API v1

Status: contract
Last reviewed: 2026-09-13

Feature reference: Claude `06ecf87`. Architecture and authorization reference:
main `474c1bb`. This addendum, `authorization-v1.md` and
`backend-api-v1.openapi.yaml` govern the integrated Nest/Fastify service.
Unversioned paths and legacy viewer/editor roles in older feature plans are
rollback descriptions, not an alternative HTTP or permission boundary.

## Operations

All paths below have the `/api/v1` prefix. Project-wide workbook evidence
requires full-project access; selected-experiment grants do not expose entire
workbooks or project template catalogs. Platform superadmin alone is insufficient.

| Method and resource | Capability | Response / boundary |
| --- | --- | --- |
| GET source-documents/{id}/cell-classes | read | Bounded range and formula cell classification |
| GET projects/{projectId}/region-extraction-templates | read | Cursor page, archived excluded by default |
| POST projects/{projectId}/region-extraction-templates | approve | Template, version and accepted source-region link |
| GET region-extraction-templates/{id} | read | Template detail and versions |
| POST region-extraction-templates/{id}/versions | approve | New immutable version; preserve existing experiment link |
| POST region-extraction-templates/{id}/archive | propose | Logical archive |
| POST region-extraction-template-versions/{id}/matches | read | Deterministic match report; no writes or model calls |
| POST region-extraction-template-versions/{id}/apply | propose | Atomic prefill and idempotent receipt |
| POST projects/{projectId}/workbook-review-regions/confirm-batch | approve | Independent per-region outcomes |
| GET projects/{projectId}/linked-data-kinds | read | Confirmed-region coverage and source navigation |
| POST projects/{projectId}/linked-data-comparisons | read for dryRun; propose otherwise | Read-only preview or atomic thread/plan proposal |

DTOs reject unknown fields and enforce the published bounds: template names
120 characters, descriptions 1,000, page size 100, confirmation batch 200,
comparison experiment selection 64. Existing single-file upload is reused.
React adapts pages/envelopes through the generated v1 client; it never mounts
or calls old `/api` resources. Multipart boundaries belong to the final fetch
serialization, not an intermediate Request object.

Browser requests use a maximum page size of 250 and retain cursor continuation;
template pickers expose Load more instead of treating the first bounded page
as the complete experiment list. Analysis plan summaries expose optional
`templateLineage` and `linkedDataComparison` JSON through OpenAPI and the
generated client, preserving frozen references without exposing Python.

## Atomic Writes And Revocation

Saving an extraction template/version also links its confirmed source region.
The template, immutable version, source association and audit commit together
under `approve`; an existing experiment link is not replaced. An unresolved
identity remains a review problem, not permission to invent an experiment.

Template application requires `Idempotency-Key`. Its request hash includes the
actor, version, version content, document selection and allowed match states.
Same key and same normalized request return the saved result; changed inputs
return 409. A project advisory lock and ordered source/session/region locks
prevent concurrent duplicate prefills. Session, region, revision, audit and
`region_template_apply_receipts` are one transaction. Receipts are read only
after checking current authorization.

Batch confirmation requires both the exact revision ID and expected region
version. Each item independently commits its experiment association, accepted
pointer and audit. Errors do not roll back successful siblings. Only eligible
exact/shifted template matches use this fast path; ambiguous matches require
individual review. Retrying a stale confirmation reports conflict.

New write transactions lock and recheck active lab/account/access. Region
interpretation, model-backed plan drafting, agent writes and execution also
recheck the initiating identity and capabilities before asynchronous domain
writes. Executing another user's queued run does not bypass that original
initiator's revocation. Scope changes abort frontend requests; backend checks
remain authoritative if the browser closes or ignores cancellation.

## Scientific Compatibility

Formula dependencies, warnings, cell classes, multi-series definitions and
source coordinates use the Claude deterministic helpers. Excel formulas are
never evaluated: only cached values are read. Blanks and Excel errors cannot
become valid zeroes. Every materialized point retains its cell source.
Existing `dataKind` strings, revision JSON, IDs, hashes and historical references
are preserved; importing this architecture does not re-understand old evidence.

New linked-template applications choose current eligible confirmed regions and
freeze their exact revisions. Execution and chart publication verify the
persisted application/version/run/accepted-plan binding before reading those
frozen revisions. A newer accepted pointer does not silently replace or reject
that prepared input. This is a narrow exception to current-pointer checks for
ordinary analyses; scalar snapshot-head checks are unchanged. Missing frozen
source material still fails. Previously accepted chart snapshots survive
reconfirmation and logical workbook deletion without rewriting their values.

Linked workbook columns add navigable metadata only to snapshot-backed Browser
rows. They do not create scalar values, DataSnapshots or Browser rows by
themselves. Ordinary linked-data comparison remains a reviewable analysis plan.
Only full-project readers receive linked-workbook metadata in Browser lists
and experiment detail; selected-experiment grants retain their narrower shell.
Saved eligible linked-chart templates execute deterministically without a
provider call or generated Python and still require `approve` to publish.

## Frontend State

The welcome screen/reduced-motion behavior precede main's invitation-aware
login. Lab management, platform management without lab membership, invitation
redemption and lab switching are retained. Readonly users cannot upload,
interpret, confirm, edit canvas blocks or create pending saves. Editors can
propose; only approvers confirm regions or publish results.

Readonly chart management still allows approved-chart inspection and dry-run
linked comparison; it does not allow creating a plan, running a template or
inserting a manuscript block. Newly inserted chart placements inherit the
accepted axis labels, while existing stored layout overrides remain intact.
Asynchronous chart rendering settles before cleanup so navigating between
review and canvas cannot purge an unfinished Plotly render.

Batch upload concurrency is 2; shared interpretation concurrency is 3. Per-file
failure/retry, extraction matching, selection-based batch confirmation,
calculation overlays and linked-source navigation keep Claude's compact UI.
Switching workbooks inside one project preserves the batch queue. Changing
project/lab, logging out or losing access discards stale workspace responses.
Textual chart commentary remains distinct from analysis/chart creation.

Implementation and acceptance records: `doc/plans/claude-v1-integration-plan.md`
and `doc/qa/claude-v1-integration-acceptance.md`.
