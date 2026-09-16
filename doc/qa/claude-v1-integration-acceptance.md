# Claude v1 Feature Acceptance

Status: local implementation and acceptance completed; release gates pending
Last reviewed: 2026-09-13

Baseline: main `474c1bb`, Claude `06ecf87`. Working branch:
`codex/claude-v1-integration`. Original user edits/private fixtures are retained.
This record covers local acceptance, not production success. A subsequent
2026-09-13 request explicitly authorizes main push and automatic deployment;
publication and activation results are tracked separately in `doc/PROGRESS.md`.

## Feature Matrix

| Feature | Implementation | Verification |
| --- | --- | --- |
| Welcome, reduced motion, invitation-aware login | Claude welcome + main invitation flow | Component tests; Chromium invitation registration, automatic login, target lab and refresh; no-lab platform management |
| Batch workbook upload | v1 multipart, concurrency 2, retry and scope abort | Queue tests; six real workbooks indexed and restored after refresh |
| Formula/region understanding | Claude helpers, v1 cell-classes and revision provenance | Formula/scanner/provenance unit tests; actual workbook region selection, calculation overlay and independent review |
| Extraction templates | Nest RegionTemplates, versions/archive/match/apply | PostgreSQL routes/transactions; UI save, version, exact/formula-mismatch report, apply and individual review |
| Batch confirmation | Explicit revisions/versions, independent transactions | UI three-region confirmation; partial failure, stale revision, concurrent confirm and rollback tests |
| Linked Browser metadata/comparison | Snapshot-row augmentation; v1 preview/proposal | Actual six-file Browser links/detail/source jumps and comparison plan; PostgreSQL atomic creation and scope isolation |
| Workbook chart templates | Linked slots, multi-series contracts, frozen inputs | UI 6/6 coverage, deterministic run, approval, save as template and lineage; 51 real cached points/source coordinates equal; frozen-history regression |
| Readonly and scope changes | Main capabilities + queue/client cancellation | Four-role Chromium checks; automated deactivation/revocation, selected-experiment isolation and cancellation tests |
| Chart/manuscript interaction | Claude UI with main write gates | Actual insertion, drag/resize/keyboard, save/reload and PPTX download; readonly canvas; Plotly cleanup and axis-label regressions |

## Engineering Evidence

- Preflight passed. All 11 additional operations are in OpenAPI and generated
  client types. Production source has no unversioned `/api` calls.
- Final Linux clean root/backend `npm ci` and full `codex:verify` passed on
  Node 22.23.2 / npm 10.9.8: frontend 368 tests, legacy 332 passed / 4
  conditional skips, Nest 60 tests, generated types, TypeScript build,
  production entry smoke and Vite build. This was a fresh WSL Linux copy,
  not a hosted GitHub Actions run.
- Final Windows working-tree `npm run codex:verify` also passed: frontend
  368/368, Nest 60/60, legacy 331 passed / 5 conditional skips, generated
  types, builds and production-entry smoke. Linux additionally exercises the
  Linux-only Python test; the environment-gated PostgreSQL check runs separately.
- PostgreSQL complete v1 suite passed 13 tests across 7 files; legacy route
  suite passed 2 tests. The focused 4 integration/upgrade cases additionally
  passed with atomic comparison-audit rollback and in-flight revocation.
- The lockfile adds 27 missing nested esbuild package entries, with no changed
  or removed pre-existing package version and no package.json changes.
- Existing Vite large-chunk and React test act warnings remain. No dependency
  upgrade or infrastructure workaround is included in this feature migration.
- Repeatable repository gates are `npm run codex:verify` and
  `npm --prefix backend run test:postgres` with `LABRAT_TEST_DATABASE_URL`
  targeting a disposable database only. `git diff --check` passes. No
  production configuration or historical migration file was modified.

## Browser Evidence And Limits

Chromium uses separate temporary accounts and a disposable loopback PostgreSQL
schema/file store. The six available user fixtures are
`Reaction_Rate_Exp33.xlsx`, `Exp34`, `Exp35`, `Exp48`, `Exp49`, `Exp50` (same
filename prefix). They were uploaded through the actual React file picker,
not injected by a request mock. No scientific values were changed.

The real-workbook route was exercised in this order:

1. Upload the six files through Overview and the chat batch entry; observe
   progress, open regions and reload the project. Select Exp33 `C2:D11`, review
   its cached reaction-rate series and confirm it against an explicit identity.
2. Save/version an extraction template. The report identified four exact
   matches and two formula mismatches (Exp34/Exp48). Apply to three eligible
   targets and confirm all three through the batch review. Review the two
   mismatches independently; they are not silently batch-confirmed.
3. Open the six linked Browser rows, follow Exp34 to its workbook/range and
   inspect Exp35 detail. Preview all six in Compare linked data and create a
   normal reviewable analysis plan, not an immediately accepted chart.
4. Use the linked workbook chart template, inspect 6/6 coverage and source
   ranges, preview/run, accept the chart and save a new template through the UI.
   Independently compare every plotted non-missing x/y pair and its source
   coordinate to the original indexed workbook cache: Exp33 8, Exp34 8,
   Exp35 9, Exp48 8, Exp49 9 and Exp50 9, totaling 51 points. Blank/error
   points are missing, never zero; numerical equality uses no tolerance.
5. Insert the accepted chart into Manuscript, drag into a page, resize, move
   with the keyboard and save. Reload preserves the 700 x 460 placement.
   Download a real PPTX containing the page/chart. Accepted axis labels remain
   visible. Final owner/reader runs report no JavaScript errors.

Separate role sessions verify owner completion; reader source/approved-chart
inspection and read-only comparison preview with creation/approval/canvas
editing disabled; editor deterministic template execution with acceptance
disabled; and approver execution plus acceptance. No old `/api` requests were
observed. The platform account without a lab opens invitation management but
has no scientific access. A fresh owner invitation registration through the
welcome page establishes the target lab and survives refresh without storing
the code or password in browser local/session storage.

Browser findings fixed during this milestone include multipart boundaries,
underscore filename identity hints, linked-region Browser projection, the v1
250-row page bound, preserved plan/template lineage, readonly chart browsing,
late chart-review callbacks, asynchronous Plotly cleanup and accepted axis
labels on new manuscript placements. Historical meanings and stored layouts
are not rewritten. `ui-design` kept the existing compact workflow, local
actions and explicit permission/state feedback rather than introducing routes
or redesigning the workspace.

The local interpretation boundary uses a controlled, backend-validated response
for UI/transport QA. Browser snapshot fixtures supply experiment labels only,
not invented scientific values. The initial accepted reference chart/template
is an explicit test fixture made from the actual cached cells and a UI-created
comparison plan; subsequent template execution, chart acceptance, template
saving and manuscript operations use real v1 routes. No provider or generated
Python is used by deterministic template execution. These checks do not claim
that a live LLM correctly interprets the files or that the ordinary model-backed
comparison was executed end to end.

Automated fixtures, not all six real workbooks, cover shifted/ambiguous matching,
multiple series, missing categories, unit/shape mismatches, stale-source badges,
prepared-run reconfirmation, source deletion, transaction rollback and mid-flight
revocation. Historical-upgrade tests construct main/Claude SQL histories;
they are not restored user database backups. Local QA helpers, screenshots and
the exported PPTX remain under private `.tmp/`, not application assets.

## Remaining Release Gates

- Restore actual main and Claude database/file-storage backups separately and
  verify retained IDs, JSON, hashes, memberships and uploaded-file references.
- Verify the configured real provider on reviewed representative workbooks and
  the ordinary comparison/review flow; no credentials or live calls were used.
- Run hosted CI, then perform production health/canary and rollback checks.
  Publication/deployment was subsequently explicitly authorized; successful
  local tests do not establish that remote activation has completed.

These gates are explicitly outstanding; successful local builds and browser
tests do not replace them. See `doc/plans/claude-v1-database-upgrade.md`.
