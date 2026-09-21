# Manual Experiment Rows v1

Status: implemented and locally verified; production rollout not performed
Last reviewed: 2026-09-21

## Purpose

**Add row** in Experiment Browser lets a person log an experiment by hand. A
manual row is a lab logbook entry. It is not accepted data: it has no
DataSnapshot, no source cells and no series, and it is never an analysis, data
plan or chart input.

## Storage

Migration `032_manual_experiments.sql` adds `manual_experiments` (one row per
manual entry: note, version, author, timestamps). The row name lives in the
existing `experiment_identities` table and its documented values live in the
existing `experiment_custom_values` table, keyed by experiment id. Migration
`033_manual_experiment_values.sql` adds `manual_experiment_values`: versioned,
hand-typed text for the accepted-data columns of a manual row, keyed by
experiment id and Browser column id. There is no
`experiment_snapshot_heads` row, which is what keeps manual rows out of
`resolveActiveExperimentRecords` and therefore out of every analysis input.

## API (all under `/api/v1`, capability `propose` on the full project)

| Operation | Endpoint |
| --- | --- |
| Create | POST `/projects/{projectId}/experiments` with `{ label, note? }` |
| Rename / edit note | PATCH `/projects/{projectId}/experiments/{experimentId}` with `{ label?, note?, expectedVersion }` |
| Delete | DELETE `/projects/{projectId}/experiments/{experimentId}` |
| Type a cell value | PUT `/projects/{projectId}/experiments/{experimentId}/manual-values` with `{ columnId, value, expectedVersion? }` |

- The label needs at least one letter or digit (`400 invalid_experiment_label`).
- A label whose normalized form matches another experiment's label or alias in
  the project returns `409 experiment_label_conflict`. Creation and rename are
  serialized per project with a transaction-scoped advisory lock.
- A stale `expectedVersion` returns `409 manual_experiment_conflict`.
- PATCH and DELETE on a row that comes from accepted data return
  `409 experiment_not_manual`; an unknown id returns 404.
- A typed value targets an accepted-data column that currently exists in the
  project's Browser projection; the Experiment column, custom columns, linked-data
  columns and unknown ids return `404 experiment_column_not_found` (custom
  columns keep their own endpoint). Version 0 inserts; otherwise the version
  must match or the call returns `409 manual_experiment_value_conflict`.
  Typed values are plain text up to 2000 characters. They are stored outside
  every DataSnapshot and are never coerced to numbers, units or dates.
- Delete removes the identity, which cascades to the manual entry, its typed values, its custom
  values and personal annotations. Each write records an audit event
  (`manual_experiment.create|update|delete`).
- Members with View access read manual rows but cannot write them. Members with
  selected-experiment grants only see manual rows whose experiment id is granted.

## Projection

`GET /projects/{projectId}/experiment-browser` rows now carry `origin`
(`snapshot` or `manual`) and `manualEntry` (null for snapshot rows). For manual
rows `dataSnapshotId`, `acceptedAt` and `headId` are null. An accepted-data cell
is null until someone types into it; a typed cell carries `isManual: true`, its
text as `value` and `formattedValue`, and its `version`. Typed values are only
projected onto manual rows and can never override an accepted row's cell. Search,
filters, sort, paging, stars and annotations treat them like any other row;
without an explicit sort they follow the accepted rows.

If accepted data is later published for the same identity (the publisher
matches on the normalized label), the accepted row replaces the manual row and
the custom values typed into it stay attached. The `manual_experiments` record
and its typed values are kept but no longer shown; the accepted values win.

`GET /projects/{projectId}/experiments/{experimentId}` is unchanged and still
returns 404 for a manual row; the frontend does not request it for them.

## Frontend

The toolbar has **Add row** next to **Add column**, enabled with shared-config
edit access. It opens an inline name form; the saved row appears at the top with
a **Manual** badge. Every cell of a manual row except linked data edits on a
single click (accepted rows keep double-click on custom cells only); the
column's unit is appended for display. Opening a manual row shows its own
drawer (author, date, rename, note, delete with confirmation) instead of the
source-backed detail drawer.

`src/data/experimentBrowserApi.js` also maps the v1 `customColumn` and
`customValue` response envelopes onto the `experimentCustomColumn` and
`experimentCustomValue` keys the Browser reads. Before this, a newly added
column only appeared after a reload and a cell's version was not tracked.

## Out of scope

Typed value kinds (number, unit, date) and validation against the column type,
any use in charts or analysis, typed values in a project that has no
accepted-data columns yet (use custom columns there), and bulk paste or import
of rows.
