# Agent Working Context

This file is the first stop for AI coding agents working in this repository. Read it together with `README.md`, `doc/PROGRESS.md`, `doc/ARCHITECTURE.md`, `doc/ROADMAP.md`, and `doc/plan.md` before making edits. For auth, database, project persistence, import persistence, chart-spec, or manuscript persistence work, also read `doc/saas-database-schema-v0.md`, `doc/saas-api-contract-v0.md`, `doc/server-project-migration-plan.md`, `doc/backend-api-contract.md`, `doc/canonical-data-dictionary.md`, and `doc/ai-boundaries.md`; note that old local-data migration is not in scope.

## Mission

LabRat Blank is evolving into a multi-lab SaaS research command center for messy lab Excel/CSV imports, experiment browsing, charting, manuscript layout, and PPTX export. The backend now has server-first project persistence; the next active direction is frontend server mode and Postgres deployment hardening. Preserve scientific data integrity and avoid broad rewrites.

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

Use `npm run build` as the minimum verification after code changes. For import/backend/generic data work, also run `npm test` and `npm --prefix backend test`. If dependencies are already installed, do not reinstall unless necessary.

## High-Value Files

- `src/main.jsx`: app shell, tabs, Experiment Browser, import review modal wiring, reference library, detail modal, assistant panel, and project state wiring.
- `src/components/ManuscriptCanvas.jsx`: manuscript canvas, block insertion, chart-layer selection, inspector, and text/image/chart editing.
- `src/components/BackendScanPanel.jsx`: backend workbook scan, block review, normalization preview, mapping proposal review, and chart proposal review UI.
- `src/components/SelectionFrame.jsx`: reusable move/resize/keyboard frame.
- `src/charts/makePlot.js`: experiment-to-Plotly trace conversion.
- `src/charts/genericChartPreview.js`: preview charts from generic chart proposals.
- `src/charts/chartLayout.js`: editable chart layout model and Plotly layout projection.
- `src/data/importExcelFolder.js`: browser-side Excel folder import.
- `src/data/backendImportScanApi.js`, `src/data/backendImportNormalizeApi.js`, `src/data/backendSemanticMappingApi.js`, `src/data/backendChartProposalApi.js`: frontend helpers for backend import and proposal endpoints.
- `src/data/genericImportPatch.js`, `src/data/genericProposalState.js`: local dataset helpers for generic imports, mappings, and chart proposal state.
- `src/storage/projectStorage.js`: IndexedDB project persistence and project-file normalization.
- `backend/src/`: backend scan, normalize, semantic mapping, and chart proposal services.
- `public/templates/`: example-only workbook templates.
- `src/styles.css`: all app styling.
- `doc/`: active plan, architecture, roadmap, contracts, data dictionary, AI boundaries, migration notes, and progress log.

## Data Guardrails

- This blank copy intentionally does not include `public/labratData.json`. Do not reintroduce embedded demo data unless explicitly requested.
- Do not rewrite archived source/reference materials unless the user explicitly asks. Prefer reading them as source/reference material.
- Preserve `sources`, `files`, `rate_sources`, `calculation`, `sweep`, and `parr_data` provenance fields when transforming experiment records.
- Preserve generic import provenance fields, including `files`, `sources`, source refs, approved block ids, warnings, and confidence.
- Do not overwrite historical results when a calculation or methodology changes. Future recompute work should create a proposal and then a new reviewed dataset state.
- Treat accepted imports, mappings, recomputes, charts, and exports as auditable decisions. New scientific values should be traceable to source files, calculations, methodology versions, and human review.
- Avoid guessing scientific values. If a calculation, unit conversion, or field meaning is unclear, inspect the source spreadsheet/script or ask the user.
- Legacy HDPE hydroconversion support remains a compatibility path, but blank mode should not assume HDPE fields for newly uploaded generic data.

## UI And UX Guardrails

- Keep the app as a working tool, not a marketing page.
- Preserve dense, research-workflow-oriented layouts.
- For manuscript canvas work, verify selection, resize, drag, and keyboard movement. Chart layers are nested interactive frames; small changes can break pointer behavior.
- For chart changes, check both standalone detail plots and manuscript canvas plots.
- Keep chart output manuscript-friendly: readable titles, axis labels, legends, and stable sizing.
- Avoid adding hidden global behavior that surprises canvas editing, such as document-level listeners without cleanup.
- Generic imported data should reach Experiment Browser through a derived browser-row model, not by coercing generic imports into HDPE-specific fields.

## Project Persistence Contract

The active project is persisted in IndexedDB via `src/storage/projectStorage.js`. The saved project record includes dataset, source name, staged experiments, manuscript blocks, pages, canvas height, chart templates, references, schema version, and saved timestamp. The app also supports Export project / Import project `.labrat.json` backups.

The active server-backed persistence target is documented in `doc/plan.md`, `doc/saas-api-contract-v0.md`, and `doc/saas-database-schema-v0.md`. Logged-in server mode should use the backend project state as the source of truth. Do not add compatibility migrations for old IndexedDB, `.labrat.json`, or previous local project shapes unless the user explicitly asks.

Blank projects store user-derived generic data under:

- `dataset.genericImports`
- `dataset.genericMappingSets`
- `dataset.genericChartProposals`

Legacy project state and assistant-specific values may still exist under these `localStorage` keys:

- `labrat_dataset`
- `labrat_source_name`
- `labrat_staged`
- `labrat_blocks`
- `labrat_canvas_height`
- `labrat_chart_templates`
- `labrat_refs`
- `labrat_chat_history_v1_react`
- `labrat_anthropic_key_v1`
- `labrat_anthropic_model_v1`

When changing saved block, dataset, or project-file shapes, add migration/normalization code instead of assuming stored browser or imported state is clean. Existing helpers like `resolveChartLayout` already migrate older chart layout shapes. Do not export `labrat_anthropic_key_v1`.

## Excel Import Contract

`parseLocalExcelFolder(fileList)` expects:

- Browser `FileList` input from a directory picker.
- A master file named `MasterTable.xlsx`, or matching `/master.*table/i`.
- Experiment labels in the first column after two header rows.
- File names containing experiment labels such as `Exp56`.
- Related files with names containing `calculation`, `sweep`, or `parrdata`.

The parser currently attaches local object URLs for related source files and parses only the master table into experiment records. Do not imply full workbook ingestion unless you implement it.

## Backend And SaaS Direction

The current local backend should remain compatible while the next phase connects the frontend to Postgres/auth/server persistence. New SaaS work should follow `doc/plan.md`, `doc/ROADMAP.md`, `doc/saas-database-schema-v0.md`, `doc/saas-api-contract-v0.md`, and `doc/server-project-migration-plan.md`. Existing scan/normalize/semantic-map/chart-propose services should be wrapped in authenticated project-scoped APIs instead of replaced first.

## Known Sharp Edges

- Several visible strings have mojibake from an encoding issue. Fixing that is useful, but keep it separate from unrelated feature work unless the user asks for a cleanup pass.
- `src/main.jsx` is large and contains several components in one file. Prefer small, scoped edits unless extracting components is explicitly part of the task.
- The in-app assistant sends requests directly to Anthropic from the browser using a user-entered key. Do not present that as production-safe for public hosting.
- There is no git repository metadata available in this workspace at the moment, so do not rely on `git diff` or branch state unless a repo is initialized later.
- Historical checkpoint notes live in `doc/PROGRESS.md`; do not recreate a second active progress log.

## Preferred Workflow

1. Read `README.md`, this file, and `doc/PROGRESS.md`.
   - For auth/database/project persistence work, also read `doc/ARCHITECTURE.md`, `doc/ROADMAP.md`, `doc/plan.md`, `doc/saas-database-schema-v0.md`, `doc/saas-api-contract-v0.md`, and `doc/server-project-migration-plan.md`.
   - For import/parser/chart proposal compatibility work, also read `doc/backend-api-contract.md`, `doc/canonical-data-dictionary.md`, and `doc/ai-boundaries.md`.
2. Inspect the specific source files touched by the request.
3. Make the smallest coherent change.
4. Run relevant tests; `npm run build` is the minimum after code changes.
5. For import/backend/generic data changes, run `npm test` and `npm --prefix backend test`.
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
