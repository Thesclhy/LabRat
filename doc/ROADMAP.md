# Product Roadmap

This roadmap keeps the active product sequence separate from `doc/PROGRESS.md`, which is the historical log.

## Current Status

LabRat Blank already has:

- Local-first generic Excel import, review, normalization, mapping proposals, chart proposals, and imported Experiment Browser rows.
- IndexedDB project persistence and `.labrat.json` export/import.
- Backend SaaS Auth v0 foundation with Postgres migrations, username/password sessions, roles, projects, file objects, import runs, dataset commits, chart specs, manuscripts, and audit events.
- Server-first project persistence with per-project experiment background profiles, project state loading, mapping-set persistence, chart-proposal-set persistence, and project-scoped AI chart APIs.
- Backend hardening for import-run lifecycle, merged full dataset commits, duplicate import rejection, and source-backed chart spec validation.
- Backend refresh/replace support for uploading changed lab data and creating a new current dataset commit without mutating historical commits.
- One-sentence chart interpretation into validated LabRat ChartSpec drafts.

The next active roadmap item is frontend server mode.

## 1. Frontend Server Mode

Goal: let a user log in, choose a lab/project, and open a server-backed project from the project state API.

- Add login/logout/me frontend API helpers.
- Add server-mode login UI.
- Show active user, lab, and project in the app shell.
- Add lab and project selection.
- Load server project state from `GET /api/projects/:projectId/state`.
- Save project background through `PATCH /api/projects/:projectId/profile`.
- Use `POST /api/projects/:projectId/ai/context` to prepare assistant context.
- Treat server state as the source of truth after login.

Done when seeded `admin` and `labuser` accounts can log in through the frontend, select `Hanqi Test Lab`, open a server project, and view/update its project profile.

## 2. Server-Backed Import Apply

Goal: move accepted imports from local-only state into persisted import runs and dataset commits.

- Upload workbooks through project-scoped file APIs when logged in.
- Create persisted import runs from uploaded file objects.
- Run normalize preview through import-run APIs.
- Apply approved previews as immutable merged dataset commits.
- Refresh an existing imported workbook by uploading a replacement, reviewing the diff, and applying a new commit that supersedes that active import.
- Point Experiment Browser at the current dataset commit in server mode.

Done when an imported Browser value can be traced to a dataset commit, import run, file object, and source cell/range.

## 3. Chart Specs To Manuscript

Goal: make reviewed chart output durable before manuscript insertion.

- Use `POST /api/projects/:projectId/charts/interpret` for one-sentence chart drafts.
- Use `POST /api/projects/:projectId/charts/propose` for automatic project chart recommendations.
- Convert accepted chart proposals or interpreted ChartSpec drafts into persisted chart specs.
- Render chart specs from server project state.
- Insert manuscript chart blocks by chart spec id.
- Preserve local chart proposal review and legacy HDPE chart behavior.

Done when a user can upload data, accept a chart, persist it as a chart spec, insert it into a manuscript, reload the project, and export PPTX.

## 4. Manuscript Persistence

Goal: make manuscript canvas state part of the server project source of truth.

- Load manuscript records from project APIs.
- Save blocks, pages, canvas state, references, and chart spec refs.
- Preserve selection, drag, resize, and keyboard behavior in the canvas.

Done when manuscript work survives reload/login and still exports correctly.

## 5. Admin And Audit UI

Goal: make the SaaS foundation usable by a lab owner or admin.

- Add admin UI for labs, users, roles, and password resets.
- Show audit summaries for important project actions.
- Keep sensitive payloads and secrets out of audit displays.

Done when a lab owner can manage users and inspect who changed important project records.

## Deferred

- Import Review UI v2
- Template memory
- Methodology versioning and recompute proposals
- External MCP server
- OAuth/SSO and email invites
- SMTP password reset
- Billing
- Worker queue and object storage service
- Kubernetes or multi-region deployment
- Compatibility migrations for old IndexedDB, `.labrat.json`, or previous local project shapes
