# Product Roadmap

Status: reference
Read when: choosing or sequencing product roadmap work.
Last reviewed: 2026-06-25


This roadmap keeps the active product sequence separate from `doc/PROGRESS.md`, which is the historical log.

## Current Status

LabRat Blank already has:

- One-command local Docker development with Postgres, backend, and frontend.
- Auth v0 with seeded/admin-created username/password accounts, httpOnly sessions, roles, labs, and projects.
- Server-backed project dashboard, project creation/opening, project profile editing, and project state loading.
- Persisted file objects, upload/scan import runs, SourceDocuments/SourceRegions, WorkbookReviewSessions, optional immutable dataset commits, mapping sets, chart proposal sets, chart specs, manuscripts, and audit events.
- Deterministic workbook/source indexing with multi-row/grouped header detection, source refs, confidence, warnings, bounded range reads, and editable red-box review surfaces.
- Experiment Browser rows remain a downstream project-data surface; upload confirmation alone does not populate Browser data.
- Chart Proposal v2 with data profiling, deterministic recipes, optional AI intents, scoring, and dedupe.
- ChartSpec v1.3 with multi-series charts, `distribution_bar`, allowlisted chart-local transforms, controlled axis options, and render style hints.
- Server chart spec insertion into Manuscript with explicit compatible experiment selection and historical chart spec snapshots.
- Single Upload workbook surface that opens a readable WorkbookReviewSession instead of asking users to classify files as master or supplemental at upload time.
- Backend natural-language project data query resolution into validated ViewIntent drafts.
- Server-backed LabRat chat action planning that turns natural-language requests into confirmable action cards for uploads, supplements, chart proposals, ChartSpecs, and data queries.

The next active roadmap item is the Conversational Workbook Understanding MVP: workbook upload creates SourceDocument evidence and a WorkbookReviewSession; LabRat drafts a validated WorkbookUnderstanding; the user corrects it through chat plus red boxes; accepted understanding later feeds DataPlan/DataSnapshot, optional SourceExtractProposal, optional DatasetCommit promotion, and reviewed ChartSpec/manuscript output.

## 1. Conversational Workbook Understanding MVP

Goal: make uploaded Excel files understandable to users before any data extraction, charting, or dataset promotion.

- Upload creates immutable file metadata, SourceDocument/SourceRegion indexes, and a WorkbookReviewSession.
- The frontend shows full workbook evidence through bounded windows, detected red boxes, and user-created red boxes.
- Each revision sends natural-language instructions and red-box updates together.
- The backend uses deterministic source validation plus optional LLM drafting to return a readable WorkbookUnderstanding draft.
- Confirming saves WorkbookUnderstanding only; it does not create a DatasetCommit, SourceExtractProposal, ChartSpec, FigurePackage, or ManuscriptPlacement.
- Later chart/table/data workflows use accepted understanding plus source refs to create DataPlans/DataSnapshots or optional source extracts.

Done when a user can upload a messy workbook, see LabRat's proposed understanding and red boxes, correct them through chat and new selections, confirm the understanding, reload the project, and see the accepted workbook semantics without any automatic data commit.

## 2. Source Understanding Workspace

Goal: let LabRat inspect original workbooks/documents as auditable source evidence when useful information was not captured by the normalized dataset.

- Persist source document indexes for uploaded Excel workbooks, including sheets, ranges, raw/formatted values, formulas, and source refs.
- Detect reviewable source regions such as component distributions, formula summaries, calibration tables, and unknown regions.
- Add bounded source retrieval tools for search, range preview, cell inspection, formula tracing, workbook-understanding revisions, and extraction proposals.
- Let chart requests use source hints such as row numbers, sheet names, labels, and C-number headers before asking for clarification.
- Keep source-derived values behind reviewable extract/chart proposals and preserve exact file/sheet/range citations.

Done when a request such as `use Overall tots row 69 to plot the Exp30 carbon number distribution` resolves to a source-backed chart proposal with cited workbook cells instead of asking the user to choose from unrelated normalized fields.

See `doc/plans/source-understanding-long-term-plan.md` for the detailed architecture and phased rollout.

## 3. DataPlan, DataSnapshot, And Chart Review

Goal: turn accepted understanding and source refs into reviewable chart/table data only when requested.

- Compile chart/table requests into DataPlan drafts against accepted WorkbookUnderstanding, SourceDocuments, source extracts, observation series, or optional DatasetCommits.
- Execute deterministic DataSnapshots with source refs, included/skipped experiments, warnings, and stable hashes.
- Route all natural-language chart creation surfaces through the same project-scoped chart gateway.
- Keep source extraction, data review, chart visual review, FigurePackage publishing, and manuscript placement as separate explicit steps.

Done when cross-compare and source-range chart requests produce inspectable DataSnapshots/ChartSpecs without using unrelated workbook data or bypassing review.

## 4. Server Workflow Reliability

Goal: make the logged-in project workflow dependable enough for another person to debug with real workbooks.

- Verify seeded login, lab/project selection, project open, workbook upload/review/understanding confirmation, chart proposal review, chart spec creation, manuscript insertion, reload, and PPTX export from a clean Docker stack.
- Keep Workbook Review focused on source understanding and the Review Chart Proposals modal focused on chart drafting/review.
- Let the LabRat chat launch the same reviewed workflows through action cards, without silently committing scientific data.
- Ensure project state reloads consistently after import apply, refresh apply, mapping updates, chart proposal decisions, chart spec creation, and manuscript saves.
- Make stale chart specs after refresh understandable without deleting historical chart/manuscript evidence.

Done when a user can run `npm run dev:docker`, log in as `labuser`, upload and understand a workbook, create a chart spec from reviewed data, insert it into a manuscript, reload the project, and see the same state.

## 5. Docker/Postgres Deployment Hardening

Goal: make local sharing and future hosted deployment safer.

- Document `.env` / `.env.example` expectations for backend secrets and seed-account toggles.
- Keep development seed accounts clearly marked as local-only.
- Add reset/backup notes for the Docker Postgres volume and uploaded local files.
- Confirm migrations are idempotent and run before backend startup.
- Keep optional Postgres tests gated by `LABRAT_TEST_DATABASE_URL`.
- Review what files are Git-ignored so database content, uploaded files, and local secrets do not get pushed.

Done when a friend with Docker can clone, start, test, reset, and debug the app without receiving local database contents.

## 6. Admin And Audit UI

Goal: make the SaaS foundation usable by a lab owner or admin.

- Add admin UI for labs, users, roles, activation/deactivation, and password resets.
- Show audit summaries for important project actions: login, upload, normalize, apply, refresh, mapping decision, chart proposal decision, chart spec creation, manuscript save, and export.
- Keep sensitive payloads and secrets out of audit displays.

Done when a lab owner can manage users and inspect who changed important project records.

## 7. Relationship And Series Understanding

Goal: support realistic lab workflows where different workbooks describe the same experiment or comparable series without requiring master/supplement upload categories.

- Represent workbook-to-experiment bindings as accepted WorkbookUnderstanding facts.
- Let DataPlan/DataSnapshot derive observation series from accepted understanding and source refs.
- Compare candidate relationships using experiment labels, dates, filenames, field overlap, source ranges, and user/project context.
- Keep relationship changes reviewable; promotion to DatasetCommit remains optional and explicit.

Done when reaction-rate or calculation workbooks can be linked to Exp33/Exp34/Exp35 through reviewed understanding and later used for cross-compare charts.

## 8. Chart Grammar Expansion

Goal: make charts more expressive without letting AI invent data or return arbitrary Plotly JSON.

- Extend ChartSpec and allowlisted transforms when a real chart need appears.
- Add recipes for response curves, distributions, grouped/stacked normalized bars, ratios, sums, and component families.
- Keep AI at the intent layer; backend resolves fields and validates ChartSpec; frontend renders Plotly.
- Use Analysis Views for compare/source/table intents before creating chart proposals.

Done when common catalysis/lab chart requests can be expressed as validated, source-backed ChartSpecs.

## 9. Methodology And Recompute

Goal: handle calculation changes without overwriting scientific history.

- Define methodology versions for calculations such as carbon balance, selectivity normalization, GC calibration, and unit conversion.
- Generate recompute proposals against a dataset commit.
- Show old values, new values, deltas, warnings, and source/calculation refs.
- Accepting a recompute creates a new dataset commit.

Done when a methodology change can be reviewed, applied, compared, and cited reproducibly.

## Deferred

- Old local IndexedDB / `.labrat.json` compatibility migrations.
- Arbitrary code execution for charting or methodology calculations.
- MCP server.
- OAuth/SSO and email invites.
- SMTP password reset.
- Billing.
- Cloud worker queue and managed object storage.
- Kubernetes or multi-region deployment.
