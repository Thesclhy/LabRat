# Product Roadmap

This roadmap keeps the active product sequence separate from `doc/PROGRESS.md`, which is the historical log.

## Current Status

LabRat Blank already has:

- One-command local Docker development with Postgres, backend, and frontend.
- Auth v0 with seeded/admin-created username/password accounts, httpOnly sessions, roles, labs, and projects.
- Server-backed project dashboard, project creation/opening, project profile editing, and project state loading.
- Persisted file objects, import runs, normalize previews, immutable dataset commits, refresh/replace, mapping sets, chart proposal sets, chart specs, manuscripts, and audit events.
- Generic Excel import with multi-row/grouped header parsing, role-based `fields[]`, source refs, confidence, and warnings.
- Imported Experiment Browser rows driven by generic imports and accepted semantic mappings.
- Chart Proposal v2 with data profiling, deterministic recipes, optional AI intents, scoring, and dedupe.
- ChartSpec v1.3 with multi-series charts, `distribution_bar`, allowlisted chart-local transforms, controlled axis options, and render style hints.
- Server chart spec insertion into Manuscript with explicit compatible experiment selection and historical chart spec snapshots.
- Split master/supplemental upload UI: one active master table per project, refresh/replace for the master, and reviewable supplemental workbook attachment for extra experiment files.
- Backend natural-language project data query resolution into validated ViewIntent drafts.
- Server-backed LabRat chat action planning that turns natural-language requests into confirmable action cards for uploads, supplements, chart proposals, ChartSpecs, and data queries.

The next active roadmap item is server workflow hardening and local deployment readiness.

## 1. Server Workflow Reliability

Goal: make the logged-in project workflow dependable enough for another person to debug with real workbooks.

- Verify seeded login, lab/project selection, project open, import, refresh, chart proposal review, chart spec creation, manuscript insertion, reload, and PPTX export from a clean Docker stack.
- Keep Import/Refresh Review focused on data ingestion and the Review Chart Proposals modal focused on chart drafting/review.
- Let the LabRat chat launch the same reviewed workflows through action cards, without silently committing scientific data.
- Ensure project state reloads consistently after import apply, refresh apply, mapping updates, chart proposal decisions, chart spec creation, and manuscript saves.
- Make stale chart specs after refresh understandable without deleting historical chart/manuscript evidence.

Done when a user can run `npm run dev:docker`, log in as `labuser`, upload/refresh data, create a chart spec, insert it into a manuscript, reload the project, and see the same state.

## 2. Docker/Postgres Deployment Hardening

Goal: make local sharing and future hosted deployment safer.

- Document `.env` / `.env.example` expectations for backend secrets and seed-account toggles.
- Keep development seed accounts clearly marked as local-only.
- Add reset/backup notes for the Docker Postgres volume and uploaded local files.
- Confirm migrations are idempotent and run before backend startup.
- Keep optional Postgres tests gated by `LABRAT_TEST_DATABASE_URL`.
- Review what files are Git-ignored so database content, uploaded files, and local secrets do not get pushed.

Done when a friend with Docker can clone, start, test, reset, and debug the app without receiving local database contents.

## 3. Admin And Audit UI

Goal: make the SaaS foundation usable by a lab owner or admin.

- Add admin UI for labs, users, roles, activation/deactivation, and password resets.
- Show audit summaries for important project actions: login, upload, normalize, apply, refresh, mapping decision, chart proposal decision, chart spec creation, manuscript save, and export.
- Keep sensitive payloads and secrets out of audit displays.

Done when a lab owner can manage users and inspect who changed important project records.

## 4. Smarter Import Relationships

Goal: support realistic lab workflows where later files add detail to existing experiments.

- Polish supplemental relationship review and show linked supplemental files/data in experiment detail views.
- Let a detailed workbook such as `Reaction_Rate_Exp30.xlsx` attach to an existing `Exp30` instead of becoming an unrelated experiment.
- Compare candidate relationships using experiment labels, dates, filenames, field overlap, source ranges, and user/project context.
- Keep the proposal reviewable; accepting it should create a new dataset commit with preserved provenance.

Done when supplemental files can enrich existing experiments while keeping the active dataset and historical commits auditable.

## 5. Chart Grammar Expansion

Goal: make charts more expressive without letting AI invent data or return arbitrary Plotly JSON.

- Extend ChartSpec and allowlisted transforms when a real chart need appears.
- Add recipes for response curves, distributions, grouped/stacked normalized bars, ratios, sums, and component families.
- Keep AI at the intent layer; backend resolves fields and validates ChartSpec; frontend renders Plotly.
- Consider a future Browser/ViewSpec layer for AI-proposed data views after field provenance and permissions are solid.

Done when common catalysis/lab chart requests can be expressed as validated, source-backed ChartSpecs.

## 6. Methodology And Recompute

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
