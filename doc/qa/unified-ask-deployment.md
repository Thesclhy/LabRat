# Unified Ask main deployment

Date: 2026-09-28. Status: backup verified; awaiting hosted deployment.

The user authorized main publication and remote deployment. The isolated
`codex/unified-ask` checkout starts from remote main 1c06923; the currently
deployed application is f317265. Independent changes in the original checkout
are excluded. Prior local verification is in `unified-ask-verification.md`.

The existing main-triggered Lightsail workflow tests the release, applies
migration 036, then switches the service with its existing rollback transaction.
Migration 036 replaces only the active document-name unique index with a lookup
index. It does not recalculate, delete or rewrite scientific records.

Required release evidence: fresh database/file backup with integrity checks;
successful hosted checks; exact deployed commit and migration checksum; service
and public HTTPS health; matching served frontend assets; unauthenticated API
rejection; compiled selected-reference/scientific-boundary checks.

Production provider settings remain unchanged. Any live provider canary uses
generated evidence only and does not create production research records.

Fresh production backup: `/var/backups/labrat/unified-ask-20260928`, suffix
`20260928155231`. Database gzip integrity and uploaded-file archive listing both
passed before publication. Backup contents and credentials remain on the server.
