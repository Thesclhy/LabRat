# Mean-temperature planning deployment

Date: 2026-09-30. Status: deployed and verified; user retest pending.

User requested deployment after the local bug fix. Main had not advanced from
bad89ca, so the isolated codex/analysis-series-mean branch fast-forwarded main
to application c8a586963e5ffd6cc6678d985de040456c85d910. No original-tree edits or temporary files were included.

## Release evidence

- Fresh backup set 20260930151934, stored under
  /var/backups/labrat/analysis-series-mean-20260930. Database gzip and file archive
  integrity passed; existing backups were not pruned.
- Previous release: /opt/labrat/releases/20260930050626-159e50b9a21a.
- [Production workflow 36735959542](https://github.com/Thesclhy/LabRat/actions/runs/36735959542)
  passed the hosted tests, PostgreSQL integration suite, API-generation check,
  deploy-script transaction checks, builds, production-entry smoke and deploy.
- Active release: /opt/labrat/releases/20260930152442-c8a586963e5f.
- Backend service and local/public health passed. Served HTML, JavaScript and CSS
  hashes match the activated release; the new clarification UI text is present.
- Deployed compiled routing returns clarification for the exact calculation-only
  request on all three surfaces; direct plan drafting also stops before a model
  call or write. Explicit chart requests retain reviewed-analysis routing.
- Unauthenticated analysis, question, reference and task requests return 401.
- Selected provider: anthropic / claude-sonnet-4-5; configured.

Live checks used synthetic in-memory inputs. No production research records were
created, approved, calculated, replaced or deleted by verification. No new model
call was made on production. Provider interpretation was tested locally before
release; see [regression evidence](analysis-series-mean.md).

Receipts: [live checks](analysis-series-mean-live.json),
[hosted jobs](analysis-series-mean-workflow.json). Documentation is published in
a separate skip-ci commit; application c8a5869 remains the active release.

## User retest

Refresh the app and submit a new request. Do not approve the earlier incorrect
Revision 1. Start with Calculate the mean of Exp17's temperature series.
The planning handoff should clarify the supported output. Then explicitly ask
to plot that mean: with only the Q09 scalar records, expect missing-series
clarification rather than a claimed mean of 80 C or an executable chart plan.
Use [the manual steps](analysis-series-mean.md#manual-retest-after-deployment)
for genuine multi-point and one-point series.
