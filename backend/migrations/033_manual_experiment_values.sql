-- Hand-typed values for the accepted-data columns of a manually logged row.
-- They are display-only text: a DataSnapshot never contains them, so analysis
-- and chart inputs never read them. Once accepted data publishes the same
-- experiment identity, the snapshot values are shown instead.
create table if not exists manual_experiment_values (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  experiment_id text not null references experiment_identities(id) on delete cascade,
  column_id text not null,
  schema_version text not null default 'labrat.manualExperimentValue.v1',
  value text not null default '',
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  unique (project_id, experiment_id, column_id)
);
