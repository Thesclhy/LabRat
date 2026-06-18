create table if not exists analysis_views (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  dataset_commit_id text references dataset_commits(id),
  view_type text not null,
  status text not null default 'draft',
  title text,
  spec jsonb not null default '{}',
  source_refs jsonb not null default '[]',
  warnings jsonb not null default '[]',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null references users(id),
  updated_by text references users(id)
);

create index if not exists idx_analysis_views_project
  on analysis_views(lab_id, project_id, updated_at);

create index if not exists idx_analysis_views_dataset
  on analysis_views(project_id, dataset_commit_id, view_type);
