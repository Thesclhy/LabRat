# Cross-device pending Ask task acceptance

Date: 2026-09-28. Status: automated verification passed; deployed; user manual acceptance not started.
Branch: `codex/cross-device-tasks`, based on main `9092efe`.
Application `e780cff` is deployed with migration 037; see
[release verification](cross-device-ask-deployment.md).

## Verified behavior

- Save the actor/project task, original question, selected versions and bounded
  file manifest before starting uploads. Persist each successful file link.
- Another independent authenticated browser context sees the same task without
  copying cookies, local chat history or File objects. Opening its review link
  reads the correct existing workbook session. Reads do not invoke the model.
- Current confirmation/reference state governs readiness. Missing uploads, stale
  confirmation and archived references block continuation. Revised document
  versions do not silently change an existing task's selected version.
- Two sessions continuing together receive the same Q&A run. A forced database
  failure between question creation and task submission rolls both writes back.
  Cancel/continue races produce one winner. Lost responses recover the saved run;
  retrying an uncertain initial save preserves its exact request identity/body.
- Application restart preserves pending tasks. Other users, selected-experiment
  members and revoked memberships cannot read or continue them. Server authorization
  also retains the public Guest exclusion through the shared Q&A guard.
- New conversation does not dismiss server tasks. The compact, collapsible list
  stays visible above chat and has bounded height. Missing local files can be
  reselected; older browser-only workbook cards offer Save across devices.

## Executed checks

| Check | Result |
| --- | --- |
| Repository preflight | Passed |
| Full `npm run codex:verify` | Passed: API type freshness, 431 frontend tests, 395 Node tests / 9 existing skips, 72 Nest tests, backend build/production entry and frontend build |
| Final focused frontend after layout/retry regression addition | 83 passed across ProjectDashboard, UnifiedAsk and PendingAskTasks |
| Real PostgreSQL | 3 files / 3 scenario tests passed: assistant tasks, existing questions, unified mentions; includes app restart, version changes, pagination, revocation, injected rollback and concurrent requests |
| Actual Chromium/HTTP/PostgreSQL | Passed, two independent contexts of one account plus View account; first device upload, second device recovery/review/continue, first device answer recovery, existing source/version/history regression |
| Layout | 1440px desktop and 390px task screenshots inspected; no page/panel overflow |
| Final production frontend build and whitespace check | Passed |

The final small header-button styling adjustment does not change behavior; the
frontend production build was repeated. Logs are retained in local `.tmp/` as
`cross-device-verify.log`, `cross-device-frontend.log`,
`cross-device-postgres.log`, and `cross-device-browser.log`. Browser receipt and
screenshots are in `.tmp/unified-ask-browser/`. The reproducible scenario is
`backend/scripts/unified-ask-browser-check.mjs`.
The browser script closed its owned application/browser/server processes. The
dedicated test PostgreSQL service was stopped after confirming no other clients.

Earlier checks found JSONB key-order sensitivity in repeated attachment receipts,
onboarding prefill clearing and an incorrectly broadened upload branch. Fixed
the implementations and reran their scenarios. The first asynchronous reference
test used an insufficient readiness timeout; the final test waits for the actual
server-ready condition. An intermediate compile failure required an explicit
reference-array type. The first browser assertion incorrectly assumed a fresh
context could not create an empty chat key; it now checks absence of the pending
question. Final runs pass with the original behavior checks retained.

## Limits and manual acceptance

The browser uses a deterministic model substitute and fixture-confirmed region
state after verifying the actual review link; it does not re-evaluate scientific
interpretation quality. The local implementation checks made no real research
uploads or external provider requests. The subsequent authorized deployment is
recorded separately in `cross-device-ask-deployment.md`; its live verification
created no production research records or model calls.

The user explicitly confirmed that manual acceptance has not started. All checks
listed above are automated checks, including the browser scenarios.

The scope is pending Excel-related questions, including attached/selected
references. It is not synchronization of unsent drafts, entire local workflow chat,
or resumable byte streaming. A file whose upload/link did not finish may need
reselection; an already-stored but unlinked upload is not guessed by filename.
At most 100 pending tasks per actor/project and eight attachments per task are
allowed. Completed question history retains its existing initial 20-item recovery.
LangGraph analysis execution/recovery remains a separate milestone.

Manual acceptance: upload Excel with a question on device A; sign in to the same
project/account on B; check the task, open review and confirm a region; continue
once and verify the answer on both devices. Repeat with missing files, two
simultaneous Continue clicks, confirmation withdrawn, a selected reference
archived, New conversation, a second account, and revoked project access.
