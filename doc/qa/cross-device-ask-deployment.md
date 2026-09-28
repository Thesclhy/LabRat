# Cross-device Ask task deployment

Date: 2026-09-28. Status: deployment in progress.

The user authorized deployment before beginning manual chat-panel acceptance.
User manual acceptance has **not started**. Existing verification is automated,
including browser automation with synthetic evidence; see
[the verification record](cross-device-ask-tasks.md).

Release scope: personal pending Excel-related questions persist across devices,
with migration 037 and the existing reviewed workbook and Q&A paths. The separate
LangGraph analysis pilot is not part of this deployment.

The release uses the existing main-triggered Lightsail pipeline after a fresh
database/file backup. Record hosted verification, active release, migration and
public asset/health results here after deployment completes.

Pre-deploy backup: `/var/backups/labrat/cross-device-ask-20260928`, set
`20260928181204`. Database gzip integrity and file archive listing passed.
Previous active release: `20260928155800-0d4a9eaabccb`; service active and health
passed at the configured port 8787. An initial check used port 3001 by mistake;
the corrected health probe passed without any service change.
