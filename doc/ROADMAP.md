# Product Roadmap

This roadmap turns LabRat Blank from a local import-and-figure app into a reproducibility-first research command center.

## Milestone 1: Generic Data In Experiment Browser

Goal: approved backend-uploaded data appears in Experiment Browser without pretending to be HDPE data.

- Add a browser-row adapter for HDPE and generic imports.
- Add an Imported/Generic browser view.
- Show source file, source range, import status, mapping status, measurement count, warning count, confidence, and mapped display fields.
- Add a generic detail view with measurements, metadata, warnings, and provenance.
- Keep existing HDPE table, detail modal, and curated charts working.

Done when a user can upload a workbook, approve normalized data, and inspect imported experiments in Browser with provenance.

## Milestone 2: Dataset Commit Concept

Goal: accepted imported data becomes an explicit reviewed state rather than an invisible mutation.

- Introduce local commit metadata around applied generic imports.
- Show current dataset commit/source state in the browser and import review surfaces.
- Preserve earlier applied imports and decisions for comparison.
- Keep `.labrat.json` export/import compatible through normalization.

Done when a user can tell which applied import produced the visible browser data.

## Milestone 3: Mapping-Driven Dynamic Columns

Goal: accepted semantic mappings make imported data easy to scan and compare.

- Promote accepted or `accepted_draft` mappings into dynamic Browser columns.
- Keep unmapped fields visible as unmapped measurements.
- Show mapping confidence and warning markers.
- Let users accept/reject mappings from import review or generic detail.

Done when generic rows can show fields such as Temperature, Catalyst, Time, Conversion, Yield, or Selectivity based on reviewed mappings.

## Milestone 4: Methodology Versioning And Recompute Proposals

Goal: calculation changes preserve old results and produce reviewable diffs.

- Define methodology versions for calculation templates, derived fields, units, and validation rules.
- Add recompute proposals that compare old and new values across affected experiments.
- Store rationale, warnings, source refs, and formula/version references with recomputed values.
- Require human commit before recompute results become the active dataset state.

Done when changing a calculation such as carbon balance creates a visible before/after proposal instead of overwriting existing values.

## Milestone 5: Generic Chart Workflow

Goal: users can create charts from imported data and known dataset/methodology versions.

- Connect selected generic browser rows to chart proposal requests.
- Generate chart specs from accepted/reviewable mappings.
- Store chart specs with source field refs, dataset commit refs, methodology refs, labels, units, grouping, and warnings.
- Keep chart proposals separate from manuscript blocks until explicit insertion.

Done when imported generic data can produce a reviewable Plotly chart without using HDPE-only `makePlot()` assumptions.

## Milestone 6: Manuscript And PPTX Tied To Versions

Goal: figures and exported presentations cite known reproducible data states.

- Insert accepted generic chart specs into manuscript blocks explicitly.
- Store chart blocks with chart spec, dataset commit, methodology version, and style state.
- Render generic charts consistently in PPTX export.
- Preserve existing text, image, HDPE chart, and manuscript behavior.

Done when a PPTX figure can be traced back to a specific dataset commit and methodology version.

## Milestone 7: Cloud Workspace And Audit Log

Goal: move from local-first project files to a single-lab shared workspace.

- Add Docker Compose services for API, worker, Postgres, and object storage.
- Store immutable raw file versions, import runs, dataset commits, methodology versions, mappings, charts, manuscripts, and audit events server-side.
- Add single-lab role-based access for admin, editor, and viewer.
- Keep `.labrat.json` export/import as backup and migration support.

Done when a small lab can share projects on one server without losing provenance or auditability.

## Milestone 8: External AI / MCP Integration

Goal: expose LabRat safely to external assistants after the core audit model is stable.

- Add a permissioned LabRat MCP server.
- Expose resources for project summaries, field inventories, warnings, chart specs, commits, methods, and provenance.
- Expose tools for import jobs, mapping proposals, recompute proposals, chart proposals, and export requests.
- Require role checks, audit logs, and explicit confirmation for sensitive actions.

Done when external assistants can help with LabRat projects without bypassing app permissions, review, or provenance rules.
