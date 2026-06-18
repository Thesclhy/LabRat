create table if not exists source_documents (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  file_object_id text references file_objects(id) on delete set null,
  import_run_id text references import_runs(id) on delete set null,
  document_type text not null default 'excel_workbook',
  index_version text not null default 'labrat.sourceIndex.v1',
  status text not null default 'indexed',
  metadata jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id),
  unique (project_id, file_object_id)
);

create index if not exists source_documents_project_idx
  on source_documents(project_id, updated_at desc);

create table if not exists source_regions (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  source_document_id text not null references source_documents(id) on delete cascade,
  import_run_id text references import_runs(id) on delete set null,
  region_key text,
  kind text not null default 'unknown_region',
  label text,
  sheet_name text,
  range_ref text,
  start_row integer,
  end_row integer,
  start_col integer,
  end_col integer,
  confidence numeric,
  signals jsonb not null default '{}'::jsonb,
  candidate_fields jsonb not null default '[]'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id)
);

create index if not exists source_regions_document_idx
  on source_regions(source_document_id, sheet_name, start_row, start_col);

create index if not exists source_regions_project_idx
  on source_regions(project_id, kind);

create table if not exists source_index_blobs (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  source_document_id text not null references source_documents(id) on delete cascade,
  blob_kind text not null,
  storage_provider text not null default 'database',
  storage_key text,
  payload jsonb,
  checksum_sha256 text,
  created_at timestamptz not null default now(),
  created_by text references users(id)
);

create index if not exists source_index_blobs_document_idx
  on source_index_blobs(source_document_id, blob_kind);
