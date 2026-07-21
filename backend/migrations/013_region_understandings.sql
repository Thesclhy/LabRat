create table if not exists workbook_review_regions (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  workbook_review_session_id text not null references workbook_review_sessions(id) on delete cascade,
  source_document_id text not null references source_documents(id) on delete cascade,
  source_region_id text references source_regions(id) on delete set null,
  sheet_name text not null,
  range_ref text not null,
  selection_method text not null default 'manual',
  disposition text not null default 'active'
    check (disposition in ('active', 'ignored', 'deleted')),
  review_status text not null default 'interpreting'
    check (review_status in ('interpreting', 'awaiting_review', 'accepted', 'interpretation_failed')),
  current_revision_id text,
  accepted_revision_id text,
  version integer not null default 1,
  warnings jsonb not null default '[]'::jsonb,
  ignored_at timestamptz,
  ignored_by text references users(id),
  ignored_reason text,
  deleted_at timestamptz,
  deleted_by text references users(id),
  deleted_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id),
  updated_by text references users(id)
);

create table if not exists region_understanding_revisions (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  workbook_review_session_id text not null references workbook_review_sessions(id) on delete cascade,
  source_document_id text not null references source_documents(id) on delete cascade,
  region_id text not null references workbook_review_regions(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  trigger text not null default 'initial'
    check (trigger in ('initial', 'user_feedback', 'retry')),
  user_feedback text not null default '',
  summary jsonb not null default '[]'::jsonb,
  interpretation jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  source_content_hash text not null,
  dependency_hash text not null,
  validation jsonb not null default '{}'::jsonb,
  provider jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  confidence double precision,
  created_at timestamptz not null default now(),
  created_by text references users(id),
  unique(region_id, revision_number)
);

alter table workbook_review_regions
  add constraint workbook_review_regions_current_revision_fk
  foreign key (current_revision_id) references region_understanding_revisions(id) on delete set null;

alter table workbook_review_regions
  add constraint workbook_review_regions_accepted_revision_fk
  foreign key (accepted_revision_id) references region_understanding_revisions(id) on delete set null;

create index if not exists workbook_review_regions_project_idx
  on workbook_review_regions(project_id, updated_at desc);

create index if not exists workbook_review_regions_session_idx
  on workbook_review_regions(workbook_review_session_id, updated_at desc);

create index if not exists workbook_review_regions_source_document_idx
  on workbook_review_regions(source_document_id, updated_at desc);

create index if not exists region_understanding_revisions_project_idx
  on region_understanding_revisions(project_id, created_at desc);

create index if not exists region_understanding_revisions_region_idx
  on region_understanding_revisions(region_id, revision_number desc);
