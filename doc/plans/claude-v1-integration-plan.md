# Claude / NestJS v1 Feature Parity

Status: implemented and locally verified; main publication/deployment approved
Baseline: main `474c1bb`; Claude `06ecf87`; integration branch `codex/claude-v1-integration`.
Approved: 2026-09-13 (implementation started)

## Locked decisions

Claude owns feature and interaction behavior; main owns Nest/Fastify/TypeScript,
Drizzle, invitation onboarding and capability authorization. All first-party
requests remain `/api/v1`. Pure deterministic scientific helpers may be reused;
legacy HTTP and legacy database stores are not the v1 application boundary.
Keep existing user changes. The implementation originally excluded main push,
deployment and live database writes. On 2026-09-13 the user subsequently and
explicitly approved main promotion and the existing automatic Lightsail
deployment/migrations. Cross-database consolidation and ad hoc server changes
remain outside scope. See `doc/PROGRESS.md` for publication status.

## Milestones

- [x] Verify branches and preserve existing progress edits; run preflight.
- [x] Reconcile clean-install lockfiles without dependency upgrades.
- [x] Preserve both historical 027/028 migration filename/checksum pairs; add
  029 application receipts and typed schema.
- [x] Port batch upload, formula provenance, extraction templates and atomic
  per-region batch confirmation, including the 11 new v1 operations.
- [x] Port linked Browser projection/comparisons and frozen-region chart templates.
- [x] Reconcile welcome/login, invitations, permission gates, background queues
  and stale workspace response isolation.
- [x] Verify generated contracts, unit suites, PostgreSQL upgrades/concurrency,
  production entry/build and real workbook/browser workflows.
- [ ] Rehearse actual main/Claude backup restores separately, verify the real
  provider and repeat hosted CI before separately authorized release work.

## API and permission boundary

New operations: source cell-classes; extraction-template list/create/detail/
version/archive; template-version matches/apply; project region confirm-batch;
linked-data-kinds and linked-data-comparisons. All use `/api/v1`.
Read/match/dry-run require read; upload/prefill/comparison/template runs require
propose; scientific confirmation/publication and saving extraction templates
with accepted-source linking require approve. Archive requires propose.
Project-wide evidence remains full-project-only, and platform superadmin is
not scientific authorization.

Application requests persist same-key/same-body receipts, reject changed bodies
with 409, lock sources against duplicate prefills and commit session/region/
revision/audit/receipt together. Batch confirmation requires exact revision and
expected region version; each row commits link/acceptance/audit atomically and
reports independent failures. No operation overwrites a prior source link.

## Scientific and UI parity

Preserve IDs, hashes, accepted history, data-kind naming, cached source values,
source refs, series selectors and frozen region revision refs. No formula
evaluation, implicit publication, provider calls during deterministic template
matching/execution, or new snapshots merely for linked data. Ordinary comparison
retains reviewed analysis. Existing accepted charts survive source lifecycle
changes; future applications use eligible currently accepted regions.

Preserve upload concurrency 2, interpretation concurrency 3, per-file retry,
region review/calculation overlays, extraction matching/batch confirmation,
Browser links, comparison coverage, chart template lineage, welcome/reduced
motion, chart commentary and manuscript interactions. Keep main invitation and
membership UX. Readonly must remain immutable; lab/project/logout/revocation
boundaries discard old responses while same-project workbook switches retain
the batch queue. API pagination/shape adaptation belongs in request helpers.

## Acceptance

Run fresh/main/Claude upgrade and restart checks with historical fixtures in
isolated PostgreSQL/file storage, not the live stores. Verify hashes/refs and
cross-lab scopes, rollback/concurrency/replay, shape/unit/missing/error cases and
provider-free point equality. Run full codex verification, generated types,
PostgreSQL suites, production smoke, Linux clean install and browser coverage
using available Exp33/34/35 and Exp48/49/50 workbooks plus synthetic edge cases.
Exercise owner/read/edit/approve, reload, source jumps, canvas drag/resize,
placement and export. Record any unavailable environment or unperformed check
explicitly; compilation is not frontend acceptance.

## Local Completion — 2026-09-13

All four implementation stages completed on the dedicated local branch before
publication approval. Final Linux clean installation and
Windows full verification passed (frontend 368, Nest 60; legacy Linux 332
passed/4 conditional skips, Windows 331/5). Separate PostgreSQL tests passed
15/15, covering three starting histories, retry/concurrency/rollback and
frozen-source publication. Real six-workbook Chromium flows cover upload,
region/template/batch review, linked Browser comparison, deterministic chart
execution/acceptance, invitation onboarding, four roles, canvas and PPTX.
All 51 valid chart points and source coordinates equal the workbook cache.

Exact evidence and fixture limits: `doc/qa/claude-v1-integration-acceptance.md`.
Actual database backups, live-provider comparison and hosted/production checks
were not exercised; follow `doc/plans/claude-v1-database-upgrade.md` before any
release. Local verification alone is not release approval; the later explicit
user confirmation authorizes only the normal main deployment workflow.
