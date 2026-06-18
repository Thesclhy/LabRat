create table if not exists observation_series (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  dataset_commit_id text references dataset_commits(id),
  source_import_id text,
  observation_set_id text,
  experiment_id text,
  experiment_label text,
  series_kind text not null,
  x_field text not null,
  y_field text not null,
  source_refs jsonb not null default '[]',
  summary jsonb not null default '{}',
  status text not null default 'active',
  payload jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null references users(id),
  updated_by text references users(id)
);

create index if not exists idx_observation_series_project
  on observation_series(lab_id, project_id, dataset_commit_id);

create index if not exists idx_observation_series_kind
  on observation_series(project_id, series_kind, x_field, y_field);
