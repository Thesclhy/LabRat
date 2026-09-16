# LabRat

LabRat is an invitation-only, multi-lab research workspace for reviewing Excel
evidence, comparing experiments, creating traceable charts, and preparing
manuscript figures and PPTX exports.

## Online Access

[Open LabRat](https://labrat.100.50.25.194.nip.io/LabRat/)

- **New lab owners:** request a private invitation from the platform administrator.
- **Lab members:** request a private invitation from your lab owner, who assigns
  project access after registration.
- **Existing accounts:** sign in normally; use **Use invitation** to join another
  lab without creating a second account.
- **Guest access:** use the public, read-only demo account below.

Do not publish real-user or administrator passwords, API keys, or live invitation
codes in this repository. Only the dedicated demo credential below is intentionally
public. Production runtime hardening remains separate work.
See [current status and outstanding checks](doc/current-milestone.md).

### Public Guest Demo

- Username: `guest`
- Password: `Guest-uWCJn5ZC-Demo!`
- Sign in at [LabRat](https://labrat.100.50.25.194.nip.io/LabRat/) and open
  **Guest Workspace** in **LabRat Public Demo**.

This dedicated workspace currently starts empty: no real lab data, workbooks or
scientific results are copied into it. Guest can explore the read-only interface,
but cannot upload, edit, run AI, create projects or redeem invitations. The session
expires after 30 minutes. Request a private invitation and use a personal account
for actual research work.

Never add confidential information to this public demo project. See the
[Guest isolation and operating contract](doc/contracts/public-guest-v1.md).

## Current Capabilities

- Batch workbook upload, progress and retry, with source indexing and exact
  sheet/cell references.
- Independent region review: inspect suggested meanings, formula dependencies,
  warnings and series; correct or confirm each region explicitly.
- Versioned region-extraction templates, matching reports and per-region batch
  confirmation.
- Experiment Browser, linked workbook data, source navigation and cross-experiment
  comparisons.
- Reviewed analysis and reusable chart templates, with frozen input versions,
  deterministic compatible-template runs and explicit result acceptance.
- Manuscript chart placement, independent trace visibility, drag/resize, saved
  layouts and PPTX export.
- Invitation registration, multiple labs, member management and project-level
  View, Edit or Approve permissions.

Uploading a workbook does not automatically accept scientific values or publish
charts. AI suggestions pass through validation and human review. Accepted
results retain their source references and immutable history; re-confirming a
region does not silently rewrite an accepted chart. Browser scalar records come
from accepted DataSnapshots, while linked workbook data remains separately
traceable to confirmed regions.

Projects start empty. Workbooks under [public/templates](public/templates/) are
examples only and are never imported automatically.

## Roles And Access

- **Platform administrator:** manages lab-owner invitations and platform
  administration; this identity does not automatically grant scientific-data access.
- **Lab owner / lab administrator:** manages their lab, members and project access.
- **Lab member:** starts without project access and waits for an explicit grant.
  The View preset includes viewing and exporting; Edit adds proposals and draft
  changes; Approve also permits scientific approval/publication.
- **Public Guest:** fixed to the separate demo project, with a server-enforced
  read-only restriction in addition to its View grant.

Read-only access is not a substitute for an isolated public-demo dataset. See
[invitation and member-management usage](doc/contracts/invitation-onboarding-v1.md)
and the [authorization contract](doc/contracts/authorization-v1.md).

## Architecture

- **Frontend:** React 19 / JSX, Vite and Plotly.
- **Backend:** NestJS + Fastify + TypeScript, with first-party APIs under
  `/api/v1` and a generated OpenAPI client.
- **Persistence:** PostgreSQL, Drizzle and versioned SQL migrations; durable
  uploaded-file storage and server-backed project state.
- **AI:** one deployment-selected backend provider, Anthropic or DeepSeek.
  Provider keys stay on the backend, never in browser settings.

The previous unversioned `/api` dispatcher is a rollback reference, not the
current frontend's API. Detailed contracts are linked below.

## Local Development

Docker Compose is the default local development environment. Install Docker with
Compose and Node.js compatible with [package.json](package.json); the repository
Node baseline is recorded in [.nvmrc](.nvmrc).

1. Copy [.env.example](.env.example) to the Git-ignored root `.env` if it does
   not already exist. Do not overwrite existing local settings.
2. Select `LABRAT_AI_PROVIDER=anthropic` or `deepseek` and configure the
   matching model/key variables from the example. A development instance may
   start without a provider key, but AI-dependent actions remain unavailable.
3. Start the stack from the repository root:

```bash
npm run dev:docker
```

Local services:

- [Frontend](http://127.0.0.1:5173/LabRat/)
- Backend: `http://127.0.0.1:8787`, API prefix `/api/v1`
- PostgreSQL: `127.0.0.1:5433` by default; configurable with
  `LABRAT_POSTGRES_PORT`

Compose restores dependencies from the root and backend lockfiles, applies
migrations, and starts the compiled Nest service. Database and uploaded files
persist in separate volumes. Restart the backend after backend code edits.

[Local-only test accounts](backend/README.md#local-only-test-accounts) are
development fixtures, not instructions for signing in to the hosted site. Never
reuse their passwords or enable development seeding on a public server. Removing
credentials from this page does not reset existing accounts.

Stop the stack without removing its persistent volumes:

```bash
npm run dev:docker:down
```

When using an already-running backend, the frontend can also run on the host:

```bash
npm ci
npm run dev
```

Skip installation if dependencies already match the lockfile. For backend-only
startup and PostgreSQL checks, see the [backend guide](backend/README.md).
Compose reads provider settings from root `.env`; the host backend development
command additionally loads optional `.env.local` overrides. After changing
Compose provider settings, recreate the backend:

```bash
docker compose up -d --force-recreate backend
```

The Compose Python executor is for trusted local development only and is not a
security sandbox. Production analysis execution must remain disabled unless a
hardened external worker is configured.

## Verification

Run from the repository root:

```bash
npm run codex:preflight
npm run codex:verify
```

The full verification command checks generated API types, frontend/backend
tests and builds. PostgreSQL scenarios also need an explicitly configured
`LABRAT_TEST_DATABASE_URL`; see the [backend guide](backend/README.md).

Build the frontend alone with `npm run build`. Verification evidence and
unperformed checks belong in the [current milestone](doc/current-milestone.md)
and [progress log](doc/PROGRESS.md), not in a duplicate README history.

## Deployment

The hosted stack uses AWS Lightsail, Caddy, PostgreSQL and durable file storage.
A push to `main` can trigger the GitHub Actions deployment workflow, including
database migrations; documentation-only pushes are not exempt.

Production provider secrets belong in the server's protected
`/etc/labrat/backend.env`, not in Git or the browser. The GitHub Repository
Variable `LABRAT_AI_PROVIDER` selects the provider, not its secret key.
The development Compose stack is not a production deployment configuration.

Read the [deployment guide](doc/deployment/lightsail.md) together with the
[current runtime status](doc/current-milestone.md) before deploying or rolling
back. A successful HTTP response alone is not proof that the expected API
version is running.

## Documentation

- [Start here](doc/START_HERE.md) — architecture, contracts and task-specific
  reading paths.
- [Development plan](doc/plan.md) and [current milestone](doc/current-milestone.md)
  — priorities, verified work and remaining gates.
- [Backend guide](backend/README.md) and
  [OpenAPI v1 contract](doc/contracts/backend-api-v1.openapi.yaml) — local backend
  usage and current API definitions.
- [Scientific data dictionary](doc/contracts/canonical-data-dictionary.md) and
  [AI boundaries](doc/arch/ai-boundaries.md) — evidence and review rules.
- [Reusable chart templates](doc/contracts/reusable-chart-template-contract-v1.md)
  — input bindings, recipes, versions and provenance.
- [Integration acceptance record](doc/qa/claude-v1-integration-acceptance.md) —
  tested workflows and limits.
- [Progress log](doc/PROGRESS.md) — implementation and operational history.
- [Agent instructions](AGENTS.md) and [task checklist](doc/task-checklist.md) —
  repository contribution workflow.

Previous README revisions remain available in Git history. Subdirectory READMEs
document their own tools or fixtures; they are not duplicate project homepages.
