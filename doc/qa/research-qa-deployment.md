# Research Q&A v1 deployment

Date: 2026-09-27
Status: deployed and verified

## Final deployed result

Production code: f31726520c3a07ba7d1005335daabc3e7374a07c.
[Successful hosted workflow](https://github.com/Thesclhy/LabRat/actions/runs/36341375213);
[live application](https://labrat.100.50.25.194.nip.io/LabRat/).
Actual release: /opt/labrat/releases/20260927184046-f31726520c3a.

- Hosted frontend 416/416, Node 401 passed with three retired skips, Nest 72/72,
  PostgreSQL 2 legacy + 20 Nest; API types, both builds and production entry passed.
- Production service and HTTPS health passed. Public page and JS/CSS hashes
  match the released files. Q&A rejects unauthenticated requests with HTTP 401.
- Both additive migrations 034/035 match the live migration ledger checksums.
- Actual compiled TXT, DOC, DOCX and a three-page PDF with English/Chinese scans
  parsed successfully, preserving page locations and explicit OCR uncertainty.
- Live Anthropic claude-sonnet-4-5 answered both synthetic questions with valid
  source quotes, dry-only conditions, stored value 82 C and its exact numeric
  binding. Existing provider/model settings were preserved. These are two
  bounded component canaries, not a full Anthropic quality benchmark.
- Database/files were backed up and checked before deployment. No production
  research records or scientific results were created or modified by smoke tests.

Structured evidence: [live verification receipt](research-qa-live-verification.json).
Original source acceptance remains historical: eleven of thirteen core files
have identical published hashes; two adapters differ only by Git CRLF-to-LF
normalization. The new Anthropic-only compatibility adapter has its own hash,
focused regression and live-provider evidence in the receipt. DeepSeek behavior
and the original cited-answer schema are unchanged.

The initial local checkout retains unrelated work and its earlier base/migration
numbering. Future deployment work must use the integrated release checkout or
integrate current main before applying migrations. Do not apply the old local
031/032 Q&A filenames to the production database.

The user explicitly requested remote deployment after local Q&A acceptance.
This separately prepared release starts from origin/main
834284df49afe3384497b8bb5231bb66b010562c. Existing manual Browser rows, lab-member
administration and workbook suggestions remain intact. Independent permission
matrix/editor-reviewer work in the original checkout is not included.

Q&A migrations are 034_research_documents.sql and 035_research_answers.sql;
remote 031–033 remain unchanged. No existing scientific result is recalculated
or overwritten. The thirteen Q&A implementation/label/harness files captured by
the accepted provider evaluation match after line-ending normalization; the
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

The initial release checklist required Linux CI/deployment, deployed SHA/service and migration
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

## Linux OCR fixture environment

Commit 69419ea passed hosted installation and frontend tests. [Run 36340264429](https://github.com/Thesclhy/LabRat/actions/runs/36340264429)
then failed the Chinese generated-image OCR check: the Linux runner had no CJK
font, so the fixture rendered missing-glyph boxes. CI now installs fonts-noto-cjk
before backend tests and the fixture explicitly prefers Noto Sans CJK SC with
the existing Windows fallbacks. OCR assertions and production parser code are
unchanged. This is a fixture rendering dependency, not an OCR language download;
English and Chinese recognition data are already packaged with the application.
No service switch occurred in either failed workflow.

## First live canary and Anthropic compatibility repair

Commit 1cec67e completed [hosted run 36340625296](https://github.com/Thesclhy/LabRat/actions/runs/36340625296)
and activated /opt/labrat/releases/20260927182957-1cec67e16b42. Hosted checks
passed: frontend 416, Node 399 with three retired skips, Nest 72, PostgreSQL
2 legacy + 20 Nest (one optional provider evaluation skipped), builds and entry
smoke. Live migration checksums, HTTPS page/asset hashes, service health,
unauthenticated Q&A rejection and compiled TXT/DOC/DOCX/mixed English-Chinese
PDF parsing all passed. The PDF correctly retains its partial/OCR warning state.

The real Anthropic canary then returned HTTP 400 because maxItems is unsupported
in its structured output schema. The adapter now moves unsupported length,
numeric and array constraints into provider-facing descriptions. Both normal
and tool requests retain original schema validation in the gateway; citation,
number, unit and resource checks are unchanged. This follows the documented
[Anthropic schema transformation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
No provider or model setting changed.

All 24 gateway/citation checks and the backend build passed. The corrected
compiled adapter was tested in an isolated server-side copy, using only
generated evidence and the existing protected configuration. Actual Anthropic
claude-sonnet-4-5 document and accepted-value canaries both passed, including
dry-only/wet-excluded conditions, the stored 82 C and its exact numeric binding.
The follow-up deployment and another canary against its actual live release
were then verified on the final live release above. No research records were created by these checks.
