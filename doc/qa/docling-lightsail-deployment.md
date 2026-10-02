# Docling / Lightsail 8GB deployment

Started: 2026-10-01 (America/New_York); continued 2026-10-02.
Status: 8GB instance serving production; Linux acceptance passed; application release pending.

The user authorized upgrading the 2GB production instance to the 8GB IPv4
Lightsail plan ($44/month), retaining the original instance for rollback, and
deploying the locally verified Docling page implementation.

## Preparation

- Verified AWS account 477611841179 through the existing local default CLI
  profile. The `labrat` SSO profile is expired; no credentials were printed.
- Current instance: `labrat-prod-1`, `us-east-1a`, Ubuntu 24.04, bundle
  `small_3_0` (2GB / 2 vCPU), static IP `labrat-prod-ip` (100.50.25.194).
- Existing application: `c8a586963e5f`; backend, PostgreSQL and Caddy healthy.
- New plan verified from the account API: `large_3_0`, 8GB / 2 vCPU / 160GB,
  $44/month. Keep the IPv4 address and existing deployment SSH key.
- Pre-upgrade database and files backup: UTC `20261002030236`, under
  `/var/backups/labrat/pre-docling-8gb-20261001`. Gzip and tar integrity passed.
- Snapshot `labrat-pre-docling-8gb-20261001` available; creation succeeded.
  Operation: `4cf90e93-395a-44cf-8919-7c81582780fd`.
- Created `labrat-prod-8gb-20261001` from the snapshot in `us-east-1a`, bundle
  `large_3_0`. AWS reports 8GB / 2 vCPU; OS reports 7,816MiB RAM and 145GiB
  free disk. Its initial temporary public address was 3.94.150.222. The existing
  static IP now points at the new instance. Creation operation:
  `da983eeb-e2f1-4957-8242-1dde3882ae07`.
- Verified new-host SSH keys against AWS access details. Cloud-init completed;
  backend, Caddy and cron are stopped/disabled during validation. Both production
  task counts were zero before clone validation.
- Initial Linux dependency resolution backtracked across many incompatible
  transitive versions. Stopped only its verified provisional pip process;
  retry used the tested Windows versions as constraints (not as a Linux lock).
  Actual Linux resolution is exported to `requirements-linux.lock` and
  `pip check` passes. All 26 frozen model assets verified. Formal deployment
  installation and conversion validation passed. Git attributes preserve the
  manifest's frozen byte hash across Windows/Linux.
- Added parser resource checks, a dedicated systemd service, offline conversion
  smoke, atomic private environment updates, parser rollback and pre-migration
  backups to the release pipeline. CPU-only Linux Torch/vision versions are
  locked. Dedicated systemd service and synthetic conversion passed (8.19s).
- Existing provider/release rollback and new parser switching checks passed on
  Linux in an isolated `/tmp` directory. Four atomic-environment tests passed.
  Initial direct file transfer retained Windows CRLF; normalizing only the
  temporary test scripts corrected that transport failure. The clean GitHub
  checkout uses normalized Git content.
- The real 2GB production host rejects the resource preflight before package
  installation or migrations. Full `codex:verify` passed again: 483 frontend,
  74 Nest, backend Node suite, API check, builds and production-entry smoke.
  Log: ignored `artifacts/docling-pdf-pages/deployment-codex-verify.log`.

## Linux acceptance and infrastructure cutover

- Original paper: all 11 physical pages, 62,631 characters and 29/29 frozen
  anchors; conversion 63.177s, peak process-tree RSS 2,044,252,160 bytes.
  Native/table/rotation/Unicode, scan, mixed, blank and low-quality conversions
  also passed canonical assertions; encrypted/corrupt preflight passed.
  Logs: ignored `linux-formal-runtime.log` and `linux-conversions.log` under
  `artifacts/docling-pdf-pages/`.
- First clone restore stopped because the database owner is `labrat_app`, not
  the OS service user `labrat`. The old backend/cron automatically resumed.
  Verified the actual owner, repeated the paused checkpoint, then restored it
  on the isolated new instance. Original data remained unchanged.
- Final checkpoint: UTC 20261002040214, root-only
  `/var/backups/labrat/final-8gb-cutover-20261002-2` on both instances.
  Compressed DB/files/config hashes and all public table counts match.
- Existing application c8a586963e5f passed local and HTTPS health on the new
  host before traffic moved. Static-IP detach/attach operations succeeded:
  `d5d265a2-7061-41bc-9f18-02cc7ded0732`,
  `64459a54-cb8c-4ee6-9447-f0def871ae7f`. Public HTTPS health passed afterward.
- AWS confirms `labrat-prod-8gb-20261001`, `large_3_0`, 8GB / 2 vCPU, static
  IPv4 100.50.25.194. Only ports 22/80/443 are open. Backend, Caddy, PostgreSQL,
  Docling and cron are active. The old `labrat-prod-1` is stopped and retained
  (stop operation `4edca1a9-fc4f-4e7a-9b21-937317438ea7`).
- Once the new host accepts writes, machine rollback requires a fresh reverse
  data sync. Prefer application/parser rollback on the new host. Old instance
  charges continue while retained; snapshot storage is charged separately.

## Remaining gates

- Done: create and isolate the new instance; verify identity and 8GB resources.
- Done: verify the pinned Python runtime and real offline conversions on Linux.
- Done: final paused checkpoint, exact restore and unchanged-release acceptance;
  existing static IP switched to the 8GB host.
- Publish the Docling release through the existing main deployment workflow.
- Pipeline changes are verified locally/Linux; confirm its actual production
  execution. Migration 038 remains forward-only.
- Verify the actual deployed release, original paper pages and new question.
- Retain the original instance and checkpoints; report overlap/storage charges.

Browser automation remains unavailable because its local sandbox cannot start.
An approved read-only command outside that sandbox recovered CLI access. AWS
operations use the official CLI and existing account credentials.
