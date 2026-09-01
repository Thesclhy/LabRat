# Authorization Contract v1

Status: contract
Last reviewed: 2026-08-23

## Purpose

This contract replaces LabRat's Lab-role-rank authorization for `/api/v1`.
Authentication remains a server-owned session in an HTTP-only cookie.
Authorization is default-deny and is evaluated for the exact resource and
operation before a controller or worker may read scientific data.

## Resource Tree

```text
Lab
  -> Project
      -> Experiment
          -> Artifact
```

Artifacts include FileObjects, SourceDocuments, WorkbookReviewSessions,
RegionUnderstandingRevisions, DataSnapshots, AnalysisThreads, AnalysisRuns,
AnalysisResults, ChartSpecs, Browser state and Manuscripts. An artifact inherits
the access decision for its owning Project or Experiment unless a later
contract explicitly defines a narrower rule.

## Lab Roles

Public v1 roles are:

- `lab_owner`: all capabilities in the Lab, including ownership transfer.
- `lab_admin`: all project and experiment capabilities plus membership, group
  and grant management; cannot transfer Lab ownership.
- `lab_member`: no project data access unless an active user/group grant
  allows it.

The migration must not rewrite legacy `viewer` and `editor` membership rows
while the old server remains a rollback target. The v1 resolver treats both as
`lab_member` and uses backfilled grants. Physical role cleanup occurs only
after the legacy removal window.

`isSuperAdmin` authorizes platform administration endpoints only. It does not
grant scientific Lab, Project, Experiment or Artifact access. A platform
administrator must also have an active Lab membership to read Lab data.

## Capabilities

- `read`: list and read the permitted resource and bounded evidence.
- `propose`: create or revise project metadata, uploads, review proposals,
  analysis plans, annotations, Browser documentation and Manuscript drafts.
- `approve`: confirm region interpretations and accept/publish reviewed
  AnalysisResults, DataSnapshots and ChartSpecs.
- `export`: export permitted accepted data, figures or manuscripts.
- `manage_access`: manage project/experiment grants and groups within the
  caller's administrative scope.

`approve` does not imply `manage_access`. `propose` does not imply `approve`.
For the first v1 release, a user may approve their own proposal when they hold
`approve`; separation-of-duties policy is reserved for a later contract.

## Grants And Inheritance

Grants can target one user or one Lab group. Disabled users, inactive Lab
memberships, inactive groups and inactive grants never authorize access.

A project grant has one scope:

- `all_experiments`: its capabilities apply to the Project shell, every
  Experiment in the Project and their artifacts.
- `selected_experiments`: it exposes the minimum Project shell; project-level
  capabilities apply only to that shell and explicit experiment grants decide
  which Experiment data and artifacts are accessible.

An experiment grant applies capabilities to exactly one Experiment and its
artifacts. Effective capabilities are the union of active direct-user and
active-group grants. Explicit deny grants are not part of v1.

Receiving an experiment grant exposes only this Project shell:

```json
{
  "id": "project_123",
  "labId": "lab_123",
  "name": "Catalyst screening",
  "description": "",
  "status": "active"
}
```

It must not expose hidden experiment counts, names, summaries, source files,
accepted snapshot counts, analysis counts or chart/manuscript metadata.

## Enforcement

Authorization is required at three boundaries:

1. A Nest guard resolves the authenticated actor and rejects an obviously
   unauthorized operation.
2. The application service checks the concrete capability against the exact
   loaded resource and rechecks it immediately before reviewed publication.
3. The repository filters list, count, cursor, search and detail queries by
   permitted project/experiment ids. Frontend hiding is never authorization.

Background AgentRun, AnalysisRun and worker messages retain `labId`,
`projectId`, `actorUserId` and, when applicable, experiment ids. They inherit
the initiating actor's grants and re-authorize before materialization and
publication. A service account cannot widen the actor's evidence scope.

Revocation takes effect on the next request and on the next asynchronous
authorization checkpoint; an existing session is not a capability cache.

## Migration Compatibility

Migration 024 adds groups and grants without changing or removing v0 tables.
It backfills equivalent access for active legacy memberships on existing
projects:

- `viewer` -> `read`, `export`, scope `all_experiments`
- `editor` -> `read`, `propose`, `approve`, `export`, scope `all_experiments`

Lab owners and administrators need no backfilled grants because their active
role authorizes the complete Lab. While rollback compatibility is required,
creating a Project must also create equivalent grants for active legacy
viewer/editor members. The migration and v1 application path must be
idempotent.

## Audit

Creating, changing, disabling or deleting a group, group membership or grant
writes an audit event with actor, Lab, Project when applicable, target ids,
capabilities and scope. Audit payloads must not include session tokens,
credentials or unrelated scientific values.
