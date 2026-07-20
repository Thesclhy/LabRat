create table if not exists analysis_threads (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  schema_version text not null default 'labrat.analysisThread.v1',
  status text not null default 'planning',
  original_request text not null,
  messages jsonb not null default '[]'::jsonb,
  plan_revision_ids jsonb not null default '[]'::jsonb,
  analysis_run_ids jsonb not null default '[]'::jsonb,
  accepted_analysis_result_ids jsonb not null default '[]'::jsonb,
  chart_spec_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null references users(id),
  updated_by text references users(id)
);

create index if not exists analysis_threads_project_idx
  on analysis_threads(lab_id, project_id, updated_at desc);

create table if not exists analysis_plan_revisions (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  analysis_thread_id text not null references analysis_threads(id) on delete cascade,
  schema_version text not null default 'labrat.analysisPlanRevision.v1',
  revision integer not null check (revision > 0),
  status text not null default 'awaiting_review',
  request_summary text not null,
  plan jsonb not null,
  selection jsonb not null,
  selection_request jsonb not null default '{}'::jsonb,
  processing_summary jsonb not null default '[]'::jsonb,
  calculation_manifest jsonb not null default '{}'::jsonb,
  python_program jsonb not null default '{}'::jsonb,
  expected_output jsonb not null default '{}'::jsonb,
  source_rectangles jsonb not null default '[]'::jsonb,
  plan_hash text not null,
  dependency_hash text not null,
  selection_hash text not null,
  program_hash text not null,
  runtime_version text not null,
  feedback text,
  warnings jsonb not null default '[]'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  accepted_at timestamptz,
  accepted_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null references users(id),
  updated_by text references users(id),
  unique(analysis_thread_id, revision)
);

create index if not exists analysis_plan_revisions_thread_idx
  on analysis_plan_revisions(lab_id, project_id, analysis_thread_id, revision);

create table if not exists analysis_runs (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  analysis_thread_id text not null references analysis_threads(id) on delete cascade,
  accepted_plan_revision_id text not null references analysis_plan_revisions(id) on delete restrict,
  schema_version text not null default 'labrat.analysisRun.v1',
  status text not null default 'queued',
  idempotency_key text not null,
  request_hash text not null,
  input_hash text not null,
  program_hash text not null,
  runtime_version text not null,
  result_preview_hash text,
  payload jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null references users(id),
  updated_by text references users(id),
  unique(project_id, idempotency_key)
);

create index if not exists analysis_runs_thread_idx
  on analysis_runs(lab_id, project_id, analysis_thread_id, created_at desc);

create table if not exists analysis_results (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  analysis_thread_id text not null references analysis_threads(id) on delete cascade,
  analysis_run_id text not null references analysis_runs(id) on delete restrict,
  schema_version text not null default 'labrat.analysisResult.v1',
  status text not null default 'awaiting_review',
  content_hash text not null,
  result_preview_hash text,
  result jsonb not null,
  source_refs jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  accepted_at timestamptz,
  accepted_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null references users(id),
  updated_by text references users(id)
);

create index if not exists analysis_results_thread_idx
  on analysis_results(lab_id, project_id, analysis_thread_id, created_at desc);

alter table chart_specs
  add column if not exists analysis_result_id text references analysis_results(id) on delete restrict;

create index if not exists chart_specs_analysis_result_idx
  on chart_specs(analysis_result_id);

create table if not exists analysis_publications (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  analysis_thread_id text not null references analysis_threads(id) on delete cascade,
  analysis_result_id text not null references analysis_results(id) on delete restrict,
  chart_spec_id text not null references chart_specs(id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text not null references users(id),
  unique(project_id, idempotency_key)
);

create index if not exists analysis_publications_project_idx
  on analysis_publications(lab_id, project_id, created_at desc);
