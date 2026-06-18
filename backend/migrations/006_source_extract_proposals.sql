create table if not exists source_extract_proposals (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  source_document_id text references source_documents(id) on delete set null,
  source_region_id text references source_regions(id) on delete set null,
  dataset_commit_id text references dataset_commits(id) on delete set null,
  schema_version text not null default 'labrat.sourceExtractProposal.v1',
  status text not null default 'proposed',
  purpose text,
  extract_type text,
  intent jsonb not null default '{}'::jsonb,
  preview jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  decision_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id)
);

create index if not exists source_extract_proposals_project_idx
  on source_extract_proposals(project_id, updated_at desc);

create index if not exists source_extract_proposals_document_idx
  on source_extract_proposals(source_document_id, source_region_id);
