-- Manually logged Experiment Browser rows. A manual experiment is a logbook
-- entry: it owns an experiment identity but has no DataSnapshot head, so it is
-- never an analysis or chart input. Its documented values live in
-- experiment_custom_values; deleting the identity cascades to this table.
create table if not exists manual_experiments (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  experiment_id text not null references experiment_identities(id) on delete cascade,
  schema_version text not null default 'labrat.manualExperiment.v1',
  note text not null default '',
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null references users(id),
  updated_by text references users(id),
  unique (project_id, experiment_id)
);

create index if not exists manual_experiments_project_idx
  on manual_experiments(project_id, created_at, id);
