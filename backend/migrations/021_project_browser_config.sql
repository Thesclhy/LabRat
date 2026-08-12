create table if not exists project_browser_configs (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  schema_version text not null default 'labrat.projectBrowserConfig.v1',
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text references users(id) on delete set null,
  unique(project_id)
);

create index if not exists project_browser_configs_project_idx
  on project_browser_configs(lab_id, project_id);
