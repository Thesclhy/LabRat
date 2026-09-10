create table if not exists region_extraction_templates (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  schema_version text not null default 'labrat.regionExtractionTemplate.v1',
  name text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  current_version_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text references users(id) on delete set null,
  updated_by text references users(id) on delete set null
);

create unique index if not exists region_extraction_templates_project_name_key
  on region_extraction_templates(project_id, lower(name));
create index if not exists region_extraction_templates_project_status_idx
  on region_extraction_templates(project_id, status, updated_at desc, id);

create table if not exists region_extraction_template_versions (
  id text primary key,
  lab_id text not null references labs(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  region_extraction_template_id text not null references region_extraction_templates(id) on delete restrict,
  schema_version text not null default 'labrat.regionExtractionTemplateVersion.v1',
  version integer not null check (version > 0),
  status text not null default 'accepted' check (status = 'accepted'),
  source_region_id text not null references workbook_review_regions(id) on delete restrict,
  source_revision_id text not null references region_understanding_revisions(id) on delete restrict,
  source_document_id text references source_documents(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  content_hash text not null,
  created_at timestamptz not null default now(),
  created_by text references users(id) on delete set null,
  unique (region_extraction_template_id, version),
  unique (region_extraction_template_id, content_hash)
);

alter table region_extraction_templates
  add constraint region_extraction_templates_current_version_fk
  foreign key (current_version_id) references region_extraction_template_versions(id) on delete restrict;

create index if not exists region_extraction_template_versions_template_idx
  on region_extraction_template_versions(region_extraction_template_id, version desc);
create index if not exists region_extraction_template_versions_source_region_idx
  on region_extraction_template_versions(project_id, source_region_id);
