# Unified Ask and reference library

Status: implemented, deployed and verified, 2026-09-28.
Baseline: integrated research Q&A release 1c06923, branch codex/unified-ask.

## Confirmed product behavior

- One Ask title, composer and conversation. Read-only citation answers and
  reviewed workflow cards keep their separate backend authorization boundaries.
- Reference library opens in the main workspace, with search, type/status
  filters, source viewing, versions, retry and archive. Chat retains compact
  upload receipts and citations, not a permanent growing document list.
- @ selects real PDF/Word/TXT document versions. Multiple mentions prioritize
  those documents; relevant authorized project evidence remains available.
  Explicit only-selected requests restrict retrieval. Selections never grant
  permissions or become scientific approval.
- Excel only follows existing upload, region selection, interpretation and
  confirmation. Unreviewed workbooks are not independent Q&A references.
- Keep an upload's original question as a resumable pending task. Reviewed
  regions and accepted data can be reused; no automatic scientific publication.
- Show removable relevant experiment/chart context and current project.
  Keep model/runtime diagnostics out of the main conversation.
- Preserve personal project history, evidence versions, cross-project isolation,
  IME input, keyboard mention selection and narrow layouts.

## Implementation sequence

- [x] Bind reference identities/versions to Q&A requests, prioritize retrieval,
  enforce selected-only scope and confirmed-workbook eligibility.
- [x] Build the reference workspace and mention composer, then integrate cited
  answers and existing workflow cards into the existing assistant.
- [x] Preserve pending upload questions and project/account-scoped recovery.
- [x] Exercise permission, citation, upload, routing and interaction regressions;
  run full verification and browser checks where the environment permits.
- [x] Update contracts and progress with actual verification and remaining limits.

See `doc/qa/unified-ask-verification.md` for executed checks and manual acceptance.

The original dirty checkout's independent permissions/analysis work is excluded.
The user separately authorized main deployment on 2026-09-28. Application commit
0d4a9ea is live with migration 036; hosted checks and bounded real-provider canaries
passed. See `doc/qa/unified-ask-deployment.md` for release evidence and limits.
