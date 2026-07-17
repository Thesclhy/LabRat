create table if not exists data_plans (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  schema_version text not null default 'labrat.dataPlan.v2',
  status text not null default 'accepted',
  task text not null default 'experiment_browser_publish',
  output_shape text not null default 'experiment_records',
  plan jsonb not null default '{}'::jsonb,
  source_evidence jsonb not null default '[]'::jsonb,
  operations jsonb not null default '[]'::jsonb,
  identity_bindings jsonb not null default '[]'::jsonb,
  dependency_hash text not null,
  validation jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  accepted_at timestamptz,
  accepted_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null references users(id),
  updated_by text references users(id)
);

create index if not exists data_plans_project_idx
  on data_plans(lab_id, project_id, created_at desc);

create table if not exists data_snapshots (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  data_plan_id text not null references data_plans(id) on delete restrict,
  schema_version text not null default 'labrat.dataSnapshot.v2',
  status text not null default 'accepted',
  output_shape text not null default 'experiment_records',
  content_hash text not null,
  dependency_hash text not null,
  snapshot jsonb not null default '{}'::jsonb,
  experiment_records jsonb not null default '[]'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  accepted_at timestamptz not null,
  accepted_by text not null references users(id),
  created_at timestamptz not null default now(),
  created_by text not null references users(id)
);

create index if not exists data_snapshots_project_idx
  on data_snapshots(lab_id, project_id, data_plan_id, created_at desc);

create index if not exists data_snapshots_content_hash_idx
  on data_snapshots(project_id, content_hash);

create table if not exists experiment_identities (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  canonical_label text not null,
  normalized_label text not null,
  aliases jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null references users(id),
  updated_by text references users(id)
);

create index if not exists experiment_identities_project_idx
  on experiment_identities(lab_id, project_id, normalized_label, created_at);

create table if not exists experiment_snapshot_heads (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  experiment_id text not null references experiment_identities(id) on delete cascade,
  data_snapshot_id text not null references data_snapshots(id) on delete restrict,
  record_index integer not null check (record_index >= 0),
  updated_at timestamptz not null default now(),
  updated_by text not null references users(id),
  unique(project_id, experiment_id)
);

create index if not exists experiment_snapshot_heads_project_idx
  on experiment_snapshot_heads(lab_id, project_id, updated_at desc);

create table if not exists browser_views (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  owner_user_id text not null references users(id) on delete cascade,
  schema_version text not null default 'labrat.browserView.v1',
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists browser_views_owner_idx
  on browser_views(lab_id, project_id, owner_user_id, updated_at desc);

create table if not exists experiment_snapshot_publishes (
  project_id text not null references projects(id) on delete cascade,
  lab_id text not null references labs(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  data_plan_id text not null references data_plans(id) on delete restrict,
  data_snapshot_id text not null references data_snapshots(id) on delete restrict,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(project_id, idempotency_key)
);

create index if not exists experiment_snapshot_publishes_lab_idx
  on experiment_snapshot_publishes(lab_id, project_id, created_at desc);
