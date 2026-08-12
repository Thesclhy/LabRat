create table if not exists experiment_annotations (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  experiment_id text not null references experiment_identities(id) on delete cascade,
  schema_version text not null default 'labrat.experimentAnnotation.v1',
  note text not null default '',
  color text not null default 'amber' check (color in ('amber', 'red', 'green', 'blue', 'purple', 'pink')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id, experiment_id)
);

create index if not exists experiment_annotations_project_user_idx
  on experiment_annotations(project_id, user_id);
