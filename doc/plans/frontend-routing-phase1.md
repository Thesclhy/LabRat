# Frontend routing, phase one

Status: complete locally. Date: 2026-09-28.

Baseline: origin/main `06b07be73b459171c224704b9ad584098659a878` in the
managed frontend-routing-phase1 worktree. The primary checkout and other tasks
are preserved. This goal authorizes local implementation and validation only.

## Outcome and scope

React Router Data mode, basename `/LabRat`, owns login, lab project lists and
project Overview, Browser, Manuscript and References. Direct entry, reload and
browser Back/Forward restore the intended authorized page. A stable App shell
owns the active project's manuscript draft; tab changes do not reload it.

Paths: `/login`, `/labs/:labId/projects`, and
`/projects/:projectId/{overview,browser,manuscript,references}`. Root resolves
authentication and an authorized lab; the bare project path replaces itself
with Overview. Unknown and unavailable resources show explicit recoverable
states. Login preserves a same-app return destination.

Workbook/analysis review and management remain transient views in phase one.
Main-route navigation dismisses them; their existing close actions remain.
New-project onboarding belongs to Overview. No API, database, scientific value,
review boundary, provider, deployment or phase-two change is included.

## Milestones

- [x] Confirm integrated baseline, read relevant contracts, run preflight.
- [x] Implement routes, authenticated bootstrap and stable project lifetime.
- [x] Protect dirty drafts, save failure, access loss and stale requests.
- [x] Integration tests and actual browser acceptance against the built app.
- [x] Run codex:verify, audit requirements and update progress/acceptance docs.

Final evidence and limits: [acceptance report](../qa/frontend-routing-phase1.md).

## Acceptance evidence

Tests must cover each route, PUSH/POP/replace, duplicate navigation, direct
entry/login return, unknown/deleted/forbidden projects, rapid project switching,
initial hydration, draft preservation, save/discard/cancel/save failure,
session expiry/revocation and one-shot chart insertion. Browser checks must
exercise real History and `/LabRat/` production-build fallback/assets, existing
onboarding/review/management entry points, and a narrow viewport. Preserve the
References sibling-key fix. Navigation must not create scientific records.

Record exact executed checks and limitations; skipped checks are not passes.
Full verification is `npm run codex:verify` (the submitted goal truncated the
command and route parameter placeholders; the preceding agreed plan supplies
their intended spellings). Delivery stays local, without push/merge/deployment.
