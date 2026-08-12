create table if not exists experiment_custom_columns (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  schema_version text not null default 'labrat.experimentCustomColumn.v1',
  label text not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id) on delete set null,
  updated_by text references users(id) on delete set null
);

create index if not exists experiment_custom_columns_project_idx
  on experiment_custom_columns(project_id, created_at, id);

create table if not exists experiment_custom_values (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  custom_column_id text not null references experiment_custom_columns(id) on delete cascade,
  experiment_id text not null references experiment_identities(id) on delete cascade,
  schema_version text not null default 'labrat.experimentCustomValue.v1',
  value text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id) on delete set null,
  updated_by text references users(id) on delete set null,
  unique (project_id, custom_column_id, experiment_id)
);

create index if not exists experiment_custom_values_project_idx
  on experiment_custom_values(project_id, custom_column_id, experiment_id);
