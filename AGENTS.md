# Agent Working Context

This file is the first stop for AI coding agents working in this repository. Read it together with `README.md`, `doc/START_HERE.md`, `doc/plan.md`, `doc/current-milestone.md`, `doc/PROGRESS.md`, and `doc/task-checklist.md` before making edits. Use `doc/START_HERE.md` to choose the task-specific architecture, contract, QA, and archive docs you need. For auth, database, project persistence, import persistence, chart-spec, manuscript persistence, source evidence, or agent work, also read the matching docs under `doc/contracts/` and `doc/arch/`; old local-data migration is not in scope unless the user explicitly asks.

## Mandatory Codex Long-Task Execution Loop

Codex agents must use the repository as a durable long-task environment, not as a one-shot code editing target.

For every non-trivial implementation task:

1. Run or mentally perform `npm run codex:preflight` before editing.
2. Read `doc/START_HERE.md`, `doc/plan.md`, and `doc/current-milestone.md` before deciding what to build.
3. Read the active architecture/data-model/API docs before touching matching code:
   - Routes, auth, roles, persistence, migrations, project state, or frontend API helpers: `doc/contracts/saas-api-contract-v0.md`, `doc/contracts/saas-database-schema-v0.md`, `doc/contracts/server-project-state-plan.md`, and `doc/contracts/backend-api-contract.md`.
   - Data shape, import, Browser rows, ChartSpec, manuscript, AI context, or scientific semantics: `doc/contracts/canonical-data-dictionary.md`, `doc/arch/architecture.md`, and `doc/arch/ai-boundaries.md`.
4. Confirm the active milestone in `doc/current-milestone.md` and use `doc/task-checklist.md` as the execution checklist before starting a long milestone.
5. Implement one coherent milestone at a time.
6. Run the relevant tests. Use `npm run codex:verify` for full verification, or record why a narrower command was chosen.
7. Update `doc/PROGRESS.md` after every milestone with the request, meaningful changes, verification, and follow-ups. On Windows this is the canonical progress file; do not create a separate `doc/progress.md`.
8. Re-read `doc/plan.md`, `doc/current-milestone.md`, and any touched contracts before continuing to the next milestone.
9. Stop and report conflicts between code and docs instead of guessing. If implementation reality differs from the docs, either update the docs as part of the reviewed change or ask the user which source of truth should win.

Use `doc/reports/decisions.md` for durable architecture/product decisions and `doc/qa/code-review.md` as the standing review checklist. Long tasks should loop:

```text
read docs -> confirm current milestone -> use checklist -> implement one milestone -> run tests -> update progress -> re-read docs -> continue
```

## Mission

LabRat Blank is evolving into a multi-lab SaaS research command center for messy lab Excel/CSV evidence review, workbook understanding, charting, manuscript layout, and PPTX export. Server-first project mode is now implemented; the next active direction is documented in `doc/plan.md`: upload creates SourceDocument evidence and a WorkbookReviewSession, independently accepted RegionUnderstandingRevisions capture user-confirmed semantics, and later DataPlan/DataSnapshot, ChartSpec, FigurePackage, and Manuscript workflows use that evidence through review boundaries. Preserve scientific data integrity and avoid broad rewrites.

## Current Stack

- React 19 with JSX.
- Vite 6.
- Plotly via `plotly.js-dist-min`.
- Excel parsing via `xlsx`.
- No TypeScript, no router, no external state library.
- Vitest is configured for frontend tests.
- The backend uses Node's built-in test runner.

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
npm test
npm --prefix backend test
```

Use `npm run build` as the minimum verification after code changes. For import/backend/scientific data work, also run `npm test` and `npm --prefix backend test`. If dependencies are already installed, do not reinstall unless necessary.

## High-Value Files

- `src/main.jsx`: app shell, tabs, Experiment Browser, import review modal wiring, reference library, detail modal, assistant panel, and project state wiring.
- `src/components/ManuscriptCanvas.jsx`: manuscript canvas, block insertion, chart-layer selection, inspector, and text/image/chart editing.
- `src/components/BackendScanPanel.jsx`: reviewed analysis prompt and accepted analysis-result ChartSpec management UI.
- `src/components/SelectionFrame.jsx`: reusable move/resize/keyboard frame.
- `src/charts/makePlot.js`: experiment-to-Plotly trace conversion.
- `src/charts/sourceChartPreview.js`: render immutable source-backed ChartSpec rows/series.
- `src/charts/chartLayout.js`: editable chart layout model and Plotly layout projection.
- `src/data/serverApi.js`, `src/data/experimentBrowserApi.js`, `src/data/chartIntentClient.js`: authenticated project, Browser, and source-chart API helpers.
- `backend/src/saas/workbookReviewSessions.js`, `backend/src/saas/workbookReviewRegions.js`, `backend/src/saas/workbookUnderstandingPreview.js`: session grouping, bounded region interpretation, and deterministic semantic preview helpers.
- `backend/src/saas/dataPlanAgent.js`, `backend/src/saas/dataPlanExecutor.js`, `backend/src/saas/experimentBrowserPublish.js`: deterministic accepted-data path.
- `backend/src/saas/experimentProjection.js`: Snapshot-backed Browser projection.
- `public/templates/`: example-only workbook templates.
- `src/styles.css`: all app styling.
- `doc/`: `START_HERE`, short active plan, current milestone, recent progress, contracts, architecture, plans, QA, and reports.

## Data Guardrails

- This blank copy intentionally does not include `public/labratData.json`. Do not reintroduce embedded demo data unless explicitly requested.
- Do not rewrite archived source/reference materials unless the user explicitly asks. Prefer reading them as source/reference material.
- Preserve SourceDocument ids, sheet/cell/range refs, raw-value context, dependency/content hashes, warnings, and confidence through accepted derivations.
- Do not overwrite historical results when a calculation or methodology changes. Future recompute work should create a proposal and then a new reviewed dataset state.
- Treat accepted understandings, DataPlans/DataSnapshots, charts, and exports as auditable decisions. New scientific values should be traceable to source files, calculations, methodology versions, and human review.
- Avoid guessing scientific values. If a calculation, unit conversion, or field meaning is unclear, inspect the source spreadsheet/script or ask the user.
- Do not assume HDPE-specific fields for newly uploaded data.

## UI And UX Guardrails

- Keep the app as a working tool, not a marketing page.
- Preserve dense, research-workflow-oriented layouts.
- For manuscript canvas work, verify selection, resize, drag, and keyboard movement. Chart layers are nested interactive frames; small changes can break pointer behavior.
- For chart changes, check both standalone detail plots and manuscript canvas plots.
- Keep chart output manuscript-friendly: readable titles, axis labels, legends, and stable sizing.
- Avoid adding hidden global behavior that surprises canvas editing, such as document-level listeners without cleanup.
- Experiment Browser must derive rows only from accepted DataSnapshots selected by experiment snapshot heads.

## Project Persistence Contract

The active server-backed persistence target is documented in `doc/plan.md`, `doc/contracts/saas-api-contract-v0.md`, and `doc/contracts/saas-database-schema-v0.md`. Logged-in server mode should use the backend project state as the source of truth. Do not add compatibility migrations for old IndexedDB, `.labrat.json`, or previous local project shapes unless the user explicitly asks.

Assistant-specific values may still exist under project-scoped `labrat_blank_chat_history_v2_*` keys and `labrat_blank_anthropic_*` development settings.

When changing saved manuscript block shapes, keep bounded normalization for blocks already persisted on the server. Existing helpers like `resolveChartLayout` migrate older chart layout shapes. Do not export `labrat_anthropic_key_v1`.

## Retired Excel Import Paths

The local folder, master/supplement, normalize/apply, and generic mapping workflows have been removed. Do not recreate them unless the user explicitly requests a separate legacy product.

## Backend And SaaS Direction

The current backend should remain compatible with the server-first project workflow. New SaaS work should follow `doc/plan.md`, `doc/plans/roadmap.md`, `doc/contracts/saas-database-schema-v0.md`, `doc/contracts/saas-api-contract-v0.md`, and `doc/contracts/server-project-state-plan.md`. Workbook upload/review must use authenticated project-scoped APIs; retired unscoped import/chart routes must stay absent.

## Known Sharp Edges

- Several visible strings have mojibake from an encoding issue. Fixing that is useful, but keep it separate from unrelated feature work unless the user asks for a cleanup pass.
- `src/main.jsx` is large and contains several components in one file. Prefer small, scoped edits unless extracting components is explicitly part of the task.
- The in-app assistant sends requests directly to Anthropic from the browser using a user-entered key. Do not present that as production-safe for public hosting.
- Do not assume a clean git status; run `git status --short` before staging, committing, or making broad moves.
- Active execution state lives in `doc/current-milestone.md`. Recent completed checkpoint notes live in `doc/PROGRESS.md`; archived history lives under `doc/reports/`. Do not recreate a second active progress log.

## Preferred Workflow

1. Read `README.md`, this file, `doc/START_HERE.md`, `doc/plan.md`, `doc/current-milestone.md`, `doc/PROGRESS.md`, and `doc/task-checklist.md`.
   - For auth/database/project persistence work, also read `doc/arch/architecture.md`, `doc/plans/roadmap.md`, `doc/plan.md`, `doc/contracts/saas-database-schema-v0.md`, `doc/contracts/saas-api-contract-v0.md`, and `doc/contracts/server-project-state-plan.md`.
   - For import/parser/chart workflow work, also read `doc/contracts/backend-api-contract.md`, `doc/contracts/canonical-data-dictionary.md`, and `doc/arch/ai-boundaries.md`.
2. Inspect the specific source files touched by the request.
3. Make the smallest coherent change.
4. Run relevant tests; `npm run build` is the minimum after code changes.
5. For import/backend/scientific data changes, run `npm test` and `npm --prefix backend test`.
6. For UI/canvas/chart changes, run the app and manually verify the affected flow when possible.
7. Record the request, meaningful changes, verification result, and any follow-up items in `doc/PROGRESS.md`.
8. Report changed files, verification, and any remaining risk.

## Progress Logging

- Maintain `doc/PROGRESS.md` as the durable project log.
- Add an entry for every user request that changes files, project context, dependencies, data shape, UI behavior, or verification status.
- Keep entries newest first, dated, and concise.
- Include failed verification or blocked work when it matters, especially build failures, missing dependencies, permission issues, and unresolved follow-ups.
- Do not bury large implementation details there; link or name the changed files and summarize the result.

## Style Notes

- Existing code uses ES modules, React function components, hooks, and plain CSS.
- Keep code in JavaScript/JSX unless the user asks for TypeScript.
- Use existing helpers from `utils`, `charts`, and `storage` before adding new utilities.
- Keep comments sparse and useful.
- Avoid introducing new dependencies for simple UI or data-shaping changes.
