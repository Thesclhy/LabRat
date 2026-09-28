# Cross-device pending Ask tasks

Status: implemented and verified locally, 2026-09-28. Baseline: main 9092efe.
Not committed, pushed or deployed. Production remains 0d4a9ea; release requires
migration 037. Acceptance: `doc/qa/cross-device-ask-tasks.md`.

The user requested cross-device continuation and asked about the earlier LangGraph
pilot. That pilot belongs to the separate analysis-stability checkout, is not
deployed, and covers durable multi-stage analysis. This bounded milestone uses
the existing PostgreSQL/Nest stack; no second execution runtime is necessary.

Save personal project tasks before uploading Excel attachments: original question,
selected reference versions, conversation context and a bounded file manifest.
Attach each completed upload using its server identity. Derive readiness from
current source/session/accepted-region and document-version state on the server.
Other devices can list tasks, open review, supply missing files, dismiss a task,
or explicitly continue. Unsaved local file bytes cannot move between devices.

Continuation atomically links exactly one existing research-question request to
the task. Concurrent devices and lost responses reuse that request. GET never
starts a model or calculation. Current actor/project/session permissions are
checked on every read/write; project colleagues cannot read another user's tasks.
Scientific review and explicit analysis execution remain unchanged.

Verified two independent sessions/browser contexts, application restart, partial
uploads, stale confirmation, reference versions, concurrent continue/cancel,
authorization revocation, and account/project isolation. Full verification passed;
the acceptance report records exact coverage and limits. Existing local pending questions receive an explicit
server-save action; no generic migration of old projects or chat history.
