# Unified Ask main deployment

Date: 2026-09-28. Status: deployed and verified.

The user authorized main publication and remote deployment. The isolated
`codex/unified-ask` checkout started from remote main 1c06923; the previous
deployed application was f317265. Independent changes in the original checkout
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

## Release result

- Application commit: `0d4a9eaabccb677e178218b7ce6dd366f61008cc`, pushed to main.
- [Hosted workflow 36447049162](https://github.com/Thesclhy/LabRat/actions/runs/36447049162)
  completed successfully, including frontend/backend/PostgreSQL checks, builds,
  production entry smoke, upload and deployment.
- Active release: `/opt/labrat/releases/20260928155800-0d4a9eaabccb`.
- Migration 036 ledger checksum matches the release; the old unique-name index
  is absent and the replacement lookup index is present.
- Backend service is active; local and public health pass. Public HTTPS index,
  JavaScript and CSS bytes match the release. Both unauthenticated document and
  question requests return 401. Compiled scientific read/review boundaries pass.
- Production remains Anthropic / claude-sonnet-4-5. Two live synthetic canaries
  pass citation validation: selected-document-only dry/wet conditions, and
  selected document plus accepted Exp17 temperature with exact numeric binding.
  The selected-only trace contains no experiment tool call.
- Safe, structured live evidence: [unified-ask-live-verification.json](unified-ask-live-verification.json),
  completed at 2026-09-28T16:01:47.508Z. No production research records were created.

The first canary harness attempt stopped on an empty provider answer instead of
using the service's existing single repair. The second incorrectly passed gateway
metadata into the closed answer validator. After matching the production repair
and candidate-extraction behavior, both canaries passed without repair. These
were harness corrections; no application change or redeployment was required.
The bounded canaries do not replace a full scientific semantic evaluation.

Release documentation is committed separately with `[skip ci]`; the deployed
application remains the exact commit recorded above. Unrelated edits in the
original checkout remain untouched.
