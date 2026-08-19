create table if not exists reusable_chart_template_slot_bindings (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  reusable_chart_template_version_id text not null references reusable_chart_template_versions(id) on delete restrict,
  schema_version text not null default 'labrat.reusableChartTemplateSlotBinding.v1',
  slot_id text not null,
  column_id text not null,
  value_type text not null,
  unit text,
  source_signature text not null,
  status text not null default 'active' check (status in ('active', 'superseded')),
  created_at timestamptz not null default now(),
  created_by text references users(id) on delete set null
);

create index if not exists reusable_chart_template_slot_bindings_lookup_idx
  on reusable_chart_template_slot_bindings(reusable_chart_template_version_id, slot_id, status, created_at desc);

create table if not exists reusable_chart_template_applications (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  reusable_chart_template_version_id text not null references reusable_chart_template_versions(id) on delete restrict,
  schema_version text not null default 'labrat.reusableChartTemplateApplication.v1',
  status text not null check (status in ('blocked', 'queued', 'result_ready', 'failed')),
  idempotency_key text not null,
  request_hash text not null,
  experiment_ids jsonb not null default '[]'::jsonb,
  frozen_head_refs jsonb not null default '[]'::jsonb,
  bindings jsonb not null default '[]'::jsonb,
  compatibility jsonb not null default '{}'::jsonb,
  analysis_thread_id text references analysis_threads(id) on delete restrict,
  analysis_plan_revision_id text references analysis_plan_revisions(id) on delete restrict,
  analysis_run_id text references analysis_runs(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id) on delete set null,
  updated_by text references users(id) on delete set null,
  unique (project_id, idempotency_key)
);

create index if not exists reusable_chart_template_applications_template_idx
  on reusable_chart_template_applications(reusable_chart_template_version_id, created_at desc);
