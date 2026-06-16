# Current Development Plan

This is the short active plan for the current repository state. Historical checkpoint detail belongs in `doc/PROGRESS.md`; do not turn this file into a running log.

## Current Focus

LabRat Blank now has a working server-first project workflow: Docker Compose local stack, username/password auth, lab/project selection, project state loading, server-backed imports, immutable dataset commits, refresh/replace, mapping review, chart proposal review, durable chart specs, manuscript persistence, and PPTX export.

The active milestone is hardening the end-to-end server workflow and preparing the app for other people to run/debug locally.

```text
server-first workspace implemented
  -> workflow reliability and visual QA
  -> Docker/Postgres deployment hardening
  -> admin/audit usability
  -> smarter import relationships and chart grammar
  -> methodology/recompute later
```

## Current State

- `npm run dev:docker` starts Postgres, backend, and frontend for local development.
- Seeded development accounts are available for local testing:
  - `admin / LabRatAdmin123!`
  - `labuser / LabRatLab123!`
- Logged-in users land on a Projects dashboard, choose a lab/project, and open a server-backed workspace.
- Projects store editable experiment background in `projects.metadata.projectProfile`.
- `GET /api/projects/:projectId/state` hydrates project shell, profile, current dataset commit, files, import runs, mapping sets, chart proposal sets, chart specs, and manuscripts.
- Server import flow persists file objects, import runs, normalize previews, apply decisions, and full immutable dataset commits.
- Refresh/Replace flow creates a new dataset commit that replaces one active import while preserving historical parent commits.
- Chart specs bound to older replaced dataset commits are decorated as stale in API responses and hidden from new insertion choices while existing manuscript blocks keep rendering from snapshots.
- Generic Excel Importer v2 Phase 1 supports grouped/multi-row headers, role-based `fields[]`, source refs, warnings, and confidence.
- Experiment Browser uses generic imported rows and accepted semantic mappings as user-facing dynamic columns.
- Chart Proposal v2 uses field/data profiling, deterministic recipes, optional AI intents, scoring, dedupe, and backend validation.
- ChartSpec v1.3 supports `scatter`, `point`, `bar`, `grouped_bar`, `stacked_bar`, `distribution_bar`, `yFields[]`, `series[]`, allowlisted chart-local transforms, `axisOptions`, and controlled `renderStyle`.
- Manuscript chart insertion uses durable chart specs, requires explicit compatible experiment selection, and stores chart spec snapshots in blocks for historical rendering.
- Overview separates the one-master-table workflow from supplemental workbook uploads: `append` creates the master dataset, `replace_import` refreshes it, and `supplement_import` attaches extra workbooks to existing experiments.
- Project data query resolution exists in the backend for turning natural-language data requests into validated ViewIntent drafts.
- Stateless local/dev endpoints remain available for compatibility, but server mode is the source of truth for logged-in workspaces.
- IndexedDB and `.labrat.json` can remain useful for logged-out/local experiments, but old local project migration is not an active goal.

## Active Milestone: Server Workflow Hardening

Work in this order unless the user redirects:

1. Verify the current Docker stack from a clean checkout: `npm run dev:docker`, seeded login, project open, workbook import, chart proposal review, chart spec creation, manuscript insertion.
2. Polish the split Import/Refresh Review and Review Chart Proposals modals after manual UI inspection.
3. Tighten server project reload behavior so Browser, Overview, chart review, and Manuscript always derive from `GET /api/projects/:projectId/state`.
4. Make refresh-related stale chart behavior visible and understandable in the UI without deleting historical chart specs.
5. Harden Docker/Postgres configuration for friend/debug sharing: `.env` examples, seed-account warnings, local file volume notes, backup/reset instructions, and migration checks.
6. Add minimal Admin/Audit UI for lab/user management and important project actions.
7. Add frontend UI for validated data query ViewIntent drafts and continue improving supplemental detail display inside experiment detail views.
8. Continue chart grammar improvements only through validated ChartSpec/transform extensions, not direct AI-generated Plotly JSON.

## Deferred

These remain out of scope unless the user asks to expand:

- Old IndexedDB or `.labrat.json` compatibility migrations.
- Arbitrary Python/code-interpreter execution for charts.
- Methodology versioning and recompute proposals.
- Template memory trusted auto-apply.
- MCP server.
- OAuth, SSO, email invite, SMTP password reset.
- Billing.
- Cloud object storage and worker queues.
- Kubernetes or multi-region deployment.

## Guardrails

- Keep the Docker local stack easy to start and safe to share.
- Keep stateless local endpoints working, but do not design new features around local-only persistence.
- Do not store plaintext passwords or seed development credentials in production mode.
- Lab-scoped data must have server-side role checks.
- Raw files, dataset commits, and historical chart/manuscript snapshots are immutable audit evidence.
- Refresh replaces the active dataset view through a new commit; it must not mutate parent commits.
- Do not insert chart proposals into manuscripts directly. Create chart specs first.
- Preserve provenance and source refs for imported scientific data.
- AI may propose mappings/charts/explanations, but it must not commit scientific data without review.
- Use `doc/PROGRESS.md` as the only durable progress log.

## Verification

After backend or frontend behavior changes:

```bash
npm test
npm --prefix backend test
npm run build
```

For Docker/Postgres changes, also run:

```bash
docker compose config
npm run dev:docker
```
