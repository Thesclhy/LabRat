# Research Q&A v1 deployment

Date: 2026-09-27
Status: integrated verification passed; remote publication pending

The user explicitly requested remote deployment after local Q&A acceptance.
This separately prepared release starts from origin/main
834284df49afe3384497b8bb5231bb66b010562c. Existing manual Browser rows, lab-member
administration and workbook suggestions remain intact. Independent permission
matrix/editor-reviewer work in the original checkout is not included.

Q&A migrations are 034_research_documents.sql and 035_research_answers.sql;
remote 031–033 remain unchanged. No existing scientific result is recalculated
or overwritten. The thirteen Q&A implementation/label/harness files captured by
the accepted provider evaluation have matching hashes in this release; the
migration-specific document test is updated for its new filename.

[Local feature acceptance](research-qa-verification.md) records the earlier
baseline, real DeepSeek results and retained failed development runs. Integrated
release checks are recorded separately below. A local pass is not a hosted pass.

## Integrated release verification

- Full codex:verify passed: frontend 416/416, Node 393 passed / 402 total
  (nine conditional skips), Nest 72/72, generated API types, both builds and
  production entry smoke. The six Python executor checks passed separately with
  an explicit available Python runtime.
- Isolated PostgreSQL passed: two legacy and twenty Nest tests. The provider
  evaluation remains opt-in and is separately documented in local acceptance.
- Full Chrome Q&A workflow passed against both the development frontend and the
  built production frontend. It covers all seven formats, original-page OCR
  citations, raw versus accepted values, View/Guest/scoped access, cancellation,
  retries, history, revocation, narrow layout and reviewed-analysis handoff.
  No new analysis run or chart was created by Q&A.
- The first development-frontend browser run failed while waiting for the final
  workbook upload after a browser fetch failure. The initial log and screenshot
  were retained. A diagnostic-only harness update records failed requests; the
  development retry and production-build run both passed without app changes.
  The transient failure's cause is not established.

Local logs are retained under the release worktree's .tmp directory:
research-qa-release-verify.log, research-qa-release-postgres.log,
research-qa-release-browser.log, research-qa-release-browser-retry.log and
research-qa-release-browser-production.log. These temporary logs are not shipped.

## Production preparation

Release uses the existing main-triggered GitHub Actions/Lightsail workflow.
Production Node 22.23.1 meets parser requirements. The previous 834284d release
and service were healthy before deployment. Production selects Anthropic;
deployment preserves that selection. The full earlier semantic evaluation used
DeepSeek; a bounded synthetic Anthropic canary will be recorded separately and
does not represent full Anthropic quality acceptance.

The existing backup utility completed a fresh database and file backup in
/var/backups/labrat/research-qa-20260927, with suffix 20260927180143. Both gzip
integrity and file-archive listing passed. Backup contents and credentials remain
on the server. Private source files, cookies and credentials are not in Git.

Pending hosted checks: Linux CI/deployment, deployed SHA/service and migration
verification, public HTTPS health/assets, compiled parser smoke and the selected
provider's synthetic citation check. Parser/provider smoke uses generated data
only and does not create production research records.

## First hosted attempt and installation repair

Commit 30d7bc5 reached [workflow 36339754688](https://github.com/Thesclhy/LabRat/actions/runs/36339754688)
but stopped at backend dependency installation, before any upload, migration or
service switch. npm 10.9.8 required a nested esbuild 0.28.2 peer dependency for
Vitest that the npm 11-generated lock omitted. Regenerating in a clean package
directory with npm 10.9.8 supplied 27 missing development-only lock entries.
Existing package versions, hashes and platform metadata remain unchanged.
A real clean npm 10 installation passed; the corrected lock is checked again
before publication. The hosted pipeline will rerun on the follow-up commit.
