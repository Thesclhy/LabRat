# Claude / Main Database Upgrade Handoff

Status: local upgrade fixtures verified; production restore rehearsal pending
Last reviewed: 2026-09-13

This is a handoff, not by itself authorization to run against the server. The
integration branch is `codex/claude-v1-integration`. Local implementation made
no production changes. The subsequent 2026-09-13 user confirmation authorizes
main promotion and the existing automatic deployment/migrations; it does not
authorize merging databases or ad hoc environment changes. Publication and
activation evidence is tracked in `doc/PROGRESS.md`.

## Supported Starting Points

| Starting database | Added history | Preserved state |
| --- | --- | --- |
| Empty | All named SQL migrations | New schema |
| main at 474c1bb | Claude extraction-template migrations plus 029 receipts | Auth, invitations, grants, projects and scientific history |
| Claude at 06ecf87 | main authorization/invitation migrations plus 029 receipts | Region/template IDs, JSON, links, accepted revisions and source references |

The history key is the complete filename and SHA-256 checksum, not its numeric
prefix. Keep both `027_authorization_v1.sql` and
`027_region_extraction_templates.sql`, and both
`028_invitation_onboarding.sql` and `028_region_template_applications.sql`.
Do not rename, renumber or edit previously applied files. The migration runner
continues to reject a checksum mismatch instead of silently skipping it.

`029_region_template_apply_receipts.sql` adds project-scoped application
idempotency receipts: key, actor, template version, normalized request hash and
response. Existing applications/history are not reconstructed or overwritten.
The Drizzle schema describes these SQL-owned tables; generated ORM migrations
do not replace the repository's migration ledger.

## Rehearsal Before Any Release

1. Choose one source database. Never combine main and Claude databases.
2. Stop writes or obtain a consistent database backup and matching uploaded-file
   storage snapshot. Record schema ledger/checksums, table counts, source/file
   IDs, content/dependency hashes, accepted pointers and storage-key mappings.
3. Restore into a separate database and separate file-storage directory. Point
   an isolated application at those copies only; disable external model calls
   and background work until configuration and membership scopes are checked.
4. Use the CI Node/npm runtime and `npm ci` at the root and in `backend`.
   The lockfile repair adds missing nested esbuild packages without upgrading
   any previously locked version. Do not run `npm install` on the server to
   improvise a different lockfile.
5. Run the existing `npm --prefix backend run migrate` with that isolated
   database URL. Run it again: the second run must apply no migrations.
6. Compare the pre/post inventory. Confirm source bytes/storage references,
   revision JSON, accepted charts, memberships and intended capability grants.
   Reopen representative old workbooks/charts; create and retry a new template
   application; test read/edit/approve and removed-member accounts.
7. Complete the feature acceptance matrix and obtain separate release approval.
   Set the actual application entry to Nest v1 through the existing guarded
   release process; do not re-enable the old `/api` router.

## Failure And Rollback

A migration error is a failed release gate. Preserve logs and the original
backup; do not mark a failing filename applied or alter its ledger checksum.
Do not automatically drop tables or run inverse SQL against accepted research
history. If a rehearsal fails, diagnose in the isolated copy and create a new
forward migration where needed.

Production rollback requires the previously validated application release and
its compatible database/file snapshot. New template receipts and v1 grants
must not be assumed compatible with arbitrary older binaries. If users wrote
new data after activation, restoring an earlier backup loses those writes and
requires an explicit recovery decision, not an automatic script.

## What Was Verified Locally

`backend/src/v1/region-templates/region-templates.postgres.test.ts` exercises
empty/main/Claude SQL-history fixtures in disposable PostgreSQL schemas,
repeat startup, complete filename ledgers, hash/reference preservation and
deliberately changed-checksum rejection. Separate API scenarios verify
application/confirmation concurrency, audit failure rollback and source
version freezing. Real workbooks were uploaded only to a disposable database
and isolated local storage for browser QA.

These fixtures are not restored copies of the user's main or Claude database.
No actual production backup was provided or read. A backup/restore rehearsal,
real provider validation and production health check remain release gates.
See `doc/qa/claude-v1-integration-acceptance.md` for the exact local coverage.
