# Ask attachment cleanup after sending

Date: 2026-09-28. Status: verified locally; deployment in progress.

The user reported files selected through Ask's + control staying in the composer
after sending. The pending file array was cleared, but successful reference
uploads were immediately added back as selected-reference chips. Upload-only
messages never reached the question handler that would clear those selections.

Clear composer selections after all references have been uploaded and parsed.
Keep local reference identities for the accompanying question, and keep the
library documents and chat receipts. Nothing is deleted from project storage.
On partial failure, restore only files not yet registered plus pending workbooks.
Registered files with parsing errors remain in the library for Retry; they are
not silently uploaded again. Upload-only failures do not preselect successful
documents for the next message. A question's retry retains its reference versions.

Verification:

- Preflight passed. Three new regression assertions failed before the fix:
  lingering chips after upload-only / upload-with-question and missing pending
  files after a partial upload failure.
- 87 focused tests passed across UnifiedAsk, ProjectDashboard and PendingAskTasks,
  including four new cases: clear successful uploads, preserve question evidence,
  retry only unregistered files and retain parsing failures in the library.
- Production frontend build passed; existing large-bundle warning remains.
- Actual Chromium with real HTTP/PostgreSQL passed: after upload, both pending-file
  and selected-reference areas are absent, the receipt remains, and the same
  document can be selected with @ and cited. Screenshot inspected. Existing
  navigation, source/version/archive and cross-device scenarios also passed.
  The provider and scientific confirmation in this fixture are substitutes.
- Test-owned processes/database were stopped after checking for other clients.
  No production data writes or real provider calls were made by local QA.

Local logs: `.tmp/attachment-clear-before.log`, `.tmp/attachment-clear-tests.log`,
`.tmp/attachment-clear-build.log`, `.tmp/attachment-clear-browser.log`.
The browser screenshot is `.tmp/unified-ask-browser/reference-upload-composer-cleared.png`.

User retest: refresh, use + to select a reference, send with no question, and
verify the composer has no attached-file/selected-reference chips while the chat
receipt and library item remain. Then select the document with @ and ask Q01.
Manual fixed-answer, Excel and cross-device acceptance remain pending.
