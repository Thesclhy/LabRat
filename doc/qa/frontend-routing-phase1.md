# Frontend routing phase one acceptance

Date: 2026-09-28; integration follow-up: 2026-09-30.
Status: phase one and current-main integration verified locally; not published.

## Integration with current main

On 2026-09-30, saved phase one as local commit bcdae22 and integrated
origin/main 933c5fc on codex/frontend-routing-phase1. Conflicts were limited
to PROGRESS/current-milestone: both histories are retained. Application code
merged automatically, including main's analysis clarification prop and all
source-trace changes. All 64 files changed only by main match its contents;
the App difference from the routing checkpoint is exactly main's clarification
prop. No additional application change was needed to resolve the conflicts.

- Preflight and full codex:verify passed: 479 frontend tests (including 26 routing
  and 52 manuscript history cases), 402 legacy-backend tests, 74 Nest tests. Nine
  legacy tests retain their existing skips. Generated API, both builds and
  production-entry smoke pass; the existing large-bundle warning remains.
- All 14 real Chromium/HTTP/PostgreSQL scenarios passed against the integrated
  production build, including history, deep reload, login return, draft decisions,
  save failure, read-only access and actual revocation. Browser errors are empty;
  expected network rejections remain recorded. Desktop/390px prompts and workbook
  review screenshots were visually inspected. Test services were closed.
- Receipt: [2026-09-30 integration browser run](frontend-routing-main-integration-browser.json).
  The original 2026-09-28 receipt is retained separately. Local logs are
  routing-main-verify.log and routing-main-browser.log.
- Git diff checks pass and there are no unresolved conflicts. No new provider
  or production checks were run; main's provider evidence remains its own record.

No remote main publication, push or deployment is included.

The sections below record the original 2026-09-28 acceptance.

## Baseline and implementation

Verified origin/main `06b07be73b459171c224704b9ad584098659a878`, including the
References sibling-key repair and subsequent PDF changes. Implementation is in
the managed `frontend-routing-phase1/LabRat-blank` worktree. The original dirty
checkout and other worktrees were not modified by this goal.

React Router 7.18.4 Data mode adds a stable App parent and a `/LabRat` basename.
The router owns login, authorized lab project lists and four project pages.
`src/routing/workspaceRoutes.jsx` defines their identities; `src/main.jsx`
handles authenticated hydration and keeps draft state above page switches.
`src/routing/useUnsavedNavigation.jsx` handles SPA leave decisions and native
unload warnings. The small exported manuscript fingerprint normalizes existing
canvas defaults without changing saved shapes. Concurrent saves share one
request, and stale responses cannot clear newer drafts or populate another
project. No backend contract, schema, scientific calculation or review boundary
changed. No new model calls were introduced.

## Requirement audit

| Requirement | Evidence |
| --- | --- |
| Login, lab lists and all four project URLs | `AppRouting.test.jsx`: root/project canonicalization, direct entry for every tab and authoritative lab context; browser direct links and reloads of login, lab dashboard and all project pages |
| Browser Back/Forward and history semantics | Integration POP/PUSH/replace and same-page deduplication; actual Chromium Back/Forward, duplicate tab click and project-list return |
| Login returns to requested page | Integration and actual unauthenticated manuscript link, login and return; return targets restricted to same-app protected routes |
| Stable project draft and clean hydration | Integration tab/POP preservation, same-project bare-root normalization, nullable old manuscripts and automatic canvas defaults; actual unsaved page survives tabs/history |
| Save, discard, stay and save failure | Integration exact payload, cancel/POP, failure/retry, logout, concurrent save; browser stay, injected HTTP 503, successful retry, persisted reload and discard |
| Native refresh protection | Integration listener lifetime; actual beforeunload dialog dismissed with the dirty page retained |
| Unknown, missing, archived and forbidden resources | Integration invalid paths/lab, 403/404 and access-loss race; browser unknown path, actual missing/archived projects, read-only page and revoked project grant |
| No stale project or save result | Integration A→B→A with an intentionally late response and access revocation during save; existing workspace request-scope tests; actual expired session removes dirty content |
| No scientific mutation or repeated chart placement | Integration explicit chart insertion then Back/Forward yields exactly one insertion; browser database assertions show zero analysis runs, snapshots and ChartSpecs after navigation |
| Existing onboarding/review/management | Integration Overview-only onboarding, management preserves draft, late workbook response cannot reopen a view; browser new-project onboarding, actual workbook cell grid, management and history cleanup; existing analysis/workbook suites pass |
| Preserve Refs repair and layout | Distinct component keys retained; browser library content disappears on Overview; inspected 1440px and 390px screenshots |
| Manuscript interactions | Existing history suite covers selection, drag, resize, nested chart selection and undo/redo; added arrow/Shift+arrow movement regression; final 52 manuscript and 26 routing tests pass |
| `/LabRat/` production assets and fallback | Browser uses Vite preview of the production build; all four deep paths return 200 and scripts/styles load from `/LabRat/assets/`; existing Caddy SPA fallback inspected, unchanged |
| Local delivery and records | Plan, current milestone, README, decision and progress records updated; no commit, push, merge, deployment or phase-two implementation |

## Executed checks

- `npm run codex:preflight`: passed.
- `npm run codex:verify`: passed on the final application implementation.
  Generated v1 types, 469 frontend tests, 396 legacy-backend tests, 72 Nest tests,
  Nest build, production entry smoke and frontend production build passed.
  Nine legacy-backend cases were skipped by existing conditions: five source
  mapper cases, one opt-in PostgreSQL case and three retired DataPlan cases.
  This does not claim a separate complete PostgreSQL regression suite.
- Final `npm test -- src/components/ManuscriptCanvas.history.test.jsx
  src/routing/AppRouting.test.jsx`: 78 passed, including one additional keyboard
  movement case added during the completion audit. No application code changed
  after the final full verification and browser build.
- `node backend/scripts/frontend-routing-browser-check.mjs`: passed using real
  Chromium, actual Nest HTTP and an isolated PostgreSQL schema with synthetic
  data. No provider or production access. The save-failure case alone intercepts
  its save request with a deliberate HTTP 503. Permission loss uses a real grant
  change; session expiry uses real logout. Browser errors/duplicate-key warnings
  are empty. Expected 401/404/503 responses and cancelled reads are recorded.
- `git diff --check`: passed. Generated API types have no content diff.

The final browser run began at 20:56:13 UTC and finished at 20:56:23 UTC.
[Machine-readable receipt](frontend-routing-phase1-browser.json) includes the
unchanged built-index SHA-256, all checks and expected network outcomes.

Local detailed logs: `routing-verify.log`, `routing-final-focused.log`,
`routing-browser.log`. Screenshots under `artifacts/routing-phase1/browser/`:
`unsaved-desktop.png`, `unsaved-mobile.png`, `manuscript-mobile.png`,
`workbook-review.png`, `onboarding.png`, `management.png`.
Desktop/mobile prompts and the actual workbook grid were visually inspected.
The harness closed its browser, frontend and backend, dropped its test schema;
the dedicated PostgreSQL process was stopped after checking for other clients.

## Resolved verification issues and limits

Windows checkout converted the generated client to CRLF, causing the byte-level
generated-file check to fail. Regeneration produced no semantic content diff;
`.gitattributes` pins that generated path to LF for reproducible checks.

Test development corrected a mixed router module entry in Vitest, an onboarding
button locator, expected native reload cancellation, and the fixture grant's
legal `inactive` status. An early browser run encountered a fetch failure; a
later overlapping verification/build run encountered connection reset/refusal.
The final independent run passed against a fixed build, rejects connection
failures and verifies the build hash did not change. Earlier failed diagnostics
are retained locally; the dated receipt above is the final result.

The existing large-bundle warning remains. Workbook/analysis review and
management are transient phase-one views, without independently reloadable
entity URLs. Unsaved drafts are kept during same-project navigation; accepting
a browser refresh/close discards them. Hosting activation and user production
acceptance were not requested and have not been performed.
