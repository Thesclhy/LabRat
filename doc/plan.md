# Current Development Plan

This file is the short execution plan for current work. Historical checkpoint detail lives in `doc/PROGRESS.md`; do not turn this file back into a running log.

## Current Focus

LabRat Blank should become a workflow where uploaded raw Excel/CSV data can be reviewed, normalized, shown in Experiment Browser, traced to source files, and later tied to dataset commits, methodology versions, charts, and manuscript/PPTX output.

The next product milestone is:

```text
backend upload / normalization
  -> generic experiment browser rows
  -> source-backed generic detail view
  -> local dataset commit concept
  -> chart suggestions from accepted mappings
```

## Current State

- Blank mode is the default app mode.
- The app starts from an empty dataset unless a saved blank project exists.
- Backend endpoints exist for workbook scan, approved normalization, semantic mapping proposals, and chart proposals.
- Approved generic imports are stored under `dataset.genericImports[]`.
- Mapping and chart proposal review state is stored under `dataset.genericMappingSets[]` and `dataset.genericChartProposals[]`.
- The existing Experiment Browser still primarily renders HDPE-shaped `dataset.experiments[]`.
- Manuscript canvas and PPTX export exist and should remain stable while generic data support expands.
- Dataset commits, methodology versions, recompute proposals, provenance graph, cloud storage, and audit logs are target architecture concepts, not fully implemented current features.

## Near-Term Tasks

1. Add a browser-row adapter that turns both HDPE experiments and generic imports into safe display rows.
2. Add an Imported/Generic view in Experiment Browser with source file, import status, mapped fields, measurements, warnings, confidence, and provenance.
3. Add a generic detail panel that shows conditions, measurements, source refs, mapping status, and warnings without calling HDPE-only chart logic.
4. Add local commit metadata around applied generic imports so visible browser data can be tied to an accepted import/review decision.
5. Let accepted or `accepted_draft` semantic mappings promote generic measurements into dynamic browser columns.
6. Connect selected generic rows to generic chart proposals and previews without inserting manuscript blocks automatically.
7. Preserve the legacy HDPE browser, detail modal, curated chart types, and MasterTable folder import.

## Guardrails

- Do not coerce generic imports into HDPE-specific fields such as `conversion_pct` unless a future reviewed mapping explicitly defines that behavior.
- Do not rewrite raw generic import records when accepting semantic mappings; keep mappings as overlays.
- Keep provenance visible and source-backed for uploaded data.
- Do not present future dataset commits, methodology versions, or recompute proposals as already implemented until code supports them.
- AI may suggest semantic mappings and chart ideas, but it must not invent values or silently convert units.
- Use `doc/PROGRESS.md` as the only durable progress log.

## Verification

Minimum verification after implementation work:

```bash
npm test
npm --prefix backend test
npm run build
```

For browser/chart/manuscript UI changes, also run the app and manually verify the affected flow when the environment allows it.
