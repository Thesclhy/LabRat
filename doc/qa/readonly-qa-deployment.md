# Read-only Q&A/source trace deployment

Date: 2026-09-30. Status: deployed and verified; user manual acceptance pending.

The user explicitly requested merging the verified change into main. Remote main
was still 4f99874, so the isolated codex/readonly-qa-trace branch fast-forwarded
main to application 159e50b9a21ae2ce3c3d37044b43cb0150fc8033. No unrelated changes
from the original dirty checkout were included. The main push triggered the
existing Lightsail production workflow; no separate manual deployment was used.

## Backup and release

- Pre-deploy backup set 20260930050229 in
  /var/backups/labrat/readonly-qa-trace-20260930; database gzip and file archive
  integrity passed. No old backups were removed.
- Previous release: /opt/labrat/releases/20260928205352-2bf3226c3497.
- [Workflow 36671612147](https://github.com/Thesclhy/LabRat/actions/runs/36671612147)
  passed frontend/backend and full PostgreSQL tests, generated API freshness,
  deployment transaction checks, both builds, production-entry smoke and deploy.
- Active application: /opt/labrat/releases/20260930050626-159e50b9a21a.
- Service active, local/public health passed, and exact publicly served HTML,
  JavaScript and CSS hashes match the release files.
- The deployed compiled answer interface passes synthetic format/read-ID checks,
  without prose-number verification; selected-only tools are restricted and the
  retired unconfirmed workbook reader is not exposed. This probe is not a model
  answer-quality evaluation.
- Unauthenticated question, reference and task endpoints return 401.
- Provider: anthropic / claude-sonnet-4-5; configured.
  No model call, schema addition, auth configuration change or production research
  record write was performed by these live verification probes.

Receipts: [live checks](readonly-qa-live.json), [hosted jobs](readonly-qa-workflow.json).
Local GitHub CLI credentials were invalid; SSH push worked, and workflow status
was read through the available GitHub connector and public read-only API. No
credential file was modified. Documentation is published separately with skip-ci;
the active application remains the exact application commit above.

The first live probe failed to parse because its temporary runner lost URL-regex
escaping. The runner was corrected and rerun; all live checks then passed without
any application change or service restart.

## User acceptance

Refresh the app and submit a new @Q01-scope.txt question. Expand Sources read and
open the original window; then check accepted experiment values, confirmed Excel
cells and the explicit selected-only scope. Existing failed messages are not
rewritten. Follow [the manual checklist](readonly-qa-trace.md) for the remaining
cross-device, version, View and reviewed-calculation checks. Hosted/live checks
do not replace the user's manual acceptance or scientific judgment.
