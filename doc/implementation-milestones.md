# Implementation Milestones

This file is a compact implementation checklist. Use `doc/ROADMAP.md` for product sequencing and `doc/PROGRESS.md` for historical checkpoint detail.

## Completed Foundation

These areas already exist and should be preserved while future work builds on them:

- Backend service skeleton with health check and import/chart routes.
- Excel workbook upload, scan, cell-grid extraction, region/header/unit/key-value detection, layout classification, conservative parser warnings, and provenance helpers.
- Parsers for standard tables, repeated block tables, and unknown/ambiguous sheets.
- `POST /api/import/scan`, `POST /api/import/normalize`, `POST /api/import/semantic-map`, and `POST /api/charts/propose`.
- Frontend import review surface with scan, approve/ignore, normalize preview/apply, semantic mapping proposal review, and chart proposal review.
- Local project persistence for `dataset.genericImports[]`, `dataset.genericMappingSets[]`, and `dataset.genericChartProposals[]`.
- Legacy HDPE MasterTable compatibility path, curated chart rendering, manuscript canvas, and PPTX export.

## Current Implementation Target: Generic Data In Experiment Browser

- Add a derived browser-row model for HDPE and generic data.
- Add an Imported/Generic browser view.
- Show source file, source range, import status, mapping status, measurement count, warning count, confidence, and mapped display fields.
- Add a generic detail view with measurements, metadata, warnings, mapping state, and provenance.
- Do not route generic rows through HDPE-only `DetailModal` or `makePlot()` behavior.

Done when:

- approved generic imports appear in Experiment Browser
- accepted or `accepted_draft` mappings can promote measurements into dynamic columns
- generic row detail shows source-backed values and warnings
- existing HDPE browser and detail behavior still works

## Next: Local Dataset Commit Concept

- Add explicit local commit metadata around accepted imports and future recomputes.
- Show commit/source state in Experiment Browser, generic detail, and import review.
- Preserve earlier accepted imports and mapping decisions for comparison.
- Keep `.labrat.json` export/import compatible through normalization.

Done when:

- a visible browser value can be tied to an accepted import/review decision and source refs
- older accepted states are preserved for comparison instead of overwritten

## Next: Generic Charts To Manuscript

- Let users select generic browser rows for chart proposal requests.
- Save generic chart specs separately from raw imports and mappings.
- Add explicit insertion of accepted generic chart specs into the manuscript canvas.
- Verify PPTX export with text, images, HDPE charts, and generic charts.

Done when:

- a user can upload data, review mappings, generate a generic chart, insert it into manuscript, and export PPTX

## Future: Methodology Versioning And Recompute

- Define methodology version records for calculations, derived fields, unit rules, and validation rules.
- Add recompute run/proposal shapes with old value, new value, delta, warnings, source refs, and calculation refs.
- Add UI review for accepting or rejecting recompute proposals.
- Ensure accepted recomputes create new dataset commits.

Done when:

- changing a formula such as carbon balance produces a reviewable before/after proposal across affected experiments
- accepting the proposal creates a new source-backed dataset state

## Future: Cloud Workspace And Audit Log

- Add Docker Compose services for API, worker, Postgres, and object storage.
- Store immutable raw file versions, import runs, dataset commits, methodology versions, mappings, charts, manuscripts, and audit events server-side.
- Add single-lab role-based access for admin, editor, and viewer.
- Keep `.labrat.json` export/import as backup and migration support.

Done when:

- a small lab can run LabRat on one server and share projects without losing provenance or auditability
