create table if not exists workbook_review_sessions (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  source_document_id text not null references source_documents(id) on delete cascade,
  schema_version text not null default 'labrat.workbookReviewSession.v1',
  status text not null default 'needs_user_review',
  version integer not null default 1,
  workbook_summary jsonb not null default '{}'::jsonb,
  current_understanding jsonb not null default '{}'::jsonb,
  regions jsonb not null default '[]'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id)
);

create index if not exists workbook_review_sessions_project_idx
  on workbook_review_sessions(project_id, updated_at desc);

create index if not exists workbook_review_sessions_source_document_idx
  on workbook_review_sessions(source_document_id, updated_at desc);
