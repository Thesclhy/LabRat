create table if not exists context_documents (
  id text primary key,
  lab_id text not null references labs(id),
  project_id text not null references projects(id),
  original_name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  current_version_id text,
  version integer not null default 1,
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists context_documents_active_name
  on context_documents(project_id, original_name) where status = 'active';
create index if not exists context_documents_project on context_documents(project_id, id);

create table if not exists context_document_versions (
  id text primary key,
  document_id text not null references context_documents(id),
  project_id text not null references projects(id),
  file_object_id text not null references file_objects(id),
  version_number integer not null,
  content_hash text not null,
  processing_version text not null,
  status text not null default 'pending' check (status in ('pending','processing','ready','partial','failed')),
  metadata jsonb not null default '{}'::jsonb,
  failure_code text,
  lease_token text,
  lease_expires_at timestamptz,
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_id, version_number),
  unique(document_id, content_hash, processing_version)
);
create index if not exists context_document_versions_project
  on context_document_versions(project_id, document_id, version_number);

create table if not exists context_document_pages (
  version_id text not null references context_document_versions(id),
  page_number integer not null check (page_number > 0),
  body jsonb not null,
  primary key(version_id, page_number)
);

create table if not exists context_document_passages (
  version_id text not null references context_document_versions(id),
  project_id text not null references projects(id),
  id text not null,
  ordinal integer not null,
  text text not null check (length(text) <= 4000),
  locator jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  primary key(version_id, id)
);
create index if not exists context_document_passages_order
  on context_document_passages(version_id, ordinal, id);
create index if not exists context_document_passages_project
  on context_document_passages(project_id, version_id);
create index if not exists context_document_passages_lexical
  on context_document_passages using gin(to_tsvector('simple', text));
