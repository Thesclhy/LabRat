create table if not exists workbook_understandings (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  source_document_id text not null references source_documents(id) on delete cascade,
  workbook_review_session_id text not null references workbook_review_sessions(id) on delete cascade,
  schema_version text not null default 'labrat.workbookUnderstanding.v1',
  status text not null default 'accepted',
  version integer not null default 1,
  understanding jsonb not null default '{}'::jsonb,
  facts jsonb not null default '[]'::jsonb,
  region_summaries jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  decision_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id)
);

create index if not exists workbook_understandings_project_idx
  on workbook_understandings(project_id, updated_at desc);

create index if not exists workbook_understandings_source_document_idx
  on workbook_understandings(source_document_id, updated_at desc);

create index if not exists workbook_understandings_session_idx
  on workbook_understandings(workbook_review_session_id, updated_at desc);
