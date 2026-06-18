create table if not exists supplemental_import_batches (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  status text not null default 'queued',
  summary jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null references users(id),
  updated_by text references users(id)
);

create table if not exists supplemental_import_batch_items (
  id text primary key,
  batch_id text not null references supplemental_import_batches(id) on delete cascade,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  file_object_id text not null references file_objects(id),
  import_run_id text references import_runs(id),
  file_name text not null,
  status text not null default 'queued',
  progress_message text,
  summary jsonb not null default '{}',
  relationship_preview jsonb,
  warnings jsonb not null default '[]',
  error jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by text not null references users(id),
  updated_by text references users(id)
);

create index if not exists idx_supplemental_import_batches_project
  on supplemental_import_batches(lab_id, project_id, updated_at);

create index if not exists idx_supplemental_import_batch_items_batch
  on supplemental_import_batch_items(batch_id, updated_at);

create index if not exists idx_supplemental_import_batch_items_project
  on supplemental_import_batch_items(lab_id, project_id, updated_at);
