alter table analysis_threads
  add column if not exists output_target text not null default 'chart',
  add column if not exists data_snapshot_ids jsonb not null default '[]'::jsonb,
  add column if not exists browser_view_ids jsonb not null default '[]'::jsonb;

alter table analysis_plan_revisions
  add column if not exists output_target text not null default 'chart';

alter table analysis_runs
  add column if not exists output_target text not null default 'chart';

alter table analysis_results
  add column if not exists output_target text not null default 'chart';

alter table data_snapshots
  alter column data_plan_id drop not null,
  add column if not exists analysis_plan_revision_id text references analysis_plan_revisions(id) on delete restrict,
  add column if not exists analysis_run_id text references analysis_runs(id) on delete restrict,
  add column if not exists analysis_result_id text references analysis_results(id) on delete restrict;

create index if not exists data_snapshots_analysis_result_idx
  on data_snapshots(analysis_result_id);

create table if not exists analysis_experiment_publications (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  analysis_thread_id text not null references analysis_threads(id) on delete cascade,
  analysis_result_id text not null references analysis_results(id) on delete restrict,
  data_snapshot_id text not null references data_snapshots(id) on delete restrict,
  browser_view_id text not null references browser_views(id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text not null references users(id),
  unique(project_id, idempotency_key)
);

create index if not exists analysis_experiment_publications_project_idx
  on analysis_experiment_publications(lab_id, project_id, created_at desc);
