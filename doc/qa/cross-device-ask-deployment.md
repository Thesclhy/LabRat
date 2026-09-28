# Cross-device Ask task deployment

Date: 2026-09-28. Status: deployed and verified; user manual acceptance not started.

The user authorized deployment before beginning manual chat-panel acceptance.
User manual acceptance has **not started**. Existing verification is automated,
including browser automation with synthetic evidence; see
[the verification record](cross-device-ask-tasks.md).

Release scope: personal pending Excel-related questions persist across devices,
with migration 037 and the existing reviewed workbook and Q&A paths. The separate
LangGraph analysis pilot is not part of this deployment.

The release used the existing main-triggered Lightsail pipeline after a fresh
database/file backup. The original dirty checkout's unrelated changes were preserved.

Pre-deploy backup: `/var/backups/labrat/cross-device-ask-20260928`, set
`20260928181204`. Database gzip integrity and file archive listing passed.
Previous active release: `20260928155800-0d4a9eaabccb`; service active and health
passed at the configured port 8787. An initial check used port 3001 by mistake;
the corrected health probe passed without any service change.

## Release result

- Application commit: `e780cffec0cf4526e5d23a6eae0fb3b8a9395e20`, pushed to main.
- [Hosted workflow 36463660597](https://github.com/Thesclhy/LabRat/actions/runs/36463660597)
  passed frontend/backend/PostgreSQL tests, API type freshness, builds, production
  entry smoke, upload and deployment.
- Active release: `/opt/labrat/releases/20260928181733-e780cffec0cf`.
- Migration 037 ledger checksum matches the deployed SQL. Task columns, personal
  page index and actor/project/request-key uniqueness are present.
- Compiled task modules exist; backend service is active. Local and public HTTPS
  health pass. Served HTML, JavaScript and CSS hashes match the active release.
- Unauthenticated task, reference and question list requests return 401.
- Provider remains Anthropic / claude-sonnet-4-5. This deployment verification
  made no model calls and created no production research records.
- Safe structured receipt: [cross-device-ask-live-verification.json](cross-device-ask-live-verification.json),
  completed at `2026-09-28T18:18:15.294Z`.

Local browser automation used independent contexts and synthetic evidence.
The live checks above do not constitute user manual acceptance or a new scientific
quality evaluation. The user will now test the production chat panel; the manual
scenarios remain in [the verification record](cross-device-ask-tasks.md).

Release documentation is committed separately with `[skip ci]`; the deployed
application remains the exact application commit above.
